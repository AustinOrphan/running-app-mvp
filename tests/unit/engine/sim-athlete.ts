// Scenario simulator: a seeded stand-in for a runner who does not do what the plan says, driving the
// real re-plan along a chain of weekly Monday re-plans (evaluation harness, proposal
// `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` section 5.3, task H2).
//
// `SimAthlete(seed, level)` extends `replanChain` (`replan-steps.ts`): each week it turns the sessions
// of the plan in force into activities as its level says (some run as planned, some short, some
// skipped, some weeks above plan), puts the windows and the closed days it met into the next step's
// input, and calls the real `replan`, with the weekly decision of the week that ended as the server's
// re-plan gives it (`computeReplan` in `server/services/replan.ts`: the cap and the hold or reduce of
// the next week). Illness and niggle windows go through the real `DisruptionWindow` path of rule J9
// and a closed day through `profile.availability`. A chain with no skips, no windows and every session
// run exactly as planned is `replanChain` (a test pins it).
//
// The levels are STAND-INS. They are stress shapes with no fitness model (G2) and no claim about how
// many runners behave so: every rate below is a named constant marked PREFERENCE, the harness's own
// choice and no rule's number. Feely 2022 [feely-2022-training-disruptions, B] supports the SHAPE of
// the ragged level only (over half of the marathoners of 300,000 logs stopped for up to 6 days in the
// last 16 weeks, survivors who reached the race only); it gives no rate, and the ragged rates are
// stated as a stress, above what that paper suggests. Nothing here is a target, a threshold or a
// verdict (G5), and the scorer returns figures, never an overall score.
//
// Everything the athlete does is a function of the seed and of the date (and the session's order on
// it), never of the engine's output: a re-plan that changes the plan does not change the athlete's
// days, so two chains of one seed differ only where the plans differ. No `Math.random`, no clock.
//
// No level sets wellness (no check-ins, HRV or sleep): a step's `wellness` is the first input's, as in
// `replanChain`; an illness reaches the engine as a window, not as a check-in.
//
// By hand, at each `PARAMS_VERSION` bump (decision 11): the chain figures are read, not asserted, with
// `SIM_FIGURES=1 npx vitest run tests/unit/engine/sim-athlete.test.ts -t "printed by hand"`. What
// `sim-athlete.test.ts` keeps in `npm run check` are the two metamorphic relations, which are rules
// and not metrics [Segura 2016], and the tests of the athlete and the scorer.
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { weeklyDecision } from '../../../shared/engine/adapt.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { RUN_KINDS } from '../../../shared/engine/adjust.ts'
import { validateDisruption } from '../../../shared/engine/disruption.ts'
import { buildPlan, replan, weeklyRamp } from '../../../shared/engine/index.ts'
import { rebuildZone } from '../../../shared/engine/loadSetting.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  DisruptionWindow,
  EngineInput,
  LoadAppetite,
  PlanDraft,
  SessionKind,
  SessionSpec,
  WeeklyDecision,
} from '../../../shared/engine/types.ts'
import type { Activity, Availability, Weekday } from '../../../shared/types.ts'
import { mulberry32 } from './disruption-fixtures.ts'
import { activity } from './e8-fixtures.ts'
import type { ReplanStep } from './replan-steps.ts'

// ---------------------------------------------------------------------------------------------
// Preferences: the rates of the levels and the harness's own thresholds
// ---------------------------------------------------------------------------------------------

export type SimLevel = 'compliant' | 'ragged' | 'overshooting'

/** The levels in the order they were asked for: ragged first (decision 11). */
export const SIM_LEVELS: readonly SimLevel[] = ['ragged', 'compliant', 'overshooting']

/** A closed range `[low, high]` a draw is spread over evenly. */
export type Range = readonly [low: number, high: number]

/** What a level does. Every number is a PREFERENCE of the harness (see the file header). */
export interface LevelRates {
  /** Minutes run over minutes planned for a session run as planned. */
  asPlanned: Range
  /** Share of run days with no running, apart from the stops. */
  skipDayShare: number
  /** Share of weeks in which a stop starts. A stop is days in a row with no running. */
  stopWeekShare: number
  /** The longest stop in days: the shape Feely 2022 reports ("up to 6 days"), not its rate. */
  stopMaxDays: number
  /** Share of run sessions cut short, and the ratio of minutes run to minutes planned then. */
  shortSessionShare: number
  shortRatio: Range
  /** Share of weeks in which an illness or niggle window starts, and its length in days. */
  windowWeekShare: number
  windowDays: Range
  /** Share of weeks in which one weekday closes, and for how many weeks. */
  closureWeekShare: number
  closedWeeks: Range
  /** Share of weeks run above plan, and the ratio of minutes run to minutes planned then. */
  overshootWeekShare: number
  overshootRatio: Range
}

/** The quiet runner every level starts from: runs each session as planned, within the band. */
const QUIET: LevelRates = {
  asPlanned: [0.9, 1.1],
  skipDayShare: 0,
  stopWeekShare: 0,
  stopMaxDays: 0,
  shortSessionShare: 0,
  shortRatio: [0.4, 0.7],
  windowWeekShare: 0,
  windowDays: [2, 6],
  closureWeekShare: 0,
  closedWeeks: [2, 4],
  overshootWeekShare: 0,
  overshootRatio: [1.25, 1.45],
}

/**
 * PREFERENCE: the three levels, each a stress and not an estimate of anyone's season.
 *
 * - compliant: every session at 90% to 110% of its minutes, inside the band of the completion rules
 *   (`completion.partialBelow` to `completion.extendedAbove`; a test pins it), so each session is "as
 *   planned" and each week holds `j5.completionHoldShare`.
 * - ragged: on top of that, 1 run day in 20 skipped, a stop (1 to 6 days in a row, Feely's shape) in
 *   1 week of 12, 1 session in 10 cut to 40% to 70% of its minutes, an illness or niggle window of 2 to
 *   6 days in about 1 week of 12 (at least 14 days apart), and one weekday closed for 2 to 4 weeks in
 *   about 1 week of 12. A stop starts in 8% of weeks, so 1 - 0.92^16 = 74% of 16-week stretches hold
 *   one, where Feely 2022 found over half among the survivors who reached the race.
 * - overshooting: sessions at 100% to 110%, and half of the weeks run 25% to 45% above plan, past
 *   `completion.extendedAbove` (1.2), so the G-8 response has weeks to respond to. That response is
 *   read at the load settings that have one (standard, upper); at steady a week run above plan lifts
 *   nothing (rule G-2).
 */
export const LEVEL_RATES: Readonly<Record<SimLevel, LevelRates>> = {
  compliant: QUIET,
  ragged: {
    ...QUIET,
    skipDayShare: 0.05,
    stopWeekShare: 0.08,
    stopMaxDays: 6,
    shortSessionShare: 0.1,
    windowWeekShare: 0.08,
    closureWeekShare: 0.08,
  },
  overshooting: { ...QUIET, asPlanned: [1.0, 1.1], overshootWeekShare: 0.5 },
}

/** A runner who does exactly what the plan says: the chain is `replanChain`'s. For the fidelity test. */
export const EXACT_RATES: LevelRates = { ...QUIET, asPlanned: [1, 1] }

/**
 * PREFERENCE: a week counts as run above plan when its minutes pass this share of the minutes
 * planned. The number is that of `completion.extendedAbove`, which reads one session, so no rule
 * supports the weekly reading and the scorer's figure carries no label.
 */
export const WEEK_ABOVE_PLAN_RATIO = 1.2

/** PREFERENCE: days between the end of a window and the start of the next one. */
export const WINDOW_SPACING_DAYS = 14

/** PREFERENCE: the longest run of a niggle window that allows short runs (`limited`), in minutes. */
export const NIGGLE_CAP_MIN = 30

/** PREFERENCE: share of niggle windows reported with pain at the flag score (`pain.flagScore`). */
export const PAINFUL_NIGGLE_SHARE = 0.3

/** PREFERENCE: a weekday is closed only while at least this many weekdays stay open. */
export const MIN_OPEN_DAYS = 4

/** The kinds the athlete runs; a race is the last day of the chain and is never run in it. */
const RAN_KINDS: ReadonlySet<SessionKind> = new Set([...RUN_KINDS].filter((k) => k !== 'race'))

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

// ---------------------------------------------------------------------------------------------
// Seeded streams
// ---------------------------------------------------------------------------------------------

/** The concerns that draw numbers; each has its own stream, so one never shifts another. */
const SALT = {
  skipDay: 1,
  session: 2,
  week: 3,
  stop: 4,
  window: 5,
  closure: 6,
} as const

/** A 32-bit mix of integers (FNV-1a with an extra fold), the seed of one stream. */
function mix(parts: readonly number[]): number {
  let h = 0x811c9dc5
  for (const part of parts) {
    h = Math.imul(h ^ (part | 0), 0x01000193)
    h ^= h >>> 15
  }
  return h >>> 0
}

/** Days since a fixed day, so a date can be a stream key. */
const dayNumber = (date: string): number => daysBetween('2000-01-01', date)

/** A value spread evenly over `range` for a draw `u` of [0, 1). */
const between = (range: Range, u: number): number => range[0] + (range[1] - range[0]) * u

/** An integer spread evenly over `range` (both ends included) for a draw `u` of [0, 1). */
const integerBetween = (range: Range, u: number): number =>
  Math.floor(range[0] + u * (range[1] - range[0] + 1))

// ---------------------------------------------------------------------------------------------
// The athlete's life: stops, windows and closed days, a function of the seed alone
// ---------------------------------------------------------------------------------------------

/** Days in a row with no running that no window reports. */
export interface SimStop {
  from: string
  days: number
}

/** A weekday that is closed in the input of every step from `from` up to, not including, `until`. */
export interface SimClosure {
  weekday: Weekday
  from: string
  until: string
}

export interface SimCalendar {
  stops: SimStop[]
  /** Illness and niggle windows as the runner reports them, each valid by `validateDisruption`. */
  windows: DisruptionWindow[]
  closures: SimClosure[]
  /** Days with no running: the stops and the days of the windows that rest. */
  idleDays: ReadonlySet<string>
  /** The longest run of a day inside a window that limits running, by date. */
  caps: ReadonlyMap<string, number>
}

/** What became of one session of the plan. */
export type SessionOutcome = 'as-planned' | 'short' | 'extended' | 'skipped'

/** One week as the athlete ran it, against the plan in force when it began. */
export interface SimWeek {
  weekStart: string
  /** `WeekDraft.targetRunMin` of the plan in force; null when that plan has no such week. */
  targetMin: number | null
  /** Minutes of the plan's run sessions in the week (from the first day of the plan in week 0). */
  plannedMin: number
  ranMin: number
  /** Count of the week's planned run sessions by outcome (`completion.partialBelow`, `.extendedAbove`). */
  sessions: Record<SessionOutcome, number>
}

/** The first Monday on or after a date: the day the weekly re-plan learns of a window starting then. */
const reportedOn = (date: string): string => {
  const monday = mondayOf(date)
  return monday === date ? date : addDays(monday, 7)
}

export class SimAthlete {
  readonly seed: number
  readonly level: SimLevel
  readonly rates: LevelRates

  /** `rates` replaces the level's own, for tests that need a different stand-in. */
  constructor(seed: number, level: SimLevel, rates: LevelRates = LEVEL_RATES[level]) {
    this.seed = seed
    this.level = level
    this.rates = rates
  }

  private stream(salt: keyof typeof SALT, ...keys: number[]): () => number {
    return mulberry32(mix([this.seed, SALT[salt], ...keys]))
  }

  /**
   * The stops, windows and closed days of the athlete's season from the week of `first.today` to the
   * week before the race. Depends on the seed, the level and the goal date alone.
   */
  calendar(first: EngineInput): SimCalendar {
    const { rates } = this
    const firstMonday = mondayOf(first.today)
    const raceMonday = mondayOf(first.goal.date)
    const lastDay = addDays(first.goal.date, -1)
    const stops: SimStop[] = []
    const windows: DisruptionWindow[] = []
    const closures: SimClosure[] = []
    const idleDays = new Set<string>()
    const caps = new Map<string, number>()
    const base = first.profile.availability
    const closable = WEEKDAYS.filter((d) => base[d].available && d !== first.profile.longRunDay)
    const open = WEEKDAYS.filter((d) => base[d].available).length

    for (
      let week = 0, monday = firstMonday;
      monday < raceMonday;
      week += 1, monday = addDays(monday, 7)
    ) {
      const key = dayNumber(monday)
      // the first week holds only the days from today on
      const earliest = week === 0 ? daysBetween(monday, first.today) : 0

      // a stop: days in a row with no running
      const stop = this.stream('stop', key)
      const [starts, startAt, length] = [stop(), stop(), stop()]
      if (starts < rates.stopWeekShare && rates.stopMaxDays > 0) {
        const from = addDays(monday, earliest + Math.floor(startAt * (7 - earliest)))
        const days = integerBetween([1, rates.stopMaxDays], length)
        stops.push({ from, days })
        for (let k = 0; k < days; k += 1) idleDays.add(addDays(from, k))
      }

      // a window: illness or a niggle, at least WINDOW_SPACING_DAYS after the last one
      const win = this.stream('window', key)
      const [opens, startAtW, lengthW, which, limitedDraw, painDraw] = [
        win(),
        win(),
        win(),
        win(),
        win(),
        win(),
      ]
      const previous = windows.at(-1)
      if (
        opens < rates.windowWeekShare &&
        (previous === undefined || addDays(previous.endDate, WINDOW_SPACING_DAYS) < monday)
      ) {
        const startDate = addDays(monday, earliest + Math.floor(startAtW * (7 - earliest)))
        const endDate = [
          addDays(startDate, integerBetween(rates.windowDays, lengthW) - 1),
          lastDay,
        ].sort()[0]!
        const reason =
          which < 1 / 3 ? 'illness-above-neck' : which < 2 / 3 ? 'illness-below-neck' : 'niggle'
        const limited = reason === 'niggle' && limitedDraw < 0.5
        const painful = painDraw < PAINFUL_NIGGLE_SHARE
        const window: DisruptionWindow = {
          id: `sim-${String(week)}`,
          reason,
          mode: limited ? 'limited' : 'rest',
          startDate,
          endDate,
          maxRunMin: limited ? NIGGLE_CAP_MIN : null,
          pain:
            reason === 'niggle'
              ? painful
                ? P.pain.flagScore.value
                : P.pain.flagScore.value - 1
              : null,
          gaitChange: false,
        }
        if (endDate >= startDate) {
          // the form refuses a window it would not take, and so does the simulator
          const issues = validateDisruption(window, {
            today: reportedOn(startDate),
            goalDate: first.goal.date,
          })
          if (issues.length > 0) {
            throw new Error(
              `sim window ${window.id} is not valid: ${issues.map((i) => i.code).join()}`,
            )
          }
          windows.push(window)
          for (let day = startDate; day <= endDate; day = addDays(day, 1)) {
            if (window.mode === 'rest') idleDays.add(day)
            else caps.set(day, NIGGLE_CAP_MIN)
          }
        }
      }

      // a closed weekday, from this Monday's re-plan
      const closure = this.stream('closure', key)
      const [closes, dayDraw, weeksDraw] = [closure(), closure(), closure()]
      const active = closures.at(-1)
      if (
        week > 0 &&
        closes < rates.closureWeekShare &&
        (active === undefined || active.until <= monday) &&
        open > MIN_OPEN_DAYS &&
        closable.length > 0
      ) {
        const weeks = integerBetween(rates.closedWeeks, weeksDraw)
        closures.push({
          weekday: closable[Math.floor(dayDraw * closable.length)]!,
          from: monday,
          until: addDays(monday, 7 * weeks),
        })
      }
    }
    return { stops, windows, closures, idleDays, caps }
  }

  /** The factor the whole week is run at: above plan in an overshooting week, else 1. */
  weekFactor(weekStart: string): number {
    const draw = this.stream('week', dayNumber(weekStart))
    const [above, ratio] = [draw(), draw()]
    return above < this.rates.overshootWeekShare ? between(this.rates.overshootRatio, ratio) : 1
  }

  /**
   * The minutes the athlete runs of one planned session; 0 when it is not run. A function of the
   * session's date and order, so changing the plan elsewhere does not change this session's draw.
   */
  minutesRun(
    session: Pick<SessionSpec, 'date' | 'order' | 'durationMin'>,
    calendar: SimCalendar,
  ): number {
    if (calendar.idleDays.has(session.date)) return 0
    const day = dayNumber(session.date)
    if (this.stream('skipDay', day)() < this.rates.skipDayShare) return 0
    const draw = this.stream('session', day, session.order)
    const [shortDraw, ratioDraw] = [draw(), draw()]
    const ratio =
      shortDraw < this.rates.shortSessionShare
        ? between(this.rates.shortRatio, ratioDraw)
        : between(this.rates.asPlanned, ratioDraw) * this.weekFactor(mondayOf(session.date))
    const minutes = Math.max(1, Math.round(session.durationMin * ratio))
    return Math.min(minutes, calendar.caps.get(session.date) ?? minutes)
  }
}

// ---------------------------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------------------------

export interface SimOptions {
  /** The position of the load setting, left out of the input when absent. */
  loadAppetite?: LoadAppetite
  /** Stop after this many re-plans (default: until the race week), as `replanChain`. */
  maxSteps?: number
}

/**
 * A step of `replanChain`, with what the athlete did before it and what the re-plan was given.
 * `input` is what `replan` read (the Monday's data and the cap of the weekly decision); `settled` is
 * the Monday's data alone, which is what `replanMonday` takes.
 */
export interface SimStep extends ReplanStep {
  settled: EngineInput
  /** The weekly decision that sets the caps of the re-plan: `replan`'s second argument. */
  decisions: Record<string, WeeklyDecision['decision']>
  /** The decision for the week that ended before this step; null for the first plan. */
  decision: WeeklyDecision | null
  /** The week that ended before this step; null for the first plan. */
  week: SimWeek | null
  /** The weekdays closed in this step's availability. */
  closedDays: Weekday[]
}

export interface SimChain {
  seed: number
  level: SimLevel
  calendar: SimCalendar
  steps: SimStep[]
}

/** The result of one Monday's re-plan. */
export interface MondayReplan {
  /** What `replan` was given: the Monday's data, and the cap of the next week after a hold. */
  input: EngineInput
  /** The decisions that set the caps, the second argument of `replan`. */
  decisions: SimStep['decisions']
  /** The weekly decision for the week that ended; null when the stored plan has no such week. */
  decision: WeeklyDecision | null
  draft: PlanDraft
}

/**
 * The re-plan of a Monday as the server runs it (`computeReplan`, `server/services/replan.ts`): the
 * weekly decision for the week that ended, which after a hold or a reduce caps the week that follows
 * and trims its next quality session or makes it a recovery week [rules J5, g-6], then `replan`.
 * Pure: the same `settled` gives the same plan. What the server also reads and this does not: the
 * stored execution assessments, the owner's target overrides and the reviews.
 */
export function replanMonday(settled: EngineInput): MondayReplan {
  const lastWeek = addDays(mondayOf(settled.today), -7)
  const state = estimateState(settled)
  const decision = settled.existing?.weeks.some((w) => w.weekStart === lastWeek)
    ? weeklyDecision(settled, lastWeek, {
        redsFlags: settled.screeningFlags,
        ramp: weeklyRamp(state),
        rebuild: rebuildZone(settled, state),
      })
    : null
  const decidedWeek =
    decision !== null && decision.decision !== 'progress' ? addDays(lastWeek, 7) : null
  const decisions: SimStep['decisions'] =
    decision !== null && decidedWeek !== null ? { [decidedWeek]: decision.decision } : {}
  const input: EngineInput =
    decision !== null && decidedWeek !== null
      ? { ...settled, weekCaps: { [decidedWeek]: decision.nextWeekTargetMin } }
      : settled
  return { input, decisions, decision, draft: replan(input, { decisions }).draft }
}

const sessionKey = (s: Pick<SessionSpec, 'date' | 'order'>): string =>
  `${s.date}|${String(s.order)}`

/** A draft as the stored plan of a Monday: the sessions before it have the status `statusOf` gives. */
function storedPlan(
  draft: PlanDraft,
  monday: string,
  statusOf: (session: SessionSpec) => string,
): NonNullable<EngineInput['existing']> {
  return {
    weeks: draft.weeks,
    sessions: draft.sessions.map((s, i) => ({
      ...s,
      id: `s${String(i)}`,
      status: s.date < monday ? statusOf(s) : 'planned',
      activityId: null,
    })),
  }
}

/**
 * The same Monday with the step's plan as the stored plan and nothing new: the activities, windows,
 * availability, screening and day are the step's own. A re-plan of it that returns the step's plan is
 * the fixed point of the second metamorphic relation.
 */
export function withStoredPlan(step: Pick<SimStep, 'settled' | 'draft'>): EngineInput {
  const statuses = new Map(
    (step.settled.existing?.sessions ?? []).map((s) => [sessionKey(s), s.status]),
  )
  return {
    ...step.settled,
    existing: storedPlan(
      step.draft,
      step.settled.today,
      (s) => statuses.get(sessionKey(s)) ?? 'completed',
    ),
  }
}

function availabilityAt(base: Availability, closures: readonly SimClosure[], monday: string) {
  const out = { ...base }
  const closed: Weekday[] = []
  for (const c of closures) {
    if (c.from <= monday && monday < c.until) {
      out[c.weekday] = { available: false, maxMin: null }
      closed.push(c.weekday)
    }
  }
  return { availability: out, closed }
}

/** What happened to the sessions of one week, and the activities the athlete logged. */
function runWeek(
  athlete: SimAthlete,
  calendar: SimCalendar,
  draft: PlanDraft,
  weekStart: string,
  from: string,
): { week: SimWeek; activities: Activity[]; statuses: Map<SessionSpec, string> } {
  const end = addDays(weekStart, 7)
  const outcomes: Record<SessionOutcome, number> = {
    'as-planned': 0,
    short: 0,
    extended: 0,
    skipped: 0,
  }
  const activities: Activity[] = []
  const statuses = new Map<SessionSpec, string>()
  let plannedMin = 0
  let ranMin = 0
  for (const s of draft.sessions) {
    if (s.date < from || s.date >= end) continue
    if (!RAN_KINDS.has(s.kind) || s.durationMin <= 0) {
      statuses.set(s, 'completed')
      continue
    }
    const minutes = athlete.minutesRun(s, calendar)
    const ratio = minutes / s.durationMin
    const outcome: SessionOutcome =
      minutes === 0
        ? 'skipped'
        : ratio < P.completion.partialBelow.value
          ? 'short'
          : ratio > P.completion.extendedAbove.value
            ? 'extended'
            : 'as-planned'
    outcomes[outcome] += 1
    statuses.set(
      s,
      outcome === 'skipped' ? 'skipped' : outcome === 'short' ? 'partial' : 'completed',
    )
    plannedMin += s.durationMin
    ranMin += minutes
    if (minutes > 0) {
      activities.push(
        activity(s.date, {
          id: `done-${s.date}-${s.order}`,
          durationSec: minutes * 60,
          distanceM:
            minutes === s.durationMin
              ? (s.distanceM ?? s.durationMin * 170)
              : Math.round(((s.distanceM ?? s.durationMin * 170) * minutes) / s.durationMin),
        }),
      )
    }
  }
  const target = draft.weeks.find((w) => w.weekStart === weekStart)?.targetRunMin ?? null
  return {
    week: { weekStart, targetMin: target, plannedMin, ranMin, sessions: outcomes },
    activities,
    statuses,
  }
}

/**
 * The first plan of `first` and a re-plan on every Monday after it until the race week, with the
 * weeks run by `athlete` between them. The loop is `replanChain`'s; what it adds is the athlete's
 * activities, the windows reported by then, the closed weekdays, and the weekly decision of the week
 * that ended, which caps and trims the next week as the server's re-plan does.
 */
export function simulateChain(
  athlete: SimAthlete,
  first: EngineInput,
  options: SimOptions = {},
): SimChain {
  const { loadAppetite, maxSteps = Infinity } = options
  const start: EngineInput =
    loadAppetite === undefined ? first : { ...first, options: { ...first.options, loadAppetite } }
  const calendar = athlete.calendar(start)
  let draft = buildPlan(start)
  let activities = start.activities
  const steps: SimStep[] = [
    {
      draft,
      input: start,
      settled: start,
      decisions: {},
      decision: null,
      week: null,
      closedDays: [],
    },
  ]
  // what became of each past session, by day and order: a re-plan keeps its past sessions as copies
  const settledStatus = new Map<string, string>()
  const raceMonday = mondayOf(start.goal.date)
  for (
    let monday = addDays(mondayOf(start.today), 7);
    monday <= raceMonday && steps.length <= maxSteps;
    monday = addDays(monday, 7)
  ) {
    const lastWeek = addDays(monday, -7)
    const ran = runWeek(
      athlete,
      calendar,
      draft,
      lastWeek,
      steps.length === 1 ? start.today : lastWeek,
    )
    activities = [...activities, ...ran.activities]
    for (const [s, status] of ran.statuses) settledStatus.set(sessionKey(s), status)
    const windows = calendar.windows.filter((w) => w.startDate <= monday)
    const { availability, closed } = availabilityAt(
      start.profile.availability,
      calendar.closures,
      monday,
    )
    const settled: EngineInput = {
      ...start,
      today: monday,
      ...(closed.length > 0 ? { profile: { ...start.profile, availability } } : {}),
      activities,
      ...(windows.length > 0 ? { disruptions: windows } : {}),
      existing: storedPlan(draft, monday, (s) => settledStatus.get(sessionKey(s)) ?? 'completed'),
    }
    const replanned = replanMonday(settled)
    draft = replanned.draft
    steps.push({
      draft,
      input: replanned.input,
      settled,
      decisions: replanned.decisions,
      decision: replanned.decision,
      week: ran.week,
      closedDays: closed,
    })
  }
  return { seed: athlete.seed, level: athlete.level, calendar, steps }
}

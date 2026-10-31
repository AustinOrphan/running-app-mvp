// "From your numbers" (phase 3a design 8.4): the figures the engine read for a rule, as data. A
// builder turns the athlete snapshot into `InputFact`s (a template id, its slots, dated sources and
// a state: `used`, or `insufficient` with a sentence that says what the rule needs and what was
// found). Nothing here writes a sentence: `renderFact` does, in the runner's units, when the fact
// is read. Pure and deterministic: the same context gives the same facts, nothing is mutated, and
// nothing reads a clock, the network or the database. The server hands over the snapshot, the
// heart-rate model, the weekly decision and the prediction it has already computed.
import { EXPLAIN_CHECKIN_DAYS, EXPLAIN_MAX_SOURCES } from '../copy/limits.ts'
import { loadHoldReason, loadName, stepPercent } from '../copy/load.ts'
import { countPhrase } from '../copy/quantity.ts'
import { ZONE_BOUNDARY_WORDS } from '../copy/revision.ts'
import { STRENGTH_TEMPLATES } from '../copy/strengthTemplates.ts'
import type { SlotValues } from '../copy/template.ts'
import type { TEMPLATES, TemplateId } from '../copy/templates.ts'
import { addDays, daysBetween, isIsoDate, mondayOf } from '../dates.ts'
import { exerciseById, isExerciseId } from '../domain/strengthLibrary.ts'
import { aggregateWeeks } from '../domain/weeks.ts'
import type {
  Activity,
  DisruptionReason,
  EquipmentKind,
  Goal,
  StrengthTemplate,
  StrengthWorkout,
  WorkoutLift,
} from '../types.ts'
import { afterBreak, breakRestart, weekEvidence } from './adapt.ts'
import { bmiOf, csEffortsOf, durabilityRuns, efficiencySamples, hrAnchors } from './athlete.ts'
import type { HrModel } from './execution.ts'
import { feasibility, meanWeeklyKm, peakLongRunMin, trainingPace } from './goal.ts'
import { nextWeekCap } from './guards.ts'
import {
  countsTowardReference,
  plannedMinOf,
  rebuildStep,
  responseBaseline,
  spikeOverrideLimit,
  spikeWarnLimit,
  noviceRamp,
  startLevelMin,
  ultraRunCapMin,
  VOLUME_KINDS,
  weeklyRamp,
  wholeMinutes,
} from './limits.ts'
import { isDuplicate, sessionLoad } from './load.ts'
import { blockLiftMin, loadPosition, rebuildZone, responseBasis, zoneBlock } from './loadSetting.ts'
import {
  cycleShortReason,
  cycleWorkWeeks,
  startLift,
  startPath,
  strengthBlockPosition,
  taperDays,
} from './macro.ts'
import { P } from './params/index.ts'
import { ownHoldReasons, postRaceWindows } from './postRace.ts'
import { rangeLabel } from './predict.ts'
import {
  checkinsOf,
  focalBoneActive,
  illnessPhase,
  poorSubjective,
  recentPain,
  sleepAverageH,
} from './readiness.ts'
import { isLoadingWeek, rungCount } from './startWeeks.ts'
import { liftFor, percentOfMax, workoutFor } from './strength.ts'
import { resolveTargets } from './targets.ts'
import type {
  AthleteState,
  Boundary,
  Checkin,
  EngineInput,
  ExplainGroup,
  ExplainRequest,
  ExplainView,
  Feasibility,
  GoalModel,
  InputFact,
  PhaseV2,
  Prediction,
  Quantity,
  ReadinessSnapshot,
  SourceRef,
  StrengthContext,
  StrengthSessionRef,
  WeekDraft,
  WeeklyDecision,
  ZoneSet,
} from './types.ts'
import type { ZoneBoundary } from './zoneChange.ts'

// ---------------------------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------------------------

type SessionRow = NonNullable<EngineInput['existing']>['sessions'][number]

/**
 * Everything the builders read. The server fills it from the athlete snapshot (`input` is the
 * snapshot as the engine reads it) and adds the values that need more than the snapshot: the
 * heart-rate model, the weekly decision for `explainWeeks(...).last` and the prediction for
 * `goal`. A field the request does not need may be null (`explainNeeds`).
 */
export interface ExplainContext {
  /** The local day the figures are read for. */
  asOf: string
  input: EngineInput
  state: AthleteState
  zones: ZoneSet
  readiness: ReadinessSnapshot
  /** The goal the prediction rules are about, or null without one. */
  goal: Pick<Goal, 'id' | 'distanceM' | 'gainM' | 'surface'> | null
  prediction: Prediction | null
  hrModel: HrModel | null
  /** The weekly decision about `explainWeeks(...).last`, or null when no plan covers that week. */
  decision: WeeklyDecision | null
  /**
   * The input with the goal and the options of the plan itself, which the load setting is read
   * from (`loadInputOf`): the post-race hold depends on the goal race, and `input` carries a
   * neutral goal. Absent or null without a plan, and the setting is then read from `input`.
   */
  planInput?: EngineInput | null
  /**
   * The goal as the engine reads it (distance class, expected time, race-day heat), or null
   * without a goal. `input.goal` is a neutral stand-in for reads about the athlete.
   */
  race: GoalModel | null
  /**
   * What the strength engine reads (`loadStrengthContext`), for the rules F7 to F9: the saved
   * setup, the logs, the stored plan's weeks and the readiness read of the day. Absent or null
   * when the request has no use for it (`explainNeeds`); those builders then say what they need.
   */
  strength?: StrengthContext | null
}

/** What a builder reads besides the context. */
interface Scope {
  readonly ctx: ExplainContext
  /** The session being explained, for a session or a strength request. */
  readonly session: SessionRow | null
  /** The exercise a strength request opened on (a lift's "Why"); null for the session as a whole. */
  readonly exercise: string | null
  /** The week the ramp starts from and the weekly decision is about (a Monday). */
  readonly last: string
  /** The week they lead to (a Monday). */
  readonly next: string
}

type Builder = (scope: Scope) => InputFact[]

// ---------------------------------------------------------------------------------------------
// Fact construction
// ---------------------------------------------------------------------------------------------

type SlotsOf<K extends TemplateId> = SlotValues<(typeof TEMPLATES)[K]['slots']>

interface FactExtras {
  sources?: readonly SourceRef[]
  window?: { from: string; to: string }
  /** A gap sentence: the rule lacks the data it needs. */
  insufficient?: boolean
}

type Q<K extends Quantity['kind']> = Extract<Quantity, { kind: K }>

const count = (n: number): Q<'count'> => ({ kind: 'count', n: Math.round(n) })
/** A count that keeps its decimals (a ratio). */
const exact = (n: number): Q<'count'> => ({ kind: 'count', n })
const minutes = (min: number): Q<'minutes'> => ({ kind: 'minutes', min: Math.round(min) })
const bpm = (value: number): Q<'bpm'> => ({ kind: 'bpm', bpm: Math.round(value) })
const percent = (pct: number): Q<'percent'> => ({ kind: 'percent', pct })
const share = (fraction: number): Q<'share'> => ({ kind: 'share', fraction })
const distance = (m: number): Q<'distance'> => ({ kind: 'distance', m })
const climb = (m: number): Q<'climb'> => ({ kind: 'climb', m })
const duration = (sec: number): Q<'duration'> => ({ kind: 'duration', sec: Math.round(sec) })
const pace = (secPerKm: number): Q<'pace'> => ({ kind: 'pace', secPerKm })
const speed = (kmh: number): Q<'speed'> => ({ kind: 'speed', kmh })
const loadOf = (g: number): Q<'load'> => ({ kind: 'load', g })
const temp = (c: number): Q<'temp'> => ({ kind: 'temp', c })
const day = (iso: string): Q<'date'> => ({ kind: 'date', iso, style: 'weekday' })
const weekOf = (iso: string): Q<'date'> => ({ kind: 'date', iso, style: 'short' })

const newestFirst = (a: SourceRef, b: SourceRef) =>
  b.date.localeCompare(a.date) || a.id.localeCompare(b.id)

/** The sources a fact lists (newest first, at most `EXPLAIN_MAX_SOURCES`) and how many were left out. */
function listed(sources: readonly SourceRef[]): { sources: SourceRef[]; moreSources: number } {
  const unique = new Map<string, SourceRef>()
  for (const source of sources) unique.set(`${source.kind}:${source.id}`, source)
  const sorted = [...unique.values()].sort(newestFirst)
  return {
    sources: sorted.slice(0, EXPLAIN_MAX_SOURCES),
    moreSources: Math.max(0, sorted.length - EXPLAIN_MAX_SOURCES),
  }
}

/**
 * One fact from a template id and slots that something else already checked: the reasons of a
 * strength suggestion are built by the engine (`fact` in `strength.ts`, typed there) and stored on
 * the workout as data, and a test renders each of them.
 */
function rawFact(
  rule: string,
  name: string,
  template: string,
  slots: Readonly<Record<string, Quantity | string>>,
  extras: FactExtras = {},
): InputFact {
  const fact: InputFact = {
    id: `${rule.toLowerCase()}.${name}`,
    template,
    slots: { ...slots },
    rule,
    ...listed(extras.sources ?? []),
    state: extras.insufficient === true ? 'insufficient' : 'used',
  }
  if (extras.window !== undefined) fact.window = { ...extras.window }
  return fact
}

/** One fact. `name` makes the id unique within the rule; `slots` are checked against the template. */
function make<K extends TemplateId>(
  rule: string,
  name: string,
  template: K,
  slots: SlotsOf<K>,
  extras: FactExtras = {},
): InputFact {
  return rawFact(rule, name, template, slots, extras)
}

/** A gap sentence for `rule`: the data it needs is missing. */
function gap<K extends TemplateId>(
  rule: string,
  template: K,
  slots: SlotsOf<K>,
  extras: Omit<FactExtras, 'insufficient'> = {},
): InputFact {
  return make(rule, 'gap', template, slots, { ...extras, insufficient: true })
}

const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function activitySource(a: Activity): SourceRef {
  return {
    kind: 'activity',
    id: a.id,
    date: a.date,
    label: titleCase(a.type),
    ...(a.distanceM !== null ? { distanceM: a.distanceM } : {}),
  }
}

// The fact constructor and the quantity helpers, shared with the run insights (`standout.ts`) and
// the weekly brief (`brief.ts`).
export {
  activitySource,
  bpm,
  checkinSource,
  climb,
  count,
  day,
  distance,
  duration,
  exact,
  make,
  minutes,
  percent,
}

const profileSource = (ctx: ExplainContext): SourceRef => ({
  kind: 'profile',
  id: 'profile',
  date: ctx.asOf,
  label: 'Profile',
})

const checkinSource = (date: string): SourceRef => ({
  kind: 'check-in',
  id: date,
  date,
  label: 'Check-in',
})

const wellnessSource = (date: string): SourceRef => ({
  kind: 'wellness',
  id: date,
  date,
  label: 'Wellness',
})

/** The window of the last `days` days, today included. */
const lastDays = (ctx: ExplainContext, days: number) => ({
  from: addDays(ctx.asOf, -(days - 1)),
  to: ctx.asOf,
})

/** The counted activities up to the day, as `estimateState` reads them. */
function countedUpTo(ctx: ExplainContext): Activity[] {
  return ctx.input.activities.filter((a) => !isDuplicate(a) && a.date <= ctx.asOf)
}

const countedRuns = (ctx: ExplainContext): Activity[] =>
  countedUpTo(ctx).filter((a) => a.type === 'run' || a.type === 'race')

// ---------------------------------------------------------------------------------------------
// A3 and g-1: the longest recent run
// ---------------------------------------------------------------------------------------------

/** The run in `runs` with this value of `pick`, the latest when several share it. */
function runWith(runs: Activity[], pick: (a: Activity) => number | null, value: number) {
  return runs
    .filter((a) => pick(a) === value)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))[0]
}

function longestRunFacts(rule: string, scope: Scope): InputFact[] {
  const { ctx, session } = scope
  const days = P.a3.longestRunWindowDays.value
  const window = lastDays(ctx, days)
  const longest = ctx.state.longest30d
  if (longest.distanceM <= 0 && longest.durationSec <= 0) {
    return [gap(rule, 'explain.longest-gap', { days: count(days) }, { window })]
  }
  const runs = countedRuns(ctx).filter((a) => a.date >= window.from && countsTowardReference(a))
  const facts: InputFact[] = []
  if (longest.distanceM > 0) {
    const run = runWith(runs, (a) => a.distanceM, longest.distanceM)
    facts.push(
      make(
        rule,
        'longest-distance',
        'explain.longest-distance',
        {
          days: count(days),
          distance: distance(longest.distanceM),
          date: day(run?.date ?? ctx.asOf),
        },
        { sources: run ? [activitySource(run)] : [], window },
      ),
    )
  }
  if (longest.durationSec > 0) {
    const run = runWith(runs, (a) => a.durationSec, longest.durationSec)
    facts.push(
      make(
        rule,
        'longest-duration',
        'explain.longest-duration',
        {
          days: count(days),
          duration: duration(longest.durationSec),
          date: day(run?.date ?? ctx.asOf),
        },
        { sources: run ? [activitySource(run)] : [], window },
      ),
    )
  }
  if (rule === 'g-1' && longest.distanceM > 0) {
    const warn = spikeWarnLimit(longest.distanceM, P.g1.minStepDistanceM.value)
    const override = spikeOverrideLimit(longest.distanceM, P.g1.minStepDistanceM.value)
    facts.push(
      make(rule, 'warn', 'explain.g1-warn', { limit: distance(warn) }),
      make(rule, 'override', 'explain.g1-override', { limit: distance(override) }),
    )
    if (session?.distanceM != null && session.distanceM > 0) {
      facts.push(
        make(
          rule,
          'session',
          'explain.g1-session',
          { share: share(Math.round((session.distanceM / longest.distanceM) * 100) / 100) },
          { sources: [{ kind: 'session', id: session.id, date: session.date, label: 'Session' }] },
        ),
      )
    }
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// g-2 and g-6: the weekly ramp, and lost volume is not made up
// ---------------------------------------------------------------------------------------------

function weekRuns(ctx: ExplainContext, weekStart: string): Activity[] {
  const end = addDays(weekStart, 6)
  return countedRuns(ctx).filter((a) => a.date >= weekStart && a.date <= end)
}

const weekWindow = (weekStart: string) => ({ from: weekStart, to: addDays(weekStart, 6) })

function plannedWeek(ctx: ExplainContext, weekStart: string) {
  return ctx.input.existing?.weeks.find((w) => w.weekStart === weekStart) ?? null
}

/**
 * The running minutes of a week as the weekly decision counts them: the plain weekly total. A
 * ladder or injury-return week credits less in `weekEvidence`, which the start paths read, so
 * that figure would not be the one the decision's completion share and cap came from.
 */
function decisionRunMin(ctx: ExplainContext, weekStart: string): number {
  return aggregateWeeks(ctx.input.activities, [weekStart])[0]!.runMin
}

/**
 * The input the load setting is read from [rules g-8]: the plan's own goal and options, so that
 * the position, the zone and the response are the ones the Plan page shows and the next re-plan
 * applies (`loadPlanWithSessions`). A held reason depends on the goal race, which the neutral goal
 * of `input` does not carry.
 */
const loadInputOf = (ctx: ExplainContext): EngineInput => ctx.planInput ?? ctx.input

function weeklyRampFacts(scope: Scope): InputFact[] {
  const { ctx, last, next } = scope
  if (!ctx.state.weeks.some((w) => w.runMin > 0 || w.raceMin > 0)) {
    return [gap('g-2', 'explain.g2-gap', { weeks: count(ctx.state.weeks.length) })]
  }
  const ran = aggregateWeeks(
    ctx.input.activities.filter((a) => !isDuplicate(a)),
    [last],
  )[0]!
  const facts = [
    make(
      'g-2',
      'last-week',
      'explain.g2-last-week',
      { week: weekOf(last), minutes: minutes(ran.runMin) },
      { sources: weekRuns(ctx, last).map(activitySource), window: weekWindow(last) },
    ),
    // "at most": under the rebuild zone of a plan at standard or upper [rules g-8] a week under its
    // ceiling may add the zone's step, which is more than the usual one
    make('g-2', 'ramp', 'explain.g2-ramp', {
      pct: stepPercent(
        Math.max(weeklyRamp(ctx.state), rebuildZone(loadInputOf(ctx), ctx.state)?.step ?? 0),
      ),
    }),
  ]
  const planned = plannedWeek(ctx, next)
  if (planned !== null) {
    // A week set at no running (a rest window, the rest after a race) is not "up to 0 min".
    const none = Math.round(planned.targetRunMin) <= 0
    facts.push(
      none
        ? make(
            'g-2',
            'plan-week',
            'explain.g2-plan-week-none',
            { week: weekOf(next) },
            { window: weekWindow(next) },
          )
        : make(
            'g-2',
            'plan-week',
            'explain.g2-plan-week',
            { week: weekOf(next), minutes: minutes(planned.targetRunMin) },
            { window: weekWindow(next) },
          ),
    )
  }
  return facts
}

function lostVolumeFacts(scope: Scope): InputFact[] {
  const { ctx, last, next } = scope
  const evidence = weekEvidence(ctx.input, last)
  // A week planned at no minutes was not planned to run: "ran 25 min of 0 min planned" is no
  // sentence, so it reads as a week with nothing planned to compare with.
  if (evidence.plannedMin === null || Math.round(evidence.plannedMin) <= 0) {
    return [gap('g-6', 'explain.g6-gap', { week: weekOf(last) }, { window: weekWindow(last) })]
  }
  const actual = decisionRunMin(ctx, last)
  const facts = [
    make(
      'g-6',
      'completion',
      'explain.g6-completion',
      {
        week: weekOf(last),
        actual: minutes(actual),
        planned: minutes(evidence.plannedMin),
      },
      { sources: weekRuns(ctx, last).map(activitySource), window: weekWindow(last) },
    ),
  ]
  // The decision caps the week from the minutes it was planned at; a week already run past its
  // target is stored at the minutes run and carries the planned ones (`plannedMinOf`).
  const nextWeek = plannedWeek(ctx, next)
  const target = nextWeek === null ? undefined : plannedMinOf(nextWeek)
  if (target !== undefined) {
    const ramp = weeklyRamp(ctx.state)
    // under the rebuild zone [rules g-8] the cap grows by the zone's step, as the decision does
    const rebuild = rebuildZone(loadInputOf(ctx), ctx.state)
    const cap = wholeMinutes(nextWeekCap(target, actual, ramp, rebuild))
    const grown =
      rebuild !== null && actual > 0 ? rebuildStep(actual, ramp, false, rebuild) / actual - 1 : ramp
    // A cap of zero minutes (a week with nothing planned, or nothing run before it) is no
    // sentence: "capped at 0 min" says nothing the completion line does not.
    if (cap > 0) {
      facts.push(
        make(
          'g-6',
          'cap',
          'explain.g6-cap',
          { week: weekOf(next), minutes: minutes(cap), pct: stepPercent(grown) },
          { window: weekWindow(next) },
        ),
      )
    }
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// g-8: the history-informed rebuild
// ---------------------------------------------------------------------------------------------

/** "four steady weeks": the block's length from its Param, in words up to ten. */
const blockPhrase = () => countPhrase(P.g8.blockWeeks.value, 'steady week')

/**
 * The response to weeks run above plan, when it lifts the next loading week of the stored plan
 * [rules g-8]: the mean of the minutes run in the last `g8.responseWeeks` eligible weeks against
 * the planned baseline that week is stepped from, and the baseline it builds from, which is the
 * mean up to the two-week ceiling over the planned baseline. A re-plan carries the loading
 * sequence on from the minutes the current week was planned at (from the last loading week before
 * it, when this one is a recovery week), and the response lifts that baseline when the mean is
 * higher (`responseBaseline`), so the planned baseline is read from the stored plan's weeks and not
 * from the weeks as run, which only bound the week (`rampLimits`). Nothing when the response is off
 * (steady, a held setting, a plan that restarts, a newest week run under its target), has no mean,
 * has no loading week ahead, or does not pass the planned baseline.
 */
function responseFacts(ctx: ExplainContext): InputFact[] {
  const input = loadInputOf(ctx)
  const basis = responseBasis(input, ctx.state)
  const mean = basis?.meanMin ?? null
  if (mean === null || input.existing === null) return []
  const currentMonday = mondayOf(input.today)
  const stored = [...input.existing.weeks].sort((a, b) =>
    a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0,
  )
  const current = stored.find((w) => w.weekStart === currentMonday)
  // The anchor is the generator's `replanAnchor` (macro.ts) without its step cap: the current week
  // of the stored plan, or the last loading week before it when the current one is a recovery
  // week. `replanAnchor` returns minutes held to the step the recent weeks allow, and the fact
  // states the planned ones, so the rule is repeated here and not called.
  const anchor =
    current === undefined || current.isTaper || current.phase === 'race'
      ? undefined
      : current.isRecovery
        ? stored.filter((w) => w.weekStart < currentMonday && isLoadingWeek(w)).at(-1)
        : current
  const next = stored.find((w) => w.weekStart > currentMonday && isLoadingWeek(w))
  if (anchor === undefined || next === undefined) return []
  const planned = plannedMinOf(anchor)
  const from = responseBaseline(planned, basis, noviceRamp(ctx.state))
  if (Math.round(from) <= Math.round(planned)) return []
  return [
    make(
      'g-8',
      'response',
      'explain.g8-response',
      {
        n: count(P.g8.responseWeeks.value),
        mean: minutes(mean),
        planned: minutes(planned),
        from: minutes(from),
      },
      { window: weekWindow(next.weekStart) },
    ),
  ]
}

/**
 * The history block the plan read, the zone it sets, the load setting and why it holds, the
 * response to weeks run above plan, and the limits that stay [rules g-8]. The block is stated
 * whatever the setting, as the figure the engine read; the zone, the held and capped lines and
 * the response only when they apply.
 */
function rebuildFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { state } = ctx
  const input = loadInputOf(ctx)
  const load = loadPosition(input, state)
  // the block the zone reads: a plan being continued keeps the one it opened with (`zoneBlock`)
  const credited = zoneBlock(input, state)
  const zone = rebuildZone(input, state)
  const facts: InputFact[] = []
  if (credited !== null) {
    const { block } = credited
    const window = {
      from: addDays(block.endWeek, -7 * (P.g8.blockWeeks.value - 1)),
      to: addDays(block.endWeek, 6),
    }
    const runs = countedRuns(ctx).filter(
      (a) => a.type === 'run' && a.date >= window.from && a.date <= window.to,
    )
    facts.push(
      make(
        'g-8',
        'block',
        'explain.g8-block',
        {
          blocks: titleCase(blockPhrase()),
          ago: countPhrase(daysBetween(block.endWeek, mondayOf(input.today)) / 7, 'week'),
          minutes: minutes(block.blockMin),
        },
        { sources: runs.map(activitySource), window },
      ),
    )
    if (credited.keptSince !== null) {
      // the share is the one found at the plan's first Monday, so no line of its own for it
      if (zone !== null) {
        facts.push(
          make('g-8', 'kept', 'explain.g8-kept', {
            share: share(block.taper),
            minutes: minutes(zone.ceilingMin),
          }),
        )
      }
    } else if (block.taper < 1) {
      facts.push(
        make('g-8', 'taper', 'explain.g8-taper', {
          weeks: count(block.weeksAgo),
          share: share(block.taper),
        }),
      )
    }
  }
  if (zone !== null) {
    facts.push(
      make('g-8', 'zone', 'explain.g8-zone', {
        minutes: minutes(zone.ceilingMin),
        pct: stepPercent(zone.step),
        soft: stepPercent(P.g2.rampSoft.value),
      }),
    )
  }
  facts.push(make('g-8', 'setting', 'explain.g8-setting', { position: loadName(load.requested) }))
  if (load.held !== null) {
    facts.push(make('g-8', 'held', 'explain.g8-held', { reason: loadHoldReason(load.held) }))
  }
  if (load.ageCapped) {
    facts.push(
      make('g-8', 'capped', 'explain.g8-capped', { age: count(P.a9.noviceFlagAgeMin.value) }),
    )
  }
  facts.push(...responseFacts(ctx))
  if (credited === null) {
    facts.push(
      gap('g-8', 'explain.g8-none', {
        blocks: blockPhrase(),
        weeks: count(P.g8.creditTaperEndWeeks.value),
      }),
    )
  }
  facts.push(
    make('g-8', 'limits', 'explain.g8-limits', {
      days: count(P.g1.windowDays.value),
      pct: percent(P.g2.rampCeilingTwoWeeks.value * 100),
      span: countPhrase(P.g2.ceilingWindowWeeks.value, 'week'),
    }),
  )
  return facts
}

// ---------------------------------------------------------------------------------------------
// A2, A5, A6, A7, A8: the athlete state
// ---------------------------------------------------------------------------------------------

export const LOAD_METRIC_WORDS: Record<AthleteState['load']['metric'], string> = {
  srpe: 'session effort',
  trimp: 'heart-rate load',
  minutes: 'minutes of running',
}

function loadFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const chronicDays = P.a2.chronicDays.value
  const window = lastDays(ctx, chronicDays)
  const inWindow = countedUpTo(ctx).filter((a) => a.date >= window.from)
  if (inWindow.length === 0) {
    return [gap('A2', 'explain.a2-gap', { days: count(chronicDays) }, { window })]
  }
  const { acute, chronic, metric } = ctx.state.load
  return [
    make(
      'A2',
      'load',
      'explain.a2-load',
      {
        acuteDays: count(P.a2.acuteDays.value),
        acute: count(acute),
        chronicDays: count(chronicDays),
        chronic: count(chronic),
        metric: LOAD_METRIC_WORDS[metric],
      },
      { sources: inWindow.map(activitySource), window },
    ),
  ]
}

function lastRunFact(rule: string, ctx: ExplainContext): InputFact | null {
  const { lastRunDate, layoffDays } = ctx.state
  if (lastRunDate === null) return null
  const run = countedRuns(ctx)
    .filter((a) => a.date === lastRunDate)
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  return make(
    rule,
    'last-run',
    'explain.last-run',
    { date: day(lastRunDate), days: count(layoffDays) },
    { sources: run ? [activitySource(run)] : [] },
  )
}

function experienceFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { state, input } = scope.ctx
  const facts = [
    make(
      'A5',
      'class',
      'explain.a5-class',
      { experience: state.experience },
      {
        sources: [profileSource(ctx)],
      },
    ),
  ]
  const lastRun = lastRunFact('A5', ctx)
  if (lastRun !== null) facts.push(lastRun)
  if (state.weeks.length > 0) {
    facts.push(
      make('A5', 'weeks', 'explain.a5-weeks', {
        n: count(state.weeks.filter((w) => w.runMin > 0 || w.raceMin > 0).length),
        weeks: count(state.weeks.length),
      }),
    )
  }
  if (input.profile.runningSinceYear !== null) {
    facts.push(
      make(
        'A5',
        'years',
        'explain.a5-years',
        { year: String(input.profile.runningSinceYear) },
        { sources: [profileSource(ctx)] },
      ),
    )
  }
  if (state.lastRunDate === null && state.yearsRunning === null) {
    facts.push(gap('A5', 'explain.a5-gap', { days: count(P.a5.historyWindowDays.value) }))
  }
  return facts
}

/** Why critical speed is missing, as a gap sentence for `rule`. */
function csGap(rule: string, ctx: ExplainContext, efforts: ReturnType<typeof csEffortsOf>) {
  const sources = efforts.map((e) => activitySource(e.activity))
  const window = lastDays(ctx, P.a6.csWindowDays.value)
  if (efforts.length >= P.a6.csMinEfforts.value) {
    return gap(
      rule,
      'explain.cs-spread-gap',
      { found: count(efforts.length), ratio: exact(P.a6.csMinTimeSpreadRatio.value) },
      { sources, window },
    )
  }
  return gap(
    rule,
    'explain.cs-gap',
    {
      need: count(P.a6.csMinEfforts.value),
      from: distance(P.a6.csMinDistanceM.value),
      to: distance(P.a6.csMaxDistanceM.value),
      days: count(P.a6.csWindowDays.value),
      found: count(efforts.length),
    },
    { sources, window },
  )
}

function fitnessFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const efforts = csEffortsOf(countedRuns(ctx), ctx.asOf)
  const cs = ctx.state.fitness.csMps
  if (cs === null) return [csGap('A6', ctx, efforts)]
  return [
    make(
      'A6',
      'cs',
      'explain.a6-cs',
      {
        speed: speed(cs * 3.6),
        pace: pace(1000 / cs),
        n: count(efforts.length),
        days: count(P.a6.csWindowDays.value),
      },
      {
        sources: efforts.map((e) => activitySource(e.activity)),
        window: lastDays(ctx, P.a6.csWindowDays.value),
      },
    ),
  ]
}

function durabilityFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const group = durabilityRuns(countedRuns(ctx))
  const sources = group.map(activitySource)
  const median = ctx.state.durability.decouplingMedianPct
  if (median === null) {
    return [
      gap(
        'A7',
        'explain.a7-gap',
        {
          need: count(P.a7.minComparableRuns.value),
          temp: temp(P.a7.heatExcludeC.value),
          found: count(group.length),
        },
        { sources },
      ),
    ]
  }
  return [
    make(
      'A7',
      'drift',
      'explain.a7-drift',
      { n: count(group.length), pct: percent(median) },
      {
        sources,
      },
    ),
  ]
}

function efficiencyFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { recent, prior } = efficiencySamples(countedUpTo(ctx), ctx.asOf)
  const sources = recent.map((s) => activitySource(s.activity))
  const days = (P.a8.recentWeeks.value + P.a8.priorWeeks.value) * 7
  const window = lastDays(ctx, days)
  const trend = ctx.state.efficiency.trendPct
  const facts: InputFact[] = []
  if (trend === null) {
    facts.push(
      gap(
        'A8',
        'explain.a8-gap',
        {
          need: count(P.a8.minRunsPerWindow.value),
          from: minutes(P.a8.minDurationMin.value),
          to: minutes(P.a8.maxDurationMin.value),
          recent: count(recent.length),
          prior: count(prior.length),
        },
        { sources, window },
      ),
    )
  } else {
    facts.push(
      make(
        'A8',
        'trend',
        trend >= 0 ? 'explain.a8-up' : 'explain.a8-down',
        { pct: percent(Math.abs(trend)) },
        { sources, window },
      ),
    )
  }
  const model = ctx.hrModel
  const easyPace = ctx.zones.lt1PaceSecPerKm
  if (model !== null && easyPace !== null) {
    const mps = 1000 / easyPace.value
    facts.push(
      make(
        'A8',
        'hr-model',
        'explain.a8-hr-model',
        {
          pace: pace(easyPace.value),
          bpm: bpm(model.interceptBpm + model.slopeBpmPerMps * mps),
          n: count(model.runs),
        },
        { window: lastDays(ctx, P.hrModel.windowWeeks.value * 7) },
      ),
    )
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// C1 to C5: zones and thresholds
// ---------------------------------------------------------------------------------------------

const ZONE_NUMBER = { z1: 1, z2: 2, z3: 3 } as const
const NO_TARGET_KINDS: ReadonlySet<string> = new Set(['strength', 'mobility', 'rest'])

/** The session's targets, from the same resolver every surface reads (`resolveTargets`). */
function targetFacts(rule: string, session: SessionRow, zones: ZoneSet): InputFact[] {
  if (NO_TARGET_KINDS.has(session.kind)) return []
  const t = resolveTargets(session, zones, { hot: false })
  const facts: InputFact[] = []
  const sources: SourceRef[] = [
    { kind: 'session', id: session.id, date: session.date, label: 'Session' },
  ]
  if (t.mode === 'hr-ceiling' && t.hrCeiling !== null) {
    facts.push(
      make(rule, 'target', 'explain.c1-target-ceiling', { bpm: bpm(t.hrCeiling) }, { sources }),
    )
  } else if (t.mode === 'hr-band' && t.hrRange !== null && t.zone in ZONE_NUMBER) {
    facts.push(
      make(
        rule,
        'target',
        'explain.c1-target-band',
        {
          low: bpm(t.hrRange[0]),
          high: bpm(t.hrRange[1]),
          zone: count(ZONE_NUMBER[t.zone as keyof typeof ZONE_NUMBER]),
        },
        { sources },
      ),
    )
  } else if (t.mode === 'pace' && t.paceSecPerKm !== null) {
    facts.push(
      make(
        rule,
        'target',
        'explain.c1-target-pace',
        { slow: pace(t.paceSecPerKm[0]), fast: pace(t.paceSecPerKm[1]) },
        { sources },
      ),
    )
  } else {
    facts.push(
      make(
        rule,
        'target',
        'explain.c1-target-effort',
        { low: count(t.rpe[0]), high: count(t.rpe[1]) },
        { sources },
      ),
    )
  }
  if (t.mode !== 'effort') {
    facts.push(
      make(rule, 'rpe', 'explain.c1-target-rpe', { low: count(t.rpe[0]), high: count(t.rpe[1]) }),
    )
    if (t.mode !== 'pace' && t.paceSecPerKm !== null) {
      facts.push(
        make(rule, 'pace-guide', 'explain.c1-pace-guide', {
          slow: pace(t.paceSecPerKm[0]),
          fast: pace(t.paceSecPerKm[1]),
        }),
      )
    }
  }
  return facts
}

function zoneFacts(scope: Scope): InputFact[] {
  const { ctx, session } = scope
  const facts = session === null ? [] : targetFacts('C1', session, ctx.zones)
  const hr = ctx.zones.hr
  if (hr === null) return [...facts, gap('C1', 'explain.c1-gap', {})]
  facts.push(
    make(
      'C1',
      'zones-hr',
      'explain.c1-zones-hr',
      { z1: bpm(hr.z1[1]), z2: bpm(hr.z2[1]), z3: bpm(hr.z3[1]) },
      { sources: [profileSource(ctx)] },
    ),
  )
  return facts
}

export const ANCHOR_WORDS: Record<Boundary['source'], string> = {
  tested: 'a test',
  cs: 'your critical speed',
  dfa: 'a heart-rate-variability reading',
  rpe: 'your effort ratings',
  'hrmax-observed': 'a measured maximum heart rate',
  'hrmax-age': 'your age',
  hrr: 'your heart-rate reserve',
  profile: 'your profile',
}

function anchorFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { zones } = ctx
  const efforts = csEffortsOf(countedRuns(ctx), ctx.asOf).map((e) => activitySource(e.activity))
  const anchors: Array<[string, string, Boundary | null]> = [
    ['hrmax', 'maximum heart rate', zones.hrMax],
    ['lt1-hr', 'heart rate at the line between zones 1 and 2', zones.lt1Hr],
    ['lt1-pace', 'pace at the line between zones 1 and 2', zones.lt1PaceSecPerKm],
    ['threshold-pace', 'threshold pace', zones.thresholdPaceSecPerKm],
    ['cs', 'critical speed', zones.csMps],
  ]
  const facts = anchors.flatMap(([name, anchor, boundary]) => {
    if (boundary === null) return []
    const date = day(isIsoDate(boundary.asOf) ? boundary.asOf : ctx.asOf)
    // Critical speed is the fit itself: "comes from your critical speed" would explain it by itself.
    if (name === 'cs') return [make('C2', name, 'explain.c2-cs', { date }, { sources: efforts })]
    return [
      make(
        'C2',
        name,
        'explain.c2-anchor',
        { anchor, source: ANCHOR_WORDS[boundary.source], date },
        { sources: boundary.source === 'cs' ? efforts : [profileSource(ctx)] },
      ),
    ]
  })
  return facts.length > 0 ? facts : [gap('C2', 'explain.c2-gap', {})]
}

function maxHeartRateFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const hrMax = ctx.zones.hrMax
  if (hrMax === null) return [gap('C3', 'explain.c3-gap', {})]
  const sources = [profileSource(ctx)]
  const value = { bpm: bpm(hrMax.value) }
  if (hrMax.source === 'hrmax-observed') {
    return [make('C3', 'hrmax', 'explain.c3-measured', value, { sources })]
  }
  if (hrMax.source === 'profile') {
    return [make('C3', 'hrmax', 'explain.c3-profile', value, { sources })]
  }
  return [
    make(
      'C3',
      'hrmax',
      'explain.c3-age',
      { ...value, band: bpm(P.c3.priorBandBpm.value) },
      { sources },
    ),
  ]
}

/** The gap for a pace anchor that is missing: a break cleared it, or critical speed lacks efforts. */
function paceAnchorGap(rule: string, ctx: ExplainContext): InputFact {
  const afterBreak = ctx.state.layoffDays >= P.c8.breakDays.value
  const hadAnchor =
    ctx.state.fitness.csMps !== null || ctx.input.profile.thresholdPaceSecPerKm !== null
  if (afterBreak && hadAnchor) {
    return gap(rule, 'explain.c-break-gap', { days: count(P.c8.breakDays.value) })
  }
  return csGap(rule, ctx, csEffortsOf(countedRuns(ctx), ctx.asOf))
}

function lineBetweenZonesFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { zones } = ctx
  const facts: InputFact[] = []
  const lt1 = zones.lt1PaceSecPerKm
  if (lt1 === null) {
    facts.push(paceAnchorGap('C4', ctx))
  } else if (lt1.source === 'cs') {
    facts.push(
      make(
        'C4',
        'pace',
        'explain.c4-cs',
        { share: share(P.c4.lt1CsFraction.value), pace: pace(lt1.value) },
        {
          sources: csEffortsOf(countedRuns(ctx), ctx.asOf).map((e) => activitySource(e.activity)),
          window: lastDays(ctx, P.a6.csWindowDays.value),
        },
      ),
    )
  } else {
    facts.push(
      make(
        'C4',
        'pace',
        'explain.c4-profile',
        { pace: pace(lt1.value) },
        {
          sources: [profileSource(ctx)],
        },
      ),
    )
  }
  if (zones.lt1Hr !== null) {
    facts.push(
      make(
        'C4',
        'hr',
        'explain.c4-hr',
        { bpm: bpm(zones.lt1Hr.value) },
        {
          sources: [profileSource(ctx)],
        },
      ),
    )
  }
  return facts
}

function thresholdFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const threshold = ctx.zones.thresholdPaceSecPerKm
  if (threshold === null) return [paceAnchorGap('C5', ctx)]
  if (threshold.source === 'profile') {
    return [
      make(
        'C5',
        'threshold',
        'explain.c5-profile',
        { pace: pace(threshold.value) },
        {
          sources: [profileSource(ctx)],
        },
      ),
    ]
  }
  const margin =
    ctx.state.experience === 'trained'
      ? P.c5.thresholdMarginWellTrainedKmh.value
      : P.c5.thresholdMarginOtherKmh.value
  return [
    make(
      'C5',
      'threshold',
      'explain.c5-cs',
      { pace: pace(threshold.value), margin: speed(margin) },
      {
        sources: csEffortsOf(countedRuns(ctx), ctx.asOf).map((e) => activitySource(e.activity)),
        window: lastDays(ctx, P.a6.csWindowDays.value),
      },
    ),
  ]
}

// ---------------------------------------------------------------------------------------------
// J2 to J5, J7: readiness, the weekly decision and breaks
// ---------------------------------------------------------------------------------------------

function checkinFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const window = lastDays(ctx, EXPLAIN_CHECKIN_DAYS)
  const recent = checkinsOf(ctx.input).filter((c) => c.date >= window.from && c.date <= ctx.asOf)
  if (recent.length === 0) {
    return [gap('J2', 'explain.j2-gap', { days: count(EXPLAIN_CHECKIN_DAYS) }, { window })]
  }
  const sources = recent.map((c) => checkinSource(c.date))
  const facts = [
    make(
      'J2',
      'checkins',
      'explain.j2-checkins',
      { n: count(recent.length), days: count(EXPLAIN_CHECKIN_DAYS) },
      { sources, window },
    ),
  ]
  const low = recent.filter(poorSubjective)
  if (low.length > 0) {
    facts.push(
      make(
        'J2',
        'low',
        'explain.j2-low',
        { n: count(low.length) },
        { sources: low.map((c) => checkinSource(c.date)), window },
      ),
    )
  }
  return facts
}

function downgradeFacts(scope: Scope): InputFact[] {
  const { readiness } = scope.ctx
  const date = day(readiness.date)
  if (readiness.checkin === null && readiness.hrv.readings === 0 && readiness.sleepAvgH === null) {
    return [gap('J3', 'explain.j3-gap', { date })]
  }
  const sources = readiness.checkin === null ? [] : [checkinSource(readiness.date)]
  switch (readiness.state) {
    case 'normal':
      return [make('J3', 'state', 'explain.j3-normal', { date }, { sources })]
    case 'possible-fatigue':
      return [make('J3', 'state', 'explain.j3-fatigue', { date }, { sources })]
    case 'persistent-suppression':
      return [
        make(
          'J3',
          'state',
          'explain.j3-suppression',
          { days: count(P.j8.deloadSuggestDays.value), date },
          { sources },
        ),
      ]
  }
}

function hrvFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { hrv, date } = ctx.readiness
  const window = lastDays(ctx, hrv.lookbackDays)
  if (hrv.baselineMean === null || hrv.baselineSd === null) {
    // The engine tests the earlier readings, not today's own, against the minimum, and reads
    // them over the lookback of the profile (longer for a female profile).
    return [
      gap(
        'J4',
        'explain.j4-gap',
        {
          need: count(P.j4.minReadings.value),
          days: count(hrv.lookbackDays),
          found: count(hrv.baseline),
        },
        { window },
      ),
    ]
  }
  if (hrv.latest === null)
    return [gap('J4', 'explain.j4-today-gap', { date: day(date) }, { window })]
  // The readiness read stores ln rMSSD; the sentence is in milliseconds, as on Today.
  const band = P.j4.sdBelowMean.value * hrv.baselineSd
  return [
    make(
      'J4',
      'reading',
      hrv.flag ? 'today.signal.hrv-low' : 'today.signal.hrv',
      {
        latest: count(Math.exp(hrv.latest)),
        low: count(Math.exp(hrv.baselineMean - band)),
        high: count(Math.exp(hrv.baselineMean + band)),
      },
      { sources: [wellnessSource(date)], window },
    ),
  ]
}

/** The decision's signals that name a state of the runner without a figure to restate. */
export const SIGNAL_WORDS: Readonly<Record<string, string>> = {
  'subjective-decline': 'lower check-in scores or sessions that felt harder than expected',
  'efficiency-decline': 'a fall in efficiency on steady runs',
  'sleep-efficiency-drop': 'a drop in sleep efficiency',
  illness: 'a day of illness',
  pain: 'pain at the level the plan stops for',
  'pain-mild': 'mild pain',
  'persistent-suppression': 'readiness signals that stayed low for a long time',
  'readiness-flag': 'readiness flags on several days',
  'hrv-suppressed': 'HRV that stayed below your usual range',
  heat: 'the first hot days of the season',
  'completion-low': 'less running than planned so far',
  'sleep-warning': 'short sleep',
  disruption: 'days covered by a rest window',
}
const SIGNAL_FALLBACK_WORDS = 'a sign the plan watches'
const POST_RACE_SIGNALS: ReadonlySet<string> = new Set(['post-race-stage', 'post-race-delayed'])

function decisionFacts(scope: Scope): InputFact[] {
  const { ctx, last } = scope
  const decision = ctx.decision
  const window = weekWindow(last)
  if (decision === null) {
    return [gap('J5', 'explain.j5-gap', { week: weekOf(last) }, { window })]
  }
  const weekEnd = addDays(last, 6)
  const finished = ctx.asOf > weekEnd
  const readAt = finished ? weekEnd : ctx.asOf
  const facts: InputFact[] = []
  if (decision.postRace !== undefined) {
    facts.push(make('J5', 'post-race', 'explain.j5-post-race', { week: weekOf(last) }, { window }))
  } else {
    // Zero minutes is "no running set", not "up to 0 min": the sentence then leaves the number out.
    if (Math.round(decision.nextWeekTargetMin) <= 0) {
      const bare = {
        progress: 'explain.j5-progress-bare',
        hold: 'explain.j5-hold-bare',
        reduce: 'explain.j5-reduce-bare',
      } as const
      facts.push(
        make('J5', 'decision', bare[decision.decision], { week: weekOf(last) }, { window }),
      )
    } else {
      const slots = { week: weekOf(last), minutes: minutes(decision.nextWeekTargetMin) }
      const template = {
        progress: 'explain.j5-progress',
        hold: 'explain.j5-hold',
        reduce: 'explain.j5-reduce',
      } as const
      facts.push(make('J5', 'decision', template[decision.decision], slots, { window }))
    }
  }
  const evidence = weekEvidence(ctx.input, last)
  const sleep = sleepAverageH(ctx.input, readAt)
  for (const signal of decision.signals) {
    if (POST_RACE_SIGNALS.has(signal.code)) continue
    const name = `signal-${signal.code}`
    if (
      signal.code === 'completion-low' &&
      finished &&
      evidence.plannedMin !== null &&
      evidence.plannedMin > 0
    ) {
      facts.push(
        make(
          'J5',
          name,
          'explain.j5-completion',
          {
            actual: minutes(decisionRunMin(ctx, last)),
            planned: minutes(evidence.plannedMin),
            share: share(P.j5.completionHoldShare.value),
          },
          { sources: weekRuns(ctx, last).map(activitySource), window },
        ),
      )
      continue
    }
    if (signal.code === 'sleep-warning' && sleep !== null) {
      facts.push(
        make(
          'J5',
          name,
          'today.signal.sleep-low',
          {
            hours: duration(sleep * 3600),
            nights: count(P.j5.sleepWarnNights.value),
            floor: duration(P.j5.sleepWarnHours.value * 3600),
          },
          { window },
        ),
      )
      continue
    }
    if (signal.code === 'reds') {
      facts.push(
        make(
          'J5',
          name,
          'explain.j5-reds',
          { n: count(ctx.input.screeningFlags ?? 0) },
          { window },
        ),
      )
      continue
    }
    facts.push(
      make(
        'J5',
        name,
        'explain.j5-signal',
        { sign: SIGNAL_WORDS[signal.code] ?? SIGNAL_FALLBACK_WORDS },
        { window },
      ),
    )
  }
  return facts
}

function breakFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const lastRun = lastRunFact('J7', ctx)
  if (lastRun === null) return [gap('J7', 'explain.j7-gap', {})]
  const facts = [lastRun]
  if (ctx.state.layoffDays >= P.j7.tier1Days.value) {
    facts.push(
      make('J7', 'restart', 'explain.j7-restart', {
        share: share(breakRestart(ctx.state.layoffDays, 0).fraction),
      }),
    )
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// L1 to L6: the prediction
// ---------------------------------------------------------------------------------------------

export const METHOD_WORDS: Readonly<Record<string, string>> = {
  'personal-exponent': 'a personal exponent fitted to your race times',
  riegel: 'a recent race scaled to this distance',
  'same-distance': 'a race at about this distance',
  'single-anchor': 'one shorter race',
  'critical-speed': 'your critical speed',
  'cs-durability': 'your critical speed, adjusted for how well you hold pace',
  'cs-fraction': 'a share of your critical speed for long events',
}

/** "a", "a and b", "a, b and c". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}`
}

function methodsOf(prediction: Prediction): string[] {
  return prediction.method.split('+')
}

/** The methods that scale a race result: only these read the closest race to the goal. */
const RACE_METHODS: ReadonlySet<string> = new Set([
  'personal-exponent',
  'riegel',
  'same-distance',
  'single-anchor',
])

function effectiveDistanceM(goal: NonNullable<ExplainContext['goal']>): number {
  return (goal.distanceM ?? 0) + Math.max(0, goal.gainM ?? 0) * P.l5.gainEquivalentM.value
}

/** The race closest to the target distance on a log scale; a tie goes to the later date. */
function closestRace(ctx: ExplainContext, goal: NonNullable<ExplainContext['goal']>) {
  const target = effectiveDistanceM(goal)
  let best: AthleteState['fitness']['races'][number] | null = null
  let bestGap = Infinity
  for (const race of ctx.state.fitness.races) {
    if (!(race.distanceM > 0) || !(race.timeSec > 0)) continue
    const away = Math.abs(Math.log(race.distanceM / target))
    const tie = Math.abs(away - bestGap) <= 1e-12
    if (away < bestGap - 1e-12 || (tie && best !== null && race.date > best.date)) {
      best = race
      bestGap = away
    }
  }
  return best
}

function modelFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { goal, prediction } = ctx
  if (prediction === null) {
    return [gap('L1', 'explain.l-gap', { need: count(P.a6.csMinEfforts.value) })]
  }
  const basis = joinWords(methodsOf(prediction).map((method) => METHOD_WORDS[method] ?? method))
  const facts = [make('L1', 'basis', 'explain.l1-basis', { basis })]
  // A prediction from critical speed alone (an ultra with no race near its distance) read no race.
  const usesRace = methodsOf(prediction).some((method) => RACE_METHODS.has(method))
  const race = !usesRace || goal === null || goal.distanceM === null ? null : closestRace(ctx, goal)
  if (race !== null) {
    const activity = countedRuns(ctx).find(
      (a) =>
        a.type === 'race' &&
        a.date === race.date &&
        a.distanceM === race.distanceM &&
        a.durationSec === race.timeSec,
    )
    facts.push(
      make(
        'L1',
        'anchor',
        'explain.l1-anchor',
        {
          distance: distance(race.distanceM),
          duration: duration(race.timeSec),
          date: day(race.date),
        },
        { sources: activity ? [activitySource(activity)] : [] },
      ),
    )
  }
  return facts
}

function marathonFacts(scope: Scope): InputFact[] {
  const { goal, prediction, state } = scope.ctx
  const marathonRange =
    goal !== null &&
    goal.distanceM !== null &&
    goal.distanceM > P.d1Class.halfUpperM.value &&
    goal.distanceM <= P.d1.ultraAboveM.value
  if (!marathonRange) return []
  if (prediction === null) return [gap('L2', 'explain.l2-gap', {})]
  const methods = methodsOf(prediction)
  const facts: InputFact[] = []
  if (methods.includes('single-anchor')) {
    facts.push(
      make('L2', 'single', 'explain.l2-single', {
        distance: distance(P.l2.singleAnchorMaxM.value),
        pct: percent(P.l2.singleAnchorSlowdownPct.value),
      }),
    )
  }
  if (methods.includes('cs-durability') && state.durability.decouplingMedianPct !== null) {
    facts.push(
      make('L2', 'drift', 'explain.l2-drift', {
        pct: percent(state.durability.decouplingMedianPct),
      }),
    )
  }
  return facts
}

function covariateFacts(scope: Scope): InputFact[] {
  const { prediction } = scope.ctx
  if (prediction === null) {
    return [gap('L3', 'explain.l3-gap', { min: count(P.l3.minSources.value) })]
  }
  const n = methodsOf(prediction).length
  const facts = [
    make('L3', 'sources', 'explain.l3-sources', {
      n: count(n),
      min: count(P.l3.minSources.value),
    }),
  ]
  if (n < P.l3.minSources.value) {
    facts.push(
      make('L3', 'widened', 'explain.l3-widened', {
        pct: percent(P.l3.singleSourceWideningPct.value),
      }),
    )
  }
  return facts
}

function ultraFacts(scope: Scope): InputFact[] {
  const { goal, prediction } = scope.ctx
  const ultra = goal !== null && goal.distanceM !== null && goal.distanceM > P.d1.ultraAboveM.value
  if (!ultra) return []
  if (prediction === null) return [gap('L4', 'explain.l4-gap', {})]
  return [make('L4', 'band', 'explain.l4-band', { pct: percent(P.l4.ultraMinHalfWidthPct.value) })]
}

function trailFacts(scope: Scope): InputFact[] {
  const { goal, prediction } = scope.ctx
  if (goal === null || goal.distanceM === null) return []
  const gain = Math.max(0, goal.gainM ?? 0)
  const trail = goal.surface === 'trail' || goal.surface === 'mixed'
  if (!trail && gain <= 0) return []
  if (prediction === null) return [gap('L5', 'explain.l5-gap', {})]
  const facts: InputFact[] = []
  if (gain > 0) {
    facts.push(
      make('L5', 'climb', 'explain.l5-climb', {
        gain: climb(gain),
        distance: distance(gain * P.l5.gainEquivalentM.value),
      }),
    )
  }
  if (trail) {
    const gainPerKm = (gain / goal.distanceM) * 1000
    const widening =
      P.l5.trailIntervalWideningPct.value + P.l5.gainWideningPctPerMPerKm.value * gainPerKm
    facts.push(make('L5', 'trail', 'explain.l5-trail', { pct: percent(Math.round(widening)) }))
  }
  return facts
}

function bandFacts(scope: Scope): InputFact[] {
  const { goal, prediction } = scope.ctx
  if (prediction === null) return [gap('L6', 'explain.l6-gap', {})]
  const facts = [
    make('L6', 'range', 'explain.l6-range', {
      predicted: duration(prediction.predictedSec),
      low: duration(prediction.lowSec),
      high: duration(prediction.highSec),
    }),
  ]
  if (goal !== null && goal.distanceM !== null) {
    facts.push(
      make('L6', 'floor', 'explain.l6-floor', {
        pct: percent(rangeLabel({ distanceM: goal.distanceM }).minHalfWidthPct),
      }),
    )
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// A4, A9, B1 to B3, m-age and m-sex: the runner's history and profile
// ---------------------------------------------------------------------------------------------

function consistencyFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const weeks = P.a4.gapWindowWeeks.value
  const window = lastDays(ctx, weeks * 7)
  if (!ctx.state.weeks.some((w) => w.runMin > 0 || w.raceMin > 0)) {
    return [gap('A4', 'explain.a4-gap', { weeks: count(weeks) }, { window })]
  }
  const facts = [
    make(
      'A4',
      'gaps',
      'explain.a4-gaps',
      {
        days: count(P.a4.gapMinDays.value),
        weeks: count(weeks),
        n: count(ctx.state.gaps16w),
      },
      {
        sources: countedRuns(ctx)
          .filter((a) => a.date >= window.from)
          .map(activitySource),
        window,
      },
    ),
  ]
  const since = ctx.input.profile.runningSinceYear
  if (since !== null) {
    facts.push(
      make(
        'A4',
        'years',
        'explain.a5-years',
        { year: String(since) },
        { sources: [profileSource(ctx)] },
      ),
    )
  }
  return facts
}

/** The start flag a profile detail sets, in the runner's words. */
function startFlagWord(flag: string): string {
  if (flag.startsWith('age-')) return 'your age'
  if (flag.startsWith('bmi-')) return 'your height and weight'
  if (flag.startsWith('injury-')) {
    return `an injury in your profile in the last ${String(P.a9.recentInjuryWindowMonths.value)} months`
  }
  if (flag === 'no-running-history') return 'no running history'
  return 'a detail in your profile'
}

function riskFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { risk, age } = ctx.state
  const words = risk.noviceFlags.map(startFlagWord)
  if (risk.priorBsi) words.push('an earlier bone stress injury')
  const facts: InputFact[] = []
  if (words.length > 0) {
    facts.push(
      make(
        'A9',
        'flags',
        'explain.a9-flags',
        { flags: joinWords([...new Set(words)]) },
        { sources: [profileSource(ctx)] },
      ),
    )
  }
  // Age and body mass are flags only when the profile gives them: say so when it does not.
  if (age === null || bmiOf(ctx.input.profile) === null) {
    facts.push(gap('A9', 'explain.a9-gap', {}))
  } else if (words.length === 0) {
    facts.push(make('A9', 'none', 'explain.a9-none', {}, { sources: [profileSource(ctx)] }))
  }
  return facts
}

/** The runs the load metric is chosen from [rules B1, B2]: those of the chronic window of A2. */
function loadWindowRuns(ctx: ExplainContext) {
  const days = P.a2.chronicDays.value
  const window = lastDays(ctx, days)
  return { days, window, runs: countedRuns(ctx).filter((a) => a.date >= window.from) }
}

function ratedFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { days, window, runs } = loadWindowRuns(ctx)
  if (runs.length === 0) return [gap('B1', 'explain.b1-gap', { days: count(days) }, { window })]
  return [
    make(
      'B1',
      'rated',
      'explain.b1-rated',
      {
        n: count(runs.filter((a) => a.rpe !== null).length),
        total: count(runs.length),
        days: count(days),
        share: share(P.b4.metricMinCoverage.value),
      },
      { sources: runs.map(activitySource), window },
    ),
  ]
}

function heartRateLoadFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { days, window, runs } = loadWindowRuns(ctx)
  if (runs.length === 0) return [gap('B2', 'explain.b1-gap', { days: count(days) }, { window })]
  const load = { profile: ctx.input.profile, zones: hrAnchors(ctx.input.profile, ctx.state.age) }
  const usable = runs.filter((a) => sessionLoad(a, load).trimp !== null)
  return [
    make(
      'B2',
      'hr',
      'explain.b2-hr',
      { n: count(usable.length), total: count(runs.length), days: count(days) },
      { sources: runs.map(activitySource), window },
    ),
    make('B2', 'metric', 'explain.b2-metric', {
      metric: LOAD_METRIC_WORDS[ctx.state.load.metric],
    }),
  ]
}

function trimpWeightFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { profile } = ctx.input
  const anchors = hrAnchors(profile, ctx.state.age)
  if (anchors.hrMax === null || anchors.hrRest === null) {
    return [gap('B3', 'explain.b3-gap', {})]
  }
  const { metric } = ctx.state.load
  if (metric !== 'trimp') {
    return [make('B3', 'unused', 'explain.b3-unused', { metric: LOAD_METRIC_WORDS[metric] })]
  }
  const sources = [profileSource(ctx)]
  return profile.sex === 'female' || profile.sex === 'male'
    ? [make('B3', 'sex', 'explain.b3-sex', { sex: profile.sex }, { sources })]
    : [make('B3', 'default', 'explain.b3-default', {}, { sources })]
}

function sexFacts(scope: Scope): InputFact[] {
  const { sex } = scope.ctx.input.profile
  if (sex !== 'female' && sex !== 'male') return [gap('m-sex', 'explain.msex-gap', {})]
  return [
    make('m-sex', 'sex', 'explain.msex-set', { sex }, { sources: [profileSource(scope.ctx)] }),
  ]
}

function ageFacts(scope: Scope): InputFact[] {
  const { age } = scope.ctx.state
  if (age === null) return [gap('m-age', 'explain.mage-gap', {})]
  return [
    make(
      'm-age',
      'age',
      'explain.mage-age',
      { age: count(age), masters: count(P.f5.mastersMinAge.value) },
      { sources: [profileSource(scope.ctx)] },
    ),
  ]
}

// ---------------------------------------------------------------------------------------------
// C6 to C8: intervals above critical speed, boundaries as ranges, updating
// ---------------------------------------------------------------------------------------------

function intervalBudgetFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const efforts = csEffortsOf(countedRuns(ctx), ctx.asOf)
  const { csMps, dPrimeM } = ctx.state.fitness
  if (csMps === null || dPrimeM === null) return [csGap('C6', ctx, efforts)]
  return [
    make(
      'C6',
      'dprime',
      'explain.c6-dprime',
      { distance: distance(dPrimeM), share: share(P.c6.repFractionOfTte.value) },
      {
        sources: efforts.map((e) => activitySource(e.activity)),
        window: lastDays(ctx, P.a6.csWindowDays.value),
      },
    ),
  ]
}

function boundaryRangeFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { zones } = ctx
  const sources = [profileSource(ctx)]
  const facts: InputFact[] = []
  const hr: Array<[string, string, Boundary | null]> = [
    ['hrmax', 'maximum heart rate', zones.hrMax],
    ['lt1-hr', 'heart rate at the line between zones 1 and 2', zones.lt1Hr],
    ['lt2-hr', 'heart rate at your threshold', zones.lt2Hr],
  ]
  for (const [name, anchor, boundary] of hr) {
    if (boundary === null) continue
    facts.push(
      make(
        'C7',
        name,
        'explain.c7-hr',
        { anchor, low: bpm(boundary.band[0]), high: bpm(boundary.band[1]) },
        { sources },
      ),
    )
  }
  const paces: Array<[string, string, Boundary | null]> = [
    ['lt1-pace', 'pace at the line between zones 1 and 2', zones.lt1PaceSecPerKm],
    ['threshold-pace', 'threshold pace', zones.thresholdPaceSecPerKm],
  ]
  for (const [name, anchor, boundary] of paces) {
    if (boundary === null) continue
    // A pace band runs from the faster end (fewer seconds) to the slower one.
    facts.push(
      make(
        'C7',
        name,
        'explain.c7-pace',
        { anchor, slow: pace(boundary.band[1]), fast: pace(boundary.band[0]) },
        { sources },
      ),
    )
  }
  return facts.length > 0 ? facts : [gap('C7', 'explain.c7-gap', {})]
}

/** The run that `lastRunDate` names, as a source. */
function lastRunSources(ctx: ExplainContext): SourceRef[] {
  const date = ctx.state.lastRunDate
  if (date === null) return []
  const run = countedRuns(ctx)
    .filter((a) => a.date === date)
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  return run === undefined ? [] : [activitySource(run)]
}

function zoneUpdateFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  if (ctx.state.lastRunDate === null) return [gap('C8', 'explain.c8-gap', {})]
  const facts: InputFact[] = []
  if (ctx.state.layoffDays >= P.c8.breakDays.value) {
    facts.push(
      make(
        'C8',
        'break',
        'explain.c8-break',
        { days: count(ctx.state.layoffDays), limit: count(P.c8.breakDays.value) },
        { sources: lastRunSources(ctx) },
      ),
    )
  }
  const accepted = Object.entries(ctx.input.zoneChanges ?? {})
    .filter((entry): entry is [ZoneBoundary, string] => isIsoDate(entry[1] ?? ''))
    .sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0]))
  for (const [boundary, date] of accepted) {
    facts.push(
      make('C8', `change-${boundary}`, 'explain.c8-change', {
        boundary: ZONE_BOUNDARY_WORDS[boundary],
        date: day(date),
      }),
    )
  }
  facts.push(make('C8', 'rule', 'explain.c8-rule', { n: count(P.c8.minObservations.value) }))
  return facts
}

// ---------------------------------------------------------------------------------------------
// F5, g-3, J6 and J8: run days, tightened profiles, the masters check, fatigue states
// ---------------------------------------------------------------------------------------------

function runDayFacts(scope: Scope): InputFact[] {
  const { ctx, next } = scope
  const { profile } = ctx.input
  const facts: InputFact[] = []
  const week = plannedWeek(ctx, next)
  if (week !== null) {
    facts.push(
      make(
        'F5',
        'plan',
        'explain.f5-plan',
        { n: count(week.runDays), week: weekOf(next) },
        { window: weekWindow(next) },
      ),
    )
  }
  const available = Object.values(profile.availability).filter((d) => d.available).length
  facts.push(
    make(
      'F5',
      'available',
      'explain.f5-available',
      { n: count(available) },
      { sources: [profileSource(ctx)] },
    ),
  )
  if (ctx.state.experience === 'novice') {
    facts.push(make('F5', 'novice', 'explain.f5-novice', { n: count(P.f5.noviceRunDays.value) }))
  }
  const { age } = ctx.state
  if (age !== null && age >= P.f5.mastersMinAge.value) {
    facts.push(
      make(
        'F5',
        'masters',
        'explain.f5-masters',
        { age: count(age), n: count(P.f5.mastersMaxRunDays.value) },
        { sources: [profileSource(ctx)] },
      ),
    )
  }
  if (week === null) facts.push(gap('F5', 'explain.plan-gap', {}))
  return facts
}

function tightenedFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { state } = ctx
  const reasons: string[] = []
  if (state.risk.recentInjury) {
    reasons.push(
      `an injury in your profile in the last ${String(P.a9.recentInjuryWindowMonths.value)} months`,
    )
  }
  if (state.risk.injuryReport === true) reasons.push('a niggle you reported')
  if (state.risk.priorBsi) reasons.push('an earlier bone stress injury')
  if (state.risk.bsiFactors >= P.g3.bsiFactorsForCap.value) {
    reasons.push('two or more bone-stress factors')
  }
  const ramp = percent(weeklyRamp(state) * 100)
  const sources = [profileSource(ctx)]
  const facts: InputFact[] =
    reasons.length > 0
      ? [
          make(
            'g-3',
            'ramp',
            'explain.g3-ramp',
            { pct: ramp, soft: percent(P.g2.rampSoft.value * 100), reasons: joinWords(reasons) },
            { sources },
          ),
        ]
      : [make('g-3', 'none', 'explain.g3-none', { pct: ramp }, { sources })]
  if (state.lowFrequency) {
    facts.push(
      make('g-3', 'low-frequency', 'explain.g3-low', {
        n: count(P.a5.lowFrequencyRunsPerWeek.value),
        weeks: count(P.a5.lowFrequencyWindowWeeks.value),
      }),
    )
  }
  if (!state.weeks.some((w) => w.runMin > 0 || w.raceMin > 0)) {
    facts.push(gap('g-3', 'explain.g3-gap', {}))
  }
  return facts
}

function mastersCheckFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { age } = ctx.state
  if (age === null) return [gap('J6', 'explain.j6-gap', {})]
  const masters = P.j6.mastersAgeYears.value
  if (age < masters) {
    return [
      make(
        'J6',
        'under',
        'explain.j6-under',
        { masters: count(masters), age: count(age) },
        { sources: [profileSource(ctx)] },
      ),
    ]
  }
  const days = P.j6.medianDays.value
  const window = { from: addDays(ctx.asOf, -days), to: addDays(ctx.asOf, -1) }
  const history = checkinsOf(ctx.input).filter((c) => c.date >= window.from && c.date <= window.to)
  const facts = [
    make(
      'J6',
      'on',
      'explain.j6-on',
      {
        age: count(age),
        hours: count(P.j6.recoveryHours.value * P.j6.recoveryMultiplier.value),
        days: count(days),
      },
      { sources: [profileSource(ctx)] },
    ),
  ]
  const slots = {
    min: count(P.j6.medianMinCheckins.value),
    days: count(days),
    found: count(history.length),
  }
  const sources = history.map((c) => checkinSource(c.date))
  facts.push(
    history.length < P.j6.medianMinCheckins.value
      ? gap('J6', 'explain.j6-checkins', slots, { sources, window })
      : make('J6', 'checkins', 'explain.j6-checkins', slots, { sources, window }),
  )
  return facts
}

/** J8 and n-6 read the same fatigue state: the readiness snapshot's. */
function fatigueStateFacts(rule: 'J8' | 'n-6'): Builder {
  return (scope) => {
    const { readiness } = scope.ctx
    const date = day(readiness.date)
    if (
      readiness.checkin === null &&
      readiness.hrv.readings === 0 &&
      readiness.sleepAvgH === null
    ) {
      return [gap(rule, 'explain.j8-gap', { date })]
    }
    const sources = readiness.checkin === null ? [] : [checkinSource(readiness.date)]
    const codes = readiness.redFlags.map((flag) => flag.code)
    if (codes.includes('suppression-medical-review')) {
      return [
        make(
          rule,
          'state',
          'explain.j8-review',
          { days: count(P.j8.medicalReviewDays.value), date },
          { sources },
        ),
      ]
    }
    if (codes.includes('suppression-deload')) {
      return [
        make(
          rule,
          'state',
          'explain.j3-suppression',
          { days: count(P.j8.deloadSuggestDays.value), date },
          { sources },
        ),
      ]
    }
    const days = count(P.j8.deloadSuggestDays.value)
    return [
      readiness.state === 'possible-fatigue'
        ? make(rule, 'state', 'explain.j8-watch', { date, days }, { sources })
        : make(rule, 'state', 'explain.j8-normal', { days }, { sources }),
    ]
  }
}

// ---------------------------------------------------------------------------------------------
// n-1 to n-4, n-7 and J9: warning signs and the windows the runner reported
// ---------------------------------------------------------------------------------------------

/** The newest check-in on or before the day. */
function newestCheckin(ctx: ExplainContext): Checkin | null {
  return (
    checkinsOf(ctx.input)
      .filter((c) => c.date <= ctx.asOf)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  )
}

function boneFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const newest = newestCheckin(ctx)
  if (newest === null) return [gap('n-1', 'explain.n1-gap', {})]
  const slots = { date: day(newest.date) }
  const sources = [checkinSource(newest.date)]
  return [
    focalBoneActive(ctx.input, ctx.asOf)
      ? make('n-1', 'active', 'explain.n1-active', slots, { sources })
      : make('n-1', 'clear', 'explain.n1-clear', slots, { sources }),
  ]
}

function painFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const pain = recentPain(ctx.input, ctx.asOf)
  const window = lastDays(ctx, 2)
  if (pain === null) return [gap('n-2', 'explain.n2-gap', {}, { window })]
  const sources: SourceRef[] = [
    ...[ctx.asOf, addDays(ctx.asOf, -1)].flatMap((date) =>
      checkinsOf(ctx.input).some((c) => c.date === date && c.painScore !== null)
        ? [checkinSource(date)]
        : [],
    ),
    ...countedRuns(ctx)
      .filter((a) => a.date >= window.from && a.pain !== null)
      .map(activitySource),
  ]
  const score = P.pain.flagScore.value
  if (pain <= 0) return [make('n-2', 'pain', 'explain.n2-none', {}, { sources, window })]
  return [
    make(
      'n-2',
      'pain',
      pain >= score ? 'explain.n2-pain' : 'explain.n2-below',
      { pain: count(pain), score: count(score) },
      { sources, window },
    ),
  ]
}

function illnessFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const windows = ctx.input.disruptions ?? []
  if (checkinsOf(ctx.input).length === 0 && windows.length === 0) {
    return [gap('n-3', 'explain.n3-gap', {})]
  }
  const gate = illnessPhase(ctx.input, ctx.asOf)
  if (gate.phase === 'clear' || gate.since === null) {
    return [make('n-3', 'gate', 'explain.n3-clear', {})]
  }
  const date = addDays(ctx.asOf, -gate.since)
  // The day was reported on a check-in or covered by a window: the source is whichever it was.
  const sources: SourceRef[] = checkinsOf(ctx.input).some((c) => c.date === date && c.illness)
    ? [checkinSource(date)]
    : windows
        .filter((w) => w.startDate <= date && date <= w.endDate)
        .map((w) => ({
          kind: 'disruption' as const,
          id: w.id,
          date: w.startDate,
          label: 'Rest window',
        }))
  return [
    gate.phase === 'rest'
      ? make('n-3', 'gate', 'explain.n3-rest', { date: day(date) }, { sources })
      : make(
          'n-3',
          'gate',
          'explain.n3-easy',
          { date: day(date), days: count(P.n3.illnessEasyDaysBeforeIntensity.value) },
          { sources },
        ),
  ]
}

function screeningFacts(scope: Scope): InputFact[] {
  const flags = scope.ctx.input.screeningFlags
  if (flags === undefined) {
    return [gap('n-4', 'explain.n4-gap', { weeks: count(P.n4.rescreenWeeks.value) })]
  }
  return [
    flags > 0
      ? make('n-4', 'screen', 'explain.n4-flags', {
          n: count(flags),
          hold: count(P.j5.redsHoldFlags.value),
        })
      : make('n-4', 'screen', 'explain.n4-none', {}),
  ]
}

function fluidSafetyFacts(scope: Scope): InputFact[] {
  const { race, prediction } = scope.ctx
  // The event the fluid-safety card is sized for: the goal's target time, else the prediction.
  const eventSec = race?.targetTimeSec ?? prediction?.predictedSec ?? null
  if (eventSec === null || !(eventSec > 0)) return [gap('n-7', 'explain.n7-gap', {})]
  return [
    make('n-7', 'event', 'explain.n7-event', {
      duration: duration(eventSec),
      hours: count(P.n7.eahStrongerAlertHours.value),
    }),
  ]
}

const REASON_WORDS: Readonly<Record<DisruptionReason, string>> = {
  'illness-above-neck': 'Illness above the neck',
  'illness-below-neck': 'Illness below the neck',
  niggle: 'A niggle',
  'short-on-time': 'Short on time',
  travel: 'Travel',
}

function disruptionFacts(scope: Scope): InputFact[] {
  const windows = [...(scope.ctx.input.disruptions ?? [])].sort(
    (a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id),
  )
  if (windows.length === 0) return [gap('J9', 'explain.j9-gap', {})]
  return windows.slice(0, EXPLAIN_MAX_SOURCES).map((w, index) => {
    const slots = {
      reason: REASON_WORDS[w.reason],
      from: day(w.startDate),
      to: day(w.endDate),
    }
    const sources: SourceRef[] = [
      { kind: 'disruption', id: w.id, date: w.startDate, label: 'Rest window' },
    ]
    const window = { from: w.startDate, to: w.endDate }
    return w.mode === 'limited' && w.maxRunMin !== null
      ? make(
          'J9',
          `window-${String(index)}`,
          'explain.j9-limited',
          { ...slots, max: minutes(w.maxRunMin) },
          { sources, window },
        )
      : make('J9', `window-${String(index)}`, 'explain.j9-window', slots, { sources, window })
  })
}

// ---------------------------------------------------------------------------------------------
// O1: targets on the device
// ---------------------------------------------------------------------------------------------

function deviceTargetFacts(scope: Scope): InputFact[] {
  const { zones } = scope.ctx
  if (zones.hr === null) return [gap('O1', 'explain.o1-gap', {})]
  return [
    make(
      'O1',
      'ceiling',
      'explain.o1-ceiling',
      { bpm: bpm(zones.hr.z1[1]), floor: bpm(P.o1.hrFloorBpm.value) },
      { sources: [profileSource(scope.ctx)] },
    ),
  ]
}

// ---------------------------------------------------------------------------------------------
// D1 to D7: the goal
// ---------------------------------------------------------------------------------------------

const SURFACE_WORDS: Readonly<Record<GoalModel['surface'], string>> = {
  road: 'road',
  trail: 'trail',
  track: 'track',
  mixed: 'mixed-surface',
}

const noGoal = (rule: string): InputFact[] => [gap(rule, 'explain.goal-gap', {})]

function goalRecordFacts(scope: Scope): InputFact[] {
  const { race } = scope.ctx
  if (race === null) return noGoal('D1')
  const base = {
    distance: distance(race.distanceM),
    surface: SURFACE_WORDS[race.surface],
    date: day(race.date),
  }
  const limit = { limit: distance(P.d1.ultraAboveM.value) }
  return [
    race.gainM > 0
      ? make('D1', 'goal', 'explain.d1-goal', { ...base, gain: climb(race.gainM) })
      : make('D1', 'goal', 'explain.d1-goal-flat', base),
    race.isUltra
      ? make('D1', 'ultra', 'explain.d1-ultra', limit)
      : make('D1', 'ultra', 'explain.d1-not-ultra', limit),
  ]
}

function goalTypeFacts(scope: Scope): InputFact[] {
  const { race } = scope.ctx
  if (race === null) return noGoal('D2')
  if (race.goalType === 'time') {
    return [
      race.targetTimeSec !== null && race.targetTimeSec > 0
        ? make('D2', 'type', 'explain.d2-time', { duration: duration(race.targetTimeSec) })
        : make('D2', 'type', 'explain.d2-time-open', {}),
    ]
  }
  return [
    race.distanceM >= P.d2.finishFirstFromM.value
      ? make('D2', 'type', 'explain.d2-finish-long', {
          distance: distance(P.d2.finishFirstFromM.value),
        })
      : make('D2', 'type', 'explain.d2-finish', {}),
  ]
}

function floorFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { race, state } = ctx
  if (race === null) return noGoal('D3')
  const half = race.distanceClass === 'half'
  if (race.goalType !== 'time' || (!half && race.distanceClass !== 'marathon')) return []
  const weekly = meanWeeklyKm(state, ctx.asOf, P.d3.weeklyFloorWeeks.value)
  const longest = state.longest30d.distanceM
  if (weekly <= 0 && longest <= 0) {
    return [gap('D3', 'explain.d3-gap', { weeks: count(P.d3.weeklyFloorWeeks.value) })]
  }
  const floorWeekly = half ? P.d3.halfMinWeeklyKm.value : P.d3.marathonMinWeeklyKm.value
  const floorLong = half ? P.d3.halfMinLongRunKm.value : P.d3.marathonMinLongRunKm.value
  return [
    make('D3', 'floors', 'explain.d3-floors', {
      weekly: distance(floorWeekly * 1000),
      long: distance(floorLong * 1000),
    }),
    make(
      'D3',
      'now',
      'explain.d3-now',
      {
        weeks: count(P.d3.weeklyFloorWeeks.value),
        weekly: distance(weekly * 1000),
        days: count(P.a3.longestRunWindowDays.value),
        long: distance(longest),
      },
      { window: lastDays(ctx, P.a3.longestRunWindowDays.value) },
    ),
  ]
}

/**
 * The state the plan was drawn from. A break of 7 days or more restarts the plan below the volume
 * before it [rules J7], so the start path, the outlook, the cap of the longest run and the length
 * of the taper are read from the restart volume, as the generator reads them. The snapshot keeps
 * the runner's own typical week; `afterBreak` is pure and changes nothing else.
 */
const planState = (ctx: ExplainContext): AthleteState => afterBreak(ctx.state)

const FEASIBILITY_WORDS: Readonly<Record<Feasibility['label'], string>> = {
  comfortable: 'comfortable',
  tight: 'tight',
  'not-reachable': 'not reachable within the default limits',
}

function outlookFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { race } = ctx
  if (race === null) return noGoal('D4')
  // The label the plan was generated with: the same start path, the same day and the same state.
  const input: EngineInput = { ...ctx.input, today: ctx.asOf, goal: race }
  const state = planState(ctx)
  const outlook = feasibility(race, state, ctx.asOf, startPath(input, state))
  return [
    make('D4', 'label', 'explain.d4-label', {
      label: FEASIBILITY_WORDS[outlook.label],
      needed: count(outlook.weeksNeeded),
      available: count(outlook.weeksAvailable),
    }),
  ]
}

function ultraNoteFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { race, state } = ctx
  if (race === null) return noGoal('D5')
  if (!race.isUltra) return []
  const weeks = P.d5.lowWeeklyWindowWeeks.value
  const weekly = meanWeeklyKm(state, ctx.asOf, weeks)
  if (weekly <= 0) return [gap('D5', 'explain.d5-gap', { weeks: count(weeks) })]
  const facts = [
    make('D5', 'weekly', 'explain.d5-weekly', {
      weekly: distance(weekly * 1000),
      weeks: count(weeks),
      low: distance(P.d5.lowWeeklyKm.value * 1000),
    }),
  ]
  const priorUltra = state.fitness.races.some((r) => r.distanceM > P.d1.ultraAboveM.value)
  if (!priorUltra && state.yearsRunning !== null) {
    facts.push(
      make(
        'D5',
        'years',
        'explain.d5-years',
        { years: count(state.yearsRunning), min: count(P.d5.minYearsRunning.value) },
        { sources: [profileSource(ctx)] },
      ),
    )
  }
  return facts
}

function raceHeatFacts(rule: 'D6' | 'I2' | 'I3'): Builder {
  return (scope) => {
    const wbgt = scope.ctx.race?.raceWbgtC ?? null
    if (wbgt === null) return [gap(rule, 'explain.heat-gap', {})]
    const index = temp(Math.round(wbgt * 10) / 10)
    const [low, high] = P.i2.wbgtOptimumC.value
    if (rule === 'D6') {
      const slots = { temp: index, trigger: temp(P.d6.raceWbgtAcclimationC.value) }
      return [
        wbgt >= P.d6.raceWbgtAcclimationC.value
          ? make(rule, 'heat', 'explain.d6-hot', slots)
          : make(rule, 'heat', 'explain.d6-cool', slots),
      ]
    }
    if (wbgt <= high) {
      return [
        wbgt >= low
          ? make(rule, 'heat', 'explain.i2-band', { temp: index, low: temp(low), high: temp(high) })
          : make(rule, 'heat', 'explain.i2-cool', { temp: index, low: temp(low) }),
      ]
    }
    const slope = P.i3.slopePctPerC.value
    return [
      make(rule, 'heat', 'explain.i3-slope', {
        temp: index,
        start: temp(P.i3.slopeStartC.value),
        end: temp(P.i3.noExtrapolationAboveC.value),
        low: percent(slope * P.i4.abilityMultiplierMin.value),
        high: percent(slope * P.i4.abilityMultiplierMax.value),
      }),
    ]
  }
}

function longRunTierFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { race } = ctx
  if (race === null) return noGoal('D7')
  if (race.distanceClass !== '5k' && race.distanceClass !== '10k') return []
  if (ctx.state.typicalWeekMin <= 0) return [gap('D7', 'explain.d7-gap', {})]
  // The tier comes from the typical week the plan grew from, which a break lowers [rules J7].
  const state = planState(ctx)
  // The cap is measured at the pace the long run is carried at, as the plan measures it.
  const pace = trainingPace(state, race)
  const z1 = ctx.zones.pace?.z1 ?? null
  const runPace = z1 === null ? pace : (z1[0] + z1[1]) / 2
  const slots = {
    typical: minutes(state.typicalWeekMin),
    cap: minutes(peakLongRunMin(race, pace, state, runPace)),
  }
  return [
    state.typicalWeekMin === ctx.state.typicalWeekMin
      ? make('D7', 'tier', 'explain.d7-tier', slots)
      : make('D7', 'tier', 'explain.d7-tier-break', slots),
  ]
}

// ---------------------------------------------------------------------------------------------
// E2, E3, E4, E6, K1, K2: the structure of the stored plan
// ---------------------------------------------------------------------------------------------

const planWeeks = (ctx: ExplainContext): WeekDraft[] => ctx.input.existing?.weeks ?? []

const PHASE_WORDS: Readonly<Record<PhaseV2, string>> = {
  base: 'base',
  build: 'build',
  specific: 'race-specific',
  taper: 'taper',
  race: 'race',
}

function phaseFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const weeks = planWeeks(ctx)
  if (weeks.length === 0) return [gap('E2', 'explain.plan-gap', {})]
  const inPhase = (...phases: PhaseV2[]) => weeks.filter((w) => phases.includes(w.phase)).length
  const facts = [
    make(
      'E2',
      'phases',
      'explain.e2-phases',
      {
        base: count(inPhase('base')),
        build: count(inPhase('build')),
        specific: count(inPhase('specific')),
        taper: count(inPhase('taper', 'race')),
      },
      { window: { from: weeks[0]!.weekStart, to: addDays(weeks[weeks.length - 1]!.weekStart, 6) } },
    ),
  ]
  if (ctx.race !== null) {
    const away = Math.max(0, Math.floor(daysBetween(ctx.asOf, ctx.race.date) / 7))
    facts.push(make('E2', 'race', 'explain.e2-race', { weeks: count(away) }))
  }
  return facts
}

const CYCLE_REASON_WORDS = {
  'recent-injury': `an injury in your profile in the last ${String(P.a9.recentInjuryWindowMonths.value)} months`,
  chosen: 'the 2:1 cycle you chose',
  'new-runner': 'your running level',
} as const

function recoveryCycleFacts(scope: Scope): InputFact[] {
  const { ctx, next } = scope
  const reason = cycleShortReason(ctx.input, ctx.state)
  const facts = [
    make('E3', 'cycle', 'explain.e3-cycle', { n: count(cycleWorkWeeks(ctx.input, ctx.state)) }),
  ]
  if (reason !== null) {
    facts.push(
      make('E3', 'short', 'explain.e3-short', {
        usual: count(P.e3.defaultCycleWorkWeeks.value),
        reason: CYCLE_REASON_WORDS[reason],
      }),
    )
  }
  const weeks = planWeeks(ctx)
  const recovery = weeks.find((w) => w.isRecovery && w.weekStart >= next)
  if (recovery !== undefined) {
    const window = { window: weekWindow(recovery.weekStart) }
    // A recovery week that a rest window holds whole is stored at no running, not "up to 0 min".
    facts.push(
      Math.round(recovery.targetRunMin) <= 0
        ? make('E3', 'next', 'explain.e3-next-none', { week: weekOf(recovery.weekStart) }, window)
        : make(
            'E3',
            'next',
            'explain.e3-next',
            { week: weekOf(recovery.weekStart), minutes: minutes(recovery.targetRunMin) },
            window,
          ),
    )
  }
  if (weeks.length === 0) facts.push(gap('E3', 'explain.plan-gap', {}))
  return facts
}

function intensityFacts(scope: Scope): InputFact[] {
  const { ctx, next } = scope
  const week = plannedWeek(ctx, next)
  if (week === null) return [gap('E4', 'explain.plan-gap', {})]
  return [
    make(
      'E4',
      'week',
      'explain.e4-week',
      {
        week: weekOf(next),
        phase: PHASE_WORDS[week.phase],
        z1: percent(week.tid.z1),
        z2: percent(week.tid.z2),
        z3: percent(week.tid.z3),
      },
      { window: weekWindow(next) },
    ),
  ]
}

function startPathFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const facts: InputFact[] = []
  if (ctx.state.lastRunDate === null) {
    facts.push(gap('E6', 'explain.e6-gap', { days: count(P.a5.historyWindowDays.value) }))
  }
  // The path is chosen from the restart volume after a break [rules J7], as the plan chose it.
  const state = planState(ctx)
  const input = { ...ctx.input, today: ctx.asOf }
  const path = startPath(input, state)
  const sources = lastRunSources(ctx)
  if (path === null) {
    facts.push(
      make('E6', 'path', 'explain.e6-none', { level: minutes(startLevelMin(state)) }, { sources }),
    )
  } else if (path.kind === 'ladder') {
    facts.push(
      make('E6', 'path', 'explain.e6-ladder', {
        rung: count(path.rung),
        rungs: count(rungCount()),
      }),
    )
  } else if (path.kind === 'floor') {
    facts.push(
      make(
        'E6',
        'path',
        'explain.e6-floor',
        { n: count(P.restartFloor.sessions.value), session: minutes(path.sessionMin) },
        { sources },
      ),
    )
    // a floor session above the floor itself was lifted by one of two routes: name the one taken
    const route =
      path.sessionMin > P.restartFloor.sessionMin.value
        ? startLift({ ...loadInputOf(ctx), today: ctx.asOf }, state)
        : null
    if (route === 'years') {
      facts.push(
        make('E6', 'route', 'explain.e6-lift-years', {
          floor: minutes(P.restartFloor.sessionMin.value),
          years: count(P.a5.trainedMinYears.value),
        }),
      )
    } else if (route === 'block') {
      facts.push(
        make('E6', 'route', 'explain.e6-lift-block', {
          floor: minutes(P.restartFloor.sessionMin.value),
          years: countPhrase(P.a5.noviceMaxYears.value, 'year'),
        }),
        make('E6', 'block', 'explain.e6-lift-block-weeks', {
          blocks: count(P.g8.blockWeeks.value),
          minimum: minutes(blockLiftMin()),
          weeks: count(P.g8.creditWindowWeeks.value),
        }),
      )
    }
  } else {
    facts.push(
      make('E6', 'path', 'explain.e6-injury', {
        session: minutes(P.injuryReturn.levelsMin.value[path.level] ?? 0),
      }),
    )
  }
  return facts
}

function taperLengthFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { race } = ctx
  if (race === null) return noGoal('K1')
  const days = taperDays(race, planState(ctx))
  const first = planWeeks(ctx).find((w) => w.isTaper)
  return [
    first === undefined
      ? make('K1', 'taper', 'explain.k1-taper', { days: count(days) })
      : make(
          'K1',
          'taper',
          'explain.k1-start',
          { days: count(days), week: weekOf(first.weekStart) },
          { window: weekWindow(first.weekStart) },
        ),
  ]
}

function taperVolumeFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const weeks = planWeeks(ctx)
  if (weeks.length === 0) return [gap('K2', 'explain.plan-gap', {})]
  const taper = weeks.filter((w) => w.isTaper)
  if (taper.length === 0) return [gap('K2', 'explain.k2-gap', {})]
  return taper.slice(0, EXPLAIN_MAX_SOURCES).map((w, index) => {
    const name = `week-${String(index)}`
    const window = { window: weekWindow(w.weekStart) }
    // A taper week that a rest window holds whole is stored at no running, not "up to 0 min".
    return Math.round(w.targetRunMin) <= 0
      ? make('K2', name, 'explain.k2-week-none', { week: weekOf(w.weekStart) }, window)
      : make(
          'K2',
          name,
          'explain.k2-week',
          { week: weekOf(w.weekStart), minutes: minutes(w.targetRunMin) },
          window,
        )
  })
}

// ---------------------------------------------------------------------------------------------
// H2, H4 to H7, H10, H12, H13 and I8: ultra, course, fuel, strength, the weeks after a race, heat
// ---------------------------------------------------------------------------------------------

function timeOnFeetFacts(scope: Scope): InputFact[] {
  const { race } = scope.ctx
  if (race === null) return noGoal('H2')
  if (!race.isUltra) return []
  const cap = ultraRunCapMin(race.expectedDurationSec)
  if (cap === null) return noGoal('H2')
  return [
    make('H2', 'cap', 'explain.h2-cap', {
      cap: duration(cap * 60),
      hours: count(P.h2.longestRunCapHours.value),
      share: share(P.h2.longestRunCapRaceFraction.value),
      race: duration(race.expectedDurationSec),
    }),
  ]
}

function climbingFacts(scope: Scope): InputFact[] {
  const { ctx, next } = scope
  const { race } = ctx
  if (race === null) return noGoal('H4')
  if (race.gainM <= 0) {
    return race.surface === 'trail' || race.surface === 'mixed'
      ? [gap('H4', 'explain.h4-gap', {})]
      : []
  }
  const facts = [
    make('H4', 'climb', 'explain.h4-climb', {
      gain: climb(race.gainM),
      distance: distance(race.distanceM),
      ramp: percent(P.h4.weeklyGainRamp.value * 100),
    }),
  ]
  const target = plannedWeek(ctx, next)?.gainTargetM ?? null
  if (target !== null && target > 0) {
    facts.push(
      make(
        'H4',
        'week',
        'explain.h4-week',
        { week: weekOf(next), gain: climb(target) },
        { window: weekWindow(next) },
      ),
    )
  }
  return facts
}

function descentFacts(scope: Scope): InputFact[] {
  const { race } = scope.ctx
  if (race === null) return noGoal('H5')
  if (race.lossM > 0) {
    return [
      make('H5', 'descent', 'explain.h5-descent', {
        loss: climb(race.lossM),
        distance: distance(race.distanceM),
        weeks: count(P.h5.downhillStartWeeksBeforeRace.value),
      }),
    ]
  }
  return race.gainM > 0 || race.surface === 'trail' || race.surface === 'mixed'
    ? [gap('H5', 'explain.h5-gap', {})]
    : []
}

function nightFacts(scope: Scope): InputFact[] {
  const { race } = scope.ctx
  if (race === null) return noGoal('H6')
  const [low, high] = P.h6.headlampRehearsalRuns.value
  return [
    race.crossesDarkness
      ? make('H6', 'night', 'explain.h6-dark', { low: count(low), high: count(high) })
      : make('H6', 'night', 'explain.h6-day', {}),
  ]
}

function fuelBlockFacts(scope: Scope): InputFact[] {
  const { ctx, next } = scope
  const weeks = planWeeks(ctx)
  if (weeks.length === 0) return [gap('H7', 'explain.plan-gap', {})]
  const gutWeeks = weeks.filter((w) => w.flags.includes('gut-training'))
  const first = gutWeeks[0]
  if (first === undefined) return [make('H7', 'none', 'explain.h7-none', {})]
  // The runs flagged for fuel practice in the next gut-training week (the last one once all are past).
  const focus = gutWeeks.find((w) => w.weekStart >= next) ?? gutWeeks[gutWeeks.length - 1]!
  const end = addDays(focus.weekStart, 6)
  const fuelRuns = (ctx.input.existing?.sessions ?? []).filter(
    (s) => s.date >= focus.weekStart && s.date <= end && s.flags.includes('fuel-practice'),
  )
  return [
    make('H7', 'weeks', 'explain.h7-weeks', {
      n: count(gutWeeks.length),
      week: weekOf(first.weekStart),
    }),
    make(
      'H7',
      'sessions',
      'explain.h7-sessions',
      { week: weekOf(focus.weekStart), n: count(fuelRuns.length) },
      {
        sources: fuelRuns.map((s) => ({
          kind: 'session' as const,
          id: s.id,
          date: s.date,
          label: 'Session',
        })),
        window: weekWindow(focus.weekStart),
      },
    ),
  ]
}

/**
 * H10, the ultra rule for strength: the plan's strength sessions in the week, the block week and
 * what the profile asks for. The rule is in force for an ultra goal only (the sessions of any other
 * goal cite E5 and F7), so another goal has nothing for it to state, as with H2.
 */
function strengthFacts(scope: Scope): InputFact[] {
  const { ctx, next } = scope
  const { race } = ctx
  if (race === null) return noGoal('H10')
  if (!race.isUltra) return []
  const facts: InputFact[] = []
  const week = plannedWeek(ctx, next)
  if (week !== null) {
    facts.push(
      make(
        'H10',
        'week',
        'explain.h10-week',
        { week: weekOf(next), n: count(week.strengthSessions) },
        { window: weekWindow(next) },
      ),
    )
    const at = strengthBlockPosition(planWeeks(ctx), next)
    facts.push(
      at === null
        ? make(
            'H10',
            'block',
            'explain.h10-outside',
            { week: weekOf(next) },
            { window: weekWindow(next) },
          )
        : make(
            'H10',
            'block',
            'explain.h10-block',
            { week: weekOf(next), k: count(at.week), n: count(at.of) },
            { window: weekWindow(next) },
          ),
    )
  }
  const wanted = ctx.input.profile.strengthPreference
  if (wanted > 0) {
    facts.push(
      make(
        'H10',
        'wanted',
        'explain.h10-pref',
        { n: count(wanted) },
        { sources: [profileSource(ctx)] },
      ),
    )
  }
  if (week === null) facts.push(gap('H10', 'explain.plan-gap', {}))
  return facts
}

// ---------------------------------------------------------------------------------------------
// F7 to F9: a strength session, its loads and its lighter days (strength design 10.5, ADR 0014)
// ---------------------------------------------------------------------------------------------

/** What a strength request reads: the engine's input, the session and the one workout it derives. */
interface StrengthRead {
  ctx: StrengthContext
  ref: StrengthSessionRef
  workout: StrengthWorkout
}

/** A planned session as the strength engine reads it. */
const strengthRef = (session: SessionRow): StrengthSessionRef => ({
  id: session.id,
  date: session.date,
  order: session.order,
  durationMin: session.durationMin,
  rules: session.rules,
})

const strengthReads = new WeakMap<Scope, StrengthRead | null>()

/**
 * The workout of the session being explained, derived by the same `workoutFor` that every surface
 * calls, so a reason cannot differ from the load beside it. Null without the strength input or
 * without a strength session of the plan; each builder then says what it needs.
 */
function strengthRead(scope: Scope): StrengthRead | null {
  if (strengthReads.has(scope)) return strengthReads.get(scope) ?? null
  const { strength } = scope.ctx
  const { session } = scope
  let read: StrengthRead | null = null
  if (
    strength !== undefined &&
    strength !== null &&
    session !== null &&
    session.kind === 'strength'
  ) {
    const ref = strengthRef(session)
    read = { ctx: strength, ref, workout: workoutFor(strength, ref) }
  }
  strengthReads.set(scope, read)
  return read
}

/**
 * The lifts a strength request is about: the one a lift's "Why" opened on (in the workout, else as
 * the rules would give it in this session's place, for a swapped or an added lift), or the lifts of
 * the session. A jump or an exercise the runner cannot do has no load to explain.
 */
function explainedLifts(
  strength: StrengthContext,
  ref: StrengthSessionRef,
  workout: StrengthWorkout,
  exercise: string | null,
): WorkoutLift[] {
  if (exercise === null) return workout.lifts
  const own = [...workout.lifts, ...workout.trunk].find((lift) => lift.exerciseId === exercise)
  if (own !== undefined) return [own]
  const other = isExerciseId(exercise) ? liftFor(strength, ref, exercise) : null
  return other === null ? [] : [other]
}

const liftsToExplain = (scope: Scope, read: StrengthRead): WorkoutLift[] =>
  explainedLifts(read.ctx, read.ref, read.workout, scope.exercise)

const exerciseName = (id: string): string => {
  const exercise = exerciseById(id)
  return exercise === undefined ? id : STRENGTH_TEMPLATES[exercise.name].text
}

const templateWord = (template: StrengthTemplate): string =>
  STRENGTH_TEMPLATES[`strength.template.${template}`].text

/** What a load is for, in words ("a barbell"); an exhaustive map, so a new item needs its words. */
export const EQUIPMENT_WORDS: Readonly<Record<EquipmentKind, string>> = {
  barbell: 'a barbell',
  dumbbells: 'dumbbells',
  kettlebells: 'a kettlebell',
  bands: 'a band',
  step: 'a step',
  'leg-press': 'the leg press',
  'calf-machine': 'the calf machine',
  'leg-curl': 'the leg curl machine',
}

/**
 * The reasons of the engine that belong to F9 (lighter days and weeks, the taper, maintenance); the
 * other reasons of a lift are F8's (a first load, a step, a hold, a gap).
 */
const F9_REASONS: ReadonlySet<string> = new Set([
  'strength.reason.lighter-day',
  'strength.reason.lighter-day-sets',
  'strength.reason.lighter-day-load',
  'strength.reason.lighter-week',
  'strength.reason.taper',
  'strength.reason.maintenance',
])

/** The log of a session the rules read, as a source: the activity page shows its sets. */
function logSource(read: StrengthRead, logId: string, date: string): SourceRef[] {
  const activityId = read.ctx.logs.find((entry) => entry.id === logId)?.activityId
  return activityId === undefined
    ? []
    : [{ kind: 'activity', id: activityId, date, label: 'Strength' }]
}

/** F7: the block week, the template and what sets it, the equipment of a lift and the jump dose. */
function strengthStructureFacts(scope: Scope): InputFact[] {
  const read = strengthRead(scope)
  if (read === null) return [gap('F7', 'explain.f7-gap', {})]
  const { ctx, workout } = read
  const facts: InputFact[] = []
  if (!workout.setupSaved) facts.push(gap('F7', 'explain.f7-no-setup', {}))

  const { block } = workout
  if (block === null) {
    facts.push(make('F7', 'block', 'explain.f7-outside', {}))
  } else if (block.rampInWeeks === 0) {
    facts.push(
      make('F7', 'block', 'explain.f7-block-credit', {
        week: count(block.week),
        of: count(block.of),
        weeks: count(P.f7.blockCreditWeeks.value),
      }),
    )
  } else {
    facts.push(
      make('F7', 'block', 'explain.f7-block', {
        week: count(block.week),
        of: count(block.of),
        ramp: countPhrase(block.rampInWeeks, 'week'),
      }),
    )
  }
  facts.push(
    make('F7', 'template', 'explain.f7-template', {
      template: templateWord(workout.template),
      variant: workout.variant,
    }),
  )
  if (workout.template === 'lighter-week') {
    facts.push(make('F7', 'why', 'explain.f7-why-lighter-week', {}))
  }
  if (workout.template === 'taper') facts.push(make('F7', 'why', 'explain.f7-why-taper', {}))
  if (workout.template === 'return') facts.push(make('F7', 'why', 'explain.f7-why-return', {}))

  for (const lift of liftsToExplain(scope, read)) {
    const exercise = exerciseName(lift.exerciseId)
    facts.push(
      lift.implement === null
        ? make('F7', `bodyweight-${lift.exerciseId}`, 'explain.f7-bodyweight', { exercise })
        : make('F7', `equipment-${lift.exerciseId}`, 'explain.f7-equipment', {
            exercise,
            equipment: EQUIPMENT_WORDS[lift.implement],
          }),
    )
  }

  if (workout.plyo !== null) {
    facts.push(make('F7', 'plyo', 'explain.f7-plyo', { contacts: count(workout.plyo.contacts) }))
    const cut = share(P.f7.reducedPlyoShare.value)
    const pace = ctx.goal.paceKmh
    if (pace !== null && pace > P.flib.plyoEmphasisPaceKmh.value) {
      facts.push(
        make('F7', 'plyo-pace', 'explain.f7-plyo-pace', {
          pace: speed(P.flib.plyoEmphasisPaceKmh.value),
          share: cut,
        }),
      )
    }
    if (ctx.athlete.risk.priorBsi) {
      facts.push(make('F7', 'plyo-bsi', 'explain.f7-plyo-bsi', { share: cut }))
    }
    if (ctx.athlete.risk.recentInjury) {
      facts.push(
        make('F7', 'plyo-injury', 'explain.f7-plyo-injury', {
          months: count(P.a9.recentInjuryWindowMonths.value),
          share: cut,
        }),
      )
    }
    const week = ctx.weeks.find((w) => w.weekStart === mondayOf(read.ref.date))
    const recovery =
      week !== undefined &&
      workout.block !== null &&
      workout.template !== 'return' &&
      (week.isRecovery || week.flags.includes('recovery'))
    if (recovery) facts.push(make('F7', 'plyo-lighter', 'explain.f7-plyo-lighter', { share: cut }))
  }
  return facts
}

/**
 * F8: for each lift, its last session and the reasons the rules gave for its load (a first load, a
 * step up, a hold, a step down, a return, a move to a harder movement), and the share of the
 * estimated maximum the load is once there is an estimate. The reasons are the lift's own `basis`,
 * so they are the ones that made the number.
 */
function strengthLoadFacts(scope: Scope): InputFact[] {
  const read = strengthRead(scope)
  if (read === null) return [gap('F8', 'explain.f8-gap', {})]
  const facts: InputFact[] = []
  const seen = new Set<string>()
  for (const lift of liftsToExplain(scope, read)) {
    const id = lift.exerciseId
    const exercise = exerciseName(id)
    // the session whose sets the rules judged (else the only kind there is: a lighter one), in the
    // lift's implement and before the day of the session: what the rules read, and no other history
    const last = lift.evidence.judged ?? lift.evidence.latest
    if (last !== null) {
      const sources = logSource(read, last.logId, last.date)
      const date = { kind: 'date', iso: last.date, style: 'weekday' } as const
      const sets = countPhrase(last.sets, 'set')
      // a hold or a carry is counted in seconds, and every other lift in reps
      const timed = exerciseById(id)?.measure === 'seconds'
      const fact =
        last.heaviest === null
          ? timed
            ? make(
                'F8',
                `last-${id}`,
                'explain.f8-last-hold',
                { exercise, date, sets, time: duration(last.best) },
                { sources },
              )
            : make(
                'F8',
                `last-${id}`,
                'explain.f8-last-unloaded',
                { exercise, date, sets, count: count(last.best) },
                { sources },
              )
          : timed
            ? make(
                'F8',
                `last-${id}`,
                'explain.f8-last-seconds',
                {
                  exercise,
                  date,
                  sets,
                  load: loadOf(last.heaviest.loadG),
                  time: duration(last.heaviest.count),
                },
                { sources },
              )
            : make(
                'F8',
                `last-${id}`,
                'explain.f8-last',
                {
                  exercise,
                  date,
                  sets,
                  load: loadOf(last.heaviest.loadG),
                  count: count(last.heaviest.count),
                },
                { sources },
              )
      facts.push(fact)
    }
    lift.basis.facts
      .filter((reason) => !F9_REASONS.has(reason.template))
      .forEach((reason, i) => {
        const key = JSON.stringify([reason.template, reason.slots])
        if (seen.has(key)) return
        seen.add(key)
        facts.push(rawFact('F8', `${id}-${String(i)}`, reason.template, reason.slots))
      })
    if (lift.loadG !== null) {
      // the estimate the engine used for this lift: its latest session's, else the starting point's
      const { estimateG } = lift.evidence
      const pct = estimateG === null ? null : percentOfMax(lift.loadG, estimateG)
      if (pct !== null) {
        facts.push(
          rawFact('F8', `share-${id}`, 'strength.max-share', {
            pct: percent(pct),
            floor: percent(P.flib.heavyMinPct1rm.value),
          }),
        )
      }
    }
  }
  return facts
}

/**
 * F9: what made a lift lighter or kept it, from the readiness read of the day, the week's flags
 * and the gap since its last session: the lighter-day, recovery-week, taper and maintenance reasons
 * of the lifts, the cause of a lighter day, the usual load, and the days since the last session
 * with the gap that sends the load back.
 */
function strengthLighterFacts(scope: Scope): InputFact[] {
  const read = strengthRead(scope)
  if (read === null) return [gap('F9', 'explain.f9-gap', {})]
  const facts: InputFact[] = []
  const seen = new Set<string>()
  const lifts = liftsToExplain(scope, read)
  for (const lift of lifts) {
    lift.basis.facts
      .filter((reason) => F9_REASONS.has(reason.template))
      .forEach((reason, i) => {
        const key = JSON.stringify([reason.template, reason.slots])
        if (seen.has(key)) return
        seen.add(key)
        facts.push(rawFact('F9', `${lift.exerciseId}-${String(i)}`, reason.template, reason.slots))
      })
  }
  const { readiness } = read.ctx
  if (readiness !== null && lifts.some((lift) => lift.change === 'lighter-day')) {
    if (readiness.state !== 'normal') facts.push(make('F9', 'state', 'explain.f9-state', {}))
    if (readiness.pain !== null && readiness.pain >= P.pain.flagScore.value) {
      facts.push(make('F9', 'pain', 'explain.f9-pain', { score: count(readiness.pain) }))
    }
    if (readiness.illness === 'easy-only') {
      facts.push(make('F9', 'illness', 'explain.f9-illness', {}))
    }
    if (readiness.illness === 'rest')
      facts.push(make('F9', 'illness', 'explain.f9-illness-rest', {}))
  }
  for (const lift of lifts) {
    const exercise = exerciseName(lift.exerciseId)
    if (lift.usualLoadG !== null) {
      facts.push(
        make('F9', `usual-${lift.exerciseId}`, 'explain.f9-usual', {
          exercise,
          load: loadOf(lift.usualLoadG),
        }),
      )
    }
    // the gap is counted from the latest session of any mode, as rule F8.2 counts it, and the
    // return rule has a load to bring back only for a lift that carries one
    const last = lift.evidence.latest
    if (last !== null && lift.loadG !== null) {
      facts.push(
        make(
          'F9',
          `since-${lift.exerciseId}`,
          'explain.f9-since',
          {
            exercise,
            days: countPhrase(last.gapDays, 'day'),
            layoff: count(P.f8.layoffDays.value),
            share: share(P.f8.layoffLoadFraction.value),
          },
          { sources: logSource(read, last.logId, last.date) },
        ),
      )
    }
  }
  return facts
}

function postRaceFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { race } = ctx
  if (race === null) return noGoal('H12')
  const { own, past } = postRaceWindows({ ...ctx.input, today: ctx.asOf, goal: race })
  const facts: InputFact[] = []
  if (past !== null) {
    facts.push(
      make(
        'H12',
        'past',
        'explain.h12-past',
        { date: day(past.race.date), until: day(past.quietUntil), days: count(past.holdDays) },
        { window: { from: past.race.date, to: addDays(past.quietUntil, -1) } },
      ),
    )
  }
  if (race.date >= ctx.asOf) {
    const window = { from: race.date, to: addDays(own.quietUntil, -1) }
    if (own.holdDays === 0 && own.stages.length <= 1) {
      facts.push(make('H12', 'own', 'explain.h12-steps', {}, { window }))
    } else {
      facts.push(
        make(
          'H12',
          'own',
          'explain.h12-hold',
          { days: count(own.holdDays), steps: count(own.stages.length) },
          { window },
        ),
      )
    }
    if (own.holdDays > own.baseHoldDays) {
      const why = ownHoldReasons({ ...ctx.input, today: ctx.asOf, goal: race })
      const reasons = [
        ...(why.steep ? ['a steep course'] : []),
        ...(why.masters ? ['your age'] : []),
        ...(why.firstInClass ? ['a first race of this length'] : []),
      ]
      facts.push(
        make('H12', 'modified', 'explain.h12-modified', {
          base: count(own.baseHoldDays),
          days: count(own.holdDays),
          reasons: joinWords(reasons),
        }),
      )
    }
  }
  return facts
}

/** I8 and H13 read the same credit: the heat adaptation of the recent hot runs. */
function heatAdaptationFacts(rule: 'I8' | 'H13'): Builder {
  return (scope) => {
    const { ctx } = scope
    const credit = ctx.state.heatAcclimation
    const days = P.i8.zeroCreditDays.value
    const window = lastDays(ctx, days + 1)
    const exposed = countedUpTo(ctx).filter(
      (a) =>
        a.type !== 'strength' &&
        a.date >= window.from &&
        a.tempC !== null &&
        a.tempC >= P.acclim.exposureTempC.value &&
        a.durationSec / 60 >= P.acclim.exposureMinDurationMin.value,
    )
    if (!(credit > 0)) {
      return [
        gap(
          rule,
          'explain.i8-gap',
          {
            min: minutes(P.acclim.exposureMinDurationMin.value),
            temp: temp(P.acclim.exposureTempC.value),
            days: count(days),
          },
          { window },
        ),
      ]
    }
    return [
      make(
        rule,
        'credit',
        'explain.i8-credit',
        { share: share(Math.round(credit * 100) / 100) },
        { sources: exposed.map(activitySource), window },
      ),
    ]
  }
}

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

/**
 * The builders, by rule id as `RULE_TITLES` spells it. A rule is looked up without regard to case
 * but not to hyphens (`g-1` is the spike guard, `G1` a global principle).
 */
export const INPUT_BUILDERS: Readonly<Record<string, Builder>> = {
  'g-1': (scope) => longestRunFacts('g-1', scope),
  'g-2': weeklyRampFacts,
  'g-3': tightenedFacts,
  'g-6': lostVolumeFacts,
  'g-8': rebuildFacts,
  A2: loadFacts,
  A3: (scope) => longestRunFacts('A3', scope),
  A4: consistencyFacts,
  A5: experienceFacts,
  A6: fitnessFacts,
  A7: durabilityFacts,
  A8: efficiencyFacts,
  A9: riskFacts,
  B1: ratedFacts,
  B2: heartRateLoadFacts,
  B3: trimpWeightFacts,
  C1: zoneFacts,
  C2: anchorFacts,
  C3: maxHeartRateFacts,
  C4: lineBetweenZonesFacts,
  C5: thresholdFacts,
  C6: intervalBudgetFacts,
  C7: boundaryRangeFacts,
  C8: zoneUpdateFacts,
  D1: goalRecordFacts,
  D2: goalTypeFacts,
  D3: floorFacts,
  D4: outlookFacts,
  D5: ultraNoteFacts,
  D6: raceHeatFacts('D6'),
  D7: longRunTierFacts,
  E2: phaseFacts,
  E3: recoveryCycleFacts,
  E4: intensityFacts,
  E6: startPathFacts,
  F5: runDayFacts,
  F7: strengthStructureFacts,
  F8: strengthLoadFacts,
  F9: strengthLighterFacts,
  H10: strengthFacts,
  H12: postRaceFacts,
  H13: heatAdaptationFacts('H13'),
  H2: timeOnFeetFacts,
  H4: climbingFacts,
  H5: descentFacts,
  H6: nightFacts,
  H7: fuelBlockFacts,
  I2: raceHeatFacts('I2'),
  I3: raceHeatFacts('I3'),
  I8: heatAdaptationFacts('I8'),
  J2: checkinFacts,
  J3: downgradeFacts,
  J4: hrvFacts,
  J5: decisionFacts,
  J6: mastersCheckFacts,
  J7: breakFacts,
  J8: fatigueStateFacts('J8'),
  J9: disruptionFacts,
  K1: taperLengthFacts,
  K2: taperVolumeFacts,
  L1: modelFacts,
  L2: marathonFacts,
  L3: covariateFacts,
  L4: ultraFacts,
  L5: trailFacts,
  L6: bandFacts,
  'm-age': ageFacts,
  'm-sex': sexFacts,
  'n-1': boneFacts,
  'n-2': painFacts,
  'n-3': illnessFacts,
  'n-4': screeningFacts,
  'n-6': fatigueStateFacts('n-6'),
  'n-7': fluidSafetyFacts,
  O1: deviceTargetFacts,
}

/**
 * Rules whose Explain states no figure of the runner's own, each for a reason a comment gives:
 * a principle, a fixed design choice, a rule applied on another surface than the plan (a view of
 * one run, the forecast read at the time, the Goals page) or a rule the app does not run on the
 * runner. Their Explain says so ("This rests on the rule alone"). A rule that reads the runner's
 * numbers has a builder in `INPUT_BUILDERS`; every rule title is in exactly one of the two, and
 * the coverage test fails on a title that is in neither.
 */
export const POLICY_ONLY_RULES: ReadonlySet<string> = new Set([
  // global principles
  'G1',
  'G2',
  'G3',
  'G4',
  'G5',
  'G6',
  // athlete state and load: structure, not figures
  'A1',
  'A10',
  'B4',
  'B8',
  // load views shown on a run or a week, never an input to the plan: the figures sit on those
  // pages (divergence of one run, monotony and strain of one week) or in the data handling
  'B5',
  'B6',
  'B7',
  // plan structure and session library
  'E1',
  'E5',
  'F1',
  'F2',
  'F3',
  'F4',
  'F6',
  'F-lib',
  // limits that restate a principle
  'g-4',
  'g-5',
  'g-7',
  // adaptation inputs
  'J1',
  // ultra structure and fuel wording: the rule fixes the shape of the plan or the words of the
  // fuel card (drink to thirst, no body-mass scaling, no fixed volumes), so no runner figure is
  // stated; the pairs, the weeks and the fuel runs of the plan itself are listed on the plan
  'H1',
  'H3',
  'H8',
  'H9',
  'H11',
  // environment read on the day, not from the snapshot: the weather index and the training-heat
  // advice come from the cached forecast when Today or a session is read, and the rest are
  // conventions on how a hot, cold, steep or high course is described
  'I1',
  'I4',
  'I5',
  'I6',
  'I7',
  'I9',
  'I10',
  'I11',
  'I12',
  // taper structure and race-week wording: K1 and K2 state the plan's own figures
  'K3',
  'K4',
  'K5',
  'K6',
  'K7',
  // the prediction record: its figures are the stored predictions and results, read on the Goals
  // page (track record), not from the athlete snapshot an Explain reads
  'L7',
  // red flags that state a safety convention without a measured figure
  'n-5',
  // design choices without a runner figure
  'design-macro',
  'design-sessions',
  'design-explain',
  'design-3.2',
  'design-4.1',
  'design-4.2',
  'design-4.3',
  'design-revisions',
  'design-review',
])

const lower = (rule: string) => rule.toLowerCase()
const builders = new Map(
  Object.entries(INPUT_BUILDERS).map(([rule, build]) => [lower(rule), build]),
)
const policyOnly = new Set([...POLICY_ONLY_RULES].map(lower))

/** The builder of a rule id, matched without regard to case. */
export function builderFor(rule: string): Builder | undefined {
  return builders.get(lower(rule))
}

/** True when the rule uses none of the runner's numbers. */
export function isPolicyOnly(rule: string): boolean {
  return policyOnly.has(lower(rule))
}

// ---------------------------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------------------------

/** Ids one request may carry, as `RULE_TITLES` spells them. */
export const EXPLAIN_RULES = {
  /** Every run is read against the longest recent run, the week's volume and the zones. */
  run: ['g-1', 'g-2', 'C1', 'C2'],
  week: ['g-2', 'g-6', 'J5'],
  decision: ['J5', 'g-6'],
  readiness: ['J2', 'J3', 'J4'],
  zones: ['C1', 'C2', 'C3', 'C4', 'C5', 'A6'],
  prediction: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
  /**
   * A strength session, in the order of the drawer (strength design 10.5): the load and the lighter
   * day of a lift, the structure of the session, then the rules that rest on the rule alone, which
   * the session's own rule ids bring.
   */
  strength: ['F8', 'F9', 'F7'],
} as const

/** The rules of a zone boundary: its anchor, then the rule that sets it. */
const BOUNDARY_RULES = {
  cs: ['A6', 'C2'],
  lt1Pace: ['C2', 'C4'],
  thresholdPace: ['C2', 'C5'],
  lt1Hr: ['C2', 'C4'],
  hrMax: ['C2', 'C3'],
} as const

function dedupe(rules: readonly string[]): string[] {
  const seen = new Set<string>()
  return rules.filter((rule) => {
    const key = lower(rule)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sessionOf(ctx: ExplainContext, id: string): SessionRow | null {
  return ctx.input.existing?.sessions.find((s) => s.id === id) ?? null
}

function plannedWeekStart(ctx: ExplainContext, weekStart: string): boolean {
  return ctx.input.existing?.weeks.some((w) => w.weekStart === weekStart) ?? false
}

/**
 * `rules` with g-8 after the weekly ramp (g-2) when the plan was set to a position other than
 * steady [rules g-8]: the setting, the zone and the response explain the weeks the ramp sets. A
 * steady plan asks nothing of g-8, so its subjects list what they always did.
 */
function withLoadRule(rules: readonly string[], ctx: ExplainContext): string[] {
  const at = rules.indexOf('g-2')
  if (at < 0 || loadPosition(ctx.input, ctx.state).requested === 'steady') return [...rules]
  return [...rules.slice(0, at + 1), 'g-8', ...rules.slice(at + 1)]
}

/**
 * The rule ids a request is about, in the order they are shown, or null when the request names a
 * record the context does not hold (an unknown session or week) or a subject whose figures are
 * stored with it (a brief, a run).
 */
export function explainRules(req: ExplainRequest, ctx: ExplainContext): string[] | null {
  switch (req.subject) {
    case 'session': {
      const session = sessionOf(ctx, req.id)
      if (session === null) return null
      const run = VOLUME_KINDS.has(session.kind)
      return dedupe([...(run ? withLoadRule(EXPLAIN_RULES.run, ctx) : []), ...session.rules])
    }
    case 'week':
      return plannedWeekStart(ctx, req.weekStart) ? withLoadRule(EXPLAIN_RULES.week, ctx) : null
    case 'decision':
      return plannedWeekStart(ctx, req.weekStart) ? [...EXPLAIN_RULES.decision] : null
    case 'readiness':
      return [...EXPLAIN_RULES.readiness]
    case 'zone':
      return req.boundary === undefined
        ? [...EXPLAIN_RULES.zones]
        : [...BOUNDARY_RULES[req.boundary]]
    case 'prediction':
      return [...EXPLAIN_RULES.prediction]
    case 'strength': {
      const session = sessionOf(ctx, req.id)
      if (session === null || session.kind !== 'strength') return null
      // With the strength input at hand, a lift the session cannot do is an unknown record too.
      if (req.exercise !== undefined && ctx.strength !== undefined && ctx.strength !== null) {
        const ref = strengthRef(session)
        const workout = workoutFor(ctx.strength, ref)
        if (explainedLifts(ctx.strength, ref, workout, req.exercise).length === 0) return null
      }
      return dedupe([...EXPLAIN_RULES.strength, ...session.rules])
    }
    case 'rules':
      return dedupe(req.rules)
    case 'brief':
    case 'activity':
      return null
  }
}

/**
 * The weeks a request reads: `last` is the week the ramp starts from and the weekly decision is
 * about, `next` the week they lead to. A decision request names the week decided; every other
 * request names the week that is planned (a session's week, the requested week, the current one).
 */
export function explainWeeks(
  req: ExplainRequest,
  ctx: Pick<ExplainContext, 'asOf' | 'input'>,
): { last: string; next: string } {
  let next: string
  if (req.subject === 'decision') return { last: req.weekStart, next: addDays(req.weekStart, 7) }
  if (req.subject === 'week' || req.subject === 'brief') next = req.weekStart
  else if (req.subject === 'session' || req.subject === 'strength') {
    const session = ctx.input.existing?.sessions.find((s) => s.id === req.id)
    next = mondayOf(session?.date ?? ctx.asOf)
  } else next = mondayOf(ctx.asOf)
  return { last: addDays(next, -7), next }
}

/** The rules that read the goal as the engine models it (`ExplainContext.race`). */
const RACE_RULES: ReadonlySet<string> = new Set(
  [
    'D1',
    'D2',
    'D3',
    'D4',
    'D5',
    'D6',
    'D7',
    'E2',
    'H2',
    'H4',
    'H5',
    'H6',
    'H10',
    'H12',
    'I2',
    'I3',
    'K1',
    'n-7',
  ].map(lower),
)

/** The rules that read the load setting (`ExplainContext.planInput`): the ramp, the cap, the start and g-8. */
const LOAD_SETTING_RULES: ReadonlySet<string> = new Set(['g-2', 'g-6', 'g-8', 'e6'])

/** The rules that read the strength engine's input (`ExplainContext.strength`). */
const STRENGTH_RULES: ReadonlySet<string> = new Set(['f7', 'f8', 'f9'])

/** Which values beyond the snapshot a set of rules reads, so the server computes only those. */
export function explainNeeds(rules: readonly string[]): {
  hrModel: boolean
  decision: boolean
  prediction: boolean
  race: boolean
  planInput: boolean
  strength: boolean
} {
  const keys = new Set(rules.map(lower))
  return {
    hrModel: keys.has('a8'),
    decision: keys.has('j5'),
    planInput: [...keys].some((key) => LOAD_SETTING_RULES.has(key)),
    // n-7 sizes the fluid-safety card from the goal time, else from the prediction
    prediction: EXPLAIN_RULES.prediction.some((rule) => keys.has(lower(rule))) || keys.has('n-7'),
    race: [...keys].some((key) => RACE_RULES.has(key)),
    strength: [...keys].some((key) => STRENGTH_RULES.has(key)),
  }
}

/**
 * The figures behind a request, rule by rule. A rule with figures to show becomes a group; a
 * rule with no builder, a policy-only rule and a rule whose builder has nothing to say for this
 * request are listed in `rest`. Unknown records give an empty view, and the server answers 404
 * before it gets here (`explainRules` is null).
 */
export function explainInputs(req: ExplainRequest, ctx: ExplainContext): ExplainView {
  const rules = explainRules(req, ctx) ?? []
  const session =
    req.subject === 'session' || req.subject === 'strength' ? sessionOf(ctx, req.id) : null
  const exercise = req.subject === 'strength' ? (req.exercise ?? null) : null
  const scope: Scope = { ctx, session, exercise, ...explainWeeks(req, ctx) }
  const groups: ExplainGroup[] = []
  const rest: string[] = []
  for (const rule of rules) {
    const facts = builderFor(rule)?.(scope) ?? []
    if (facts.length > 0) groups.push({ rule, facts })
    else rest.push(rule)
  }
  return { subject: req.subject, asOf: ctx.asOf, frozen: false, rules, groups, rest }
}

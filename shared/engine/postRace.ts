// The post-race recovery window [rules H12, J3, J7]: a hold without running, then 7-day return
// steps of easy running at a fraction of the pre-taper reference week, counted in days from the
// race (day 0) instead of in plan weeks. A check-in gate can only delay a stage boundary. Pure:
// the same race, history, check-ins and `today` give the same window; nothing keeps state.
//
// Vocabulary: `holdUntil` is the first day on which running is allowed, `quietUntil` the first day
// on which quality work (intervals, threshold, race pace, strides, hills, downhill) is allowed.
import { addDays, daysBetween } from '../dates.ts'
import type { Activity } from '../types.ts'
import { distanceClassOf } from './goal.ts'
import type { RunRecord } from './limits.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'
import { checkinsOf, J8_CHECKLIST, poorSubjective } from './readiness.ts'
import type {
  Checkin,
  EngineInput,
  EngineWarning,
  GoalModel,
  SessionSpec,
  WeekDraft,
} from './types.ts'

type RaceClass = GoalModel['distanceClass']

/** Guards float noise (10 * 1.5 = 15.000000000000002) before rounding up or down. */
const EPS = 1e-9

/** The race a window follows. */
export interface PostRaceRace {
  date: string
  distanceM: number
  /** Total descent in metres; null when the course descent is unknown. */
  lossM: number | null
  distanceClass: RaceClass
}

/** One 7-day return step. `from` and `to` are the first and last day, both included. */
export interface PostRaceStage {
  /** 1-based. */
  step: number
  from: string
  to: string
  /** Fraction of the pre-taper reference week. */
  fraction: number
  /** The most any run of the step may hold. */
  runMaxMin: number
  /** At most this many runs in the step (non-consecutive days); null where the step has no cap. */
  maxRuns: number | null
  /** The most the longest run of the step may hold. */
  longRunMaxMin: number
}

export interface PostRaceWindow {
  race: PostRaceRace
  /** The hold in days after the modifier; the first run falls on day `holdDays` (after the gate). */
  holdDays: number
  /** The hold of the race class before the modifier. */
  baseHoldDays: number
  /** True when the 1.5 modifier lengthened the hold. */
  modified: boolean
  /** First day on which running is allowed, after the gate. */
  holdUntil: string
  stages: PostRaceStage[]
  /** First day on which quality work is allowed: the day after the last step, after the gate. */
  quietUntil: string
  /** Days the check-in gate moved the end of the window past the default schedule. */
  extensionDays: number
}

/** What the window needs to know about the runner. */
export interface PostRaceAthlete {
  age: number | null
}

/** An earlier race, for the "first finish in the class" modifier. */
export interface PostRaceHistoryRace {
  date: string
  distanceM: number | null
}

// ---- the window ----

function baseHoldDays(distanceClass: RaceClass): number {
  switch (distanceClass) {
    case 'marathon':
      return P.h12HoldDays.marathon.value
    case 'ultra50':
      return P.h12HoldDays.ultra50.value
    case 'ultra100k':
      return P.h12HoldDays.ultra100k.value
    case 'ultra100mi':
      return P.h12HoldDays.ultra100mi.value
    case 'beyond':
      return P.h12HoldDays.beyond.value
    default:
      return 0
  }
}

/** Fractions of the 7-day steps by class: one step to a half marathon, two to 80.5 km, three beyond. */
function stepFractions(distanceClass: RaceClass): number[] {
  switch (distanceClass) {
    case 'marathon':
    case 'ultra50':
      return P.macroDesign.postRaceMarathonFractions.value
    case 'ultra100k':
    case 'ultra100mi':
    case 'beyond':
      return P.macroDesign.postRaceLongFractions.value
    default:
      return [P.macroDesign.postRaceReducedFraction.value]
  }
}

/** The hold of a race: the class value, times 1.5 (rounded up) once when a modifier applies [H12]. */
export function holdDaysOf(
  race: PostRaceRace,
  athlete: PostRaceAthlete,
  history: ReadonlyArray<PostRaceHistoryRace>,
): { days: number; base: number; modified: boolean } {
  const base = baseHoldDays(race.distanceClass)
  const descentPerKm =
    race.lossM !== null && race.distanceM > 0 ? race.lossM / (race.distanceM / 1000) : null
  const steep = descentPerKm !== null && descentPerKm + EPS >= P.h12.hillyDescentMPerKm.value
  const masters = athlete.age !== null && athlete.age >= P.f5.mastersMinAge.value
  const firstInClass = !history.some(
    (h) =>
      h.distanceM !== null &&
      h.distanceM > 0 &&
      h.date < race.date &&
      distanceClassOf(h.distanceM) === race.distanceClass,
  )
  const modified = steep || masters || firstInClass
  return {
    days: modified ? Math.max(0, Math.ceil(base * P.h12.modifierMultiplier.value - EPS)) : base,
    base,
    modified,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

type ItemMedians = {
  fatigue: number | null
  soreness: number | null
  stress: number | null
  sleepQuality: number | null
  mood: number | null
}

/**
 * The own pre-race median of every check-in item, when at least 14 check-ins fall in the 28 days
 * before the race; null otherwise. An item with no value in the window has no median.
 */
function ownBaseline(race: PostRaceRace, checkins: ReadonlyArray<Checkin>): ItemMedians | null {
  const from = addDays(race.date, -28)
  const to = addDays(race.date, -1)
  const before = checkins.filter((c) => c.date >= from && c.date <= to)
  if (before.length < P.h12.ownBaselineMinCheckins.value) return null
  const of = (pick: (c: Checkin) => number | null): number | null => {
    const values = before.map(pick).filter((v): v is number => v !== null)
    return values.length === 0 ? null : median(values)
  }
  return {
    fatigue: of((c) => c.fatigue),
    soreness: of((c) => c.soreness),
    stress: of((c) => c.stress),
    sleepQuality: of((c) => c.sleepQuality),
    mood: of((c) => c.mood),
  }
}

/** True when a check-in is worse than the own median by the J2 margin (one item, or the sum). */
function worseThanOwn(checkin: Checkin, own: ItemMedians): boolean {
  const up = (v: number | null, m: number | null) =>
    v === null || m === null ? 0 : Math.max(0, v - m)
  const down = (v: number | null, m: number | null) =>
    v === null || m === null ? 0 : Math.max(0, m - v)
  const items = [
    up(checkin.fatigue, own.fatigue),
    up(checkin.soreness, own.soreness),
    up(checkin.stress, own.stress),
    down(checkin.sleepQuality, own.sleepQuality),
    down(checkin.mood, own.mood),
  ]
  return (
    Math.max(...items) >= P.j2.poorItemBadness.value ||
    items.reduce((sum, v) => sum + v, 0) >= P.j2.poorTotalBadness.value
  )
}

/**
 * A check-in that holds a stage: poor on the fixed J2 scale or against the own pre-race median,
 * any pain (n1, n2), or illness (n3). Pain of any score counts: the gate only delays.
 */
function holdsStage(checkin: Checkin, own: ItemMedians | null): boolean {
  return (
    poorSubjective(checkin) ||
    (own !== null && worseThanOwn(checkin, own)) ||
    checkin.illness ||
    checkin.painFocalBone ||
    (checkin.painScore !== null && checkin.painScore > 0)
  )
}

/**
 * The window after a race [rules H12]. Day 0 is the race day: the hold covers days 0 to
 * `holdDays - 1`, step k the 7 days from `holdDays + 7(k - 1)`, and quality starts the day after
 * the last step.
 *
 * Check-in gate, delay only: a stage boundary b moves one day later while the last 2 check-ins
 * before it (after the race, and none after `today`) are not clean, tested day by day up to
 * `today`; the boundaries after it move by the same days. Without check-ins the default schedule
 * runs. Nothing here shortens or advances a stage.
 */
export function postRaceWindow(
  race: PostRaceRace,
  athlete: PostRaceAthlete,
  history: ReadonlyArray<PostRaceHistoryRace>,
  checkins: ReadonlyArray<Checkin>,
  today: string,
): PostRaceWindow {
  const hold = holdDaysOf(race, athlete, history)
  const fractions = stepFractions(race.distanceClass)
  const stepDays = P.h12.reducedDays.value
  const own = ownBaseline(race, checkins)
  const after = checkins
    .filter((c) => c.date > race.date && c.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const clean = (boundary: string): boolean =>
    after
      .filter((c) => c.date < boundary)
      .slice(0, P.h12.advanceCleanCheckins.value)
      .every((c) => !holdsStage(c, own))

  // boundary 0 ends the hold, boundary k the k-th step; the last one is the end of the window
  const bounds: string[] = []
  let extension = 0
  for (let k = 0; k <= fractions.length; k++) {
    let boundary = addDays(race.date, hold.days + stepDays * k + extension)
    while (boundary <= today && !clean(boundary)) {
      boundary = addDays(boundary, 1)
      extension += 1
    }
    bounds.push(boundary)
  }

  const stages: PostRaceStage[] = fractions.map((fraction, i) => {
    const first = i === 0
    const later = i >= 2
    return {
      step: i + 1,
      from: bounds[i]!,
      to: addDays(bounds[i + 1]!, -1),
      fraction,
      runMaxMin: first ? P.h12.step1RunMaxMin.value : P.h12.step2RunMaxMin.value,
      maxRuns: first ? P.h12.step1MaxRuns.value : null,
      longRunMaxMin: later
        ? P.h12.laterStepLongRunMaxMin.value
        : first
          ? P.h12.step1RunMaxMin.value
          : P.h12.step2RunMaxMin.value,
    }
  })
  return {
    race,
    holdDays: hold.days,
    baseHoldDays: hold.base,
    modified: hold.modified,
    holdUntil: bounds[0]!,
    stages,
    quietUntil: bounds[bounds.length - 1]!,
    extensionDays: extension,
  }
}

// ---- the windows of an engine input ----

/** The windows an input has: the goal race (projected) and a past race still in its window. */
export interface PostRaceWindows {
  /** After the plan's own goal race; counted from the goal date, whether or not it has passed. */
  own: PostRaceWindow
  /**
   * After a completed race of marathon distance or longer in the history, while `today` is before
   * its `quietUntil`. A new plan built inside it follows the rest of the window [H12].
   */
  past: PostRaceWindow | null
}

const isCompletedRace = (a: Activity) =>
  a.type === 'race' && a.duplicateOfId === null && !isDuplicate(a)

/** Age as the athlete state computes it: the calendar year of `today` less the birth year. */
function ageOf(input: EngineInput): number | null {
  return input.profile.birthYear === null
    ? null
    : Number(input.today.slice(0, 4)) - input.profile.birthYear
}

/** Descent only counts when it is known and positive. */
const lossOf = (loss: number | null) => (loss !== null && loss > 0 ? loss : null)

/** True for a class of marathon distance or longer: the races whose window a new plan follows. */
const isMarathonOrLonger = (distanceClass: RaceClass) =>
  distanceClass !== '5k' && distanceClass !== '10k' && distanceClass !== 'half'

/** The window after the plan's own goal race, projected from the goal date. */
export function ownWindow(input: EngineInput): PostRaceWindow {
  const { goal } = input
  return postRaceWindow(
    {
      date: goal.date,
      distanceM: goal.distanceM,
      lossM: lossOf(goal.lossM),
      distanceClass: goal.distanceClass,
    },
    { age: ageOf(input) },
    input.activities.filter(isCompletedRace),
    checkinsOf(input),
    input.today,
  )
}

export function postRaceWindows(input: EngineInput): PostRaceWindows {
  const { goal, today } = input
  const checkins = checkinsOf(input)
  const athlete = { age: ageOf(input) }
  const races = input.activities.filter(isCompletedRace)
  const own = ownWindow(input)

  const horizon = addDays(today, -P.a5.historyWindowDays.value)
  let past: PostRaceWindow | null = null
  for (const a of races) {
    if (a.distanceM === null || a.distanceM <= 0 || a.date > today || a.date < horizon) continue
    const distanceClass = distanceClassOf(a.distanceM)
    if (!isMarathonOrLonger(distanceClass)) continue
    // the race of the goal itself is the projected window, never a past one
    if (a.date === goal.date && a.distanceM === goal.distanceM) continue
    const window = postRaceWindow(
      {
        date: a.date,
        distanceM: a.distanceM,
        lossM: lossOf(a.elevationLossM),
        distanceClass,
      },
      athlete,
      races,
      checkins,
      today,
    )
    if (today >= window.quietUntil) continue
    if (past === null || window.quietUntil > past.quietUntil) past = window
  }
  return { own, past }
}

/** The windows that constrain the plan's days: a past race's, and the goal race's once it is ahead. */
export function planWindows(input: EngineInput): PostRaceWindow[] {
  const { own, past } = postRaceWindows(input)
  return [...(past === null ? [] : [past]), ...(input.goal.date >= input.today ? [own] : [])]
}

// ---- days, stages, limits ----

/** The last day of a window: the day before quality work is allowed. */
export const lastWindowDay = (window: PostRaceWindow): string => addDays(window.quietUntil, -1)

/** Where a date falls in a window: the hold, a step, or outside it (null). */
export function windowDay(
  window: PostRaceWindow,
  date: string,
): { kind: 'hold' } | { kind: 'step'; stage: PostRaceStage } | null {
  if (date < window.race.date || date >= window.quietUntil) return null
  if (date < window.holdUntil) return { kind: 'hold' }
  const stage = window.stages.find((s) => date >= s.from && date <= s.to)
  return stage === undefined ? null : { kind: 'step', stage }
}

/** What the windows allow on a date; the most restrictive limit where two windows overlap. */
export interface DayLimit {
  hold: boolean
  /** The step number (1-based), 0 during the hold. */
  step: number
  runMaxMin: number
  longRunMaxMin: number
  /** The step-1 cap on runs; null where no window caps them. */
  maxRuns: number | null
}

export function dayLimit(windows: readonly PostRaceWindow[], date: string): DayLimit | null {
  let out: DayLimit | null = null
  for (const w of windows) {
    const day = windowDay(w, date)
    if (day === null) continue
    const next: DayLimit =
      day.kind === 'hold'
        ? { hold: true, step: 0, runMaxMin: 0, longRunMaxMin: 0, maxRuns: 0 }
        : {
            hold: false,
            step: day.stage.step,
            runMaxMin: day.stage.runMaxMin,
            longRunMaxMin: day.stage.longRunMaxMin,
            maxRuns: day.stage.maxRuns,
          }
    out =
      out === null
        ? next
        : {
            hold: out.hold || next.hold,
            step: Math.min(out.step, next.step),
            runMaxMin: Math.min(out.runMaxMin, next.runMaxMin),
            longRunMaxMin: Math.min(out.longRunMaxMin, next.longRunMaxMin),
            maxRuns:
              out.maxRuns === null
                ? next.maxRuns
                : next.maxRuns === null
                  ? out.maxRuns
                  : Math.min(out.maxRuns, next.maxRuns),
          }
  }
  return out
}

/** True while quality work is off: from the race day to the day before `quietUntil`, in any window. */
export function inQuietPeriod(windows: readonly PostRaceWindow[], date: string): boolean {
  return windows.some((w) => date >= w.race.date && date < w.quietUntil)
}

/** The copy of a hold day [H12]: rest, with walking and easy movement allowed. */
export function holdPurpose(window: PostRaceWindow): string {
  return `Rest. Walking and easy movement are fine; no running until ${window.holdUntil}.`
}

/** The title of a run inside the window; the wording never blames the runner. */
export function afterRaceTitle(durationMin: number): string {
  return `After the race: easy ${durationMin} min`
}

/** The stage a date is in, as the weekly decision words it. */
export function stageLabel(window: PostRaceWindow, date: string): string {
  const day = windowDay(window, date)
  if (day === null || day.kind === 'hold') {
    return `After the race: rest, no running until ${window.holdUntil}`
  }
  return `After the race, step ${day.stage.step} of ${window.stages.length}`
}

// ---- weeks ----

/**
 * The Monday weeks of a window as plan weeks [H12]. A week's target is the sum over the steps it
 * overlaps of the step's fraction times the reference week times the share of the week the step
 * covers (days after the hold, over 7); a week inside the hold has none. Runs are capped by the
 * step caps and, in step 1, by the run count. Flag `post-race`, recovery, no quality.
 */
export function windowWeeks(
  window: PostRaceWindow,
  args: {
    weekStarts: string[]
    firstIndex: number
    /** The pre-taper reference week in minutes. */
    reference: number
    /** Run days of the reference week. */
    referenceRunDays: number
  },
): WeekDraft[] {
  const { reference, referenceRunDays } = args
  return args.weekStarts.map((weekStart, k) => {
    let minutes = 0
    let openDays = 0
    let step1 = false
    let runMax = 0
    let longMax = 0
    let lastStep = 0
    for (let d = 0; d < 7; d++) {
      const day = windowDay(window, addDays(weekStart, d))
      if (day === null || day.kind === 'hold') continue
      const { stage } = day
      openDays += 1
      minutes += (stage.fraction * reference) / 7
      step1 = step1 || stage.maxRuns !== null
      runMax = Math.max(runMax, stage.runMaxMin)
      longMax = Math.max(longMax, stage.longRunMaxMin)
      lastStep = stage.step
    }
    const runDays =
      openDays === 0
        ? 0
        : Math.min(
            Math.max(1, referenceRunDays),
            openDays,
            step1 ? P.h12.step1MaxRuns.value : Infinity,
          )
    // what the caps let the week hold: every run at the run cap, one of them at the long cap
    const capacity = runDays * runMax + Math.max(0, longMax - runMax)
    const target = openDays === 0 ? 0 : Math.min(Math.floor(minutes + EPS), capacity)
    const rest = target === 0
    // from the third step one run of the week may reach the long cap: about a third of the week
    const longRun =
      rest || longMax <= runMax
        ? 0
        : Math.min(
            longMax,
            Math.max(
              Math.floor(target * P.macroDesign.longRunShareOfWeek.value + EPS),
              Math.ceil(target / runDays),
            ),
          )
    return {
      weekStart,
      index: args.firstIndex + k,
      phase: 'race',
      focus: rest
        ? 'After the race: rest'
        : `After the race: easy running (step ${lastStep} of ${window.stages.length})`,
      targetRunMin: target,
      longRunMin: longRun,
      longRunM: null,
      gainTargetM: null,
      runDays: rest ? 0 : runDays,
      qualitySessions: 0,
      strengthSessions: 0,
      tid: { z1: 100, z2: 0, z3: 0 },
      flags: ['post-race'],
      isRecovery: true,
      isTaper: false,
    }
  })
}

/**
 * The runs the post-race weeks hold, for the 30-day reference of the weeks after them [rules G-1,
 * H12]: one record a week, the week's longest run, dated on the first day the week can hold it so
 * the reference is never overstated.
 */
export function windowRuns(window: PostRaceWindow, weeks: ReadonlyArray<WeekDraft>): RunRecord[] {
  const out: RunRecord[] = []
  for (const week of weeks) {
    if (week.targetRunMin <= 0 || week.runDays <= 0) continue
    const date = [0, 1, 2, 3, 4, 5, 6]
      .map((d) => addDays(week.weekStart, d))
      .find((d) => windowDay(window, d)?.kind === 'step')
    if (date === undefined) continue
    const longest = Math.max(week.longRunMin, Math.ceil(week.targetRunMin / week.runDays))
    out.push({ date, min: longest, distanceM: null, gainM: null, lossM: null })
  }
  return out
}

/** The Mondays of the post-race weeks that cover a window, from `firstMonday` to its last day. */
export function windowMondays(
  window: PostRaceWindow,
  firstMonday: string,
  limit?: string,
): string[] {
  const out: string[] = []
  const last = lastWindowDay(window)
  for (let m = firstMonday; m <= last && (limit === undefined || m < limit); m = addDays(m, 7)) {
    out.push(m)
  }
  return out
}

// ---- checks ----

/** Run kinds that count as running on a hold day. */
const RUNNING: ReadonlySet<SessionSpec['kind']> = new Set([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'b2b',
])

/** Kinds that are quality work: nothing of these before `quietUntil`. */
const QUIET_KINDS: ReadonlySet<SessionSpec['kind']> = new Set([
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'long-fast-finish',
  'b2b',
])

/**
 * What breaks the window in a list of sessions from `from` on: a run in the hold, a run above its
 * step cap, more or consecutive runs in step 1, and quality work or a downhill emphasis before
 * `quietUntil`. Empty when the window holds [rules H12].
 */
export function windowViolations(
  sessions: ReadonlyArray<SessionSpec>,
  windows: readonly PostRaceWindow[],
  from: string,
): string[] {
  const failures: string[] = []
  const runs = sessions.filter((s) => s.date >= from && RUNNING.has(s.kind))
  for (const s of runs) {
    const limit = dayLimit(windows, s.date)
    if (limit?.hold === true) {
      failures.push(`${s.date}: a ${s.kind} run falls inside the hold after the race`)
      continue
    }
    if (limit !== null && s.durationMin > limit.longRunMaxMin) {
      failures.push(
        `${s.date}: ${s.durationMin} min is above the ${limit.longRunMaxMin} min cap of step ${limit.step}`,
      )
    }
  }
  for (const s of sessions) {
    if (s.date < from || !inQuietPeriod(windows, s.date)) continue
    if (QUIET_KINDS.has(s.kind) || s.flags.includes('downhill')) {
      failures.push(`${s.date}: ${s.kind} work falls before the end of the post-race window`)
    }
  }
  for (const w of windows) {
    const first = w.stages[0]
    if (first === undefined || first.maxRuns === null) continue
    const days = runs
      .filter((s) => s.date >= first.from && s.date <= first.to)
      .map((s) => s.date)
      .sort()
    const unique = [...new Set(days)]
    if (unique.length > first.maxRuns) {
      failures.push(`step 1 holds ${unique.length} run days, above ${first.maxRuns}`)
    }
    for (let i = 1; i < unique.length; i++) {
      if (daysBetween(unique[i - 1]!, unique[i]!) < 2) {
        failures.push(`step 1 has runs on consecutive days (${unique[i - 1]} and ${unique[i]})`)
      }
    }
  }
  return failures
}

/**
 * The warning once the gate has delayed a window the escalation days (14): the J8 checklist copy
 * [rules H12, J8]. Check-ins can only delay; this tells the runner that a long delay is worth a
 * conversation with a clinician.
 */
export function postRaceWarnings(windows: readonly PostRaceWindow[]): EngineWarning[] {
  return windows
    .filter((w) => w.extensionDays >= P.h12.gateEscalationDays.value)
    .map((w) => ({
      code: 'post-race-gate',
      severity: 'warn' as const,
      message: `Check-ins after the race have kept the return at its current step for ${w.extensionDays} days, so the window now ends on ${w.quietUntil}. A lighter plan may help. ${J8_CHECKLIST}`,
      rules: ['H12', 'J8'],
    }))
}

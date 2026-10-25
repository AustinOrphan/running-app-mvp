// The safety limits that planning and checking share [rules g-1 to g-3, H2 to H4]: the 30-day
// reference of the session spike guard and the most a run may hold against it, the largest 2-day
// total of the back-to-back rule, the weekly ramp with its baselines, the tightened profiles, the
// weekly gain ramp and the ultra cap on a single run. The macrocycle and the week placement plan
// inside these numbers and the guards and the checklist check against the same ones, so a
// generated plan needs no trimming. The rebuild zone of rule g-8 (a larger soft step below a
// ceiling taken from the runner's recent weeks) is part of that ramp (`RampContext.rebuild`), and so
// is the response to weeks run above plan (`RampContext.response`): the one function
// `responseBaseline` gives the baseline the step applies to, to the generator and to the limits
// alike. The most a week target the runner raised by hand may stay at is read from the same ramp
// (`targetLimit`). Pure: no I/O, no clock.
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import type { Activity, TargetLimitKind } from '../types.ts'
import { isDisruptedWeek } from './disruption.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'
import { isLadderSession, startKind, startWeek, type StartPath } from './startWeeks.ts'
import type { AthleteState, SessionKind, SessionSpec, WeekDraft } from './types.ts'

/** Guards float noise (100 * 1.1 = 110.00000000000001) before rounding down. */
export const EPS = 1e-9

/** Whole minutes, rounded down so the number never passes the cap it came from [rules g-6]. */
export const wholeMinutes = (minutes: number): number => Math.floor(minutes + EPS)

/**
 * Planned session kinds that count toward the weekly running minutes and the 30-day reference. A
 * planned race and a hike do not: the weeks before the plan (`state.weeks.runMin`) leave races out
 * too. A completed race is a different matter: one shorter than the marathon distance is a run in
 * the 30-day reference, a longer one is not (`countsTowardReference`).
 */
export const VOLUME_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
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

// ---- session spike guard [rules g-1, H4] ----

/** One completed or projected run. */
export interface RunRecord {
  date: string
  min: number
  distanceM: number | null
  gainM: number | null
  lossM: number | null
}

/** Maxima of a 30-day window; null where no run of the window records that dimension. */
export interface SpikeReference {
  min: number
  distanceM: number | null
  gainM: number | null
  lossM: number | null
}

/** What a plan is compared with before its own runs: the completed runs, or the state's maxima. */
export interface CompletedReference {
  runs: RunRecord[]
  /** The state's largest 2-day total, used only when the history holds no run. */
  virtualTwoDay: Array<{ date: string; min: number }>
}

/**
 * Whether a completed activity is a run of the 30-day reference [rules g-1]. A race counts as a run
 * when it is shorter than the marathon distance (`g1.referenceRaceMaxM`); a race without a distance
 * counts when it lasted no longer than `g1.referenceRaceMaxHours`. A marathon or longer would
 * otherwise let training runs reach 1.10 times the race. Duplicates are the caller's business
 * (`isCounted`).
 */
export function countsTowardReference(a: Activity): boolean {
  if (a.type === 'run') return true
  if (a.type !== 'race') return false
  if (a.distanceM === null) return a.durationSec <= P.g1.referenceRaceMaxHours.value * 3600
  return a.distanceM < P.g1.referenceRaceMaxM.value
}

/**
 * The one predicate for "counts" in the reference and the gain ramp: the duplicate status alone
 * decides, as in `estimateState`, `aggregateWeeks` and the execution. A `possible` or `confirmed`
 * duplicate is out; a duplicate the owner dismissed keeps its `duplicateOfId` and is a real run
 * [rules g-1].
 */
const isCounted = (a: Activity) => countsTowardReference(a) && !isDuplicate(a)

/**
 * The completed runs of `history`; when it holds none, one record the day before `state.asOf` with
 * the state's 30-day maxima (an unknown maximum is stored as 0 there, so 0 reads as not recorded).
 */
export function completedReference(history: Activity[], state: AthleteState): CompletedReference {
  const runs: RunRecord[] = history.filter(isCounted).map((a) => ({
    date: a.date,
    min: a.durationSec / 60,
    distanceM: a.distanceM,
    gainM: a.elevationGainM,
    lossM: a.elevationLossM,
  }))
  const virtualTwoDay: CompletedReference['virtualTwoDay'] = []
  if (runs.length === 0) {
    const longest = state.longest30d
    const date = addDays(state.asOf, -1)
    if (longest.durationSec > 0 || longest.distanceM > 0) {
      runs.push({
        date,
        min: longest.durationSec / 60,
        distanceM: longest.distanceM > 0 ? longest.distanceM : null,
        gainM: longest.gainM > 0 ? longest.gainM : null,
        lossM: longest.lossM > 0 ? longest.lossM : null,
      })
    }
    if (longest.twoDaySec > 0) virtualTwoDay.push({ date, min: longest.twoDaySec / 60 })
  }
  return { runs, virtualTwoDay }
}

/** A planned run as a record; descent is estimated by the gain (a loop course). */
export function recordOf(s: SessionSpec): RunRecord {
  return {
    date: s.date,
    min: s.durationMin,
    distanceM: s.distanceM,
    gainM: s.gainM,
    lossM: s.gainM,
  }
}

/**
 * Maxima of the runs dated from `from` to `to`, both included. A distance of 0 is a run without a
 * recorded distance; a gain of 0 is a flat run and counts.
 */
export function referenceBetween(runs: RunRecord[], from: string, to: string): SpikeReference {
  const ref: SpikeReference = { min: 0, distanceM: null, gainM: null, lossM: null }
  const max = (a: number | null, b: number | null) => (b === null ? a : Math.max(a ?? 0, b))
  for (const r of runs) {
    if (r.date < from || r.date > to) continue
    ref.min = Math.max(ref.min, r.min)
    ref.distanceM = max(ref.distanceM, r.distanceM !== null && r.distanceM > 0 ? r.distanceM : null)
    ref.gainM = max(ref.gainM, r.gainM)
    ref.lossM = max(ref.lossM, r.lossM)
  }
  return ref
}

/** The 30-day reference of a run on `date`: the runs of the 30 days before it. */
export function referenceAt(runs: RunRecord[], date: string): SpikeReference {
  return referenceBetween(runs, addDays(date, -P.g1.windowDays.value), addDays(date, -1))
}

/** The top of the normal band: 1.10x the reference, or the reference plus the minimum step. */
export function spikeWarnLimit(ref: number, minStep: number): number {
  return ref + Math.max(ref * (P.g1.spikeRatioWarn.value - 1), minStep)
}

/** Above this the generator never schedules a run without an explicit override. */
export function spikeOverrideLimit(ref: number, minStep: number): number {
  return Math.max(ref * P.g1.spikeRatioOverride.value, spikeWarnLimit(ref, minStep))
}

/** The most a run may hold on each dimension and stay in the normal band; Infinity where unchecked. */
export interface RunCaps {
  min: number
  distanceM: number
  gainM: number
}

/**
 * The normal band of a reference, rounded down to whole minutes and metres. Without a run in the
 * window nothing is compared; a dimension no run of the window records is not compared either.
 */
export function runCaps(ref: SpikeReference): RunCaps {
  if (ref.min <= 0) return { min: Infinity, distanceM: Infinity, gainM: Infinity }
  const gainStep = P.h4.minStepGainM.value
  const down = (v: number) => Math.floor(v + EPS)
  return {
    min: down(spikeWarnLimit(ref.min, P.g1.minStepMin.value)),
    distanceM:
      ref.distanceM === null
        ? Infinity
        : down(spikeWarnLimit(ref.distanceM, P.g1.minStepDistanceM.value)),
    gainM: Math.min(
      ref.gainM === null ? Infinity : down(spikeWarnLimit(ref.gainM, gainStep)),
      ref.lossM === null ? Infinity : down(spikeWarnLimit(ref.lossM, gainStep)),
    ),
  }
}

/** Largest total of two consecutive days among `runs` in the 30 days before `date` [rules H3]. */
export function twoDayReference(
  runs: RunRecord[],
  virtualTwoDay: CompletedReference['virtualTwoDay'],
  date: string,
): number {
  const window = P.g1.windowDays.value
  const perDay = new Map<string, number>()
  for (const r of runs) {
    const ago = daysBetween(r.date, date)
    if (ago >= 1 && ago <= window) perDay.set(r.date, (perDay.get(r.date) ?? 0) + r.min)
  }
  let best = 0
  for (let ago = window; ago >= 2; ago -= 1) {
    const first = addDays(date, -ago)
    best = Math.max(best, (perDay.get(first) ?? 0) + (perDay.get(addDays(first, 1)) ?? 0))
  }
  for (const entry of virtualTwoDay) {
    const ago = daysBetween(entry.date, date)
    if (ago >= 1 && ago <= window) best = Math.max(best, entry.min)
  }
  return best
}

/** The longest single run of an ultra plan: the lesser of 6 h and 60% of the race [rules H2]. */
export function ultraRunCapMin(raceDurationSec: number | null | undefined): number | null {
  if (raceDurationSec === null || raceDurationSec === undefined || raceDurationSec <= 0) return null
  return Math.floor(
    Math.min(
      P.h2.longestRunCapHours.value * 60,
      (raceDurationSec / 60) * P.h2.longestRunCapRaceFraction.value,
    ) + EPS,
  )
}

// ---- weekly ramp [rules g-2, g-3] ----

/**
 * True while the tightened recent-injury profile applies [rules g-3, J9, n-2]: an injury in the
 * profile within the recent window, or an injury report of a rest window that is active or still
 * ahead. The weekly ramp, the hard G-1 limit, the checklist's spike item and the start path read
 * this; the recovery cadence reads `risk.recentInjury` alone, because a report does not change it.
 */
export function injuryTight(state: AthleteState): boolean {
  return state.risk.recentInjury || state.risk.injuryReport === true
}

/** The lowest weekly ramp of the athlete's tightened profiles, or null for the default profile. */
export function tightRamp(state: AthleteState): number | null {
  const caps: number[] = []
  if (injuryTight(state)) caps.push(P.g3.recentInjuryRamp.value[1])
  if (state.risk.priorBsi) caps.push(P.g3.priorBsiRampMax.value)
  if (state.risk.bsiFactors >= P.g3.bsiFactorsForCap.value) {
    caps.push(P.g2.rampSoft.value * P.g3.bsiRampFactor.value)
  }
  return caps.length === 0 ? null : Math.min(...caps)
}

/** The weekly ramp the generator plans with: the soft ramp, or the lower one of a profile [G-2, G-3]. */
export function weeklyRamp(state: AthleteState): number {
  let ramp = P.g2.rampSoft.value
  if (injuryTight(state)) ramp = Math.min(ramp, P.g3.recentInjuryRamp.value[0])
  if (state.risk.priorBsi) ramp = Math.min(ramp, P.g3.priorBsiRampMax.value)
  if (state.risk.bsiFactors >= P.g3.bsiFactorsForCap.value) {
    ramp = Math.min(ramp, P.g2.rampSoft.value * P.g3.bsiRampFactor.value)
  }
  return ramp
}

/**
 * The weekly running minutes a plan starts from [rules E6]: the typical week (the median of the
 * last 4 weeks with a run), or the recent level (the lesser of the last two complete weeks) when
 * that is higher. A step up held for two weeks sets the level; one big week alone does not.
 */
export function startLevelMin(state: AthleteState): number {
  return Math.max(state.typicalWeekMin, state.recentWeekMin)
}

/**
 * The minutes of the 3 x 20 starting week when the runner's start level sits under it
 * (sessions x session length): null above it, with no start level, and for the tightened
 * profiles, which are not lifted [design-macro, rules g-3]. The stand-in for the start path of
 * `startPath` (macro.ts) where only the athlete state is at hand.
 */
export function restartFloorMin(state: AthleteState): number | null {
  const minutes = P.restartFloor.sessions.value * P.restartFloor.sessionMin.value
  const level = startLevelMin(state)
  if (level <= 0 || level >= minutes) return null
  if (weeklyRamp(state) < P.g2.rampSoft.value) return null
  return minutes
}

/**
 * The weekly running minutes a new plan starts from: the first week of the start path when it is
 * the 3 x N floor or a run-walk rung, else the start level (`startLevelMin`), else the start floor
 * of a runner without recent running. The feasibility label of an ultra [rules D4] reads it.
 * `path` is the result of `startPath` (macro.ts); null means the plan starts from the start level,
 * and so does an injury-return path, whose levels set their own pace. Left out, the 3 x 20 week
 * stands in for a start level under it.
 */
export function startWeekMin(state: AthleteState, path?: StartPath | null): number {
  if (path !== undefined && path !== null && path.kind !== 'injury-return') {
    return startWeek(path.kind, path.kind === 'ladder' ? path.rung : path.sessionMin).minutes
  }
  const floor = path === undefined ? restartFloorMin(state) : null
  if (floor !== null) return floor
  const level = startLevelMin(state)
  return level > 0 ? level : P.macroDesign.startFloorWeekMin.value
}

/**
 * Novices and low-frequency runners (completed runs under 2 a week) progress by time, with a
 * minimum step, and recover on the 2:1 cadence [rules A5, g-2, E3].
 */
export function noviceRamp(state: AthleteState): boolean {
  return state.experience === 'novice' || state.lowFrequency
}

/** `from` plus the ramp, or plus the novice minimum step when that is larger [rules g-2]. */
export function rampStep(from: number, ramp: number, novice: boolean): number {
  const minStep = novice ? P.g2.noviceMinStepMin.value : 0
  return from + Math.max(from * ramp, minStep)
}

/**
 * Weeks that never set a ramp baseline: the planned recovery and taper weeks, and the current week
 * when `today` is after its Monday, whatever has been logged in it, because part of a week is not a
 * week [rules g-2].
 */
export function rampSkipWeeks(today: string, lowWeeks: Iterable<string>): Set<string> {
  const skip = new Set(lowWeeks)
  const monday = mondayOf(today)
  if (today > monday) skip.add(monday)
  return skip
}

const PLANNED_FLAG = 'planned-'

/**
 * The flags of a loading week that was run past its target [rules g-2, g-6]: `overshoot`, and
 * `planned-<n>`, the minutes the week was planned at. The target of such a week is the minutes run
 * (they are a fact); the flags survive the stored plan, so a re-plan in the same week still draws
 * the weeks after it from the planned minutes and the overshoot never lifts them or makes
 * anything up.
 */
export const overshootFlags = (plannedMin: number): string[] => [
  'overshoot',
  `${PLANNED_FLAG}${String(plannedMin)}`,
]
/** The minutes a week was planned at: its target, unless the week was run past it. */
export function plannedMinOf(week: Pick<WeekDraft, 'targetRunMin' | 'flags'>): number {
  if (!week.flags.includes('overshoot')) return week.targetRunMin
  for (const flag of week.flags) {
    if (!flag.startsWith(PLANNED_FLAG)) continue
    const n = Number(flag.slice(PLANNED_FLAG.length))
    if (Number.isInteger(n) && n >= 0) return Math.min(n, week.targetRunMin)
  }
  return week.targetRunMin
}

/**
 * The weeks of a start path that follow a fixed programme [rules E6, g-3]: `soft` weeks (the
 * run-walk ladder) are exempt from the soft 10% warning only, never from the 2-week ceiling.
 * `ramp` weeks (the injury-return ladder, whose levels set the load) are exempt from the whole
 * weekly ramp: the soft step, the tightened profile ramp and the ceiling. Each of their runs is
 * held to 1.10x the longest completed run instead (G-1 is a hard limit under G-3), which keeps a
 * week within about 10% of the one before.
 */
export type RampExemption = 'soft' | 'ramp'

/**
 * The rebuild zone of a plan [rules g-8]: below `ceilingMin` the soft step of a loading week is
 * `step` instead of the usual 10%. Absent at steady and wherever the load setting is held at
 * steady (`rebuildZone`, loadSetting.ts, is the one place that builds it).
 */
export interface RebuildZone {
  /** The rebuild ceiling R in minutes: the position's credit x the block's taper x the block. */
  ceilingMin: number
  /** The weekly step of a week whose baseline is under `ceilingMin`, as a fraction. */
  step: number
}

/**
 * The weekly rate at which two weeks meet the hard ceiling of G-2, `sqrt(1 + g2.rampCeilingTwoWeeks)
 * - 1` (14.0%): the step of the upper position [rules g-8]. Derived from the ceiling, so it cannot
 * pass it and moves with it.
 */
export function ceilingWeeklyRate(): number {
  return Math.sqrt(1 + P.g2.rampCeilingTwoWeeks.value) - 1
}

/**
 * The most a loading week may be planned at over a baseline `from` before the soft step warns
 * [rules g-8, g-2]: `from` plus the usual `ramp`, and below the rebuild ceiling the larger of that
 * and the zone's step, clamped so that the zone never plans a week above R except by the usual
 * step: max(from x (1 + ramp), min(from x (1 + step), R)). Without a zone, and from R up, it is
 * `rampStep` (the novice minimum step included).
 */
export function rebuildStep(
  from: number,
  ramp: number,
  novice: boolean,
  rebuild: RebuildZone | null,
): number {
  const usual = rampStep(from, ramp, novice)
  if (rebuild === null || from >= rebuild.ceilingMin) return usual
  return Math.max(usual, Math.min(rampStep(from, rebuild.step, novice), rebuild.ceilingMin))
}

/**
 * The response to weeks run above plan [rules g-8], as the generator and the limits read it: the
 * mean of the minutes the runner ran over the last eligible weeks. It is a fact of the athlete
 * state at the day of the plan, the same for every week the plan draws; the chain of planned weeks
 * overtakes it within a few weeks. A `RampContext` holds null at steady and wherever the load
 * setting is held at steady (`responseBasis`, loadSetting.ts, is the one place that builds it).
 */
export interface ResponseBasis {
  /**
   * The mean of the minutes run in the last `g8.responseWeeks` eligible complete weeks, or null
   * when the state holds fewer than that many: the position applies and the response has nothing
   * to read (`recentRunMean`).
   */
  meanMin: number | null
}

/** What the weekly ramp of a plan is computed from. */
export interface RampContext {
  /** Running minutes by Monday: the completed weeks, then the planned ones. */
  volumes: ReadonlyMap<string, number>
  /** Weeks that are no baseline (`rampSkipWeeks`). */
  skip: ReadonlySet<string>
  /**
   * The first week of a start path [rules E6]: exempt from G-2 up to its minutes, and a baseline
   * at those minutes for the weeks after it, a part week included.
   */
  floor: { weekStart: string; minutes: number } | null
  /** The later weeks of a start path by Monday, and what each is exempt from. */
  exempt?: ReadonlyMap<string, RampExemption>
  typicalWeekMin: number
  novice: boolean
  /** `tightRamp(state)`. */
  tight: number | null
  /**
   * The rebuild zone of the plan [rules g-8], or null (steady, a held setting, no history). Every
   * builder of a context sets it through `rampBasis`, so the generator, the guards, the checklist
   * and `targetLimit` read one zone.
   */
  rebuild: RebuildZone | null
  /**
   * The response to weeks run above plan [rules g-8], or null (steady, a held setting). Set through
   * `rampBasis` like the zone; `responseBaseline` is the one function that reads it.
   */
  response: ResponseBasis | null
}

/**
 * The parts of a `RampContext` that come from the athlete and the plan's load setting: the typical
 * week, the novice minimum step, the tightened profile's ramp, the rebuild zone and the response
 * to weeks run above plan. The one function every builder of a context calls (the macrocycle, the
 * week placement, the guards and the checklist), so that they cannot disagree about which ramp a
 * week is measured against.
 */
export function rampBasis(
  state: AthleteState,
  rebuild: RebuildZone | null,
  response: ResponseBasis | null,
): Pick<RampContext, 'typicalWeekMin' | 'novice' | 'tight' | 'rebuild' | 'response'> {
  return {
    typicalWeekMin: state.typicalWeekMin,
    novice: noviceRamp(state),
    tight: tightRamp(state),
    rebuild,
    response,
  }
}

/**
 * The mean of the minutes run in the last `g8.responseWeeks` eligible weeks [rules g-8]: the
 * complete weeks before `before` (the Monday of the current week), newest first, a week in
 * `excluded` skipped, not counted as zero, and the next older one read in its place; recovery weeks
 * count as run. `rows` are the weeks of the athlete state, so nothing new is queried (ADR 0009).
 * Null when the rows do not reach back to that many eligible weeks: a state with fewer has no
 * response. It reads minutes only and forms no ratio [rules G-5].
 */
export function recentRunMean(
  rows: ReadonlyArray<{ weekStart: string; runMin: number }>,
  excluded: ReadonlySet<string>,
  before: string,
): number | null {
  const count = P.g8.responseWeeks.value
  const eligible = rows
    .filter((row) => row.weekStart < before && !excluded.has(row.weekStart))
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
    .slice(0, count)
  if (eligible.length < count) return null
  return eligible.reduce((sum, row) => sum + row.runMin, 0) / count
}

/**
 * The baseline the step of a loading week applies to [rules g-8, g-2]: the planned baseline
 * `planned`, or, at standard and upper (`response` set), the mean of the minutes run over the last
 * eligible weeks when that is higher. It lifts a baseline and never lowers one, and the most it can
 * give is the largest week of that window. Steady (`response` null) returns `planned` as it is.
 * The generator (`planWeeks`) and the limits (`rampLimits`, so the guards, the checklist and the
 * limit of a raised target) read the baseline here and nowhere else. The hard ceiling and G-1 are
 * applied to the week after it, and a hold or reduce decision caps the week it covers afterwards
 * (`weekCaps`), so both win over the response.
 */
export function responseBaseline(planned: number, response: ResponseBasis | null): number {
  if (response === null || response.meanMin === null) return planned
  return response.meanMin > planned + EPS ? response.meanMin : planned
}

/** The limits of one week. */
export interface WeekRampLimits {
  /**
   * Highest of the previous loading weeks, or the typical week; at standard and upper the mean of
   * the minutes run in the last eligible weeks when that is higher (`responseBaseline`).
   */
  base: number
  /** Above this the week carries a soft-ramp warning: the zone's limit in the rebuild zone. */
  soft: number
  /** The usual soft step over `base` (10%), whatever the zone: `soft` is never below it. */
  usualSoft: number
  /**
   * The rebuild zone when it raised the week's soft step above the usual one [rules g-8], that is
   * when the week's baseline is under R; null elsewhere (from R up, at steady, a start-path week).
   */
  rebuild: RebuildZone | null
  /** The 2-week ceiling and the tightened ramp: above this the week is cut. */
  allowed: number
  /** True when the tightened ramp, not the ceiling, sets `allowed`. */
  tightened: boolean
  /** The tightened ramp used, if any. */
  tightRamp: number | null
  isFloorWeek: boolean
  /** True for the floor week and the weeks of a start path: no soft-ramp warning. */
  exempt: boolean
  /** The most a generated week holds: `allowed`, and `soft` too outside the start-path weeks. */
  plan: number
}

/**
 * Highest value among the baseline weeks (2) that end `lag` weeks before `weekStart`. Weeks in
 * `skip` are left out; when every week of the window is, the window moves back, at most to the
 * lookback of the 2-week ceiling, to the first week that is not, so the weeks after a run of
 * recovery or taper weeks (or after a race) are measured against the last loading week. The
 * restart floor week counts at its floor minutes at least. Null when no week is known.
 */
export function highestBaseline(
  values: ReadonlyMap<string, number>,
  skip: ReadonlySet<string>,
  weekStart: string,
  lag: number,
  floor: RampContext['floor'] = null,
): number | null {
  const count = P.g2.baselineWeeks.value
  const lookback = Math.max(count, P.g2.ceilingLookbackWeeks.value)
  let best: number | null = null
  for (let k = 0; k < lookback; k += 1) {
    // past the window, only a window that found nothing keeps looking
    if (k >= count && best !== null) break
    const week = addDays(weekStart, -7 * (lag + k))
    let v: number | undefined
    if (floor !== null && week === floor.weekStart) {
      v = Math.max(values.get(week) ?? 0, floor.minutes)
    } else if (skip.has(week)) {
      continue
    } else {
      v = values.get(week)
    }
    if (v !== undefined) best = best === null ? v : Math.max(best, v)
  }
  return best
}

const positive = (value: number | null): number | null =>
  value !== null && value > 0 ? value : null

/** The ramp limits of the week of `weekStart`; null when nothing gives a baseline. */
export function rampLimits(ctx: RampContext, weekStart: string): WeekRampLimits | null {
  const typical = ctx.typicalWeekMin > 0 ? ctx.typicalWeekMin : null
  const planned =
    positive(highestBaseline(ctx.volumes, ctx.skip, weekStart, 1, ctx.floor)) ?? typical
  if (planned === null) return null
  const base = responseBaseline(planned, ctx.response)
  // The floor week is the ceiling baseline of the week right after it too, which would otherwise be
  // held to 130% of the weeks before the floor.
  const window = P.g2.ceilingWindowWeeks.value
  const afterFloor =
    ctx.floor !== null &&
    weekStart > ctx.floor.weekStart &&
    daysBetween(ctx.floor.weekStart, weekStart) <= 7 * (window - 1)
  const ceilingBase =
    positive(
      Math.max(
        highestBaseline(ctx.volumes, ctx.skip, weekStart, window, ctx.floor) ?? 0,
        afterFloor ? Math.max(ctx.volumes.get(ctx.floor!.weekStart) ?? 0, ctx.floor!.minutes) : 0,
      ),
    ) ?? planned
  const usualSoft = rampStep(base, P.g2.rampSoft.value, ctx.novice)
  const soft = rebuildStep(base, P.g2.rampSoft.value, ctx.novice, ctx.rebuild)
  const ceiling = rampStep(ceilingBase, P.g2.rampCeilingTwoWeeks.value, ctx.novice)
  const tightLimit = ctx.tight === null ? Infinity : rampStep(base, ctx.tight, ctx.novice)
  const isFloorWeek = ctx.floor !== null && ctx.floor.weekStart === weekStart
  const exemption = ctx.exempt?.get(weekStart) ?? null
  const exempt = isFloorWeek || exemption !== null
  let allowed = exemption === 'ramp' ? Infinity : Math.min(ceiling, tightLimit)
  if (isFloorWeek) allowed = Math.max(allowed, ctx.floor!.minutes)
  return {
    base,
    soft,
    usualSoft,
    // a start-path week is the programme's, and takes no zone
    rebuild: !exempt && soft > usualSoft + EPS ? ctx.rebuild : null,
    allowed,
    tightened: exemption !== 'ramp' && tightLimit <= ceiling,
    tightRamp: ctx.tight,
    isFloorWeek,
    exempt,
    plan: exempt ? allowed : Math.min(soft, allowed),
  }
}

/** What `targetLimit` needs to know of a week besides the ramp around it. */
export interface TargetGates {
  /** The plan's own target for the week: where a rule that sets the week's figure leaves it. */
  engineMin: number
  /** The week as the plan draws it. */
  week: { readonly flags: readonly string[] } & Pick<WeekDraft, 'isRecovery' | 'isTaper' | 'phase'>
  /** A progression hold applies (REDs flags or focal bone pain) [rules n-4, n-1, J5]. */
  held: boolean
  /** The weekly decision called for holding steady or an easier week for this very week [rule J5]. */
  decided: boolean
  /** The running already logged in the week; a limit never falls under what has been run. */
  loggedMin: number
}

/** The most a week target the runner raised by hand may stay at, and the limit that set it. */
export interface TargetLimit {
  /** Whole minutes; never under the plan's own figure or the minutes already run. */
  max: number
  kind: TargetLimitKind
  /**
   * The growth the limit allows, as a fraction: the 2-week ceiling for `ceiling`, the profile's
   * weekly ramp for `profile`; null where a rule sets the week's figure itself.
   */
  ramp: number | null
}

/**
 * The largest target a week may hold at a re-plan when the runner raised it above the plan's own
 * [rules g-2, g-3, J5, J9, H12, n-1, n-4, ADR 0007]: the limit the engine enforces on any week,
 * not the soft step. It reads `rampLimits`, so the generator, the guards, the checklist and this
 * agree on the 2-week ceiling and on the tightened profiles. A week that a rule draws on its own
 * (the weeks after a race, a rest window, a start programme, a recovery, taper or race week, the
 * weekly decision, a progression hold) has no ramp to read: its limit is the plan's own figure, so
 * a raise there is lowered back to it. The checks run in that order, most specific first. Those
 * rules stay where the generator applies them; this reads their outcome from the drawn week, so
 * `rampLimits` and the three readers of it are unchanged.
 */
export function targetLimit(ctx: RampContext, weekStart: string, gates: TargetGates): TargetLimit {
  const { engineMin, week, held, decided, loggedMin } = gates
  const own = (kind: TargetLimitKind): TargetLimit => ({
    max: Math.max(engineMin, loggedMin),
    kind,
    ramp: null,
  })
  if (week.flags.includes('post-race') || week.flags.includes('post-race-restart')) {
    return own('post-race')
  }
  if (isDisruptedWeek(week.flags)) return own('window')
  if (startKind(week.flags) !== null) return own('programme')
  if (week.isRecovery || week.isTaper || week.phase === 'taper' || week.phase === 'race') {
    return own('structure')
  }
  if (decided) return own('decision')
  if (held) return own('hold')
  const limits = rampLimits(ctx, weekStart)
  if (limits === null) return own('ceiling')
  return {
    max: Math.max(engineMin, loggedMin, wholeMinutes(limits.allowed)),
    kind: limits.tightened ? 'profile' : 'ceiling',
    ramp: limits.tightened ? limits.tightRamp : P.g2.rampCeilingTwoWeeks.value,
  }
}

/**
 * The most climbing a week may hold before the soft gain ramp warns: 10% or the 100 m minimum step
 * over the highest of the previous loading weeks [rules H4]; null when no week is known.
 */
export function gainLimit(
  gains: ReadonlyMap<string, number>,
  skip: ReadonlySet<string>,
  weekStart: string,
): { base: number; allowed: number } | null {
  const base = positive(highestBaseline(gains, skip, weekStart, 1))
  if (base === null) return null
  return {
    base,
    allowed: base + Math.max(base * P.h4.weeklyGainRamp.value, P.h4.minStepGainM.value),
  }
}

/** Weekly climbing of the completed runs, by Monday. */
export function weeklyGain(history: Activity[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of history) {
    if (a.type !== 'run' || !isCounted(a)) continue
    const week = mondayOf(a.date)
    out.set(week, (out.get(week) ?? 0) + (a.elevationGainM ?? 0))
  }
  return out
}

/** Running minutes of the sessions that count toward the week. */
export function runningMinutes(sessions: SessionSpec[]): number {
  return sessions.reduce((sum, s) => sum + (VOLUME_KINDS.has(s.kind) ? s.durationMin : 0), 0)
}

/** Climbing of the sessions that count toward the week. */
export function runningGain(sessions: SessionSpec[]): number {
  return sessions.reduce((sum, s) => sum + (VOLUME_KINDS.has(s.kind) ? (s.gainM ?? 0) : 0), 0)
}

/**
 * A session of a start path whose length the programme sets (a run-walk ladder session, an
 * injury-return run). Planned ones are no reference for the runs after them: G-1 is checked
 * against completed runs, and the programme's steps rest on what the runner has run [rules E6, g-1].
 */
export const isProgramme = (s: Pick<SessionSpec, 'flags' | 'kind' | 'structure'>): boolean =>
  s.flags.includes('run-walk') || s.flags.includes('injury-return') || isLadderSession(s)

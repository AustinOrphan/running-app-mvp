// The safety limits that planning and checking share [rules g-1 to g-3, H2 to H4]: the 30-day
// reference of the session spike guard and the most a run may hold against it, the largest 2-day
// total of the back-to-back rule, the weekly ramp with its baselines, the tightened profiles, the
// weekly gain ramp and the ultra cap on a single run. The macrocycle and the week placement plan
// inside these numbers and the guards and the checklist check against the same ones, so a
// generated plan needs no trimming. Pure: no I/O, no clock.
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import type { Activity } from '../types.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'
import { isLadderSession, startWeek, type StartPath } from './startWeeks.ts'
import type { AthleteState, SessionKind, SessionSpec, WeekDraft } from './types.ts'

/** Guards float noise (100 * 1.1 = 110.00000000000001) before rounding down. */
export const EPS = 1e-9

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

/** The lowest weekly ramp of the athlete's tightened profiles, or null for the default profile. */
export function tightRamp(state: AthleteState): number | null {
  const caps: number[] = []
  if (state.risk.recentInjury) caps.push(P.g3.recentInjuryRamp.value[1])
  if (state.risk.priorBsi) caps.push(P.g3.priorBsiRampMax.value)
  if (state.risk.bsiFactors >= P.g3.bsiFactorsForCap.value) {
    caps.push(P.g2.rampSoft.value * P.g3.bsiRampFactor.value)
  }
  return caps.length === 0 ? null : Math.min(...caps)
}

/** The weekly ramp the generator plans with: the soft ramp, or the lower one of a profile [G-2, G-3]. */
export function weeklyRamp(state: AthleteState): number {
  let ramp = P.g2.rampSoft.value
  if (state.risk.recentInjury) ramp = Math.min(ramp, P.g3.recentInjuryRamp.value[0])
  if (state.risk.priorBsi) ramp = Math.min(ramp, P.g3.priorBsiRampMax.value)
  if (state.risk.bsiFactors >= P.g3.bsiFactorsForCap.value) {
    ramp = Math.min(ramp, P.g2.rampSoft.value * P.g3.bsiRampFactor.value)
  }
  return ramp
}

/**
 * The minutes of the 3 x 20 starting week when the runner's typical week sits under it
 * (sessions x session length): null above it, with no typical week, and for the tightened
 * profiles, which are not lifted [design-macro, rules g-3]. The stand-in for the start path of
 * `startPath` (macro.ts) where only the athlete state is at hand.
 */
export function restartFloorMin(state: AthleteState): number | null {
  const minutes = P.restartFloor.sessions.value * P.restartFloor.sessionMin.value
  if (state.typicalWeekMin <= 0 || state.typicalWeekMin >= minutes) return null
  if (weeklyRamp(state) < P.g2.rampSoft.value) return null
  return minutes
}

/**
 * The weekly running minutes a new plan starts from: the first week of the start path when it is
 * the 3 x N floor or a run-walk rung, else the typical week, else the start floor of a runner
 * without recent running. The feasibility label of an ultra [rules D4] reads it. `path` is the
 * result of `startPath` (macro.ts); null means the plan starts from the typical week, and so does
 * an injury-return path, whose levels set their own pace. Left out, the 3 x 20 week stands in for
 * a typical week under it.
 */
export function startWeekMin(state: AthleteState, path?: StartPath | null): number {
  if (path !== undefined && path !== null && path.kind !== 'injury-return') {
    return startWeek(path.kind, path.kind === 'ladder' ? path.rung : path.sessionMin).minutes
  }
  const floor = path === undefined ? restartFloorMin(state) : null
  if (floor !== null) return floor
  return state.typicalWeekMin > 0 ? state.typicalWeekMin : P.macroDesign.startFloorWeekMin.value
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
}

/** The limits of one week. */
export interface WeekRampLimits {
  /** Highest of the previous loading weeks, or the typical week. */
  base: number
  /** Above this the week carries a soft-ramp warning. */
  soft: number
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
  const base = positive(highestBaseline(ctx.volumes, ctx.skip, weekStart, 1, ctx.floor)) ?? typical
  if (base === null) return null
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
    ) ?? base
  const soft = rampStep(base, P.g2.rampSoft.value, ctx.novice)
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
    allowed,
    tightened: exemption !== 'ramp' && tightLimit <= ceiling,
    tightRamp: ctx.tight,
    isFloorWeek,
    exempt,
    plan: exempt ? allowed : Math.min(soft, allowed),
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

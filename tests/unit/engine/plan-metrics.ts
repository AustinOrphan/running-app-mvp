// Plan metrics: what a `PlanDraft` looks like, as figures (evaluation harness, proposal
// `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` section 5.1, task H0).
//
// Report-only. Nothing here passes or fails a plan, gates a write or becomes a target: no
// threshold is applied without a rule, and no figure is called safe, behind or missed (G5). Every
// figure is a `Figure`: its value, and the grade and rule id of the Param it is read against (both
// null when no rule stands behind it). The label is read from the Params registry, never typed.
//
// The figures come from the draft, the three `EngineInput` fields in `PlanContext` and the Params
// alone. The functions that enforce a limit (`limits.ts`, `guards.ts`, `checklist.ts`) are never
// called: the G-2 headroom is re-derived below from the rule text, so a loosened guard shows here.
// The only engine functions used are the ones the proposal names: `monotonyStrain` (B7),
// `RUN_KINDS` and `pairSessions`.
//
// Pure and deterministic: no I/O, no clock, no randomness. Nothing under `shared/`, `server/`,
// `web/` or `scripts/` may import this file (H1 adds the scan test).
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { pairSessions } from '../../../shared/domain/sessionIdentity.ts'
import { RUN_KINDS } from '../../../shared/engine/adjust.ts'
import { monotonyStrain } from '../../../shared/engine/load.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  EngineInput,
  Grade,
  Param,
  PlanDraft,
  RecoveryCycle,
  SessionSpec,
  WeekDraft,
  ZoneKey,
} from '../../../shared/engine/types.ts'

// ---------------------------------------------------------------------------------------------
// Constants that are not a rule's number
// ---------------------------------------------------------------------------------------------

/**
 * A plateau week is a loading week whose target is within this share of the plan's highest loading
 * week. A preference of the harness: no rule and no study sets 5%, and it is never a threshold.
 */
export const PLATEAU_TOLERANCE = 0.05

/**
 * Treff et al. 2019 [treff-2019-polarization-index], Eq. 2: an empty zone 2 is set to 0.01, as a
 * fraction, so that the ratio of zone 1 to zone 2 stays finite. Eq. 2 also takes the 0.01 from
 * zone 3 (its Table 1 gives 3.18 for 80/0/20); this module leaves zone 3 as it is and gives 3.20.
 * Treff is a hypothesis paper (grade D); the index has no engine rule.
 */
export const TREFF_EMPTY_ZONE_FLOOR = 0.01

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

/**
 * A value with the label of the rule it is read against: the weakest grade of the Params the figure
 * rests on and their rule ids. `grade` and `rule` are null for a plain description of the draft.
 */
export interface Figure<T> {
  value: T
  grade: Grade | null
  rule: string | null
}

/** The slice of an `EngineInput` the metrics read. A full input satisfies it. */
export type PlanContext = Pick<EngineInput, 'today' | 'goal' | 'options'>

type GoalClass = EngineInput['goal']['distanceClass']

/** Shares of the three intensity zones, in whatever unit the caller keeps (percent or minutes). */
export interface ZoneShares {
  z1: number
  z2: number
  z3: number
}

/**
 * What a week is for the ramp, the cycle and the taper. `race` is the week the race falls in
 * (phase `race`, part of the taper); `post-race` weeks are the return steps after it.
 */
export type WeekType = 'loading' | 'recovery' | 'taper' | 'race' | 'post-race'

export interface WeekFigure {
  weekStart: string
  type: WeekType
  /**
   * The week starts before `input.today`: the draft holds its days from today on (or the finished
   * ones of a re-plan), so figures that need all seven days are not computed for it.
   */
  partial: boolean
  /** `WeekDraft.targetRunMin`. */
  targetMin: number
  /** Minutes of the draft's sessions that count toward weekly running minutes. */
  plannedMin: number
  /** The longest of those sessions, 0 when there is none. */
  longRunMin: number
  /** Distinct dates with a `RUN_KINDS` session. */
  runDays: number
  /** `WeekDraft.runDays`. */
  declaredRunDays: number
}

export interface StepRow {
  weekStart: string
  fromWeekStart: string
  /** The earlier week is a partial week, so the step is measured from a part of a week. */
  fromPartial: boolean
  targetMin: number
  fromTargetMin: number
  /** `targetMin / fromTargetMin - 1`; null when the earlier week has no minutes. */
  change: number | null
}

export interface StepSummary {
  /** Between consecutive loading weeks: recovery, taper and race weeks are skipped. */
  rows: StepRow[]
  median: number | null
  max: number | null
}

export interface HeadroomRow {
  weekStart: string
  targetMin: number
  /** The highest loading week the rule compares this week with. */
  baseMin: number
  /** `baseMin * (1 + limitShare)`. */
  limitMin: number
  /** `limitMin - targetMin`: negative when the week is above the figure. */
  headroomMin: number
  /** `targetMin / baseMin - 1`. */
  usedShare: number
}

export interface HeadroomFigure {
  /** The Param's ramp: `g2.rampSoft` or `g2.rampCeilingTwoWeeks`. */
  limitShare: number
  /** Loading weeks that have a baseline inside the draft. */
  rows: HeadroomRow[]
  /** The smallest `headroomMin` of the rows, null without rows. */
  tightestMin: number | null
}

export interface Plateau {
  toleranceShare: number
  loadingWeeks: number
  /** Loading weeks within the tolerance of the peak, the peak week included. */
  weeksWithin: number
  /** The longest run of consecutive loading weeks (recovery weeks skipped) within the tolerance. */
  longestRun: number
  firstWeekStart: string
}

export interface Peak {
  /** The first loading week with the plan's highest target. */
  weekStart: string
  targetMin: number
  /** Position in the draft's weeks, counting from 1. */
  position: number
  /** Whole weeks from the peak week to the Monday of the race week. */
  weeksBeforeRace: number
}

export interface LongRunShare {
  /** The longest session over the planned minutes, per loading week (null without minutes). */
  rows: Array<{ weekStart: string; share: number | null }>
  mean: number | null
  max: number | null
}

export interface DistributionRow {
  weekStart: string
  /** `WeekDraft.tid`, percent of running time. */
  declared: ZoneShares
  /** From the sessions' steps, percent of the planned minutes; null without planned minutes. */
  realised: ZoneShares | null
}

export interface Distribution {
  /** Loading weeks. */
  rows: DistributionRow[]
  /** The declared shares weighted by target minutes and the realised ones by planned minutes. */
  declared: ZoneShares
  realised: ZoneShares | null
}

export interface PolarizationIndex {
  /** log10((Z1 / Z2) × Z3 × 100) on fractions; null when zone 1 or zone 3 is empty. */
  value: number | null
  /** The zones from the largest share to the smallest, e.g. `Z1 > Z3 > Z2`. */
  order: string
  /** The fractions the value was computed from. */
  fractions: ZoneShares
}

export interface LoadRow {
  weekStart: string
  /** Minutes × the midpoint of `expectedRpe.<kind>`, summed over the week. Relative only. */
  load: number
}

export interface MonotonyRow {
  weekStart: string
  /** Mean over SD of the seven daily loads; null for a partial week or a flat one. */
  monotony: number | null
  /** The week's load times monotony; null with it. */
  strain: number | null
}

export interface Cycle {
  /** `options.recoveryCycle`, null when the plan chose. */
  declared: RecoveryCycle | null
  /** Consecutive loading weeks before each recovery week, and before the taper. */
  loadingRuns: number[]
  longestRun: number | null
  recoveryWeeks: Array<{ weekStart: string; cutShare: number | null }>
  meanCutShare: number | null
  /** The Params the cycle is read beside, for the report. */
  reference: {
    defaultWorkWeeks: number
    flaggedWorkWeeks: number
    cutPct: number
    cutPctRange: [number, number] | null
  }
}

export interface Taper {
  /** Taper weeks, the race week included. */
  weeks: number
  /** From the first taper Monday to the race day, both counted. */
  days: number
  referenceWeekStart: string | null
  referenceMin: number | null
  /** Each taper week's target over the reference week's. */
  fractions: number[]
  meanFraction: number | null
  /** Run days of each taper week, the post-race return steps left out. */
  runDays: number[]
  /** `1 - runDays / reference run days`, per taper week. */
  runDaysCutShare: number[]
  qualitySessions: number[]
  /** The Params the taper is read beside, for the report. */
  reference: {
    maxDays: number
    meanVolumeFraction: [number, number]
    runDaysMaxCutPct: number
    minQualitySessionsPerWeek: number
  }
}

export interface RunDays {
  /** Run days of the loading weeks. */
  min: number | null
  max: number | null
  median: number | null
}

export interface PlanDescription {
  weeks: WeekFigure[]
  steps: Figure<StepSummary>
  headroom: { soft: Figure<HeadroomFigure>; ceiling: Figure<HeadroomFigure> }
  plateau: Figure<Plateau | null>
  peak: Figure<Peak | null>
  longRunShare: Figure<LongRunShare>
  distribution: Figure<Distribution>
  /** Treff's index of the declared and the realised distribution of the loading weeks. */
  polarization: Figure<{ declared: PolarizationIndex; realised: PolarizationIndex | null }>
  load: Figure<LoadRow[]>
  monotony: Figure<MonotonyRow[]>
  cycle: Figure<Cycle>
  taper: Figure<Taper | null>
  runDays: Figure<RunDays>
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const GRADES_BEST_FIRST: readonly Grade[] = ['A', 'B', 'C', 'D']

/** Wraps `value` with the weakest grade and the rule ids of `params`; no params, no label. */
function figure<T>(value: T, params: ReadonlyArray<Param<unknown>> = []): Figure<T> {
  if (params.length === 0) return { value, grade: null, rule: null }
  const grade = params
    .map((p) => p.grade)
    .reduce((worst, g) =>
      GRADES_BEST_FIRST.indexOf(g) > GRADES_BEST_FIRST.indexOf(worst) ? g : worst,
    )
  return { value, grade, rule: [...new Set(params.map((p) => p.rule))].join(', ') }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const ZONES = ['z1', 'z2', 'z3'] as const

const percentOf = (minutes: ZoneShares, total: number): ZoneShares => ({
  z1: (minutes.z1 / total) * 100,
  z2: (minutes.z2 / total) * 100,
  z3: (minutes.z3 / total) * 100,
})

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length

const max = (values: readonly number[]): number | null =>
  values.length === 0 ? null : Math.max(...values)

/**
 * Sessions that count toward a week's running minutes: the run kinds except a race (its minutes
 * are the race's, not training) and a hike.
 */
function countsAsVolume(session: SessionSpec): boolean {
  return RUN_KINDS.has(session.kind) && session.kind !== 'race' && session.kind !== 'hike'
}

function weekTypeOf(week: WeekDraft): WeekType {
  if (week.flags.includes('post-race')) return 'post-race'
  if (week.phase === 'race') return 'race'
  if (week.isTaper) return 'taper'
  if (week.isRecovery) return 'recovery'
  return 'loading'
}

function sessionsByWeek(sessions: readonly SessionSpec[]): Map<string, SessionSpec[]> {
  const out = new Map<string, SessionSpec[]>()
  for (const s of sessions) {
    const monday = mondayOf(s.date)
    const list = out.get(monday)
    if (list === undefined) out.set(monday, [s])
    else list.push(s)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Zones and Treff's index
// ---------------------------------------------------------------------------------------------

/**
 * The zone of the three-zone distribution a step's time counts in. `strides` count in zone 3, as the
 * F2 cap counts them above zone 1. `race-pace` counts in zone 2 for goals above 10 km, where
 * "race pace moves into Z2" (E4); rule E4 says nothing of 5 and 10 km, so there it counts in zone 3,
 * a choice of this harness. Other zone keys (strength, rest) are no running time.
 */
function tidZoneOf(zone: ZoneKey, goalClass: GoalClass): 1 | 2 | 3 | null {
  if (zone === 'z1') return 1
  if (zone === 'z2') return 2
  if (zone === 'z3' || zone === 'strides') return 3
  if (zone === 'race-pace') return goalClass === '5k' || goalClass === '10k' ? 3 : 2
  return null
}

/**
 * Minutes of a session in each zone: the time of every step above zone 1 in its zone, and the rest
 * of the session's minutes (steps in zone 1 and any time the steps do not name) in zone 1.
 */
function zoneMinutes(session: SessionSpec, goalClass: GoalClass): ZoneShares {
  let z2 = 0
  let z3 = 0
  for (const step of session.structure) {
    const zone = tidZoneOf(step.zone, goalClass)
    const minutes = ((step.durationSec ?? 0) * step.reps) / 60
    if (zone === 2) z2 += minutes
    else if (zone === 3) z3 += minutes
  }
  return { z1: Math.max(0, session.durationMin - z2 - z3), z2, z3 }
}

/**
 * Treff's polarization index [treff-2019-polarization-index, Eq. 1]: log10((Z1 / Z2) × Z3 × 100)
 * on fractions, with an empty zone 2 set to `TREFF_EMPTY_ZONE_FLOOR`. The shares are normalised to
 * fractions, so percent, minutes and fractions give one value. A value, never a label: its 2.00
 * cut-off has no engine rule, and Treff calls a distribution polarized only when Z1 > Z3 > Z2,
 * which `order` shows. `value` is null when zone 1 or zone 3 is empty (the logarithm of zero), or
 * all are.
 */
export function polarizationIndex(shares: ZoneShares): PolarizationIndex {
  const total = shares.z1 + shares.z2 + shares.z3
  const fractions: ZoneShares =
    total > 0
      ? { z1: shares.z1 / total, z2: shares.z2 / total, z3: shares.z3 / total }
      : { z1: 0, z2: 0, z3: 0 }
  const zones = [
    { name: 'Z1', share: fractions.z1 },
    { name: 'Z2', share: fractions.z2 },
    { name: 'Z3', share: fractions.z3 },
  ].sort((a, b) => b.share - a.share || (a.name < b.name ? -1 : 1))
  const order = zones
    .map((z, i) => {
      const before = zones[i - 1]
      return before === undefined ? z.name : `${before.share === z.share ? '=' : '>'} ${z.name}`
    })
    .join(' ')
  if (fractions.z1 <= 0 || fractions.z3 <= 0) return { value: null, order, fractions }
  const z2 = fractions.z2 > 0 ? fractions.z2 : TREFF_EMPTY_ZONE_FLOOR
  return { value: Math.log10((fractions.z1 / z2) * fractions.z3 * 100), order, fractions }
}

// ---------------------------------------------------------------------------------------------
// The G-2 baseline, re-derived from the rule text
// ---------------------------------------------------------------------------------------------

/**
 * The highest target among the loading weeks that end `lag` weeks before `weekStart`, looking at
 * `g2.baselineWeeks` of them (G-2: "the highest of the 2 preceding loading weeks; recovery, taper
 * and race weeks are skipped"). When none of those weeks is a loading week of the draft the search
 * moves back, at most `g2.ceilingLookbackWeeks` weeks in all, to the first one that is. `targets`
 * holds the loading weeks only. Lag 1 gives the baseline of the soft step; lag
 * `g2.ceilingWindowWeeks` the baseline of the 2-week ceiling.
 */
function baselineMin(
  targets: ReadonlyMap<string, number>,
  weekStart: string,
  lag: number,
): number | null {
  const count = P.g2.baselineWeeks.value
  const lookback = Math.max(count, P.g2.ceilingLookbackWeeks.value)
  let best: number | null = null
  for (let k = 0; k < lookback; k += 1) {
    if (k >= count && best !== null) break
    const target = targets.get(addDays(weekStart, -7 * (lag + k)))
    if (target !== undefined) best = best === null ? target : Math.max(best, target)
  }
  return best
}

function headroom(
  loading: readonly WeekFigure[],
  targets: ReadonlyMap<string, number>,
  lag: number,
  limitShare: number,
): HeadroomFigure {
  const rows: HeadroomRow[] = []
  for (const week of loading) {
    const baseMin = baselineMin(targets, week.weekStart, lag)
    if (baseMin === null || baseMin <= 0) continue
    const limitMin = baseMin * (1 + limitShare)
    rows.push({
      weekStart: week.weekStart,
      targetMin: week.targetMin,
      baseMin,
      limitMin,
      headroomMin: limitMin - week.targetMin,
      usedShare: week.targetMin / baseMin - 1,
    })
  }
  return {
    limitShare,
    rows,
    tightestMin: rows.length === 0 ? null : Math.min(...rows.map((r) => r.headroomMin)),
  }
}

// ---------------------------------------------------------------------------------------------
// describePlan
// ---------------------------------------------------------------------------------------------

/**
 * The figures of a plan draft (proposal 5.1). The weeks are read in date order; a week is
 * `partial` when it starts before `input.today`. Per-day figures (monotony) skip a partial week, and
 * a step from a partial week says so. The G-2 headroom ignores what reads the runner and not the
 * draft: the novice minimum step (`g2.noviceMinStepMin`), the rebuild zone of the load setting
 * (G-8), the tightened ramps (G-3) and the start-path exemptions, so a week planned under one of
 * them can show a negative headroom here. The first loading weeks have no baseline in the draft:
 * the weeks already run are not read.
 */
export function describePlan(draft: PlanDraft, input: PlanContext): PlanDescription {
  const goalClass = input.goal.distanceClass
  const bySessions = sessionsByWeek(draft.sessions)
  const draftWeeks = [...draft.weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))

  const weeks: WeekFigure[] = draftWeeks.map((week) => {
    const sessions = bySessions.get(week.weekStart) ?? []
    const volume = sessions.filter(countsAsVolume)
    return {
      weekStart: week.weekStart,
      type: weekTypeOf(week),
      partial: week.weekStart < input.today,
      targetMin: week.targetRunMin,
      plannedMin: volume.reduce((sum, s) => sum + s.durationMin, 0),
      longRunMin: max(volume.map((s) => s.durationMin)) ?? 0,
      runDays: new Set(sessions.filter((s) => RUN_KINDS.has(s.kind)).map((s) => s.date)).size,
      declaredRunDays: week.runDays,
    }
  })
  const draftWeek = new Map(draftWeeks.map((w) => [w.weekStart, w]))
  const loading = weeks.filter((w) => w.type === 'loading')
  const targets = new Map(loading.map((w) => [w.weekStart, w.targetMin]))

  // steps between consecutive loading weeks
  const stepRows: StepRow[] = []
  for (let i = 1; i < loading.length; i += 1) {
    const from = loading[i - 1]!
    const week = loading[i]!
    stepRows.push({
      weekStart: week.weekStart,
      fromWeekStart: from.weekStart,
      fromPartial: from.partial,
      targetMin: week.targetMin,
      fromTargetMin: from.targetMin,
      change: from.targetMin > 0 ? week.targetMin / from.targetMin - 1 : null,
    })
  }
  const changes = stepRows.flatMap((r) => (r.change === null ? [] : [r.change]))
  const steps: StepSummary = { rows: stepRows, median: median(changes), max: max(changes) }

  // peak and plateau
  const peakWeek = loading.reduce<WeekFigure | null>(
    (best, w) => (best === null || w.targetMin > best.targetMin ? w : best),
    null,
  )
  let peak: Peak | null = null
  let plateau: Plateau | null = null
  if (peakWeek !== null) {
    peak = {
      weekStart: peakWeek.weekStart,
      targetMin: peakWeek.targetMin,
      position: weeks.findIndex((w) => w.weekStart === peakWeek.weekStart) + 1,
      weeksBeforeRace: daysBetween(peakWeek.weekStart, mondayOf(input.goal.date)) / 7,
    }
    const within = loading.map((w) => w.targetMin >= peakWeek.targetMin * (1 - PLATEAU_TOLERANCE))
    let longest = 0
    let streak = 0
    for (const inside of within) {
      streak = inside ? streak + 1 : 0
      longest = Math.max(longest, streak)
    }
    plateau = {
      toleranceShare: PLATEAU_TOLERANCE,
      loadingWeeks: loading.length,
      weeksWithin: within.filter(Boolean).length,
      longestRun: longest,
      firstWeekStart: loading[within.indexOf(true)]!.weekStart,
    }
  }

  // long-run share
  const shareRows = loading.map((w) => ({
    weekStart: w.weekStart,
    share: w.plannedMin > 0 ? w.longRunMin / w.plannedMin : null,
  }))
  const shares = shareRows.flatMap((r) => (r.share === null ? [] : [r.share]))
  const longRunShare: LongRunShare = { rows: shareRows, mean: mean(shares), max: max(shares) }

  // declared against realised distribution of the loading weeks
  const distributionRows: DistributionRow[] = []
  const declaredOverall: ZoneShares = { z1: 0, z2: 0, z3: 0 }
  const realisedMinutes: ZoneShares = { z1: 0, z2: 0, z3: 0 }
  const targetTotal = loading.reduce((sum, w) => sum + w.targetMin, 0)
  for (const week of loading) {
    const minutes: ZoneShares = { z1: 0, z2: 0, z3: 0 }
    for (const s of (bySessions.get(week.weekStart) ?? []).filter(countsAsVolume)) {
      const m = zoneMinutes(s, goalClass)
      minutes.z1 += m.z1
      minutes.z2 += m.z2
      minutes.z3 += m.z3
    }
    const total = minutes.z1 + minutes.z2 + minutes.z3
    const declared = { ...draftWeek.get(week.weekStart)!.tid }
    distributionRows.push({
      weekStart: week.weekStart,
      declared,
      realised: total > 0 ? percentOf(minutes, total) : null,
    })
    for (const zone of ZONES) {
      realisedMinutes[zone] += minutes[zone]
      if (targetTotal > 0) declaredOverall[zone] += (declared[zone] * week.targetMin) / targetTotal
    }
  }
  const realisedTotal = realisedMinutes.z1 + realisedMinutes.z2 + realisedMinutes.z3
  const distribution: Distribution = {
    rows: distributionRows,
    declared: declaredOverall,
    realised: realisedTotal > 0 ? percentOf(realisedMinutes, realisedTotal) : null,
  }

  // planned load, monotony and strain
  const loadRows: LoadRow[] = []
  const monotonyRows: MonotonyRow[] = []
  for (const week of weeks) {
    const daily = new Map<string, number>()
    for (const s of (bySessions.get(week.weekStart) ?? []).filter(countsAsVolume)) {
      const rpe = P.expectedRpe[s.kind]
      const [low, high] = rpe.value
      daily.set(s.date, (daily.get(s.date) ?? 0) + (s.durationMin * (low + high)) / 2)
    }
    const series = [...daily].map(([date, load]) => ({ date, load }))
    const load = series.reduce((sum, d) => sum + d.load, 0)
    loadRows.push({ weekStart: week.weekStart, load })
    // The flags of `monotonyStrain` compare a week with the runner's own earlier weeks; a plan has
    // no range of its own, and only this week's days are passed, so they are not read.
    const stats = week.partial
      ? null
      : monotonyStrain(series, addDays(week.weekStart, P.b7.monotonyWindowDays.value - 1))
    monotonyRows.push({
      weekStart: week.weekStart,
      monotony: stats?.monotony ?? null,
      strain: stats?.strain ?? null,
    })
  }

  // cycle: loading weeks between recovery weeks
  const loadingRuns: number[] = []
  const recoveryWeeks: Cycle['recoveryWeeks'] = []
  let run = 0
  let lastLoading: WeekFigure | null = null
  for (const week of weeks) {
    if (week.type === 'loading') {
      run += 1
      lastLoading = week
      continue
    }
    if (run > 0) loadingRuns.push(run)
    run = 0
    if (week.type === 'recovery') {
      recoveryWeeks.push({
        weekStart: week.weekStart,
        cutShare:
          lastLoading !== null && lastLoading.targetMin > 0
            ? 1 - week.targetMin / lastLoading.targetMin
            : null,
      })
    }
  }
  if (run > 0) loadingRuns.push(run)
  const cuts = recoveryWeeks.flatMap((r) => (r.cutShare === null ? [] : [r.cutShare]))
  const cycle: Cycle = {
    declared: input.options.recoveryCycle ?? null,
    loadingRuns,
    longestRun: max(loadingRuns),
    recoveryWeeks,
    meanCutShare: mean(cuts),
    reference: {
      defaultWorkWeeks: P.e3.defaultCycleWorkWeeks.value,
      flaggedWorkWeeks: P.e3.flaggedCycleWorkWeeks.value,
      cutPct: P.e3.recoveryWeekCutPct.value,
      cutPctRange: P.e3.recoveryWeekCutPct.range ? [...P.e3.recoveryWeekCutPct.range] : null,
    },
  }

  // taper: the weeks flagged as taper, the race week included, against the last loading week before
  const taperWeeks = weeks.filter((w) => w.type === 'taper' || w.type === 'race')
  let taper: Taper | null = null
  const firstTaper = taperWeeks[0]
  if (firstTaper !== undefined) {
    const reference = [...loading].reverse().find((w) => w.weekStart < firstTaper.weekStart) ?? null
    const runDaysOf = (week: WeekFigure) =>
      new Set(
        (bySessions.get(week.weekStart) ?? [])
          .filter((s) => RUN_KINDS.has(s.kind) && !s.flags.includes('post-race'))
          .map((s) => s.date),
      ).size
    const fractions =
      reference !== null && reference.targetMin > 0
        ? taperWeeks.map((w) => w.targetMin / reference.targetMin)
        : []
    const taperRunDays = taperWeeks.map(runDaysOf)
    const referenceRunDays = reference === null ? 0 : runDaysOf(reference)
    taper = {
      weeks: taperWeeks.length,
      days: daysBetween(firstTaper.weekStart, input.goal.date) + 1,
      referenceWeekStart: reference?.weekStart ?? null,
      referenceMin: reference?.targetMin ?? null,
      fractions,
      meanFraction: mean(fractions),
      runDays: taperRunDays,
      runDaysCutShare:
        referenceRunDays > 0 ? taperRunDays.map((d) => 1 - d / referenceRunDays) : [],
      qualitySessions: taperWeeks.map((w) => draftWeek.get(w.weekStart)!.qualitySessions),
      reference: {
        maxDays: P.k1.maxDays.value,
        meanVolumeFraction: [...P.k2.meanVolumeFraction.value] as [number, number],
        runDaysMaxCutPct: P.k3.runDaysMaxCutPct.value,
        minQualitySessionsPerWeek: P.k3.minQualitySessionsPerWeek.value,
      },
    }
  }

  const loadingRunDays = loading.map((w) => w.runDays)

  return {
    weeks,
    steps: figure(steps, [P.g2.rampSoft, P.g2.rampCeilingTwoWeeks]),
    headroom: {
      soft: figure(headroom(loading, targets, 1, P.g2.rampSoft.value), [P.g2.rampSoft]),
      ceiling: figure(
        headroom(loading, targets, P.g2.ceilingWindowWeeks.value, P.g2.rampCeilingTwoWeeks.value),
        [P.g2.rampCeilingTwoWeeks, P.g2.ceilingWindowWeeks],
      ),
    },
    plateau: figure(plateau),
    peak: figure(peak),
    longRunShare: figure(longRunShare, [P.macroDesign.longRunShareOfWeek]),
    distribution: figure(distribution, [P.e4.z1Prior, P.e4.z2Prior, P.e4.z3Prior]),
    polarization: figure({
      declared: polarizationIndex(distribution.declared),
      realised: distribution.realised === null ? null : polarizationIndex(distribution.realised),
    }),
    load: figure(loadRows, Object.values(P.expectedRpe)),
    monotony: figure(monotonyRows, [P.b7.monotonyWindowDays]),
    cycle: figure(cycle, [P.e3.recoveryWeekCutPct]),
    taper: figure(taper, [P.k1.maxDays, P.k2.meanVolumeFraction, P.k3.runDaysMaxCutPct]),
    runDays: figure({
      min: loadingRunDays.length === 0 ? null : Math.min(...loadingRunDays),
      max: max(loadingRunDays),
      median: median(loadingRunDays),
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// Churn along a chain
// ---------------------------------------------------------------------------------------------

export interface ChurnStep {
  /** The first date compared; null when the whole drafts are compared. */
  from: string | null
  /** Run sessions of the earlier draft in the window. */
  before: number
  paired: number
  /** Paired and of the same minutes. */
  unchanged: number
  /** Paired and of other minutes. */
  resized: number
  /** Only in the earlier draft: dropped, or moved to another day or kind. */
  removed: number
  /** Only in the later draft: new, or arrived on another day or as another kind. */
  added: number
  /** Minutes changed on paired sessions plus the minutes of every removed and added session. */
  minutesMoved: number
}

export interface ChainChurn {
  /** One row per re-plan: drafts[i - 1] to drafts[i]. */
  steps: ChurnStep[]
  resized: number
  removed: number
  added: number
  minutesMoved: number
}

/**
 * How much each draft of a chain (`replanChain`) changed the run sessions of the one before it,
 * paired by (date, kind, occurrence) through `pairSessions`: so a session moved to another day or
 * kind counts as a removal and an addition. `options.from[i]` is the first date compared for the
 * step into `drafts[i]` (the re-plan's day: earlier days are history, not plan); left out, every
 * session is compared. A later draft with no run session in the window counts every earlier one
 * as removed. Descriptive: a re-plan that moves nothing is not better for it, nor one that moves
 * much worse.
 */
export function churnAlongChain(
  drafts: readonly PlanDraft[],
  options: { from?: readonly string[] } = {},
): ChainChurn {
  const steps: ChurnStep[] = []
  for (let i = 1; i < drafts.length; i += 1) {
    const from = options.from?.[i] ?? null
    const inWindow = (s: SessionSpec) => RUN_KINDS.has(s.kind) && (from === null || s.date >= from)
    const before = drafts[i - 1]!.sessions.filter(inWindow)
    const after = drafts[i]!.sessions.filter(inWindow)
    const { paired, removed, added } = pairSessions(before, after)
    const resized = paired.filter((p) => p.before.durationMin !== p.after.durationMin)
    steps.push({
      from,
      before: before.length,
      paired: paired.length,
      unchanged: paired.length - resized.length,
      resized: resized.length,
      removed: removed.length,
      added: added.length,
      minutesMoved:
        resized.reduce((sum, p) => sum + Math.abs(p.after.durationMin - p.before.durationMin), 0) +
        removed.reduce((sum, s) => sum + s.durationMin, 0) +
        added.reduce((sum, s) => sum + s.durationMin, 0),
    })
  }
  const total = (pick: (s: ChurnStep) => number) => steps.reduce((sum, s) => sum + pick(s), 0)
  return {
    steps,
    resized: total((s) => s.resized),
    removed: total((s) => s.removed),
    added: total((s) => s.added),
    minutesMoved: total((s) => s.minutesMoved),
  }
}

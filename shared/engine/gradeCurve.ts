// The personal speed-by-grade curve [rule I13]. Pure and deterministic. My paces shows it. The one
// other reader is the prediction: `personalClimbOf` hands the state the runner's climbing as a ratio to
// Minetti's, and `predict.ts` blends it a little into `l5.gainEquivalentM` (rule L5). The plan,
// the zones and `gapDistanceM` do not read it.
//
// A run's terrain bins (`Activity.terrainBins`) give its speed in each grade band. Divided by the
// run's own flat-band speed the figure no longer depends on the day's effort. Across the runs of
// the last `i13.windowWeeks` weeks the ratios are pooled per band, shrunk toward the Minetti ratio
// of I11 (one over its cost ratio, the speed at equal power), and shown only where a
// leave-one-run-out test says they predict a held-out run better than Minetti does.
import { daysBetween } from '../dates.ts'
import {
  TERRAIN_BINS_VERSION,
  TERRAIN_EDGES_PCT,
  TERRAIN_WINDOW_M,
} from '../domain/terrainShape.ts'
import type { Activity, TerrainBins } from '../types.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'
import { minettiCost } from './terrain.ts'

/** A run as the curve reads it: only runs (not races) are passed in; bins may be missing. */
export interface GradeCurveRun {
  id: string
  /** `YYYY-MM-DD`. */
  date: string
  bins: TerrainBins | null
}

/** Why a band shows the value it shows. */
export type BandReason =
  /** The flat band: 1 by definition. */
  | 'flat'
  /** The personal ratio beat Minetti in the leave-one-run-out test. */
  | 'personal'
  /** Under `i13.minBinMin` minutes pooled. */
  | 'few-minutes'
  /** Reached by fewer than `i13.minBinRuns` eligible runs. */
  | 'few-runs'
  /** One of the two open steep ends: always Minetti (rule I13). */
  | 'steep-end'
  /** Tested on fewer runs than the gate can pass on: `i13.minBacktestRuns`, and the fewest at which the sign test can pass at all. */
  | 'untested'
  /** Tested, and not lower in error than Minetti by `i13.minGainOverDefaultPct`. */
  | 'no-gain'
  /** Lower in mean error, but the runs do not agree: the sign test is above `i13.maxSignTestP`. */
  | 'inconsistent'

/** Leave-one-run-out error of one band (or of all bands pooled). Errors are relative, in percent. */
export interface BandTest {
  /** Held-out runs that were tested here (pairs of run and band for the pooled figure). */
  runs: number
  maePersonalPct: number
  maeDefaultPct: number
  /** How much lower the personal error is than the default error, in percent of the default. */
  gainPct: number
  /** Pairs in which the personal error was the lower of the two. */
  wins: number
  /** One-sided sign test: the chance of this many wins or more in the tested pairs if each pair were a coin toss. */
  signTestP: number
}

export interface GradeBand {
  index: number
  /** Lower edge in percent grade; null for the open steep descent. */
  fromPct: number | null
  /** Upper edge in percent grade; null for the open steep climb. */
  toPct: number | null
  /** The grade the Minetti ratio is read at: the middle of the band (an open end, which always shows Minetti: a nominal half a neighbour's width beyond its edge). */
  midPct: number
  /** Pooled minutes in the band over the eligible runs. */
  minutes: number
  /** Eligible runs that reached the band. */
  runs: number
  /** Speed relative to flat from Minetti: one over the cost ratio at `midPct`. */
  defaultRatio: number
  /** The shrunk personal ratio; null when the band does not speak and for the two open steep ends. Shown only when `source` is personal. */
  personalRatio: number | null
  /** The ratio to show. */
  ratio: number
  source: 'personal' | 'default'
  reason: BandReason
  /** Share of the band's time under the walking floor; null when the band does not speak. */
  walkShare: number | null
  test: BandTest | null
}

export interface GradeCurve {
  /** Runs that passed the eligibility test in the window. */
  eligibleRuns: number
  /** Their flat-band minutes in all. */
  flatMinutes: number
  bands: GradeBand[]
  /** Lower edge of the lowest climbing band that speaks and is walked more than half the time; null if none. */
  walkingFromPct: number | null
  /** The test of all bands pooled; null with no tested pair. */
  overall: BandTest | null
}

export interface GradeBacktest {
  /** Runs held out that were tested in at least one band. */
  runs: number
  bands: (BandTest | null)[]
  overall: BandTest | null
}

const EDGES = TERRAIN_EDGES_PCT
const BAND_COUNT = EDGES.length + 1
/** The band that holds 0: the one the curve divides by. */
const FLAT_BAND = EDGES.filter((edge) => edge <= 0).length
/**
 * The two open ends. The grade a band is read at has no middle there (the band has no outer edge),
 * and the data is thin; both keep Minetti whatever the test says (rule I13).
 */
function isSteepEnd(index: number): boolean {
  return index === 0 || index === BAND_COUNT - 1
}

function midPct(index: number): number {
  const lo = EDGES[index - 1]
  const hi = EDGES[index]
  if (lo !== undefined && hi !== undefined) return (lo + hi) / 2
  if (hi !== undefined) return hi - (EDGES[1]! - EDGES[0]!) / 2
  return lo! + (lo! - EDGES[EDGES.length - 2]!) / 2
}

/** Minetti's speed relative to flat in a band: one over the cost ratio at its middle grade (equal power). */
function defaultRatio(index: number): number {
  return 1 / minettiCost(midPct(index) / 100)
}

/** A run that passed the eligibility test, reduced to what the pooling needs. */
interface Prepared {
  sec: number[]
  walkSec: number[]
  /** Band speed over the run's flat speed; null where the run has no time in the band. */
  ratio: (number | null)[]
}

function shapeMatches(bins: TerrainBins): boolean {
  return (
    bins.v === TERRAIN_BINS_VERSION &&
    bins.windowM === TERRAIN_WINDOW_M &&
    bins.walkMps === P.c9.walkingFloorMps.value &&
    bins.edgesPct.length === EDGES.length &&
    bins.edgesPct.every((edge, i) => edge === EDGES[i]) &&
    bins.sec.length === BAND_COUNT &&
    bins.m.length === BAND_COUNT &&
    bins.walkSec.length === BAND_COUNT
  )
}

function prepare(run: GradeCurveRun, today: string): Prepared | null {
  const bins = run.bins
  if (!bins || !shapeMatches(bins)) return null
  const age = daysBetween(run.date, today)
  if (age < 0 || age >= P.i13.windowWeeks.value * 7) return null
  const flatSec = bins.sec[FLAT_BAND]!
  if (flatSec / 60 < P.i13.minFlatMin.value) return null
  if (bins.flatCv === null || bins.flatCv > P.i13.maxFlatSpeedCv.value) return null
  const flatMps = bins.m[FLAT_BAND]! / flatSec
  if (!(flatMps > 0)) return null
  return {
    sec: bins.sec,
    walkSec: bins.walkSec,
    ratio: bins.sec.map((sec, i) => (sec > 0 ? bins.m[i]! / sec / flatMps : null)),
  }
}

interface Pooled {
  minutes: number
  runs: number
  /** Shrunk personal ratio; null when the band does not speak. */
  personal: number | null
  walkShare: number | null
  reason: 'few-minutes' | 'few-runs' | null
}

function pool(runs: Prepared[], band: number): Pooled {
  let sec = 0
  let weighted = 0
  let walk = 0
  let reached = 0
  for (const run of runs) {
    const ratio = run.ratio[band]
    if (ratio === null || ratio === undefined) continue
    sec += run.sec[band]!
    weighted += run.sec[band]! * ratio
    walk += run.walkSec[band]!
    reached += 1
  }
  const minutes = sec / 60
  const reason =
    minutes < P.i13.minBinMin.value
      ? ('few-minutes' as const)
      : reached < P.i13.minBinRuns.value
        ? ('few-runs' as const)
        : null
  if (reason) return { minutes, runs: reached, personal: null, walkShare: null, reason }
  const prior = P.i13.priorMin.value
  const personal =
    (weighted / sec) * (minutes / (minutes + prior)) +
    defaultRatio(band) * (prior / (minutes + prior))
  return { minutes, runs: reached, personal, walkShare: walk / sec, reason: null }
}

interface Tally {
  runs: number
  personal: number
  default: number
  wins: number
}

/** P(X >= wins) for X ~ Binomial(n, 1/2): the one-sided sign test. */
export function signTestP(wins: number, n: number): number {
  if (n <= 0) return 1
  const logFact = [0]
  for (let i = 1; i <= n; i++) logFact.push(logFact[i - 1]! + Math.log(i))
  let p = 0
  for (let k = wins; k <= n; k++) {
    p += Math.exp(logFact[n]! - logFact[k]! - logFact[n - k]! - n * Math.LN2)
  }
  return Math.min(1, p)
}

/**
 * The fewest tested pairs at which the sign test can pass: the smallest n for which n wins in n
 * pairs has a probability of at most `i13.maxSignTestP` (7 at 0.01). Below it no result can show a
 * personal ratio, so the band reads untested and not inconsistent.
 */
export function minSignTestPairs(): number {
  let n = 1
  while (signTestP(n, n) > P.i13.maxSignTestP.value && n < 1000) n += 1
  return n
}

function toTest(t: Tally): BandTest | null {
  if (t.runs === 0) return null
  const maePersonalPct = (t.personal / t.runs) * 100
  const maeDefaultPct = (t.default / t.runs) * 100
  const gainPct = maeDefaultPct > 0 ? ((maeDefaultPct - maePersonalPct) / maeDefaultPct) * 100 : 0
  return {
    runs: t.runs,
    maePersonalPct,
    maeDefaultPct,
    gainPct,
    wins: t.wins,
    signTestP: signTestP(t.wins, t.runs),
  }
}

function backtestPrepared(prepared: Prepared[]): GradeBacktest {
  const bands: Tally[] = Array.from({ length: BAND_COUNT }, () => ({
    runs: 0,
    personal: 0,
    default: 0,
    wins: 0,
  }))
  const all: Tally = { runs: 0, personal: 0, default: 0, wins: 0 }
  let tested = 0
  const minSec = P.i13.minTestBandMin.value * 60
  prepared.forEach((held, k) => {
    const others = prepared.filter((_, i) => i !== k)
    let any = false
    for (let b = 0; b < BAND_COUNT; b++) {
      const actual = held.ratio[b]
      if (
        b === FLAT_BAND ||
        isSteepEnd(b) ||
        actual === null ||
        actual === undefined ||
        held.sec[b]! < minSec
      )
        continue
      const personal = pool(others, b).personal
      if (personal === null) continue
      const errPersonal = Math.abs(personal - actual) / actual
      const errDefault = Math.abs(defaultRatio(b) - actual) / actual
      for (const tally of [bands[b]!, all]) {
        tally.runs += 1
        tally.personal += errPersonal
        tally.default += errDefault
        if (errPersonal < errDefault) tally.wins += 1
      }
      any = true
    }
    if (any) tested += 1
  })
  return { runs: tested, bands: bands.map(toTest), overall: toTest(all) }
}

function prepareAll(runs: readonly GradeCurveRun[], today: string): Prepared[] {
  const out: Prepared[] = []
  for (const run of runs) {
    const prepared = prepare(run, today)
    if (prepared) out.push(prepared)
  }
  return out
}

/**
 * Leave-one-run-out test of the personal ratios against Minetti [rule I13]: each eligible run's
 * band ratio is predicted from the other runs (the shrunk pooled ratio, where that band speaks) and
 * from Minetti, and the relative errors are averaged per band. The pairs where the personal error is
 * the lower are counted for the sign test. The open steep ends are not tested.
 */
export function backtestGradeCurve(runs: readonly GradeCurveRun[], today: string): GradeBacktest {
  return backtestPrepared(prepareAll(runs, today))
}

/**
 * The runner's curve on `today` [rule I13]. A band shows the personal ratio only when it speaks and
 * the backtest favours it; every other band shows Minetti and the reason.
 */
export function gradeCurve(runs: readonly GradeCurveRun[], today: string): GradeCurve {
  const prepared = prepareAll(runs, today)
  const test = backtestPrepared(prepared)
  const bands: GradeBand[] = []
  for (let b = 0; b < BAND_COUNT; b++) {
    const pooled = pool(prepared, b)
    const bandTest = test.bands[b] ?? null
    const fallback = defaultRatio(b)
    let reason: BandReason
    if (b === FLAT_BAND) reason = 'flat'
    else if (isSteepEnd(b)) reason = 'steep-end'
    else if (pooled.reason) reason = pooled.reason
    else if (!bandTest || bandTest.runs < Math.max(P.i13.minBacktestRuns.value, minSignTestPairs()))
      reason = 'untested'
    else if (bandTest.gainPct < P.i13.minGainOverDefaultPct.value) reason = 'no-gain'
    else if (bandTest.signTestP > P.i13.maxSignTestP.value) reason = 'inconsistent'
    else reason = 'personal'
    const personal = reason === 'personal'
    bands.push({
      index: b,
      fromPct: EDGES[b - 1] ?? null,
      toPct: EDGES[b] ?? null,
      midPct: midPct(b),
      minutes: pooled.minutes,
      runs: pooled.runs,
      defaultRatio: fallback,
      personalRatio: isSteepEnd(b) ? null : pooled.personal,
      ratio: b === FLAT_BAND ? 1 : personal ? pooled.personal! : fallback,
      source: personal ? 'personal' : 'default',
      reason,
      walkShare: pooled.walkShare,
      test: bandTest,
    })
  }
  const walked = bands.find(
    (band) =>
      band.midPct > 0 &&
      band.fromPct !== null &&
      band.walkShare !== null &&
      band.walkShare > P.i13.walkingMajorityShare.value,
  )
  return {
    eligibleRuns: prepared.length,
    flatMinutes: prepared.reduce((sum, run) => sum + run.sec[FLAT_BAND]! / 60, 0),
    bands,
    walkingFromPct: walked?.fromPct ?? null,
    overall: test.overall,
  }
}

/**
 * Flat metres of time per metre of gain on a climb of `gradePct` run at `ratio` times the flat
 * speed: (1 / grade) horizontal metres per metre of gain, each costing 1 / ratio flat metres of
 * time, less the horizontal metres themselves. The figure `l5.gainEquivalentM` stands for.
 */
export function gainEquivalent(gradePct: number, ratio: number): number {
  return (100 / gradePct) * (1 / ratio - 1)
}

/**
 * The runner's climbing against Minetti's, as one ratio [rule L5]: the gain-equivalent of the
 * climbing bands with the personal ratios where the curve shows them and Minetti elsewhere, over
 * the gain-equivalent of the same bands with Minetti in every band. Both use the same weights, the
 * share of a typical course's gain in each climbing band (`l5.climbBandGainShare`), so one gentle
 * band moves the ratio only by its share. Below 1 the runner climbs faster than Minetti allows for.
 * Null when no climbing band shows a personal ratio.
 */
export function personalClimbRatio(curve: GradeCurve): number | null {
  const climbing = curve.bands.filter((band) => band.midPct > 0)
  if (!climbing.some((band) => band.source === 'personal')) return null
  const shares = P.l5.climbBandGainShare.value
  let personal = 0
  let minetti = 0
  climbing.forEach((band, i) => {
    const share = shares[i] ?? 0
    personal += share * gainEquivalent(band.midPct, band.ratio)
    minetti += share * gainEquivalent(band.midPct, band.defaultRatio)
  })
  return minetti > 0 ? personal / minetti : null
}

/** The runs the curve reads: runs (not races) that are not flagged duplicates. */
export function curveRunsOf(activities: readonly Activity[]): GradeCurveRun[] {
  return activities
    .filter((a) => a.type === 'run' && !isDuplicate(a))
    .map((a) => ({ id: a.id, date: a.date, bins: a.terrainBins }))
}

/**
 * The runner's own climbing as the state carries it [rule L5]: `personalClimbRatio` of the curve on
 * `today` and the runs behind its passing climbing bands; null when no climbing band shows a personal ratio.
 */
export function personalClimbOf(
  activities: readonly Activity[],
  today: string,
): { ratio: number; runs: number } | null {
  const curve = gradeCurve(curveRunsOf(activities), today)
  const ratio = personalClimbRatio(curve)
  if (ratio === null) return null
  // The runs behind the climbing bands that passed: the most any one of them rests on.
  const runs = Math.max(
    ...curve.bands
      .filter((band) => band.midPct > 0 && band.source === 'personal')
      .map((b) => b.runs),
  )
  return { ratio, runs }
}

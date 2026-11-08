// The personal speed-by-grade curve [rule I13]. Pure and deterministic; display only, nothing in the
// plan, the zones or the predictions reads it (`personalGainEquivalent` is the one function that
// could replace `l5.gainEquivalentM`, and no engine path calls it until the owner decides).
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
} from '../importers/files/terrainBins.ts'
import type { TerrainBins } from '../types.ts'
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
  /** Tested on fewer than `i13.minBacktestRuns` runs. */
  | 'untested'
  /** Tested, and not lower in error than Minetti by `i13.minGainOverDefaultPct`. */
  | 'no-gain'

/** Leave-one-run-out error of one band (or of all bands pooled). Errors are relative, in percent. */
export interface BandTest {
  /** Held-out runs that were tested here (pairs of run and band for the pooled figure). */
  runs: number
  maePersonalPct: number
  maeDefaultPct: number
  /** How much lower the personal error is than the default error, in percent of the default. */
  gainPct: number
}

export interface GradeBand {
  index: number
  /** Lower edge in percent grade; null for the open steep descent. */
  fromPct: number | null
  /** Upper edge in percent grade; null for the open steep climb. */
  toPct: number | null
  /** The grade the Minetti ratio is read at: the middle of the band (an open end: half a neighbour's width beyond its edge). */
  midPct: number
  /** Pooled minutes in the band over the eligible runs. */
  minutes: number
  /** Eligible runs that reached the band. */
  runs: number
  /** Speed relative to flat from Minetti: one over the cost ratio at `midPct`. */
  defaultRatio: number
  /** The shrunk personal ratio; null when the band does not speak. Shown only when `source` is personal. */
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
}

function toTest(t: Tally): BandTest | null {
  if (t.runs === 0) return null
  const maePersonalPct = (t.personal / t.runs) * 100
  const maeDefaultPct = (t.default / t.runs) * 100
  const gainPct = maeDefaultPct > 0 ? ((maeDefaultPct - maePersonalPct) / maeDefaultPct) * 100 : 0
  return { runs: t.runs, maePersonalPct, maeDefaultPct, gainPct }
}

function backtestPrepared(prepared: Prepared[]): GradeBacktest {
  const bands: Tally[] = Array.from({ length: BAND_COUNT }, () => ({
    runs: 0,
    personal: 0,
    default: 0,
  }))
  const all: Tally = { runs: 0, personal: 0, default: 0 }
  let tested = 0
  const minSec = P.i13.minTestBandMin.value * 60
  prepared.forEach((held, k) => {
    const others = prepared.filter((_, i) => i !== k)
    let any = false
    for (let b = 0; b < BAND_COUNT; b++) {
      const actual = held.ratio[b]
      if (b === FLAT_BAND || actual === null || actual === undefined || held.sec[b]! < minSec)
        continue
      const personal = pool(others, b).personal
      if (personal === null) continue
      const errPersonal = Math.abs(personal - actual) / actual
      const errDefault = Math.abs(defaultRatio(b) - actual) / actual
      for (const tally of [bands[b]!, all]) {
        tally.runs += 1
        tally.personal += errPersonal
        tally.default += errDefault
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
 * from Minetti, and the relative errors are averaged per band.
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
    else if (pooled.reason) reason = pooled.reason
    else if (!bandTest || bandTest.runs < P.i13.minBacktestRuns.value) reason = 'untested'
    else if (bandTest.gainPct < P.i13.minGainOverDefaultPct.value) reason = 'no-gain'
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
      personalRatio: pooled.personal,
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
 * The climbing bands that show the runner's own ratio, as flat metres per metre of gain, weighted
 * by their minutes; null when no climbing band does. Nothing calls it yet (decision O3: whether the
 * personal curve may replace `l5.gainEquivalentM` in predictions is the owner's).
 */
export function personalGainEquivalent(curve: GradeCurve): number | null {
  let weight = 0
  let sum = 0
  for (const band of curve.bands) {
    if (band.source !== 'personal' || band.midPct <= 0) continue
    weight += band.minutes
    sum += band.minutes * gainEquivalent(band.midPct, band.ratio)
  }
  return weight > 0 ? sum / weight : null
}

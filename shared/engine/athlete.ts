// Athlete state from the input history [rules section a]. Pure: the same input gives the same
// state; nothing reads the clock, the network or the database.
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import { aggregateWeeks } from '../domain/weeks.ts'
import type { Activity, AthleteProfile, WeekRow } from '../types.ts'
import { countsTowardReference } from './limits.ts'
import {
  criticalSpeed,
  dailyLoad,
  ewma,
  isDuplicate,
  sessionLoad,
  steadyFlatSample,
  type LoadContext,
  type LoadMetric,
} from './load.ts'
import { P } from './params/index.ts'
import type { AthleteState, EngineInput } from './types.ts'

const WEEKS_SHOWN = 16
const DAYS_PER_WEEK = 7
const INDOOR_OR_TRACK = /treadmill|indoor|track/i

const isRun = (a: Activity) => a.type === 'run' || a.type === 'race'

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4))
}

/** Body mass index from the profile height and weight; null when either is missing. */
export function bmiOf(profile: AthleteProfile): number | null {
  if (profile.weightKg === null || profile.heightCm === null || profile.heightCm <= 0) return null
  return profile.weightKg / (profile.heightCm / 100) ** 2
}

/** Novice, returning, recreational or trained [rules A5]. */
export function experienceClass(input: {
  profile: AthleteProfile
  weeks: WeekRow[]
  layoffDays: number
  yearsRunning: number | null
}): AthleteState['experience'] {
  const { weeks, layoffDays, yearsRunning } = input
  const runWeeks = weeks.filter((w) => w.runMin > 0 || w.raceMin > 0).length
  const meanWeeklyMin =
    weeks.length === 0 ? 0 : weeks.reduce((s, w) => s + w.runMin, 0) / weeks.length
  if (layoffDays >= P.a5.noviceLayoffDays.value) return 'novice'
  if (
    runWeeks < P.a5.noviceMinRunWeeks.value &&
    (yearsRunning === null || yearsRunning < P.a5.noviceMaxYears.value)
  ) {
    return 'novice'
  }
  if (layoffDays >= P.a5.returningLayoffDays.value) return 'returning'
  if (
    yearsRunning !== null &&
    yearsRunning >= P.a5.trainedMinYears.value &&
    meanWeeklyMin >= P.a5.trainedMinWeeklyMin.value
  ) {
    return 'trained'
  }
  return 'recreational'
}

/** Metres per heartbeat of one steady run: speed (m/min) over average HR. */
function metresPerBeat(a: Activity): number | null {
  const distance = a.gapDistanceM ?? a.distanceM
  const seconds = a.movingSec ?? a.durationSec
  if (distance === null || distance <= 0 || seconds <= 0 || a.avgHr === null || a.avgHr <= 0) {
    return null
  }
  return ((distance / seconds) * 60) / a.avgHr
}

/**
 * Pace at a fixed HR on steady flat runs, as metres per heartbeat, with its change from the
 * window before [rules A8]. Only runs that pass the steady-and-flat sample checks, last 20-90
 * minutes and were not run in heat count. `asOf` defaults to the latest activity date.
 */
export function efficiencyIndex(activities: Activity[], asOf?: string): AthleteState['efficiency'] {
  const dated = activities.filter((a) => !isDuplicate(a))
  if (dated.length === 0) return { current: null, trendPct: null, samples: 0 }
  const end = asOf ?? dated.map((a) => a.date).sort()[dated.length - 1] ?? ''
  const recentDays = P.a8.recentWeeks.value * DAYS_PER_WEEK
  const priorDays = P.a8.priorWeeks.value * DAYS_PER_WEEK
  const recent: number[] = []
  const prior: number[] = []
  for (const a of dated) {
    if (a.type !== 'run' || !steadyFlatSample(a)) continue
    const minutes = (a.movingSec ?? a.durationSec) / 60
    if (minutes < P.a8.minDurationMin.value || minutes > P.a8.maxDurationMin.value) continue
    if (a.tempC !== null && a.tempC >= P.a7.heatExcludeC.value) continue
    const value = metresPerBeat(a)
    if (value === null) continue
    const age = daysBetween(a.date, end)
    if (age >= 0 && age < recentDays) recent.push(value)
    else if (age >= recentDays && age < recentDays + priorDays) prior.push(value)
  }
  const min = P.a8.minRunsPerWindow.value
  const current = recent.length >= min ? median(recent) : null
  const before = prior.length >= min ? median(prior) : null
  return {
    current,
    trendPct: current !== null && before !== null ? (current / before - 1) * 100 : null,
    samples: recent.length + prior.length,
  }
}

/** Runs of `gapMinDays` or more with no run, inside the window, counted across the history. */
function countGaps(runDates: string[], today: string): number {
  if (runDates.length === 0) return 0
  const windowStart = addDays(today, -(P.a4.gapWindowWeeks.value * DAYS_PER_WEEK - 1))
  const min = P.a4.gapMinDays.value
  // Empty days a..b (inclusive) that fall inside the window.
  const inWindow = (from: string, to: string) => {
    const start = from < windowStart ? windowStart : from
    return to < start ? 0 : daysBetween(start, to) + 1
  }
  let gaps = 0
  for (let i = 1; i < runDates.length; i += 1) {
    const before = runDates[i - 1] as string
    const after = runDates[i] as string
    if (inWindow(addDays(before, 1), addDays(after, -1)) >= min) gaps += 1
  }
  const last = runDates[runDates.length - 1] as string
  if (inWindow(addDays(last, 1), today) >= min) gaps += 1
  return gaps
}

function longestRuns(runs: Activity[], today: string): AthleteState['longest30d'] {
  const windowStart = addDays(today, -(P.a3.longestRunWindowDays.value - 1))
  // a race of marathon distance or longer is no reference run [rules A3, G-1]
  const recent = runs.filter((a) => a.date >= windowStart && countsTowardReference(a))
  const perDay = new Map<string, number>()
  for (const a of recent) perDay.set(a.date, (perDay.get(a.date) ?? 0) + a.durationSec)
  let twoDaySec = 0
  for (const [date, sec] of perDay) {
    twoDaySec = Math.max(twoDaySec, sec + (perDay.get(addDays(date, 1)) ?? 0))
  }
  const maxOf = (pick: (a: Activity) => number | null) =>
    recent.reduce((m, a) => Math.max(m, pick(a) ?? 0), 0)
  return {
    distanceM: maxOf((a) => a.distanceM),
    durationSec: maxOf((a) => a.durationSec),
    gainM: maxOf((a) => a.elevationGainM),
    lossM: maxOf((a) => a.elevationLossM),
    twoDaySec,
  }
}

/** HR anchors for TRIMP: measured HRmax, else the age prior [rules C3]; zones.ts refines both. */
function hrAnchors(profile: AthleteProfile, age: number | null): LoadContext['zones'] {
  let hrMax: LoadContext['zones']['hrMax'] = null
  if (profile.hrMax !== null) {
    hrMax = {
      value: profile.hrMax,
      band: [profile.hrMax, profile.hrMax],
      source: profile.hrMaxSource === 'measured' ? 'hrmax-observed' : 'profile',
      asOf: '',
    }
  } else if (age !== null) {
    const value = P.c3.hrMaxIntercept.value - P.c3.hrMaxAgeSlope.value * age
    const band = P.c3.priorBandBpm.value
    hrMax = { value, band: [value - band, value + band], source: 'hrmax-age', asOf: '' }
  }
  return { hrMax, hrRest: profile.hrRest }
}

/**
 * The metric that drives the load series: sRPE when most recent runs carry a rating, else TRIMP
 * when most have qualified HR, else minutes. Never a mix [rules B4].
 */
function chooseMetric(runs: Activity[], ctx: LoadContext, today: string): LoadMetric {
  const windowStart = addDays(today, -(P.a2.chronicDays.value - 1))
  const recent = runs.filter((a) => a.date >= windowStart)
  if (recent.length === 0) return 'minutes'
  const share = P.b4.metricMinCoverage.value
  const loads = recent.map((a) => sessionLoad(a, ctx))
  if (loads.filter((l) => l.srpe !== null).length / recent.length >= share) return 'srpe'
  if (loads.filter((l) => l.trimp !== null).length / recent.length >= share) return 'trimp'
  return 'minutes'
}

function fillDaily(
  sparse: Array<{ date: string; load: number }>,
  today: string,
  length: number,
): Array<{ date: string; load: number }> {
  const byDate = new Map(sparse.map((p) => [p.date, p.load]))
  return Array.from({ length }, (_, i) => {
    const date = addDays(today, i - length + 1)
    return { date, load: byDate.get(date) ?? 0 }
  })
}

/** Distance that is flat-equivalent: the grade-adjusted figure, or raw distance on flat ground. */
function flatDistance(a: Activity): number | null {
  if (a.gapDistanceM !== null) return a.gapDistanceM
  if (a.distanceM === null || a.distanceM <= 0) return null
  const indoor = a.subtype !== null && INDOOR_OR_TRACK.test(a.subtype)
  if (indoor) return a.distanceM
  if (a.elevationGainM === null) return null
  return a.elevationGainM / (a.distanceM / 1000) <= P.b2.flatMaxGainPerKm.value ? a.distanceM : null
}

function fitnessOf(runs: Activity[], input: EngineInput, today: string): AthleteState['fitness'] {
  // Critical speed: the fastest grade-adjusted effort of each distance band inside the window.
  const edges = [
    P.a6.csMinDistanceM.value,
    ...P.a6.csBandInnerEdgesM.value,
    P.a6.csMaxDistanceM.value,
  ]
  const best = new Map<number, { distanceM: number; timeSec: number }>()
  for (const a of runs) {
    const age = daysBetween(a.date, today)
    if (age < 0 || age >= P.a6.csWindowDays.value) continue
    const distanceM = flatDistance(a)
    const timeSec = a.movingSec ?? a.durationSec
    if (distanceM === null || timeSec <= 0) continue
    if (distanceM < edges[0]! || distanceM > edges[edges.length - 1]!) continue
    let band = 0
    while (band + 1 < edges.length - 1 && distanceM >= edges[band + 1]!) band += 1
    const held = best.get(band)
    if (!held || distanceM / timeSec > held.distanceM / held.timeSec) {
      best.set(band, { distanceM, timeSec })
    }
  }
  const cs = criticalSpeed([...best.values()])

  const races = runs
    .filter(
      (a) => a.type === 'race' && a.distanceM !== null && a.distanceM > 0 && a.durationSec > 0,
    )
    .map((a) => ({ date: a.date, distanceM: a.distanceM as number, timeSec: a.durationSec }))
  return {
    csMps: cs?.csMps ?? null,
    dPrimeM: cs?.dPrimeM ?? null,
    csEfforts: best.size,
    exponent: personalExponent(races),
    races,
    vo2maxTrend: vo2maxTrend(input, today),
  }
}

/** Least-squares slope of ln(time) on ln(distance) over races at different distances [A6]. */
function personalExponent(races: Array<{ distanceM: number; timeSec: number }>): number | null {
  if (races.length < P.a6.exponentMinRaces.value) return null
  const distances = races.map((r) => r.distanceM)
  if (Math.max(...distances) < P.a6.exponentMinDistanceRatio.value * Math.min(...distances)) {
    return null
  }
  const xs = races.map((r) => Math.log(r.distanceM))
  const ys = races.map((r) => Math.log(r.timeSec))
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length
  const my = ys.reduce((s, v) => s + v, 0) / ys.length
  let sxy = 0
  let sxx = 0
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i]! - my)
    sxx += (x - mx) ** 2
  })
  if (sxx === 0) return null
  const slope = sxy / sxx
  const [lo, hi] = P.a6.exponentPlausible.value
  return slope >= lo && slope <= hi ? slope : null
}

/** Device VO2max: a smoothed slope, ml/kg/min per `vo2maxTrendPerDays`, never a level [A6]. */
function vo2maxTrend(input: EngineInput, today: string): number | null {
  const points = input.wellness
    .filter((w) => w.vo2max !== null && w.date <= today)
    .map((w) => ({ day: daysBetween(w.date, today), value: w.vo2max as number }))
    .filter((p) => p.day < P.a6.vo2maxWindowDays.value)
  if (points.length < P.a6.vo2maxMinReadings.value) return null
  const mx = points.reduce((s, p) => s + p.day, 0) / points.length
  const my = points.reduce((s, p) => s + p.value, 0) / points.length
  let sxy = 0
  let sxx = 0
  for (const p of points) {
    sxy += (p.day - mx) * (p.value - my)
    sxx += (p.day - mx) ** 2
  }
  if (sxx === 0) return null
  // `day` counts backwards from today, so the slope against calendar time has the opposite sign.
  return (-sxy / sxx) * P.a6.vo2maxTrendPerDays.value
}

/**
 * Median decoupling of the largest group of comparable, cool long runs [A7]. A long run lasts
 * from the reference duration of the durability prior (90 min) up to the drift inference limit.
 */
function durabilityOf(runs: Activity[]): AthleteState['durability'] {
  const candidates = runs.filter(
    (a) =>
      a.type === 'run' &&
      a.decouplingPct !== null &&
      a.tempC !== null &&
      a.tempC < P.a7.heatExcludeC.value &&
      a.durationSec >= P.a7.thresholdDropAfterMin.value * 60 &&
      a.durationSec <= P.a7.driftInferenceLimitMin.value * 60,
  )
  let best: Activity[] = []
  for (const anchor of candidates) {
    const group = candidates.filter(
      (a) =>
        Math.abs(a.durationSec - anchor.durationSec) <=
          P.a7.comparableDurationTolerance.value * anchor.durationSec &&
        Math.abs((a.tempC as number) - (anchor.tempC as number)) <=
          P.a7.comparableTempToleranceC.value,
    )
    const newer = group.length === best.length && anchor.date > (best[0]?.date ?? '')
    if (group.length > best.length || newer) best = group
  }
  return {
    decouplingMedianPct:
      best.length >= P.a7.minComparableRuns.value
        ? median(best.map((a) => a.decouplingPct as number))
        : null,
    samples: best.length,
  }
}

/** Heat acclimation credit, 0..1: gained on exposure days, lost at a fixed rate otherwise [I8]. */
function heatCredit(acts: Activity[], today: string): number {
  const exposed = new Set(
    acts
      .filter(
        (a) =>
          a.type !== 'strength' &&
          a.tempC !== null &&
          a.tempC >= P.acclim.exposureTempC.value &&
          a.durationSec / 60 >= P.acclim.exposureMinDurationMin.value,
      )
      .map((a) => a.date),
  )
  const gain = 1 / P.i8.blockDays.value
  const decay = P.i8.decayPctPerDay.value / 100
  const days = P.i8.zeroCreditDays.value
  let credit = 0
  for (let i = days; i >= 0; i -= 1) {
    credit = exposed.has(addDays(today, -i))
      ? Math.min(1, credit + gain)
      : Math.max(0, credit - decay)
  }
  return credit
}

function riskOf(
  input: EngineInput,
  weeks: WeekRow[],
  age: number | null,
  lastRunDate: string | null,
  yearsRunning: number | null,
): AthleteState['risk'] {
  const { profile, today } = input
  const monthsNow = yearOf(today) * 12 + Number(today.slice(5, 7))
  const recentInjury = profile.injuries.some(
    (i) => monthsNow - (i.year * 12 + (i.month ?? 12)) <= P.a9.recentInjuryWindowMonths.value,
  )
  const priorBsi = profile.injuries.some((i) => i.kind === 'bone-stress')
  const bmi = bmiOf(profile)

  const recentWeeks = weeks.slice(-1 - P.a9.bsiWeeklyWindowWeeks.value, -1)
  const weeklyHours =
    recentWeeks.length === 0
      ? 0
      : recentWeeks.reduce((s, w) => s + w.runMin + w.raceMin, 0) / recentWeeks.length / 60
  const bsiFactors =
    (priorBsi ? 1 : 0) +
    (weeklyHours >= P.a9.bsiWeeklyHours.value ? 1 : 0) +
    (profile.sex === 'female' && bmi !== null && bmi < P.a9.bsiBmiBelow.value ? 1 : 0)

  // The soft start flags apply to every runner: they decide whether the start path may lift a
  // returner to 30-minute sessions (E6), and they only ever make the start gentler.
  const noviceFlags: string[] = []
  if (age !== null && age >= P.a9.noviceFlagAgeMin.value) {
    noviceFlags.push(`age-${P.a9.noviceFlagAgeMin.value}-plus`)
  }
  if (bmi !== null && bmi > P.a9.noviceFlagBmiAbove.value) {
    noviceFlags.push(`bmi-over-${P.a9.noviceFlagBmiAbove.value}`)
  }
  if (recentInjury) noviceFlags.push('injury-last-12-months')
  if (lastRunDate === null && (yearsRunning === null || yearsRunning === 0)) {
    noviceFlags.push('no-running-history')
  }
  const screened = input.screeningFlags ?? 0
  const redsFlags = Number.isFinite(screened) ? Math.max(0, Math.floor(screened)) : 0
  return { recentInjury, priorBsi, bsiFactors, redsFlags, noviceFlags }
}

/**
 * The recent level [rules E6]: the lesser of the run minutes of the last
 * `macroDesign.startRecentWeeks` complete weeks, and 0 unless every one of them holds a run.
 * `weeks` ends with the current week, which is part of a week and never counts.
 */
function recentLevel(weeks: WeekRow[]): number {
  const count = P.macroDesign.startRecentWeeks.value
  const recent = weeks.slice(-1 - count, -1)
  if (recent.length < count || recent.some((w) => w.runMin <= 0)) return 0
  return Math.min(...recent.map((w) => w.runMin))
}

/**
 * Completed runs average under `a5.lowFrequencyRunsPerWeek` a week over the last
 * `a5.lowFrequencyWindowWeeks` weeks, for a runner whose start level (`startLevelMin`, limits.ts)
 * is at or above the start-path floor [rules A5]: those below the floor have a start path (E6)
 * instead.
 */
function lowFrequencyOf(runs: Activity[], today: string, startLevel: number): boolean {
  if (startLevel < P.restartFloor.sessions.value * P.restartFloor.sessionMin.value) return false
  const weeks = P.a5.lowFrequencyWindowWeeks.value
  const inWindow = runs.filter((a) => {
    const ago = daysBetween(a.date, today)
    return ago >= 0 && ago < weeks * DAYS_PER_WEEK
  })
  return inWindow.length / weeks < P.a5.lowFrequencyRunsPerWeek.value
}

/** Athlete state from the input history [rules section a]. */
export function estimateState(input: EngineInput): AthleteState {
  const { today, profile } = input
  const acts = input.activities.filter((a) => !isDuplicate(a) && a.date <= today)
  const runs = acts.filter(isRun)

  const age = profile.birthYear === null ? null : yearOf(today) - profile.birthYear
  const yearsRunning =
    profile.runningSinceYear === null ? null : Math.max(0, yearOf(today) - profile.runningSinceYear)

  const currentMonday = mondayOf(today)
  const weekStarts = Array.from({ length: WEEKS_SHOWN }, (_, i) =>
    addDays(currentMonday, -DAYS_PER_WEEK * (WEEKS_SHOWN - 1 - i)),
  )
  const weeks = aggregateWeeks(acts, weekStarts)
  const typical = weeks
    .slice(0, -1)
    .reverse()
    .filter((w) => w.runMin > 0)
    .slice(0, P.a5.typicalWeekCount.value)
    .map((w) => w.runMin)
  const typicalWeekMin = typical.length === 0 ? 0 : Math.round(median(typical))
  const recentWeekMin = recentLevel(weeks)

  const runDates = [...new Set(runs.map((a) => a.date))].sort()
  const lastRunDate = runDates[runDates.length - 1] ?? null
  const layoffDays =
    lastRunDate === null ? P.a5.historyWindowDays.value : daysBetween(lastRunDate, today)

  const experience = experienceClass({ profile, weeks, layoffDays, yearsRunning })

  const ctx: LoadContext = { profile, zones: hrAnchors(profile, age) }
  const metric = chooseMetric(runs, ctx, today)
  const sparse = dailyLoad(acts, ctx, metric)
  const series =
    sparse.length > 0 && sparse[sparse.length - 1]!.date === today
      ? sparse
      : [...sparse, { date: today, load: 0 }]

  return {
    asOf: today,
    age,
    sex: profile.sex,
    experience,
    yearsRunning,
    load: {
      metric,
      acute: ewma(sparse.length === 0 ? [] : series, P.a2.acuteDays.value),
      chronic: ewma(sparse.length === 0 ? [] : series, P.a2.chronicDays.value),
      daily: fillDaily(sparse, today, P.a2.dailyWindowDays.value),
    },
    weeks,
    typicalWeekMin,
    recentWeekMin,
    longest30d: longestRuns(runs, today),
    gaps16w: countGaps(runDates, today),
    layoffDays,
    lastRunDate,
    fitness: fitnessOf(runs, input, today),
    efficiency: efficiencyIndex(acts, today),
    durability: durabilityOf(runs),
    risk: riskOf(input, weeks, age, lastRunDate, yearsRunning),
    lowFrequency: lowFrequencyOf(runs, today, Math.max(typicalWeekMin, recentWeekMin)),
    heatAcclimation: heatCredit(acts, today),
  }
}

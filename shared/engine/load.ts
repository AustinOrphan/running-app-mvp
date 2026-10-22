// Per-activity load and the daily series [rules section b], plus the descriptive views that sit
// next to it: sRPE against HR-load divergence [B5] and monotony and strain [B7].
// sRPE and TRIMP are different scales. Nothing in this file adds, converts or compares them in
// one number; a series is built from one metric and an activity without that metric is left
// out of it, never imputed [B2, B4].
import { addDays, daysBetween } from '../dates.ts'
import type { Activity, AthleteProfile } from '../types.ts'
import { P } from './params/index.ts'
import type { AthleteState, ZoneSet } from './types.ts'

export interface LoadContext {
  profile: AthleteProfile
  /** Only the HR anchors are read, so any full `ZoneSet` fits. */
  zones: Pick<ZoneSet, 'hrMax' | 'hrRest'>
  /** TRIMP constants when the profile's sex is unspecified; the default is male [B3]. */
  trimpSex?: 'female' | 'male'
}

export type LoadMetric = AthleteState['load']['metric']

/** Device names that mean a chest strap; everything else is treated as optical (wrist). */
const CHEST_STRAP = /chest|strap|\bhrm\b|hrm-|polar h\d|\bh10\b|\bh9\b|tickr|wahoo/i
const TRAIL = /trail|hike|mountain/i
const INDOOR = /treadmill|indoor/i

export function isChestStrap(activity: Activity): boolean {
  return activity.deviceName !== null && CHEST_STRAP.test(activity.deviceName)
}

export function isDuplicate(activity: Activity): boolean {
  return activity.duplicateStatus === 'possible' || activity.duplicateStatus === 'confirmed'
}

function histogramMean(
  h: NonNullable<Activity['hrHistogram']>,
): { mean: number; sec: number } | null {
  let sec = 0
  let weighted = 0
  h.sec.forEach((s, i) => {
    sec += s
    weighted += s * binHr(h, i)
  })
  return sec > 0 ? { mean: weighted / sec, sec } : null
}

/** Heart rate that a histogram bin stands for: the lower edge plus half the width. */
function binHr(h: NonNullable<Activity['hrHistogram']>, index: number): number {
  return h.start + index * h.width + (h.width - 1) / 2
}

/**
 * True when the run is flat and its heart rate is steady with full coverage: the conditions under
 * which wrist HR is trusted [B2] and an efficiency sample is comparable [A8]. Needs a histogram;
 * a run without one cannot pass the sample checks.
 */
export function steadyFlatSample(activity: Activity): boolean {
  if (activity.type !== 'run' && activity.type !== 'race') return false
  if (activity.subtype !== null && TRAIL.test(activity.subtype)) return false
  const gain = activity.elevationGainM
  if (gain === null) {
    if (activity.subtype === null || !INDOOR.test(activity.subtype)) return false
  } else if (activity.distanceM !== null && activity.distanceM > 0) {
    if (gain / (activity.distanceM / 1000) > P.b2.flatMaxGainPerKm.value) return false
  } else {
    return false
  }
  const h = activity.hrHistogram
  if (!h) return false
  const stats = histogramMean(h)
  if (!stats) return false
  if (stats.sec < P.b2.minHistogramCoverage.value * activity.durationSec) return false
  let near = 0
  h.sec.forEach((s, i) => {
    if (Math.abs(binHr(h, i) - stats.mean) <= P.b2.steadyHrBandBpm.value) near += s
  })
  return near / stats.sec >= P.b2.steadyMinShare.value
}

interface HrBounds {
  hrMax: number
  hrRest: number
}

function hrBounds(ctx: LoadContext): HrBounds | null {
  const hrMax = ctx.zones.hrMax?.value ?? null
  const hrRest = ctx.zones.hrRest ?? ctx.profile.hrRest
  if (hrMax === null || hrRest === null || hrMax <= hrRest) return null
  return { hrMax, hrRest }
}

/** Chest strap always; wrist only on steady flat runs that pass the sample checks [B2]. */
function hrQualifies(activity: Activity, bounds: HrBounds | null): boolean {
  if (bounds === null || activity.avgHr === null) return false
  if (activity.avgHr > bounds.hrMax || activity.avgHr < bounds.hrRest) return false
  if (isChestStrap(activity)) return true
  return steadyFlatSample(activity)
}

function trimpConstants(ctx: LoadContext): { weight: number; exponent: number } {
  const sex =
    ctx.profile.sex === 'female' || ctx.profile.sex === 'male'
      ? ctx.profile.sex
      : (ctx.trimpSex ?? 'male')
  return sex === 'female'
    ? { weight: P.b3.trimpWeightFemale.value, exponent: P.b3.trimpExponentFemale.value }
    : { weight: P.b3.trimpWeightMale.value, exponent: P.b3.trimpExponentMale.value }
}

/** Banister TRIMP: minutes x HRR fraction x weight x e^(b x), from the histogram when present. */
function trimpOf(activity: Activity, bounds: HrBounds, ctx: LoadContext): number {
  const { weight, exponent } = trimpConstants(ctx)
  const part = (minutes: number, hr: number) => {
    const x = Math.min(1, Math.max(0, (hr - bounds.hrRest) / (bounds.hrMax - bounds.hrRest)))
    return minutes * x * weight * Math.exp(exponent * x)
  }
  const h = activity.hrHistogram
  if (h && h.sec.some((s) => s > 0)) {
    return h.sec.reduce((sum, s, i) => (s > 0 ? sum + part(s / 60, binHr(h, i)) : sum), 0)
  }
  return part(activity.durationSec / 60, activity.avgHr as number)
}

/** sRPE primary, TRIMP only on qualified HR, never mixed [rules B1-B4]. */
export function sessionLoad(
  activity: Activity,
  ctx: LoadContext,
): { srpe: number | null; trimp: number | null; metric: LoadMetric; hrQualified: boolean } {
  const srpe = activity.rpe === null ? null : (activity.durationSec / 60) * activity.rpe
  const bounds = hrBounds(ctx)
  const hrQualified = hrQualifies(activity, bounds)
  const trimp = hrQualified && bounds ? trimpOf(activity, bounds, ctx) : null
  const metric: LoadMetric = srpe !== null ? 'srpe' : trimp !== null ? 'trimp' : 'minutes'
  return { srpe, trimp, metric, hrQualified }
}

function loadOn(activity: Activity, ctx: LoadContext, metric: LoadMetric): number | null {
  if (metric === 'minutes') return activity.durationSec / 60
  const load = sessionLoad(activity, ctx)
  return metric === 'srpe' ? load.srpe : load.trimp
}

/**
 * One metric summed per day, oldest first; only days with load. An activity that lacks the metric
 * is missing from the series, not estimated [B2]. Duplicates are skipped.
 */
export function dailyLoad(
  activities: Activity[],
  ctx: LoadContext,
  metric: LoadMetric,
): Array<{ date: string; load: number }> {
  const byDate = new Map<string, number>()
  for (const activity of activities) {
    if (isDuplicate(activity)) continue
    const load = loadOn(activity, ctx, metric)
    if (load === null) continue
    byDate.set(activity.date, (byDate.get(activity.date) ?? 0) + load)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, load]) => ({ date, load }))
}

/**
 * Exponentially weighted moving average of a daily series, as of its last date [rules A2], with
 * lambda = 2 / (N + 1). Days missing from the series count as zero load. The average starts at
 * zero before the first day, so it reads low until about N days of history exist.
 */
export function ewma(series: Array<{ date: string; load: number }>, days: number): number {
  if (series.length === 0) return 0
  const byDate = new Map<string, number>()
  for (const point of series) byDate.set(point.date, (byDate.get(point.date) ?? 0) + point.load)
  const dates = [...byDate.keys()].sort()
  const first = dates[0] as string
  const last = dates[dates.length - 1] as string
  const lambda = 2 / (days + 1)
  let value = 0
  for (let i = 0, span = daysBetween(first, last); i <= span; i += 1) {
    value += lambda * ((byDate.get(addDays(first, i)) ?? 0) - value)
  }
  return value
}

/** Linear distance-time fit over at least 3 efforts of 400-5000 m [rules A6]. */
export function criticalSpeed(
  efforts: Array<{ distanceM: number; timeSec: number }>,
): { csMps: number; dPrimeM: number } | null {
  const usable = efforts.filter(
    (e) =>
      e.timeSec > 0 &&
      e.distanceM >= P.a6.csMinDistanceM.value &&
      e.distanceM <= P.a6.csMaxDistanceM.value,
  )
  if (usable.length < P.a6.csMinEfforts.value) return null
  const times = usable.map((e) => e.timeSec)
  if (Math.max(...times) < P.a6.csMinTimeSpreadRatio.value * Math.min(...times)) return null
  const n = usable.length
  const meanT = times.reduce((s, t) => s + t, 0) / n
  const meanD = usable.reduce((s, e) => s + e.distanceM, 0) / n
  let sxy = 0
  let sxx = 0
  for (const e of usable) {
    sxy += (e.timeSec - meanT) * (e.distanceM - meanD)
    sxx += (e.timeSec - meanT) ** 2
  }
  if (sxx === 0) return null
  const csMps = sxy / sxx
  let dPrimeM = meanD - csMps * meanT
  if (dPrimeM > -1e-6 && dPrimeM < 0) dPrimeM = 0
  if (!(csMps > 0) || dPrimeM < 0) return null
  return { csMps, dPrimeM }
}

function meanSd(values: number[]): { mean: number; sd: number } {
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return { mean, sd: Math.sqrt(variance) }
}

/**
 * Sessions whose sRPE and HR-load z-scores, each against the athlete's own earlier sessions,
 * differ by more than 1.5 SD [rules B5]. Needs 8 earlier sessions that have both metrics. Shown,
 * never corrected: the two loads stay as they are.
 */
export function sessionDivergence(
  activities: Activity[],
  ctx: LoadContext,
): Array<{
  activityId: string
  date: string
  zSrpe: number
  zTrimp: number
  divergent: boolean
}> {
  const ordered = activities
    .map((activity, index) => ({ activity, index }))
    .filter(({ activity }) => !isDuplicate(activity))
    .sort((a, b) =>
      a.activity.date === b.activity.date
        ? a.index - b.index
        : a.activity.date < b.activity.date
          ? -1
          : 1,
    )
  const history: Array<{ srpe: number; trimp: number }> = []
  const out: ReturnType<typeof sessionDivergence> = []
  for (const { activity } of ordered) {
    const load = sessionLoad(activity, ctx)
    if (load.srpe === null || load.trimp === null) continue
    if (history.length >= P.b5.divergenceMinSessions.value) {
      const s = meanSd(history.map((h) => h.srpe))
      const t = meanSd(history.map((h) => h.trimp))
      if (s.sd > 0 && t.sd > 0) {
        const zSrpe = (load.srpe - s.mean) / s.sd
        const zTrimp = (load.trimp - t.mean) / t.sd
        out.push({
          activityId: activity.id,
          date: activity.date,
          zSrpe,
          zTrimp,
          divergent: Math.abs(zSrpe - zTrimp) > P.b5.divergenceSd.value,
        })
      }
    }
    history.push({ srpe: load.srpe, trimp: load.trimp })
  }
  return out
}

interface WeekStats {
  weeklyLoad: number
  monotony: number | null
  strain: number | null
}

function weekStats(byDate: Map<string, number>, end: string): WeekStats {
  const days = P.b7.monotonyWindowDays.value
  const values = Array.from({ length: days }, (_, i) => byDate.get(addDays(end, i - days + 1)) ?? 0)
  const { mean, sd } = meanSd(values)
  const weeklyLoad = values.reduce((s, v) => s + v, 0)
  const monotony = sd > 0 ? mean / sd : null
  return { weeklyLoad, monotony, strain: monotony === null ? null : weeklyLoad * monotony }
}

/**
 * Monotony (mean over SD of the daily load across the week ending `endDate`) and strain (weekly
 * load times monotony) [rules B7]. Descriptive: a flag appears only when the value exceeds the
 * athlete's own earlier range, and only with enough earlier weeks to define one.
 */
export function monotonyStrain(
  daily: Array<{ date: string; load: number }>,
  endDate: string,
): WeekStats & { monotonyFlag: boolean; strainFlag: boolean } {
  const byDate = new Map<string, number>()
  for (const point of daily) byDate.set(point.date, (byDate.get(point.date) ?? 0) + point.load)
  const current = weekStats(byDate, endDate)
  const firstDate = daily.length === 0 ? null : daily.map((d) => d.date).sort()[0]!
  const days = P.b7.monotonyWindowDays.value
  const earlierMonotony: number[] = []
  const earlierStrain: number[] = []
  if (firstDate !== null) {
    for (
      let end = addDays(endDate, -days);
      addDays(end, 1 - days) >= firstDate;
      end = addDays(end, -days)
    ) {
      const w = weekStats(byDate, end)
      if (w.monotony !== null) earlierMonotony.push(w.monotony)
      if (w.strain !== null) earlierStrain.push(w.strain)
    }
  }
  const outside = (value: number | null, earlier: number[]) => {
    if (value === null || earlier.length < P.b7.ownRangeMinWeeks.value) return false
    const { mean, sd } = meanSd(earlier)
    return value > mean + P.b7.ownRangeSd.value * sd
  }
  return {
    ...current,
    monotonyFlag: outside(current.monotony, earlierMonotony),
    strainFlag: outside(current.strain, earlierStrain),
  }
}

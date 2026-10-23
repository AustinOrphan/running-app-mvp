import type { ActivityCore, FastestEffort, PeriodTotal, StatsView } from '../types.ts'

const EFFORT_TARGETS: ReadonlyArray<{ label: string; targetM: number }> = [
  { label: '1 mi', targetM: 1609.344 },
  { label: '5K', targetM: 5000 },
  { label: '10K', targetM: 10000 },
  { label: 'Half', targetM: 21097.5 },
  { label: 'Marathon', targetM: 42195 },
  { label: '50K', targetM: 50000 },
]

// A run counts for a distance when it is within 99.5% to 102% of the target. The lower edge lets a
// run logged as 13.1 or 26.2 miles count for the half and the marathon.
const WINDOW_MIN_PER_MILLE = 995
const WINDOW_MAX_PER_MILLE = 1020

// `possible` and `confirmed` duplicates are excluded from every statistic.
function counts(activity: ActivityCore): boolean {
  return activity.duplicateStatus === 'none' || activity.duplicateStatus === 'dismissed'
}

function isFasterOrEarlier(a: ActivityCore, b: ActivityCore): boolean {
  // pace = duration / distance; cross-multiply to compare without division.
  const left = a.durationSec * (b.distanceM ?? 0)
  const right = b.durationSec * (a.distanceM ?? 0)
  if (left !== right) return left < right
  // The id settles a full tie, so the answer does not depend on the order the rows arrive in.
  return a.date !== b.date ? a.date < b.date : a.id < b.id
}

export function fastestEfforts(activities: ActivityCore[]): FastestEffort[] {
  const candidates = activities.filter(
    (a) =>
      counts(a) &&
      (a.type === 'run' || a.type === 'race') &&
      a.distanceM !== null &&
      a.distanceM > 0 &&
      a.durationSec > 0,
  )
  const efforts: FastestEffort[] = []
  for (const { label, targetM } of EFFORT_TARGETS) {
    let best: ActivityCore | null = null
    for (const a of candidates) {
      const d = a.distanceM ?? 0
      if (d * 1000 < targetM * WINDOW_MIN_PER_MILLE || d * 1000 > targetM * WINDOW_MAX_PER_MILLE) {
        continue
      }
      if (best === null || isFasterOrEarlier(a, best)) best = a
    }
    if (best === null || best.distanceM === null) continue
    efforts.push({
      label,
      targetM,
      activityId: best.id,
      date: best.date,
      distanceM: best.distanceM,
      durationSec: best.durationSec,
      paceSecPerKm: best.durationSec / (best.distanceM / 1000),
    })
  }
  return efforts
}

function totalsBy(activities: ActivityCore[], keyLength: number): Array<[string, PeriodTotal]> {
  const sums = new Map<string, { sec: number; runM: number; runs: number; longestSec: number }>()
  for (const a of activities) {
    if (a.type !== 'run' || !counts(a)) continue
    const key = a.date.slice(0, keyLength)
    const sum = sums.get(key) ?? { sec: 0, runM: 0, runs: 0, longestSec: 0 }
    sum.sec += a.durationSec
    sum.runM += a.distanceM ?? 0
    sum.runs += 1
    sum.longestSec = Math.max(sum.longestSec, a.durationSec)
    sums.set(key, sum)
  }
  return [...sums.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, s]) => [
      key,
      {
        runMin: Math.round(s.sec / 60),
        runM: s.runM,
        runs: s.runs,
        longestRunMin: Math.round(s.longestSec / 60),
      },
    ])
}

export function monthlyTotals(activities: ActivityCore[]): Array<PeriodTotal & { month: string }> {
  return totalsBy(activities, 7).map(([month, total]) => ({ month, ...total }))
}

export function yearlyTotals(activities: ActivityCore[]): Array<PeriodTotal & { year: string }> {
  return totalsBy(activities, 4).map(([year, total]) => ({ year, ...total }))
}

export function longestRuns<T extends ActivityCore>(activities: T[], limit = 10): T[] {
  return activities
    .filter((a) => a.type === 'run' && counts(a))
    .sort(
      (a, b) =>
        b.durationSec - a.durationSec ||
        (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, limit)
}

/**
 * Every statistic of a history, in one value: what `GET /api/stats` returns. The result does not
 * depend on the order of `activities`.
 */
export function statsOf(activities: ActivityCore[]): StatsView {
  return {
    monthly: monthlyTotals(activities),
    yearly: yearlyTotals(activities),
    efforts: fastestEfforts(activities),
    longest: longestRuns(activities),
  }
}

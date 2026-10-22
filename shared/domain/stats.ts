import type { Activity } from '../types.ts'

export interface FastestEffort {
  label: string
  targetM: number
  activityId: string
  date: string
  distanceM: number
  durationSec: number
  paceSecPerKm: number
}

export interface PeriodTotal {
  runMin: number
  runM: number
  runs: number
  longestRunMin: number
}

const EFFORT_TARGETS: ReadonlyArray<{ label: string; targetM: number }> = [
  { label: '1 mi', targetM: 1609.344 },
  { label: '5K', targetM: 5000 },
  { label: '10K', targetM: 10000 },
  { label: 'Half', targetM: 21097.5 },
  { label: 'Marathon', targetM: 42195 },
  { label: '50K', targetM: 50000 },
]

// A run counts for a distance when it is at least the target and at most 2% longer.
const WINDOW_PERCENT = 102

// `possible` and `confirmed` duplicates are excluded from every statistic.
function counts(activity: Activity): boolean {
  return activity.duplicateStatus === 'none' || activity.duplicateStatus === 'dismissed'
}

function isFasterOrEarlier(a: Activity, b: Activity): boolean {
  // pace = duration / distance; cross-multiply to compare without division.
  const left = a.durationSec * (b.distanceM ?? 0)
  const right = b.durationSec * (a.distanceM ?? 0)
  if (left !== right) return left < right
  return a.date < b.date
}

export function fastestEfforts(activities: Activity[]): FastestEffort[] {
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
    let best: Activity | null = null
    for (const a of candidates) {
      const d = a.distanceM ?? 0
      if (d < targetM || d * 100 > targetM * WINDOW_PERCENT) continue
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

function totalsBy(activities: Activity[], keyLength: number): Array<[string, PeriodTotal]> {
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

export function monthlyTotals(activities: Activity[]): Array<PeriodTotal & { month: string }> {
  return totalsBy(activities, 7).map(([month, total]) => ({ month, ...total }))
}

export function yearlyTotals(activities: Activity[]): Array<PeriodTotal & { year: string }> {
  return totalsBy(activities, 4).map(([year, total]) => ({ year, ...total }))
}

export function longestRuns(activities: Activity[], limit = 10): Activity[] {
  return activities
    .filter((a) => a.type === 'run' && counts(a))
    .sort(
      (a, b) => b.durationSec - a.durationSec || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0),
    )
    .slice(0, limit)
}

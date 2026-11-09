// What the race page's profile marks along the course, from the race plan and the coarse course
// (`courseSilhouettePoints`). The course points carry the climb of each leg, not the track, so the
// profile is net per leg and nothing here adds a finer shape. Every mark comes from data the plan
// already holds, and each is empty when its data is missing:
// - stops and cutoffs: the runner's rows in the arrival table (`plan.splits`);
// - the dark band: the arrival ranges (`plan.splits`) against the plan's own dawn and dusk
//   (`plan.dark`, the D1 clock) from the start time;
// - the fuel ticks: each hour of the middle of the expected time, only when the plan states a rate.
// A range is not turned into one time: the dark band has a firm part (dark at both ends of the
// range) and a possible part (dark at one end). Pure: no clock, no I/O.
import { startMinutes } from '../engine/goal.ts'
import type { RaceClock, RacePlan } from '../engine/racePlan.ts'
import type { CourseSilhouettePoint } from '../types.ts'

const SEC_PER_MIN = 60
const SEC_PER_HOUR = 3600
const MIN_PER_DAY = 1440

export interface ProfileStop {
  name: string
  distanceM: number
  /** The runner's cutoff as a time of day; null without one or without a start time. */
  cutoffClock: RaceClock | null
  /** The runner's cutoff in elapsed seconds; null without one. */
  cutoffSec: number | null
}

export interface DarkBand {
  fromM: number
  toM: number
  /** Dark at both ends of the arrival range; false when dark at one end only. */
  firm: boolean
}

export interface RaceProfile {
  totalM: number
  points: CourseSilhouettePoint[]
  stops: ProfileStop[]
  dark: DarkBand[]
  /** Metres from the start of each full hour of the middle of the expected time. */
  fuelTicks: number[]
}

/** A point of the course with the arrival range there, in elapsed seconds. */
export interface TimedPoint {
  distanceM: number
  lowSec: number
  highSec: number
}

const hhmm = (text: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text)
  return match === null ? null : Number(match[1]) * 60 + Number(match[2])
}

/** The distance reached at `sec` along a line through `[sec, distance]` pairs (non-decreasing). */
function distanceAt(pairs: ReadonlyArray<readonly [number, number]>, sec: number): number {
  const last = pairs[pairs.length - 1]!
  if (sec <= pairs[0]![0]) return pairs[0]![1]
  if (sec >= last[0]) return last[1]
  const hi = pairs.findIndex(([s]) => s >= sec)
  const [s0, d0] = pairs[hi - 1]!
  const [s1, d1] = pairs[hi]!
  return s1 === s0 ? d1 : d0 + ((d1 - d0) * (sec - s0)) / (s1 - s0)
}

/** The elapsed seconds, inside `[0, endSec]`, that fall outside daylight. */
function nightWindows(
  startMin: number,
  dawnMin: number,
  duskMin: number,
  endSec: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const toSec = (minute: number) => (minute - startMin) * SEC_PER_MIN
  for (let day = 0; day * MIN_PER_DAY < startMin + endSec / SEC_PER_MIN; day += 1) {
    const base = day * MIN_PER_DAY
    for (const [from, to] of [
      [base, base + dawnMin],
      [base + duskMin, base + MIN_PER_DAY],
    ] as const) {
      const lo = Math.max(0, toSec(from))
      const hi = Math.min(endSec, toSec(to))
      if (hi > lo) out.push([lo, hi])
    }
  }
  return out
}

/**
 * The stretches of the course that fall in the dark, from the arrival ranges. `stops` holds the
 * runner's points and the finish with their ranges (the start is added); `dawnMin` and `duskMin`
 * are minutes after midnight. Each end of the range is taken as a whole race (the fast end and the
 * slow end), and a stretch is firm where both are dark and possible where one is. Empty without a
 * night in the race.
 */
export function darkBands(options: {
  startMin: number
  dawnMin: number
  duskMin: number
  stops: readonly TimedPoint[]
}): DarkBand[] {
  const { startMin, dawnMin, duskMin, stops } = options
  const finish = stops[stops.length - 1]
  if (finish === undefined) return []
  const scenarios = (['lowSec', 'highSec'] as const).map((key) => {
    const pairs: Array<[number, number]> = [
      [0, 0],
      ...stops.map((s): [number, number] => [s[key], s.distanceM]),
    ]
    return nightWindows(startMin, dawnMin, duskMin, finish[key]).map(
      ([from, to]): [number, number] => [distanceAt(pairs, from), distanceAt(pairs, to)],
    )
  })
  const cuts = [
    ...new Set([0, finish.distanceM, ...scenarios.flat().flatMap(([from, to]) => [from, to])]),
  ].sort((a, b) => a - b)
  const bands: DarkBand[] = []
  for (let i = 1; i < cuts.length; i += 1) {
    const fromM = cuts[i - 1]!
    const toM = cuts[i]!
    const middle = (fromM + toM) / 2
    const inDark = scenarios.filter((windows) =>
      windows.some(([from, to]) => middle > from && middle < to),
    ).length
    if (inDark === 0) continue
    const firm = inDark === scenarios.length
    const previous = bands[bands.length - 1]
    if (previous !== undefined && previous.toM === fromM && previous.firm === firm) {
      previous.toM = toM
    } else bands.push({ fromM, toM, firm })
  }
  return bands
}

/**
 * Where each full hour of the middle of the expected time falls on the course. `middle` is the
 * arrival range's middle at each point with the finish at the expected middle.
 */
export function fuelTickPositions(
  middle: ReadonlyArray<{ distanceM: number; sec: number }>,
): number[] {
  const finish = middle[middle.length - 1]
  if (finish === undefined) return []
  const pairs: Array<[number, number]> = [
    [0, 0],
    ...middle.map((m): [number, number] => [m.sec, m.distanceM]),
  ]
  const ticks: number[] = []
  for (let hour = 1; hour * SEC_PER_HOUR < finish.sec; hour += 1) {
    ticks.push(distanceAt(pairs, hour * SEC_PER_HOUR))
  }
  return ticks
}

/**
 * The marks of the profile, or null when the plan or the course gives nothing to draw. The course
 * is the one `courseSilhouettePoints` made from the same rows as `plan.splits`.
 */
export function raceProfileFor(
  plan: RacePlan,
  course: readonly CourseSilhouettePoint[] | null | undefined,
): RaceProfile | null {
  if (course === null || course === undefined || course.length < 2) return null
  const totalM = course[course.length - 1]!.distanceM
  if (totalM <= 0) return null
  const rows = plan.splits?.rows ?? []
  const stops: ProfileStop[] = rows
    .filter((row) => !row.finish && row.name !== null)
    .map((row) => ({
      name: row.name ?? '',
      distanceM: row.distanceM,
      cutoffClock: row.cutoffClock,
      cutoffSec: row.cutoffSec,
    }))
  const timed: TimedPoint[] = rows.map((row) => ({
    distanceM: row.distanceM,
    lowSec: row.lowSec,
    highSec: row.highSec,
  }))
  const startMin = startMinutes(plan.expected.start)
  const dawnMin = plan.dark === null ? null : hhmm(plan.dark.dawn)
  const duskMin = plan.dark === null ? null : hhmm(plan.dark.dusk)
  const dark =
    startMin === null || dawnMin === null || duskMin === null || timed.length === 0
      ? []
      : darkBands({ startMin, dawnMin, duskMin, stops: timed })
  const fuelTicks =
    plan.fuel.gPerH > 0 && timed.length > 0
      ? fuelTickPositions(
          timed.map((t, i) => ({
            distanceM: t.distanceM,
            sec: i === timed.length - 1 ? plan.expected.midSec : (t.lowSec + t.highSec) / 2,
          })),
        )
      : []
  return { totalM, points: [...course], stops, dark, fuelTicks }
}

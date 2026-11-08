// A synthetic course of legs at a set speed and grade, written as a FIT file with one record per
// second, for the terrain-bin tests. No real recording is involved.
import { buildFit } from './buildFit.ts'
import type { FitRecordInput } from './buildFit.ts'

export const COURSE_START_UNIX = Date.UTC(2026, 0, 5, 7, 0, 0) / 1000

export interface Leg {
  seconds: number
  speed: number
  gradePct: number
}

/** Flat, 8% up, 20% up (walked), 8% down, a minute standing still, flat again: 2060 s. */
export const COURSE: Leg[] = [
  { seconds: 600, speed: 3, gradePct: 0 },
  { seconds: 300, speed: 2.4, gradePct: 8 },
  { seconds: 200, speed: 1, gradePct: 20 },
  { seconds: 300, speed: 3.6, gradePct: -8 },
  { seconds: 60, speed: 0, gradePct: 0 },
  { seconds: 600, speed: 3, gradePct: 0 },
]

/** One record per second along the legs; altitude follows the grade of the leg being run. */
function records(legs: Leg[], withAltitude: boolean): FitRecordInput[] {
  const out: FitRecordInput[] = []
  let t = 0
  let distance = 0
  let altitude = 100
  for (const leg of legs) {
    for (let s = 0; s < leg.seconds; s++) {
      out.push({
        t,
        distanceM: distance,
        speedMps: leg.speed,
        ...(withAltitude ? { altitudeM: altitude } : {}),
      })
      t += 1
      distance += leg.speed
      altitude += (leg.speed * leg.gradePct) / 100
    }
  }
  out.push({
    t,
    distanceM: distance,
    speedMps: 0,
    ...(withAltitude ? { altitudeM: altitude } : {}),
  })
  return out
}

/** The course as a FIT running file; `startUnix` and `serial` make each file's key distinct. */
export function courseFit(
  legs: Leg[] = COURSE,
  opts: { withAltitude?: boolean; startUnix?: number; serial?: number; sport?: number } = {},
): Uint8Array {
  const recs = records(legs, opts.withAltitude ?? true)
  const last = recs[recs.length - 1]!
  const startUnix = opts.startUnix ?? COURSE_START_UNIX
  return buildFit({
    serial: opts.serial ?? 7,
    timeCreatedUnix: startUnix,
    sessions: [
      {
        sport: opts.sport ?? 1,
        startUnix,
        durationSec: last.t,
        distanceM: last.distanceM,
        records: recs,
      },
    ],
  })
}

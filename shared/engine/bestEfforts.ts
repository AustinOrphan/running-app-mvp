// The fastest grade-adjusted stretches of one run, from its stored 10 s stream (rule A6, added
// 2026-11-08): the efforts the paper took out of raw training files [smyth-2020-cs-training-data].
// Pure. The server reads each run's stream once per snapshot and hands the result to the engine as
// `Activity.bestEfforts`; nothing is stored.
//
// What is fixed here is data preparation, not an engine decision: the grade of a step is taken over
// the same 30 s as the grade-adjusted distance of an import (`computeGapDistance`), a step that is
// longer than 30 s, slower than 0.5 m/s, faster than 12 m/s or between buckets with no altitude is a
// pause or a GPS jump and no stretch spans it (the bounds of the terrain bins; the 12 m/s bound only
// catches a jump of more than that, so a smaller one is not detected), and a distance is flat-equivalent through
// `gradeAdjustedSpeed` (I11). The distances are `a6.csEffortTargetsM`; the shortest time a stretch
// must last to count is `a6.csMinEffortSec`, applied where the efforts are chosen.
import type { ActivityStreamData, BestEfforts } from '../types.ts'
import { P } from './params/index.ts'
import { gradeAdjustedSpeed } from './terrain.ts'

export const BEST_EFFORTS_VERSION = 1
const GRADE_WINDOW_SEC = 30
const MAX_GRADE = 0.45
const MAX_STEP_SEC = 30
const MAX_SPEED_MPS = 12
/** Slower than this over a step is standing still (the terrain bins' bound): a pause, not running. */
const STOPPED_MPS = 0.5

/**
 * The fastest stretch at each target distance, in flat-equivalent metres. `flat` says the run needs
 * no grade correction (a treadmill or a track); a run with no altitude that is not flat gives no
 * efforts, since its distance cannot be corrected. A target the run does not reach is absent.
 */
export function computeBestEfforts(stream: ActivityStreamData, flat: boolean): BestEfforts {
  const out: BestEfforts = { v: BEST_EFFORTS_VERSION, efforts: [] }
  const { t, d, alt } = stream
  if (!d || t.length < 2 || (!alt && !flat)) return out

  // Flat-equivalent distance reached at each sample, and the samples a stretch may not cross.
  const cum: number[] = [0]
  const broken: boolean[] = [false] // broken[i]: the step into sample i is unusable
  const half = GRADE_WINDOW_SEC / 2
  let lo = 0
  let hi = 0
  for (let i = 0; i < t.length - 1; i++) {
    const ti = t[i]!
    while (t[lo]! < ti - half) lo++
    if (hi < i) hi = i
    while (hi + 1 < t.length && t[hi + 1]! <= ti + half) hi++
    const dd = d[i + 1]! - d[i]!
    const dt = t[i + 1]! - ti
    // An empty bucket (a pause) has a carried-forward distance and a missing altitude, which JSON
    // stores as null; it is a break whichever of the two shows it.
    const heightsKnown = !alt || (Number.isFinite(alt[i]) && Number.isFinite(alt[i + 1]))
    const usable =
      Number.isFinite(dd) &&
      dt > 0 &&
      dt <= MAX_STEP_SEC &&
      dd / dt >= STOPPED_MPS &&
      dd / dt <= MAX_SPEED_MPS &&
      heightsKnown
    broken.push(!usable)
    if (!usable) {
      cum.push(cum[i]!)
      continue
    }
    let grade = 0
    if (alt) {
      const run = d[hi]! - d[lo]!
      // A missing altitude (null, which would read as 0 m) at either end gives no grade.
      const rise = Number.isFinite(alt[hi]) && Number.isFinite(alt[lo]) ? alt[hi]! - alt[lo]! : NaN
      grade = run > 1 && Number.isFinite(rise) ? rise / run : 0
      grade = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, grade))
    }
    cum.push(cum[i]! + gradeAdjustedSpeed(dd, grade))
  }

  // The unbroken spans: [first, last] sample indexes with no unusable step between them.
  const spans: Array<[number, number]> = []
  let first = 0
  for (let i = 1; i < t.length; i++) {
    if (!broken[i]) continue
    if (i - 1 > first) spans.push([first, i - 1])
    first = i
  }
  if (t.length - 1 > first) spans.push([first, t.length - 1])

  for (const target of P.a6.csEffortTargetsM.value) {
    let best = Infinity
    for (const [from, to] of spans) {
      let j = from + 1
      for (let i = from; i < to; i++) {
        if (j <= i) j = i + 1
        while (j <= to && cum[j]! - cum[i]! < target) j++
        if (j > to) break // no later start in this span reaches the target either
        const reached = cum[j]! - cum[i]!
        const before = cum[j - 1]! - cum[i]!
        const share = reached > before ? (target - before) / (reached - before) : 1
        const elapsed = t[j - 1]! + share * (t[j]! - t[j - 1]!) - t[i]!
        if (elapsed > 0 && elapsed < best) best = elapsed
      }
    }
    if (best < Infinity)
      out.efforts.push({ distanceM: target, timeSec: Math.round(best * 10) / 10 })
  }
  return out
}

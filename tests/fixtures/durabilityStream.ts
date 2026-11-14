// Synthetic 10 s streams of long runs for the hour-by-hour read-out (rule T1, DR1).
import type { ActivityStreamData } from '../../shared/types.ts'

export const SAMPLE_SEC = 10

export interface Segment {
  minutes: number
  /** m/s; 0 is a stop. */
  speed: number
  /** Fractional grade. */
  grade: number
  /** Mean heart rate; the samples alternate one beat either side so no flat-line check fires. */
  hr: number | null
}

/** A 10 s stream of consecutive segments; the first sample is at t = 0. */
export function stream(segments: readonly Segment[]): ActivityStreamData {
  const t = [0]
  const d = [0]
  const alt = [100]
  const hr: number[] = []
  let k = 0
  for (const seg of segments) {
    const steps = Math.round((seg.minutes * 60) / SAMPLE_SEC)
    for (let i = 0; i < steps; i++) {
      hr.push(seg.hr === null ? 0 : seg.hr + (k % 2 === 0 ? -1 : 1))
      const dd = seg.speed * SAMPLE_SEC
      t.push(t[t.length - 1]! + SAMPLE_SEC)
      d.push(d[d.length - 1]! + dd)
      alt.push(alt[alt.length - 1]! + dd * seg.grade)
      k += 1
    }
  }
  hr.push(hr[hr.length - 1] ?? 0)
  return { t, d, hr, alt, cad: null, pwr: null }
}

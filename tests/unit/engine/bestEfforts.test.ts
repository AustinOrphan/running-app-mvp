import { describe, expect, it } from 'vitest'
import { computeBestEfforts } from '../../../shared/engine/bestEfforts.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { ActivityStreamData } from '../../../shared/types.ts'

const steady = (n: number, speed: number): number[] => new Array<number>(n).fill(speed)

/** A 10 s stream: `speeds[i]` m/s over sample i, flat unless `climb` gives a rise per metre. */
function stream(speeds: number[], climb = 0): ActivityStreamData {
  const t: number[] = []
  const d: number[] = []
  const alt: number[] = []
  let dist = 0
  speeds.forEach((v, i) => {
    t.push(i * 10)
    d.push(dist)
    alt.push(dist * climb)
    dist += v * 10
  })
  return { t, d, hr: null, alt, cad: null, pwr: null }
}

const at = (out: ReturnType<typeof computeBestEfforts>, m: number) =>
  out.efforts.find((e) => e.distanceM === m)?.timeSec

describe('computeBestEfforts [A6]', () => {
  it('finds the fastest stretch at each target a run reaches, in its targets only', () => {
    // 600 s at 3 m/s, 200 s at 5 m/s, 600 s at 3 m/s: 4600 m in all
    const speeds = [...steady(60, 3), ...steady(20, 5), ...steady(60, 3)]
    const out = computeBestEfforts(stream(speeds), true)
    expect(out.efforts.map((e) => e.distanceM)).toEqual(
      P.a6.csEffortTargetsM.value.filter((m) => m <= 4600),
    )
    // 1000 m at 5 m/s is 200 s; 800 m inside it is 160 s
    expect(at(out, 800)).toBeCloseTo(160, 0)
    expect(at(out, 1000)).toBeCloseTo(200, 0)
    // 1500 m: the 1000 m at 5 m/s, then 500 m at 3 m/s
    expect(at(out, 1500)).toBeCloseTo(200 + 500 / 3, 0)
  })

  it('leaves out a target the run does not reach', () => {
    const out = computeBestEfforts(stream(steady(20, 3)), true)
    expect(out.efforts.map((e) => e.distanceM)).toEqual([400])
  })

  it('credits a climb as flat distance, so the stretch is faster than its raw time', () => {
    const speeds = steady(120, 3)
    const flat = computeBestEfforts(stream(speeds), true)
    const hill = computeBestEfforts(stream(speeds, 0.05), false)
    expect(at(hill, 800)).toBeLessThan(at(flat, 800)!)
  })

  it('gives no efforts for a run with no altitude that is not flat', () => {
    const noAlt = { ...stream(steady(120, 3)), alt: null }
    expect(computeBestEfforts(noAlt, false).efforts).toEqual([])
    expect(computeBestEfforts(noAlt, true).efforts.length).toBeGreaterThan(0)
  })

  it('does not let a stretch span a GPS jump', () => {
    // A jump of 1000 m in one 10 s step (100 m/s) between two slow halves of 600 m each.
    const base = stream(steady(40, 3))
    const d = base.d!.map((v, i) => (i >= 20 ? v + 1000 : v))
    const out = computeBestEfforts({ ...base, d }, true)
    expect(at(out, 800)).toBeUndefined()
    expect(at(out, 400)).toBeCloseTo(133.3, 0)
  })

  describe('a pause stored the way an import stores it', () => {
    // 3 m/s for an hour at a constant altitude; a pause of 40 s is four empty buckets: distance
    // carried forward and a missing altitude, which JSON stores as null.
    function withPause(pause: boolean, base: number): ActivityStreamData {
      const t: number[] = []
      const d: number[] = []
      const alt: number[] = []
      let dist = 0
      for (let i = 0; i < 360; i++) {
        t.push(i * 10)
        const stopped = pause && i >= 100 && i < 104
        if (!stopped) dist += 30
        d.push(dist)
        alt.push(stopped ? Number.NaN : base)
      }
      return JSON.parse(
        JSON.stringify({ t, d, hr: null, alt, cad: null, pwr: null }),
      ) as ActivityStreamData
    }

    it('reads a missing altitude as no grade, not as 0 m', () => {
      for (const base of [0, 250]) {
        expect(computeBestEfforts(withPause(true, base), false).efforts).toEqual(
          computeBestEfforts(withPause(false, base), false).efforts,
        )
      }
    })

    it('does not let a stretch span the pause', () => {
      // 3000 m takes 1000 s; the pause sits at 1000 s, so the stretch has to start after it.
      const paused = computeBestEfforts(withPause(true, 250), false)
      expect(at(paused, 3000)).toBeCloseTo(1000, 0)
      // A run that is all pause but for two short spans reaches only the short targets.
      const t = Array.from({ length: 40 }, (_, i) => i * 10)
      const d = t.map((_, i) => (i < 20 ? i * 30 : 570 + (i >= 22 ? (i - 22) * 30 : 0)))
      const out = computeBestEfforts({ t, d, hr: null, alt: null, cad: null, pwr: null }, true)
      expect(at(out, 800)).toBeUndefined()
    })
  })
})

// Hand-computed tests of the prediction skill figures (evaluation harness, proposal section 5.4,
// task H4). Every case is synthetic and worked by hand in the comments; times are in seconds.
import { describe, expect, it } from 'vitest'
import {
  baselineSkill,
  intervalScore,
  NAIVE_RIEGEL_EXPONENT,
  riegelNaiveSec,
  type SkillRecord,
} from './prediction-skill.ts'

const rec = (
  predictedSec: number,
  lowSec: number,
  highSec: number,
  actualSec: number,
  naiveSec: number,
): SkillRecord => ({ predictedSec, lowSec, highSec, actualSec, naiveSec })

/** A record that only the baseline reads: the band is a placeholder around the prediction. */
const forBaseline = (predictedSec: number, actualSec: number, naiveSec: number): SkillRecord =>
  rec(predictedSec, predictedSec - 60, predictedSec + 60, actualSec, naiveSec)

/** A record that only the interval score reads: the prediction and the baseline are placeholders. */
const forBand = (lowSec: number, highSec: number, actualSec: number): SkillRecord =>
  rec((lowSec + highSec) / 2, lowSec, highSec, actualSec, actualSec + 1)

// ---------------------------------------------------------------------------------------------
// The naive prediction
// ---------------------------------------------------------------------------------------------

describe('riegelNaiveSec', () => {
  it('uses the Riegel exponent 1.06', () => {
    expect(NAIVE_RIEGEL_EXPONENT).toBe(1.06)
  })

  it('scales the prior time by the distance ratio to the exponent', () => {
    // 1000 m in 1000 s, target 2000 m: 1000 x 2 ^ 1.06; 2 ^ 0.06 = 1.04247, so 2 ^ 1.06 = 2.08493.
    expect(riegelNaiveSec({ distanceM: 1000, timeSec: 1000 }, 2000)).toBeCloseTo(2084.93, 2)
  })

  it('gives the prior time back for the same distance, and a straight ratio at exponent 1', () => {
    expect(riegelNaiveSec({ distanceM: 10_000, timeSec: 3000 }, 10_000)).toBe(3000)
    // exponent 1: 3000 s x (20 000 / 10 000) = 6000 s
    expect(riegelNaiveSec({ distanceM: 10_000, timeSec: 3000 }, 20_000, 1)).toBe(6000)
  })

  it('predicts a marathon of 3:50:01 from a 10 km in 50:00, the optimistic shape of Vickers 2016', () => {
    // 3000 s x (42 195 / 10 000) ^ 1.06 = 3000 x 4.2195 ^ 1.06 = 3000 x 4.60020 = 13 800.6 s
    expect(riegelNaiveSec({ distanceM: 10_000, timeSec: 3000 }, 42_195)).toBeCloseTo(13_800.6, 1)
  })

  it('refuses an anchor or a target that is not a positive number', () => {
    expect(() => riegelNaiveSec({ distanceM: 0, timeSec: 3000 }, 42_195)).toThrow(RangeError)
    expect(() => riegelNaiveSec({ distanceM: 10_000, timeSec: -1 }, 42_195)).toThrow(RangeError)
    expect(() => riegelNaiveSec({ distanceM: 10_000, timeSec: 3000 }, Number.NaN)).toThrow(
      RangeError,
    )
  })
})

// ---------------------------------------------------------------------------------------------
// Skill against the naive baseline
// ---------------------------------------------------------------------------------------------

describe('baselineSkill', () => {
  it('is the app MAE over the naive MAE', () => {
    // A: app 3600 against a result of 3700 is off by 100; naive 3500 is off by 200.
    // B: app 7200 against 7000 is off by 200; naive 6800 is off by 200.
    // MAE app = (100 + 200) / 2 = 150; MAE naive = (200 + 200) / 2 = 200; ratio 150 / 200 = 0.75.
    const records = [forBaseline(3600, 3700, 3500), forBaseline(7200, 7000, 6800)]
    expect(baselineSkill(records)).toBeCloseTo(0.75, 12)
  })

  it('is 1 when the app predicts what the naive baseline does', () => {
    // identical predictions have identical errors: (80 + 30) / (80 + 30) = 1
    const records = [forBaseline(3500, 3580, 3500), forBaseline(7000, 6970, 7000)]
    expect(baselineSkill(records)).toBe(1)
  })

  it('is above 1 when the app is further from the result than the naive baseline', () => {
    // app 3400 against 3700 is off by 300; naive 3600 is off by 100; ratio 300 / 100 = 3
    expect(baselineSkill([forBaseline(3400, 3700, 3600)])).toBeCloseTo(3, 12)
  })

  it('divides the means, not the per-record ratios', () => {
    // A: app off by 100, naive off by 100 (ratio 1). B: app off by 100, naive off by 700.
    // MAE app = 100; MAE naive = (100 + 700) / 2 = 400; ratio 0.25 (the mean of the ratios is 0.571).
    const records = [forBaseline(3600, 3700, 3600), forBaseline(7000, 7100, 6400)]
    expect(baselineSkill(records)).toBeCloseTo(0.25, 12)
  })

  it('counts a prediction too fast and one too slow alike', () => {
    // result 3600, naive 3800 (off by 200); app 3500 (fast by 100) or 3700 (slow by 100): 100 / 200
    expect(baselineSkill([forBaseline(3500, 3600, 3800)])).toBeCloseTo(0.5, 12)
    expect(baselineSkill([forBaseline(3700, 3600, 3800)])).toBeCloseTo(0.5, 12)
  })

  it('reads a marathon predicted from a 10 km, the single-anchor shape of rule L2', () => {
    // 10 km in 50:00. Riegel gives 13 800.6 s; the app adds the 3% placeholder: 14 214.6 s.
    // The marathon takes 14 700 s: app off by 485.4 s, naive off by 899.4 s; ratio 0.5397.
    const naive = riegelNaiveSec({ distanceM: 10_000, timeSec: 3000 }, 42_195)
    const record = forBaseline(naive * 1.03, 14_700, naive)
    expect(baselineSkill([record])).toBeCloseTo(485.4 / 899.4, 3)
  })

  it('is null for no records and for a naive baseline that is exactly right', () => {
    expect(baselineSkill([])).toBeNull()
    // MAE naive = 0: nothing to beat, and the ratio is undefined
    expect(baselineSkill([forBaseline(3600, 3700, 3700)])).toBeNull()
  })

  it('refuses a record it cannot score', () => {
    expect(() => baselineSkill([forBaseline(Number.NaN, 3700, 3600)])).toThrow(/predictedSec/)
    expect(() => baselineSkill([forBaseline(3600, 0, 3600)])).toThrow(/actualSec/)
    expect(() => baselineSkill([rec(3600, 3700, 3500, 3600, 3600)])).toThrow(/lowSec/)
  })
})

// ---------------------------------------------------------------------------------------------
// The interval score
// ---------------------------------------------------------------------------------------------

describe('intervalScore', () => {
  // alpha 0.2 is a central 80% band, and the penalty is 2 / 0.2 = 10 s per second outside it.
  const ALPHA = 0.2

  it('is the width of the band when the result is inside', () => {
    // [3300, 3900] holds 3600: width 600, no penalty
    expect(intervalScore([forBand(3300, 3900, 3600)], ALPHA)).toBeCloseTo(600, 9)
  })

  it('counts a result on an edge as inside', () => {
    expect(intervalScore([forBand(3300, 3900, 3300)], ALPHA)).toBeCloseTo(600, 9)
    expect(intervalScore([forBand(3300, 3900, 3900)], ALPHA)).toBeCloseTo(600, 9)
  })

  it('adds 2 / alpha times the distance outside, below or above', () => {
    // below: 3200 is 100 s under 3300: 600 + 10 x 100 = 1600
    expect(intervalScore([forBand(3300, 3900, 3200)], ALPHA)).toBeCloseTo(1600, 9)
    // above: 4000 is 100 s over 3900: 600 + 10 x 100 = 1600
    expect(intervalScore([forBand(3300, 3900, 4000)], ALPHA)).toBeCloseTo(1600, 9)
  })

  it('averages over the records', () => {
    // inside 600, below 1600, above 1600: (600 + 1600 + 1600) / 3 = 1266.67
    const records = [
      forBand(3300, 3900, 3600),
      forBand(3300, 3900, 3200),
      forBand(3300, 3900, 4000),
    ]
    expect(intervalScore(records, ALPHA)).toBeCloseTo(3800 / 3, 9)
  })

  it('weighs the distance outside by alpha: a narrower nominal band costs more per second', () => {
    // 3200 is 100 s below [3300, 3900]. alpha 0.5: 2 / 0.5 = 4, so 600 + 400 = 1000.
    // alpha 0.1: 2 / 0.1 = 20, so 600 + 2000 = 2600.
    const records = [forBand(3300, 3900, 3200)]
    expect(intervalScore(records, 0.5)).toBeCloseTo(1000, 9)
    expect(intervalScore(records, 0.1)).toBeCloseTo(2600, 9)
  })

  it('scores a wide band worse than a narrow one that holds the same results', () => {
    // Five results, all inside both bands, so both have 100% coverage.
    // Narrow [3420, 3780] (3600 +/- 5%): width 360. Wide [1800, 5400] (3600 +/- 50%): width 3600.
    const results = [3550, 3580, 3600, 3620, 3650]
    const narrow = results.map((x) => forBand(3420, 3780, x))
    const wide = results.map((x) => forBand(1800, 5400, x))
    expect(intervalScore(narrow, ALPHA)).toBeCloseTo(360, 9)
    expect(intervalScore(wide, ALPHA)).toBeCloseTo(3600, 9)
  })

  it('lets a wide band win when the narrow band misses by a lot', () => {
    // The result is 5000. Narrow [3420, 3780]: 5000 is 1220 over: 360 + 10 x 1220 = 12 560.
    // Wide [1800, 5400] holds it: 3600. The score pays for width and for misses, not coverage.
    expect(intervalScore([forBand(3420, 3780, 5000)], ALPHA)).toBeCloseTo(12_560, 9)
    expect(intervalScore([forBand(1800, 5400, 5000)], ALPHA)).toBeCloseTo(3600, 9)
    // A smaller miss does not: 4000 is 220 over the narrow band: 360 + 2200 = 2560, under 3600.
    expect(intervalScore([forBand(3420, 3780, 4000)], ALPHA)).toBeCloseTo(2560, 9)
  })

  it('reads the band and the result only', () => {
    const a = rec(3600, 3300, 3900, 3200, 3500)
    const b = rec(3350, 3300, 3900, 3200, 4100)
    expect(intervalScore([a], ALPHA)).toBe(intervalScore([b], ALPHA))
  })

  it('is null for no records', () => {
    expect(intervalScore([], ALPHA)).toBeNull()
  })

  it('refuses an alpha outside 0 to 1, exclusive, and a record it cannot score', () => {
    const records = [forBand(3300, 3900, 3600)]
    for (const alpha of [0, 1, -0.1, 1.5, Number.NaN]) {
      expect(() => intervalScore(records, alpha)).toThrow(RangeError)
    }
    expect(() => intervalScore([rec(3600, 3900, 3300, 3600, 3600)], ALPHA)).toThrow(/lowSec/)
  })
})

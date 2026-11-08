import { describe, expect, test } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import {
  backtestGradeCurve,
  gainEquivalent,
  gradeCurve,
  personalGainEquivalent,
  type GradeCurveRun,
} from '../../../shared/engine/gradeCurve.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { athlete, MINETTI_RATIOS, scaledCurve, syntheticRuns } from './gradeCurve-fixtures.ts'

const TODAY = '2026-11-07'
const FLAT = 4

describe('gradeCurve eligibility', () => {
  const base = syntheticRuns(athlete(scaledCurve(0.5)), 12, TODAY, 1)

  test('a run with no bins, a mismatched shape, a high flat variation or little flat time is left out', () => {
    const odd: GradeCurveRun[] = [
      { ...base[0]!, id: 'none', bins: null },
      { ...base[1]!, id: 'version', bins: { ...base[1]!.bins!, v: 99 } },
      {
        ...base[2]!,
        id: 'edges',
        bins: { ...base[2]!.bins!, edgesPct: [-12, -8, -4, -2, 2, 4, 8, 12] },
      },
      { ...base[3]!, id: 'walk', bins: { ...base[3]!.bins!, walkMps: 9 } },
      {
        ...base[4]!,
        id: 'cv',
        bins: { ...base[4]!.bins!, flatCv: P.i13.maxFlatSpeedCv.value + 0.01 },
      },
      { ...base[5]!, id: 'nocv', bins: { ...base[5]!.bins!, flatCv: null } },
      {
        ...base[6]!,
        id: 'short',
        bins: { ...base[6]!.bins!, sec: base[6]!.bins!.sec.map((s, i) => (i === FLAT ? 60 : s)) },
      },
      { ...base[7]!, id: 'future', date: '2026-11-08' },
      { ...base[8]!, id: 'old', date: '2025-01-01' },
    ]
    expect(gradeCurve(odd, TODAY).eligibleRuns).toBe(0)
    expect(gradeCurve([...odd, base[9]!], TODAY).eligibleRuns).toBe(1)
  })

  test('the window ends where i13.windowWeeks says', () => {
    const last = addDays(TODAY, -(P.i13.windowWeeks.value * 7 - 1))
    const run = base[0]!
    expect(gradeCurve([{ ...run, date: last }], TODAY).eligibleRuns).toBe(1)
    expect(gradeCurve([{ ...run, date: addDays(last, -1) }], TODAY).eligibleRuns).toBe(0)
  })
})

describe('gradeCurve with no data', () => {
  test('every band shows Minetti, with the reason', () => {
    const curve = gradeCurve([], TODAY)
    expect(curve.eligibleRuns).toBe(0)
    expect(curve.overall).toBeNull()
    expect(curve.walkingFromPct).toBeNull()
    curve.bands.forEach((band, i) => {
      expect(band.source).toBe('default')
      expect(band.ratio).toBeCloseTo(i === FLAT ? 1 : MINETTI_RATIOS[i]!, 10)
      expect(band.reason).toBe(i === FLAT ? 'flat' : 'few-minutes')
      expect(band.personalRatio).toBeNull()
    })
    expect(personalGainEquivalent(curve)).toBeNull()
  })

  test('the default ratios fall on climbs and rise on descents', () => {
    const { bands } = gradeCurve([], TODAY)
    expect(bands[0]!.fromPct).toBeNull()
    expect(bands[8]!.toPct).toBeNull()
    expect(bands[FLAT]!.fromPct).toBe(-3)
    expect(bands[FLAT]!.toPct).toBe(3)
    for (let i = FLAT + 1; i < 9; i++)
      expect(bands[i]!.defaultRatio).toBeLessThan(bands[i - 1]!.defaultRatio)
    expect(bands[3]!.defaultRatio).toBeGreaterThan(1)
    expect(bands[5]!.defaultRatio).toBeLessThan(1)
  })
})

describe('gradeCurve backtest', () => {
  test('a runner who follows Minetti gets no personal band', () => {
    const runs = syntheticRuns(athlete(MINETTI_RATIOS), 40, TODAY, 2, 2)
    const curve = gradeCurve(runs, TODAY)
    expect(curve.eligibleRuns).toBeGreaterThan(30)
    expect(curve.bands.filter((band) => band.source === 'personal')).toEqual([])
    // the shrunk ratio sits near Minetti and the errors are the noise, so the gain stays small
    expect(curve.overall!.gainPct).toBeLessThan(P.i13.minGainOverDefaultPct.value)
    expect(personalGainEquivalent(curve)).toBeNull()
  })

  test('a runner with a smaller grade effect than Minetti gets personal bands where the data is', () => {
    const runs = syntheticRuns(athlete(scaledCurve(0.5)), 40, TODAY, 3, 2)
    const curve = gradeCurve(runs, TODAY)
    const personal = curve.bands.filter((band) => band.source === 'personal')
    expect(personal.length).toBeGreaterThanOrEqual(3)
    for (const band of personal) {
      expect(band.reason).toBe('personal')
      expect(band.test!.runs).toBeGreaterThanOrEqual(P.i13.minBacktestRuns.value)
      expect(band.test!.gainPct).toBeGreaterThanOrEqual(P.i13.minGainOverDefaultPct.value)
      const truth = scaledCurve(0.5)[band.index]!
      expect(Math.abs(band.ratio - truth)).toBeLessThan(Math.abs(band.defaultRatio - truth))
      expect(band.ratio).toBe(band.personalRatio)
    }
    expect(curve.overall!.maePersonalPct).toBeLessThan(curve.overall!.maeDefaultPct)
    expect(personalGainEquivalent(curve)).not.toBeNull()
  })

  test('the backtest alone reports per-band errors and the held-out runs', () => {
    const runs = syntheticRuns(athlete(scaledCurve(0.5)), 30, TODAY, 4, 2)
    const test = backtestGradeCurve(runs, TODAY)
    expect(test.runs).toBeGreaterThan(0)
    expect(test.bands).toHaveLength(9)
    expect(test.bands[FLAT]).toBeNull()
    expect(test.overall!.runs).toBe(test.bands.reduce((sum, band) => sum + (band?.runs ?? 0), 0))
  })

  test('too few tested runs keep the default even when the personal ratio looks better', () => {
    const runs = syntheticRuns(athlete(scaledCurve(0.5)), 4, TODAY, 5, 2)
    const curve = gradeCurve(runs, TODAY)
    expect(curve.bands.filter((band) => band.source === 'personal')).toEqual([])
    const reasons = new Set(curve.bands.map((band) => band.reason))
    expect(
      [...reasons].every((reason) =>
        ['flat', 'few-minutes', 'few-runs', 'untested'].includes(reason),
      ),
    ).toBe(true)
  })

  test('a leave-one-out does not use the held-out run', () => {
    const runs = syntheticRuns(athlete(scaledCurve(0.5)), 12, TODAY, 6, 2)
    const spiked: GradeCurveRun = {
      ...runs[0]!,
      bins: { ...runs[0]!.bins!, m: runs[0]!.bins!.m.map((m, i) => (i === 5 ? m * 3 : m)) },
    }
    const clean = backtestGradeCurve(runs, TODAY).bands[5]
    const dirty = backtestGradeCurve([spiked, ...runs.slice(1)], TODAY).bands[5]
    // the spiked run is far from the pooled ratio of the others, so its own error is large
    expect(dirty!.maePersonalPct).toBeGreaterThan(clean!.maePersonalPct)
  })

  test('the result does not depend on the order of the runs', () => {
    const runs = syntheticRuns(athlete(scaledCurve(0.5)), 20, TODAY, 7, 2)
    const a = gradeCurve([...runs].reverse(), TODAY)
    const b = gradeCurve(runs, TODAY)
    // sums differ in the last digit with the order, so compare to 9 places
    expect(a.bands.map((band) => band.source)).toEqual(b.bands.map((band) => band.source))
    expect(a.walkingFromPct).toBe(b.walkingFromPct)
    a.bands.forEach((band, i) => {
      expect(band.ratio).toBeCloseTo(b.bands[i]!.ratio, 9)
      expect(band.minutes).toBeCloseTo(b.bands[i]!.minutes, 9)
    })
    expect(a.overall!.gainPct).toBeCloseTo(b.overall!.gainPct, 9)
  })
})

describe('walking', () => {
  test('walkingFromPct is the lowest climbing band that speaks and is walked more than half the time', () => {
    const runs = syntheticRuns(athlete(scaledCurve(0.5)), 40, TODAY, 8, 2)
    const curve = gradeCurve(runs, TODAY)
    expect(curve.walkingFromPct).toBe(10)
    expect(curve.bands[7]!.walkShare).toBeCloseTo(0.55, 1)
    expect(curve.bands[FLAT]!.walkShare).toBeLessThan(0.1)
  })

  test('a band that does not speak has no walk share', () => {
    const curve = gradeCurve([], TODAY)
    expect(curve.bands.every((band) => band.walkShare === null)).toBe(true)
  })
})

describe('gainEquivalent', () => {
  test('Minetti at 10% costs about the 10 flat metres per metre of gain of l5', () => {
    // the 6 to 10% band, read at 8%
    const climb = gainEquivalent(8, MINETTI_RATIOS[6]!)
    expect(climb).toBeGreaterThan(P.l5.gainEquivalentM.value * 0.5)
    expect(climb).toBeLessThan(P.l5.gainEquivalentM.value * 2)
  })

  test('a runner no slower on a climb than on the flat has no extra', () => {
    expect(gainEquivalent(5, 1)).toBe(0)
  })
})

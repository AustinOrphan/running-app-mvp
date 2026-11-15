// The own easy ceiling (rules C4, C8; owner decision D4, 2026-11-14): the offer from the heart-rate line
// of cool runs that pass B2, in both directions, with the stricter bar for a higher one (G6).
import { describe, expect, test } from 'vitest'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { addDays } from '../../../shared/dates.ts'
import { coolRunPoints } from '../../../shared/engine/execution.ts'
import { ownCeilingProposal } from '../../../shared/engine/ownCeiling.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Activity, HrQuality } from '../../../shared/types.ts'
import { zoneSetFixture } from './fixtures.ts'
import { run } from './myPacesFixtures.ts'

const TODAY = '2026-06-30'

const PASSING: HrQuality = {
  v: 1,
  th: 'test',
  source: 'strap',
  movingSec: 2400,
  cleanSec: 2400,
  lockSec: 0,
  spikeSec: 0,
  dropSec: 0,
  flatSec: 0,
  mismatchSec: 0,
  halves: null,
  gapDecouplingPct: null,
}

/** A wrist run whose seconds are mostly flagged: it fails the heart-rate checks. */
const FAILING: HrQuality = { ...PASSING, source: 'wrist', cleanSec: 600, spikeSec: 1800 }

const COOL = { tempC: 8, humidityPct: 55, windKph: 5 }
const HOT = { tempC: 30, humidityPct: 65, windKph: 3 }

/** Zones with an easy ceiling of 140 bpm at 3.0 m/s (5:33 /km), a threshold heart rate of 160. */
const ZONES = zoneSetFixture({
  hrMax: { value: 185, band: [180, 190], source: 'hrmax-observed', asOf: TODAY },
  lt1Hr: { value: 140, band: [135, 145], source: 'hrmax-observed', asOf: TODAY },
  lt2Hr: { value: 160, band: [155, 165], source: 'hrmax-observed', asOf: TODAY },
  lt1PaceSecPerKm: { value: 1000 / 3, band: [320, 347], source: 'cs', asOf: TODAY },
  hr: { z1: [110, 140], z2: [140, 160], z3: [160, 185] },
})

/**
 * `count` cool steady flat runs, one every two days ending the day before today, speeds 2.4 to 3.3
 * m/s on the line HR = `intercept` + 20 x speed. `over` changes the run of that index.
 */
function runs(
  count: number,
  intercept: number,
  over: (i: number) => { extra?: Partial<Activity>; hrDelta?: number } = () => ({}),
): Activity[] {
  return Array.from({ length: count }, (_, i) => {
    const speed = 2.4 + (0.9 * i) / Math.max(count - 1, 1)
    const { extra = {}, hrDelta = 0 } = over(i)
    return run(
      i,
      speed,
      { date: addDays(TODAY, -2 * (count - i)), ...COOL, hrQuality: PASSING, ...extra },
      Math.round(intercept + 20 * speed + hrDelta),
    )
  })
}

describe('the own easy ceiling offer', () => {
  test('offers a higher ceiling from cool runs with the evidence, a step at a time', () => {
    const offer = ownCeilingProposal(runs(14, 90), TODAY, ZONES)
    expect(offer).not.toBeNull()
    // The line gives 150 bpm at 3.0 m/s, ten over 140; one offer moves five.
    expect(offer).toMatchObject({ boundary: 'lt1Hr', from: 140, to: 145, observations: 3 })
    expect(offer!.rules).toEqual(['C8', 'C4', 'A8'])
    expect(offer!.evidence).toMatchObject({ direction: 'higher', maxWbgtC: 15 })
    expect(offer!.evidence!.runs).toHaveLength(14)
    expect(offer!.evidence!.estimates).toHaveLength(3)
    for (const estimate of offer!.evidence!.estimates) expect(estimate).toBeCloseTo(150, 0)
    expect(offer!.evidence!.lt1SpeedMps).toBeCloseTo(3, 5)
    expect(offer!.reason).toContain('higher limit')
    assertCleanCopy(offer!.reason)
  })

  test('offers a lower ceiling in one step on fewer runs than a higher one needs', () => {
    // The line gives 120 bpm at 3.0 m/s, 20 under the ceiling; ten runs are enough to lower.
    const offer = ownCeilingProposal(runs(10, 60), TODAY, ZONES)
    expect(offer).toMatchObject({ boundary: 'lt1Hr', from: 140, to: 120 })
    expect(offer!.evidence!.direction).toBe('lower')
    expect(offer!.reason).toContain('down to 120 bpm')
    assertCleanCopy(offer!.reason)
  })

  test('the same number of runs that lowers cannot raise (asymmetric bar, G6)', () => {
    expect(P.c8.ownLt1MinRunsRaise.value).toBeGreaterThan(P.c8.ownLt1MinRunsLower.value)
    expect(ownCeilingProposal(runs(10, 90), TODAY, ZONES)).toBeNull()
    expect(ownCeilingProposal(runs(13, 90), TODAY, ZONES)).toBeNull()
    expect(ownCeilingProposal(runs(14, 90), TODAY, ZONES)).not.toBeNull()
  })

  test('a higher ceiling needs a larger difference than a lower one', () => {
    // The line gives 144 at 3.0 m/s: 4 over the ceiling, under the 5 a rise needs.
    expect(ownCeilingProposal(runs(14, 84), TODAY, ZONES)).toBeNull()
    // It gives 136: 4 under, which is enough to lower.
    expect(ownCeilingProposal(runs(14, 76), TODAY, ZONES)).toMatchObject({ to: 136 })
  })

  test('is quiet when the line agrees with the ceiling', () => {
    expect(ownCeilingProposal(runs(14, 80), TODAY, ZONES)).toBeNull()
  })

  test('hot runs are not read: they cannot lift the line', () => {
    const cool = runs(14, 60)
    const offerCool = ownCeilingProposal(cool, TODAY, ZONES)
    // Six more runs in the heat, 25 bpm above the line (heat drift), do not move the offer.
    const hot = runs(6, 85, () => ({ extra: { ...HOT } })).map((a, i) => ({
      ...a,
      id: `hot${String(i)}`,
      date: addDays(TODAY, -1 - 2 * i),
    }))
    expect(ownCeilingProposal([...cool, ...hot], TODAY, ZONES)).toEqual(offerCool)
    // Only hot runs, or runs with no weather: nothing is offered.
    expect(
      ownCeilingProposal(
        runs(14, 90, () => ({ extra: { ...HOT } })),
        TODAY,
        ZONES,
      ),
    ).toBeNull()
    expect(
      ownCeilingProposal(
        runs(14, 90, () => ({ extra: { tempC: null, humidityPct: null } })),
        TODAY,
        ZONES,
      ),
    ).toBeNull()
  })

  test('runs that fail the heart-rate checks (HQ1) are not read', () => {
    const all = runs(16, 90, (i) => (i < 4 ? { extra: { hrQuality: FAILING } } : {}))
    expect(coolRunPoints(all, TODAY, 15)).toHaveLength(12)
    // Twelve remain: under the 14 a higher ceiling needs.
    expect(ownCeilingProposal(all, TODAY, ZONES)).toBeNull()
    expect(
      ownCeilingProposal(
        runs(14, 90, () => ({ extra: { hrQuality: null } })),
        TODAY,
        ZONES,
      ),
    ).toBeNull()
    expect(
      ownCeilingProposal(
        runs(14, 90, () => ({ extra: { hrQuality: FAILING } })),
        TODAY,
        ZONES,
      ),
    ).toBeNull()
    expect(ownCeilingProposal(runs(16, 90), TODAY, ZONES)).not.toBeNull()
  })

  test('runs on or before the last accepted change do not count (fresh data, C8)', () => {
    const all = runs(14, 90)
    expect(ownCeilingProposal(all, TODAY, ZONES, null)).not.toBeNull()
    // The change was accepted on the day of the sixth run: eight runs remain, too few to raise.
    expect(ownCeilingProposal(all, TODAY, ZONES, all[5]!.date)).toBeNull()
    expect(ownCeilingProposal(all, TODAY, ZONES, TODAY)).toBeNull()
  })

  test('the offer names what accepting moves, and the reading that the value comes from', () => {
    const lower = ownCeilingProposal(runs(10, 60), TODAY, ZONES)!
    expect(lower.reason).toContain('the middle of the three readings')
    const higher = ownCeilingProposal(runs(14, 90), TODAY, ZONES)!
    expect(higher.reason).toContain('the lowest of the three readings')
    for (const offer of [lower, higher]) {
      expect(offer.reason).toContain('heart-rate alerts on the watch')
      expect(offer.reason).toContain('ultra race day')
      expect(offer.reason).toContain('easy pace on My paces')
    }
  })

  test('too few runs give nothing', () => {
    expect(ownCeilingProposal(runs(5, 60), TODAY, ZONES)).toBeNull()
    expect(ownCeilingProposal([], TODAY, ZONES)).toBeNull()
  })

  test('three estimates that disagree give nothing', () => {
    // The last runs swing the line: the estimates differ by more than the spread allows.
    const swing = runs(12, 60, (i) => ({ hrDelta: i === 10 ? 25 : i === 11 ? 50 : 0 }))
    expect(ownCeilingProposal(swing, TODAY, ZONES)).toBeNull()
  })

  test('an estimate outside the fitted speeds, or on a flat line, is not read', () => {
    // The ceiling pace lies far outside the speeds of the runs (2.4 to 3.3 m/s).
    const slow = zoneSetFixture({
      ...ZONES,
      lt1PaceSecPerKm: { ...ZONES.lt1PaceSecPerKm!, value: 500 },
    })
    expect(ownCeilingProposal(runs(14, 60), TODAY, slow)).toBeNull()
    // Heart rate that does not rise with speed (slope under c9.lineMinSlopeBpmPerMps).
    const flat = Array.from({ length: 14 }, (_, i) =>
      run(
        i,
        2.4 + (0.9 * i) / 13,
        { date: addDays(TODAY, -2 * (14 - i)), ...COOL, hrQuality: PASSING },
        120,
      ),
    )
    expect(ownCeilingProposal(flat, TODAY, ZONES)).toBeNull()
  })

  test('a higher ceiling stays under the share of the maximum and under the threshold', () => {
    const lowMax = zoneSetFixture({
      ...ZONES,
      hrMax: { value: 170, band: [165, 175], source: 'hrmax-observed', asOf: TODAY },
    })
    // 82% of 170 is 139, under the 140 already in force: nothing to raise to.
    expect(ownCeilingProposal(runs(14, 90), TODAY, lowMax)).toBeNull()
    const nearThreshold = zoneSetFixture({
      ...ZONES,
      lt2Hr: { value: 143, band: [138, 148], source: 'hrmax-observed', asOf: TODAY },
    })
    expect(ownCeilingProposal(runs(14, 90), TODAY, nearThreshold)?.to).toBe(142)
  })

  test('needs a zone set with a heart-rate ceiling and a first-threshold pace', () => {
    expect(
      ownCeilingProposal(runs(14, 60), TODAY, zoneSetFixture({ ...ZONES, lt1Hr: null })),
    ).toBeNull()
    expect(
      ownCeilingProposal(runs(14, 60), TODAY, zoneSetFixture({ ...ZONES, lt1PaceSecPerKm: null })),
    ).toBeNull()
  })
})

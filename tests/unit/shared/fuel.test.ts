import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  carbRateGPerH,
  fuelTotals,
  minutesOf,
  multiCarbShare,
  normalisedFuelSettings,
  ratePerHour,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../../../shared/domain/fuel.ts'
import type { FuelItem } from '../../../shared/engine/types.ts'
import type { FuelSettings } from '../../../shared/types.ts'

function item(overrides: Partial<FuelItem> = {}): FuelItem {
  return {
    name: 'Gel',
    carbsG: 25,
    sodiumMg: null,
    kcal: null,
    multiCarb: false,
    servings: 1,
    ...overrides,
  }
}

describe('fuelTotals', () => {
  it('multiplies each product by the servings taken', () => {
    const totals = fuelTotals([
      item({ carbsG: 25, servings: 4, sodiumMg: 50, kcal: 100 }),
      item({
        name: 'Drink mix',
        carbsG: 40,
        servings: 2,
        multiCarb: true,
        sodiumMg: 300,
        kcal: 160,
      }),
    ])
    expect(totals).toEqual({ carbsG: 180, multiCarbG: 80, sodiumMg: 800, kcal: 720 })
  })

  it('counts a missing sodium or energy figure as nothing', () => {
    expect(fuelTotals([item({ carbsG: 30, sodiumMg: null, kcal: null })])).toEqual({
      carbsG: 30,
      multiCarbG: 0,
      sodiumMg: 0,
      kcal: 0,
    })
  })

  it('is all zero for no items', () => {
    expect(fuelTotals([])).toEqual({ carbsG: 0, multiCarbG: 0, sodiumMg: 0, kcal: 0 })
  })

  it('treats a negative or non-finite amount as nothing eaten', () => {
    const totals = fuelTotals([
      item({ carbsG: -10, servings: 2 }),
      item({ carbsG: Number.NaN }),
      item({ carbsG: 20, servings: Number.POSITIVE_INFINITY }),
      item({ carbsG: 20, servings: -1 }),
      item({ carbsG: 20, servings: 1.5, multiCarb: true }),
    ])
    expect(totals.carbsG).toBe(30)
    expect(totals.multiCarbG).toBe(30)
  })
})

describe('multiCarbShare', () => {
  it('is the multiple-source share of the carbohydrate eaten', () => {
    expect(
      multiCarbShare([
        item({ carbsG: 30, servings: 2, multiCarb: true }),
        item({ carbsG: 20, servings: 3, multiCarb: false }),
      ]),
    ).toBe(0.5)
    expect(multiCarbShare([item({ multiCarb: true })])).toBe(1)
    expect(multiCarbShare([item({ multiCarb: false })])).toBe(0)
  })

  it('is zero with no carbohydrate eaten', () => {
    expect(multiCarbShare([])).toBe(0)
    expect(multiCarbShare([item({ carbsG: 0, multiCarb: true })])).toBe(0)
  })
})

describe('the rate per hour', () => {
  it('divides by elapsed time, because eating happens at stops', () => {
    // 3 h 30 min on the clock, 3 h 10 min moving: the rate is over the clock.
    const elapsedSec = 3.5 * SECONDS_PER_HOUR
    expect(ratePerHour(210, elapsedSec)).toBe(60)
    expect(ratePerHour(210, 3 * SECONDS_PER_HOUR + 10 * SECONDS_PER_MINUTE)).not.toBe(60)
  })

  it('gives grams of carbohydrate per hour for the items of a log', () => {
    const items = [item({ carbsG: 30, servings: 6 }), item({ carbsG: 60, servings: 1 })]
    expect(carbRateGPerH(items, 4 * SECONDS_PER_HOUR)).toBe(60)
    expect(carbRateGPerH([], SECONDS_PER_HOUR)).toBe(0)
  })

  it('is null for a run with no elapsed time', () => {
    for (const sec of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ratePerHour(100, sec), String(sec)).toBeNull()
      expect(carbRateGPerH([item()], sec), String(sec)).toBeNull()
    }
  })

  it('reads minutes from seconds without rounding', () => {
    expect(minutesOf(7200)).toBe(120)
    expect(minutesOf(90)).toBe(1.5)
  })
})

describe('normalisedFuelSettings', () => {
  const ALL_ON: FuelSettings = {
    optIn90: true,
    optInAdvanced: true,
    giDisease: false,
    gutBlock: true,
  }

  it('leaves a consistent combination as it is', () => {
    expect(normalisedFuelSettings(ALL_ON)).toEqual(ALL_ON)
    expect(normalisedFuelSettings({ ...ALL_ON, optInAdvanced: false })).toEqual({
      ...ALL_ON,
      optInAdvanced: false,
    })
    const none: FuelSettings = {
      optIn90: false,
      optInAdvanced: false,
      giDisease: false,
      gutBlock: false,
    }
    expect(normalisedFuelSettings(none)).toEqual(none)
  })

  it('turns every other switch off under a gut condition', () => {
    expect(normalisedFuelSettings({ ...ALL_ON, giDisease: true })).toEqual({
      optIn90: false,
      optInAdvanced: false,
      giDisease: true,
      gutBlock: false,
    })
  })

  it('clears the highest tier when the first higher tier is off, and keeps the gut block', () => {
    expect(normalisedFuelSettings({ ...ALL_ON, optIn90: false })).toEqual({
      optIn90: false,
      optInAdvanced: false,
      giDisease: false,
      gutBlock: true,
    })
  })

  it('is idempotent over all sixteen combinations, and never keeps the highest tier without the first', () => {
    for (let bits = 0; bits < 16; bits++) {
      const requested: FuelSettings = {
        optIn90: (bits & 1) !== 0,
        optInAdvanced: (bits & 2) !== 0,
        giDisease: (bits & 4) !== 0,
        gutBlock: (bits & 8) !== 0,
      }
      const once = normalisedFuelSettings(requested)
      expect(normalisedFuelSettings(once), JSON.stringify(requested)).toEqual(once)
      if (once.optInAdvanced) expect(once.optIn90).toBe(true)
      if (once.giDisease) expect(once).toMatchObject({ optIn90: false, gutBlock: false })
    }
  })

  it('does not change the object it is given', () => {
    const requested = Object.freeze({ ...ALL_ON, giDisease: true })
    expect(() => normalisedFuelSettings(requested)).not.toThrow()
    expect(requested).toEqual({ ...ALL_ON, giDisease: true })
  })
})

describe('shared/domain/fuel.ts', () => {
  const source = readFileSync(join(import.meta.dirname, '../../../shared/domain/fuel.ts'), 'utf8')

  it('is pure: no clock, no I/O, no Node import, no registry', () => {
    expect(source).not.toMatch(/\bDate\b|Math\.random|\bprocess\b|\bfetch\(|from 'node:|require\(/)
    expect(source).not.toMatch(/params\/|\bP\./)
  })

  it('imports only types', () => {
    const imports = [...source.matchAll(/^import (.+) from '(.+)'$/gm)].map((m) => [m[1], m[2]])
    expect(imports).toEqual([
      ['type { FuelItem }', '../engine/types.ts'],
      ['type { FuelSettings }', '../types.ts'],
    ])
  })
})

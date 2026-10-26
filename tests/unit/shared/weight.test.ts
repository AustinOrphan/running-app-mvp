import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEIGHT_UNIT,
  formatLoad,
  fromGrams,
  isWeightUnit,
  lightestLoad,
  loadParts,
  roundDownToStep,
  stepFrom,
  stepsFor,
  toGrams,
} from '../../../shared/domain/weight.ts'
import { formatQuantity, formatRange, quantityIssue } from '../../../shared/copy/quantity.ts'
import { render, tpl } from '../../../shared/copy/template.ts'
import type { EquipmentConfig, LoadSteps, WeightUnit } from '../../../shared/types.ts'
import { NO_VALUE } from '../../../shared/units.ts'

/** A synthetic barbell, in the unit the runner entered it: the bar and the smallest jump. */
function barbell(barUnits: number, jumpUnits: number, unit: WeightUnit): EquipmentConfig {
  return { kind: 'barbell', barG: toGrams(barUnits, unit), jumpG: toGrams(jumpUnits, unit) }
}

const POUNDS_BARBELL = barbell(45, 5, 'lb')
const KILOS_BARBELL = barbell(20, 2.5, 'kg')

describe('toGrams and fromGrams', () => {
  it('stores whole grams: 45 lb is 20 412 g', () => {
    expect(toGrams(45, 'lb')).toBe(20412)
    expect(toGrams(100, 'lb')).toBe(45359)
    expect(toGrams(20, 'kg')).toBe(20000)
    expect(toGrams(1.25, 'kg')).toBe(1250)
    expect(toGrams(0, 'lb')).toBe(0)
    for (const value of [0.1, 12.34, 47.3, 99.99, 250.5]) {
      expect(Number.isInteger(toGrams(value, 'lb')), String(value)).toBe(true)
      expect(Number.isInteger(toGrams(value, 'kg')), String(value)).toBe(true)
    }
  })

  it('lets a value that is not a number through as NaN, for the caller to reject', () => {
    expect(toGrams(Number.NaN, 'lb')).toBeNaN()
    expect(fromGrams(Number.NaN, 'kg')).toBeNaN()
  })

  it('shows back every value on the display grid exactly as typed', () => {
    for (let half = 0; half <= 2000; half += 1) {
      const pounds = half / 2
      expect(fromGrams(toGrams(pounds, 'lb'), 'lb'), `${String(pounds)} lb`).toBe(pounds)
    }
    for (let quarter = 0; quarter <= 2000; quarter += 1) {
      const kilos = quarter / 4
      expect(fromGrams(toGrams(kilos, 'kg'), 'kg'), `${String(kilos)} kg`).toBe(kilos)
    }
  })

  it('rounds the display to the nearest 0.5 lb and the nearest 0.25 kg', () => {
    expect(fromGrams(toGrams(47.2, 'lb'), 'lb')).toBe(47)
    expect(fromGrams(toGrams(47.3, 'lb'), 'lb')).toBe(47.5)
    expect(fromGrams(toGrams(47.8, 'lb'), 'lb')).toBe(48)
    expect(fromGrams(toGrams(52.1, 'kg'), 'kg')).toBe(52)
    expect(fromGrams(toGrams(52.2, 'kg'), 'kg')).toBe(52.25)
    expect(fromGrams(toGrams(52.4, 'kg'), 'kg')).toBe(52.5)
    // the same load in the other unit
    expect(fromGrams(20412, 'kg')).toBe(20.5)
    expect(fromGrams(20000, 'lb')).toBe(44)
  })

  it('never shows more than two decimals, whatever the grams', () => {
    for (let grams = 0; grams <= 300_000; grams += 37) {
      for (const unit of ['lb', 'kg'] as const) {
        expect(formatLoad(grams, unit), `${String(grams)} g`).toMatch(/^\d+(\.(5|25|75))? (lb|kg)$/)
      }
    }
  })
})

describe('formatLoad and loadParts', () => {
  it('reads a load in the unit, without trailing zeros', () => {
    expect(formatLoad(20412, 'lb')).toBe('45 lb')
    expect(formatLoad(toGrams(47.5, 'lb'), 'lb')).toBe('47.5 lb')
    expect(formatLoad(toGrams(110, 'lb'), 'lb')).toBe('110 lb')
    expect(formatLoad(20000, 'kg')).toBe('20 kg')
    expect(formatLoad(20412, 'kg')).toBe('20.5 kg')
    expect(formatLoad(toGrams(52.25, 'kg'), 'kg')).toBe('52.25 kg')
    expect(formatLoad(0, 'lb')).toBe('0 lb')
  })

  it('gives a dash for a load that cannot be shown, never NaN', () => {
    for (const grams of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(formatLoad(grams, 'lb')).toBe(NO_VALUE)
      expect(loadParts(grams, 'kg')).toBeNull()
    }
  })

  it('splits the number from the unit so a range can share it', () => {
    expect(loadParts(20412, 'lb')).toEqual({ num: '45', suffix: ' lb' })
    expect(loadParts(20000, 'kg')).toEqual({ num: '20', suffix: ' kg' })
  })

  it('knows the two units and defaults to pounds', () => {
    expect(isWeightUnit('lb')).toBe(true)
    expect(isWeightUnit('kg')).toBe(true)
    expect(isWeightUnit('stone')).toBe(false)
    expect(isWeightUnit(undefined)).toBe(false)
    expect(DEFAULT_WEIGHT_UNIT).toBe('lb')
  })
})

describe('the load quantity of the copy system', () => {
  const load = (g: number) => ({ kind: 'load', g }) as const

  it('reads in the weight unit and defaults to pounds', () => {
    expect(formatQuantity(load(52163), 'km')).toBe('115 lb')
    expect(formatQuantity(load(52163), 'mi')).toBe('115 lb')
    expect(formatQuantity(load(52163), 'km', 'lb')).toBe('115 lb')
    expect(formatQuantity(load(52163), 'km', 'kg')).toBe('52.25 kg')
    expect(formatQuantity(load(52163), 'mi', 'kg')).toBe('52.25 kg')
  })

  it('does not follow the distance units: miles with kilograms is common', () => {
    expect(formatQuantity(load(20000), 'mi', 'kg')).toBe('20 kg')
    expect(formatQuantity(load(20412), 'km', 'lb')).toBe('45 lb')
  })

  it('prints the unit once in a range', () => {
    expect(formatRange(load(toGrams(100, 'lb')), load(toGrams(115, 'lb')), 'km')).toBe(
      '100 to 115 lb',
    )
    expect(formatRange(load(40000), load(50000), 'mi', 'kg')).toBe('40 to 50 kg')
  })

  it('refuses what is not a load, with a dash', () => {
    for (const bad of [
      { kind: 'load', g: Number.NaN },
      { kind: 'load', g: -1 },
      { kind: 'load', g: Number.POSITIVE_INFINITY },
      { kind: 'load' },
      { kind: 'load', g: '52163' },
    ]) {
      const q = bad as never
      expect(quantityIssue(q), JSON.stringify(bad)).not.toBeNull()
      expect(formatQuantity(q, 'km'), JSON.stringify(bad)).toBe(NO_VALUE)
    }
    expect(quantityIssue(load(0))).toBeNull()
  })

  it('falls back to pounds for a weight unit it does not know', () => {
    expect(formatQuantity(load(52163), 'km', 'stone' as never)).toBe('115 lb')
  })

  it('reaches a template with the same grams in either unit', () => {
    const template = tpl('Suggested {load}.', { load: 'load' })
    const slots = { load: load(toGrams(110, 'lb')) }
    expect(render(template, slots, 'km')).toBe('Suggested 110 lb.')
    expect(render(template, slots, 'km', 'lb')).toBe('Suggested 110 lb.')
    expect(render(template, slots, 'mi', 'kg')).toBe('Suggested 50 kg.')
  })

  it('leaves a template with no load slot as it was', () => {
    const plain = tpl('Run {distance} on {date}.', {
      distance: 'distance',
      date: 'date',
    })
    const slots = {
      distance: { kind: 'distance', m: 5000 },
      date: { kind: 'date', iso: '2026-10-19' },
    } as const
    expect(render(plain, slots, 'km')).toBe('Run 5 km on 19 Oct.')
    expect(render(plain, slots, 'mi', 'kg')).toBe('Run 3.1 mi on 19 Oct.')
  })
})

describe('stepsFor', () => {
  it('gives a barbell from the bar in multiples of its jump, with no top', () => {
    expect(stepsFor([POUNDS_BARBELL], 'barbell', 'lb')).toEqual({
      minG: 20412,
      stepG: 2268,
      maxG: null,
    })
    expect(stepsFor([KILOS_BARBELL], 'barbell', 'kg')).toEqual({
      minG: 20000,
      stepG: 2500,
      maxG: null,
    })
  })

  it('gives dumbbells and kettlebells as the entered list or ladder', () => {
    const list: EquipmentConfig = {
      kind: 'dumbbells',
      loads: {
        loadsG: [toGrams(20, 'lb'), toGrams(10, 'lb'), toGrams(12.5, 'lb'), toGrams(10, 'lb')],
      },
    }
    expect(stepsFor([list], 'dumbbells', 'lb')).toEqual({
      loadsG: [toGrams(10, 'lb'), toGrams(12.5, 'lb'), toGrams(20, 'lb')],
    })
    const ladder: EquipmentConfig = {
      kind: 'kettlebells',
      loads: { minG: toGrams(18, 'lb'), stepG: toGrams(9, 'lb'), maxG: toGrams(54, 'lb') },
    }
    expect(stepsFor([ladder], 'kettlebells', 'lb')).toEqual({
      minG: toGrams(18, 'lb'),
      stepG: toGrams(9, 'lb'),
      maxG: toGrams(54, 'lb'),
    })
  })

  it('gives a machine from its first setting, one step, to the top of the stack', () => {
    const press: EquipmentConfig = {
      kind: 'leg-press',
      stepG: toGrams(10, 'lb'),
      maxG: toGrams(200, 'lb'),
    }
    expect(stepsFor([press], 'leg-press', 'lb')).toEqual({
      minG: toGrams(10, 'lb'),
      stepG: toGrams(10, 'lb'),
      maxG: toGrams(200, 'lb'),
    })
  })

  it('picks the item of the implement asked for and nothing for equipment that carries no load', () => {
    const equipment: EquipmentConfig[] = [
      { kind: 'bands' },
      { kind: 'step' },
      POUNDS_BARBELL,
      { kind: 'dumbbells', loads: { loadsG: [toGrams(10, 'lb')] } },
    ]
    expect(stepsFor(equipment, 'bands', 'lb')).toBeNull()
    expect(stepsFor(equipment, 'step', 'lb')).toBeNull()
    expect(stepsFor(equipment, 'kettlebells', 'lb')).toBeNull()
    expect(stepsFor(equipment, 'leg-curl', 'lb')).toBeNull()
    expect(stepsFor([], 'barbell', 'lb')).toBeNull()
    expect(stepsFor(equipment, 'dumbbells', 'lb')).toEqual({ loadsG: [toGrams(10, 'lb')] })
  })

  it('refuses steps that make no load, so no consumer loops on them', () => {
    const none: EquipmentConfig[] = [
      { kind: 'dumbbells', loads: { loadsG: [] } },
      { kind: 'kettlebells', loads: { loadsG: [0, Number.NaN, -5] } },
      { kind: 'leg-curl', stepG: 0, maxG: 100_000 },
      { kind: 'calf-machine', stepG: toGrams(10, 'lb'), maxG: toGrams(5, 'lb') },
      { kind: 'barbell', barG: toGrams(45, 'lb'), jumpG: 0 },
    ]
    for (const item of none) {
      expect(stepsFor([item], item.kind, 'lb'), item.kind).toBeNull()
    }
    // a step smaller than the display grid collapses to nothing and is refused
    expect(stepsFor([{ kind: 'barbell', barG: 20000, jumpG: 50 }], 'barbell', 'lb')).toBeNull()
  })

  it('puts the entered values on the grid of the unit they are shown in', () => {
    // 2.5 lb entered as 1134 g, shown in kilograms: the nearest quarter is 1.0 kg
    const steps = stepsFor([{ kind: 'barbell', barG: 20000, jumpG: 1134 }], 'barbell', 'kg')
    expect(steps).toEqual({ minG: 20000, stepG: 1250, maxG: null })
  })
})

describe('the steps of a ladder', () => {
  const poundsBar = stepsFor([POUNDS_BARBELL], 'barbell', 'lb') as LoadSteps
  const kilosBar = stepsFor([KILOS_BARBELL], 'barbell', 'kg') as LoadSteps

  it('lands every step on the gram a person would type, however far up the ladder', () => {
    const start = toGrams(45, 'lb')
    for (let steps = 0; steps <= 60; steps += 1) {
      expect(stepFrom(poundsBar, start, steps, 'lb'), `${String(45 + 5 * steps)} lb`).toBe(
        toGrams(45 + 5 * steps, 'lb'),
      )
    }
    const startKg = toGrams(20, 'kg')
    for (let steps = 0; steps <= 60; steps += 1) {
      expect(stepFrom(kilosBar, startKg, steps, 'kg'), `${String(20 + 2.5 * steps)} kg`).toBe(
        toGrams(20 + 2.5 * steps, 'kg'),
      )
    }
  })

  it('needs the grid: a sum of rounded grams drifts by a gram within a few steps', () => {
    if (!('minG' in poundsBar)) throw new Error('a ladder was expected')
    const drift = Array.from({ length: 61 }, (_, steps) => steps).filter(
      (steps) => poundsBar.minG + steps * poundsBar.stepG !== toGrams(45 + 5 * steps, 'lb'),
    )
    expect(drift.length).toBeGreaterThan(0)
    // 70 lb is 31 751 g and not 31 752 g: the first step where the sum goes wrong
    expect(toGrams(70, 'lb')).toBe(31751)
    expect(drift[0]).toBe(5)
  })

  it('moves one step either way from a load on the ladder', () => {
    const squat = toGrams(110, 'lb')
    expect(stepFrom(poundsBar, squat, 1, 'lb')).toBe(toGrams(115, 'lb'))
    expect(stepFrom(poundsBar, squat, 2, 'lb')).toBe(toGrams(120, 'lb'))
    expect(stepFrom(poundsBar, squat, -1, 'lb')).toBe(toGrams(105, 'lb'))
    expect(stepFrom(poundsBar, squat, -13, 'lb')).toBe(toGrams(45, 'lb'))
    expect(stepFrom(poundsBar, squat, -14, 'lb')).toBeNull()
    expect(formatLoad(stepFrom(poundsBar, squat, 1, 'lb') ?? 0, 'lb')).toBe('115 lb')
  })

  it('reads a load that is off the ladder as sitting between two rungs', () => {
    const typed = toGrams(52, 'lb')
    expect(stepFrom(poundsBar, typed, 1, 'lb')).toBe(toGrams(55, 'lb'))
    expect(stepFrom(poundsBar, typed, -1, 'lb')).toBe(toGrams(50, 'lb'))
    expect(stepFrom(poundsBar, typed, 2, 'lb')).toBe(toGrams(60, 'lb'))
    expect(stepFrom(poundsBar, typed, -2, 'lb')).toBe(toGrams(45, 'lb'))
    expect(stepFrom(poundsBar, typed, 0, 'lb')).toBe(toGrams(50, 'lb'))
    // under the empty bar one step up is the bar and one step down is nothing
    expect(stepFrom(poundsBar, toGrams(30, 'lb'), 1, 'lb')).toBe(toGrams(45, 'lb'))
    expect(stepFrom(poundsBar, toGrams(30, 'lb'), -1, 'lb')).toBeNull()
  })

  it('stops at the top of a machine and at the end of a list of dumbbells', () => {
    const stack = stepsFor(
      [{ kind: 'leg-curl', stepG: toGrams(10, 'lb'), maxG: toGrams(100, 'lb') }],
      'leg-curl',
      'lb',
    ) as LoadSteps
    expect(stepFrom(stack, toGrams(90, 'lb'), 1, 'lb')).toBe(toGrams(100, 'lb'))
    expect(stepFrom(stack, toGrams(100, 'lb'), 1, 'lb')).toBeNull()
    expect(stepFrom(stack, toGrams(100, 'lb'), -9, 'lb')).toBe(toGrams(10, 'lb'))
    expect(stepFrom(stack, toGrams(10, 'lb'), -1, 'lb')).toBeNull()
    expect(roundDownToStep(stack, toGrams(250, 'lb'), 'lb')).toBe(toGrams(100, 'lb'))
    // a load above the top sits above the last rung: one step down is the top, one up is nothing
    expect(stepFrom(stack, toGrams(250, 'lb'), -1, 'lb')).toBe(toGrams(100, 'lb'))
    expect(stepFrom(stack, toGrams(250, 'lb'), 1, 'lb')).toBeNull()

    const dumbbells = stepsFor(
      [
        {
          kind: 'dumbbells',
          loads: { loadsG: [50, 60, 70].map((pounds) => toGrams(pounds, 'lb')) },
        },
      ],
      'dumbbells',
      'lb',
    ) as LoadSteps
    // the step from 50 lb to 60 lb is 20% of the load: the list says what there is, and the
    // progression rule (f8.maxStepPct) decides whether to take it
    expect(stepFrom(dumbbells, toGrams(50, 'lb'), 1, 'lb')).toBe(toGrams(60, 'lb'))
    expect(stepFrom(dumbbells, toGrams(70, 'lb'), 1, 'lb')).toBeNull()
    expect(stepFrom(dumbbells, toGrams(55, 'lb'), 1, 'lb')).toBe(toGrams(60, 'lb'))
    expect(stepFrom(dumbbells, toGrams(55, 'lb'), -1, 'lb')).toBe(toGrams(50, 'lb'))
  })

  it('rounds down to a step, and never below the lightest load the equipment makes', () => {
    expect(roundDownToStep(poundsBar, toGrams(112, 'lb'), 'lb')).toBe(toGrams(110, 'lb'))
    expect(roundDownToStep(poundsBar, toGrams(114.5, 'lb'), 'lb')).toBe(toGrams(110, 'lb'))
    expect(roundDownToStep(poundsBar, toGrams(110, 'lb'), 'lb')).toBe(toGrams(110, 'lb'))
    // a load on the ladder stays where it is even when its gram count rounded down
    expect(roundDownToStep(poundsBar, toGrams(70, 'lb'), 'lb')).toBe(toGrams(70, 'lb'))
    expect(roundDownToStep(poundsBar, toGrams(20, 'lb'), 'lb')).toBe(toGrams(45, 'lb'))
    expect(roundDownToStep(poundsBar, 0, 'lb')).toBe(toGrams(45, 'lb'))
    expect(roundDownToStep({ loadsG: [] }, 1000, 'lb')).toBeNull()
    expect(roundDownToStep({ minG: 0, stepG: 0, maxG: null }, 1000, 'lb')).toBeNull()
  })

  it('answers null, not NaN or a loop, for a load or a count that is not a number', () => {
    for (const grams of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(roundDownToStep(poundsBar, grams, 'lb'), String(grams)).toBeNull()
      expect(stepFrom(poundsBar, grams, 1, 'lb'), String(grams)).toBeNull()
    }
    expect(stepFrom(poundsBar, toGrams(100, 'lb'), Number.NaN, 'lb')).toBeNull()
    expect(stepFrom(poundsBar, toGrams(100, 'lb'), 1.5, 'lb')).toBeNull()
  })

  it('knows the lightest load of a ladder and of a list', () => {
    expect(lightestLoad(poundsBar, 'lb')).toBe(toGrams(45, 'lb'))
    expect(lightestLoad({ loadsG: [toGrams(20, 'lb'), toGrams(10, 'lb')] }, 'lb')).toBe(
      toGrams(10, 'lb'),
    )
    expect(lightestLoad({ loadsG: [] }, 'lb')).toBeNull()
  })

  it('works the same in kilograms', () => {
    expect(stepFrom(kilosBar, toGrams(100, 'kg'), 1, 'kg')).toBe(toGrams(102.5, 'kg'))
    expect(formatLoad(stepFrom(kilosBar, toGrams(100, 'kg'), 1, 'kg') ?? 0, 'kg')).toBe('102.5 kg')
    expect(roundDownToStep(kilosBar, toGrams(101, 'kg'), 'kg')).toBe(toGrams(100, 'kg'))
    expect(stepFrom(kilosBar, toGrams(20, 'kg'), -1, 'kg')).toBeNull()
  })
})

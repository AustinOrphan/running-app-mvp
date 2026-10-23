import { describe, expect, it } from 'vitest'
import {
  acclimationCredit,
  heatAbilityMultiplier,
  heatPenaltyPct,
  heatWarning,
  isHotForSteering,
  liljegrenWbgt,
  trainingHeatAdvice,
  weatherIndex,
} from '../../../shared/engine/heat.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EngineInput, SessionSpec } from '../../../shared/engine/types.ts'

/** Wet-bulb temperature by Stull (2011), the published psychrometric approximation. */
function stullWetBulb(tempC: number, rhPct: number): number {
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(rhPct + 8.313659)) +
    Math.atan(tempC + rhPct) -
    Math.atan(rhPct - 1.676331) +
    0.00391838 * rhPct ** 1.5 * Math.atan(0.023101 * rhPct) -
    4.686035
  )
}

describe('liljegrenWbgt (rules I1)', () => {
  it('lies between the psychrometric bounds in the shade (Stull wet bulb)', () => {
    // In the shade WBGT = 0.7 natural wet bulb + 0.2 globe + 0.1 air. The natural wet bulb sits
    // within 1.5 C of the psychrometric wet bulb, the globe within 1.5 C below air.
    for (const [t, rh] of [
      [30, 50],
      [25, 60],
      [20, 40],
      [35, 30],
    ] as const) {
      const w = stullWetBulb(t, rh)
      const wbgt = liljegrenWbgt({ tempC: t, humidityPct: rh, windKph: 3.6, shortwaveWm2: 0 })
      expect(wbgt, `${t} C ${rh}%`).toBeGreaterThan(0.7 * (w - 1.5) + 0.3 * (t - 1.5))
      expect(wbgt, `${t} C ${rh}%`).toBeLessThan(0.7 * (w + 1.5) + 0.3 * t)
    }
  })

  it('pins reference values (regression, tolerance 0.5 C)', () => {
    const cases: Array<[number, number, number, number, number]> = [
      // tempC, humidityPct, windKph, shortwaveWm2, WBGT
      [30, 50, 3.6, 0, 24.1],
      [30, 50, 3.6, 800, 30.7],
      [35, 50, 7, 900, 33.9],
      [20, 50, 10, 400, 17.7],
    ]
    for (const [tempC, humidityPct, windKph, shortwaveWm2, expected] of cases) {
      const got = liljegrenWbgt({ tempC, humidityPct, windKph, shortwaveWm2 })
      expect(
        Math.abs(got - expected),
        `${tempC} C ${humidityPct}% ${shortwaveWm2} W/m2`,
      ).toBeLessThan(0.5)
    }
  })

  it('rises with sun, humidity and temperature, and falls with wind in the sun', () => {
    const base = { tempC: 28, humidityPct: 50, windKph: 7, shortwaveWm2: 0 }
    const sunny = liljegrenWbgt({ ...base, shortwaveWm2: 700 })
    expect(sunny).toBeGreaterThan(liljegrenWbgt(base) + 2)
    expect(liljegrenWbgt({ ...base, humidityPct: 80 })).toBeGreaterThan(liljegrenWbgt(base))
    expect(liljegrenWbgt({ ...base, tempC: 32 })).toBeGreaterThan(liljegrenWbgt(base))
    expect(liljegrenWbgt({ ...base, shortwaveWm2: 700, windKph: 25 })).toBeLessThan(sunny)
  })

  it('stays below the air temperature in the shade and above it in strong sun when hot', () => {
    const shade = liljegrenWbgt({ tempC: 33, humidityPct: 40, windKph: 7, shortwaveWm2: 0 })
    expect(shade).toBeLessThan(33)
    const sun = liljegrenWbgt({ tempC: 33, humidityPct: 40, windKph: 7, shortwaveWm2: 900 })
    expect(sun).toBeGreaterThan(shade + 3)
  })

  it('is deterministic, and the zenith changes the sun load', () => {
    const input = { tempC: 30, humidityPct: 50, windKph: 7, shortwaveWm2: 600 }
    expect(liljegrenWbgt(input)).toBe(liljegrenWbgt({ ...input }))
    expect(liljegrenWbgt({ ...input, zenithDeg: 20 })).not.toBe(
      liljegrenWbgt({ ...input, zenithDeg: 70 }),
    )
  })

  it('handles still air, saturated air and a night with no radiation', () => {
    for (const input of [
      { tempC: 24, humidityPct: 100, windKph: 0, shortwaveWm2: 0 },
      { tempC: 5, humidityPct: 0, windKph: 40, shortwaveWm2: 0 },
      { tempC: -10, humidityPct: 90, windKph: 5, shortwaveWm2: 0 },
    ]) {
      expect(Number.isFinite(liljegrenWbgt(input))).toBe(true)
    }
  })

  it('falls back to the air temperature when an input is missing, and labels it', () => {
    expect(liljegrenWbgt({ tempC: 21, humidityPct: NaN, windKph: 5, shortwaveWm2: 100 })).toBe(21)
    expect(weatherIndex({ tempC: 21, humidityPct: 50, windKph: 5 })).toEqual({
      value: 21,
      index: 'air-temperature',
    })
    const full = weatherIndex({ tempC: 21, humidityPct: 50, windKph: 5, shortwaveWm2: 100 })
    expect(full.index).toBe('wbgt')
    expect(full.value).toBeLessThan(21)
  })
})

describe('heatPenaltyPct (rules I2-I4)', () => {
  const fast = P.i4.abilityFastSec.value
  const slow = P.i4.abilitySlowSec.value

  it('adds nothing inside or below the optimum band, and up to the slope start', () => {
    expect(heatPenaltyPct(5, fast)).toBe(0)
    expect(heatPenaltyPct(7.5, slow)).toBe(0)
    expect(heatPenaltyPct(15, slow)).toBe(0)
  })

  it('uses 0.35% per C above 15 C for the fastest runner', () => {
    expect(heatPenaltyPct(20, fast)).toBeCloseTo(0.35 * 5, 10)
  })

  it('agrees with the Ely marathon table inside the 20-25 C band', () => {
    const mid = heatPenaltyPct(22.5, fast)
    expect(Math.abs(mid - P.i3.marathonTable20to25Pct.value)).toBeLessThan(0.3)
    expect(mid).toBeCloseTo(P.i3.slopeAgreementBand20to25Pct.value, 1)
    // The 15-20 band is cross-checked loosely: the slope starts at 15 C.
    expect(heatPenaltyPct(17.5, fast)).toBeLessThan(P.i3.marathonTable15to20Pct.value)
  })

  it('scales linearly from 1.0 at a 2:30 marathon to 2.0 at 4:30', () => {
    expect(heatAbilityMultiplier(fast)).toBe(1)
    expect(heatAbilityMultiplier(slow)).toBe(2)
    expect(heatAbilityMultiplier((fast + slow) / 2)).toBeCloseTo(1.5, 10)
    expect(heatAbilityMultiplier(fast - 1000)).toBe(1)
    expect(heatAbilityMultiplier(slow + 5000)).toBe(2)
    expect(heatPenaltyPct(20, slow)).toBeCloseTo(2 * heatPenaltyPct(20, fast), 10)
  })

  it('does not extrapolate above WBGT 25 C, and the warning says so', () => {
    expect(heatPenaltyPct(31, fast)).toBe(heatPenaltyPct(25, fast))
    expect(heatWarning(25)).toBeNull()
    const warning = heatWarning(27)
    expect(warning?.severity).toBe('warn')
    expect(warning?.rules).toEqual(['I3', 'I9'])
    expect(warning?.message).toMatch(/not a safety guarantee/)
    expect(warning?.message).not.toMatch(/behind|missed|red/i)
  })
})

function session(over: Partial<SessionSpec> = {}): SessionSpec {
  return {
    date: '2026-07-10',
    order: 0,
    kind: 'threshold',
    title: 'Threshold',
    durationMin: 60,
    distanceM: null,
    gainM: null,
    structure: [],
    target: { zone: 'z2', rpe: [5, 6], hr: null, paceSecPerKm: null, heatNote: null },
    purpose: 'test',
    rules: [],
    flags: [],
    ...over,
  }
}

type Hour = NonNullable<EngineInput['forecast']>[number]

/** What the advice holds when there is nothing to say. */
const NO_ADVICE = { note: null, coolerHour: null, coolerValue: null, peak: null }

/** A summer day: cool dawn, hot afternoon; shortwave follows a simple bell. */
function summerDay(date: string, peakC: number, dawnC: number): Hour[] {
  const hours: Hour[] = []
  for (let h = 0; h < 24; h++) {
    const frac = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI))
    hours.push({
      time: `${date}T${String(h).padStart(2, '0')}:00`,
      tempC: dawnC + (peakC - dawnC) * frac,
      dewPointC: 12,
      humidityPct: 45,
      windKph: 6,
      shortwaveWm2: 850 * frac,
    })
  }
  return hours
}

describe('trainingHeatAdvice (rules I7)', () => {
  it('gives no note on a mild day', () => {
    expect(trainingHeatAdvice(summerDay('2026-07-10', 10, 4), session())).toEqual(NO_ADVICE)
  })

  it('gives no note when the forecast has no hours for the date, or for non-running sessions', () => {
    expect(trainingHeatAdvice(summerDay('2026-07-11', 36, 20), session())).toEqual(NO_ADVICE)
    for (const kind of ['strength', 'mobility', 'rest'] as const) {
      expect(trainingHeatAdvice(summerDay('2026-07-10', 36, 20), session({ kind }))).toEqual(
        NO_ADVICE,
      )
    }
    expect(trainingHeatAdvice([], session())).toEqual(NO_ADVICE)
  })

  it('on a hot day advises effort over pace, hydration and an early cooler start for a key session', () => {
    const { note, coolerHour } = trainingHeatAdvice(summerDay('2026-07-10', 36, 18), session())
    expect(note).toMatch(/WBGT/)
    expect(note).toMatch(/RPE 5-6/)
    expect(note).toMatch(/rather than pace/)
    expect(note).toMatch(/Drink/)
    expect(note).toMatch(/first hot days/)
    expect(coolerHour).not.toBeNull()
    const hour = Number(coolerHour!.slice(0, 2))
    expect(hour).toBeGreaterThanOrEqual(P.i7.windowStartHour.value)
    expect(hour).toBeLessThan(11)
    expect(note).toContain(coolerHour!)
  })

  it('fits the cooler start to the session duration', () => {
    const hours = summerDay('2026-07-10', 36, 18)
    const short = trainingHeatAdvice(hours, session({ durationMin: 45 })).coolerHour
    const long = trainingHeatAdvice(hours, session({ durationMin: 180, kind: 'long' })).coolerHour
    expect(Number(long!.slice(0, 2)) + 3).toBeLessThanOrEqual(P.i7.windowEndHour.value)
    expect(short).not.toBeNull()
  })

  it('suggests a cooler hour for any run, not only the key sessions', () => {
    const hours = summerDay('2026-07-10', 36, 18)
    for (const kind of ['easy', 'recovery', 'strides', 'long', 'threshold', 'b2b'] as const) {
      const advice = trainingHeatAdvice(hours, session({ kind, durationMin: 40 }))
      expect(advice.note, kind).not.toBeNull()
      expect(advice.coolerHour, kind).not.toBeNull()
      expect(advice.coolerValue, kind).not.toBeNull()
      expect(advice.note, kind).toContain(advice.coolerHour!)
    }
  })

  it('offers the cooler hour only for a gain of at least i7.coolerMinGainC', () => {
    // a flat day: no sun and one temperature, so every hour is as warm as the peak
    const flat: Hour[] = summerDay('2026-07-10', 32, 32).map((h) => ({
      ...h,
      tempC: 32,
      shortwaveWm2: 0,
    }))
    const advice = trainingHeatAdvice(flat, session({ kind: 'easy', durationMin: 40 }))
    expect(advice.note).not.toBeNull()
    expect(advice.coolerHour).toBeNull()
    expect(advice.coolerValue).toBeNull()
    expect(advice.peak).not.toBeNull()
  })

  describe('the i7.coolerMinGainC threshold', () => {
    // Air temperature only (no radiation, so the index is the temperature itself): every hour of
    // the day sits at the peak except one at `peakC - gainC`. Dyadic figures keep the sums exact.
    function dayWithCoolerHour(gainC: number): Hour[] {
      const peakC = P.i1.airTempOptimumC.value[1] + 10
      return Array.from({ length: 24 }, (_, h) => ({
        time: `2026-07-10T${String(h).padStart(2, '0')}:00`,
        tempC: h === 8 ? peakC - gainC : peakC,
        dewPointC: 12,
        humidityPct: 45,
        windKph: 6,
      }))
    }
    const easy = session({ kind: 'easy', durationMin: 40 })

    it('offers no cooler hour when the best window gains less than the threshold', () => {
      // half the threshold: 0.5 C while the threshold is 1 C
      const advice = trainingHeatAdvice(dayWithCoolerHour(P.i7.coolerMinGainC.value / 2), easy)
      expect(advice.peak).not.toBeNull()
      expect(advice.note).not.toBeNull()
      expect(advice.coolerHour).toBeNull()
      expect(advice.coolerValue).toBeNull()
    })

    it('offers the cooler hour at a gain of exactly the threshold', () => {
      const advice = trainingHeatAdvice(dayWithCoolerHour(P.i7.coolerMinGainC.value), easy)
      expect(advice.coolerHour).toBe('08:00')
      expect(advice.coolerValue).toBe(advice.peak!.value - P.i7.coolerMinGainC.value)
      expect(advice.note).toContain('08:00')
    })
  })

  it('returns the peak: the hour with the highest index, and which index it is', () => {
    const hours = summerDay('2026-07-10', 36, 18)
    const { peak } = trainingHeatAdvice(hours, session())
    expect(peak).not.toBeNull()
    expect(peak!.index).toBe('wbgt')
    const window = hours.filter((h) => {
      const hour = Number(h.time.slice(11, 13))
      return hour >= P.i7.windowStartHour.value && hour < P.i7.windowEndHour.value
    })
    const best = Math.max(...window.map((h) => weatherIndex(h).value - P.i2.wbgtOptimumC.value[1]))
    const at = window.find((h) => weatherIndex(h).value - P.i2.wbgtOptimumC.value[1] === best)!
    expect(peak!.hour).toBe(Number(at.time.slice(11, 13)))
    expect(peak!.value).toBe(weatherIndex(at).value)
    expect(trainingHeatAdvice(hours, session()).note).toContain(
      `reaches ${peak!.value.toFixed(0)} C around ${String(peak!.hour).padStart(2, '0')}:00`,
    )
  })

  it('returns the cooler value that the note quotes', () => {
    const hours = summerDay('2026-07-10', 36, 18)
    const { note, coolerHour, coolerValue, peak } = trainingHeatAdvice(hours, session())
    expect(coolerHour).not.toBeNull()
    expect(coolerValue).not.toBeNull()
    expect(coolerValue!).toBeLessThan(peak!.value)
    expect(peak!.value - coolerValue!).toBeGreaterThanOrEqual(P.i7.coolerMinGainC.value)
    expect(note).toContain(`about ${coolerValue!.toFixed(0)} C`)
  })

  it('labels a peak without radiation as air temperature', () => {
    const hours = summerDay('2026-07-10', 33, 17).map(({ shortwaveWm2: _s, ...rest }) => rest)
    const { peak } = trainingHeatAdvice(hours, session())
    expect(peak).toMatchObject({ index: 'air-temperature' })
    expect(peak!.value).toBeCloseTo(33, 5)
  })

  it('has no peak when the day stays inside the optimum band or is not a running day', () => {
    expect(trainingHeatAdvice(summerDay('2026-07-10', 10, 4), session()).peak).toBeNull()
    expect(trainingHeatAdvice([], session()).peak).toBeNull()
    expect(
      trainingHeatAdvice(summerDay('2026-07-10', 36, 20), session({ kind: 'strength' })).peak,
    ).toBeNull()
  })

  it('warns above WBGT 25 C and labels the index', () => {
    const hot = trainingHeatAdvice(summerDay('2026-07-10', 40, 30), session())
    expect(hot.note).toMatch(/WBGT above 25 C/)
    expect(hot.note).toMatch(/not a safety guarantee/)
    expect(hot.note).not.toMatch(/behind|missed|red/i)
  })

  it('falls back to air temperature when the forecast lacks radiation, and says so', () => {
    const hours = summerDay('2026-07-10', 33, 17).map(({ shortwaveWm2: _s, ...rest }) => rest)
    const { note } = trainingHeatAdvice(hours, session())
    expect(note).toMatch(/air temperature/)
    expect(note).not.toMatch(/WBGT reaches/)
  })

  it('is deterministic', () => {
    const hours = summerDay('2026-07-10', 36, 18)
    expect(trainingHeatAdvice(hours, session())).toEqual(trainingHeatAdvice(hours, session()))
  })
})

describe('isHotForSteering (rules I9)', () => {
  const warn = P.i9.warnWbgtC.value

  it('is hot from a WBGT peak at or above the I9 warning and not below it', () => {
    expect(warn).toBe(25)
    expect(isHotForSteering({ value: warn, index: 'wbgt' }, [])).toBe(true)
    expect(isHotForSteering({ value: warn + 4, index: 'wbgt' }, [])).toBe(true)
    expect(isHotForSteering({ value: warn - 0.1, index: 'wbgt' }, [])).toBe(false)
    expect(isHotForSteering({ value: 20, index: 'wbgt' }, [])).toBe(false)
  })

  it('is hot from the heat flag alone, with or without a peak', () => {
    expect(isHotForSteering(null, ['heat'])).toBe(true)
    expect(isHotForSteering({ value: 12, index: 'wbgt' }, ['heat'])).toBe(true)
    expect(isHotForSteering({ value: 40, index: 'air-temperature' }, ['night', 'heat'])).toBe(true)
  })

  it('is never hot from an air-temperature peak alone', () => {
    expect(isHotForSteering({ value: 40, index: 'air-temperature' }, [])).toBe(false)
    expect(isHotForSteering({ value: warn, index: 'air-temperature' }, [])).toBe(false)
  })

  it('is not hot without a peak and without the flag, and other flags do not count', () => {
    expect(isHotForSteering(null, [])).toBe(false)
    expect(isHotForSteering(null, ['night', 'downhill', 'spike-warn'])).toBe(false)
  })

  it('follows the forecast: 25 C WBGT is hot, a mild afternoon at 20 C is not', () => {
    const hotDay = trainingHeatAdvice(summerDay('2026-07-10', 40, 30), session())
    expect(hotDay.peak!.value).toBeGreaterThanOrEqual(warn)
    expect(isHotForSteering(hotDay.peak, [])).toBe(true)
    const mildDay = trainingHeatAdvice(summerDay('2026-07-10', 24, 12), session())
    expect(mildDay.peak).not.toBeNull()
    expect(mildDay.peak!.value).toBeLessThan(warn)
    expect(isHotForSteering(mildDay.peak, [])).toBe(false)
  })

  it('adds no Param: the threshold is the one rule I9 already carries', () => {
    expect(P.i9.warnWbgtC.rule).toBe('I9')
  })
})

describe('acclimationCredit (rules I8)', () => {
  const today = '2026-07-30'
  function days(from: string, n: number): string[] {
    const start = new Date(`${from}T00:00:00Z`).getTime()
    return Array.from({ length: n }, (_, i) =>
      new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    )
  }

  it('is zero with no exposure, or only exposure in the future', () => {
    expect(acclimationCredit([], today)).toBe(0)
    expect(acclimationCredit(['2026-08-05'], today)).toBe(0)
  })

  it('reaches full credit after a block of 10 daily exposures ending today', () => {
    expect(acclimationCredit(days('2026-07-21', 10), today)).toBeCloseTo(1, 10)
  })

  it('gives partial credit for the minimum block of 5 days', () => {
    expect(acclimationCredit(days('2026-07-26', 5), today)).toBeCloseTo(0.5, 10)
  })

  it('decays 2.5% of the adaptation per day after the last exposure', () => {
    const block = days('2026-07-01', 10) // ends 07-10
    expect(acclimationCredit(block, '2026-07-10')).toBeCloseTo(1, 10)
    expect(acclimationCredit(block, '2026-07-20')).toBeCloseTo(0.75, 10)
    expect(acclimationCredit(block, '2026-07-30')).toBeCloseTo(0.5, 10)
  })

  it('reaches zero by about 40 days after the last exposure', () => {
    const block = days('2026-06-01', 10) // ends 06-10
    expect(acclimationCredit(block, '2026-07-20')).toBe(0)
    expect(acclimationCredit(block, '2026-08-30')).toBe(0)
  })

  it('treats duplicate days once and ignores order', () => {
    const block = days('2026-07-21', 10)
    expect(acclimationCredit([...block, ...block].reverse(), today)).toBeCloseTo(1, 10)
  })

  it('never leaves 0..1', () => {
    for (const n of [1, 3, 14, 40]) {
      const c = acclimationCredit(days('2026-06-20', n), today)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
    }
  })
})

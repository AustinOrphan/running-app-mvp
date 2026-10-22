import { describe, expect, it } from 'vitest'
import {
  acclimationCredit,
  heatAbilityMultiplier,
  heatPenaltyPct,
  heatWarning,
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
    expect(trainingHeatAdvice(summerDay('2026-07-10', 10, 4), session())).toEqual({
      note: null,
      coolerHour: null,
    })
  })

  it('gives no note when the forecast has no hours for the date, or for non-running sessions', () => {
    expect(trainingHeatAdvice(summerDay('2026-07-11', 36, 20), session())).toEqual({
      note: null,
      coolerHour: null,
    })
    expect(
      trainingHeatAdvice(summerDay('2026-07-10', 36, 20), session({ kind: 'strength' })),
    ).toEqual({ note: null, coolerHour: null })
    expect(trainingHeatAdvice([], session())).toEqual({ note: null, coolerHour: null })
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

  it('suggests a cooler hour for key sessions only', () => {
    const hours = summerDay('2026-07-10', 36, 18)
    const easy = trainingHeatAdvice(hours, session({ kind: 'easy', durationMin: 40 }))
    expect(easy.note).not.toBeNull()
    expect(easy.coolerHour).toBeNull()
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

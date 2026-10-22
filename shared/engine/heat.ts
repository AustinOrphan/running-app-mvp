// Heat: WBGT, race-time penalty, training guidance and acclimation credit [rules section i].
// Pure: no clock, no I/O. The model constants below are the physical constants and instrument
// dimensions of the Liljegren model; every tunable number comes from the registry.
import { daysBetween } from '../dates.ts'
import { P } from './params/index.ts'
import type { EngineInput, EngineWarning, SessionSpec } from './types.ts'

// ---------------------------------------------------------------------------------------------
// Liljegren WBGT [rules I1]
// ---------------------------------------------------------------------------------------------

const STEFAN_BOLTZMANN = 5.670374e-8
const CP_AIR = 1003.5
const M_AIR = 28.97
const M_H2O = 18.015
const R_GAS = 8314.34
const R_AIR = R_GAS / M_AIR
const CP_RATIO = (CP_AIR * M_AIR) / M_H2O
const PRANDTL = CP_AIR / (CP_AIR + 1.25 * R_AIR)
const GLOBE_DIAMETER = 0.0508
const GLOBE_EMISSIVITY = 0.95
const GLOBE_ALBEDO = 0.05
const WICK_DIAMETER = 0.007
const WICK_LENGTH = 0.0254
const WICK_EMISSIVITY = 0.95
const WICK_ALBEDO = 0.4
const SURFACE_ALBEDO = 0.45
const SURFACE_EMISSIVITY = 0.999
/** Wind speed floor of the model, m/s: the instruments always see some natural ventilation. */
const MIN_WIND_MPS = 0.13
/** Numerical guard: cosine of the zenith is never allowed below this (sun at the horizon). */
const MIN_COS_ZENITH = 0.05
const KELVIN = 273.15

/** Saturation vapour pressure over water, hPa (Buck 1996, with the pressure enhancement). */
function saturationPressureHpa(tempK: number, pressureHpa: number): number {
  const c = tempK - KELVIN
  return (
    6.1121 * Math.exp((18.678 - c / 234.5) * (c / (257.14 + c))) * (1.0007 + 3.46e-6 * pressureHpa)
  )
}

/** Dynamic viscosity of air, Pa s (Sutherland's law). */
function viscosity(tempK: number): number {
  return (1.458e-6 * tempK ** 1.5) / (tempK + 110.4)
}

/** Latent heat of vaporisation of water, J/kg. */
function latentHeat(tempK: number): number {
  return ((313.15 - tempK) / 30) * 71100 + 2.4e6
}

/** Diffusivity of water vapour in air, m2/s. */
function diffusivity(tempK: number, pressureHpa: number): number {
  return 2.471773765165648e-5 * (tempK * 0.0034210563748421257) ** 2.334 * (1013.25 / pressureHpa)
}

function conductivity(tempK: number): number {
  return (CP_AIR + 1.25 * R_AIR) * viscosity(tempK)
}

/** Heat transfer coefficient of the globe (a sphere), W/m2/K. */
function sphereCoefficient(tempK: number, pressureHpa: number, windMps: number): number {
  const density = (pressureHpa * 100) / (R_AIR * tempK)
  const reynolds = (windMps * density * GLOBE_DIAMETER) / viscosity(tempK)
  const nusselt = 2 + 0.6 * Math.sqrt(reynolds) * PRANDTL ** 0.3333
  return (nusselt * conductivity(tempK)) / GLOBE_DIAMETER
}

/** Heat transfer coefficient of the wet wick (a cylinder), W/m2/K. */
function cylinderCoefficient(tempK: number, pressureHpa: number, windMps: number): number {
  const density = (pressureHpa * 100) / (R_AIR * tempK)
  const reynolds = (windMps * density * WICK_DIAMETER) / viscosity(tempK)
  const nusselt = 0.281 * reynolds ** 0.6 * PRANDTL ** 0.44
  return (nusselt * conductivity(tempK)) / WICK_DIAMETER
}

/** Root of an increasing function on [low, high] by bisection; deterministic and always converges. */
function bisect(f: (x: number) => number, low: number, high: number): number {
  let a = low
  let b = high
  for (let i = 0; i < 80; i++) {
    const mid = (a + b) / 2
    if (f(mid) > 0) b = mid
    else a = mid
  }
  return (a + b) / 2
}

/** Whether every value is a finite number. */
function isUsable(...values: Array<number | null | undefined>): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v))
}

/**
 * WBGT by the Liljegren method [rules I1]: 0.7 natural wet bulb + 0.2 globe + 0.1 air, with the
 * two instrument temperatures solved from their energy balances. Wind is taken as the 2 m wind;
 * the surface is assumed to be at air temperature and cloud is not modelled beyond the measured
 * shortwave. When the zenith is not given, `i1.defaultZenithDeg` applies. Returns the air
 * temperature when an input is missing or not finite; `weatherIndex` labels which was used.
 */
export function liljegrenWbgt(input: {
  tempC: number
  humidityPct: number
  windKph: number
  shortwaveWm2: number
  pressureHpa?: number
  zenithDeg?: number
}): number {
  if (!isUsable(input.tempC, input.humidityPct, input.windKph, input.shortwaveWm2)) {
    return input.tempC
  }
  const pressure = isUsable(input.pressureHpa) ? input.pressureHpa! : P.i1.defaultPressureHpa.value
  const zenithDeg = isUsable(input.zenithDeg) ? input.zenithDeg! : P.i1.defaultZenithDeg.value
  const ta = input.tempC + KELVIN
  const rh = Math.max(0, Math.min(100, input.humidityPct)) / 100
  const wind = Math.max(input.windKph / 3.6, MIN_WIND_MPS)
  const solar = Math.max(0, input.shortwaveWm2)
  const fdir = P.i1.directBeamFraction.value
  const cosz = Math.max(MIN_COS_ZENITH, Math.cos((zenithDeg * Math.PI) / 180))
  const tanz = Math.sqrt(1 - cosz * cosz) / cosz

  const eAir = rh * saturationPressureHpa(ta, pressure)
  // Clear-sky atmospheric emissivity (Brutsaert), from the vapour pressure in hPa.
  const emisAtm = 0.575 * eAir ** 0.143
  const skyAndGround = 0.5 * (emisAtm * ta ** 4 + SURFACE_EMISSIVITY * ta ** 4)

  // Natural wet bulb: energy balance of a wetted cylinder.
  const wickRatio = 0.25 * (WICK_DIAMETER / WICK_LENGTH)
  const solarOnWick =
    (1 - WICK_ALBEDO) *
    solar *
    ((1 - fdir) * (1 + wickRatio) + fdir * (tanz / Math.PI + wickRatio) + SURFACE_ALBEDO)
  const wetBulb = bisect(
    (tw) => {
      const ref = 0.5 * (tw + ta)
      const radiation = STEFAN_BOLTZMANN * WICK_EMISSIVITY * (skyAndGround - tw ** 4) + solarOnWick
      const eWick = saturationPressureHpa(tw, pressure)
      const density = (pressure * 100) / (R_AIR * ref)
      const schmidt = viscosity(ref) / (density * diffusivity(ref, pressure))
      const h = cylinderCoefficient(ref, pressure, wind)
      const next =
        ta -
        (latentHeat(ref) / CP_RATIO) *
          ((eWick - eAir) / (pressure - eWick)) *
          (PRANDTL / schmidt) ** 0.56 +
        radiation / h
      return tw - next
    },
    ta - 50,
    ta + 20,
  )

  // Globe temperature: energy balance of a black globe.
  const solarOnGlobe =
    solar > 0
      ? (solar / (2 * STEFAN_BOLTZMANN * GLOBE_EMISSIVITY)) *
        (1 - GLOBE_ALBEDO) *
        (fdir * (1 / (2 * cosz) - 1) + 1 + SURFACE_ALBEDO)
      : 0
  const globe = bisect(
    (tg) => {
      const ref = 0.5 * (tg + ta)
      const h = sphereCoefficient(ref, pressure, wind)
      const fourth =
        skyAndGround - (h / (STEFAN_BOLTZMANN * GLOBE_EMISSIVITY)) * (tg - ta) + solarOnGlobe
      return tg - Math.max(fourth, 0) ** 0.25
    },
    ta - 30,
    ta + 60,
  )

  const wbgt = 0.7 * (wetBulb - KELVIN) + 0.2 * (globe - KELVIN) + 0.1 * input.tempC
  return Math.round(wbgt * 100) / 100
}

/** Which index a weather value is on, so copy and warnings can say so [rules I1]. */
export interface WeatherIndex {
  value: number
  index: 'wbgt' | 'air-temperature'
}

/** WBGT when humidity, wind and shortwave radiation are all present, else air temperature. */
export function weatherIndex(hour: {
  tempC: number
  humidityPct?: number | null
  windKph?: number | null
  shortwaveWm2?: number | null
  pressureHpa?: number | null
  zenithDeg?: number | null
}): WeatherIndex {
  if (!isUsable(hour.tempC, hour.humidityPct, hour.windKph, hour.shortwaveWm2)) {
    return { value: hour.tempC, index: 'air-temperature' }
  }
  const input: Parameters<typeof liljegrenWbgt>[0] = {
    tempC: hour.tempC,
    humidityPct: hour.humidityPct!,
    windKph: hour.windKph!,
    shortwaveWm2: hour.shortwaveWm2!,
  }
  if (isUsable(hour.pressureHpa)) input.pressureHpa = hour.pressureHpa!
  if (isUsable(hour.zenithDeg)) input.zenithDeg = hour.zenithDeg!
  return { value: liljegrenWbgt(input), index: 'wbgt' }
}

// ---------------------------------------------------------------------------------------------
// Race-time penalty [rules I2-I4]
// ---------------------------------------------------------------------------------------------

/** Heat multiplier for ability: 1 at a fast marathon-equivalent, rising linearly to the slow end. */
export function heatAbilityMultiplier(abilityMarathonSec: number): number {
  const fast = P.i4.abilityFastSec.value
  const slow = P.i4.abilitySlowSec.value
  const lo = P.i4.abilityMultiplierMin.value
  const hi = P.i4.abilityMultiplierMax.value
  if (!Number.isFinite(abilityMarathonSec)) return hi
  const share = Math.max(0, Math.min(1, (abilityMarathonSec - fast) / (slow - fast)))
  return lo + (hi - lo) * share
}

/**
 * Race-time penalty in percent; no extrapolation above WBGT 25 C [rules I2-I4]. Nothing is added
 * up to the WBGT where the slope starts; above the no-extrapolation limit the penalty stays at
 * its value there (see `heatWarning`).
 */
export function heatPenaltyPct(wbgtC: number, abilityMarathonSec: number): number {
  const capped = Math.min(wbgtC, P.i3.noExtrapolationAboveC.value)
  const excess = Math.max(0, capped - P.i3.slopeStartC.value)
  return excess * P.i3.slopePctPerC.value * heatAbilityMultiplier(abilityMarathonSec)
}

/** The warning that goes with a WBGT above the range of the penalty model [rules I3, I9]. */
export function heatWarning(wbgtC: number): EngineWarning | null {
  if (!(wbgtC > P.i9.warnWbgtC.value)) return null
  return {
    code: 'heat-above-model-range',
    severity: 'warn',
    message: `WBGT is forecast above ${P.i9.warnWbgtC.value} C. The heat penalty is not extrapolated past that point, so the time estimate is optimistic. WBGT is a screening index, not a safety guarantee: plan for a slower, effort-led race and a start that avoids the hottest hours.`,
    rules: ['I3', 'I9'],
  }
}

// ---------------------------------------------------------------------------------------------
// Training in heat [rules I7]
// ---------------------------------------------------------------------------------------------

const NO_HEAT_NOTE_KINDS = new Set<SessionSpec['kind']>(['strength', 'mobility', 'rest'])
const KEY_KINDS = new Set<SessionSpec['kind']>([
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'b2b',
  'race',
  'hike',
])

interface HourPoint {
  hour: number
  value: number
  excess: number
  index: WeatherIndex['index']
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Heat note and the best cooler hour for a session [rules I7]. The session carries no clock time,
 * so the whole day inside the daylight window is considered: the note describes the warmest hour
 * of that window; the cooler hour is the start whose hours, over the session's duration, have the
 * lowest mean index (offered for key sessions only, and only when it gains at least
 * `i7.coolerMinGainC`). Both are null when the day stays inside the optimum band.
 */
export function trainingHeatAdvice(
  forecastHours: NonNullable<EngineInput['forecast']>,
  session: SessionSpec,
): { note: string | null; coolerHour: string | null } {
  const none = { note: null, coolerHour: null }
  if (NO_HEAT_NOTE_KINDS.has(session.kind)) return none
  const start = P.i7.windowStartHour.value
  const end = P.i7.windowEndHour.value
  const points = new Map<number, HourPoint>()
  for (const h of forecastHours) {
    if (h.time.slice(0, 10) !== session.date) continue
    const hour = Number(h.time.slice(11, 13))
    if (!Number.isInteger(hour) || hour < start || hour >= end) continue
    const idx = weatherIndex(h)
    const optimumTop =
      idx.index === 'wbgt' ? P.i2.wbgtOptimumC.value[1] : P.i1.airTempOptimumC.value[1]
    points.set(hour, { hour, value: idx.value, excess: idx.value - optimumTop, index: idx.index })
  }
  if (points.size === 0) return none

  let peak: HourPoint | null = null
  for (const point of [...points.values()].sort((a, b) => a.hour - b.hour)) {
    if (peak === null || point.excess > peak.excess) peak = point
  }
  if (peak === null || peak.excess <= 0) return none

  let coolerHour: string | null = null
  let coolerValue = 0
  if (KEY_KINDS.has(session.kind)) {
    const span = Math.max(1, Math.ceil(session.durationMin / 60))
    let bestMean = Infinity
    let bestStart = -1
    for (let s = start; s + span <= end; s++) {
      let sum = 0
      let complete = true
      for (let h = s; h < s + span; h++) {
        const p = points.get(h)
        if (!p) {
          complete = false
          break
        }
        sum += p.excess
      }
      if (complete && sum / span < bestMean) {
        bestMean = sum / span
        bestStart = s
      }
    }
    if (bestStart >= 0 && peak.excess - bestMean >= P.i7.coolerMinGainC.value) {
      coolerHour = `${pad2(bestStart)}:00`
      coolerValue = bestMean + (peak.value - peak.excess)
    }
  }

  const label = peak.index === 'wbgt' ? 'WBGT' : 'air temperature'
  const parts = [
    `Warm day: ${label} reaches ${peak.value.toFixed(0)} C around ${pad2(peak.hour)}:00 (${label} is the index used).`,
    `Go by effort (RPE ${session.target.rpe[0]}-${session.target.rpe[1]}) or an HR cap rather than pace or a fixed HR zone, because heart rate runs high in heat.`,
    'Drink before and during the session, and ease the intensity on the first hot days of the season.',
  ]
  if (peak.index === 'wbgt' && peak.value > P.i9.warnWbgtC.value) {
    parts.push(
      `WBGT above ${P.i9.warnWbgtC.value} C: shorten, slow down or move the session. WBGT is a screening index, not a safety guarantee.`,
    )
  }
  if (coolerHour) {
    parts.push(`A start near ${coolerHour} is cooler (${label} about ${coolerValue.toFixed(0)} C).`)
  }
  return { note: parts.join(' '), coolerHour }
}

// ---------------------------------------------------------------------------------------------
// Acclimation [rules I8]
// ---------------------------------------------------------------------------------------------

/**
 * Acclimation credit from 0 to 1, decaying with time since exposure [rules I8].
 *
 * Each distinct exposure day on or before `today` adds 1 / `i8.blockDays` of credit, up to 1.
 * Between exposure days the credit decays by `i8.decayPctPerDay` percent of the full adaptation
 * per day, and after the last exposure it keeps decaying the same way, reaching zero at
 * `i8.zeroCreditDays` at the latest (an extrapolation, grade D). Re-acclimation speed-up is not
 * modelled.
 */
export function acclimationCredit(exposureDays: string[], today: string): number {
  const days = [...new Set(exposureDays)].filter((d) => daysBetween(d, today) >= 0).sort()
  if (days.length === 0) return 0
  const gain = 1 / P.i8.blockDays.value
  const decayPerDay = P.i8.decayPctPerDay.value / 100
  let credit = 0
  let previous = days[0]!
  for (const day of days) {
    const gap = daysBetween(previous, day) - 1
    if (gap > 0) credit = Math.max(0, credit - gap * decayPerDay)
    credit = Math.min(1, credit + gain)
    previous = day
  }
  const since = daysBetween(previous, today)
  if (since >= P.i8.zeroCreditDays.value) return 0
  return Math.max(0, credit - since * decayPerDay)
}

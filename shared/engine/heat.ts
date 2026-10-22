// Stub from the training-engine scaffold; Task E3 implements it.
import type { EngineInput, SessionSpec } from './types.ts'

/** WBGT by the Liljegren method, with an air-temperature fallback [rules I1]. */
export function liljegrenWbgt(_input: {
  tempC: number
  humidityPct: number
  windKph: number
  shortwaveWm2: number
  pressureHpa?: number
  zenithDeg?: number
}): number {
  throw new Error('Task E3: liljegrenWbgt is not implemented')
}

/** Race-time penalty in percent; no extrapolation above WBGT 25 C [rules I2-I4]. */
export function heatPenaltyPct(_wbgtC: number, _abilityMarathonSec: number): number {
  throw new Error('Task E3: heatPenaltyPct is not implemented')
}

/** Heat note and the best cooler hour for a session [rules I7]. */
export function trainingHeatAdvice(
  _forecastHours: NonNullable<EngineInput['forecast']>,
  _session: SessionSpec,
): { note: string | null; coolerHour: string | null } {
  throw new Error('Task E3: trainingHeatAdvice is not implemented')
}

/** Acclimation credit from 0 to 1, decaying with time since exposure [rules I8]. */
export function acclimationCredit(_exposureDays: string[], _today: string): number {
  throw new Error('Task E3: acclimationCredit is not implemented')
}

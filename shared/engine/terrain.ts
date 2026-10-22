// Gradient cost and grade-adjusted speed [rules I11]. Pure; also used by the file summaries.
import { P } from './params/index.ts'

/** Cost of running in J/kg/m at a fractional grade, from the registry polynomial. */
function polynomialCost(grade: number): number {
  const limit = P.i11.maxGradeFraction.value
  const g = Math.max(-limit, Math.min(limit, grade))
  // Horner evaluation, highest power first.
  return P.i11.polynomial.value.reduce((acc, coefficient) => acc * g + coefficient, 0)
}

/**
 * Minetti cost of running at a grade (fraction, 0.1 = 10%), as a ratio to level cost [rules I11].
 * The grade is clamped to the range of the fit; the curve is returned as fitted, with no credit
 * cap (the cap belongs to `gradeAdjustedSpeed`).
 */
export function minettiCost(grade: number): number {
  return polynomialCost(grade) / polynomialCost(0)
}

/**
 * Flat-equivalent speed for a speed on a grade; downhill credit is capped [rules I11].
 *
 * The speed is scaled by the cost ratio. A grade steeper than the downhill floor (-20%, where the
 * curve has its minimum) is treated as the floor: the braking cost the curve adds below -20% is
 * not counted, so steeper descents never raise the flat-equivalent speed above its value at
 * the floor.
 */
export function gradeAdjustedSpeed(speedMps: number, grade: number): number {
  const floor = P.i11.downhillCreditFloorGradePct.value / 100
  return speedMps * minettiCost(Math.max(grade, floor))
}

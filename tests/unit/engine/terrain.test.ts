import { describe, expect, it } from 'vitest'
import { P } from '../../../shared/engine/params/index.ts'
import { gradeAdjustedSpeed, minettiCost } from '../../../shared/engine/terrain.ts'

describe('minettiCost (rules I11)', () => {
  it('is 1 on the flat', () => {
    expect(minettiCost(0)).toBeCloseTo(1, 10)
  })

  it('reproduces the measured anchors to within the polynomial fit', () => {
    // The registry polynomial gives 5.40 at +45%, 0.50 at -20% and 1.12 at -45%; the measured
    // anchors are 5.6, 0.51 and 1.15.
    expect(minettiCost(0.45)).toBeCloseTo(P.i11.costRatioPlus45.value, 0)
    expect(Math.abs(minettiCost(0.45) - P.i11.costRatioPlus45.value)).toBeLessThan(0.25)
    expect(Math.abs(minettiCost(-0.2) - P.i11.costRatioMinus20.value)).toBeLessThan(0.02)
    // 1.12 from the polynomial against the measured 1.15 at -45%.
    expect(Math.abs(minettiCost(-0.45) - P.i11.costRatioMinus45.value)).toBeLessThan(0.05)
  })

  it('has its minimum near -20% and rises again on steeper descents', () => {
    const grades = Array.from({ length: 91 }, (_, i) => (i - 45) / 100)
    const costs = grades.map((g) => minettiCost(g))
    const minIndex = costs.indexOf(Math.min(...costs))
    expect(grades[minIndex]).toBeGreaterThanOrEqual(-0.25)
    expect(grades[minIndex]).toBeLessThanOrEqual(-0.15)
    expect(minettiCost(-0.45)).toBeGreaterThan(minettiCost(-0.2))
  })

  it('costs more uphill than flat and less on a gentle downhill', () => {
    expect(minettiCost(0.1)).toBeGreaterThan(1.5)
    expect(minettiCost(-0.1)).toBeLessThan(1)
  })

  it('clamps the grade to the range of the fit', () => {
    expect(minettiCost(0.9)).toBe(minettiCost(0.45))
    expect(minettiCost(-0.9)).toBe(minettiCost(-0.45))
  })

  it('matches the published fit at +8% (5.435 J/kg/m against 3.6 on the flat)', () => {
    expect(minettiCost(0.08)).toBeCloseTo(5.435 / 3.6, 2)
  })
})

describe('gradeAdjustedSpeed (rules I11)', () => {
  it('leaves a flat speed alone', () => {
    expect(gradeAdjustedSpeed(3, 0)).toBeCloseTo(3, 10)
  })

  it('credits uphill running with a higher flat-equivalent speed', () => {
    expect(gradeAdjustedSpeed(2, 0.1)).toBeGreaterThan(3)
  })

  it('gives a smaller flat-equivalent speed on a gentle descent', () => {
    expect(gradeAdjustedSpeed(4, -0.05)).toBeLessThan(4)
  })

  it('caps the downhill credit at the -20% minimum of the curve', () => {
    const floor = gradeAdjustedSpeed(4, -0.2)
    expect(gradeAdjustedSpeed(4, -0.3)).toBe(floor)
    expect(gradeAdjustedSpeed(4, -0.45)).toBe(floor)
    expect(floor).toBeCloseTo(4 * P.i11.costRatioMinus20.value, 1)
    // The true curve rises again at -45%; the capped result does not.
    expect(minettiCost(-0.45)).toBeGreaterThan(minettiCost(-0.2))
  })

  it('is linear in speed', () => {
    expect(gradeAdjustedSpeed(6, 0.07)).toBeCloseTo(2 * gradeAdjustedSpeed(3, 0.07), 10)
  })
})

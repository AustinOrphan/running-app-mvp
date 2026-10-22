import { describe, expect, test } from 'vitest'
import { remainingPlan } from '../../../shared/domain/adaptation.ts'

const weekStart = '2026-03-02'

describe('remainingPlan', () => {
  test('remaining minutes and per-day advice', () => {
    expect(
      remainingPlan({ today: '2026-03-04', weekStart, targetRunMin: 240, runMinSoFar: 90 }),
    ).toEqual({
      remainingMin: 150,
      remainingDays: 5,
      perDayMin: 30,
    })
    expect(
      remainingPlan({ today: '2026-03-05', weekStart, targetRunMin: 240, runMinSoFar: 90 }),
    ).toEqual({
      remainingMin: 150,
      remainingDays: 4,
      perDayMin: 38,
    })
  })

  test('never negative once the target is passed', () => {
    expect(
      remainingPlan({ today: '2026-03-04', weekStart, targetRunMin: 240, runMinSoFar: 300 }),
    ).toEqual({
      remainingMin: 0,
      remainingDays: 5,
      perDayMin: 0,
    })
  })

  test('Sunday still counts as one day', () => {
    expect(
      remainingPlan({ today: '2026-03-08', weekStart, targetRunMin: 240, runMinSoFar: 200 }),
    ).toEqual({
      remainingMin: 40,
      remainingDays: 1,
      perDayMin: 40,
    })
  })

  test('a date outside the week gives no per-day advice', () => {
    expect(
      remainingPlan({ today: '2026-03-10', weekStart, targetRunMin: 240, runMinSoFar: 90 }),
    ).toEqual({
      remainingMin: 150,
      remainingDays: 0,
      perDayMin: null,
    })
    expect(
      remainingPlan({ today: '2026-03-01', weekStart, targetRunMin: 240, runMinSoFar: 0 }),
    ).toEqual({
      remainingMin: 240,
      remainingDays: 0,
      perDayMin: null,
    })
  })
})

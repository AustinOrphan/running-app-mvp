import { describe, expect, test } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import type { WeekHistory } from '../../shared/engine/strength.ts'
import {
  COUNT_PROMPT_FEWER,
  COUNT_QUIET_WEEKS,
  countToAsk,
  isQuiet,
  plannedPerWeek,
} from '../../web/components/strength/weeklyCount.ts'
import { makeView } from './strength-fixtures.ts'

// Wednesday 18 Mar 2026: this week starts 16 Mar, the last finished week 9 Mar.
const TODAY = '2026-03-18'
const THIS_WEEK = '2026-03-16'

const week = (offset: number, planned: number, logged: number): WeekHistory => ({
  weekStart: addDays(THIS_WEEK, 7 * offset),
  planned,
  logged,
  sets: logged * 9,
  moved: [],
})

const view = (weeks: WeekHistory[], countPrompt = true) =>
  makeView({ asOf: TODAY, weeks, countPrompt, lowCountWeeks: countPrompt ? 3 : 0 })

describe('the quiet period after "Not now" (design 12.4)', () => {
  test('is four weeks, from the day of the answer', () => {
    expect(COUNT_QUIET_WEEKS).toBe(4)
    expect(COUNT_PROMPT_FEWER).toBe(1)
    expect(isQuiet(TODAY, TODAY)).toBe(true)
    expect(isQuiet(addDays(TODAY, 27), TODAY)).toBe(true)
    expect(isQuiet(addDays(TODAY, 28), TODAY)).toBe(false)
    expect(isQuiet(addDays(TODAY, 90), TODAY)).toBe(false)
  })

  test('holds for nobody who never said it, and for no answer dated in the future', () => {
    expect(isQuiet(TODAY, null)).toBe(false)
    expect(isQuiet(TODAY, addDays(TODAY, 1))).toBe(false)
  })
})

describe('what the plan asks for now', () => {
  test('is the count of the latest week that has sessions planned', () => {
    expect(plannedPerWeek(view([]))).toBeNull()
    expect(plannedPerWeek(view([week(-2, 2, 1), week(-1, 2, 1), week(0, 2, 0)]))).toBe(2)
    expect(plannedPerWeek(view([week(-2, 2, 1), week(-1, 1, 1), week(0, 1, 0)]))).toBe(1)
    // a week with sessions logged and none planned does not say what the plan asks for
    expect(plannedPerWeek(view([week(-1, 2, 1), week(0, 0, 1)]))).toBe(2)
    expect(plannedPerWeek(view([week(0, 0, 1)]))).toBeNull()
  })
})

describe('when the question is asked', () => {
  const low = [week(-3, 2, 1), week(-2, 2, 1), week(-1, 2, 1), week(0, 2, 0)]

  test('names the count the plan asks for, when the server calls for it and nothing holds it back', () => {
    expect(countToAsk(view(low), 2, null)).toBe(2)
    expect(countToAsk(view(low), 3, null)).toBe(2)
  })

  test('is not asked when the server does not call for it', () => {
    expect(countToAsk(view(low, false), 2, null)).toBeNull()
  })

  test.each([0, 1])(
    'is not asked when the Profile already asks for %i a week, whatever the plan still holds',
    (preference) => {
      expect(countToAsk(view(low), preference, null)).toBeNull()
    },
  )

  test('is not asked when the plan asks for one a week, or has nothing planned', () => {
    expect(countToAsk(view(low.map((w) => ({ ...w, planned: 1 }))), 2, null)).toBeNull()
    expect(countToAsk(view([]), 2, null)).toBeNull()
  })

  test('is not asked inside the quiet period', () => {
    expect(countToAsk(view(low), 2, addDays(TODAY, -27))).toBeNull()
    expect(countToAsk(view(low), 2, addDays(TODAY, -28))).toBe(2)
  })
})

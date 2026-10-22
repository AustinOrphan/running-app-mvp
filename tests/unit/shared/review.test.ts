import { describe, expect, test } from 'vitest'
import { suggestAction, type SuggestInput } from '../../../shared/domain/review.ts'
import { makeWeekRow } from '../../factories.ts'

type Review = NonNullable<SuggestInput['review']>

const completeReview: Review = {
  dataStatus: 'complete',
  fatigue: 4,
  symptoms: 'none',
  recoveryConstrained: false,
}

function input(over: Partial<SuggestInput> = {}): SuggestInput {
  return {
    today: '2026-03-16',
    weekStart: '2026-03-02',
    phase: 'base2',
    targetRunMin: 300,
    baselineRunMin: 300,
    plannedRunDays: 4,
    nextBaselineMin: 400,
    week: makeWeekRow({ runMin: 300, runDays: 4, runSessions: 4 }),
    review: completeReview,
    hasPossibleDuplicates: false,
    ...over,
  }
}

function withReview(review: Partial<Review>): SuggestInput {
  return input({ review: { ...completeReview, ...review } })
}

function withRunMin(runMin: number, runDays = 4): SuggestInput {
  return input({ week: makeWeekRow({ runMin, runDays, runSessions: runDays }) })
}

describe('suggestAction', () => {
  test('a cutback week with 2 planned run days, executed as written, is not repeat', () => {
    const cutback = input({
      targetRunMin: 120,
      baselineRunMin: 160,
      nextBaselineMin: 200,
      plannedRunDays: 2,
      week: makeWeekRow({ runMin: 120, runDays: 2, runSessions: 2 }),
      review: { ...completeReview, fatigue: 3, symptoms: 'none' },
    })
    expect(suggestAction(cutback).action).toBe('progress')
    // One run day when two were planned still repeats.
    const short = { ...cutback, week: makeWeekRow({ runMin: 120, runDays: 1, runSessions: 1 }) }
    expect(suggestAction(short).action).toBe('repeat')
  })

  test('order: upcoming, in_progress, await_data, review_duplicates, reduce', () => {
    expect(suggestAction(input({ weekStart: '2026-03-23' })).action).toBe('upcoming')
    expect(suggestAction(input({ weekStart: '2026-03-16' })).action).toBe('in_progress')
    expect(suggestAction(input({ weekStart: '2026-03-10' })).action).toBe('in_progress')
    expect(suggestAction(input({ weekStart: '2026-03-09' })).action).not.toBe('in_progress')
    // In progress wins over complete data.
    expect(suggestAction(input({ weekStart: '2026-03-16', today: '2026-03-18' })).action).toBe(
      'in_progress',
    )
    expect(suggestAction(input({ review: null })).action).toBe('await_data')
    expect(suggestAction(withReview({ dataStatus: 'unconfirmed' })).action).toBe('await_data')
    expect(suggestAction(withReview({ dataStatus: 'missing' })).action).toBe('await_data')
    expect(suggestAction(input({ hasPossibleDuplicates: true })).action).toBe('review_duplicates')
    // review_duplicates beats reduce
    expect(
      suggestAction({ ...withReview({ fatigue: 9 }), hasPossibleDuplicates: true }).action,
    ).toBe('review_duplicates')
    // await_data beats review_duplicates
    expect(
      suggestAction({ ...withReview({ dataStatus: 'unconfirmed' }), hasPossibleDuplicates: true })
        .action,
    ).toBe('await_data')
  })

  test('reduce triggers', () => {
    expect(suggestAction(withReview({ fatigue: 8 })).action).toBe('reduce')
    expect(suggestAction(withReview({ fatigue: 7 })).action).not.toBe('reduce')
    expect(suggestAction(withReview({ symptoms: 'persistent' })).action).toBe('reduce')
    expect(suggestAction(withReview({ recoveryConstrained: true })).action).toBe('reduce')
  })

  test('taper and race weeks hold with reason taper, after reduce', () => {
    for (const phase of ['taper', 'race'] as const) {
      const s = suggestAction({
        ...withReview({ fatigue: 3 }),
        phase,
        targetRunMin: 200,
        nextBaselineMin: 150,
      })
      expect(s.action).toBe('hold')
      expect(s.reason).toMatch(/taper/i)
      expect(s.suggestedNextMin).toBe(150)
    }
    const capped = suggestAction({
      ...withReview({ fatigue: 3 }),
      phase: 'taper',
      targetRunMin: 200,
      nextBaselineMin: 500,
    })
    expect(capped.suggestedNextMin).toBe(200)
    expect(suggestAction({ ...withReview({ fatigue: 8 }), phase: 'taper' }).action).toBe('reduce')
  })

  test('thresholds: 70% repeat, 85% hold, fatigue 5 / 6-7', () => {
    expect(suggestAction(withRunMin(209)).action).toBe('repeat')
    expect(suggestAction(withRunMin(210)).action).toBe('hold')
    expect(suggestAction(withRunMin(254)).action).toBe('hold')
    expect(suggestAction(withRunMin(255)).action).toBe('progress')
    expect(suggestAction(withRunMin(300, 2)).action).toBe('repeat')
    expect(suggestAction(withRunMin(0, 0)).action).toBe('repeat')
    expect(suggestAction(withReview({ fatigue: 5 })).action).toBe('progress')
    expect(suggestAction(withReview({ fatigue: 6 })).action).toBe('hold')
    expect(suggestAction(withReview({ fatigue: 7 })).action).toBe('hold')
    expect(suggestAction(withReview({ symptoms: 'mild' })).action).toBe('hold')
    expect(suggestAction(withReview({ fatigue: null })).action).toBe('needs_recovery_review')
    expect(suggestAction(withReview({ symptoms: null })).action).toBe('needs_recovery_review')
    // repeat is checked before needs_recovery_review
    expect(
      suggestAction({
        ...withRunMin(100),
        review: { ...completeReview, fatigue: null, symptoms: null },
      }).action,
    ).toBe('repeat')
  })

  test('next-week minutes', () => {
    expect(suggestAction(input()).suggestedNextMin).toBe(330)
    expect(suggestAction(input({ nextBaselineMin: 320 })).suggestedNextMin).toBe(320)
    expect(suggestAction(withReview({ fatigue: 6 })).suggestedNextMin).toBe(300)
    expect(suggestAction(withReview({ fatigue: 9 })).suggestedNextMin).toBe(210)
    expect(suggestAction({ ...withRunMin(50), targetRunMin: 100 }).suggestedNextMin).toBe(150)
    expect(suggestAction(withRunMin(50)).suggestedNextMin).toBe(300)

    expect(suggestAction(input({ weekStart: '2026-03-23' })).suggestedNextMin).toBeNull()
    expect(suggestAction(input({ weekStart: '2026-03-16' })).suggestedNextMin).toBeNull()
    expect(suggestAction(input({ review: null })).suggestedNextMin).toBeNull()
    expect(suggestAction(input({ hasPossibleDuplicates: true })).suggestedNextMin).toBeNull()
    expect(suggestAction(withReview({ fatigue: null })).suggestedNextMin).toBeNull()

    for (const over of [
      input(),
      withReview({ fatigue: 6 }),
      withReview({ fatigue: 9 }),
      withRunMin(50),
    ]) {
      expect(suggestAction({ ...over, nextBaselineMin: null }).suggestedNextMin).toBeNull()
    }
  })

  test('every suggestion has a one-sentence reason', () => {
    const cases: SuggestInput[] = [
      input({ weekStart: '2026-03-23' }),
      input({ weekStart: '2026-03-16' }),
      input({ review: null }),
      input({ hasPossibleDuplicates: true }),
      withReview({ fatigue: 9 }),
      { ...input(), phase: 'taper' },
      withRunMin(50),
      withReview({ fatigue: null }),
      withReview({ fatigue: 6 }),
      input(),
    ]
    const actions = new Set<string>()
    for (const c of cases) {
      const s = suggestAction(c)
      actions.add(s.action)
      expect(s.reason.length).toBeGreaterThan(0)
      expect(s.reason.endsWith('.')).toBe(true)
      expect(s.reason).not.toMatch(/\n/)
    }
    expect(actions.size).toBe(9)
  })

  test('zero target does not divide by zero', () => {
    const s = suggestAction(
      input({
        targetRunMin: 0,
        baselineRunMin: 0,
        week: makeWeekRow({ runMin: 0, runDays: 0 }),
      }),
    )
    expect(s.action).toBeDefined()
    expect(Number.isNaN(s.suggestedNextMin ?? 0)).toBe(false)

    // Enough run days, so the percentage comparisons decide the action.
    const pct = suggestAction(
      input({ targetRunMin: 0, week: makeWeekRow({ runMin: 0, runDays: 4, runSessions: 4 }) }),
    )
    expect(pct.action).toBe('progress')
    expect(pct.suggestedNextMin).toBe(0)
  })
})

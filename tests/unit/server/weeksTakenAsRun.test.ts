import { describe, expect, test } from 'vitest'
import { overshootFlags } from '../../../shared/engine/limits.ts'
import type { WeekDraft } from '../../../shared/engine/types.ts'
import type { PlanWeek as PlanWeekRow } from '../../../server/db.ts'
import { weeksTakenAsRun } from '../../../server/services/replan.ts'

// The weeks a re-plan takes as run are the ones the summary words as run past their plan (rules
// g-2, g-6). The draft's flags say which, and the stored rows say which are new.
const MONDAY = '2026-10-19'
const NEXT = '2026-10-26'
const TODAY = '2026-10-21'

function draft(weekStart: string, targetRunMin: number, flags: string[] = []): WeekDraft {
  return {
    weekStart,
    index: 0,
    phase: 'build',
    focus: 'Synthetic',
    targetRunMin,
    longRunMin: 60,
    longRunM: null,
    gainTargetM: null,
    runDays: 4,
    qualitySessions: 1,
    strengthSessions: 1,
    tid: { z1: 80, z2: 5, z3: 15 },
    flags,
    isRecovery: false,
    isTaper: false,
  }
}

function row(weekStart: string, targetRunMin: number, flags: string[] = []): PlanWeekRow {
  return {
    id: `w-${weekStart}`,
    planId: 'p1',
    weekStart,
    index: 0,
    phase: 'build',
    focus: null,
    baselineRunMin: targetRunMin,
    targetRunMin,
    targetSource: 'baseline',
    longRunMin: 60,
    day2Min: null,
    runDays: 4,
    strengthSessions: 1,
    overrideNote: null,
    tid: null,
    flags: JSON.stringify(flags),
    gainTargetM: null,
    qualitySessions: 1,
    isRecovery: false,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  }
}

describe('weeksTakenAsRun', () => {
  test('names a current week the draft flags as run past its plan, with the planned minutes', () => {
    const taken = draft(MONDAY, 144, overshootFlags(79))
    expect(weeksTakenAsRun([row(MONDAY, 79)], [taken], TODAY)).toEqual([
      { weekStart: MONDAY, ranMin: 144, plannedMin: 79 },
    ])
  })

  test('names a week the plan did not have stored yet', () => {
    const taken = draft(MONDAY, 144, overshootFlags(79))
    expect(weeksTakenAsRun([], [taken], TODAY)).toHaveLength(1)
  })

  test('names nothing for a week the draft does not flag', () => {
    expect(weeksTakenAsRun([row(MONDAY, 79)], [draft(MONDAY, 79)], TODAY)).toEqual([])
  })

  test('names nothing for a week already stored as the draft has it', () => {
    const flags = overshootFlags(79)
    expect(weeksTakenAsRun([row(MONDAY, 144, flags)], [draft(MONDAY, 144, flags)], TODAY)).toEqual(
      [],
    )
  })

  test('names the week again when more was run since the last re-plan', () => {
    const flags = overshootFlags(79)
    expect(weeksTakenAsRun([row(MONDAY, 144, flags)], [draft(MONDAY, 160, flags)], TODAY)).toEqual([
      { weekStart: MONDAY, ranMin: 160, plannedMin: 79 },
    ])
  })

  test('names nothing when the planned minutes are not under the minutes run', () => {
    const odd = draft(MONDAY, 79, ['overshoot'])
    expect(weeksTakenAsRun([row(MONDAY, 79)], [odd], TODAY)).toEqual([])
  })

  test('leaves the weeks before the current one alone, whatever their flags', () => {
    const past = draft('2026-10-12', 144, overshootFlags(79))
    expect(weeksTakenAsRun([], [past], TODAY)).toEqual([])
  })

  test('lists a later flagged week too', () => {
    const later = draft(NEXT, 200, overshootFlags(150))
    expect(weeksTakenAsRun([row(NEXT, 150)], [later], TODAY)).toEqual([
      { weekStart: NEXT, ranMin: 200, plannedMin: 150 },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { isToRun } from '../../../shared/domain/sessionStatus.ts'
import type { PlanSessionStatus } from '../../../shared/types.ts'

// Typed as a full record, so adding a status to PlanSessionStatus is a compile error here too
// until the test says whether the status is still to run.
const EXPECTED: Record<PlanSessionStatus, boolean> = {
  planned: true,
  moved: true,
  downgraded: true,
  completed: false,
  partial: false,
  skipped: false,
}

describe('isToRun', () => {
  it.each(Object.entries(EXPECTED))('%s is %s', (status, toRun) => {
    expect(isToRun(status as PlanSessionStatus)).toBe(toRun)
  })

  it('is true exactly for the sessions still to be run: planned, moved and downgraded', () => {
    const toRun = (Object.keys(EXPECTED) as PlanSessionStatus[]).filter(isToRun)
    expect(toRun.sort()).toEqual(['downgraded', 'moved', 'planned'])
  })
})

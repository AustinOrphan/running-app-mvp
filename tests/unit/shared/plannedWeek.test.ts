import { describe, expect, it } from 'vitest'
import { plannedWeek, shownTargetMin } from '../../../shared/domain/plannedWeek.ts'
import { overshootFlags } from '../../../shared/engine/limits.ts'

describe('what a stored week was planned at', () => {
  it('answers the target for a week that was not run past its plan', () => {
    expect(plannedWeek({ targetRunMin: 300, flags: [] })).toEqual({
      plannedRunMin: 300,
      overshoot: false,
    })
    expect(plannedWeek({ targetRunMin: 300, flags: ['recovery', 'peak'] })).toEqual({
      plannedRunMin: 300,
      overshoot: false,
    })
  })

  it('reads the planned minutes back from the flags the engine wrote', () => {
    expect(
      plannedWeek({ targetRunMin: 144, flags: ['restart-floor', ...overshootFlags(79)] }),
    ).toEqual({ plannedRunMin: 79, overshoot: true })
  })

  it('never states a plan above the stored target, as the engine reads it', () => {
    expect(plannedWeek({ targetRunMin: 60, flags: overshootFlags(79) })).toEqual({
      plannedRunMin: 60,
      overshoot: true,
    })
  })

  it('answers the target when the flag has lost its figure', () => {
    expect(plannedWeek({ targetRunMin: 144, flags: ['overshoot'] })).toEqual({
      plannedRunMin: 144,
      overshoot: true,
    })
  })
})

describe('the target a screen shows', () => {
  it('is the planned minutes of a week run past its plan, and the stored target of any other', () => {
    expect(shownTargetMin({ targetRunMin: 144, plannedRunMin: 79, overshoot: true })).toBe(79)
    expect(shownTargetMin({ targetRunMin: 300, plannedRunMin: 300, overshoot: false })).toBe(300)
  })
})

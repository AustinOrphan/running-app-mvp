import { describe, expect, test } from 'vitest'
import type { PlanChange } from '../../shared/engine/types.ts'
import { describeChange } from '../../web/components/planChanges.ts'

const change = (field: string, from: unknown, to: unknown): PlanChange => ({
  weekStart: '2026-10-19',
  field,
  from,
  to,
  rules: ['J5'],
})

describe('describeChange', () => {
  test('names each field in words with its unit', () => {
    expect(describeChange(change('targetRunMin', 320, 280))).toEqual({
      label: 'Weekly running time',
      from: '320 min',
      to: '280 min',
      text: 'Weekly running time 320 min to 280 min',
    })
    expect(describeChange(change('longRunMin', 90, 80)).text).toBe('Long run 90 min to 80 min')
    expect(describeChange(change('runDays', 4, 5)).text).toBe('Run days 4 to 5')
    expect(describeChange(change('strengthSessions', 2, 1)).text).toBe('Strength sessions 2 to 1')
    expect(describeChange(change('qualitySessions', 1, 0)).text).toBe('Quality sessions 1 to 0')
    expect(describeChange(change('gainTargetM', 400, 350)).text).toBe('Gain target 400 m to 350 m')
    expect(describeChange(change('plannedMin', 200, 180)).text).toBe(
      'Planned minutes 200 min to 180 min',
    )
  })

  test('writes phases and the recovery flag as words', () => {
    expect(describeChange(change('phase', 'build', 'specific')).text).toBe(
      'Phase Build to Specific',
    )
    expect(describeChange(change('isRecovery', false, true)).text).toBe('Recovery week no to yes')
  })

  test('says none for a missing value and handles a week added or dropped', () => {
    expect(describeChange(change('gainTargetM', null, 300)).text).toBe('Gain target none to 300 m')
    expect(describeChange(change('week', null, 'build')).text).toBe('Week added (Build)')
    expect(describeChange(change('week', 'taper', null)).text).toBe('Week removed (Taper)')
  })

  test('falls back to the field name and a plain value for a field it does not know', () => {
    expect(describeChange(change('mystery', 1, { a: 2 })).text).toBe('mystery 1 to {"a":2}')
  })
})

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
    // the climb follows the runner's units like every other figure
    expect(describeChange(change('gainTargetM', 400, 350), 'mi').text).toBe(
      'Gain target 1312 ft to 1148 ft',
    )
    expect(describeChange(change('gainTargetM', null, 300), 'mi').text).toBe(
      'Gain target none to 984 ft',
    )
    expect(describeChange(change('plannedMin', 200, 180)).text).toBe(
      'Planned minutes 200 min to 180 min',
    )
  })

  test('writes phases and the recovery flag as words', () => {
    expect(describeChange(change('phase', 'build', 'specific')).text).toBe(
      'Phase Build to Specific',
    )
    expect(describeChange(change('phase', 'base1', 'race')).text).toBe('Phase Base 1 to Race week')
    expect(describeChange(change('isRecovery', false, true)).text).toBe('Recovery week no to yes')
  })

  test('says none for a missing value and handles a week added or dropped', () => {
    expect(describeChange(change('gainTargetM', null, 300)).text).toBe('Gain target none to 300 m')
    expect(describeChange(change('week', null, 'build')).text).toBe('Week added (Build)')
    expect(describeChange(change('week', 'taper', null)).text).toBe('Week removed (Taper)')
  })

  test('names session changes: status, date and kind', () => {
    expect(describeChange(change('session.status', 'planned', 'skipped'))).toEqual({
      label: 'Session status',
      from: 'planned',
      to: 'skipped',
      text: 'Session status planned to skipped',
    })
    expect(describeChange(change('session.status', 'skipped', 'planned')).text).toBe(
      'Session status skipped to planned',
    )
    expect(describeChange(change('session.date', '2026-10-21', '2026-10-23')).text).toBe(
      'Session date 21 Oct to 23 Oct',
    )
    expect(describeChange(change('session.kind', 'easy', 'long-fast-finish')).text).toBe(
      'Session type Easy run to Long run, fast finish',
    )
    expect(describeChange(change('session.date', 'someday', null)).text).toBe(
      'Session date someday to none',
    )
    // a shortened session (the adjust action, E5-6)
    expect(describeChange(change('session.durationMin', 60, 40))).toEqual({
      label: 'Session length',
      from: '60 min',
      to: '40 min',
      text: 'Session length 60 min to 40 min',
    })
  })

  test("names zone changes with the boundary and its value in the runner's unit", () => {
    expect(describeChange(change('zones.thresholdPace', 300, 294))).toEqual({
      label: 'Threshold pace',
      from: '5:00 /km',
      to: '4:54 /km',
      text: 'Threshold pace 5:00 /km to 4:54 /km',
    })
    expect(describeChange(change('zones.thresholdPace', 300, 294), 'mi').text).toBe(
      'Threshold pace 8:03 /mi to 7:53 /mi',
    )
    expect(describeChange(change('zones.hrMax', 185, 188)).text).toBe(
      'Maximum heart rate 185 bpm to 188 bpm',
    )
    expect(describeChange(change('zones.cs', 3.5, 3.6)).label).toBe('Critical speed')
    expect(describeChange(change('zones.unknown', 1, 2)).text).toBe('zones.unknown 1 to 2')
  })

  test('names a declined zone proposal with the values that were proposed', () => {
    expect(describeChange(change('zones.thresholdPace.declined', 300, 294))).toEqual({
      label: 'Declined proposal for threshold pace',
      from: '5:00 /km',
      to: '4:54 /km',
      text: 'Declined proposal for threshold pace 5:00 /km to 4:54 /km',
    })
    expect(describeChange(change('zones.hrMax.declined', 185, 188)).text).toBe(
      'Declined proposal for maximum heart rate 185 bpm to 188 bpm',
    )
  })

  test('falls back to the field name and a plain value for a field it does not know', () => {
    expect(describeChange(change('mystery', 1, { a: 2 })).text).toBe('mystery 1 to {"a":2}')
  })
})

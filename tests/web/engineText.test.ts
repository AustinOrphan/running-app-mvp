import { describe, expect, test } from 'vitest'
import type { EngineWarning } from '../../shared/engine/types.ts'
import {
  groupWarnings,
  localiseEngineText,
  ratingCounts,
  unratedEffortNote,
} from '../../web/components/engineText.ts'

const warning = (
  code: string,
  message: string,
  over: Partial<EngineWarning> = {},
): EngineWarning => ({
  code,
  severity: 'warn',
  message,
  rules: ['H4'],
  ...over,
})

describe('localiseEngineText', () => {
  test('reads ISO dates as "19 Oct" in every unit setting', () => {
    const text = 'The run on 2026-10-19 and the week of 2027-01-04.'
    expect(localiseEngineText(text, 'km')).toBe('The run on 19 Oct and the week of 4 Jan.')
    expect(localiseEngineText(text, undefined)).toBe('The run on 19 Oct and the week of 4 Jan.')
    expect(localiseEngineText(text, 'mi')).toBe('The run on 19 Oct and the week of 4 Jan.')
  })

  test('leaves a date it cannot read alone', () => {
    expect(localiseEngineText('On 2026-13-45 nothing.', 'km')).toBe('On 2026-13-45 nothing.')
  })

  test('keeps metres and kilometres with the km setting', () => {
    const text = 'Climbing is 700 m, above 550 m; the run is 21.1 km.'
    expect(localiseEngineText(text, 'km')).toBe(text)
  })

  test('turns climbs into feet and distances into miles with the mi setting', () => {
    expect(localiseEngineText('Climbing is 700 m, above 550 m.', 'mi')).toBe(
      'Climbing is 2297 ft, above 1804 ft.',
    )
    expect(localiseEngineText('The run is 21.1 km long, 0.5 km more.', 'mi')).toBe(
      'The run is 13.1 mi long, 0.3 mi more.',
    )
  })

  test('does not touch minutes, speeds or the critical-speed distance', () => {
    const text = "90 min at 3.10 m/s with D' 120 m, 5 km/h slower, 3 mins."
    expect(localiseEngineText(text, 'mi')).toBe(text)
  })
})

describe('groupWarnings', () => {
  test('groups by code into one line with the messages as details', () => {
    const groups = groupWarnings(
      [
        warning('gain-ramp-soft', 'Climbing in the week of 2026-10-19 is 700 m.'),
        warning('spike-shortened', 'The run on 2026-10-20 is shortened.', { rules: ['g-1'] }),
        warning('gain-ramp-soft', 'Climbing in the week of 2026-10-26 is 800 m.'),
        warning('gain-ramp-soft', 'Climbing in the week of 2026-11-02 is 900 m.', {
          rules: ['H4', 'g-1'],
        }),
      ],
      'km',
    )
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      code: 'gain-ramp-soft',
      summary: 'Climbing above the 10% step in 3 weeks',
      details: [
        'Climbing in the week of 19 Oct is 700 m.',
        'Climbing in the week of 26 Oct is 800 m.',
        'Climbing in the week of 2 Nov is 900 m.',
      ],
      rules: ['H4', 'g-1'],
    })
    expect(groups[1]).toMatchObject({
      code: 'spike-shortened',
      summary: 'The run on 20 Oct is shortened.',
    })
  })

  test('uses the strongest severity of the group', () => {
    const [group] = groupWarnings(
      [
        warning('x', 'a', { severity: 'info' }),
        warning('x', 'b', { severity: 'hold' }),
        warning('x', 'c', { severity: 'warn' }),
      ],
      undefined,
    )
    expect(group!.severity).toBe('hold')
  })

  test('a code without a summary keeps its first message and a count', () => {
    const [group] = groupWarnings([warning('other', 'First.'), warning('other', 'Second.')], 'km')
    expect(group!.summary).toBe('First. (and 1 more like it)')
  })

  test('localises a lone warning with the viewer units', () => {
    const [group] = groupWarnings(
      [warning('a', 'Climbing is 700 m in the week of 2026-10-19.')],
      'mi',
    )
    expect(group!.summary).toBe('Climbing is 2297 ft in the week of 19 Oct.')
  })
})

describe('ratingCounts', () => {
  test('an RPE or a feel counts for an activity of the planned kind', () => {
    expect(ratingCounts('completed', { rpe: 6, feel: null })).toBe(true)
    expect(ratingCounts('partial', { rpe: null, feel: 0 })).toBe(true)
    expect(ratingCounts('extended', { rpe: null, feel: null })).toBe(false)
  })

  test('only a feel counts for a different kind of activity', () => {
    expect(ratingCounts('modified', { rpe: 6, feel: null })).toBe(false)
    expect(ratingCounts('modified', { rpe: 6, feel: -1 })).toBe(true)
    expect(ratingCounts('modified', { rpe: null, feel: 0 })).toBe(true)
  })
})

describe('unratedEffortNote', () => {
  test('asks for a feel rating alone when the activity is of a different kind', () => {
    expect(unratedEffortNote(null, 'modified')).toBe(
      'Rate how this activity felt so the plan can adjust.',
    )
    expect(unratedEffortNote(null, 'completed')).toBe(
      'Rate this activity (effort or feel) so the plan can adjust.',
    )
  })

  test('adds the caveat only where there is a score to call a guess', () => {
    expect(unratedEffortNote(1, 'completed')).toMatch(/low-confidence guess/)
    expect(unratedEffortNote(null, 'completed')).not.toMatch(/low-confidence guess/)
  })
})

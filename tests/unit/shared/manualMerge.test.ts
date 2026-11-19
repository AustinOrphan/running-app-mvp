import { describe, expect, test } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  MANUAL_MERGE_TEMPLATES,
  mergeConfirmLines,
  mergeEmptyText,
  mergeRefusalText,
} from '../../../shared/copy/manualMerge.ts'
import { alreadyMerged, mergeRefusal } from '../../../shared/domain/manualMerge.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'

type Row = Parameters<typeof mergeRefusal>[0]

function row(over: Partial<Row> & { id: string }): Row {
  return {
    type: 'strength',
    date: '2026-03-02',
    duplicateStatus: 'none',
    duplicateOfId: null,
    ...over,
  }
}

describe('mergeRefusal', () => {
  test('allows one kind within a day, a race counting as a run', () => {
    expect(mergeRefusal(row({ id: 'a' }), row({ id: 'b', date: '2026-03-03' }))).toBeNull()
    expect(
      mergeRefusal(
        row({ id: 'a', type: 'race' }),
        row({ id: 'b', type: 'run', date: '2026-03-01' }),
      ),
    ).toBeNull()
  })

  test('refuses itself, another kind, two days and a copy of a third entry', () => {
    expect(mergeRefusal(row({ id: 'a' }), row({ id: 'a' }))).toBe('same')
    expect(mergeRefusal(row({ id: 'a' }), row({ id: 'b', type: 'run' }))).toBe('kind')
    expect(mergeRefusal(row({ id: 'a' }), row({ id: 'b', type: 'cross' }))).toBe('kind')
    expect(mergeRefusal(row({ id: 'a' }), row({ id: 'b', date: '2026-03-04' }))).toBe('days')
    expect(
      mergeRefusal(
        row({ id: 'a', duplicateStatus: 'confirmed', duplicateOfId: 'c' }),
        row({ id: 'b' }),
      ),
    ).toBe('copy')
  })

  test('a possible or dismissed flag does not stop a merge', () => {
    expect(
      mergeRefusal(
        row({ id: 'a', duplicateStatus: 'possible', duplicateOfId: 'c' }),
        row({ id: 'b', duplicateStatus: 'dismissed', duplicateOfId: 'a' }),
      ),
    ).toBeNull()
  })

  test('a pair already merged is not a refusal', () => {
    const copy = row({ id: 'a', duplicateStatus: 'confirmed', duplicateOfId: 'b' })
    const original = row({ id: 'b' })
    expect(alreadyMerged(copy, original)).toBe(true)
    expect(alreadyMerged(original, copy)).toBe(true)
    expect(mergeRefusal(copy, original)).toBeNull()
  })
})

describe('the words of the merge', () => {
  test('are in the registry and pass the copy lint', () => {
    for (const id of Object.keys(MANUAL_MERGE_TEMPLATES)) expect(TEMPLATES).toHaveProperty(id)
    for (const reason of ['same', 'kind', 'days', 'copy'] as const) {
      expect(lintText(mergeRefusalText(reason))).toEqual([])
    }
    for (const kind of ['run', 'strength'] as const) {
      expect(lintText(mergeEmptyText(kind))).toEqual([])
    }
    const lines = mergeConfirmLines(
      'The intervals.icu entry (46 min)',
      'The hand-entered entry (40 min)',
    )
    expect(lines[0]).toBe(
      'The intervals.icu entry (46 min) stays as the record, with its own time and heart rate.',
    )
    expect(lines.flatMap(lintText)).toEqual([])
  })
})

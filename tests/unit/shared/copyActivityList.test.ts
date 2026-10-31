import { describe, expect, test } from 'vitest'
import {
  ACTIVITY_LIST_TEMPLATES,
  ACTIVITY_MORE_ERROR,
  activityCountText,
  activityMoreLabel,
  activitySetsText,
} from '../../../shared/copy/activityList.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'

describe('activityCountText', () => {
  test('names the whole list when every row is on the screen', () => {
    expect(activityCountText(0, 0)).toBe('0 activities')
    expect(activityCountText(1, 1)).toBe('1 activity')
    expect(activityCountText(37, 37)).toBe('37 activities')
  })

  test('says how much of the list is on the screen otherwise, with thousands separators', () => {
    expect(activityCountText(50, 120)).toBe('Showing 50 of 120 activities')
    expect(activityCountText(50, 1284)).toBe('Showing 50 of 1,284 activities')
    expect(activityCountText(1000, 12_345)).toBe('Showing 1,000 of 12,345 activities')
  })

  test('reads a list that shrank under the screen as a whole one', () => {
    expect(activityCountText(150, 140)).toBe('140 activities')
  })
})

describe('activityMoreLabel and the failed-page note', () => {
  test('the button names how many rows it adds', () => {
    expect(activityMoreLabel(50)).toBe('Show 50 more')
    expect(activityMoreLabel(20)).toBe('Show 20 more')
    expect(activityMoreLabel(1)).toBe('Show 1 more')
  })

  test('the note says what failed and what to do', () => {
    expect(ACTIVITY_MORE_ERROR).toBe('More activities did not load. Try again.')
  })
})

describe('activitySetsText', () => {
  test('reads the sets of a strength row, in the singular for one and as "No sets" for none', () => {
    expect(activitySetsText(9)).toBe('9 sets')
    expect(activitySetsText(2)).toBe('2 sets')
    expect(activitySetsText(1)).toBe('1 set')
    expect(activitySetsText(0)).toBe('No sets')
    expect(activitySetsText(120)).toBe('120 sets')
  })

  test('gives nothing for a count the list did not send or cannot be one', () => {
    for (const value of [null, undefined, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(activitySetsText(value), String(value)).toBeNull()
    }
  })
})

describe('the registered templates', () => {
  test('are in the shared registry, so the copy lint renders every one', () => {
    for (const id of Object.keys(ACTIVITY_LIST_TEMPLATES)) {
      expect(TEMPLATES, id).toHaveProperty(id)
    }
  })

  test('every sentence the page can show passes the G5 lint', () => {
    const shown = [
      activityCountText(1, 1),
      activityCountText(12, 12),
      activityCountText(50, 1284),
      activityMoreLabel(50),
      ACTIVITY_MORE_ERROR,
      ...[0, 1, 9].map((n) => activitySetsText(n) ?? ''),
    ]
    for (const text of shown) expect(lintText(text), text).toEqual([])
  })
})

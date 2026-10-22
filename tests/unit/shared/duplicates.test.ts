import { describe, expect, test } from 'vitest'
import {
  DUPLICATE_TOLERANCE_M,
  findPossibleDuplicate,
  pickDuplicate,
} from '../../../shared/domain/duplicates.ts'
import type { Activity } from '../../../shared/types.ts'
import { makeActivity } from '../../factories.ts'

type Row = Pick<Activity, 'id' | 'source'>

describe('findPossibleDuplicate', () => {
  const candidate = makeActivity({ id: 'c', source: 'manual', distanceM: 5000 })

  test('tolerance constant is 80 m', () => {
    expect(DUPLICATE_TOLERANCE_M).toBe(80)
  })

  test('80 m rule: same date, different source, runs only', () => {
    const at80 = makeActivity({ id: 'x80', source: 'smashrun', distanceM: 5080 })
    const at81 = makeActivity({ id: 'x81', source: 'smashrun', distanceM: 5081 })
    expect(findPossibleDuplicate(candidate, [at80])).toBe(at80)
    expect(
      findPossibleDuplicate(candidate, [makeActivity({ source: 'smashrun', distanceM: 4920 })]),
    ).not.toBeNull()
    expect(findPossibleDuplicate(candidate, [at81])).toBeNull()
    expect(
      findPossibleDuplicate(candidate, [makeActivity({ source: 'manual', distanceM: 5000 })]),
    ).toBeNull()
    expect(
      findPossibleDuplicate(candidate, [makeActivity({ source: 'csv', date: '2026-03-03' })]),
    ).toBeNull()
  })

  test('candidate without distance, or of type strength or cross, never matches', () => {
    const other = makeActivity({ source: 'smashrun', distanceM: 5000 })
    expect(findPossibleDuplicate(makeActivity({ distanceM: null }), [other])).toBeNull()
    expect(
      findPossibleDuplicate(makeActivity({ type: 'strength', distanceM: 5000 }), [other]),
    ).toBeNull()
    expect(
      findPossibleDuplicate(makeActivity({ type: 'cross', distanceM: 5000 }), [other]),
    ).toBeNull()
  })

  test('a race candidate can match a run', () => {
    const run = makeActivity({ source: 'smashrun', distanceM: 5000 })
    expect(findPossibleDuplicate(makeActivity({ type: 'race', distanceM: 5000 }), [run])).toBe(run)
  })

  test('non-run rows and rows without distance are ignored', () => {
    expect(
      findPossibleDuplicate(candidate, [
        makeActivity({ source: 'smashrun', type: 'strength', distanceM: 5000 }),
        makeActivity({ source: 'smashrun', distanceM: null }),
      ]),
    ).toBeNull()
  })

  test('possible and confirmed duplicates are ignored; dismissed ones still match', () => {
    const possible = makeActivity({ source: 'smashrun', duplicateStatus: 'possible' })
    const confirmed = makeActivity({ source: 'smashrun', duplicateStatus: 'confirmed' })
    const dismissed = makeActivity({ source: 'smashrun', duplicateStatus: 'dismissed' })
    expect(findPossibleDuplicate(candidate, [possible, confirmed])).toBeNull()
    expect(findPossibleDuplicate(candidate, [possible, confirmed, dismissed])).toBe(dismissed)
  })

  test('several matches give the closest distance; ties keep the first', () => {
    const far = makeActivity({ id: 'far', source: 'smashrun', distanceM: 5060 })
    const near = makeActivity({ id: 'near', source: 'csv', distanceM: 4990 })
    const tie = makeActivity({ id: 'tie', source: 'csv', distanceM: 5010 })
    expect(findPossibleDuplicate(candidate, [far, near])).toBe(near)
    expect(findPossibleDuplicate(candidate, [far, near, tie])).toBe(near)
    expect(findPossibleDuplicate(candidate, [tie, near])).toBe(tie)
  })

  test('the candidate is never its own duplicate', () => {
    expect(findPossibleDuplicate(candidate, [{ ...candidate, source: 'smashrun' }])).toBeNull()
  })
})

describe('pickDuplicate', () => {
  test('manual < csv < smashrun: the lower source is the duplicate', () => {
    const manual: Row = { id: 'm', source: 'manual' }
    const csv: Row = { id: 'c', source: 'csv' }
    const smash: Row = { id: 's', source: 'smashrun' }
    expect(pickDuplicate(manual, csv)).toEqual({ duplicate: manual, original: csv })
    expect(pickDuplicate(smash, manual)).toEqual({ duplicate: manual, original: smash })
    expect(pickDuplicate(csv, smash)).toEqual({ duplicate: csv, original: smash })
    expect(pickDuplicate(smash, csv)).toEqual({ duplicate: csv, original: smash })
  })
})

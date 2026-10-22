import { describe, expect, test } from 'vitest'
import {
  SOURCE_RANK,
  duplicateStatusFor,
  findPossibleDuplicate,
  matchActivities,
  pickDuplicate,
} from '../../../shared/domain/duplicates.ts'
import { makeActivity } from '../../factories.ts'

const T0 = '2026-03-02T07:00:00Z'

function at(secondsAfter: number): string {
  return new Date(Date.parse(T0) + secondsAfter * 1000).toISOString()
}

describe('SOURCE_RANK', () => {
  test('richest sources rank highest', () => {
    expect(SOURCE_RANK).toEqual({
      file: 5,
      garmin: 5,
      intervals: 4,
      'apple-health': 4,
      strava: 3,
      smashrun: 2,
      csv: 1,
      manual: 0,
    })
  })

  test('pickDuplicate demotes strava under a file and a file under nothing', () => {
    const strava = { id: 's', source: 'strava' }
    const file = { id: 'f', source: 'file' }
    expect(pickDuplicate(strava, file)).toEqual({ duplicate: strava, original: file })
    expect(pickDuplicate(file, strava)).toEqual({ duplicate: strava, original: file })
    const other = { id: 'o', source: 'unlisted' }
    expect(pickDuplicate(other, { id: 'c', source: 'csv' }).duplicate.id).toBe('o')
    expect(pickDuplicate({ id: 'm', source: 'manual' }, other).duplicate.id).toBe('m')
  })
})

describe('matchActivities', () => {
  const base = { date: '2026-03-02', startUtc: T0, distanceM: 5000, durationSec: 1800 }

  test('start rule: within 120 s and 5%', () => {
    expect(matchActivities(base, { ...base, startUtc: at(120), distanceM: 5100 })).toBe('start')
    expect(matchActivities(base, { ...base, startUtc: at(-120) })).toBe('start')
  })

  test('121 s apart is no match, even with the same date and distance', () => {
    expect(matchActivities(base, { ...base, startUtc: at(121) })).toBeNull()
  })

  test('distance 5.1% apart is no match', () => {
    expect(matchActivities(base, { ...base, distanceM: 5269 })).toBeNull()
    expect(matchActivities(base, { ...base, distanceM: 5250 })).toBe('start')
  })

  test('both without distance: durations within 5%', () => {
    const a = { ...base, distanceM: null }
    expect(matchActivities(a, { ...a, durationSec: 1850 })).toBe('start')
    expect(matchActivities(a, { ...a, durationSec: 1900 })).toBeNull()
  })

  test('one distance missing is no start match', () => {
    expect(matchActivities(base, { ...base, distanceM: null })).toBeNull()
  })

  test('without a start instant on both sides the same-date 80 m rule applies', () => {
    const noStart = { ...base, startUtc: null }
    expect(matchActivities(noStart, { ...base, distanceM: 5080 })).toBe('date')
    expect(matchActivities(noStart, { ...base, distanceM: 5081 })).toBeNull()
    expect(matchActivities(noStart, { ...base, date: '2026-03-03' })).toBeNull()
    expect(matchActivities(noStart, { ...noStart, distanceM: null })).toBeNull()
  })

  test('a short run within 80 m but over 5% still matches on date only without starts', () => {
    const short = { ...base, startUtc: null, distanceM: 1000 }
    expect(matchActivities(short, { ...short, distanceM: 1070 })).toBe('date')
  })
})

describe('duplicateStatusFor', () => {
  test('confirmed needs a start match between two automated sources', () => {
    expect(duplicateStatusFor('start', { source: 'file' }, { source: 'strava' })).toBe('confirmed')
    expect(duplicateStatusFor('start', { source: 'csv' }, { source: 'strava' })).toBe('confirmed')
    expect(duplicateStatusFor('start', { source: 'manual' }, { source: 'intervals' })).toBe(
      'possible',
    )
    expect(duplicateStatusFor('date', { source: 'file' }, { source: 'strava' })).toBe('possible')
  })
})

describe('findPossibleDuplicate with start instants', () => {
  test('a start match beats a closer same-date match', () => {
    const candidate = makeActivity({ source: 'file', startUtc: T0, distanceM: 5000 })
    const dated = makeActivity({ id: 'dated', source: 'csv', distanceM: 5000 })
    const started = makeActivity({
      id: 'started',
      source: 'strava',
      startUtc: at(30),
      distanceM: 5100,
    })
    expect(findPossibleDuplicate(candidate, [dated, started])).toBe(started)
  })

  test('two starts 121 s apart never match, however close the distance', () => {
    const candidate = makeActivity({ source: 'file', startUtc: T0 })
    const other = makeActivity({ source: 'strava', startUtc: at(121) })
    expect(findPossibleDuplicate(candidate, [other])).toBeNull()
  })

  test('manual (no start) still matches an automated row on date', () => {
    const manual = makeActivity({ source: 'manual', distanceM: 5000 })
    const intervals = makeActivity({ source: 'intervals', startUtc: T0, distanceM: 5040 })
    expect(findPossibleDuplicate(manual, [intervals])).toBe(intervals)
  })

  test('rows without distance can match on start and duration', () => {
    const candidate = makeActivity({ source: 'file', startUtc: T0, distanceM: null })
    const other = makeActivity({ source: 'strava', startUtc: at(10), distanceM: null })
    expect(findPossibleDuplicate(candidate, [other])).toBe(other)
  })
})

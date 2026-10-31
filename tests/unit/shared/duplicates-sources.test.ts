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

describe('matchActivities for strength sessions', () => {
  const strength = {
    type: 'strength',
    date: '2026-03-02',
    startUtc: T0,
    distanceM: null,
    durationSec: 2400,
  }

  test('with a start instant on both sides: within 120 s, whatever the duration', () => {
    expect(matchActivities(strength, { ...strength, startUtc: at(120) })).toBe('start')
    expect(matchActivities(strength, { ...strength, startUtc: at(-120) })).toBe('start')
    expect(matchActivities(strength, { ...strength, startUtc: at(121) })).toBeNull()
    // The same date and the same duration do not make two sessions that started apart one.
    expect(matchActivities(strength, { ...strength, startUtc: at(3600) })).toBeNull()
    expect(matchActivities(strength, { ...strength, startUtc: at(30), durationSec: 3600 })).toBe(
      'start',
    )
  })

  test('without a start instant on both sides: the same date and durations within 5%', () => {
    const manual = { ...strength, startUtc: null }
    expect(matchActivities(manual, { ...strength, durationSec: 2400 })).toBe('date')
    expect(matchActivities(manual, { ...strength, durationSec: 2526 })).toBe('date')
    expect(matchActivities(manual, { ...strength, durationSec: 2527 })).toBeNull()
    expect(matchActivities(manual, { ...strength, durationSec: 2280 })).toBe('date')
    expect(matchActivities(manual, { ...strength, durationSec: 2279 })).toBeNull()
    expect(matchActivities(manual, { ...manual, durationSec: 2400 })).toBe('date')
    expect(matchActivities(manual, { ...strength, date: '2026-03-03' })).toBeNull()
  })

  test('a distance on a row changes nothing: strength is compared without one', () => {
    const manual = { ...strength, startUtc: null }
    expect(matchActivities(manual, { ...strength, distanceM: 5000 })).toBe('date')
    expect(matchActivities({ ...manual, distanceM: 1000 }, { ...strength, distanceM: 9000 })).toBe(
      'date',
    )
  })

  test('a strength session never matches a run or a race, in either order', () => {
    const run = {
      type: 'run',
      date: '2026-03-02',
      startUtc: T0,
      distanceM: 5000,
      durationSec: 2400,
    }
    expect(matchActivities(strength, run)).toBeNull()
    expect(matchActivities(run, strength)).toBeNull()
    expect(matchActivities({ ...strength, startUtc: null }, { ...run, type: 'race' })).toBeNull()
  })

  test('a pair without a type is compared as runs, as it always was', () => {
    const base = { date: '2026-03-02', startUtc: T0, distanceM: 5000, durationSec: 1800 }
    expect(matchActivities(base, { ...base, startUtc: at(30) })).toBe('start')
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

describe('findPossibleDuplicate within one source', () => {
  test('an Apple Health export row and a push row with the same start match', () => {
    const exported = makeActivity({
      id: 'export',
      source: 'apple-health',
      providerKey: `apple:export:${T0}`,
      startUtc: T0,
      distanceM: 5000,
    })
    const pushed = makeActivity({
      id: 'push',
      source: 'apple-health',
      providerKey: 'apple:6f1c',
      startUtc: at(20),
      distanceM: 5010,
    })
    expect(findPossibleDuplicate(pushed, [exported])).toBe(exported)
    expect(duplicateStatusFor('start', pushed, exported)).toBe('confirmed')
    expect(pickDuplicate(pushed, exported).duplicate).toBe(pushed)
  })

  test('a FIT and a GPX file of the same run match', () => {
    const fit = makeActivity({
      id: 'fit',
      source: 'file',
      providerKey: 'fit:1234-abcd',
      startUtc: T0,
      distanceM: 8000,
    })
    const gpx = makeActivity({
      id: 'gpx',
      source: 'file',
      providerKey: 'sha:0123456789abcdef',
      startUtc: at(3),
      distanceM: 7990,
    })
    expect(findPossibleDuplicate(gpx, [fit])).toBe(fit)
  })

  test('two runs of one source that start apart are two runs', () => {
    const morning = makeActivity({ id: 'am', source: 'file', startUtc: T0, distanceM: 5000 })
    const evening = makeActivity({
      id: 'pm',
      source: 'file',
      startUtc: at(10 * 3600),
      distanceM: 5000,
    })
    expect(findPossibleDuplicate(evening, [morning])).toBeNull()
  })

  test('same-source runs without a start instant on one day are not matched on date alone', () => {
    const a = makeActivity({ id: 'a', source: 'csv', distanceM: 5000 })
    const b = makeActivity({ id: 'b', source: 'csv', distanceM: 5010 })
    expect(findPossibleDuplicate(b, [a])).toBeNull()
  })
})

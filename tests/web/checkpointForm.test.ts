// How the checkpoint editor reads what the runner typed (rule H14, ADR 0018). Names are synthetic.
import { describe, expect, test } from 'vitest'
import {
  blankDraft,
  draftFrom,
  elapsedText,
  parseDrafts,
  parseElapsed,
  type DraftContext,
  type PointDraft,
} from '../../web/components/race/checkpointForm.ts'

const HOUR = 3600
const KM: DraftContext = { units: 'km', courseM: 160_934, startMin: 6 * 60 }

function draft(over: Partial<PointDraft> = {}): PointDraft {
  return { ...blankDraft('k'), name: 'Checkpoint A', distance: '42.5', ...over }
}

describe('parseElapsed', () => {
  test('reads hours and minutes, up to the 400-hour limit', () => {
    expect(parseElapsed('9:30')).toBe(9.5 * HOUR)
    expect(parseElapsed(' 0:05 ')).toBe(300)
    expect(parseElapsed('400:00')).toBe(400 * HOUR)
    expect(parseElapsed('400:01')).toBeNull()
  })

  test.each(['9', '9:5', '9:60', '9h30', '', '-1:00', '9:30:00'])('refuses %j', (text) => {
    expect(parseElapsed(text)).toBeNull()
  })

  test('writes the same shape back', () => {
    expect(elapsedText(9.5 * HOUR)).toBe('9:30')
    expect(elapsedText(65 * 60)).toBe('1:05')
  })
})

describe('parseDrafts', () => {
  test('reads a point in the runner’s units and sends metres', () => {
    const km = parseDrafts([draft({ gain: '800', loss: '', cutoff: '9:30' })], KM)
    expect(km.ok).toBe(true)
    expect(km.rows.map((r) => r.row)).toEqual([
      { name: 'Checkpoint A', distanceM: 42_500, gainM: 800, lossM: null, cutoffSec: 9.5 * HOUR },
    ])
    const mi = parseDrafts([draft()], { ...KM, units: 'mi' })
    expect(mi.rows[0]?.row.distanceM).toBe(Math.round(42.5 * 1609.344))
  })

  test('sorts the rows by distance and remembers the draft each came from', () => {
    const parsed = parseDrafts(
      [
        draft({ key: 'a', name: 'Checkpoint B', distance: '80' }),
        draft({ key: 'b', name: 'Checkpoint A', distance: '20' }),
      ],
      KM,
    )
    expect(parsed.rows.map((r) => [r.row.name, r.draftIndex])).toEqual([
      ['Checkpoint A', 1],
      ['Checkpoint B', 0],
    ])
  })

  test('names the field of each problem and sends nothing', () => {
    const parsed = parseDrafts(
      [
        draft({ name: '  ', distance: 'far', gain: '20001', loss: '1.5', cutoff: '9:99' }),
        draft({ distance: '200' }),
        draft({ distance: '0' }),
      ],
      KM,
    )
    expect(parsed.ok).toBe(false)
    expect(parsed.rows).toEqual([])
    expect(parsed.errors[0]).toEqual({
      name: 'name',
      distance: 'distance',
      gain: 'metres',
      loss: 'metres',
      cutoff: 'cutoff',
    })
    expect(parsed.errors[1]).toEqual({ distance: 'distance' })
    expect(parsed.errors[2]).toEqual({ distance: 'distance' })
  })

  test('refuses a name past 60 characters and two points at one distance', () => {
    const long = parseDrafts([draft({ name: 'x'.repeat(61) })], KM)
    expect(long.errors[0]).toEqual({ name: 'name' })
    const twice = parseDrafts([draft({ key: 'a' }), draft({ key: 'b', name: 'Checkpoint B' })], KM)
    expect(twice.errors).toEqual([{}, { distance: 'duplicate' }])
  })

  test('reads a clock cutoff against the start time and the day', () => {
    const sameDay = parseDrafts([draft({ cutoffMode: 'clock', cutoff: '14:30' })], KM)
    expect(sameDay.rows[0]?.row.cutoffSec).toBe(8.5 * HOUR)
    const nextDay = parseDrafts([draft({ cutoffMode: 'clock', cutoff: '03:30', cutoffDay: 1 })], KM)
    expect(nextDay.rows[0]?.row.cutoffSec).toBe(21.5 * HOUR)
  })

  test('refuses a clock cutoff before the start, one with no start time, and a malformed one', () => {
    const before = parseDrafts([draft({ cutoffMode: 'clock', cutoff: '05:00' })], KM)
    expect(before.errors[0]).toEqual({ cutoff: 'clock' })
    const none = parseDrafts([draft({ cutoffMode: 'clock', cutoff: '14:30' })], {
      ...KM,
      startMin: null,
    })
    expect(none.errors[0]).toEqual({ cutoff: 'clock' })
    const junk = parseDrafts([draft({ cutoffMode: 'clock', cutoff: '25:00' })], KM)
    expect(junk.errors[0]).toEqual({ cutoff: 'clock' })
  })

  test('leaves untouched text at its stored value, so a save does not drift a rounded distance', () => {
    const saved = {
      name: 'Checkpoint A',
      distanceM: 42_123,
      gainM: 800,
      lossM: null,
      cutoffSec: 9 * HOUR + 30,
    }
    const same = draftFrom(saved, 'k', 'km')
    expect(same.distance).toBe('42.12')
    expect(parseDrafts([same], KM).rows[0]?.row).toEqual(saved)
    const edited = parseDrafts([{ ...same, distance: '42.2' }], KM)
    expect(edited.rows[0]?.row.distanceM).toBe(42_200)
    const recut = parseDrafts([{ ...same, cutoff: '10:00' }], KM)
    expect(recut.rows[0]?.row.cutoffSec).toBe(10 * HOUR)
  })

  test('a blank draft has no optional field', () => {
    const parsed = parseDrafts([draft()], KM)
    expect(parsed.rows[0]?.row).toMatchObject({ gainM: null, lossM: null, cutoffSec: null })
  })
})

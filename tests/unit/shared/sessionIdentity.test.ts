import { describe, expect, it } from 'vitest'
import {
  carryExternalIds,
  pairSessions,
  workoutExternalId,
  type SessionSlot,
} from '../../../shared/domain/sessionIdentity.ts'

interface Labelled extends SessionSlot {
  label: string
}

const s = (label: string, date: string, kind: string, order = 0): Labelled => ({
  label,
  date,
  kind,
  order,
})
const labels = (items: Labelled[]) => items.map((item) => item.label)
const pairsOf = (before: Labelled[], after: Labelled[]) =>
  pairSessions(before, after).paired.map((p) => `${p.before.label}>${p.after.label}`)

describe('pairSessions', () => {
  it('pairs sessions of the same date and kind', () => {
    const before = [s('b-easy', '2026-10-26', 'easy'), s('b-long', '2026-10-31', 'long')]
    const after = [s('a-long', '2026-10-31', 'long'), s('a-easy', '2026-10-26', 'easy')]
    const result = pairSessions(before, after)
    expect(result.paired.map((p) => [p.before.label, p.after.label])).toEqual([
      ['b-easy', 'a-easy'],
      ['b-long', 'a-long'],
    ])
    expect(result.removed).toEqual([])
    expect(result.added).toEqual([])
  })

  it('reports the positions of a pair in the lists it was given', () => {
    const before = [s('b1', '2026-10-27', 'easy'), s('b2', '2026-10-26', 'easy')]
    const after = [s('a1', '2026-10-26', 'easy'), s('a2', '2026-10-27', 'easy')]
    const result = pairSessions(before, after)
    expect(result.paired.map((p) => [p.beforeIndex, p.afterIndex])).toEqual([
      [1, 0],
      [0, 1],
    ])
  })

  it('treats a change of kind as a removal plus an addition', () => {
    const result = pairSessions(
      [s('easy-tue', '2026-10-27', 'easy')],
      [s('threshold-tue', '2026-10-27', 'threshold')],
    )
    expect(result.paired).toEqual([])
    expect(labels(result.removed)).toEqual(['easy-tue'])
    expect(labels(result.added)).toEqual(['threshold-tue'])
  })

  it('treats a change of date as a removal plus an addition', () => {
    const result = pairSessions(
      [s('easy-tue', '2026-10-27', 'easy')],
      [s('easy-wed', '2026-10-28', 'easy')],
    )
    expect(result.paired).toEqual([])
    expect(labels(result.removed)).toEqual(['easy-tue'])
    expect(labels(result.added)).toEqual(['easy-wed'])
  })

  it('pairs two sessions of one kind on a day by occurrence', () => {
    const before = [s('b0', '2026-10-27', 'strength', 0), s('b1', '2026-10-27', 'strength', 1)]
    const after = [s('a0', '2026-10-27', 'strength', 0), s('a1', '2026-10-27', 'strength', 1)]
    expect(pairsOf(before, after)).toEqual(['b0>a0', 'b1>a1'])
  })

  it('orders each group by order, not by the position in the list', () => {
    const before = [
      s('b-late', '2026-10-27', 'strength', 3),
      s('b-early', '2026-10-27', 'strength', 1),
    ]
    const after = [
      s('a-early', '2026-10-27', 'strength', 1),
      s('a-late', '2026-10-27', 'strength', 3),
    ]
    expect(pairsOf(before, after)).toEqual(['b-early>a-early', 'b-late>a-late'])
  })

  it('breaks a tie of order by the position in the list', () => {
    const before = [s('b0', '2026-10-27', 'mobility', 2), s('b1', '2026-10-27', 'mobility', 2)]
    const after = [s('a0', '2026-10-27', 'mobility', 2), s('a1', '2026-10-27', 'mobility', 2)]
    expect(pairsOf(before, after)).toEqual(['b0>a0', 'b1>a1'])
  })

  it('removes the surplus of a group when the after list has fewer of a kind', () => {
    const before = [s('b0', '2026-10-27', 'strength', 0), s('b1', '2026-10-27', 'strength', 1)]
    const after = [s('a0', '2026-10-27', 'strength', 0)]
    const result = pairSessions(before, after)
    expect(pairsOf(before, after)).toEqual(['b0>a0'])
    expect(labels(result.removed)).toEqual(['b1'])
    expect(result.added).toEqual([])
  })

  it('adds the surplus of a group when the after list has more of a kind', () => {
    const before = [s('b0', '2026-10-27', 'strength', 0)]
    const after = [s('a0', '2026-10-27', 'strength', 0), s('a1', '2026-10-27', 'strength', 1)]
    const result = pairSessions(before, after)
    expect(pairsOf(before, after)).toEqual(['b0>a0'])
    expect(result.removed).toEqual([])
    expect(labels(result.added)).toEqual(['a1'])
  })

  it('does not re-pair a session when a strength session is added to its day', () => {
    // The strength session takes order 0 and pushes the run to order 1: the run keeps its pair.
    const before = [s('b-easy', '2026-10-27', 'easy', 0)]
    const after = [
      s('a-strength', '2026-10-27', 'strength', 0),
      s('a-easy', '2026-10-27', 'easy', 1),
    ]
    const result = pairSessions(before, after)
    expect(pairsOf(before, after)).toEqual(['b-easy>a-easy'])
    expect(result.removed).toEqual([])
    expect(labels(result.added)).toEqual(['a-strength'])
  })

  it('does not pair a new strength session with the strength session of another day', () => {
    const before = [s('b-strength', '2026-10-27', 'strength', 1)]
    const after = [s('a-strength', '2026-10-29', 'strength', 1)]
    const result = pairSessions(before, after)
    expect(result.paired).toEqual([])
    expect(labels(result.removed)).toEqual(['b-strength'])
    expect(labels(result.added)).toEqual(['a-strength'])
  })

  it('gives the same pairs for any order of the input lists', () => {
    const before = [
      s('b-mon', '2026-10-26', 'easy', 0),
      s('b-tue-1', '2026-10-27', 'strength', 1),
      s('b-tue-2', '2026-10-27', 'strength', 2),
      s('b-tue-run', '2026-10-27', 'threshold', 0),
      s('b-sat', '2026-10-31', 'long', 0),
    ]
    const after = [
      s('a-mon', '2026-10-26', 'easy', 0),
      s('a-tue-1', '2026-10-27', 'strength', 1),
      s('a-tue-run', '2026-10-27', 'intervals', 0),
      s('a-sun', '2026-11-01', 'long', 0),
    ]
    const expected = pairSessions(before, after)
    const reversed = pairSessions([...before].reverse(), [...after].reverse())
    const shuffled = pairSessions(
      [before[3]!, before[0]!, before[4]!, before[2]!, before[1]!],
      [after[2]!, after[3]!, after[1]!, after[0]!],
    )
    const names = (r: typeof expected) => r.paired.map((p) => `${p.before.label}>${p.after.label}`)
    for (const other of [reversed, shuffled]) {
      expect(names(other)).toEqual(names(expected))
      expect(labels(other.removed)).toEqual(labels(expected.removed))
      expect(labels(other.added)).toEqual(labels(expected.added))
    }
    expect(names(expected)).toEqual(['b-mon>a-mon', 'b-tue-1>a-tue-1'])
    expect(labels(expected.removed)).toEqual(['b-tue-2', 'b-tue-run', 'b-sat'])
    expect(labels(expected.added)).toEqual(['a-tue-run', 'a-sun'])
  })

  it('uses every session exactly once', () => {
    const before = [
      s('b1', '2026-10-26', 'easy'),
      s('b2', '2026-10-26', 'strength'),
      s('b3', '2026-10-27', 'easy'),
      s('b4', '2026-10-27', 'easy', 1),
      s('b5', '2026-10-29', 'long'),
    ]
    const after = [
      s('a1', '2026-10-26', 'easy'),
      s('a2', '2026-10-27', 'easy'),
      s('a3', '2026-10-28', 'easy'),
      s('a4', '2026-10-29', 'long'),
      s('a5', '2026-10-29', 'long', 1),
    ]
    const result = pairSessions(before, after)
    const usedBefore = [...result.paired.map((p) => p.before.label), ...labels(result.removed)]
    const usedAfter = [...result.paired.map((p) => p.after.label), ...labels(result.added)]
    expect(usedBefore.sort()).toEqual(labels(before).sort())
    expect(usedAfter.sort()).toEqual(labels(after).sort())
  })

  it('pairs nothing when a list is empty', () => {
    const some = [s('x', '2026-10-26', 'easy')]
    expect(pairSessions([], some)).toEqual({ paired: [], removed: [], added: some })
    expect(pairSessions(some, [])).toEqual({ paired: [], removed: some, added: [] })
    expect(pairSessions([], [])).toEqual({ paired: [], removed: [], added: [] })
  })

  it('does not change the lists it is given', () => {
    const before = [s('b1', '2026-10-27', 'easy', 2), s('b2', '2026-10-27', 'easy', 1)]
    const after = [s('a1', '2026-10-27', 'easy', 2), s('a2', '2026-10-27', 'easy', 1)]
    pairSessions(before, after)
    expect(labels(before)).toEqual(['b1', 'b2'])
    expect(labels(after)).toEqual(['a1', 'a2'])
  })
})

describe('carryExternalIds', () => {
  const previous = [
    { externalId: 'ext-easy-mon', date: '2026-10-26', kind: 'easy', order: 0 },
    { externalId: 'ext-strength-tue', date: '2026-10-27', kind: 'strength', order: 1 },
    { externalId: 'ext-easy-wed', date: '2026-10-28', kind: 'easy', order: 0 },
    { externalId: 'ext-long-sat', date: '2026-10-31', kind: 'long', order: 0 },
  ]

  it('gives each session the id of its pair and null to a session without one', () => {
    const next = [
      { date: '2026-10-31', kind: 'long', order: 0 },
      { date: '2026-10-26', kind: 'easy', order: 0 },
      { date: '2026-10-28', kind: 'threshold', order: 0 },
      { date: '2026-11-01', kind: 'long', order: 0 },
    ]
    expect(carryExternalIds(previous, next)).toEqual(['ext-long-sat', 'ext-easy-mon', null, null])
  })

  it('keeps the id of a run when a strength session is added to its day', () => {
    const next = [
      { date: '2026-10-28', kind: 'strength', order: 0 },
      { date: '2026-10-28', kind: 'easy', order: 1 },
    ]
    expect(carryExternalIds(previous, next)).toEqual([null, 'ext-easy-wed'])
  })

  it('uses every previous id at most once', () => {
    const next = [
      { date: '2026-10-26', kind: 'easy', order: 0 },
      { date: '2026-10-26', kind: 'easy', order: 1 },
      { date: '2026-10-26', kind: 'easy', order: 2 },
    ]
    const carried = carryExternalIds(previous, next)
    expect(carried).toEqual(['ext-easy-mon', null, null])
    const used = carried.filter((id): id is string => id !== null)
    expect(new Set(used).size).toBe(used.length)
  })

  it('carries nothing without previous sessions and returns one entry per next session', () => {
    const next = [{ date: '2026-10-26', kind: 'easy', order: 0 }]
    expect(carryExternalIds([], next)).toEqual([null])
    expect(carryExternalIds(previous, [])).toEqual([])
  })

  it('does not depend on the order of the lists', () => {
    const next = [
      { date: '2026-10-26', kind: 'easy', order: 0 },
      { date: '2026-10-31', kind: 'long', order: 0 },
    ]
    const forward = carryExternalIds(previous, next)
    const backward = carryExternalIds([...previous].reverse(), [...next].reverse())
    expect(forward).toEqual(['ext-easy-mon', 'ext-long-sat'])
    expect(backward).toEqual(['ext-long-sat', 'ext-easy-mon'])
  })
})

describe('workoutExternalId', () => {
  it('is rl-<userTag>-<externalId>', () => {
    expect(workoutExternalId('3f2b8c1e-0000-4000-8000-123456789abc', 'a1b2c3')).toBe(
      'rl-a1b2c3-3f2b8c1e-0000-4000-8000-123456789abc',
    )
  })

  it('separates users that share an externalId', () => {
    expect(workoutExternalId('same', 'aaaaaa')).not.toBe(workoutExternalId('same', 'bbbbbb'))
  })
})

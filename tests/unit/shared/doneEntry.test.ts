import { describe, expect, test } from 'vitest'
import { doneEntryFor } from '../../../shared/domain/doneEntry.ts'
import { compatible } from '../../../shared/engine/execution.ts'
import { SESSION_KINDS } from '../engine/fixtures.ts'

describe('doneEntryFor', () => {
  test.each([
    ['easy', { type: 'run' }],
    ['recovery', { type: 'run' }],
    ['long', { type: 'run' }],
    ['long-fast-finish', { type: 'run' }],
    ['threshold', { type: 'run' }],
    ['intervals', { type: 'run' }],
    ['race-pace', { type: 'run' }],
    ['strides', { type: 'run' }],
    ['hills', { type: 'run' }],
    ['b2b', { type: 'run' }],
    ['race', { type: 'race' }],
    ['strength', { type: 'strength' }],
    ['hike', { type: 'cross', subtype: 'hike' }],
    ['mobility', { type: 'cross' }],
    ['cross', { type: 'cross' }],
  ] as const)('a %s session is logged as %j', (kind, entry) => {
    expect(doneEntryFor(kind)).toEqual(entry)
  })

  // Done offers itself on every session that is not a rest day. The server links the entry it
  // posts by the matcher's own rule, so each kind's entry must be one that rule accepts.
  test.each(SESSION_KINDS.filter((kind) => kind !== 'rest'))(
    'the entry logged for a %s session is one the matcher links to it',
    (kind) => {
      const entry = doneEntryFor(kind)
      expect(compatible(kind, { type: entry.type, subtype: entry.subtype ?? null })).toBe(true)
    },
  )

  test('a cross-training entry with no sub-type fulfils no hike session', () => {
    expect(compatible('hike', { type: 'cross', subtype: null })).toBe(false)
    expect(compatible('hike', { type: 'cross', subtype: 'hike' })).toBe(true)
    expect(compatible('hike', { type: 'cross', subtype: 'walk' })).toBe(true)
    expect(compatible('hike', { type: 'cross', subtype: 'bike' })).toBe(false)
  })
})

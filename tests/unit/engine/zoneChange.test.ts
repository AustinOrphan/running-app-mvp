import { describe, expect, it } from 'vitest'
import type { PlanChange } from '../../../shared/engine/types.ts'
import {
  ZONE_CHANGE_MARK,
  zoneChangeField,
  zoneChangeOf,
  zoneDecisionsOf,
} from '../../../shared/engine/zoneChange.ts'

const change = (field: string, from: unknown, to: unknown): PlanChange => ({
  weekStart: '2026-10-19',
  field,
  from,
  to,
  rules: ['C8'],
})

describe('zone change fields', () => {
  it('names an accepted and a declined proposal of a boundary', () => {
    expect(zoneChangeField('thresholdPace', 'accepted')).toBe('zones.thresholdPace')
    expect(zoneChangeField('thresholdPace', 'declined')).toBe('zones.thresholdPace.declined')
  })

  it('reads back the boundary and the outcome, and nothing else', () => {
    for (const boundary of ['cs', 'lt1Pace', 'thresholdPace', 'lt1Hr', 'hrMax'] as const) {
      for (const outcome of ['accepted', 'declined'] as const) {
        expect(zoneChangeOf(zoneChangeField(boundary, outcome))).toEqual({ boundary, outcome })
      }
    }
    for (const field of [
      'targetRunMin',
      'session.status',
      'zones.',
      'zones.unknown',
      'zones.declined',
      'zones.hrMax.accepted',
      'zones.hrMax.declined.declined',
      'xzones.hrMax',
    ]) {
      expect(zoneChangeOf(field), field).toBeNull()
    }
  })

  it('finds every zone change in the JSON a revision stores, and no other change', () => {
    const changes = [
      change('targetRunMin', 300, 280),
      change('zones.thresholdPace', 300, 294),
      change('zones.hrMax.declined', 185, 188),
    ]
    const json = JSON.stringify(changes)
    expect(json).toContain(ZONE_CHANGE_MARK)
    expect(JSON.stringify([change('targetRunMin', 300, 280)])).not.toContain(ZONE_CHANGE_MARK)
    expect(zoneDecisionsOf(json)).toEqual([
      { boundary: 'thresholdPace', outcome: 'accepted', change: changes[1] },
      { boundary: 'hrMax', outcome: 'declined', change: changes[2] },
    ])
    expect(zoneDecisionsOf('[]')).toEqual([])
  })
})

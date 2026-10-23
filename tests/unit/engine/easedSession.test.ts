import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { P } from '../../../shared/engine/params/index.ts'
import { easedSession } from '../../../shared/engine/readiness.ts'
import type { PlanSessionStatus } from '../../../shared/types.ts'
import type { SessionKind, SessionSpec } from '../../../shared/engine/types.ts'
import { prescribed, SESSION_KINDS, zoneSetFixture } from './fixtures.ts'

const zones = zoneSetFixture()

/** Kinds a readiness flag can turn into an easy day [rules J3]. */
const EASED_KINDS: SessionKind[] = [
  'threshold',
  'intervals',
  'hills',
  'race-pace',
  'long-fast-finish',
  'long',
  'b2b',
  'strides',
]
/** Kinds the downgrade leaves alone: already easy, not running, or the race itself. */
const UNCHANGED_KINDS: SessionKind[] = [
  'easy',
  'recovery',
  'strength',
  'mobility',
  'rest',
  'cross',
  'hike',
  'race',
]

const totalSec = (s: SessionSpec) =>
  s.structure.reduce((sum, step) => sum + (step.durationSec ?? 0) * step.reps, 0)

describe('easedSession (rules J3)', () => {
  it('classifies every session kind', () => {
    expect([...EASED_KINDS, ...UNCHANGED_KINDS].sort()).toEqual([...SESSION_KINDS].sort())
  })

  it.each(EASED_KINDS)(
    'turns a %s session into one steady Z1 easy run of the same minutes',
    (kind) => {
      const planned = prescribed(kind)
      const eased = easedSession(planned, zones)
      expect(eased.kind).toBe('easy')
      expect(eased.title).toBe('Easy run')
      expect(eased.durationMin).toBe(planned.durationMin)
      expect(eased.distanceM).toBeNull()
      expect(eased.structure).toEqual([
        {
          kind: 'steady',
          reps: 1,
          durationSec: planned.durationMin * 60,
          distanceM: null,
          zone: 'z1',
        },
      ])
      expect(totalSec(eased)).toBe(planned.durationMin * 60)
      expect(eased.date).toBe(planned.date)
      expect(eased.order).toBe(planned.order)
    },
  )

  it('states why in the purpose, naming the planned session', () => {
    const eased = easedSession(prescribed('threshold'), zones)
    expect(eased.purpose).toBe(
      'Eased from Threshold run: readiness signals have stayed lower than usual, so an easy run keeps the day.',
    )
    expect(easedSession(prescribed('intervals'), zones).purpose).toMatch(/^Eased from Intervals:/)
  })

  it('takes the Z1 targets from the current zones and the easy RPE from the registry', () => {
    const eased = easedSession(prescribed('intervals'), zones)
    expect(eased.target.zone).toBe('z1')
    expect(eased.target.hr).toEqual([120, 140])
    expect(eased.target.paceSecPerKm).toEqual([390, 340])
    expect(eased.target.rpe).toEqual(P.expectedRpe.easy.value)
    const moved = easedSession(
      prescribed('intervals'),
      zoneSetFixture({ hr: { z1: [118, 146], z2: [146, 160], z3: [160, 172] } }),
    )
    expect(moved.target.hr).toEqual([118, 146])
  })

  it('has no heart rate or pace target without zones for them', () => {
    const none = easedSession(prescribed('threshold'), zoneSetFixture({ hr: null, pace: null }))
    expect(none.target.hr).toBeNull()
    expect(none.target.paceSecPerKm).toBeNull()
    const noZones = easedSession(prescribed('threshold'), null)
    expect(noZones.target.hr).toBeNull()
    expect(noZones.target.paceSecPerKm).toBeNull()
    expect(noZones.target.zone).toBe('z1')
  })

  it('adds J3 once to the rules and keeps the others', () => {
    const planned = prescribed('threshold')
    const eased = easedSession(planned, zones)
    expect(eased.rules).toEqual([...planned.rules, 'J3'])
    const again = easedSession({ ...planned, rules: [...planned.rules, 'J3'] }, zones)
    expect(again.rules.filter((r) => r === 'J3')).toHaveLength(1)
  })

  it('drops every flag except heat, and keeps the heat note with it', () => {
    const planned = prescribed('long-fast-finish', zones, {
      flags: ['spike-warn', 'heat', 'night', 'fuel-practice', 'downhill'],
      target: { ...prescribed('long-fast-finish').target, heatNote: 'Run this one easy.' },
    })
    const eased = easedSession(planned, zones)
    expect(eased.flags).toEqual(['heat'])
    expect(eased.target.heatNote).toBe('Run this one easy.')
    expect(easedSession(prescribed('threshold', zones, { flags: ['night'] }), zones).flags).toEqual(
      [],
    )
  })

  it('keeps the id and the status, and every other field of the input type', () => {
    type Row = SessionSpec & { id: string; status: PlanSessionStatus; activityId: string | null }
    const row: Row = {
      ...prescribed('threshold'),
      id: 'session-1',
      status: 'moved',
      activityId: 'activity-1',
    }
    const eased: Row = easedSession(row, zones)
    expect(eased.id).toBe('session-1')
    expect(eased.status).toBe('moved')
    expect(eased.activityId).toBe('activity-1')
  })

  it.each(UNCHANGED_KINDS)('returns a %s session unchanged', (kind) => {
    const planned = prescribed(kind)
    expect(easedSession(planned, zones)).toBe(planned)
  })

  it('is idempotent: an eased session is an easy run, which stays as it is', () => {
    const once = easedSession(prescribed('intervals'), zones)
    expect(easedSession(once, zones)).toBe(once)
  })

  it('does not change its input', () => {
    const planned = prescribed('threshold')
    const before = structuredClone(planned)
    easedSession(planned, zones)
    expect(planned).toEqual(before)
  })

  it('is deterministic', () => {
    const planned = prescribed('hills')
    expect(easedSession(planned, zones)).toEqual(easedSession(planned, zones))
  })
})

/** Every source file under the folders the app ships, for a search by text. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('one eased session', () => {
  it('is defined once in the shipped code', () => {
    const root = join(import.meta.dirname, '../../..')
    const definitions = ['shared', 'server', 'web']
      .flatMap((dir) => sources(join(root, dir)))
      .filter((file) => /\b(function|const)\s+easedSession\b/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(root.length + 1))
    expect(definitions).toEqual(['shared/engine/readiness.ts'])
  })
})

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { P } from '../../../shared/engine/params/index.ts'
import { easedSession } from '../../../shared/engine/readiness.ts'
import { climbNote, resolveTargets } from '../../../shared/engine/targets.ts'
import type { SessionSpec } from '../../../shared/engine/types.ts'
import { prescribed, zoneSetFixture } from './fixtures.ts'

const zones = zoneSetFixture()
const cold = { hot: false }
const hot = { hot: true }

/** A stored target that names another zone, for the rules that apply to Z2 and Z3 sessions. */
function inZone(zone: 'z1' | 'z2' | 'z3', over: Partial<SessionSpec['target']> = {}): SessionSpec {
  const base = prescribed('long')
  return { ...base, target: { ...base.target, zone, ...over } }
}

describe('resolveTargets: heart-rate sessions', () => {
  it('gives an easy run the ceiling at the top of the current Z1', () => {
    const t = resolveTargets(prescribed('easy'), zones, cold)
    expect(t).toEqual({
      zone: 'z1',
      mode: 'hr-ceiling',
      hrCeiling: 140,
      hrRange: null,
      paceSecPerKm: [390, 340],
      rpe: P.expectedRpe.easy.value,
      hot: false,
      hotNote: null,
      zonesNote: null,
      source: 'zones',
    })
  })

  it.each(['recovery', 'long', 'long-fast-finish', 'b2b'] as const)(
    'gives a %s run the Z1 ceiling',
    (kind) => {
      const t = resolveTargets(prescribed(kind), zones, cold)
      expect(t.mode).toBe('hr-ceiling')
      expect(t.hrCeiling).toBe(140)
      expect(t.hrRange).toBeNull()
    },
  )

  it('lets the current zones beat the stored target, and says so', () => {
    const planned = prescribed(
      'easy',
      zoneSetFixture({ hr: { z1: [110, 132], z2: [132, 150], z3: [150, 168] } }),
    )
    expect(planned.target.hr).toEqual([110, 132])
    const t = resolveTargets(planned, zones, cold)
    expect(t.hrCeiling).toBe(140)
    expect(t.source).toBe('zones')
    expect(t.zonesNote).toMatch(/zones/)
    expect(t.zonesNote).not.toMatch(/behind|missed|red\b/i)
  })

  it('has no zones note when the zones are the ones the session was planned with', () => {
    expect(resolveTargets(prescribed('easy'), zones, cold).zonesNote).toBeNull()
    expect(resolveTargets(prescribed('threshold'), zones, cold).zonesNote).toBeNull()
  })

  it('gives a Z2 or Z3 session a band from the current zones', () => {
    const z2 = resolveTargets(inZone('z2', { hr: [140, 155] }), zones, cold)
    expect(z2).toMatchObject({ zone: 'z2', mode: 'hr-band', hrCeiling: null, hrRange: [140, 155] })
    const z3 = resolveTargets(inZone('z3', { hr: [155, 170] }), zones, cold)
    expect(z3).toMatchObject({ zone: 'z3', mode: 'hr-band', hrCeiling: null, hrRange: [155, 170] })
    const moved = zoneSetFixture({ hr: { z1: [120, 140], z2: [142, 158], z3: [158, 172] } })
    expect(resolveTargets(inZone('z2', { hr: [140, 155] }), moved, cold).hrRange).toEqual([
      142, 158,
    ])
  })

  it('falls back to the stored heart rate when the zones have none', () => {
    const bare = zoneSetFixture({ hr: null, pace: null })
    const t = resolveTargets(prescribed('easy'), bare, cold)
    expect(t).toMatchObject({ mode: 'hr-ceiling', hrCeiling: 140, source: 'plan' })
    const noZones = resolveTargets(prescribed('easy'), null, cold)
    expect(noZones).toMatchObject({ mode: 'hr-ceiling', hrCeiling: 140, source: 'plan' })
  })

  it('leads with pace, then effort, when no heart rate is known', () => {
    const noHr = zoneSetFixture({ hr: null })
    const planned = prescribed('easy', noHr)
    expect(resolveTargets(planned, noHr, cold)).toMatchObject({
      mode: 'pace',
      hrCeiling: null,
      paceSecPerKm: [390, 340],
    })
    const bare = zoneSetFixture({ hr: null, pace: null })
    const effort = resolveTargets(prescribed('easy', bare), bare, cold)
    expect(effort).toMatchObject({ mode: 'effort', hrCeiling: null, paceSecPerKm: null })
    expect(effort.rpe).toEqual(P.expectedRpe.easy.value)
  })

  it('resolves an eased session as an easy run on the current Z1', () => {
    const eased = easedSession(prescribed('intervals'), zones)
    expect(resolveTargets(eased, zones, cold)).toMatchObject({
      zone: 'z1',
      mode: 'hr-ceiling',
      hrCeiling: 140,
      rpe: P.expectedRpe.easy.value,
    })
  })
})

describe('resolveTargets: work paced by the stored band', () => {
  it.each(['threshold', 'intervals', 'race-pace', 'race'] as const)(
    'keeps the stored pace band of a %s session',
    (kind) => {
      const planned = prescribed(kind)
      expect(planned.target.paceSecPerKm).not.toBeNull()
      const t = resolveTargets(planned, zones, cold)
      expect(t.mode).toBe('pace')
      expect(t.paceSecPerKm).toEqual(planned.target.paceSecPerKm)
      // only a threshold session also reads the current Z2 band, as secondary text
      expect(t.source).toBe(kind === 'threshold' ? 'zones' : 'plan')
    },
  )

  it('keeps the stored band even when the zones change after planning', () => {
    const planned = prescribed('threshold')
    const later = zoneSetFixture({ pace: { z1: [400, 350], z2: [350, 320], z3: [320, 290] } })
    expect(resolveTargets(planned, later, cold).paceSecPerKm).toEqual(planned.target.paceSecPerKm)
  })

  it('shows the current Z2 band beside a threshold pace, and none beside intervals', () => {
    const threshold = resolveTargets(prescribed('threshold'), zones, cold)
    expect(threshold).toMatchObject({ hrCeiling: null, hrRange: [140, 155], source: 'zones' })
    const intervals = resolveTargets(prescribed('intervals'), zones, cold)
    expect(intervals).toMatchObject({ hrCeiling: null, hrRange: null, source: 'plan' })
  })

  it('falls back to the band, then to effort, when the stored pace is missing', () => {
    const noPace = zoneSetFixture({ pace: null, csMps: null })
    const threshold = prescribed('threshold', noPace)
    expect(threshold.target.paceSecPerKm).toBeNull()
    expect(resolveTargets(threshold, noPace, cold)).toMatchObject({
      mode: 'hr-band',
      hrRange: [140, 155],
      paceSecPerKm: null,
    })
    const intervals = prescribed('intervals', noPace)
    expect(resolveTargets(intervals, noPace, cold)).toMatchObject({
      mode: 'effort',
      hrRange: null,
    })
  })
})

describe('resolveTargets: effort sessions', () => {
  it.each(['hills', 'hike', 'cross', 'strength', 'mobility', 'rest', 'strides'] as const)(
    'gives a %s session effort',
    (kind) => {
      const planned = prescribed(kind)
      const t = resolveTargets(planned, zones, cold)
      expect(t.mode).toBe('effort')
      expect(t.rpe).toEqual(planned.target.rpe)
      expect(t.paceSecPerKm).toBeNull()
    },
  )

  it('keeps the stored Z1 ceiling as secondary text for a hike and cross-training', () => {
    expect(resolveTargets(prescribed('hike'), zones, cold).hrCeiling).toBe(140)
    expect(resolveTargets(prescribed('cross'), zones, cold).hrCeiling).toBe(140)
    expect(resolveTargets(prescribed('hills'), zones, cold).hrCeiling).toBeNull()
    expect(resolveTargets(prescribed('hills'), zones, cold).hrRange).toBeNull()
    expect(resolveTargets(prescribed('strength'), zones, cold).hrCeiling).toBeNull()
  })
})

describe('resolveTargets: hot days', () => {
  it('makes effort lead, keeps heart rate as secondary text and sets the hot note', () => {
    const t = resolveTargets(prescribed('easy'), zones, hot)
    expect(t).toMatchObject({
      mode: 'effort',
      hot: true,
      hrCeiling: 140,
      paceSecPerKm: [390, 340],
      rpe: P.expectedRpe.easy.value,
    })
    expect(t.hotNote).toMatch(/heat/i)
    expect(t.hotNote).not.toMatch(/behind|missed|red\b/i)
  })

  it('changes nothing but the mode, the flag and the note', () => {
    for (const kind of ['easy', 'long', 'threshold', 'intervals', 'race-pace', 'hills'] as const) {
      const planned = prescribed(kind)
      const { mode: _m, hot: _h, hotNote: _n, ...warmRest } = resolveTargets(planned, zones, hot)
      const {
        mode: _m2,
        hot: _h2,
        hotNote: _n2,
        ...coolRest
      } = resolveTargets(planned, zones, cold)
      expect(warmRest, kind).toEqual(coolRest)
      expect(resolveTargets(planned, zones, hot).mode, kind).toBe('effort')
    }
  })

  it('has no hot note on a day that is not hot', () => {
    const t = resolveTargets(prescribed('easy'), zones, cold)
    expect(t.hot).toBe(false)
    expect(t.hotNote).toBeNull()
  })

  it('does not call a strength, mobility or rest day hot', () => {
    for (const kind of ['strength', 'mobility', 'rest'] as const) {
      const t = resolveTargets(prescribed(kind), zones, hot)
      expect(t, kind).toMatchObject({ hot: false, hotNote: null, mode: 'effort' })
    }
  })

  it('eases and heats together: an eased run on a hot day leads with effort', () => {
    const eased = easedSession(prescribed('threshold'), zones)
    expect(resolveTargets(eased, zones, hot)).toMatchObject({
      mode: 'effort',
      hot: true,
      hrCeiling: 140,
    })
  })
})

describe('resolveTargets: purity', () => {
  it('does not change its inputs and returns copies of the stored ranges', () => {
    const planned = prescribed('threshold')
    const before = structuredClone(planned)
    const zonesBefore = structuredClone(zones)
    const t = resolveTargets(planned, zones, cold)
    expect(planned).toEqual(before)
    expect(zones).toEqual(zonesBefore)
    t.rpe[0] = 99
    t.paceSecPerKm![0] = 1
    expect(planned.target.rpe).toEqual(before.target.rpe)
    expect(planned.target.paceSecPerKm).toEqual(before.target.paceSecPerKm)
  })

  it('is deterministic', () => {
    const planned = prescribed('easy')
    expect(resolveTargets(planned, zones, hot)).toEqual(resolveTargets(planned, zones, hot))
  })
})

describe('climbNote (rules H4)', () => {
  const rate = P.h4.climbNoteGainPerHourM.value
  const run = (durationMin: number, gainM: number | null) => ({ durationMin, gainM })

  it('adds the climbing line when the gain per hour reaches the threshold', () => {
    expect(climbNote(run(60, rate))).not.toBeNull()
    expect(climbNote(run(120, rate * 2))).not.toBeNull()
    expect(climbNote(run(30, rate / 2))).not.toBeNull()
    expect(climbNote(run(60, rate * 4))).not.toBeNull()
  })

  it('adds nothing below the threshold, without a gain or without minutes', () => {
    expect(climbNote(run(60, rate - 1))).toBeNull()
    expect(climbNote(run(120, rate * 2 - 1))).toBeNull()
    expect(climbNote(run(60, null))).toBeNull()
    expect(climbNote(run(60, 0))).toBeNull()
    expect(climbNote(run(0, 300))).toBeNull()
  })

  it('says to climb by effort, never by vertical speed, and names no figure', () => {
    const note = climbNote(run(60, rate))!
    expect(note).toMatch(/effort/)
    expect(note).not.toMatch(/\d/)
    expect(note).not.toMatch(/behind|missed|streak|badge/i)
  })

  it('reads the climbing of a prescribed session', () => {
    // the fixture week plans 1200 m over 300 minutes of running: 240 m an hour
    const easy = prescribed('easy')
    expect(easy.gainM).toBe(240)
    expect(climbNote(easy)).not.toBeNull()
    expect(climbNote({ ...easy, gainM: 100 })).toBeNull()
    expect(climbNote({ ...prescribed('long'), durationMin: 100, gainM: 300 })).not.toBeNull()
    expect(climbNote(prescribed('strength'))).toBeNull()
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

describe('one target resolver', () => {
  it('is defined once in the shipped code', () => {
    const root = join(import.meta.dirname, '../../..')
    const definitions = ['shared', 'server', 'web']
      .flatMap((dir) => sources(join(root, dir)))
      .filter((file) =>
        /\b(function|const)\s+(resolveTargets|climbNote)\b/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => file.slice(root.length + 1))
    expect(definitions).toEqual(['shared/engine/targets.ts'])
  })
})

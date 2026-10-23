import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertCleanCopy, lintText } from '../../../shared/copy/lint.ts'
import { prescribe } from '../../../shared/engine/sessions.ts'
import { rungSessions, sessionMin } from '../../../shared/engine/startWeeks.ts'
import type { SessionFlag, SessionKind, SessionSpec } from '../../../shared/engine/types.ts'
import {
  FILE_SLUGS,
  PUBLIC_TITLES,
  publicTitle,
  publishable,
} from '../../../shared/workouts/labels.ts'
import { SESSION_KINDS, weekFixture, zoneSetFixture } from '../engine/fixtures.ts'

/** Every flag a session can carry; the record makes a flag added to the engine a compile error. */
const FLAG_SET: Record<SessionFlag, true> = {
  'spike-warn': true,
  'override-required': true,
  heat: true,
  night: true,
  'fuel-practice': true,
  'b2b-day1': true,
  'b2b-day2': true,
  downhill: true,
  'run-walk': true,
  'post-race': true,
  'injury-return': true,
  'rest-window': true,
}
const FLAGS = Object.keys(FLAG_SET) as SessionFlag[]

/** Wording that must never leave the app in a title: health, a reason, the run-walk ladder. */
const FORBIDDEN =
  /injur|illness|\bill\b|sick|pain|niggle|rehab|return|post-race|after the race|\beased?\b|easier|run-walk|run walk|\bwalk|readiness|reason/i

const zones = zoneSetFixture()

/** A session as the engine makes it, then marked up the way a re-plan or a day can mark one. */
function session(kind: SessionKind, minutes: number, over: Partial<SessionSpec> = {}) {
  return { ...prescribe(kind, minutes, zones, weekFixture()), date: '2026-07-10', ...over }
}

/** Every subset of the flags: 2^12 combinations. */
function* flagSubsets(): Generator<SessionFlag[]> {
  for (let mask = 0; mask < 1 << FLAGS.length; mask += 1) {
    yield FLAGS.filter((_, i) => (mask & (1 << i)) !== 0)
  }
}

describe('publicTitle', () => {
  it('names a kind and its length, like the calendar examples', () => {
    expect(publicTitle(session('easy', 45))).toBe('Easy run, 45 min')
    expect(publicTitle(session('long', 150))).toBe('Long run, 2 h 30 min')
    expect(publicTitle(session('long', 60))).toBe('Long run, 1 h')
    expect(publicTitle(session('threshold', 60))).toBe('Threshold run, 1 h')
    expect(publicTitle(session('intervals', 50))).toBe('Intervals, 50 min')
    expect(publicTitle(session('strides', 40))).toBe('Easy run with strides, 40 min')
  })

  it('gives a race and a rest day no length', () => {
    expect(publicTitle(session('race', 600))).toBe('Race day')
    expect(publicTitle(session('rest', 0))).toBe('Rest day')
  })

  it('has one allowlisted title for each of the 16 kinds', () => {
    expect(Object.keys(PUBLIC_TITLES).sort()).toEqual([...SESSION_KINDS].sort())
    for (const kind of SESSION_KINDS) {
      const { title } = PUBLIC_TITLES[kind]
      expect(title, kind).not.toMatch(FORBIDDEN)
      expect(lintText(title), kind).toEqual([])
    }
  })

  it('is the allowlisted title and a length for every kind and every combination of flags', () => {
    const lengthed = /^(?:, (?:\d+ h)?(?: ?\d+ min)?)?$/
    for (const kind of SESSION_KINDS) {
      const { title: base } = PUBLIC_TITLES[kind]
      for (const flags of flagSubsets()) {
        // the engine's own wording is health-laden on purpose; none of it may get through
        const marked = session(kind, 45, {
          flags,
          title: 'Return to running, level 2',
          purpose:
            'Eased from Intervals: injury, illness and pain in the first week after the race; run-walk.',
        })
        const title = publicTitle(marked)
        expect(title.startsWith(base), `${kind} ${flags.join()}`).toBe(true)
        expect(title.slice(base.length), `${kind} ${flags.join()}`).toMatch(lengthed)
        expect(title, `${kind} ${flags.join()}`).not.toMatch(FORBIDDEN)
        expect(lintText(title), `${kind} ${flags.join()}`).toEqual([])
      }
    }
  })

  it('passes the shared lint at every length', () => {
    for (const kind of SESSION_KINDS) {
      for (const minutes of [0, 1, 20, 59, 60, 61, 90, 119, 120, 359, 360, 600]) {
        assertCleanCopy(publicTitle(session(kind, minutes)), `${kind} title`)
      }
    }
  })

  it('ignores the title the engine gave a start-path session', () => {
    const injury = prescribe(
      'easy',
      20,
      zones,
      weekFixture({ flags: ['injury-return', 'injury-level-1'] }),
    )
    expect(injury.title).toMatch(/return/i)
    expect(injury.flags).toContain('injury-return')
    expect(publicTitle(injury)).toBe('Easy run, 20 min')

    const postRace = session('easy', 30, { flags: ['post-race'] })
    expect(publicTitle(postRace)).toBe('Easy run, 30 min')
  })

  it('calls a session of the run-walk ladder "Easy run", with no length', () => {
    // the two walks that frame it sit outside its minutes, so a length would be wrong on the watch
    for (let rung = 1; rung <= 9; rung += 1) {
      for (const blueprint of rungSessions(rung)) {
        const ladder = prescribe(
          'easy',
          sessionMin(blueprint),
          zones,
          weekFixture({ flags: ['restart-floor', 'run-walk', `ladder-${String(rung)}`] }),
          { blueprint },
        )
        expect(ladder.title, `rung ${rung}`).toMatch(/run-walk|ladder step/i)
        expect(publicTitle(ladder), `rung ${rung}`).toBe('Easy run')
      }
    }
  })
})

describe('publishable', () => {
  it('is true for the runs and the hike, false for the rest', () => {
    const yes = SESSION_KINDS.filter(publishable)
    expect(yes).toEqual([
      'easy',
      'recovery',
      'long',
      'long-fast-finish',
      'threshold',
      'intervals',
      'race-pace',
      'strides',
      'hills',
      'hike',
      'b2b',
    ])
    for (const kind of ['strength', 'mobility', 'rest', 'race', 'cross'] as const) {
      expect(publishable(kind), kind).toBe(false)
    }
  })
})

describe('FILE_SLUGS', () => {
  it('names every kind, in lower case words joined by hyphens', () => {
    expect(Object.keys(FILE_SLUGS).sort()).toEqual([...SESSION_KINDS].sort())
    for (const [kind, slug] of Object.entries(FILE_SLUGS)) {
      expect(slug, kind).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
    }
  })

  it('carries no health, reason or run-walk wording', () => {
    for (const [kind, slug] of Object.entries(FILE_SLUGS)) {
      expect(slug, kind).not.toMatch(FORBIDDEN)
    }
  })

  it('names a long run with a fast finish as a long run, as the title does', () => {
    expect(FILE_SLUGS['long-fast-finish']).toBe(FILE_SLUGS.long)
    expect(FILE_SLUGS.easy).toBe('easy-run')
    expect(FILE_SLUGS.intervals).toBe('intervals')
  })

  it('gives the kinds that go to a watch names of their own, apart from the long run', () => {
    const slugs = SESSION_KINDS.filter(publishable)
      .filter((kind) => kind !== 'long-fast-finish')
      .map((kind) => FILE_SLUGS[kind])
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe('shared/workouts', () => {
  it('imports nothing from Node', () => {
    const dir = join(import.meta.dirname, '../../../shared/workouts')
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts'))
    expect(files.sort()).toEqual(['labels.ts', 'plan.ts', 'types.ts'])
    for (const name of files) {
      const text = readFileSync(join(dir, name), 'utf8')
      expect(text, name).not.toMatch(/from 'node:|require\(|from 'fs'|from 'path'|from 'crypto'/)
    }
  })
})

// The cross-surface target test [design 4.6]. Every place that shows a session's targets reads
// them through `resolveTargets`, so the ceiling, band, pace and effort are the same everywhere.
// Each surface registers one adapter in `SURFACES` below: it renders the targets the way the
// surface does (text, steps, a description) and reads the figures back out of that rendering. The
// test runs every adapter over every session kind, hot or not, eased or not, in km and in miles,
// and compares the figures with the resolver's. A second implementation of the rules, or a number
// typed into a surface, fails here.
//
// Registered now:  hero (Today, E2-2).
// To be registered by the task that builds the surface:
//   session sheet, FIT steps, intervals.icu description, ICS outline  E1-7, E1-3
//   weekly brief key session                                          E4-5
//   fuel line                                                         E6-5
// To add one: write a `SurfaceAdapter` whose `read` renders from `resolveTargets` (or from the
// shared builder that calls it) and parses the figures back, then append it to `SURFACES`.
import { describe, expect, it } from 'vitest'
import { easedSession } from '../../../shared/engine/readiness.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type { ResolvedTargets, SessionSpec, ZoneSet } from '../../../shared/engine/types.ts'
import { formatDuration, formatPace } from '../../../shared/units.ts'
import type { Units } from '../../../shared/types.ts'
import { prescribed, SESSION_KINDS, zoneSetFixture } from './fixtures.ts'

/** The figures a surface shows, with pace in seconds per displayed unit (km or mile). */
interface SurfaceReading {
  /** What the surface leads with. */
  lead: 'hr-ceiling' | 'hr-band' | 'pace' | 'effort'
  hrCeiling: number | null
  hrRange: [number, number] | null
  paceSecPerUnit: [number, number] | null
  effort: [number, number]
}

interface SurfaceContext {
  zones: ZoneSet
  hot: boolean
  units: Units
}

interface SurfaceAdapter {
  name: string
  read(session: SessionSpec, ctx: SurfaceContext): SurfaceReading
}

const M_PER_MILE = 1609.344
const unitM = (units: Units) => (units === 'mi' ? M_PER_MILE : 1000)

/** The resolver's figures in the unit the surface displays. */
function reference(session: SessionSpec, ctx: SurfaceContext): SurfaceReading {
  const t = resolveTargets(session, ctx.zones, { hot: ctx.hot })
  const perUnit = (sec: number) => Math.round((sec * unitM(ctx.units)) / 1000)
  return {
    lead: t.mode,
    hrCeiling: t.hrCeiling,
    hrRange: t.hrRange,
    paceSecPerUnit: t.paceSecPerKm
      ? [perUnit(t.paceSecPerKm[0]), perUnit(t.paceSecPerKm[1])]
      : null,
    effort: t.rpe,
  }
}

// ---------------------------------------------------------------------------------------------
// The hero: lines in the wording of the Today design (spec 7.6), read back from the text.
// ---------------------------------------------------------------------------------------------

function heroLines(t: ResolvedTargets, units: Units): string[] {
  const hr = (): string | null => {
    if (t.hrCeiling !== null) return `Heart rate: under ${t.hrCeiling} bpm`
    if (t.hrRange !== null) return `Heart rate: ${t.hrRange[0]} to ${t.hrRange[1]} bpm`
    return null
  }
  const pace =
    t.paceSecPerKm === null
      ? null
      : `Pace: about ${formatPace(t.paceSecPerKm[0], 1000, units).split(' ')[0]} to ${formatPace(t.paceSecPerKm[1], 1000, units)}`
  const effort = `Effort: ${t.rpe[0]} to ${t.rpe[1]} out of 10`
  const lines: Array<string | null> =
    t.mode === 'effort'
      ? [effort, hr(), pace]
      : t.mode === 'pace'
        ? [pace, effort, hr()]
        : [hr(), pace, effort]
  return lines.filter((line): line is string => line !== null)
}

function paceSeconds(text: string): number {
  const [m, s] = text.split(':').map(Number)
  return m! * 60 + s!
}

const hero: SurfaceAdapter = {
  name: 'hero',
  read(session, ctx) {
    const t = resolveTargets(session, ctx.zones, { hot: ctx.hot })
    const lines = heroLines(t, ctx.units)
    const lead = lines[0]!
    const find = (re: RegExp) => lines.map((line) => re.exec(line)).find((m) => m !== null) ?? null
    const ceiling = find(/^Heart rate: under (\d+) bpm/)
    const band = find(/^Heart rate: (\d+) to (\d+) bpm/)
    const pace = find(/^Pace: about (\d+:\d{2}) to (\d+:\d{2}) \/(km|mi)/)
    const effort = find(/^Effort: (\d+) to (\d+) out of 10/)!
    if (pace !== null) expect(pace[3]).toBe(ctx.units)
    return {
      lead: lead.startsWith('Effort')
        ? 'effort'
        : lead.startsWith('Pace')
          ? 'pace'
          : ceiling !== null
            ? 'hr-ceiling'
            : 'hr-band',
      hrCeiling: ceiling ? Number(ceiling[1]) : null,
      hrRange: band ? [Number(band[1]), Number(band[2])] : null,
      paceSecPerUnit: pace ? [paceSeconds(pace[1]!), paceSeconds(pace[2]!)] : null,
      effort: [Number(effort[1]), Number(effort[2])],
    }
  },
}

/** The registry. Later tasks append their adapters here. */
const SURFACES: readonly SurfaceAdapter[] = [hero]

// ---------------------------------------------------------------------------------------------

const zones = zoneSetFixture()
const UNITS: readonly Units[] = ['km', 'mi']

interface Mismatch {
  surface: string
  case: string
  expected: SurfaceReading
  got: SurfaceReading
}

/** Runs one adapter over the whole matrix and lists where it differs from the resolver. */
function mismatchesOf(adapter: SurfaceAdapter): Mismatch[] {
  const out: Mismatch[] = []
  for (const kind of SESSION_KINDS) {
    for (const hot of [false, true]) {
      for (const eased of [false, true]) {
        for (const units of UNITS) {
          const planned = prescribed(kind, zones)
          const session = eased ? easedSession(planned, zones) : planned
          const ctx = { zones, hot, units }
          const expected = reference(session, ctx)
          const got = adapter.read(session, ctx)
          if (JSON.stringify(got) !== JSON.stringify(expected)) {
            out.push({
              surface: adapter.name,
              case: `${kind} hot=${hot} eased=${eased} ${units}`,
              expected,
              got,
            })
          }
        }
      }
    }
  }
  return out
}

describe('cross-surface targets', () => {
  it('registers each surface once, and the hero is one of them', () => {
    const names = SURFACES.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('hero')
  })

  it.each(SURFACES.map((s) => [s.name, s] as const))(
    '%s shows the resolver’s targets for every kind, hot or not, eased or not, in km and miles',
    (_name, adapter) => {
      expect(mismatchesOf(adapter)).toEqual([])
    },
  )

  it('covers every kind in both units, hot and not, eased and not', () => {
    // 16 kinds x hot x eased x 2 units; guards against a matrix that quietly shrinks.
    expect(SESSION_KINDS).toHaveLength(16)
    expect(UNITS).toEqual(['km', 'mi'])
  })

  it('leads with effort on a hot day on every surface, and with the stored figure otherwise', () => {
    for (const adapter of SURFACES) {
      for (const kind of SESSION_KINDS) {
        const session = prescribed(kind, zones)
        const warm = adapter.read(session, { zones, hot: true, units: 'km' })
        expect(warm.lead, `${adapter.name} ${kind} hot`).toBe('effort')
        const mild = adapter.read(session, { zones, hot: false, units: 'km' })
        expect(mild.lead, `${adapter.name} ${kind}`).toBe(
          resolveTargets(session, zones, { hot: false }).mode,
        )
      }
    }
  })

  it('shows an eased run as one easy ceiling on every surface', () => {
    for (const adapter of SURFACES) {
      const eased = easedSession(prescribed('intervals', zones), zones)
      const reading = adapter.read(eased, { zones, hot: false, units: 'mi' })
      expect(reading.lead).toBe('hr-ceiling')
      expect(reading.hrCeiling).toBe(zones.hr!.z1[1])
    }
  })

  it('fails when a surface keeps its own numbers', () => {
    const stale: SurfaceAdapter = {
      name: 'stale',
      read(session, ctx) {
        // a surface that read the ceiling off the stored target, not the current zones
        const reading = hero.read(session, ctx)
        return session.target.hr && reading.hrCeiling !== null
          ? { ...reading, hrCeiling: session.target.hr[1] + 5 }
          : reading
      },
    }
    expect(mismatchesOf(stale).length).toBeGreaterThan(0)
    const secondsOff: SurfaceAdapter = {
      name: 'off-by-a-second',
      read(session, ctx) {
        const reading = hero.read(session, ctx)
        return reading.paceSecPerUnit
          ? {
              ...reading,
              paceSecPerUnit: [reading.paceSecPerUnit[0] + 1, reading.paceSecPerUnit[1]],
            }
          : reading
      },
    }
    expect(mismatchesOf(secondsOff).length).toBeGreaterThan(0)
  })

  it('formats whole-second paces the way the surfaces read them back', () => {
    expect(formatDuration(530)).toBe('8:50')
    expect(paceSeconds('8:50')).toBe(530)
  })
})

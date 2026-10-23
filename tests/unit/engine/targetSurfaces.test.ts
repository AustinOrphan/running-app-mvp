// The cross-surface target test [design 4.6]. Every place that shows a session's targets reads
// them through `resolveTargets`, so the ceiling, band, pace and effort are the same everywhere.
// Each surface registers one adapter in `SURFACES` below: it renders the targets the way the
// surface does (text, steps, a description) and reads the figures back out of that rendering. The
// test runs every adapter over every session kind, hot or not, eased or not, in km and in miles,
// and compares the figures with the resolver's. A second implementation of the rules, or a number
// typed into a surface, fails here.
//
// Registered now:  hero (Today, E2-5: the rendered `SessionTargets`), FIT workout file (E1-3).
// To be registered by the task that builds the surface:
//   session sheet, intervals.icu description, ICS outline             E1-7, E1-6
//   weekly brief key session                                          E4-5
//   fuel line                                                         E6-5
// To add one: write a `SurfaceAdapter` whose `read` renders from `resolveTargets` (or from the
// shared builder that calls it) and parses the figures back, then append it to `SURFACES`.
//
// A page of guidance (the hero, the session sheet) shows every figure the resolver holds. A
// workout (a FIT file, the intervals.icu steps) shows a target per step, so it is a `partial`
// surface: it has no effort figure and carries only the primary figure of its steps (nothing on a
// hot day), and the matrix then requires that its lead is the resolver's and that every figure it
// does carry equals the resolver's. A surface that has no page for a kind (a strength day has no
// workout file) lists the kinds it `covers`.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { easedSession } from '../../../shared/engine/readiness.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type {
  ResolvedTargets,
  SessionKind,
  SessionSpec,
  ZoneSet,
} from '../../../shared/engine/types.ts'
import { formatDuration } from '../../../shared/units.ts'
import type { Units } from '../../../shared/types.ts'
import { publishable } from '../../../shared/workouts/labels.ts'
import { toWorkoutPlan } from '../../../shared/workouts/plan.ts'
import { encodeWorkoutFit } from '../../../server/services/workoutFit.ts'
import { SessionTargets } from '../../../web/components/today/SessionTargets.tsx'
import { expandWorkout, readWorkout, type ExpandedStep } from '../../fixtures/fit/readWorkout.ts'
import { prescribed, SESSION_KINDS, zoneSetFixture } from './fixtures.ts'

/** The figures a surface shows, with pace in seconds per displayed unit (km or mile). */
interface SurfaceReading {
  /** What the surface leads with. */
  lead: 'hr-ceiling' | 'hr-band' | 'pace' | 'effort'
  hrCeiling: number | null
  hrRange: [number, number] | null
  paceSecPerUnit: [number, number] | null
  /** Null for a surface that has no effort figure (a workout file). */
  effort: [number, number] | null
}

interface SurfaceContext {
  zones: ZoneSet
  hot: boolean
  units: Units
}

interface SurfaceAdapter {
  name: string
  /** The kinds the surface has a page for; all of them when left out. */
  covers?(kind: SessionKind): boolean
  /** Shows a target per step, not every figure: see the header. */
  partial?: boolean
  read(session: SessionSpec, ctx: SurfaceContext): SurfaceReading
}

const covered = (adapter: SurfaceAdapter): readonly SessionKind[] =>
  SESSION_KINDS.filter((kind) => adapter.covers?.(kind) ?? true)

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
// The hero: the term list of Today (`SessionTargets`, spec 7.6) rendered to markup, and the
// figures read back out of what it says.
// ---------------------------------------------------------------------------------------------

/** The lines the hero prints, in order: "Heart rate: under 149 bpm", with a note after a period. */
function heroLines(t: ResolvedTargets, units: Units): string[] {
  const markup = renderToStaticMarkup(createElement(SessionTargets, { targets: t, units }))
  const rows = [...markup.matchAll(/<div[^>]*>(.*?)<\/div>/g)].map((row) => row[1] ?? '')
  return rows.map((row) => {
    const term = /<dt[^>]*>(.*?)<\/dt>/.exec(row)?.[1]
    const values = [...row.matchAll(/<dd[^>]*>(.*?)<\/dd>/g)].map((dd) => dd[1])
    if (term === undefined || values.length === 0) throw new Error(`Unreadable row: ${row}`)
    return `${term}: ${values.join(' ')}`
  })
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
    // The hero prints the quicker pace first; the resolver keeps the slow end first.
    const pace = find(/^Pace: (?:about )?(\d+:\d{2}) to (\d+:\d{2}) \/(km|mi)/)
    const effort = find(/^Effort: (\d+)(?: to (\d+))? out of 10/)!
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
      paceSecPerUnit: pace ? [paceSeconds(pace[2]!), paceSeconds(pace[1]!)] : null,
      effort: [Number(effort[1]), Number(effort[2] ?? effort[1])],
    }
  },
}

// ---------------------------------------------------------------------------------------------
// The FIT workout file (E1-3): written by `encodeWorkoutFit` from `toWorkoutPlan`, read back with
// the FIT parser. Heart rate is bpm + 100 in the file; a ceiling is a range that starts at the
// watch floor (`o1.hrFloorBpm`); a pace is a speed range in mm/s, slow edge first; a step run by
// effort says so in its note.
// ---------------------------------------------------------------------------------------------

const FIT_CREATED = new Date('2026-07-10T06:30:00Z')
const EFFORT_NOTE = 'By effort'

function onlyFigure<T>(found: T[], what: string): T | null {
  const first = found[0]
  if (first === undefined) return null
  for (const other of found) {
    if (JSON.stringify(other) !== JSON.stringify(first)) {
      throw new Error(`The file carries two different ${what}`)
    }
  }
  return first
}

function readFit(steps: readonly ExpandedStep[], units: Units): SurfaceReading {
  const ceilings: number[] = []
  const bands: Array<[number, number]> = []
  const paces: Array<[number, number]> = []
  const perUnit = (mmPerSec: number) => Math.round((1_000_000 / mmPerSec) * (unitM(units) / 1000))
  for (const step of steps) {
    const target = step.target
    if (target.type === 'heart_rate') {
      if (target.lowBpm === P.o1.hrFloorBpm.value) ceilings.push(target.highBpm)
      else bands.push([target.lowBpm, target.highBpm])
    } else if (target.type === 'speed') {
      paces.push([perUnit(target.lowMmPerSec), perUnit(target.highMmPerSec)])
    }
  }
  const hrCeiling = onlyFigure(ceilings, 'heart-rate ceilings')
  const hrRange = onlyFigure(bands, 'heart-rate bands')
  const paceSecPerUnit = onlyFigure(paces, 'pace ranges')
  const byEffort = steps.some((step) => step.notes?.includes(EFFORT_NOTE) === true)
  const lead: SurfaceReading['lead'] | null = byEffort
    ? 'effort'
    : paceSecPerUnit !== null
      ? 'pace'
      : hrCeiling !== null
        ? 'hr-ceiling'
        : hrRange !== null
          ? 'hr-band'
          : null
  if (lead === null) throw new Error('The file leads with nothing')
  return { lead, hrCeiling, hrRange, paceSecPerUnit, effort: null }
}

const fit: SurfaceAdapter = {
  name: 'fit',
  covers: publishable,
  partial: true,
  read(session, ctx) {
    const targets = resolveTargets(session, ctx.zones, { hot: ctx.hot })
    const plan = toWorkoutPlan(session, targets, { units: ctx.units })
    const file = readWorkout(encodeWorkoutFit(plan, { createdAt: FIT_CREATED }))
    return readFit(expandWorkout(file), ctx.units)
  },
}

/** The registry. Later tasks append their adapters here. */
const SURFACES: readonly SurfaceAdapter[] = [hero, fit]

// ---------------------------------------------------------------------------------------------

const zones = zoneSetFixture()
const UNITS: readonly Units[] = ['km', 'mi']

interface Mismatch {
  surface: string
  case: string
  expected: SurfaceReading
  got: SurfaceReading
}

const CARRIED = ['hrCeiling', 'hrRange', 'paceSecPerUnit'] as const

/**
 * A speed in mm/s cannot hold every pace to the second: half a mm/s is up to 0.05 s per km, so a
 * pace read back and rounded can differ from the resolver's by one second at a rounding edge. The
 * writer's own test pins the exact mm/s of every pace.
 */
const PARTIAL_PACE_TOLERANCE_SEC = 1

function figureAgrees(
  key: (typeof CARRIED)[number],
  got: SurfaceReading[typeof key],
  expected: SurfaceReading[typeof key],
): boolean {
  if (got === null) return true // not carried
  if (key === 'paceSecPerUnit') {
    const [slow, fast] = got as [number, number]
    const [wantSlow, wantFast] = expected as [number, number]
    return (
      Math.abs(slow - wantSlow) <= PARTIAL_PACE_TOLERANCE_SEC &&
      Math.abs(fast - wantFast) <= PARTIAL_PACE_TOLERANCE_SEC
    )
  }
  return JSON.stringify(got) === JSON.stringify(expected)
}

/** Whether a reading is what the resolver says: all of it, or for a partial surface what it carries. */
function agrees(adapter: SurfaceAdapter, got: SurfaceReading, expected: SurfaceReading): boolean {
  if (adapter.partial !== true) return JSON.stringify(got) === JSON.stringify(expected)
  return (
    got.lead === expected.lead && CARRIED.every((key) => figureAgrees(key, got[key], expected[key]))
  )
}

/** Runs one adapter over the whole matrix and lists where it differs from the resolver. */
function mismatchesOf(adapter: SurfaceAdapter): Mismatch[] {
  const out: Mismatch[] = []
  for (const kind of covered(adapter)) {
    for (const hot of [false, true]) {
      for (const eased of [false, true]) {
        for (const units of UNITS) {
          const planned = prescribed(kind, zones)
          const session = eased ? easedSession(planned, zones) : planned
          const ctx = { zones, hot, units }
          const expected = reference(session, ctx)
          const got = adapter.read(session, ctx)
          if (!agrees(adapter, got, expected)) {
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
    expect(names).toContain('fit')
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
    expect(covered(hero)).toEqual(SESSION_KINDS)
    // the file of a run or a hike; no workout for strength, mobility, rest, cross-training or a race
    expect(covered(fit)).toHaveLength(11)
    expect(covered(fit).every((kind) => publishable(kind))).toBe(true)
  })

  it('leads with effort on a hot day on every surface, and with the stored figure otherwise', () => {
    for (const adapter of SURFACES) {
      for (const kind of covered(adapter)) {
        const session = prescribed(kind, zones)
        const warm = adapter.read(session, { zones, hot: true, units: 'km' })
        expect(warm.lead, `${adapter.name} ${kind} hot`).toBe('effort')
        if (adapter.partial === true) {
          // a workout carries no figure on a hot day: heart rate lags and pace is wrong in heat
          for (const key of CARRIED) expect(warm[key], `${adapter.name} ${kind} ${key}`).toBeNull()
        }
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

  it('fails when a workout file keeps its own figures or loses its lead', () => {
    const staleCeiling: SurfaceAdapter = {
      ...fit,
      name: 'stale-fit',
      read(session, ctx) {
        const reading = fit.read(session, ctx)
        return reading.hrCeiling === null
          ? reading
          : { ...reading, hrCeiling: reading.hrCeiling + 5 }
      },
    }
    expect(mismatchesOf(staleCeiling).length).toBeGreaterThan(0)
    const slowerPace: SurfaceAdapter = {
      ...fit,
      name: 'slower-fit',
      read(session, ctx) {
        const reading = fit.read(session, ctx)
        return reading.paceSecPerUnit
          ? {
              ...reading,
              paceSecPerUnit: [reading.paceSecPerUnit[0], reading.paceSecPerUnit[1] + 2],
            }
          : reading
      },
    }
    expect(mismatchesOf(slowerPace).length).toBeGreaterThan(0)
    const effortOnly: SurfaceAdapter = {
      ...fit,
      name: 'effort-fit',
      read: (session, ctx) => ({ ...fit.read(session, ctx), lead: 'effort' }),
    }
    expect(mismatchesOf(effortOnly).length).toBeGreaterThan(0)
  })

  it('reads the workout file back to within a second of pace in both units', () => {
    // the speed range of the file is in mm/s, so a pace comes back rounded, not exactly
    const session = prescribed('threshold', zones)
    const km = fit.read(session, { zones, hot: false, units: 'km' })
    const mi = fit.read(session, { zones, hot: false, units: 'mi' })
    const stored = resolveTargets(session, zones, { hot: false }).paceSecPerKm!
    stored.forEach((sec, i) => {
      expect(Math.abs(km.paceSecPerUnit![i]! - sec)).toBeLessThan(1)
      expect(Math.abs(mi.paceSecPerUnit![i]! - (sec * M_PER_MILE) / 1000)).toBeLessThan(1)
    })
  })

  it('formats whole-second paces the way the surfaces read them back', () => {
    expect(formatDuration(530)).toBe('8:50')
    expect(paceSeconds('8:50')).toBe(530)
  })
})

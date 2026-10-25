// The cross-surface target test [design 4.6]. Every place that shows a session's targets reads
// them through `resolveTargets`, so the ceiling, band, pace and effort are the same everywhere.
// Each surface registers one adapter in `SURFACES` below: it renders the targets the way the
// surface does (text, steps, a description) and reads the figures back out of that rendering. The
// test runs every adapter over every session kind, hot or not, eased or not, in km and in miles,
// and compares the figures with the resolver's. A second implementation of the rules, or a number
// typed into a surface, fails here.
//
// Registered now:  hero (Today, E2-5: the rendered `SessionTargets`), session sheet (E1-7: the
// rendered `SheetTargets`), the key session of the weekly brief (E4-5: the stored figures worded by
// `targetRows`), FIT workout file (E1-3), intervals.icu description (E1-7), ICS outline (E1-6). The
// fuel line (E6-5) is a different figure and is read by its own adapters in the last section of
// this file.
// To add one: write a `SurfaceAdapter` whose `read` renders from `resolveTargets` (or from the
// shared builder that calls it) and parses the figures back, then append it to `SURFACES`.
//
// A page of guidance (the hero, the session sheet) shows every figure the resolver holds. A
// workout (a FIT file, the intervals.icu steps) shows a target per step, so it is a `partial`
// surface: it has no effort figure and carries only the primary figure of its steps (nothing on a
// hot day), and the matrix then requires that its lead is the resolver's and that every figure it
// does carry equals the resolver's. A surface that has no page for a kind (a strength day has no
// workout file) lists the kinds it `covers`. A surface that is read by people other than the
// runner (the calendar feed) carries no figure at all, only the words that say how the session is
// run; it sets `figures: false`, so its lead must still be the resolver's and every figure null.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  fuelLineForSession,
  fuelTargetFor,
  replayLadder,
  type FuelContext,
} from '../../../shared/engine/fuel.ts'
import { describeFuelTarget } from '../../../shared/engine/fuelCopy.ts'
import { keySessionFacts } from '../../../shared/engine/brief.ts'
import { targetRows } from '../../../shared/copy/targetRows.ts'
import type { WeatherIndex } from '../../../shared/engine/heat.ts'
import { easedSession } from '../../../shared/engine/readiness.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type {
  FuelRunInput,
  FuelSessionInput,
  SessionKind,
  SessionSpec,
  ZoneSet,
} from '../../../shared/engine/types.ts'
import { formatDuration } from '../../../shared/units.ts'
import type { PlanSessionStatus, Units } from '../../../shared/types.ts'
import { icsOutline, icsUid, renderIcs } from '../../../server/services/ics.ts'
import { publishable } from '../../../shared/workouts/labels.ts'
import { toWorkoutPlan } from '../../../shared/workouts/plan.ts'
import type { WorkoutPlan } from '../../../shared/workouts/types.ts'
import { renderIntervalsDescription } from '../../../server/providers/intervalsPublish.ts'
import type { PublishReference } from '../../../server/providers/types.ts'
import { encodeWorkoutFit, FIT_NOTES_MAX_BYTES } from '../../../server/services/workoutFit.ts'
import { SheetTargets, StoredTargets } from '../../../web/components/SessionSheet.tsx'
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
  zones: ZoneSet | null
  hot: boolean
  units: Units
}

interface SurfaceAdapter {
  name: string
  /** The kinds the surface has a page for; all of them when left out. */
  covers?(kind: SessionKind): boolean
  /** Shows a target per step, not every figure: see the header. */
  partial?: boolean
  /** False for a surface that carries no figure, only its lead in words: see the header. */
  figures?: boolean
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

/** The lines a term list prints, in order: "Heart rate: under 149 bpm", with a note after a period. */
function termLines(markup: string): string[] {
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

/**
 * The figures a list of "Term: value" lines carries, the way the hero and the session sheet print
 * them and the way the weekly brief's rows are worded.
 */
function readTargetLines(lines: string[], units: Units): SurfaceReading {
  const lead = lines[0]!
  const find = (re: RegExp) => lines.map((line) => re.exec(line)).find((m) => m !== null) ?? null
  const ceiling = find(/^Heart rate: under (\d+) bpm/)
  const band = find(/^Heart rate: (\d+) to (\d+) bpm/)
  // The list prints the quicker pace first; the resolver keeps the slow end first.
  const pace = find(/^Pace: (?:about )?(\d+:\d{2}) to (\d+:\d{2}) \/(km|mi)/)
  const effort = find(/^Effort: (\d+)(?: to (\d+))? out of 10/)!
  if (pace !== null) expect(pace[3]).toBe(units)
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
}

const hero: SurfaceAdapter = {
  name: 'hero',
  read(session, ctx) {
    const targets = resolveTargets(session, ctx.zones, { hot: ctx.hot })
    const markup = renderToStaticMarkup(
      createElement(SessionTargets, { targets, units: ctx.units }),
    )
    return readTargetLines(termLines(markup), ctx.units)
  },
}

// ---------------------------------------------------------------------------------------------
// The key session of the weekly brief (E4-5): the figures the brief stores with the session
// (`keySessionFacts`, which calls the resolver) worded by `targetRows`, the code the hero words them
// with, and read back out of the lines. It covers every kind, though the brief picks only the key
// ones: the figures of a session do not depend on how it was chosen, and the matrix also feeds it
// eased sessions, which are easy runs. Which sessions are picked is tested with the facts.
// ---------------------------------------------------------------------------------------------

const briefKey: SurfaceAdapter = {
  name: 'brief',
  read(session, ctx) {
    const key = keySessionFacts(
      { ...session, id: 'brief-session', status: 'planned', activityId: null },
      ctx.zones,
      ctx.hot,
      null,
    )
    // The stored figures are plain data: they come back from the JSON column as written.
    const stored = JSON.parse(JSON.stringify(key)) as typeof key
    const lines = targetRows(stored.target, ctx.units, 'other').map(
      (row) => `${row.term}: ${[row.value, ...(row.note === null ? [] : [row.note])].join(' ')}`,
    )
    return readTargetLines(lines, ctx.units)
  },
}

// ---------------------------------------------------------------------------------------------
// The session sheet (E1-7): `SheetTargets`, which is what the sheet renders of the targets the
// server resolved for the session (`GET /api/plan/sessions/:id/workout`). It shows every figure
// the resolver holds, as the hero does, so it is a full surface and not a partial one: on a hot
// day it still prints the heart rate and the pace beneath the effort lead, with the heat note.
// ---------------------------------------------------------------------------------------------

const sheet: SurfaceAdapter = {
  name: 'sheet',
  read(session, ctx) {
    const targets = resolveTargets(session, ctx.zones, { hot: ctx.hot })
    const markup = renderToStaticMarkup(createElement(SheetTargets, { targets, units: ctx.units }))
    return readTargetLines(termLines(markup), ctx.units)
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

// ---------------------------------------------------------------------------------------------
// The intervals.icu event (E1-7): the text `renderIntervalsDescription` writes. Its steps hold
// percentages of the remote's maximum heart rate and threshold pace, which are not the resolver's
// figures, so the matrix reads the header line instead: the same targets in the runner's own units
// ("Heart rate under 142 bpm; Pace 5:30 to 5:10 /km"), the line that tells a person what the
// percentages mean. The lead is "Hot day: go by effort" or "By effort" for an effort day, else the
// figure the header carries.
// ---------------------------------------------------------------------------------------------

const INTERVALS_REF: PublishReference = { maxHr: 190, lthr: 170, thresholdPaceMps: 3.8 }

function readIntervals(text: string, units: Units): SurfaceReading {
  const find = (re: RegExp) => re.exec(text)
  const ceiling = find(/Heart rate under (\d+) bpm/)
  const band = find(/Heart rate (\d+) to (\d+) bpm/)
  // the text keeps the resolver's order: the slow end first
  const pace = find(/Pace (\d+:\d{2}) to (\d+:\d{2}) \/(km|mi)/)
  if (pace !== null) expect(pace[3]).toBe(units)
  const paceSecPerUnit: [number, number] | null = pace
    ? [paceSeconds(pace[1]!), paceSeconds(pace[2]!)]
    : null
  const hrCeiling = ceiling ? Number(ceiling[1]) : null
  const hrRange: [number, number] | null = band ? [Number(band[1]), Number(band[2])] : null
  const lead: SurfaceReading['lead'] = /go by effort|By effort/i.test(text)
    ? 'effort'
    : paceSecPerUnit !== null
      ? 'pace'
      : hrCeiling !== null
        ? 'hr-ceiling'
        : 'hr-band'
  return { lead, hrCeiling, hrRange, paceSecPerUnit, effort: null }
}

const intervals: SurfaceAdapter = {
  name: 'intervals',
  covers: publishable,
  partial: true,
  read(session, ctx) {
    const targets = resolveTargets(session, ctx.zones, { hot: ctx.hot })
    const plan = toWorkoutPlan(session, targets, { units: ctx.units })
    return readIntervals(renderIntervalsDescription(plan, INTERVALS_REF).text, ctx.units)
  },
}

// ---------------------------------------------------------------------------------------------
// The private calendar feed (E1-6): the DESCRIPTION of the event of a session, read back from the
// iCalendar text. It says how the session is run in words ("by effort", "at target pace", "kept
// easy", "kept steady") and carries no figure, because whoever holds the link reads it. The lead is
// the only thing it has in common with the resolver, so that is what the matrix checks, along
// with the absence of every figure and of every digit.
// ---------------------------------------------------------------------------------------------

const ICS_STAMP = '2026-07-10T06:30:00Z'

/** The description of the one event of a feed: unfolded, with the text escapes undone. */
function icsDescription(feed: string): string {
  const line = feed
    .replaceAll('\r\n ', '')
    .split('\r\n')
    .find((candidate) => candidate.startsWith('DESCRIPTION:'))
  if (line === undefined) throw new Error('The event has no description')
  return line
    .slice('DESCRIPTION:'.length)
    .replace(/\\(.)/g, (_all, char: string) => (char === 'n' ? '\n' : char))
}

function readOutline(words: string): SurfaceReading {
  const lead: SurfaceReading['lead'] | null = words.includes('by effort')
    ? 'effort'
    : words.includes('at target pace')
      ? 'pace'
      : words.includes('kept easy')
        ? 'hr-ceiling'
        : words.includes('kept steady')
          ? 'hr-band'
          : null
  if (lead === null) throw new Error('The outline leads with nothing')
  return { lead, hrCeiling: null, hrRange: null, paceSecPerUnit: null, effort: null }
}

const ics: SurfaceAdapter = {
  name: 'ics',
  covers: publishable,
  partial: true,
  figures: false,
  read(session, ctx) {
    const targets = resolveTargets(session, ctx.zones, { hot: ctx.hot })
    const plan = toWorkoutPlan(session, targets, { units: ctx.units })
    const feed = renderIcs({
      timeZone: null,
      stamp: ICS_STAMP,
      events: [
        {
          uid: icsUid('rl-aaaaaa-session'),
          date: session.date,
          title: plan.title,
          description: icsOutline(plan),
        },
      ],
    })
    const words = icsDescription(feed)
    // a number written in a calendar is a number typed into a surface
    expect(words, `${session.kind} outline`).not.toMatch(/\d/)
    return readOutline(words)
  },
}

// ---------------------------------------------------------------------------------------------
// The session sheet when the resolved targets cannot be read (the workout request failed):
// `StoredTargets` shows the targets stored with the session. It is not a surface of the registry,
// because it has no zones and no heat to resolve with and so cannot meet the matrix's hot and
// zone cases; but it words the figures through the same resolver (no zones) and the same rows as
// the hero, so it cannot keep a formatter of its own. This checks it kind by kind against the
// resolver's stored figures, in both units.
// ---------------------------------------------------------------------------------------------

const storedSheet: SurfaceAdapter = {
  name: 'stored-sheet',
  read(session, ctx) {
    const markup = renderToStaticMarkup(createElement(StoredTargets, { session, units: ctx.units }))
    return readTargetLines(termLines(markup), ctx.units)
  },
}

/** The registry. Later tasks append their adapters here. */
const SURFACES: readonly SurfaceAdapter[] = [hero, sheet, briefKey, fit, intervals, ics]

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
  if (adapter.figures === false) {
    return (
      got.lead === expected.lead && [...CARRIED, 'effort' as const].every((k) => got[k] === null)
    )
  }
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
    expect(names).toContain('sheet')
    expect(names).toContain('brief')
    expect(names).toContain('fit')
    expect(names).toContain('intervals')
    expect(names).toContain('ics')
  })

  it.each(SURFACES.map((s) => [s.name, s] as const))(
    '%s shows the resolver’s targets for every kind, hot or not, eased or not, in km and miles',
    (_name, adapter) => {
      expect(mismatchesOf(adapter)).toEqual([])
    },
  )

  it('the sheet’s stored-target fallback words the stored figures as the hero does, for every kind', () => {
    for (const kind of SESSION_KINDS) {
      for (const units of UNITS) {
        const session = prescribed(kind, zones)
        const expected = reference(session, { zones: null, hot: false, units })
        const got = storedSheet.read(session, { zones, hot: false, units })
        expect(got, `${kind} ${units}`).toEqual(expected)
        // the same words, row for row, as the hero prints for the same figures
        const targets = resolveTargets(session, null, { hot: false })
        expect(
          termLines(renderToStaticMarkup(createElement(StoredTargets, { session, units }))),
          `${kind} ${units}`,
        ).toEqual(
          termLines(
            renderToStaticMarkup(createElement(SessionTargets, { targets, units, day: 'other' })),
          ),
        )
      }
    }
  })

  it('covers every kind in both units, hot and not, eased and not', () => {
    // 16 kinds x hot x eased x 2 units; guards against a matrix that quietly shrinks.
    expect(SESSION_KINDS).toHaveLength(16)
    expect(UNITS).toEqual(['km', 'mi'])
    expect(covered(hero)).toEqual(SESSION_KINDS)
    // the sheet has targets for every kind, a strength day included
    expect(covered(sheet)).toEqual(SESSION_KINDS)
    expect(covered(briefKey)).toEqual(SESSION_KINDS)
    // the file of a run or a hike; no workout for strength, mobility, rest, cross-training or a race
    expect(covered(fit)).toHaveLength(11)
    expect(covered(fit).every((kind) => publishable(kind))).toBe(true)
    // the calendar outlines the same runs; a race or a strength day has a title and no outline
    expect(covered(ics)).toEqual(covered(fit))
    expect(covered(intervals)).toEqual(covered(fit))
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
      expect(reading.hrCeiling).toBe(adapter.figures === false ? null : zones.hr!.z1[1])
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

  it('fails when the brief keeps its own figures', () => {
    const staleBrief: SurfaceAdapter = {
      name: 'stale-brief',
      read(session, ctx) {
        // a brief that stored the ceiling of the plan, not of the zones as they are now
        const reading = briefKey.read(session, ctx)
        return session.target.hr && reading.hrCeiling !== null
          ? { ...reading, hrCeiling: session.target.hr[1] + 5 }
          : reading
      },
    }
    expect(mismatchesOf(staleBrief).length).toBeGreaterThan(0)
    const coolerBrief: SurfaceAdapter = {
      name: 'cool-brief',
      // a brief that did not apply the heat the other surfaces apply
      read: (session, ctx) => briefKey.read(session, { ...ctx, hot: false }),
    }
    expect(mismatchesOf(coolerBrief).length).toBeGreaterThan(0)
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

  it('fails when the session sheet shows the stored target and not the resolver’s', () => {
    const stored: SurfaceAdapter = {
      name: 'stored-sheet',
      read(session, ctx) {
        // a sheet that printed the stored target would show the zones the plan was written with
        const reading = sheet.read(session, ctx)
        return session.target.hr && reading.hrCeiling !== null
          ? { ...reading, hrCeiling: session.target.hr[1] + 5 }
          : reading
      },
    }
    expect(mismatchesOf(stored).length).toBeGreaterThan(0)
    const hotWithoutLead: SurfaceAdapter = {
      name: 'cool-sheet',
      read: (session, ctx) => sheet.read(session, { ...ctx, hot: false }),
    }
    expect(mismatchesOf(hotWithoutLead).length).toBeGreaterThan(0)
  })

  it('fails when the intervals.icu text keeps its own figures or loses its lead', () => {
    const staleCeiling: SurfaceAdapter = {
      ...intervals,
      name: 'stale-intervals',
      read(session, ctx) {
        const reading = intervals.read(session, ctx)
        return reading.hrCeiling === null
          ? reading
          : { ...reading, hrCeiling: reading.hrCeiling + 5 }
      },
    }
    expect(mismatchesOf(staleCeiling).length).toBeGreaterThan(0)
    const slowerPace: SurfaceAdapter = {
      ...intervals,
      name: 'slower-intervals',
      read(session, ctx) {
        const reading = intervals.read(session, ctx)
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
      ...intervals,
      name: 'effort-intervals',
      read: (session, ctx) => ({ ...intervals.read(session, ctx), lead: 'effort' }),
    }
    expect(mismatchesOf(effortOnly).length).toBeGreaterThan(0)
  })

  it('fails when the calendar outline loses its lead or carries a figure', () => {
    const wrongLead: SurfaceAdapter = {
      ...ics,
      name: 'effort-ics',
      read: (session, ctx) => ({ ...ics.read(session, ctx), lead: 'effort' }),
    }
    expect(mismatchesOf(wrongLead).length).toBeGreaterThan(0)
    const withCeiling: SurfaceAdapter = {
      ...ics,
      name: 'ceiling-ics',
      read: (session, ctx) => ({ ...ics.read(session, ctx), hrCeiling: 140 }),
    }
    expect(mismatchesOf(withCeiling).length).toBeGreaterThan(0)
    const withEffort: SurfaceAdapter = {
      ...ics,
      name: 'rpe-ics',
      read: (session, ctx) => ({ ...ics.read(session, ctx), effort: [3, 4] }),
    }
    expect(mismatchesOf(withEffort).length).toBeGreaterThan(0)
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

// ---------------------------------------------------------------------------------------------
// The fuel line (E6-5). It is another figure than the targets above (grams of carbohydrate an
// hour, not heart rate or pace), so it has its own adapters, but the rule is the same: one
// function, `fuelTargetFor`, decides, and every surface that carries the line reads it back. The
// surfaces are Today's watch text, the workout's description, the note of the first step of the
// FIT file and the intervals.icu event text. Each is read for every kind, planned, moved and
// eased, on a floor ladder and a stepped one, hot and not.
// ---------------------------------------------------------------------------------------------

describe('cross-surface fuel line', () => {
  const DATE = '2026-07-10'
  const SESSION_MIN = P.h7.logMinDurationMin.value + 30
  const REF: PublishReference = { maxHr: 190, lthr: 170, thresholdPaceMps: 3.8 }
  const HOT: WeatherIndex = { value: 33, index: 'air-temperature' }
  const STATUSES = ['planned', 'moved', 'downgraded'] as const

  const loggedRun: FuelRunInput = {
    activityId: 'run-1',
    date: '2026-07-01',
    startTime: null,
    elapsedSec: 3 * 3600,
    weather: null,
    sessionFlags: null,
    log: {
      skipped: false,
      items: [
        {
          name: 'Synthetic gel',
          carbsG: 40,
          sodiumMg: null,
          kcal: null,
          multiCarb: true,
          servings: 7,
        },
      ],
      gut: 0,
      nausea: null,
      hotOverride: null,
    },
  }

  /** The floor of the ladder, or the first step above it after one tolerated run. */
  function context(opts: { stepped: boolean; hot: boolean }): FuelContext {
    const settings = { optIn90: false, optInAdvanced: false, giDisease: false }
    const runs = opts.stepped ? [loggedRun] : []
    return {
      settings,
      ladder: replayLadder({ settings, runs, gutTrainingWeeks: [] }),
      peaks: { [DATE]: opts.hot ? HOT : null },
    }
  }

  /**
   * The session as the deliverable builder hands it to the fuel seam: the kind and minutes it is
   * run as (the eased ones when readiness eased it), the flags and the status it was planned with.
   */
  function fuelInput(
    planned: SessionSpec,
    source: SessionSpec,
    status: PlanSessionStatus,
  ): FuelSessionInput {
    return {
      id: 's1',
      date: planned.date,
      kind: source.kind,
      durationMin: source.durationMin,
      flags: planned.flags,
      status,
    }
  }

  function workoutOf(source: SessionSpec, fuelLine: string | null, eased: boolean): WorkoutPlan {
    return toWorkoutPlan(source, resolveTargets(source, zones, { hot: false }), {
      eased,
      fuelLine,
      units: 'km',
    })
  }

  interface FuelCase {
    planned: SessionSpec
    source: SessionSpec
    eased: boolean
    status: PlanSessionStatus
    ctx: FuelContext
    /** What the builder passes the surfaces: the pure function's line for this session. */
    line: string | null
  }

  /**
   * What a surface shows of the line. `dropped` is set only by a surface that left the line out on
   * purpose, with the reason; a line that is simply missing is a failure.
   */
  interface FuelRead {
    line: string | null
    dropped?: string
  }

  interface FuelSurface {
    name: string
    covers(kind: SessionKind): boolean
    read(c: FuelCase): FuelRead
  }

  const lineOf = (lines: readonly string[]): FuelRead => ({
    line: lines.findLast((line) => line.startsWith('Fuel ')) ?? null,
  })

  const byteLength = (text: string): number => new TextEncoder().encode(text).length

  /** The notes of the first step of a workout, as the file stores them. */
  const firstNote = (plan: WorkoutPlan): string =>
    expandWorkout(readWorkout(encodeWorkoutFit(plan, { createdAt: FIT_CREATED })))[0]?.notes ?? ''

  const FUEL_SURFACES: readonly FuelSurface[] = [
    {
      // Today's target line reads the target itself and words it. The slot the API serves is
      // asserted against the same words in tests/api/fuelLab.test.ts.
      name: 'today',
      covers: () => true,
      read: (c) => {
        const target = fuelTargetFor(c.ctx, fuelInput(c.planned, c.source, c.status))
        return { line: target === null ? null : describeFuelTarget(target).watch }
      },
    },
    {
      name: 'description',
      covers: publishable,
      read: (c) => lineOf(workoutOf(c.source, c.line, c.eased).description.split('\n')),
    },
    {
      name: 'fit',
      covers: publishable,
      read: (c) => {
        const plan = workoutOf(c.source, c.line, c.eased)
        const notes = firstNote(plan)
        // The note joins whole sentences, and the fuel line is the last of them.
        const at = notes.indexOf('Fuel ')
        if (at >= 0) return { line: notes.slice(at) }
        if (c.line === null) return { line: null }
        // A note holds 49 bytes, and a sentence that does not fit is left out whole, never cut
        // (E1-3); the description still carries the line. So the line may be missing only when the
        // rest of the note, joined as the encoder joins it, leaves it no room. The file then
        // reports the drop; any other note without the line is a bug.
        const rest = firstNote({ ...plan, fuelLine: null })
        const joined = rest === '' ? c.line : `${rest}${rest.endsWith('.') ? ' ' : '. '}${c.line}`
        if (byteLength(joined) <= FIT_NOTES_MAX_BYTES) {
          throw new Error(`The note lost the line: ${notes}`)
        }
        return {
          line: null,
          dropped: `${String(byteLength(joined))} bytes in a ${String(FIT_NOTES_MAX_BYTES)}-byte note`,
        }
      },
    },
    {
      name: 'intervals',
      covers: publishable,
      read: (c) =>
        lineOf(
          renderIntervalsDescription(workoutOf(c.source, c.line, c.eased), REF).text.split('\n'),
        ),
    },
  ]

  function* cases(): Generator<FuelCase & { label: string }> {
    for (const kind of SESSION_KINDS) {
      for (const status of STATUSES) {
        for (const eased of [false, true]) {
          for (const stepped of [false, true]) {
            for (const hot of [false, true]) {
              const ctx = context({ stepped, hot })
              const planned = prescribed(kind, zones, { date: DATE, durationMin: SESSION_MIN })
              const source = eased ? easedSession(planned, zones) : planned
              yield {
                label: `${kind} ${status} eased=${String(eased)} stepped=${String(stepped)} hot=${String(hot)}`,
                planned,
                source,
                eased: source !== planned,
                status,
                ctx,
                line: fuelLineForSession(ctx, fuelInput(planned, source, status)),
              }
            }
          }
        }
      }
    }
  }

  it('covers every kind, status, easing, ladder position and weather', () => {
    // 16 kinds x 3 statuses x eased x stepped x hot
    expect([...cases()]).toHaveLength(16 * 3 * 2 * 2 * 2)
  })

  it('has a line for each run kind and none for the rest', () => {
    const none: SessionKind[] = ['strength', 'mobility', 'rest', 'race', 'cross']
    for (const c of cases()) {
      const kind = c.source.kind
      expect(c.line === null, c.label).toBe(none.includes(kind))
    }
  })

  it.each(FUEL_SURFACES.map((s) => [s.name, s] as const))(
    '%s carries the line the pure function gives, or reports that it left the line out',
    (_name, surface) => {
      const wrong: string[] = []
      for (const c of cases()) {
        if (!surface.covers(c.planned.kind)) continue
        const read = surface.read(c)
        // A surface that dropped the line says so, and only where there was a line to drop.
        if (read.dropped !== undefined) {
          if (read.line !== null || c.line === null) {
            wrong.push(`${c.label}: reports a drop with no line missing`)
          }
          continue
        }
        if (read.line !== c.line) {
          wrong.push(`${c.label}: ${String(read.line)} instead of ${String(c.line)}`)
        }
      }
      expect(wrong).toEqual([])
    },
  )

  it('reports a dropped line on the FIT file for every eased run, and on no other surface', () => {
    const droppedBy = new Map<string, string[]>(FUEL_SURFACES.map((s) => [s.name, []]))
    const eased: string[] = []
    for (const c of cases()) {
      for (const surface of FUEL_SURFACES) {
        if (!surface.covers(c.planned.kind)) continue
        const read = surface.read(c)
        if (read.dropped !== undefined) droppedBy.get(surface.name)!.push(c.label)
        // "Eased for today" and the shortest line are over 49 bytes together (E1-3).
        if (surface.name === 'fit' && c.eased && c.line !== null) {
          eased.push(c.label)
          expect(read.dropped, c.label).toBeDefined()
        }
      }
    }
    expect(eased.length).toBeGreaterThan(0)
    expect(droppedBy.get('fit')!.length).toBeGreaterThanOrEqual(eased.length)
    for (const surface of FUEL_SURFACES.filter((s) => s.name !== 'fit')) {
      expect(droppedBy.get(surface.name), surface.name).toEqual([])
    }
  })

  it('names the grams of the target on every surface, the floor held on a hot day', () => {
    for (const { stepped, hot, grams } of [
      { stepped: false, hot: false, grams: 30 },
      { stepped: true, hot: false, grams: 60 },
      { stepped: true, hot: true, grams: 30 },
    ]) {
      const ctx = context({ stepped, hot })
      const planned = prescribed('long', zones, { date: DATE, durationMin: SESSION_MIN })
      const target = fuelTargetFor(ctx, fuelInput(planned, planned, 'planned'))!
      expect(target.gPerH).toBe(grams)
      const c: FuelCase = {
        planned,
        source: planned,
        eased: false,
        status: 'planned',
        ctx,
        line: fuelLineForSession(ctx, fuelInput(planned, planned, 'planned')),
      }
      for (const surface of FUEL_SURFACES) {
        const read = surface.read(c)
        expect(read.line, surface.name).toMatch(
          new RegExp(`^Fuel ${String(grams)}(?: to \\d+)? g/h carbs\\. Drink to thirst\\.$`),
        )
      }
    }
  })

  it('names the same grams for a moved run, a trimmed run, an eased run and the run as planned', () => {
    const ctx = context({ stepped: true, hot: false })
    const planned = prescribed('long-fast-finish', zones, { date: DATE, durationMin: SESSION_MIN })
    const lines = [
      ...STATUSES.map((status) => fuelLineForSession(ctx, fuelInput(planned, planned, status))),
      fuelLineForSession(ctx, fuelInput(planned, easedSession(planned, zones), 'planned')),
    ]
    expect(new Set(lines)).toEqual(new Set(['Fuel 60 g/h carbs. Drink to thirst.']))
  })

  it('gives no line to a settled session, a race or a run too short', () => {
    const ctx = context({ stepped: false, hot: false })
    const planned = prescribed('long', zones, { date: DATE, durationMin: SESSION_MIN })
    for (const status of ['completed', 'partial', 'skipped'] as const) {
      expect(fuelLineForSession(ctx, fuelInput(planned, planned, status))).toBeNull()
    }
    const race = prescribed('race', zones, { date: DATE, durationMin: SESSION_MIN })
    expect(fuelLineForSession(ctx, fuelInput(race, race, 'planned'))).toBeNull()
    const short = prescribed('long', zones, {
      date: DATE,
      durationMin: P.h7.logMinDurationMin.value - 1,
    })
    expect(fuelLineForSession(ctx, fuelInput(short, short, 'planned'))).toBeNull()
  })

  it('fails when a surface keeps its own grams', () => {
    const ctx = context({ stepped: true, hot: false })
    const planned = prescribed('long', zones, { date: DATE, durationMin: SESSION_MIN })
    const c: FuelCase = {
      planned,
      source: planned,
      eased: false,
      status: 'planned',
      ctx,
      line: 'Fuel 45 g/h carbs. Drink to thirst.',
    }
    const stale = FUEL_SURFACES.filter((s) => s.name !== 'today').map((s) => s.read(c).line)
    expect(
      stale.every(
        (read) => read === fuelLineForSession(ctx, fuelInput(planned, planned, 'planned')),
      ),
    ).toBe(false)
  })
})

import type { SerializedRequest } from 'pino'
import { describe, expect, it } from 'vitest'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { easedSession } from '../../../shared/engine/readiness.ts'
import { prescribe, type PrescribeContext } from '../../../shared/engine/sessions.ts'
import { rungSessions, sessionMin } from '../../../shared/engine/startWeeks.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type { SessionKind, SessionSpec, ZoneSet } from '../../../shared/engine/types.ts'
import type { Units } from '../../../shared/types.ts'
import {
  escapeText,
  foldLine,
  icsOutline,
  icsUid,
  renderIcs,
  type IcsEvent,
} from '../../../server/services/ics.ts'
import { publishable } from '../../../shared/workouts/labels.ts'
import { toWorkoutPlan } from '../../../shared/workouts/plan.ts'
import type { WorkoutPlan } from '../../../shared/workouts/types.ts'
import { redactedRequest, redactFeedToken } from '../../../server/routes/calendar.ts'
import { SESSION_KINDS, weekFixture, zoneSetFixture } from '../engine/fixtures.ts'

// The private calendar feed as text (design 6.5): RFC 5545 escaping and folding, the all-day
// events, a deterministic stamp, and an outline of the steps that holds no figure and no reason.

const zones = zoneSetFixture()
const RUNS = SESSION_KINDS.filter(publishable)
const UNITS: readonly Units[] = ['km', 'mi']
const octets = (text: string) => new TextEncoder().encode(text).length

/** Wording that must not leave the app in a calendar: health, a reason, the run-walk ladder. */
const HEALTH =
  /injur|illness|\bill\b|sick|pain|niggle|rehab|return|post-race|after the race|\beased?\b|easier|run-walk|run walk|\bwalk|readiness|reason|heart|bpm|fuel|carb/i

function make(
  kind: SessionKind,
  minutes: number,
  ctx: PrescribeContext = { goalPaceSecPerKm: 330 },
  flags: string[] = [],
): SessionSpec {
  return {
    ...prescribe(kind, minutes, zones, weekFixture({ flags }), ctx),
    date: '2026-07-10',
    order: 1,
  }
}

function ladder(rung: number, blueprint: readonly number[]): SessionSpec {
  return make('easy', sessionMin(blueprint), { blueprint }, [
    'restart-floor',
    'run-walk',
    `ladder-${String(rung)}`,
  ])
}

interface Variant {
  z?: ZoneSet
  hot?: boolean
  eased?: boolean
  units?: Units
  fuelLine?: string | null
}

function planOf(session: SessionSpec, v: Variant = {}): WorkoutPlan {
  const z = v.z ?? zones
  const source = v.eased ? easedSession(session, z) : session
  const targets = resolveTargets(source, z, { hot: v.hot ?? false })
  return toWorkoutPlan(source, targets, {
    eased: v.eased ?? false,
    fuelLine: v.fuelLine ?? null,
    units: v.units ?? 'km',
  })
}

/** The physical lines of a document, folded lines joined again. */
function unfold(text: string): string[] {
  const lines: string[] = []
  for (const physical of text.split('\r\n')) {
    if (physical.startsWith(' ') && lines.length > 0) lines[lines.length - 1] += physical.slice(1)
    else lines.push(physical)
  }
  return lines
}

const STAMP = '2026-10-22T12:34:56.789Z'
const event = (over: Partial<IcsEvent> = {}): IcsEvent => ({
  uid: icsUid('rl-a1b2c3-3f2b8c1e'),
  date: '2027-03-02',
  title: 'Easy run, 45 min',
  description: 'Run, kept easy',
  ...over,
})

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and line breaks (RFC 5545 3.3.11)', () => {
    expect(escapeText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d')
    expect(escapeText('one\ntwo')).toBe('one\\ntwo')
    expect(escapeText('one\r\ntwo\rthree')).toBe('one\\ntwo\\nthree')
  })

  it('drops control characters and keeps a tab and non-ASCII text', () => {
    expect(escapeText('a\u0000b\u0007c\u007fd')).toBe('abcd')
    expect(escapeText('a\tb')).toBe('a\tb')
    expect(escapeText('Côte d’Azur ✓')).toBe('Côte d’Azur ✓')
  })
})

describe('foldLine', () => {
  it('leaves a line of up to 75 octets alone', () => {
    const line = `X:${'a'.repeat(73)}`
    expect(octets(line)).toBe(75)
    expect(foldLine(line)).toBe(line)
  })

  it('folds a longer line so that no physical line passes 75 octets, continuation space included', () => {
    const line = `DESCRIPTION:${'word '.repeat(60)}`
    const folded = foldLine(line)
    const physical = folded.split('\r\n')
    expect(physical.length).toBeGreaterThan(1)
    for (const part of physical) expect(octets(part)).toBeLessThanOrEqual(75)
    for (const part of physical.slice(1)) expect(part.startsWith(' ')).toBe(true)
    expect(unfold(folded)).toEqual([line])
  })

  it('never splits a multi-byte character', () => {
    // 3-byte and 4-byte characters, at every offset against the fold point
    for (let pad = 0; pad < 8; pad += 1) {
      const line = `${'a'.repeat(60 + pad)}${'€'.repeat(12)}${'🏃'.repeat(6)}${'é'.repeat(20)}`
      const folded = foldLine(line)
      for (const part of folded.split('\r\n')) expect(octets(part)).toBeLessThanOrEqual(75)
      expect(unfold(folded)).toEqual([line])
      expect(folded).not.toContain('�')
    }
  })
})

describe('renderIcs', () => {
  const feed = (events: IcsEvent[], over: { timeZone?: string | null; stamp?: string } = {}) =>
    renderIcs({ timeZone: over.timeZone ?? null, stamp: over.stamp ?? STAMP, events })

  it('is a calendar of CRLF lines, none longer than 75 octets', () => {
    const text = feed([event(), event({ uid: icsUid('x'), description: 'Run, '.repeat(40) })])
    expect(text.endsWith('\r\n')).toBe(true)
    expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
    const lines = text.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines.at(-2)).toBe('END:VCALENDAR')
    for (const line of lines) expect(octets(line)).toBeLessThanOrEqual(75)
    const header = unfold(text).slice(0, 8)
    expect(header).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//running-log//plan feed//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Running plan',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
    ])
  })

  it('writes an all-day event: a start date, the next day as its end, not blocking the time', () => {
    expect(unfold(feed([event()]))).toContain('BEGIN:VEVENT')
    const lines = unfold(feed([event()]))
    const at = lines.indexOf('BEGIN:VEVENT')
    expect(lines.slice(at, at + 9)).toEqual([
      'BEGIN:VEVENT',
      'UID:rl-a1b2c3-3f2b8c1e@running-log',
      'DTSTAMP:20261022T123456Z',
      'DTSTART;VALUE=DATE:20270302',
      'DTEND;VALUE=DATE:20270303',
      'SUMMARY:Easy run\\, 45 min',
      'DESCRIPTION:Run\\, kept easy',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ])
  })

  it('ends an event on the first of the next month, the next year and after a leap day', () => {
    const ends = (date: string) =>
      unfold(feed([event({ date })])).find((line) => line.startsWith('DTEND'))
    expect(ends('2026-12-31')).toBe('DTEND;VALUE=DATE:20270101')
    expect(ends('2027-01-31')).toBe('DTEND;VALUE=DATE:20270201')
    expect(ends('2028-02-28')).toBe('DTEND;VALUE=DATE:20280229')
    expect(ends('2028-02-29')).toBe('DTEND;VALUE=DATE:20280301')
  })

  it('writes the description as escaped lines, and none when there is nothing to outline', () => {
    const outline = 'Warm up\nRepeat: Fast, at target pace; Recover\nCool down'
    const text = unfold(feed([event({ description: outline })])).join('\n')
    expect(text).toContain(
      'DESCRIPTION:Warm up\\nRepeat: Fast\\, at target pace\\; Recover\\nCool down',
    )
    expect(unfold(feed([event({ description: null })])).join('\n')).not.toContain('DESCRIPTION')
    expect(unfold(feed([event({ description: '' })])).join('\n')).not.toContain('DESCRIPTION')
  })

  it('stamps every event with the given instant, not the clock', () => {
    const text = feed([event(), event({ uid: icsUid('y') })], { stamp: '2026-01-02T03:04:05Z' })
    expect(unfold(text).filter((line) => line.startsWith('DTSTAMP'))).toEqual([
      'DTSTAMP:20260102T030405Z',
      'DTSTAMP:20260102T030405Z',
    ])
  })

  it('gives the same bytes for the same input', () => {
    const events = [event(), event({ uid: icsUid('z'), date: '2027-03-03', title: 'Long run' })]
    expect(feed(events)).toBe(feed(events))
    expect(feed(events, { timeZone: 'Europe/London' })).toBe(
      feed(events, { timeZone: 'Europe/London' }),
    )
  })

  it("carries the runner's time zone as the calendar's own, when there is one", () => {
    expect(unfold(feed([event()], { timeZone: 'America/Chicago' }))).toContain(
      'X-WR-TIMEZONE:America/Chicago',
    )
    expect(feed([event()])).not.toContain('X-WR-TIMEZONE')
    // all-day events are dates: no clock time and no zone on a start or an end
    const times = unfold(feed([event()], { timeZone: 'Pacific/Auckland' })).filter(
      (line) => line.startsWith('DTSTART') || line.startsWith('DTEND'),
    )
    for (const line of times) expect(line).toMatch(/^DT(START|END);VALUE=DATE:\d{8}$/)
  })

  it('is still a calendar with no event, and needs no stamp then', () => {
    const text = feed([], { stamp: 'not an instant' })
    expect(text).not.toContain('VEVENT')
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('rejects a date or an instant that is not one', () => {
    expect(() => feed([event({ date: '2027-02-30' })])).toThrow(RangeError)
    expect(() => feed([event({ date: 'tomorrow' })])).toThrow(RangeError)
    expect(() => feed([event()], { stamp: 'yesterday' })).toThrow(RangeError)
  })

  it('escapes whatever it is given, so a title cannot add a property', () => {
    const text = feed([event({ title: 'Run\r\nATTENDEE:mailto:x@example.com' })])
    expect(unfold(text).some((line) => line.startsWith('ATTENDEE'))).toBe(false)
    expect(unfold(text)).toContain('SUMMARY:Run\\nATTENDEE:mailto:x@example.com')
  })

  it('makes the UID of an event from the id at the publish channel', () => {
    expect(icsUid('rl-a1b2c3-3f2b8c1e-0000-4000-8000-123456789abc')).toBe(
      'rl-a1b2c3-3f2b8c1e-0000-4000-8000-123456789abc@running-log',
    )
  })
})

describe('icsOutline', () => {
  it('names the steps and how they are run', () => {
    expect(icsOutline(planOf(make('easy', 45)))).toBe('Run, kept easy')
    expect(icsOutline(planOf(make('intervals', 60)))).toBe(
      'Warm up\nRepeat: Fast, at target pace; Recover\nCool down',
    )
    expect(icsOutline(planOf(make('threshold', 60)))).toBe(
      'Warm up\nThreshold, at target pace\nRecover\nThreshold, at target pace\nCool down',
    )
    expect(icsOutline(planOf(make('hike', 90)))).toBe('Hike, by effort')
  })

  it('says by effort on a day steered by heat, the same words as the watch', () => {
    expect(icsOutline(planOf(make('long', 120), { hot: true }))).toBe('Run, by effort')
    expect(icsOutline(planOf(make('intervals', 60), { hot: true }))).toBe(
      'Warm up\nRepeat: Fast, by effort; Recover\nCool down',
    )
  })

  it('holds no number for any run, hot or not, eased or not, in either unit', () => {
    let seen = 0
    for (const kind of RUNS) {
      for (const hot of [false, true]) {
        for (const eased of [false, true]) {
          for (const units of UNITS) {
            for (const minutes of [20, 45, 90, 150]) {
              const outline = icsOutline(planOf(make(kind, minutes), { hot, eased, units }))
              const label = `${kind} ${String(minutes)} hot=${String(hot)} eased=${String(eased)}`
              expect(outline, label).not.toMatch(/\d/)
              expect(outline, label).not.toMatch(HEALTH)
              expect(outline, label).not.toBe('')
              assertCleanCopy(outline, label)
              seen += 1
            }
          }
        }
      }
    }
    expect(seen).toBe(RUNS.length * 2 * 2 * 2 * 4)
  })

  it('carries no fuel line, no heat note and no mention of an eased day', () => {
    const fuel = 'Tonight: 60 g of carbohydrate in the last hour.'
    const plan = planOf(make('long', 150), { fuelLine: fuel, hot: true })
    expect(plan.description).toContain(fuel)
    const outline = icsOutline(plan)
    expect(outline).toBe('Run, by effort')
    const eased = planOf(make('intervals', 60), { eased: true })
    expect(eased.eased).toBe(true)
    expect(icsOutline(eased)).toBe('Run, kept easy')
    expect(icsOutline(eased)).toBe(icsOutline(planOf(make('easy', 60))))
  })

  it('reads a run-walk ladder as the easy run its title says it is', () => {
    for (let rung = 1; rung <= 9; rung += 1) {
      for (const blueprint of rungSessions(rung)) {
        const outline = icsOutline(planOf(ladder(rung, blueprint)))
        expect(outline, `rung ${String(rung)}`).not.toMatch(HEALTH)
        expect(outline, `rung ${String(rung)}`).not.toMatch(/\d/)
        expect(outline).not.toBe('')
      }
    }
  })
})

describe('redactFeedToken', () => {
  const route = '/api/calendar/:token/plan.ics'

  it('names the route in place of the token, whatever the case and the query', () => {
    expect(redactFeedToken(`/api/calendar/${'A'.repeat(43)}/plan.ics`)).toBe(route)
    expect(redactFeedToken('/API/Calendar/abc_DEF-123/plan.ics')).toBe(
      '/API/Calendar/:token/plan.ics',
    )
    expect(redactFeedToken('/api/calendar/abc/plan.ics?x=1')).toBe(`${route}?x=1`)
    expect(redactFeedToken('/api/calendar/abc')).toBe('/api/calendar/:token')
    expect(redactFeedToken('/api/calendar/abc?x=1')).toBe('/api/calendar/:token?x=1')
  })

  it('leaves every other URL as it is', () => {
    for (const url of [
      '/api/plan?x=1',
      '/api/wrist/calendar/token',
      '/api/calendars/abc/plan.ics',
      '/api/calendar',
      '/api/calendar/',
      '/api/ingest/apple-health',
      '/calendar/abc/plan.ics',
    ]) {
      expect(redactFeedToken(url), url).toBe(url)
    }
  })

  it('redacts the url and the route parameter of a logged request, and nothing else', () => {
    const serialized = {
      id: 'r1',
      method: 'GET',
      url: '/api/calendar/secret-token/plan.ics',
      query: {},
      params: { token: 'secret-token' },
      headers: { host: 'app.test' },
      remoteAddress: '::1',
      remotePort: 1,
    } as unknown as SerializedRequest
    const out = redactedRequest(serialized)
    expect(out.url).toBe(route)
    expect(out.params).toEqual({ token: ':token' })
    expect(out.headers).toEqual({ host: 'app.test' })
    expect(JSON.stringify(out)).not.toContain('secret-token')
    // a request without parameters gets none made up
    const plain = redactedRequest({
      id: 'r2',
      method: 'GET',
      url: '/api/plan',
    } as unknown as SerializedRequest)
    expect(plain).toEqual({ id: 'r2', method: 'GET', url: '/api/plan' })
  })
})

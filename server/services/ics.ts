// The private calendar feed as iCalendar text (RFC 5545) [design 6.4 and 6.5]: one all-day event
// per session, rendered from the same `WorkoutPlan` as the watch and the workout file. What it
// writes is public in the sense that matters here: whoever holds the link reads it. So an event
// carries the allowlisted title (`publicTitle`: the kind and the length) and an outline of the
// steps that names no figure and no reason. A figure of the plan, a heart rate, a pace or a fuel
// line, stays on the watch and in the app; the reason a session was changed is never written.
// Pure and deterministic: no clock is read, nothing touches the database, and it imports only
// shared code, so a unit test can render a feed without an app.
import { render } from '../../shared/copy/template.ts'
import { WORKOUT_TEMPLATES } from '../../shared/copy/workouts.ts'
import { addDays } from '../../shared/dates.ts'
import { effortPhrase, isEffortStep } from '../../shared/workouts/plan.ts'
import type { WorkoutPlan, WorkoutStep } from '../../shared/workouts/types.ts'

/** The domain of an event's UID: `<remote external id>@running-log`. */
export const ICS_UID_DOMAIN = 'running-log'

/** The UID of the event of a session, from its id at the publish channel (`workoutExternalId`). */
export function icsUid(remoteId: string): string {
  return `${remoteId}@${ICS_UID_DOMAIN}`
}

/** How often a calendar app is asked to look again; the feed is cheap and the plan moves slowly. */
const REFRESH_INTERVAL = 'PT1H'

/** RFC 5545 3.1: a line is at most 75 octets, the CRLF not counted. */
const MAX_LINE_OCTETS = 75

// ---------------------------------------------------------------------------------------------
// The outline of a session
// ---------------------------------------------------------------------------------------------

type CueId = Extract<keyof typeof WORKOUT_TEMPLATES, `workout.ics.cue.${string}`>

const cue = (id: CueId, plan: WorkoutPlan): string => render(WORKOUT_TEMPLATES[id], {}, plan.units)

/**
 * How a step is run, in words: the cue that stands for its target. A day steered by effort (heat,
 * a hill session, a hike) cues every running step "by effort"; otherwise the kind of target decides
 * and a warm-up, cool-down or recovery, which carries none, has no cue. The words follow the
 * resolver's mode (`pace`, a heart-rate ceiling or band, effort), so the feed leads with what the
 * hero leads with, and no figure appears.
 */
function cueOf(step: WorkoutStep, plan: WorkoutPlan): string | null {
  if (plan.targets.mode === 'effort' && isEffortStep(step)) return effortPhrase(plan.units)
  switch (step.target.kind) {
    case 'pace':
      return cue('workout.ics.cue.pace', plan)
    case 'hr-ceiling':
      return cue('workout.ics.cue.easy', plan)
    case 'hr-band':
      return cue('workout.ics.cue.steady', plan)
    case 'open':
      return null
  }
}

function stepText(step: WorkoutStep, plan: WorkoutPlan): string {
  const tail = cueOf(step, plan)
  return tail === null ? step.label : `${step.label}, ${tail}`
}

/**
 * The description of an event: the steps of the session by name and cue, one line for each step or
 * repeated block, with no length, count, heart rate, pace or fuel line. The eased flag is not read:
 * the easy version of a day is just an easy run. Walking steps are left out, so a run-walk ladder
 * reads as the "Easy run" its title says it is.
 */
export function icsOutline(plan: WorkoutPlan): string {
  const lines: string[] = []
  for (const node of plan.nodes) {
    if (node.type === 'step') {
      if (!node.walk) lines.push(stepText(node, plan))
      continue
    }
    const body = node.steps
      .filter((step) => !step.walk)
      .map((step) => stepText(step, plan))
      .join('; ')
    if (body !== '') {
      lines.push(render(WORKOUT_TEMPLATES['workout.ics.repeat'], { steps: body }, plan.units))
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------------------------
// iCalendar text
// ---------------------------------------------------------------------------------------------

const encoder = new TextEncoder()

/** A control character other than a tab has no place in a content line (line breaks are escaped first). */
const isControl = (code: number): boolean => (code < 0x20 && code !== 0x09) || code === 0x7f

/**
 * A TEXT value (RFC 5545 3.3.11): backslash, semicolon and comma are escaped and a line break is
 * written `\n`. Other control characters are dropped.
 */
export function escapeText(value: string): string {
  let out = ''
  for (const char of value.replace(/\r\n?/g, '\n')) {
    if (char === '\n') out += '\\n'
    else if (char === '\\' || char === ';' || char === ',') out += `\\${char}`
    else if (!isControl(char.codePointAt(0)!)) out += char
  }
  return out
}

/**
 * Folds a content line at 75 octets (RFC 5545 3.1): each continuation starts with one space, and a
 * UTF-8 sequence is never split. A line that fits is returned as it is.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line
  const parts: string[] = []
  let current = ''
  let octets = 0
  let limit = MAX_LINE_OCTETS
  for (const char of line) {
    const size = encoder.encode(char).length
    if (octets + size > limit) {
      parts.push(current)
      current = ''
      octets = 0
      // the space that starts a continuation counts as an octet of the line
      limit = MAX_LINE_OCTETS - 1
    }
    current += char
    octets += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/** `20261022T120000Z` for an instant. */
function stamp(instant: string): string {
  const at = new Date(instant)
  if (Number.isNaN(at.getTime()))
    throw new RangeError(`Invalid instant: ${JSON.stringify(instant)}`)
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

/** `20270302` for a `YYYY-MM-DD` date; throws a RangeError for anything else. */
const day = (date: string): string => addDays(date, 0).replaceAll('-', '')

/** One session on one day of the feed. */
export interface IcsEvent {
  /** `icsUid(remoteId)`. */
  uid: string
  /** The runner's local day, `YYYY-MM-DD`. */
  date: string
  /** `publicTitle` of the session. */
  title: string
  /** `icsOutline`, or null for a day with nothing to outline (a race, a strength session). */
  description: string | null
}

export interface IcsFeed {
  /**
   * The runner's IANA time zone, written as the calendar's own (`X-WR-TIMEZONE`), or null. The
   * events are all-day dates with no clock time, so no zone can move one to another day.
   */
  timeZone: string | null
  /** DTSTAMP of every event, an instant: the newest update of the plan, never the clock. */
  stamp: string
  events: readonly IcsEvent[]
}

/**
 * The feed as one iCalendar document: CRLF line ends, folded lines, all-day events (`DTSTART` and
 * `DTEND` as dates, the end the next day) that do not block the runner's time. The same input gives
 * the same bytes, in the order of `events`.
 */
export function renderIcs(feed: IcsFeed): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//running-log//plan feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(render(WORKOUT_TEMPLATES['workout.ics.calendar-name'], {}, 'km'))}`,
    ...(feed.timeZone === null ? [] : [`X-WR-TIMEZONE:${escapeText(feed.timeZone)}`]),
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
  ]
  const dtstamp = feed.events.length === 0 ? '' : stamp(feed.stamp)
  for (const event of feed.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${day(event.date)}`,
      `DTEND;VALUE=DATE:${day(addDays(event.date, 1))}`,
      `SUMMARY:${escapeText(event.title)}`,
      ...(event.description === null || event.description === ''
        ? []
        : [`DESCRIPTION:${escapeText(event.description)}`]),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(foldLine).join('\r\n')}\r\n`
}

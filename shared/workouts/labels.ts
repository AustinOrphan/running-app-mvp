// Names a session may carry outside the app [design 6.5, rule O1]. A title goes to a watch, a
// workout file and a calendar feed, which other people can see, so it comes from a closed list keyed
// by the kind of session and carries its length and nothing else: no injury, illness, pain, return,
// post-race, eased or run-walk wording, however the session came about. The engine's own `title`
// ("Return to running, level 2", "Run-walk, step 3") and every flag are ignored here on purpose.
import { formatQuantity } from '../copy/quantity.ts'
import { isLadderSession } from '../engine/startWeeks.ts'
import type { SessionKind, SessionSpec } from '../engine/types.ts'

interface PublicTitle {
  title: string
  /** The kind's name where a name field is short (15 bytes in a FIT file) and the title is longer. */
  short?: string
  /** The length follows the title ("Easy run, 45 min"); a race or a rest day has none. */
  withLength: boolean
}

/** The only titles a session can have outside the app, one per kind. */
export const PUBLIC_TITLES: Readonly<Record<SessionKind, PublicTitle>> = {
  easy: { title: 'Easy run', withLength: true },
  recovery: { title: 'Recovery run', withLength: true },
  long: { title: 'Long run', withLength: true },
  'long-fast-finish': { title: 'Long run', withLength: true },
  threshold: { title: 'Threshold run', withLength: true },
  intervals: { title: 'Intervals', withLength: true },
  'race-pace': { title: 'Race-pace run', withLength: true },
  strides: { title: 'Easy run with strides', short: 'Easy + strides', withLength: true },
  hills: { title: 'Hill repeats', withLength: true },
  hike: { title: 'Hike', withLength: true },
  b2b: { title: 'Back-to-back run', short: 'Back-to-back', withLength: true },
  strength: { title: 'Strength', withLength: true },
  mobility: { title: 'Mobility', withLength: true },
  rest: { title: 'Rest day', withLength: false },
  race: { title: 'Race day', withLength: false },
  cross: { title: 'Cross-training', withLength: true },
}

/**
 * Kinds that become a workout on a watch: runs and the hike. A race is run by effort on its own
 * plan, and strength, mobility, rest and cross-training have no running steps. Exhaustive, so a
 * kind added to the engine is a compile error here until it is classified.
 */
const PUBLISHABLE: Readonly<Record<SessionKind, boolean>> = {
  easy: true,
  recovery: true,
  long: true,
  'long-fast-finish': true,
  threshold: true,
  intervals: true,
  'race-pace': true,
  strides: true,
  hills: true,
  hike: true,
  b2b: true,
  strength: false,
  mobility: false,
  rest: false,
  race: false,
  cross: false,
}

/** Whether a session of this kind goes to a watch, a workout file or the calendar's workouts. */
export function publishable(kind: SessionKind): boolean {
  return PUBLISHABLE[kind]
}

/**
 * The title of a session outside the app: its kind from the allowlist and its length, "Easy run, 45
 * min". The kind and the length are all it reads. A session of the run-walk ladder is "Easy run"
 * with no length, because the engine keeps the two walks that frame it outside the session minutes
 * and a length would be wrong for the workout on the watch.
 */
export function publicTitle(
  session: Pick<SessionSpec, 'kind' | 'durationMin' | 'structure'>,
): string {
  const entry = PUBLIC_TITLES[session.kind]
  if (!entry.withLength || isLadderSession(session) || !(session.durationMin > 0)) {
    return entry.title
  }
  return `${entry.title}, ${formatQuantity({ kind: 'duration', sec: session.durationMin * 60 }, 'km')}`
}

/**
 * The title of a workout for a short name field: the kind's short name in place of its title where
 * the list has one ("Easy + strides"), then the length as in `publicTitle`. A title that is not the
 * allowlisted one of its kind is returned as it is. The field cuts the length when it does not fit.
 */
export function shortTitle(kind: SessionKind, title: string): string {
  const { title: base, short } = PUBLIC_TITLES[kind]
  return short !== undefined && title.startsWith(base)
    ? `${short}${title.slice(base.length)}`
    : title
}

/**
 * The kind of a session as it appears in the name of a workout file: lower case words joined by
 * hyphens, one per kind, never the title and never anything the engine wrote. A long run with a
 * fast finish is a long run on the watch, as in `PUBLIC_TITLES`. Exhaustive, like the titles.
 */
export const FILE_SLUGS: Readonly<Record<SessionKind, string>> = {
  easy: 'easy-run',
  recovery: 'recovery-run',
  long: 'long-run',
  'long-fast-finish': 'long-run',
  threshold: 'threshold-run',
  intervals: 'intervals',
  'race-pace': 'race-pace-run',
  strides: 'easy-run-with-strides',
  hills: 'hill-repeats',
  hike: 'hike',
  b2b: 'back-to-back-run',
  strength: 'strength',
  mobility: 'mobility',
  rest: 'rest-day',
  race: 'race-day',
  cross: 'cross-training',
}

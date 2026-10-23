import type { EngineWarning, ExecutionAssessment } from '../../shared/engine/types.ts'
import type { Units } from '../../shared/types.ts'
import { formatQuantity } from '../../shared/copy/quantity.ts'
import { formatShortDate } from './format.ts'

const FEET_PER_METRE = 3.28084
const M_PER_MILE = 1609.344

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g
// A bare "N m" in engine text is climbing; the lookbehind leaves the distance in "D' 120 m" alone,
// and the lookahead leaves "min", "m/s" and "m/h" alone.
const METRES = /(?<!D' )(?<![\d.])(\d+(?:\.\d+)?) m(?![\w/])/g
// A range shares its unit ("28-32 km", "42.2 to 80.5 km"), so both ends convert.
const KILOMETRES = /(?<![\d.])(\d+(?:\.\d+)?)(?:(-| to )(\d+(?:\.\d+)?))? km(?![\w/])/g
const SPEEDS = /(?<![\d.])(\d+(?:\.\d+)?) km\/h(?!\w)/g
const CLIMB_RATES = /(?<![\d.])(\d+(?:\.\d+)?) m\/h(?!\w)/g
const PACES = /(?<![\d:])(\d{1,2}):([0-5]\d) per km(?!\w)/g

/**
 * Engine messages in the viewer's words: ISO dates read "19 Oct", and with the `mi` setting climbs
 * in metres read in feet and distances in kilometres read in miles. The engine's own messages stay
 * as they are (metres, kilometres, ISO dates), so they are the same on every client.
 */
export function localiseEngineText(text: string, units: Units | undefined): string {
  const dated = text.replace(ISO_DATE, (iso) => {
    try {
      return formatShortDate(iso)
    } catch {
      return iso
    }
  })
  if (units !== 'mi') return dated
  return dated
    .replace(
      METRES,
      (_all, value: string) => `${String(Math.round(Number(value) * FEET_PER_METRE))} ft`,
    )
    .replace(
      KILOMETRES,
      (_all, from: string, joiner: string | undefined, to: string | undefined) =>
        `${kilometresAsMiles(from)}${joiner ?? ''}${to === undefined ? '' : kilometresAsMiles(to)} mi`,
    )
}

function kilometresAsMiles(value: string): string {
  return ((Number(value) * 1000) / M_PER_MILE).toFixed(1)
}

/**
 * A parameter note in the viewer's words. The note restates figures that sit beside the value
 * (`describeParamValue`), so it reads in the same units: `localiseEngineText` for climbs and
 * distances, and with the `mi` setting also speeds, climbing rates and paces, which engine messages
 * leave alone. Race classes are spelled `5K`, `50K` and `100K`, as the Goals page labels them,
 * so they never read as a distance to convert.
 */
export function localiseParamNote(note: string, units: Units | undefined): string {
  const text = localiseEngineText(note, units)
  if (units !== 'mi') return text
  return text
    .replace(SPEEDS, (_all, kmh: string) =>
      formatQuantity({ kind: 'speed', kmh: Number(kmh) }, 'mi'),
    )
    .replace(
      CLIMB_RATES,
      (_all, m: string) => `${formatQuantity({ kind: 'climb', m: Number(m) }, 'mi')}/h`,
    )
    .replace(PACES, (_all, min: string, sec: string) =>
      formatQuantity({ kind: 'pace', secPerKm: Number(min) * 60 + Number(sec) }, 'mi'),
    )
}

/** One line of the warnings panel: warnings of the same code together. */
export interface WarningGroup {
  code: string
  severity: EngineWarning['severity']
  /** One sentence: the localised message of a lone warning, or a count summary for several. */
  summary: string
  /** The localised messages, one per warning; shown in a disclosure when there are several. */
  details: string[]
  rules: string[]
}

const SEVERITY_ORDER: Record<EngineWarning['severity'], number> = { info: 0, warn: 1, hold: 2 }

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

/** What several warnings of one code say together. Codes without an entry fall back to a count. */
const SUMMARIES: Record<string, (n: number) => string> = {
  'gain-ramp-soft': (n) => `Climbing above the 10% step in ${plural(n, 'week', 'weeks')}`,
  'ramp-soft': (n) => `Running time above the 10% step in ${plural(n, 'week', 'weeks')}`,
  'ramp-ceiling': (n) => `Running time held at the 2-week limit in ${plural(n, 'week', 'weeks')}`,
  'ramp-tightened': (n) =>
    `Running time held to the injury-profile ramp in ${plural(n, 'week', 'weeks')}`,
  'ramp-run-dropped': (n) =>
    `${plural(n, 'run', 'runs')} left out to keep weekly running time within its ramp`,
  'spike-shortened': (n) =>
    `${plural(n, 'run', 'runs')} shortened to stay near the longest recent run`,
  'spike-warn': (n) =>
    `${plural(n, 'run', 'runs')} above the usual step from the longest recent run`,
  'spike-run-dropped': (n) => `${plural(n, 'run', 'runs')} too short after a cut, left out`,
  'b2b-removed': (n) => `Back-to-back pairs dropped in ${plural(n, 'place', 'places')}`,
  'b2b-day2-cap': (n) =>
    `Second day of a back-to-back pair shortened in ${plural(n, 'week', 'weeks')}`,
  'b2b-total-cap': (n) =>
    `Second day of a back-to-back pair shortened in ${plural(n, 'week', 'weeks')}`,
}

/**
 * Groups warnings by code, in the order each code first appears. A code seen once keeps its own
 * message; a code seen several times becomes one line with the individual messages as details.
 */
export function groupWarnings(
  warnings: readonly EngineWarning[],
  units: Units | undefined,
): WarningGroup[] {
  const byCode = new Map<string, EngineWarning[]>()
  for (const warning of warnings) {
    byCode.set(warning.code, [...(byCode.get(warning.code) ?? []), warning])
  }
  return [...byCode.entries()].map(([code, items]) => {
    const details = items.map((w) => localiseEngineText(w.message, units))
    const severity = items.reduce<EngineWarning['severity']>(
      (top, w) => (SEVERITY_ORDER[w.severity] > SEVERITY_ORDER[top] ? w.severity : top),
      'info',
    )
    const summarise = SUMMARIES[code]
    const summary =
      items.length === 1
        ? details[0]!
        : summarise !== undefined
          ? summarise(items.length)
          : `${details[0]!} (and ${String(items.length - 1)} more like it)`
    return {
      code,
      severity,
      summary,
      details,
      rules: [...new Set(items.flatMap((w) => w.rules))],
    }
  })
}

/** The ask for a rating, wherever the app shows or invites the feedback behind an effort verdict. */
export const RATING_PROMPT = 'Rate this activity (effort or feel) so the plan can adjust.'

/**
 * The ask for an activity of a different kind than its planned session (completion `modified`):
 * it has no expected effort to set an RPE against, so only the feel rating counts.
 */
export const FEEL_PROMPT = 'Rate how this activity felt so the plan can adjust.'

/**
 * Whether the owner's rating of an activity counts toward its effort verdict, the same test as
 * `hasSubjectivePart` in shared/engine/execution.ts: an RPE counts unless the activity is of a
 * different kind than the planned session, and a feel always counts.
 */
export function ratingCounts(
  completion: ExecutionAssessment['completion'],
  rating: { rpe: number | null; feel: number | null },
): boolean {
  return rating.feel !== null || (completion !== 'modified' && rating.rpe !== null)
}

/**
 * What an effort verdict is without a rating (`hasSubjectivePart` in shared/engine/execution.ts):
 * a guess from heart rate and pace, held to low confidence, that never trims a session, proposes
 * a zone change or counts toward the weekly decision.
 */
const UNRATED_CAVEAT =
  "Without a rating, the plan's read of this activity stays a low-confidence guess from heart rate and pace, and the plan never changes because of it."

/**
 * The note beside an effort verdict that has no rating behind it. With no score there is no
 * verdict to call a guess, so only the ask remains.
 */
export function unratedEffortNote(
  score: ExecutionAssessment['effort']['score'],
  completion: ExecutionAssessment['completion'],
): string {
  const ask = completion === 'modified' ? FEEL_PROMPT : RATING_PROMPT
  return score === null ? ask : `${ask} ${UNRATED_CAVEAT}`
}

/**
 * One line for the why drawer, where the effort assessment's parameters are explained. It speaks
 * about the effort verdict only: check-ins, pain, illness and completion change the plan without
 * a rating.
 */
export const RATING_WHY_NOTE =
  'An effort verdict needs a rating of effort or feel: without one it rests on heart rate and pace alone, stays at low confidence, and never changes the plan on its own.'

import type { EngineWarning, ExecutionAssessment } from '../../shared/engine/types.ts'
import type { Units } from '../../shared/types.ts'
import { formatShortDate } from './format.ts'

const FEET_PER_METRE = 3.28084
const M_PER_MILE = 1609.344

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g
// A bare "N m" in engine text is climbing; the lookbehind leaves the distance in "D' 120 m" alone,
// and the lookahead leaves "min", "m/s" and "m/h" alone.
const METRES = /(?<!D' )(?<![\d.])(\d+(?:\.\d+)?) m(?![\w/])/g
const KILOMETRES = /(?<![\d.])(\d+(?:\.\d+)?) km(?![\w/])/g

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
      (_all, value: string) => `${((Number(value) * 1000) / M_PER_MILE).toFixed(1)} mi`,
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
 * What an effort verdict is without a rating (`hasSubjectivePart` in shared/engine/execution.ts):
 * a guess from heart rate and pace, held to low confidence, that never trims a session, proposes
 * a zone change or counts toward the weekly decision.
 */
const UNRATED_CAVEAT =
  "Without a rating, the plan's read of this activity stays a low-confidence guess from heart rate and pace, and the plan never changes because of it."

/**
 * The note beside an effort verdict that has no RPE and no feel behind it. With no score there is
 * no verdict to call a guess, so only the ask remains.
 */
export function unratedEffortNote(score: ExecutionAssessment['effort']['score']): string {
  return score === null ? RATING_PROMPT : `${RATING_PROMPT} ${UNRATED_CAVEAT}`
}

/** One line for the why drawer, where the effort assessment's parameters are explained. */
export const RATING_WHY_NOTE =
  'An adjustment needs a rating of effort or feel: without one, the effort read rests on heart rate and pace alone, stays at low confidence, and never changes the plan.'

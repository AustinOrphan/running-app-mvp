// The targets of a session as the hero words them: a term, its value and a note per figure, in
// the order the resolver's lead gives (`resolveTargets`, design 4.6). Every figure comes from the
// resolved targets the server sent; this module only words them, in the runner's units. The hero
// (`web/components/today/SessionTargets.tsx`) and the key session of the weekly brief
// (`briefRender.ts`) both call it, so the two read the same words from the same figures.
import type { ResolvedTargets } from '../engine/types.ts'
import type { Units } from '../types.ts'
import { formatRange } from './quantity.ts'
import { render } from './template.ts'
import { TEMPLATES } from './templates.ts'

/** The figures `targetRows` reads; a stored brief keeps these and none of the resolver's notes. */
export type TargetFigures = Pick<
  ResolvedTargets,
  'mode' | 'hot' | 'hrCeiling' | 'hrRange' | 'paceSecPerKm' | 'rpe'
>

export type TargetKey = 'hr' | 'pace' | 'effort'

export interface TargetRow {
  key: TargetKey
  /** "Heart rate", "Pace" or "Effort". */
  term: string
  /** "under 149 bpm", "149 to 165 bpm", "about 9:20 to 10:28 /mi", "3 to 4 out of 10". */
  value: string
  /** What qualifies the figure ("It runs high in heat."), or null. */
  note: string | null
}

/** The order of the rows for each lead: the figure the day is run by comes first. */
const ORDER: Record<ResolvedTargets['mode'], readonly TargetKey[]> = {
  'hr-ceiling': ['hr', 'pace', 'effort'],
  'hr-band': ['hr', 'pace', 'effort'],
  pace: ['pace', 'effort', 'hr'],
  effort: ['effort', 'hr', 'pace'],
}

/** "3 to 4", or "3" when the range is one step. */
function effortRange(rpe: readonly [number, number]): string {
  return rpe[0] === rpe[1] ? String(rpe[0]) : `${String(rpe[0])} to ${String(rpe[1])}`
}

type PlainId =
  | 'today.target.term-hr'
  | 'today.target.term-pace'
  | 'today.target.term-effort'
  | 'today.target.note-pace-guide'
  | 'today.target.note-hot-effort'
  | 'today.target.note-hot-hr'

/** The rows of the targets that exist, lead first. A figure the session does not carry has no row. */
export function targetRows(targets: TargetFigures, units: Units): TargetRow[] {
  const plain = (id: PlainId): string => render(TEMPLATES[id], {}, units)
  const hot = targets.hot

  const rows: Record<TargetKey, TargetRow | null> = {
    hr: null,
    pace: null,
    effort: {
      key: 'effort',
      term: plain('today.target.term-effort'),
      value: render(TEMPLATES['today.target.effort'], { range: effortRange(targets.rpe) }, units),
      note: hot ? plain('today.target.note-hot-effort') : null,
    },
  }

  const hrValue =
    targets.hrCeiling !== null
      ? render(
          TEMPLATES['today.target.hr-ceiling'],
          { limit: { kind: 'bpm', bpm: targets.hrCeiling } },
          units,
        )
      : targets.hrRange !== null
        ? render(
            TEMPLATES['today.target.range'],
            {
              range: formatRange(
                { kind: 'bpm', bpm: targets.hrRange[0] },
                { kind: 'bpm', bpm: targets.hrRange[1] },
                units,
              ),
            },
            units,
          )
        : null
  if (hrValue !== null) {
    rows.hr = {
      key: 'hr',
      term: plain('today.target.term-hr'),
      value: hrValue,
      note: hot ? plain('today.target.note-hot-hr') : null,
    }
  }

  if (targets.paceSecPerKm !== null) {
    // Stored slow end first; a runner reads the quicker pace first.
    const [slow, fast] = targets.paceSecPerKm
    const range = formatRange(
      { kind: 'pace', secPerKm: fast },
      { kind: 'pace', secPerKm: slow },
      units,
    )
    const leads = targets.mode === 'pace'
    rows.pace = {
      key: 'pace',
      term: plain('today.target.term-pace'),
      value: render(
        TEMPLATES[leads ? 'today.target.range' : 'today.target.pace-guide'],
        { range },
        units,
      ),
      note: leads ? null : plain('today.target.note-pace-guide'),
    }
  }

  return ORDER[targets.mode].flatMap((key) => {
    const row = rows[key]
    return row === null ? [] : [row]
  })
}

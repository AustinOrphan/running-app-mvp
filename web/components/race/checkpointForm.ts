// What the checkpoint editor keeps while the runner types, and how it reads it back (rule H14,
// ADR 0018). Pure, so the sheet and its test share one reading. A draft holds text; a value that
// was saved and whose text is untouched keeps the stored number, so a save never drifts a distance
// that was only shown rounded (as the goal form does).
import {
  RACE_CHECKPOINT_CLIMB_MAX_M,
  RACE_CHECKPOINT_CUTOFF_MAX_SEC,
  RACE_CHECKPOINT_NAME_MAX,
} from '../../../shared/limits.ts'
import type { RaceCheckpointRow, Units } from '../../../shared/types.ts'
import { distanceInputText, parseDistance, parseMetres } from '../goalFormat.ts'

const SEC_PER_MIN = 60
const MIN_PER_DAY = 1440

export type CutoffMode = 'elapsed' | 'clock'

export interface PointDraft {
  /** A key for React; never sent. */
  key: string
  name: string
  distance: string
  gain: string
  loss: string
  cutoffMode: CutoffMode
  /** `H:MM` into the race, or `HH:MM` on the clock. */
  cutoff: string
  /** The day of a clock cutoff: 0 is the race date. */
  cutoffDay: number
  /** The saved row this draft started from, kept so untouched text keeps its stored value. */
  original: RaceCheckpointRow | null
}

export type PointField = 'name' | 'distance' | 'gain' | 'loss' | 'cutoff'
export type PointErrors = Partial<
  Record<PointField, 'name' | 'distance' | 'duplicate' | 'metres' | 'cutoff' | 'clock'>
>

/** Whole hours and minutes as `H:MM`; seconds below a minute are left to the stored value. */
export function elapsedText(sec: number): string {
  const minutes = Math.round(sec / SEC_PER_MIN)
  return `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}`
}

export function draftFrom(row: RaceCheckpointRow, key: string, units: Units): PointDraft {
  return {
    key,
    name: row.name,
    distance: distanceInputText(row.distanceM, units),
    gain: row.gainM === null ? '' : String(row.gainM),
    loss: row.lossM === null ? '' : String(row.lossM),
    cutoffMode: 'elapsed',
    cutoff: row.cutoffSec === null ? '' : elapsedText(row.cutoffSec),
    cutoffDay: 0,
    original: row,
  }
}

export function blankDraft(key: string): PointDraft {
  return {
    key,
    name: '',
    distance: '',
    gain: '',
    loss: '',
    cutoffMode: 'elapsed',
    cutoff: '',
    cutoffDay: 0,
    original: null,
  }
}

/** Seconds from `H:MM` (hours up to the 400-hour limit); null when the text is not that. */
export function parseElapsed(text: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(text.trim())
  if (!match) return null
  const sec = (Number(match[1]) * 60 + Number(match[2])) * SEC_PER_MIN
  return sec <= RACE_CHECKPOINT_CUTOFF_MAX_SEC ? sec : null
}

/** Minutes after midnight from `HH:MM`; null when the text is not a time of day. */
function clockMinutes(text: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export interface DraftContext {
  units: Units
  /** The course distance in metres; a point lies below it. */
  courseM: number
  /** Minutes after midnight of the start; null when the goal holds no start time. */
  startMin: number | null
}

export interface ParsedDrafts {
  /** One entry per draft, in the draft order; empty when the draft is fine. */
  errors: PointErrors[]
  /** The rows to send, in distance order, and the draft index of each; empty if any error. */
  rows: Array<{ row: RaceCheckpointRow; draftIndex: number }>
  ok: boolean
}

function parseOne(
  draft: PointDraft,
  context: DraftContext,
): { row: RaceCheckpointRow | null; errors: PointErrors } {
  const errors: PointErrors = {}
  const name = draft.name.trim()
  if (name === '' || name.length > RACE_CHECKPOINT_NAME_MAX) errors.name = 'name'

  const original = draft.original
  const distanceM =
    original !== null && draft.distance === distanceInputText(original.distanceM, context.units)
      ? original.distanceM
      : parseDistance(draft.distance, context.units)
  if (distanceM === null || distanceM >= context.courseM) errors.distance = 'distance'

  const metres = (text: string, stored: number | null | undefined, field: 'gain' | 'loss') => {
    if (
      original !== null &&
      stored !== undefined &&
      text === (stored === null ? '' : String(stored))
    ) {
      return stored
    }
    const value = parseMetres(text)
    if (value === undefined || (value ?? 0) > RACE_CHECKPOINT_CLIMB_MAX_M) {
      errors[field] = 'metres'
      return null
    }
    return value
  }
  const gainM = metres(draft.gain, original?.gainM, 'gain')
  const lossM = metres(draft.loss, original?.lossM, 'loss')

  let cutoffSec: number | null = null
  const text = draft.cutoff.trim()
  if (text !== '') {
    if (draft.cutoffMode === 'elapsed') {
      const untouched =
        original !== null && original.cutoffSec !== null && text === elapsedText(original.cutoffSec)
      cutoffSec = untouched ? original.cutoffSec : parseElapsed(text)
      if (cutoffSec === null) errors.cutoff = 'cutoff'
    } else {
      const minutes = clockMinutes(text)
      const elapsed =
        minutes === null || context.startMin === null
          ? null
          : (draft.cutoffDay * MIN_PER_DAY + minutes - context.startMin) * SEC_PER_MIN
      if (elapsed === null || elapsed < 0 || elapsed > RACE_CHECKPOINT_CUTOFF_MAX_SEC) {
        errors.cutoff = 'clock'
      } else {
        cutoffSec = elapsed
      }
    }
  }

  if (Object.keys(errors).length > 0 || distanceM === null) return { row: null, errors }
  return { row: { name, distanceM, gainM, lossM, cutoffSec }, errors }
}

/**
 * Reads every draft. The rows come back in distance order (the order the server wants), each with
 * the draft it came from so a refusal can be shown on the right point; two points at one distance
 * are refused on the later draft.
 */
export function parseDrafts(drafts: readonly PointDraft[], context: DraftContext): ParsedDrafts {
  const parsed = drafts.map((draft) => parseOne(draft, context))
  const errors = parsed.map((p) => p.errors)
  const seen = new Map<number, number>()
  parsed.forEach((p, index) => {
    if (p.row === null) return
    if (seen.has(p.row.distanceM)) errors[index] = { ...errors[index], distance: 'duplicate' }
    else seen.set(p.row.distanceM, index)
  })
  const ok = errors.every((e) => Object.keys(e).length === 0)
  const rows = ok
    ? parsed
        .map((p, draftIndex) => ({ row: p.row!, draftIndex }))
        .sort((a, b) => a.row.distanceM - b.row.distanceM)
    : []
  return { errors, rows, ok }
}

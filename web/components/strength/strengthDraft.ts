// The strength sheet's draft: what is entered, kept in local storage under `strength-draft:<log id>`
// so a reload or a dropped connection does not lose it (design 9.1). The log id is the sheet's own
// and the idempotency key of its save, so the draft carries it, and the sheet finds the draft again
// by what it is for (the session, the day and the activity), not by an id it no longer remembers.
// Every access is inside `try`: storage can be blocked or full, and the sheet then keeps no draft
// and works as before. The key's prefix is in `web/pwa/drafts.ts`, so `purgeDrafts` removes it.
import { isExerciseId } from '../../../shared/domain/strengthLibrary.ts'
import type { LoadSteps, StrengthWorkout, WorkoutLift } from '../../../shared/types.ts'
import { STRENGTH_DRAFT_PREFIX } from '../../pwa/drafts.ts'
import { REPS_LEFT_MAX, type Block, type FormState, type SetRow } from './strengthForm.ts'

/** What a draft is for: the session of the workout, the day, and the activity the sets attach to. */
export interface DraftContext {
  sessionId: string
  date: string
  activityId: string | null
}

/** One block as kept: the lift a swap put in its place, if any, and the sets. */
interface DraftBlock {
  key: string
  swapped: WorkoutLift | null
  rows: SetRow[]
}

export interface StrengthDraft extends DraftContext {
  /** The id of the save: the key of the draft is `strength-draft:` and this. */
  logId: string
  /** When it was last written, in epoch milliseconds: the newest of two drafts for one session wins. */
  at: number
  minutes: string
  effort: number | null
  pain: number | null
  notes: string
  blocks: DraftBlock[]
}

const keyOf = (logId: string): string => `${STRENGTH_DRAFT_PREFIX}${logId}`

// ---- What a stored draft may hold --------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumberOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value))

const isWhole = (value: unknown): value is number => Number.isInteger(value)

const isNumbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))

function isRange(value: unknown): value is { min: number; max: number } {
  return isRecord(value) && isWhole(value['min']) && isWhole(value['max'])
}

function isLoadSteps(value: unknown): value is LoadSteps {
  if (!isRecord(value)) return false
  if ('loadsG' in value) return isNumbers(value['loadsG'])
  return (
    typeof value['minG'] === 'number' &&
    typeof value['stepG'] === 'number' &&
    isNumberOrNull(value['maxG'])
  )
}

function isBasis(value: unknown): value is WorkoutLift['basis'] {
  if (!isRecord(value) || typeof value['rule'] !== 'string' || !Array.isArray(value['facts'])) {
    return false
  }
  return value['facts'].every(
    (fact) => isRecord(fact) && typeof fact['template'] === 'string' && isRecord(fact['slots']),
  )
}

/** A lift a draft holds for a swap: every field the sheet reads, of the type it reads. */
function isLift(value: unknown): value is WorkoutLift {
  if (!isRecord(value)) return false
  const { exerciseId, implement, rir, steps } = value
  return (
    typeof exerciseId === 'string' &&
    isExerciseId(exerciseId) &&
    typeof value['slot'] === 'string' &&
    (implement === null || typeof implement === 'string') &&
    isWhole(value['sets']) &&
    isRange(value['range']) &&
    isNumbers(value['targets']) &&
    isNumberOrNull(value['loadG']) &&
    (steps === null || isLoadSteps(steps)) &&
    (rir === null || isRange(rir)) &&
    typeof value['change'] === 'string' &&
    isNumberOrNull(value['usualLoadG']) &&
    isBasis(value['basis']) &&
    isRecord(value['evidence'])
  )
}

function parseRow(value: unknown): SetRow | null {
  if (!isRecord(value)) return null
  const { load, exactG, count, rir } = value
  if (typeof load !== 'string' || typeof count !== 'string') return null
  if (rir !== null && !(isWhole(rir) && rir >= 0 && rir <= REPS_LEFT_MAX)) return null
  if (exactG !== undefined && !isNumberOrNull(exactG)) return null
  return exactG === undefined ? { load, count, rir } : { load, exactG, count, rir }
}

function parseBlock(value: unknown): DraftBlock | null {
  if (!isRecord(value) || typeof value['key'] !== 'string' || !Array.isArray(value['rows'])) {
    return null
  }
  const rows = value['rows'].map(parseRow)
  if (rows.some((row) => row === null)) return null
  const swapped = value['swapped']
  if (swapped !== null && !isLift(swapped)) return null
  return { key: value['key'], swapped, rows: rows as SetRow[] }
}

const isScale = (value: unknown, max: number): value is number | null =>
  value === null || (isWhole(value) && value >= 0 && value <= max)

/** A draft from storage, or null when it is not one this sheet wrote. */
function parseDraft(value: unknown): StrengthDraft | null {
  if (!isRecord(value) || !Array.isArray(value['blocks'])) return null
  const { logId, sessionId, date, activityId, at, minutes, effort, pain, notes } = value
  if (
    typeof logId !== 'string' ||
    typeof sessionId !== 'string' ||
    typeof date !== 'string' ||
    (activityId !== null && typeof activityId !== 'string') ||
    typeof at !== 'number' ||
    typeof minutes !== 'string' ||
    !isScale(effort, 10) ||
    !isScale(pain, 10) ||
    typeof notes !== 'string'
  ) {
    return null
  }
  const blocks = value['blocks'].map(parseBlock)
  if (blocks.some((block) => block === null)) return null
  return {
    logId,
    sessionId,
    date,
    activityId,
    at,
    minutes,
    effort,
    pain,
    notes,
    blocks: blocks as DraftBlock[],
  }
}

// ---- Reading, writing and clearing -------------------------------------------------------------

/** The draft as it is kept for a state. */
export function draftOf(
  logId: string,
  context: DraftContext,
  state: FormState,
  at: number,
): StrengthDraft {
  return {
    ...context,
    logId,
    at,
    minutes: state.minutes,
    effort: state.effort,
    pain: state.pain,
    notes: state.notes,
    blocks: state.blocks.map((block) => ({
      key: block.key,
      swapped: block.shown === block.original ? null : block.shown,
      rows: block.rows,
    })),
  }
}

/**
 * The draft kept for this session on this day and activity, the newest when there are several, or
 * null. Found by scanning the keys under the prefix, because the id it was kept under is chosen
 * when the sheet first opens and is not known to a sheet that opens after a reload.
 */
export function readDraft(context: DraftContext): StrengthDraft | null {
  try {
    const storage = window.localStorage
    let found: StrengthDraft | null = null
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key === null || !key.startsWith(STRENGTH_DRAFT_PREFIX)) continue
      const text = storage.getItem(key)
      if (text === null) continue
      let draft: StrengthDraft | null
      try {
        draft = parseDraft(JSON.parse(text))
      } catch {
        continue
      }
      if (
        draft === null ||
        keyOf(draft.logId) !== key ||
        draft.sessionId !== context.sessionId ||
        draft.date !== context.date ||
        draft.activityId !== context.activityId
      ) {
        continue
      }
      if (found === null || draft.at > found.at) found = draft
    }
    return found
  } catch {
    return null
  }
}

/** Storage can be blocked or full (a private window); the sheet then simply keeps no draft. */
export function writeDraft(draft: StrengthDraft): void {
  try {
    window.localStorage.setItem(keyOf(draft.logId), JSON.stringify(draft))
  } catch {
    // Blocked or full: the entries stay in the sheet, and only the safety copy is lost.
  }
}

export function clearDraft(logId: string): void {
  try {
    window.localStorage.removeItem(keyOf(logId))
  } catch {
    // Nothing was kept, or storage is blocked.
  }
}

/**
 * The state a draft puts back over the sheet a workout opens as: the sets, the swaps and the
 * footer the runner had entered. A block the workout no longer has is dropped, and one the draft
 * did not reach keeps its suggestion, so a workout that changed since the draft was kept still opens.
 */
export function applyDraft(fresh: FormState, draft: StrengthDraft): FormState {
  const kept = new Map(draft.blocks.map((block) => [block.key, block]))
  return {
    blocks: fresh.blocks.map((block): Block => {
      const own = kept.get(block.key)
      if (own === undefined) return block
      return { ...block, shown: own.swapped ?? block.original, rows: own.rows }
    }),
    minutes: draft.minutes,
    effort: draft.effort,
    pain: draft.pain,
    notes: draft.notes,
  }
}

/** The context of a sheet for a workout, a day and an optional activity. */
export function contextOf(
  workout: Pick<StrengthWorkout, 'sessionId'>,
  date: string,
  activityId: string | null,
): DraftContext {
  return { sessionId: workout.sessionId, date, activityId }
}

// The unsent drafts the forms keep in local storage, so a reload or a lost connection does not lose
// what was typed, and the one answer a prompt remembers. They are health data like the outbox, so the
// keys are named here once and `purgeDeviceData` (in `outbox.ts`) can remove them whatever form the
// rest of a key takes.

import { isIsoDate } from '../../shared/dates.ts'

/** The Done sheet's draft: `rl_done_draft_<user id>_<date>`, or `rl_done_draft_<date>` with no user. */
export const DONE_DRAFT_PREFIX = 'rl_done_draft_'

/** The fuel log form's draft: `fuel-draft:<activity id>`. */
export const FUEL_DRAFT_PREFIX = 'fuel-draft:'

/**
 * The strength logging sheet's draft: `strength-draft:<log id>`. The log id is the sheet's own
 * (a UUID it chose when it first opened) and the idempotency key of its save, so the sheet finds
 * its draft again by the prefix and what the draft says it is for (strength design 9.1).
 */
export const STRENGTH_DRAFT_PREFIX = 'strength-draft:'

/**
 * What the Strength page and the Review page remember about their questions: `strength-prompt:` and
 * the question's name. Not a draft, but a per-viewer convenience about the runner's training, so it
 * goes with the drafts when a session ends.
 */
export const STRENGTH_PROMPT_PREFIX = 'strength-prompt:'

/**
 * The crew note of one stop on the race card: `race-crew:<goal id>:<point>`. Free text the runner
 * wrote for the people at an aid station. It stays on the device (the server never sees it) and goes
 * with the drafts when a session ends, so by `purgeDeviceData()` too.
 */
export const RACE_CREW_PREFIX = 'race-crew:'

/** The longest crew note, in characters. */
export const RACE_CREW_NOTE_MAX = 500

const COUNT_QUIET_KEY = `${STRENGTH_PROMPT_PREFIX}count-not-now`

const DRAFT_PREFIXES = [
  DONE_DRAFT_PREFIX,
  FUEL_DRAFT_PREFIX,
  STRENGTH_DRAFT_PREFIX,
  STRENGTH_PROMPT_PREFIX,
  RACE_CREW_PREFIX,
]

/**
 * The day (YYYY-MM-DD, the server's) the runner chose "Not now" on the question about a lower weekly
 * strength count, or null: never asked, not a date, or storage is blocked (a private window), when
 * the question simply comes back.
 */
export function readCountNotNow(): string | null {
  try {
    const day = window.localStorage.getItem(COUNT_QUIET_KEY)
    return day !== null && isIsoDate(day) ? day : null
  } catch {
    return null
  }
}

/**
 * Keeps the day of "Not now" and says whether it did: false when storage is blocked or full, so no
 * wait can be promised. The page that asked is then quiet only until it is left, and the question
 * comes back at the next visit.
 */
export function writeCountNotNow(day: string): boolean {
  try {
    window.localStorage.setItem(COUNT_QUIET_KEY, day)
    return true
  } catch {
    return false
  }
}

/** The crew note under `id` (`<goal id>:<point>`), or an empty one: none yet, or storage is blocked. */
export function readCrewNote(id: string): string {
  try {
    return window.localStorage.getItem(`${RACE_CREW_PREFIX}${id}`) ?? ''
  } catch {
    return ''
  }
}

/**
 * Keeps the crew note under `id`, or removes the key for an empty one, and says whether it did:
 * false when storage is blocked or full, so the page can say the note will not be there next time.
 */
export function writeCrewNote(id: string, text: string): boolean {
  try {
    const key = `${RACE_CREW_PREFIX}${id}`
    if (text === '') window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, text.slice(0, RACE_CREW_NOTE_MAX))
    return true
  } catch {
    return false
  }
}

/** Removes every draft. Storage can be blocked (a private window); then there is nothing to remove. */
export function purgeDrafts(): void {
  try {
    const storage = window.localStorage
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key === null) continue
      if (DRAFT_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // Blocked storage keeps no draft.
  }
}

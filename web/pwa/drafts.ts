// The unsent drafts the forms keep in local storage, so a reload or a lost connection does not lose
// what was typed. They are health data like the outbox, so the keys are named here once and
// `purgeDeviceData` (in `outbox.ts`) can remove them whatever form the rest of a key takes.

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

const DRAFT_PREFIXES = [DONE_DRAFT_PREFIX, FUEL_DRAFT_PREFIX, STRENGTH_DRAFT_PREFIX]

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

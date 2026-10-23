// The unsent drafts the forms keep in local storage, so a reload or a lost connection does not lose
// what was typed. They are health data like the outbox, so the keys are named here once and
// `purgeDeviceData` (in `outbox.ts`) can remove them whatever form the rest of a key takes.

/** The Done sheet's draft: `rl_done_draft_<user id>_<date>`, or `rl_done_draft_<date>` with no user. */
export const DONE_DRAFT_PREFIX = 'rl_done_draft_'

/** The fuel log form's draft: `fuel-draft:<activity id>`. */
export const FUEL_DRAFT_PREFIX = 'fuel-draft:'

/** Removes every draft. Storage can be blocked (a private window); then there is nothing to remove. */
export function purgeDrafts(): void {
  try {
    const storage = window.localStorage
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key === null) continue
      if (key.startsWith(DONE_DRAFT_PREFIX) || key.startsWith(FUEL_DRAFT_PREFIX)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // Blocked storage keeps no draft.
  }
}

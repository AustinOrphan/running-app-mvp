// Stub from the training-engine scaffold; Task E10 implements it.
import type { Deps } from '../app.ts'

/** After an activity is stored: match it to a planned session and assess the execution. */
export function runExecutionForActivity(
  _deps: Deps,
  _args: { userId: string; activityId: string },
): Promise<void> {
  return Promise.reject(new Error('Task E10: runExecutionForActivity is not implemented'))
}

/** Nightly sweep over the last 7 days of unlinked activities and planned sessions. */
export function runNightlyMatching(_deps: Deps, _args: { today: string }): Promise<void> {
  return Promise.reject(new Error('Task E10: runNightlyMatching is not implemented'))
}

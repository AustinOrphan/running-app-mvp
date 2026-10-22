// Stub from the data-foundation scaffold; Task D10 implements it.
import type { Deps } from '../app.ts'

/** Starts the hourly sync, 5-minute folder scan and 10-minute weather jobs; returns `stop()`. */
export function startScheduler(deps: Deps, opts: { fetch: typeof fetch }): () => void {
  void deps
  void opts
  return () => undefined
}

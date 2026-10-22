// Stub from the data-foundation scaffold; Task D10 implements it.
import type { Deps } from '../app.ts'

/** Imports the files in `path` that `ImportedFile` has not seen; returns how many were stored. */
export function scanFolder(deps: Deps, userId: string, path: string): Promise<number> {
  void deps
  void userId
  void path
  return Promise.reject(new Error('not implemented'))
}

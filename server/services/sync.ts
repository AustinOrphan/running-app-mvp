// Stub from the data-foundation scaffold; Task D10 implements it.
import type { Deps } from '../app.ts'
import type { ImportBatch } from '../../shared/types.ts'

/** Pulls new activities and wellness from one provider and advances its cursor. */
export function syncProvider(
  deps: Deps,
  userId: string,
  provider: string,
  opts: { from?: string; fetch?: typeof fetch } = {},
): Promise<ImportBatch | null> {
  void deps
  void userId
  void provider
  void opts
  return Promise.reject(new Error('not implemented'))
}

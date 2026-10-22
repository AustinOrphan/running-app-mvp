// Stub from the data-foundation scaffold; Task D9 implements it.
import type { Deps } from '../app.ts'
import type { ParsedActivity, WellnessInput } from '../../shared/types.ts'

export interface StoreOptions {
  source: string
  importBatchId: string | null
  file?: { name: string; format: 'fit' | 'gpx' | 'tcx'; bytes: Uint8Array }
  channel: 'upload' | 'folder' | 'provider' | 'push'
}

export interface StoreResult {
  outcome: 'imported' | 'updated' | 'duplicate'
  activityId: string
}

/** The only writer of imported activities: upserts by `(userId, providerKey)`. */
export function storeParsed(
  deps: Deps,
  userId: string,
  parsed: ParsedActivity,
  opts: StoreOptions,
): Promise<StoreResult> {
  void deps
  void userId
  void parsed
  void opts
  return Promise.reject(new Error('not implemented'))
}

/** Upserts wellness rows by date; null fields never overwrite manual values. */
export function storeWellness(
  deps: Deps,
  userId: string,
  rows: WellnessInput[],
  source: string,
): Promise<number> {
  void deps
  void userId
  void rows
  void source
  return Promise.reject(new Error('not implemented'))
}

// Stub from the data-foundation scaffold; Task D2 implements it.
import type { ParsedActivity } from '../../types.ts'

/** Throws `RangeError` with a reason for an unreadable file. */
export function parseGpx(bytes: Uint8Array, opts: { timezone: string }): ParsedActivity[] {
  void bytes
  void opts
  throw new Error('not implemented')
}

// Stub from the data-foundation scaffold; Task D2 implements it.
import type { ParsedActivity } from '../../types.ts'

export { summarize, localDateTime } from './summarize.ts'
export type { ActivitySummary } from './summarize.ts'

/**
 * Parses a FIT, GPX or TCX file chosen by the file name's extension. Throws `RangeError` with a
 * reason for an unreadable or unsupported file.
 */
export function parseActivityFile(
  name: string,
  bytes: Uint8Array,
  opts: { timezone: string },
): ParsedActivity[] {
  void name
  void bytes
  void opts
  throw new Error('not implemented')
}

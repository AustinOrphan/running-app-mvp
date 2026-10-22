import type { ParsedActivity } from '../../types.ts'
import { parseFit } from './fit.ts'
import { parseGpx } from './gpx.ts'
import { parseTcx } from './tcx.ts'

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
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase()
  switch (extension) {
    case 'fit':
      return parseFit(bytes, opts)
    case 'gpx':
      return parseGpx(bytes, opts)
    case 'tcx':
      return parseTcx(bytes, opts)
    default:
      throw new RangeError(
        `Unsupported file type: ${JSON.stringify(name)} (expected .fit, .gpx or .tcx)`,
      )
  }
}

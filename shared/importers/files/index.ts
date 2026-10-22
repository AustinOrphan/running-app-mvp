import { MAX_DURATION_SEC } from '../../limits.ts'
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
  let activities: ParsedActivity[]
  switch (extension) {
    case 'fit':
      activities = parseFit(bytes, opts)
      break
    case 'gpx':
      activities = parseGpx(bytes, opts)
      break
    case 'tcx':
      activities = parseTcx(bytes, opts)
      break
    default:
      throw new RangeError(
        `Unsupported file type: ${JSON.stringify(name)} (expected .fit, .gpx or .tcx)`,
      )
  }
  for (const a of activities) {
    const last = a.samples.t.length > 0 ? a.samples.t[a.samples.t.length - 1]! : 0
    if (a.elapsedSec > MAX_DURATION_SEC || last > MAX_DURATION_SEC) {
      throw new RangeError('the activity lasts longer than 150 hours; a timestamp looks corrupt')
    }
  }
  return activities
}

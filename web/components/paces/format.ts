import type { Units } from '../../../shared/types.ts'
import { formatDuration, roundEstimateSec } from '../../../shared/units.ts'
import { paceRangeText, paceText } from '../zoneFormat.ts'

/** A figure and its unit apart, so a page can set the unit smaller: `{ value: '6:05', unit: '/km' }`. */
export interface Parts {
  value: string
  unit: string
}

function split(text: string): Parts {
  const at = text.lastIndexOf(' ')
  return at < 0 ? { value: text, unit: '' } : { value: text.slice(0, at), unit: text.slice(at + 1) }
}

/** `7:36 to 6:05` and `/km` for a range in seconds per km, slow end first as the zones are. */
export function paceBandParts(band: readonly [number, number], units: Units): Parts {
  return split(paceRangeText([band[0], band[1]], units))
}

/** One pace in the runner's unit: `5:01` and `/km`. */
export function paceParts(secPerKm: number, units: Units): Parts {
  return split(paceText(secPerKm, units))
}

/** A predicted time at the precision it deserves (`roundEstimateSec`): `50:10`, `3:41:00`. */
export function timeText(sec: number): string {
  return formatDuration(roundEstimateSec(sec))
}

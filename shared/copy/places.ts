// The words of the place search (PL1, ADR 0024). `PLACES_TEMPLATES` is spread into `TEMPLATES`, so the
// G5 lint renders each one.
import { tpl } from './template.ts'

export const PLACES_TEMPLATES = {
  'places.unavailable': tpl(
    'Place search is not available right now. Try again in a moment, or enter the coordinates.',
  ),
} as const

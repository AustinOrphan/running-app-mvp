// The words of the place search (PL1, ADR 0024) and of its fields on Profile and Goals (PL2).
// `PLACES_TEMPLATES` is spread into `TEMPLATES`, so the G5 lint renders each one.
import { tpl } from './template.ts'

export const PLACES_TEMPLATES = {
  'places.unavailable': tpl(
    'Place search is not available right now. Try again in a moment, or enter the coordinates.',
  ),
  'places.search.label': tpl('Town or postcode', {}, { shape: 'label' }),
  'places.search.button': tpl('Search', {}, { shape: 'label' }),
  'places.search.too-short': tpl('Type at least 2 characters of a town or postcode.'),
  'places.search.list': tpl('Matching places', {}, { shape: 'label' }),
  'places.search.none': tpl('No place matched. Try another spelling, or a larger town nearby.'),
  'places.search.results': tpl('Choose a place to fill the coordinates. Nothing is saved yet.'),
  'places.search.offline': tpl('Place search needs a connection. Enter the coordinates instead.'),
  'places.search.chosen': tpl('Coordinates filled from {place}. Save to keep them.', {
    place: 'text',
  }),
  'places.start.button': tpl('Use where my runs start', {}, { shape: 'label' }),
  'places.start.found': tpl('{runs} of {of} runs start here. Save to keep the place.', {
    runs: 'count',
    of: 'count',
  }),
  'places.start.none': tpl('No run with a recorded track was found.'),
  'places.start.unavailable': tpl('The usual start could not be read. Enter the coordinates.'),
  'places.start.offline': tpl('Reading the usual start needs a connection.'),
} as const

/** "name, region, country", leaving out a part the geocoder did not give. */
export function placeLabel(place: {
  name: string
  region: string | null
  country: string | null
}): string {
  return [place.name, place.region, place.country]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ')
}

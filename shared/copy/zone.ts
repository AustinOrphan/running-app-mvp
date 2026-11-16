// The words about the zone a runner's days follow (D10 step 4b, ADR 0022), shown under the Timezone
// picker on the Profile page. `ZONE_TEMPLATES` is spread into `TEMPLATES`, so the G5 lint renders
// each one.
//
// A runner's days follow the zone saved on the Profile page; with none saved (the stored 'UTC') they
// follow the server's zone (`runnerZone`, ADR 0022).
import { render, tpl } from './template.ts'

export const ZONE_TEMPLATES = {
  // The picker: the stored 'UTC' reads as "not chosen" (ADR 0022); a runner who wants UTC days
  // picks the entry stored as Etc/UTC.
  'zone.option.unset': tpl(
    "Not set (the server's zone, {zone})",
    { zone: 'text' },
    { shape: 'label', fallback: "Not set (the server's zone)" },
  ),
  'zone.option.utc': tpl('UTC', {}, { shape: 'label' }),
  // The line: which zone the days follow now, and the date it gives.
  'zone.line.chosen': tpl(
    'Days follow {zone}, the zone saved here. Today is {date} there.',
    { zone: 'text', date: 'date' },
    { fallback: 'Days follow the zone saved here.' },
  ),
  'zone.line.unset': tpl(
    "Days follow {zone}, the server's zone, until a zone is saved here. Today is {date} there.",
    { zone: 'text', date: 'date' },
    { fallback: "Days follow the server's zone until a zone is saved here." },
  ),
  'zone.line.logged': tpl('Days already logged keep their dates.'),
  // While the picker shows a zone other than the saved one (the browser's zone is pre-filled over an
  // unset zone), what saving does.
  'zone.save.note': tpl(
    'Saving makes days follow {zone}.',
    { zone: 'text' },
    { fallback: 'Saving makes days follow the zone chosen here.' },
  ),
} as const

/** The stored value of the picker's unset entry (the column default). */
export const ZONE_UNSET_VALUE = 'UTC'

/** The stored value of the picker's UTC entry: `Etc/UTC`, never canonicalised (ADR 0022). */
export const ZONE_UTC_VALUE = 'Etc/UTC'

/** The label of the unset entry; `serverZone` null (the session user is not loaded) leaves it unnamed. */
export function zoneUnsetLabel(serverZone: string | null): string {
  return serverZone === null
    ? ZONE_TEMPLATES['zone.option.unset'].fallback
    : render(ZONE_TEMPLATES['zone.option.unset'], { zone: serverZone }, 'km')
}

export const zoneUtcLabel = (): string => render(ZONE_TEMPLATES['zone.option.utc'], {}, 'km')

/**
 * The line under the picker: the zone the days follow and today's date there, then that days
 * already logged keep their dates. `zone` is the session user's zone, never the picker's draft;
 * `chosen` is false while the saved zone is the unset entry, so the days follow the server's.
 */
export function zoneLineText(zone: string, today: string, chosen: boolean): string {
  const line = render(
    ZONE_TEMPLATES[chosen ? 'zone.line.chosen' : 'zone.line.unset'],
    { zone, date: { kind: 'date', iso: today, style: 'long' } },
    'km',
  )
  return `${line} ${render(ZONE_TEMPLATES['zone.line.logged'], {}, 'km')}`
}

/**
 * What saving does while the picker's zone differs from the saved one: days follow the draft, or
 * the server's zone when the draft is the unset entry. Null when that zone is not known (the
 * unset entry before the session user has loaded).
 */
export function zoneSaveNoteText(draftZone: string, serverZone: string | null): string | null {
  const zone = draftZone === ZONE_UNSET_VALUE ? serverZone : draftZone
  return zone === null ? null : render(ZONE_TEMPLATES['zone.save.note'], { zone }, 'km')
}

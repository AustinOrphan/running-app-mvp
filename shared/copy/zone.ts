// The words about the zone a runner's days follow (D10 step 4b, ADR 0022), shown under the Timezone
// picker on the Profile page. `ZONE_TEMPLATES` is spread into `TEMPLATES`, so the G5 lint renders
// each one.
//
// Before step 5 every runner's days follow the server's zone (`runnerZone` returns it), so the line
// says that, whatever zone is saved. Step 5 replaces `zone.line.server` and `zone.save.note` with the
// per-runner wording (ADR 0022, rollout) in the PR that makes `runnerZone` return the stored zone.
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
  'zone.line.server': tpl(
    "Days follow the server's zone, {zone}, whatever zone is saved here. Today is {date} there.",
    { zone: 'text', date: 'date' },
    { fallback: "Days follow the server's zone, whatever zone is saved here." },
  ),
  'zone.line.logged': tpl('Days already logged keep their dates.'),
  // While the picker shows a zone other than the saved one (the browser's zone is pre-filled over an
  // unset zone), what saving does.
  'zone.save.note': tpl(
    "Saving sets the zone that dates imported runs to {zone}. Days still follow the server's zone.",
    { zone: 'text' },
    {
      fallback:
        "Saving sets the zone that dates imported runs. Days still follow the server's zone.",
    },
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
 * already logged keep their dates. `zone` is the session user's zone, never the picker's draft.
 */
export function zoneLineText(zone: string, today: string): string {
  const line = render(
    ZONE_TEMPLATES['zone.line.server'],
    { zone, date: { kind: 'date', iso: today, style: 'long' } },
    'km',
  )
  return `${line} ${render(ZONE_TEMPLATES['zone.line.logged'], {}, 'km')}`
}

/** What saving does while the picker's zone differs from the saved one. */
export function zoneSaveNoteText(draftZone: string): string {
  return render(ZONE_TEMPLATES['zone.save.note'], { zone: draftZone }, 'km')
}

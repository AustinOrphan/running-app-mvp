// App-authored sentences of the older pages and of the provider modules, as templates, so the G5
// lint covers them (phase 3a design 4.5): the Import dialog, sign-in, the token and folder notes on
// the Integrations page, a screening question, and the messages a provider module throws for a
// service that answered with an error status. Text a service returned stays a text slot, shown
// verbatim inside the app's own sentence and outside the lint.
//
// Ids are `<area>.<name>`; both sets are spread into `TEMPLATES`.
import { render, tpl, type SlotSpec, type SlotValues, type Template } from './template.ts'

export const PAGE_TEMPLATES = {
  // The Import dialog. `reason` is the server's answer, or the app's line when the file could not
  // be read at all.
  'import.error.too-large': tpl(
    'The import did not finish. The file is larger than {mb} MB. Split it and import the parts.',
    { mb: 'count' },
  ),
  'import.error.csv': tpl(
    'The import did not finish. {reason} Nothing was imported; try again.',
    { reason: 'text' },
    { fallback: 'The import did not finish. Nothing was imported; try again.' },
  ),
  'import.error.files': tpl(
    'The import did not finish. {reason} {done} of {found} files were imported. Importing the same selection again skips them.',
    { reason: 'text', done: 'count', found: 'count' },
    {
      fallback:
        'The import did not finish. Importing the same selection again skips the files that went in.',
    },
  ),
  'import.error.apple': tpl(
    'The import did not finish. {reason} Files already imported are skipped when you try again.',
    { reason: 'text' },
    {
      fallback: 'The import did not finish. Files already imported are skipped when you try again.',
    },
  ),

  // Sign-in, for an answer that is none of the specific ones (wrong password, too many attempts,
  // no server).
  'auth.sign-in.error': tpl('Sign-in did not work. Check the details and try again.'),

  // The Integrations page.
  'integrations.token.copy-failed': tpl(
    'The token could not be copied. Select it and copy it by hand.',
  ),
  'integrations.folder.interval': tpl('The folder is scanned every {minutes} minutes.', {
    minutes: 'count',
  }),

  // The screening on the Profile page: the question about the cycle.
  'profile.screening.cycle': tpl(
    'Periods that have stopped or become irregular, or other changes to the cycle',
    {},
    { shape: 'label' },
  ),
} satisfies Record<string, Template>

/**
 * What a provider module throws when a service answered with an error status. The message becomes
 * the run's message and the integration's last error, so the Integrations page shows it inside
 * "Did not finish: ..." as the service's own words; these are the app's words and are linted.
 */
export const PROVIDER_TEMPLATES = {
  'provider.garmin.list': tpl('Garmin answered the activity list request with HTTP {status}.', {
    status: 'count',
  }),
  'provider.garmin.download': tpl(
    'Garmin answered the download of activity {id} with HTTP {status}.',
    { id: 'text', status: 'count' },
    { fallback: 'Garmin answered the download with an error.' },
  ),
  'provider.garmin.request': tpl(
    'Garmin answered the {what} request with HTTP {status}.',
    { what: 'text', status: 'count' },
    { fallback: 'Garmin answered a request with an error.' },
  ),
  'provider.strava.token': tpl('Strava answered the token request with HTTP {status}.', {
    status: 'count',
  }),
  'provider.strava.request': tpl('Strava answered the request with HTTP {status}.', {
    status: 'count',
  }),
} satisfies Record<string, Template>

export type ProviderMessageId = keyof typeof PROVIDER_TEMPLATES

/** A whole number for a `count` slot, such as an HTTP status. */
export function count(n: number): { readonly kind: 'count'; readonly n: number } {
  return { kind: 'count', n }
}

/** One of the provider modules' own messages. No provider message holds a distance or a pace. */
export function providerMessage<K extends ProviderMessageId>(
  id: K,
  slots: SlotValues<(typeof PROVIDER_TEMPLATES)[K]['slots']>,
): string {
  const template: Template = PROVIDER_TEMPLATES[id]
  return render(template, slots as SlotValues<SlotSpec>, 'km')
}

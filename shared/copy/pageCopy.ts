// App-authored sentences of the older pages and of the provider modules, as templates, so the G5
// lint covers them (phase 3a design 4.5): the Import dialog, sign-in, the token and folder notes on
// the Integrations page, a screening question, the recovery-cycle choice on the Plan page's Generate
// form, and the messages a provider module throws for a service that answered with an error status.
// Text a service returned stays a text slot, shown verbatim inside the app's own sentence and
// outside the lint.
//
// Ids are `<area>.<name>`; both sets are spread into `TEMPLATES`.
import { P } from '../engine/params/index.ts'
import type { RecoveryCycle } from '../engine/types.ts'
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

  // The recovery-cycle choice on the Plan page's Generate form [rules E3]: the plan decides, or the
  // runner chooses 3:1 or 2:1. Each choice says what it does, including that a chosen 3:1 holds
  // for a new runner and still gives way to a recent injury (`cycleShortReason`, macro.ts).
  'plan.cycle.field': tpl('Easier week', {}, { shape: 'label' }),
  'plan.cycle.name.auto': tpl('Let the plan decide', {}, { shape: 'label' }),
  'plan.cycle.name.3-1': tpl('Every 4th week', {}, { shape: 'label' }),
  'plan.cycle.name.2-1': tpl('Every 3rd week', {}, { shape: 'label' }),
  'plan.cycle.hint.auto': tpl('The plan chooses the rhythm: a lighter week every 4th week.'),
  'plan.cycle.hint.auto-short': tpl(
    'It comes every 3rd week for a new runner, for one under {runs} runs a week and after a recent injury.',
    { runs: 'count' },
  ),
  'plan.cycle.hint.3-1': tpl(
    'Three building weeks, then a lighter one, even for a new or low-frequency runner.',
  ),
  'plan.cycle.hint.3-1-injury': tpl('A recent injury on file still gives every 3rd week.'),
  'plan.cycle.hint.2-1': tpl(
    'Two building weeks, then a lighter one. It suits a new runner or a return from a break.',
  ),

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

/** What the recovery-cycle field offers: leave it to the plan, or choose one of the two cycles. */
export type CycleChoice = 'auto' | RecoveryCycle

/** The choices in the order the form offers them; the plan's own decision comes first. */
export const CYCLE_CHOICES: readonly CycleChoice[] = ['auto', '3:1', '2:1']

const CYCLE_NAMES = {
  auto: 'plan.cycle.name.auto',
  '3:1': 'plan.cycle.name.3-1',
  '2:1': 'plan.cycle.name.2-1',
} as const satisfies Record<CycleChoice, keyof typeof PAGE_TEMPLATES>

/** The label of the recovery-cycle field. */
export const cycleFieldLabel = (): string => render(PAGE_TEMPLATES['plan.cycle.field'], {}, 'km')

/** The label of a choice: "Let the plan decide", "Every 4th week" (3:1), "Every 3rd week" (2:1). */
export const cycleChoiceLabel = (choice: CycleChoice): string =>
  render(PAGE_TEMPLATES[CYCLE_NAMES[choice]], {}, 'km')

/** What a choice does, a sentence to a line. The figure is the Param the plan reads. */
export function cycleHintLines(choice: CycleChoice): string[] {
  switch (choice) {
    case 'auto':
      return [
        render(PAGE_TEMPLATES['plan.cycle.hint.auto'], {}, 'km'),
        render(
          PAGE_TEMPLATES['plan.cycle.hint.auto-short'],
          { runs: count(P.a5.lowFrequencyRunsPerWeek.value) },
          'km',
        ),
      ]
    case '3:1':
      return [
        render(PAGE_TEMPLATES['plan.cycle.hint.3-1'], {}, 'km'),
        render(PAGE_TEMPLATES['plan.cycle.hint.3-1-injury'], {}, 'km'),
      ]
    case '2:1':
      return [render(PAGE_TEMPLATES['plan.cycle.hint.2-1'], {}, 'km')]
  }
}

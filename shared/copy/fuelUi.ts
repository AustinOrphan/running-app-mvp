// The words of the fuel log and the places it appears (phase 3a design 10.6; ADR 0011): the log
// form, the prompt card, the target line and the Fuel sections of the activity page and the session
// sheet. Every label and sentence here is a template, spread into `TEMPLATES`, so the shared G5
// lint renders each one; a number reaches the text through a slot that the page fills from the
// payload or the registry, never as a digit in the words.
//
// The sentences of the ladder itself (the target, why this rate, what a logged run did, the safety
// card) are in `shared/engine/fuelCopy.ts`; the page shows those as the server sent them.
//
// The tone is a sketch, not a score: a gut that sat badly is a result the ladder learns from, and
// nothing here calls it anything else.
import { tpl, type Template } from './template.ts'

export const FUEL_UI_TEMPLATES = {
  // The log form: the sheet title and the products
  'fuel.ui.log-heading': tpl('Fuel log', {}, { shape: 'label' }),
  'fuel.ui.products-legend': tpl('What you took', {}, { shape: 'label' }),
  'fuel.ui.add-one': tpl(
    'Add one {name}',
    { name: 'text' },
    { shape: 'label', fallback: 'Add one' },
  ),
  'fuel.ui.remove-one': tpl(
    'Remove one {name}',
    { name: 'text' },
    { shape: 'label', fallback: 'Remove one' },
  ),
  'fuel.ui.taken': tpl('{servings} taken', { servings: 'count' }, { shape: 'label' }),
  'fuel.ui.same-as-last': tpl('Same as last long run', {}, { shape: 'label' }),
  'fuel.ui.no-products': tpl(
    'No products on your list yet. Add what you took under Something else.',
  ),

  // Food that is not on the list
  'fuel.ui.something-else': tpl('Something else', {}, { shape: 'label' }),
  'fuel.ui.food-name': tpl('Name of the food', {}, { shape: 'label' }),
  'fuel.ui.food-carbs': tpl('Carbohydrate in grams', {}, { shape: 'label' }),
  'fuel.ui.food-add': tpl('Add this food', {}, { shape: 'label' }),
  'fuel.ui.food-invalid': tpl('Give the name of the food and its grams of carbohydrate.'),
  'fuel.ui.food-row': tpl(
    '{servings} × {name}: {carbs} g',
    { servings: 'count', name: 'text', carbs: 'count' },
    { shape: 'label', fallback: 'Food' },
  ),
  'fuel.ui.food-remove': tpl(
    'Remove {name}',
    { name: 'text' },
    { shape: 'label', fallback: 'Remove' },
  ),

  // Fluid: the runner's own amount, never a target (rule H8)
  'fuel.ui.fluid-legend': tpl('Fluid', {}, { shape: 'label' }),
  'fuel.ui.fluid-input': tpl('Fluid you drank, in millilitres', {}, { shape: 'label' }),
  'fuel.ui.fluid-hint': tpl('Optional. This records what you drank; it is not a target.'),
  'fuel.ui.fluid-chip': tpl('{ml} mL', { ml: 'count' }, { shape: 'label' }),
  'fuel.ui.fluid-invalid': tpl('Use a whole number of millilitres, or leave it empty.'),

  // Gut and nausea
  'fuel.ui.gut-legend': tpl('Gut', {}, { shape: 'label' }),
  'fuel.ui.gut-hint': tpl('How your stomach and gut felt during the run.'),
  'fuel.ui.gut-required': tpl('Choose how your gut felt before saving.'),
  'fuel.ui.nausea-legend': tpl('Nausea (optional)', {}, { shape: 'label' }),
  'fuel.ui.nausea-term': tpl('Nausea', {}, { shape: 'label' }),
  'fuel.ui.scale-0': tpl('None', {}, { shape: 'label' }),
  'fuel.ui.scale-1': tpl('Mild', {}, { shape: 'label' }),
  'fuel.ui.scale-2': tpl('Moderate', {}, { shape: 'label' }),
  'fuel.ui.scale-3': tpl('Severe', {}, { shape: 'label' }),
  'fuel.ui.scale-4': tpl('Very severe', {}, { shape: 'label' }),
  'fuel.ui.score-value': tpl(
    '{word}, {score} of {max}',
    { word: 'text', score: 'count', max: 'count' },
    { shape: 'label', fallback: 'Scored' },
  ),

  // Was it hot: the weather decides until the runner answers
  'fuel.ui.hot': tpl('It was hot', {}, { shape: 'label' }),
  'fuel.ui.hot-day': tpl('Counted as a hot day.'),
  'fuel.ui.weather-missing': tpl('Weather for this run has not loaded. Tap if it was hot.'),
  'fuel.ui.weather-hot': tpl('The weather for this run reads hot. Tap if it was not.'),

  // Saving and not saving
  'fuel.ui.save': tpl('Save fuel log', {}, { shape: 'label' }),
  'fuel.ui.skip': tpl('Not this time', {}, { shape: 'label' }),
  'fuel.ui.saved': tpl('Fuel log saved.'),
  'fuel.ui.saved-queued': tpl(
    'Fuel log saved on this phone. It is sent when a connection returns.',
  ),
  'fuel.ui.not-saved': tpl(
    'Fuel log not saved. {reason} Your entries stay on this phone. Try again.',
    { reason: 'text' },
  ),
  'fuel.ui.not-marked': tpl('The run was not marked. {reason} Try again.', { reason: 'text' }),
  'fuel.ui.load-error': tpl('The fuel log did not load. Close this and try again.'),
  'fuel.ui.section-error': tpl('The fuel log did not load. Reload the page to try again.'),

  // The prompt card on Today
  'fuel.ui.prompt-lead': tpl(
    'Log what you took on a recent long run and how your stomach felt. It takes a moment.',
  ),
  'fuel.ui.prompt-run': tpl(
    '{date}, {duration}, {distance}',
    { date: 'date', duration: 'duration', distance: 'distance' },
    { shape: 'label', fallback: 'A recent run' },
  ),
  'fuel.ui.prompt-run-time': tpl(
    '{date}, {duration}',
    { date: 'date', duration: 'duration' },
    { shape: 'label', fallback: 'A recent run' },
  ),
  'fuel.ui.log-fuel': tpl('Log fuel', {}, { shape: 'label' }),
  'fuel.ui.log-for': tpl(
    'Log fuel for {run}',
    { run: 'text' },
    { shape: 'label', fallback: 'Log fuel' },
  ),
  'fuel.ui.skip-for': tpl(
    'Not this time for {run}',
    { run: 'text' },
    { shape: 'label', fallback: 'Not this time' },
  ),

  // The target on Today and in the session sheet
  'fuel.ui.section-heading': tpl('Fuel', {}, { shape: 'label' }),
  'fuel.ui.tomorrow': tpl(
    'Tomorrow: {rate} of carbohydrate',
    { rate: 'text' },
    { shape: 'label', fallback: 'Tomorrow: fuel target' },
  ),

  // The Fuel section of the activity page
  'fuel.ui.none-yet': tpl('No fuel log for this run yet.'),
  'fuel.ui.edit': tpl('Edit fuel log', {}, { shape: 'label' }),
  'fuel.ui.item-line': tpl(
    '{servings} × {name}',
    { servings: 'count', name: 'text' },
    { shape: 'label', fallback: 'Food' },
  ),
  'fuel.ui.fluid-logged': tpl('{ml} mL of fluid', { ml: 'count' }, { shape: 'label' }),
} satisfies Record<string, Template>

export type FuelUiTemplateId = keyof typeof FUEL_UI_TEMPLATES

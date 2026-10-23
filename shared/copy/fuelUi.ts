// The words of the fuel log and the places it appears (phase 3a design 10.6; ADR 0011): the log
// form, the prompt card, the target line, the Fuel sections of the activity page and the session
// sheet, and the Fuel lab page. Every label and sentence here is a template, spread into
// `TEMPLATES`, so the shared G5 lint renders each one; a number reaches the text through a slot that
// the page fills from the payload or the registry, never as a digit in the words.
//
// The sentences of the ladder itself (the target, why this rate, what a logged run did, the state of
// a rung, the safety card) are in `shared/engine/fuelCopy.ts`; the page shows those as the server
// sent them or renders them from the same functions.
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

  // The Fuel lab page: its title, the empty target, the ladder and the history table
  'fuel.lab.title': tpl('Fuel lab', {}, { shape: 'label' }),
  'fuel.lab.context': tpl('Find out what your gut tolerates on long runs, well before race day.'),
  'fuel.lab.load-error': tpl('The Fuel lab did not load. Reload the page to try again.'),
  'fuel.lab.target-heading': tpl('Fuel target', {}, { shape: 'label' }),
  'fuel.lab.target-run': tpl(
    '{title}, {date}, {duration}',
    { title: 'text', date: 'date', duration: 'duration' },
    { shape: 'label', fallback: 'Next planned run' },
  ),
  'fuel.lab.target-empty': tpl(
    'No planned run carries a fuel target yet. A planned run of {duration} or more does.',
    { duration: 'duration' },
  ),
  'fuel.lab.ladder-heading': tpl('Tier ladder', {}, { shape: 'label' }),
  'fuel.lab.ladder-intro': tpl(
    'The ladder is meant to be climbed on long runs from the start of the build, not only in its last weeks.',
  ),
  'fuel.lab.ladder-label': tpl('Carbohydrate rates, lowest first', {}, { shape: 'label' }),
  'fuel.lab.low-certainty': tpl('Low certainty', {}, { shape: 'label' }),
  'fuel.lab.history-heading': tpl('History', {}, { shape: 'label' }),
  'fuel.lab.history-label': tpl('Fuel history, newest first', {}, { shape: 'label' }),
  'fuel.lab.history-empty': tpl(
    'No runs are logged yet. Log what you took after a long run, and it appears here with what it did to the ladder.',
  ),
  'fuel.lab.history-note': tpl(
    'Each note is worked out again from the logs every time this page opens, so a late weather update can change one.',
  ),
  'fuel.lab.col-run': tpl('Run', {}, { shape: 'label' }),
  'fuel.lab.col-rate': tpl('Rate taken', {}, { shape: 'label' }),
  'fuel.lab.col-target': tpl('Target', {}, { shape: 'label' }),
  'fuel.lab.col-result': tpl('What it did', {}, { shape: 'label' }),
  'fuel.lab.rate-cell': tpl('{rate} g/h', { rate: 'count' }, { shape: 'label' }),
  'fuel.lab.not-recorded': tpl('Not recorded', {}, { shape: 'label' }),
  'fuel.lab.not-answered': tpl('Not answered', {}, { shape: 'label' }),

  // Products: the list, its form and what archiving does
  'fuel.lab.products-heading': tpl('Products', {}, { shape: 'label' }),
  'fuel.lab.products-lead': tpl(
    'The gels, drink mixes and chews you carry, with the carbohydrate and sodium in one serving.',
  ),
  'fuel.lab.products-empty': tpl(
    'No products on your list yet. Add the gels, drink mixes and chews you carry.',
  ),
  'fuel.lab.product-amounts': tpl(
    '{serving}: {carbs} g carbohydrate',
    { serving: 'text', carbs: 'count' },
    { shape: 'label', fallback: 'One serving' },
  ),
  'fuel.lab.product-amounts-sodium': tpl(
    '{serving}: {carbs} g carbohydrate, {sodium} mg sodium',
    { serving: 'text', carbs: 'count', sodium: 'count' },
    { shape: 'label', fallback: 'One serving' },
  ),
  'fuel.lab.multi-carb-tag': tpl('Several carbohydrate sources', {}, { shape: 'label' }),
  'fuel.lab.add-product': tpl('Add a product', {}, { shape: 'label' }),
  'fuel.lab.edit': tpl('Edit', {}, { shape: 'label' }),
  'fuel.lab.edit-product': tpl(
    'Edit {name}',
    { name: 'text' },
    { shape: 'label', fallback: 'Edit' },
  ),
  'fuel.lab.archive': tpl('Archive', {}, { shape: 'label' }),
  'fuel.lab.archive-product': tpl(
    'Archive {name}',
    { name: 'text' },
    { shape: 'label', fallback: 'Archive' },
  ),
  'fuel.lab.archived': tpl('Archived {name}.', { name: 'text' }, { fallback: 'Archived.' }),
  'fuel.lab.archive-failed': tpl('The product was not archived. {reason} Try again.', {
    reason: 'text',
  }),
  'fuel.lab.product-name': tpl('Name', {}, { shape: 'label' }),
  'fuel.lab.product-kind': tpl('Kind', {}, { shape: 'label' }),
  'fuel.lab.product-serving': tpl('What one serving is', {}, { shape: 'label' }),
  'fuel.lab.product-serving-hint': tpl('For example one gel, or one bottle.'),
  'fuel.lab.product-carbs': tpl('Carbohydrate in one serving, in grams', {}, { shape: 'label' }),
  'fuel.lab.product-sodium': tpl(
    'Sodium in one serving, in milligrams (optional)',
    {},
    { shape: 'label' },
  ),
  'fuel.lab.product-kcal': tpl(
    'Energy in one serving, in kilocalories (optional)',
    {},
    { shape: 'label' },
  ),
  'fuel.lab.product-multi': tpl(
    'More than one kind of carbohydrate, such as glucose and fructose',
    {},
    { shape: 'label' },
  ),
  'fuel.lab.product-save': tpl('Save product', {}, { shape: 'label' }),
  'fuel.lab.product-cancel': tpl('Cancel', {}, { shape: 'label' }),
  'fuel.lab.product-saved': tpl('Product saved.'),
  'fuel.lab.product-name-required': tpl('Give the product a name.'),
  'fuel.lab.product-serving-required': tpl('Say what one serving is.'),
  'fuel.lab.product-carbs-invalid': tpl('Use grams of carbohydrate, zero or more.'),
  'fuel.lab.product-number-invalid': tpl('Use a whole number of zero or more, or leave it empty.'),
  'fuel.lab.product-not-saved': tpl('The product was not saved. {reason} Try again.', {
    reason: 'text',
  }),
  'fuel.lab.kind-gel': tpl('Gel', {}, { shape: 'label' }),
  'fuel.lab.kind-drink': tpl('Drink mix', {}, { shape: 'label' }),
  'fuel.lab.kind-chew': tpl('Chews', {}, { shape: 'label' }),
  'fuel.lab.kind-bar': tpl('Bar', {}, { shape: 'label' }),
  'fuel.lab.kind-food': tpl('Food', {}, { shape: 'label' }),
  'fuel.lab.kind-electrolyte': tpl('Electrolyte', {}, { shape: 'label' }),
  'fuel.lab.kind-other': tpl('Other', {}, { shape: 'label' }),

  // The gut-training block: its dates, and what it does and does not claim
  'fuel.lab.block-heading': tpl('Gut training', {}, { shape: 'label' }),
  'fuel.lab.block-planned': tpl(
    'Gut-training weeks run from {from} to {to}, ending before the taper.',
    { from: 'date', to: 'date' },
    { fallback: 'Gut-training weeks are in your plan, ending before the taper.' },
  ),
  'fuel.lab.block-week': tpl(
    'Week of {date}',
    { date: 'date' },
    { shape: 'label', fallback: 'A gut-training week' },
  ),
  'fuel.lab.block-counts': tpl(
    'In these weeks a run of {duration} or more counts toward the ladder, whether or not the app linked it to a session.',
    { duration: 'duration' },
  ),
  'fuel.lab.block-none': tpl(
    'The plan has no gut-training weeks right now. They are added before the taper of a long goal, at a weekly re-plan.',
  ),
  'fuel.lab.block-off': tpl('The gut-training block is switched off.'),
  'fuel.lab.block-locked': tpl('A diagnosed gut condition removes the gut-training block.'),
  'fuel.lab.block-removal': tpl('Its weeks leave the plan at the next weekly re-plan.'),

  // The switches
  'fuel.lab.settings-heading': tpl('Settings', {}, { shape: 'label' }),
  'fuel.lab.settings-legend': tpl('Fuel switches', {}, { shape: 'label' }),
  'fuel.lab.opt-90': tpl(
    'Open carbohydrate rates above {from} g/h, up to {to} g/h',
    { from: 'count', to: 'count' },
    { shape: 'label', fallback: 'Open higher carbohydrate rates' },
  ),
  'fuel.lab.opt-advanced': tpl(
    'Open carbohydrate rates above {from} g/h, up to {to} g/h',
    { from: 'count', to: 'count' },
    { shape: 'label', fallback: 'Open the highest carbohydrate rates' },
  ),
  'fuel.lab.opt-hint': tpl('Evidence for the higher rates is thin. Opt in to rehearse them.'),
  'fuel.lab.gi-disease': tpl('I have a diagnosed gut condition', {}, { shape: 'label' }),
  'fuel.lab.gi-hint': tpl('The ladder then stays at the floor and gut training is removed.'),
  'fuel.lab.gut-block': tpl(
    'Include a gut-training block before the taper',
    {},
    { shape: 'label' },
  ),
  'fuel.lab.settings-note': tpl(
    'The ladder follows these switches once saved. The gut-training block reaches the plan at the next weekly re-plan, shown in its diff.',
  ),
  'fuel.lab.settings-save': tpl('Save settings', {}, { shape: 'label' }),
  'fuel.lab.settings-saved': tpl('Fuel settings saved.'),
  'fuel.lab.settings-not-saved': tpl('The settings were not saved. {reason} Try again.', {
    reason: 'text',
  }),
} satisfies Record<string, Template>

export type FuelUiTemplateId = keyof typeof FUEL_UI_TEMPLATES

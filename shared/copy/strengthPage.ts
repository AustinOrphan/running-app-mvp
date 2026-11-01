// The words of the Strength page, its five setup sheets and the rows of its sections (strength
// design 6, 11.3, 11.4 and 11.6; ADR 0014). Every label and sentence is a template, spread into
// `TEMPLATES`, so the shared G5 lint renders each one in both unit systems and both weight units.
// The names, cues and reasons of the exercises, the benefit sentence and the labels shared with the
// logging sheet stay in `shared/copy/strengthTemplates.ts`.
//
// The page has the app's tone: a sketch, not a score. The estimated maximum is always called an
// estimate and "worked out from sets, not tested", a lift that moved is "up" or "down" and never a
// record, and a state is in words. No digit is typed in a text: a count is a slot, and a count that
// reads as a word ("three weeks") arrives as text built by `countPhrase`, because a Param may move.
import { tpl, type Template } from './template.ts'

export const STRENGTH_PAGE_TEMPLATES = {
  // ---- The page and its states (design 11.3) -----------------------------------------------------
  'strength.page.title': tpl('Strength', {}, { shape: 'label' }),
  'strength.page.more-note': tpl('Lifts, loads and history', {}, { shape: 'label' }),
  'strength.page.context': tpl(
    'The next workout, where the block stands and the lifts logged so far.',
  ),
  // The page is not one of the reads the service worker keeps (ADR 0012), so offline it says so.
  'strength.page.load-error': tpl(
    'The Strength page did not load. It needs a connection; reload the page to try again.',
  ),
  'strength.page.units-error': tpl(
    'The weight unit could not be read, so no load is shown. Reload the page to try again.',
  ),
  'strength.page.try-again': tpl('Try again', {}, { shape: 'label' }),
  'strength.page.profile-link': tpl('Open the Profile', {}, { shape: 'label' }),
  'strength.page.research-link': tpl('Read the research', {}, { shape: 'label' }),

  // ---- Settings and the units row (design 11.4) --------------------------------------------------
  'strength.page.weight-units': tpl('Weight units', {}, { shape: 'label' }),
  'strength.page.unit-pounds': tpl('Pounds', {}, { shape: 'label' }),
  'strength.page.unit-kilograms': tpl('Kilograms', {}, { shape: 'label' }),
  'strength.page.weight-units-hint': tpl(
    'Every load follows this unit, here and in the logging sheet.',
  ),
  'strength.page.unit-saved': tpl('Weight unit saved', {}, { shape: 'label' }),
  'strength.page.unit-error': tpl('The weight unit was not saved. Try again.'),

  // ---- 1. Setup, while it is not saved (design 6.1, 6.2) -----------------------------------------
  'strength.page.setup-heading': tpl('Set up strength', {}, { shape: 'label' }),
  'strength.page.setup-lead': tpl(
    'The workout follows the saved equipment, lifting history and starting loads. Until they are saved it is bodyweight only.',
  ),
  'strength.page.setup-optional': tpl('Each part is optional. Close a sheet to skip it.'),
  // The one-line row of the logging sheet while the setup is not saved (design 6.1), beside a link
  // that is "Set up strength".
  'strength.page.sheet-offer': tpl('The workout is for bodyweight only until the setup is saved.'),
  'strength.page.part-unit': tpl('Weight unit', {}, { shape: 'label' }),
  'strength.page.part-equipment': tpl('Equipment', {}, { shape: 'label' }),
  'strength.page.part-history': tpl('Lifting history', {}, { shape: 'label' }),
  'strength.page.part-exercises': tpl('Exercises', {}, { shape: 'label' }),
  'strength.page.part-anchors': tpl('Starting points', {}, { shape: 'label' }),
  'strength.page.part-unit-note': tpl('Pounds or kilograms, for every load.'),
  'strength.page.part-equipment-note': tpl(
    'The equipment there is to lift with, and the smallest step of each.',
  ),
  'strength.page.part-history-note': tpl(
    'How long lifting has gone on, and whether it goes on now.',
  ),
  'strength.page.part-exercises-note': tpl('Leave a movement out, or always use one for a slot.'),
  'strength.page.part-anchors-note': tpl('A recent set or a known maximum gives a first load.'),

  // The card on Today the first time a strength session falls within a week while the setup is not
  // saved (design 6.1); its heading is `strength.page.setup-heading`, "Set up strength".
  'strength.page.today-offer': tpl(
    'A strength session is coming up, and its workout is for bodyweight only until the setup is saved.',
  ),
  'strength.page.today-link': tpl('Open Strength', {}, { shape: 'label' }),

  // ---- 2. Next session (design 11.3, 6.4) --------------------------------------------------------
  'strength.page.next-heading': tpl('Next session', {}, { shape: 'label' }),
  'strength.page.next-empty': tpl(
    'No strength session is planned. Choose how many a week on the Profile.',
  ),
  'strength.page.next-when': tpl('{date}. About {minutes} planned.', {
    date: 'date',
    minutes: 'minutes',
  }),
  'strength.page.bodyweight-only': tpl(
    'This workout is bodyweight only. Set up strength and the lifts use the saved equipment.',
  ),
  // With no strength session planned, a log starts from the next planned session or the week's
  // maintenance session (design 9.1); the sheet's header says which.
  'strength.page.log-session': tpl('Log a session', {}, { shape: 'label' }),
  'strength.page.past': tpl('Add a past session', {}, { shape: 'label' }),
  'strength.page.past-date': tpl('Date of the session', {}, { shape: 'label' }),
  'strength.page.past-hint': tpl('Any day in the last year, up to today.'),
  'strength.page.past-invalid': tpl('Choose a day in the last year, up to today.'),
  'strength.page.past-continue': tpl('Continue', {}, { shape: 'label' }),

  // ---- The activity page (design 11.4): the sets of a strength activity -----------------------
  'strength.page.sets-heading': tpl('Sets', {}, { shape: 'label' }),
  'strength.page.sets-label': tpl('Sets of this session', {}, { shape: 'label' }),
  'strength.page.sets-none': tpl('No sets are logged for this session.'),
  'strength.page.sets-error': tpl('The sets did not load.'),
  'strength.page.col-exercise': tpl('Exercise', {}, { shape: 'label' }),
  'strength.page.col-set': tpl('Set', {}, { shape: 'label' }),
  'strength.page.col-load': tpl('Load', {}, { shape: 'label' }),
  'strength.page.col-reps': tpl('Reps', {}, { shape: 'label' }),
  'strength.page.sets-not-recorded': tpl('Not recorded', {}, { shape: 'label' }),

  // ---- 3. This block (design 8.1, 8.3, 11.3) -----------------------------------------------------
  'strength.page.block-heading': tpl('This block', {}, { shape: 'label' }),
  'strength.page.block-position': tpl(
    'Week {week} of {of}, {template}',
    { week: 'count', of: 'count', template: 'text' },
    { shape: 'label', fallback: 'This block' },
  ),
  'strength.page.block-none': tpl(
    'No strength block runs this week. Maintenance sessions are short and keep the loads.',
  ),
  // `weeks` reads "three weeks" (from `flib.heavyRampInWeeks` or the runner's own length), `of` is
  // the last week of the block.
  'strength.page.follows-ramp-in': tpl(
    'The ramp-in lasts {weeks}. Heavy work follows to week {of}, then maintenance; the taper keeps a light session each week.',
    { weeks: 'text', of: 'count' },
    { fallback: 'Heavy work follows the ramp-in, then maintenance.' },
  ),
  'strength.page.follows-heavy': tpl(
    'Heavy work runs to week {of}. Maintenance follows; the taper keeps a light session each week.',
    { of: 'count' },
    { fallback: 'Maintenance follows the block.' },
  ),
  'strength.page.follows-lighter-week': tpl(
    'A lighter week keeps the loads and cuts the sets. The block goes on to week {of}.',
    { of: 'count' },
    { fallback: 'A lighter week keeps the loads and cuts the sets.' },
  ),
  'strength.page.follows-taper': tpl(
    'The taper keeps a light session each week until the race week.',
  ),
  'strength.page.follows-return': tpl(
    'Return weeks use the ramp-in structure with no jumps. The block goes on to week {of}.',
    { of: 'count' },
    { fallback: 'Return weeks use the ramp-in structure with no jumps.' },
  ),
  'strength.page.follows-maintenance': tpl(
    'Maintenance sessions are short and keep the loads. The taper keeps a light session each week.',
  ),

  // ---- 4. Lifts (design 11.3, 6.3) ---------------------------------------------------------------
  'strength.page.lifts-heading': tpl('Lifts', {}, { shape: 'label' }),
  'strength.page.lifts-empty': tpl(
    'No lifts are logged yet. Log a session and its lifts appear here.',
  ),
  'strength.page.lift-last-load': tpl('Last load', {}, { shape: 'label' }),
  'strength.page.lift-no-load': tpl('No added load', {}, { shape: 'label' }),
  'strength.page.lift-estimate': tpl('Estimated maximum', {}, { shape: 'label' }),
  'strength.page.about-load': tpl('about {load}', { load: 'load' }, { shape: 'label' }),
  'strength.page.lift-change': tpl('Last change', {}, { shape: 'label' }),
  'strength.page.change-up': tpl(
    'Up from {from} to {to}, {date}',
    { from: 'load', to: 'load', date: 'date' },
    { shape: 'label' },
  ),
  'strength.page.change-down': tpl(
    'Down from {from} to {to}, {date}',
    { from: 'load', to: 'load', date: 'date' },
    { shape: 'label' },
  ),
  'strength.page.change-none': tpl('The load has not moved', {}, { shape: 'label' }),
  'strength.page.lift-last': tpl('Last session', {}, { shape: 'label' }),
  'strength.page.lift-history': tpl('History', {}, { shape: 'label' }),
  'strength.page.lift-history-for': tpl(
    'History of {exercise}',
    { exercise: 'text' },
    { shape: 'label', fallback: 'History' },
  ),
  'strength.page.estimate-note': tpl(
    'The estimated maximum is worked out from sets, not tested. It is a rough guide.',
  ),

  // ---- 5. History of one lift (design 11.3, 6.3) -------------------------------------------------
  'strength.page.history-heading': tpl('History of one lift', {}, { shape: 'label' }),
  'strength.page.history-choose': tpl('Choose a lift from the list to see its history.'),
  'strength.page.history-error': tpl('The history of this lift did not load.'),
  'strength.page.history-empty': tpl('This lift has no logged sets yet.'),
  'strength.page.history-label': tpl(
    'History of {exercise}',
    { exercise: 'text' },
    { shape: 'label', fallback: 'History' },
  ),
  'strength.page.history-note': tpl('Each set shows the load, the count and the reps left.'),
  'strength.page.col-date': tpl('Date and mode', {}, { shape: 'label' }),
  'strength.page.col-sets': tpl('Sets', {}, { shape: 'label' }),
  'strength.page.col-estimate': tpl('Estimated maximum', {}, { shape: 'label' }),
  'strength.page.set-load': tpl(
    '{load}, {count} {measure}',
    { load: 'load', count: 'count', measure: 'text' },
    { shape: 'label' },
  ),
  // A loaded set counted in reps, the common case, reads short enough for a phone's table.
  'strength.page.set-reps': tpl(
    '{load} x {count}',
    { load: 'load', count: 'count' },
    { shape: 'label' },
  ),
  'strength.page.set-reps-left': tpl(
    '{load} x {count}, {left} left',
    { load: 'load', count: 'count', left: 'count' },
    { shape: 'label' },
  ),
  'strength.page.set-bare': tpl(
    '{count} {measure}',
    { count: 'count', measure: 'text' },
    { shape: 'label' },
  ),
  'strength.page.set-load-left': tpl(
    '{load}, {count} {measure}, {left} left',
    { load: 'load', count: 'count', measure: 'text', left: 'count' },
    { shape: 'label' },
  ),
  'strength.page.set-bare-left': tpl(
    '{count} {measure}, {left} left',
    { count: 'count', measure: 'text', left: 'count' },
    { shape: 'label' },
  ),
  'strength.page.no-estimate': tpl('No estimate', {}, { shape: 'label' }),
  'strength.page.mode-normal': tpl('Normal', {}, { shape: 'label' }),
  'strength.page.mode-lighter-day': tpl('Lighter day', {}, { shape: 'label' }),
  'strength.page.mode-lighter-week': tpl('Lighter week', {}, { shape: 'label' }),
  'strength.page.mode-taper': tpl('Taper', {}, { shape: 'label' }),
  'strength.page.mode-return': tpl('Return', {}, { shape: 'label' }),
  'strength.page.chart-none': tpl('The line appears once two sessions have an estimated maximum.'),
  // `reps` reads "five reps".
  'strength.page.anchor-set': tpl(
    'Starting point: a set of {load}, {reps}.',
    { load: 'load', reps: 'text' },
    { fallback: 'A starting point is saved.' },
  ),
  'strength.page.anchor-max': tpl(
    'Starting point: a known maximum of {load}.',
    { load: 'load' },
    { fallback: 'A starting point is saved.' },
  ),

  // ---- 6. Recent sessions (design 11.3) ----------------------------------------------------------
  'strength.page.recent-heading': tpl('Recent sessions', {}, { shape: 'label' }),
  'strength.page.recent-empty': tpl('No sessions are logged yet. Log sets and they appear here.'),
  // `sets` reads "nine sets".
  'strength.page.recent-detail': tpl(
    '{sets}, {minutes}.',
    { sets: 'text', minutes: 'minutes' },
    { fallback: 'A strength session.' },
  ),
  'strength.page.edit': tpl('Edit', {}, { shape: 'label' }),
  'strength.page.edit-for': tpl(
    'Edit the session of {date}',
    { date: 'date' },
    { shape: 'label', fallback: 'Edit' },
  ),
  'strength.page.delete': tpl('Delete', {}, { shape: 'label' }),
  'strength.page.delete-for': tpl(
    'Delete the session of {date}',
    { date: 'date' },
    { shape: 'label', fallback: 'Delete' },
  ),
  'strength.page.delete-ask': tpl('Delete the sets of this session? The activity stays.'),
  'strength.page.delete-confirm': tpl('Delete the sets', {}, { shape: 'label' }),
  'strength.page.delete-keep': tpl('Keep', {}, { shape: 'label' }),
  'strength.page.delete-error': tpl('The sets were not deleted. Try again.'),
  'strength.page.deleted': tpl('Sets deleted', {}, { shape: 'label' }),

  // ---- 7. Equipment and units (design 11.3, 6.5, 11.4) -------------------------------------------
  'strength.page.units-heading': tpl('Equipment and units', {}, { shape: 'label' }),
  'strength.page.not-set': tpl('Not set yet.'),
  'strength.page.equip-none': tpl('None saved, so workouts are bodyweight only.'),
  'strength.page.history-value': tpl(
    '{level}, lifting now: {now}',
    { level: 'text', now: 'text' },
    { shape: 'label', fallback: 'Saved' },
  ),
  'strength.page.exercises-none': tpl('Nothing is left out or pinned.'),
  'strength.page.exercises-left': tpl(
    'Left out: {names}.',
    { names: 'text' },
    { fallback: 'Some exercises are left out.' },
  ),
  'strength.page.exercises-pinned': tpl(
    'Always used: {names}.',
    { names: 'text' },
    { fallback: 'Some exercises are pinned.' },
  ),
  'strength.page.anchors-none': tpl('No starting points are saved.'),
  'strength.page.edit-equipment': tpl('Edit equipment', {}, { shape: 'label' }),
  'strength.page.edit-history': tpl('Edit lifting history', {}, { shape: 'label' }),
  'strength.page.edit-exercises': tpl('Edit exercises', {}, { shape: 'label' }),
  'strength.page.edit-anchors': tpl('Edit starting points', {}, { shape: 'label' }),
  'strength.page.injuries-heading': tpl('Injuries', {}, { shape: 'label' }),
  'strength.page.injuries-value': tpl(
    'On the Profile: {areas}.',
    { areas: 'text' },
    { fallback: 'Injuries are recorded on the Profile.' },
  ),
  'strength.page.injuries-none': tpl('None are recorded on the Profile.'),

  // ---- 8. About (design 4.5, 11.3) ---------------------------------------------------------------
  'strength.page.about-heading': tpl('About strength work', {}, { shape: 'label' }),
  'strength.page.about-heavy': tpl(
    'Heavy loads have the strongest support, and jumps help most at slower paces.',
  ),
  'strength.page.about-thin': tpl(
    'The evidence for ultra runners is thin, so the loads and sets are defaults, not findings.',
  ),
  'strength.page.about-claims': tpl(
    'Nothing here predicts an injury, and strength work is not claimed to prevent one.',
  ),
  'strength.page.about-grades': tpl('Evidence grades', {}, { shape: 'label' }),
  'strength.page.grade-benefit': tpl('Oxygen cost of running', {}, { shape: 'label' }),
  'strength.page.grade-heavy': tpl('Heavy loads', {}, { shape: 'label' }),
  'strength.page.grade-defaults': tpl('Sets, reps and ramp-in length', {}, { shape: 'label' }),

  // ---- The setup sheets (design 6.2) -------------------------------------------------------------
  'strength.page.save': tpl('Save', {}, { shape: 'label' }),
  'strength.page.saved': tpl('Strength setup saved', {}, { shape: 'label' }),
  'strength.page.save-error': tpl(
    'The setup was not saved. {reason} Try again.',
    { reason: 'text' },
    { fallback: 'The setup was not saved. Try again.' },
  ),
  'strength.page.unit-lead': tpl(
    'Loads are stored in grams, so a change reaches the history and every suggestion.',
  ),

  'strength.page.equipment-lead': tpl(
    'Bodyweight is always available. Tick the other equipment; each step is the smallest change of load.',
  ),
  'strength.page.kind-barbell': tpl('Barbell, plates and a rack', {}, { shape: 'label' }),
  'strength.page.kind-dumbbells': tpl('Dumbbells', {}, { shape: 'label' }),
  'strength.page.kind-kettlebells': tpl('Kettlebells', {}, { shape: 'label' }),
  'strength.page.kind-bands': tpl('Bands', {}, { shape: 'label' }),
  'strength.page.kind-step': tpl('A step or box', {}, { shape: 'label' }),
  'strength.page.kind-leg-press': tpl('Leg press', {}, { shape: 'label' }),
  'strength.page.kind-calf-machine': tpl('Calf raise machine', {}, { shape: 'label' }),
  'strength.page.kind-leg-curl': tpl('Leg curl machine', {}, { shape: 'label' }),
  'strength.page.eq-bar': tpl(
    'Bar weight in {unit}',
    { unit: 'text' },
    { shape: 'label', fallback: 'Bar weight' },
  ),
  'strength.page.eq-jump': tpl(
    'Smallest pair of plates in {unit}',
    { unit: 'text' },
    { shape: 'label', fallback: 'Smallest pair of plates' },
  ),
  'strength.page.eq-jump-hint': tpl(
    'What the smallest pair of plates adds to the bar. Loads move in this step.',
  ),
  'strength.page.eq-mode': tpl('Enter the weights as', {}, { shape: 'label' }),
  'strength.page.eq-mode-range': tpl('A range and a step', {}, { shape: 'label' }),
  'strength.page.eq-mode-list': tpl('A list', {}, { shape: 'label' }),
  'strength.page.eq-first': tpl(
    'Lightest weight in {unit}',
    { unit: 'text' },
    { shape: 'label', fallback: 'Lightest weight' },
  ),
  'strength.page.eq-last': tpl(
    'Heaviest weight in {unit}',
    { unit: 'text' },
    { shape: 'label', fallback: 'Heaviest weight' },
  ),
  'strength.page.eq-last-hint': tpl('Leave it empty if there is no top.'),
  'strength.page.eq-step': tpl(
    'Step in {unit}',
    { unit: 'text' },
    { shape: 'label', fallback: 'Step' },
  ),
  'strength.page.eq-list': tpl(
    'Weights in {unit}',
    { unit: 'text' },
    { shape: 'label', fallback: 'Weights' },
  ),
  'strength.page.eq-list-hint': tpl('Separate the weights with commas.'),
  'strength.page.eq-machine-step': tpl(
    'Weight step in {unit}',
    { unit: 'text' },
    { shape: 'label', fallback: 'Weight step' },
  ),
  'strength.page.eq-machine-top': tpl(
    'Top weight in {unit}',
    { unit: 'text' },
    { shape: 'label', fallback: 'Top weight' },
  ),
  'strength.page.err-weight': tpl('Enter a weight above zero.'),
  'strength.page.err-top': tpl('The heaviest weight must be at least the lightest.'),
  'strength.page.err-machine-top': tpl('The top weight must be at least one step.'),
  'strength.page.err-list': tpl('List at least one weight, separated by commas.'),
  'strength.page.err-list-long': tpl('List at most {max} weights.', { max: 'count' }),
  'strength.page.err-step': tpl('The step is too small to show. Use a larger step.'),
  'strength.page.err-unusable': tpl('These weights make no load. Check them.'),
  'strength.page.err-check': tpl('Some fields need attention. Check the marked ones.'),

  'strength.page.level-label': tpl('Lifting level', {}, { shape: 'label' }),
  'strength.page.level-new': tpl('New', {}, { shape: 'label' }),
  'strength.page.level-some': tpl('Some', {}, { shape: 'label' }),
  'strength.page.level-experienced': tpl('Experienced', {}, { shape: 'label' }),
  'strength.page.level-hint-new': tpl('Not lifted regularly, or for less than a year.'),
  'strength.page.level-hint-some': tpl('Lifted for a while but not consistently.'),
  'strength.page.level-hint-experienced': tpl(
    'Lifted consistently for a year or more and comfortable with squat and hinge movements under load.',
  ),
  'strength.page.now-label': tpl('Lifting now', {}, { shape: 'label' }),
  'strength.page.now-hint': tpl('Lifted at least once a week in the last month.'),
  'strength.page.yes': tpl('Yes', {}, { shape: 'label' }),
  'strength.page.no': tpl('No', {}, { shape: 'label' }),

  'strength.page.slot-knee': tpl('Squats and steps', {}, { shape: 'label' }),
  'strength.page.slot-hip': tpl('Hinges and bridges', {}, { shape: 'label' }),
  'strength.page.slot-calf': tpl('Calf raises', {}, { shape: 'label' }),
  'strength.page.slot-plyo': tpl('Jumps', {}, { shape: 'label' }),
  'strength.page.slot-trunk': tpl('Trunk and hips', {}, { shape: 'label' }),
  'strength.page.pin-label': tpl(
    'Always use for {slot}',
    { slot: 'text' },
    { shape: 'label', fallback: 'Always use' },
  ),
  'strength.page.pin-none': tpl('The plan chooses', {}, { shape: 'label' }),
  'strength.page.leave-out': tpl('Leave out', {}, { shape: 'label' }),
  'strength.page.leave-out-hint': tpl(
    'A movement left out is never chosen. If every choice for a slot is left out, a bodyweight one stands in.',
  ),
  'strength.page.note-label': tpl('Note', {}, { shape: 'label' }),
  'strength.page.note-hint': tpl('Only kept so it can be read again here. No rule reads it.'),

  'strength.page.anchor-list': tpl('Saved starting points', {}, { shape: 'label' }),
  'strength.page.anchor-row-set': tpl(
    '{exercise}: {load}, {reps}.',
    { exercise: 'text', load: 'load', reps: 'text' },
    { fallback: 'A starting point is saved.' },
  ),
  'strength.page.anchor-row-max': tpl(
    '{exercise}: a maximum of {load}.',
    { exercise: 'text', load: 'load' },
    { fallback: 'A starting point is saved.' },
  ),
  'strength.page.anchor-exercise': tpl('Exercise', {}, { shape: 'label' }),
  'strength.page.anchor-choose': tpl('Choose an exercise', {}, { shape: 'label' }),
  'strength.page.anchor-kind': tpl('What is known', {}, { shape: 'label' }),
  'strength.page.anchor-kind-set': tpl('A recent set', {}, { shape: 'label' }),
  'strength.page.anchor-kind-max': tpl('A known maximum', {}, { shape: 'label' }),
  'strength.page.anchor-load': tpl(
    'Weight in {unit}',
    { unit: 'text' },
    { shape: 'label', fallback: 'Weight' },
  ),
  'strength.page.anchor-reps': tpl('Reps', {}, { shape: 'label' }),
  'strength.page.anchor-rir-hint': tpl(
    'Leave it empty if it is not known. It is then read as none left, the lowest estimate.',
  ),
  'strength.page.anchor-estimate': tpl(
    'Estimated maximum: about {load}. It is worked out from this set, not tested.',
    { load: 'load' },
    { fallback: 'The estimated maximum is worked out from this set.' },
  ),
  'strength.page.anchor-estimate-max': tpl(
    'Estimated maximum: {load}, the maximum entered.',
    { load: 'load' },
    { fallback: 'The estimated maximum is the one entered.' },
  ),
  'strength.page.anchor-estimate-none': tpl(
    'No estimate from this set: it is more than {max} reps from the limit.',
    { max: 'count' },
    { fallback: 'No estimate from this set.' },
  ),
  'strength.page.anchor-save': tpl('Save starting point', {}, { shape: 'label' }),
  'strength.page.anchor-saved': tpl('Starting point saved', {}, { shape: 'label' }),
  'strength.page.anchor-remove': tpl('Remove', {}, { shape: 'label' }),
  'strength.page.anchor-remove-for': tpl(
    'Remove the starting point for {exercise}',
    { exercise: 'text' },
    { shape: 'label', fallback: 'Remove' },
  ),
  'strength.page.anchor-removed': tpl('Starting point removed', {}, { shape: 'label' }),
  'strength.page.anchor-error': tpl(
    'The starting point was not saved. {reason} Try again.',
    { reason: 'text' },
    { fallback: 'The starting point was not saved. Try again.' },
  ),
  'strength.page.err-exercise': tpl('Choose an exercise.'),
  'strength.page.err-reps': tpl('Enter a whole number of reps.'),
} satisfies Record<string, Template>

export type StrengthPageTemplateId = keyof typeof STRENGTH_PAGE_TEMPLATES

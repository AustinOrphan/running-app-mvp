// The words of strength training (strength design 5.5, 7.6 and 11.6; ADR 0010, ADR 0014): the names
// and cues of the catalogue, the tempo and effort notes, the reasons behind a load, the benefit
// sentence and the lines of the workout. Every sentence is a template, spread into `TEMPLATES`, so
// the shared G5 lint renders each one in both unit systems and both weight units.
//
// Rules of the copy, beyond the lint:
// - No digit in a text. A number is a slot, filled from a Param (the reps, the reps left, the
//   separation hours, the benefit range, the lowering seconds) or from the log, so a change of a
//   Param changes the sentence and a copy test renders the sentence next to the Param.
// - A rule number that reads as a word ("one set fewer") arrives as text built by `countPhrase`,
//   because the Param may change; plural forms the Params cannot reach have their own template
//   (ADR 0010: `reduce` and `reduce-one`).
// - The app's own vocabulary replaces the gym's: "reps left", "short of the range", "heaviest set",
//   "estimated maximum", "lighter day". The words "PR", "personal best", "failure", "fail",
//   "missed", "crush" and "smash" never appear; neither do "deload", "streak" or "required".
// - A lift is a suggestion: no sentence calls a different load wrong, and none claims a benefit
//   beyond the one sentence of design 4.5.
//
// The catalogue itself (ids, slots, equipment) is `shared/domain/strengthLibrary.ts`; it points at
// the `name`, `cue` and `note` templates below by id, and a test keeps the two in step.
import { render, tpl, type Template } from './template.ts'

/** Shown for a reason whose slots could not be read: it names no figure. */
const REASON_FALLBACK = 'The load follows the sets logged so far.'

export const STRENGTH_TEMPLATES = {
  // ---- Names (design 7.1) ----------------------------------------------------------------------
  'strength.name.back-squat': tpl('Back squat', {}, { shape: 'label' }),
  'strength.name.leg-press': tpl('Leg press', {}, { shape: 'label' }),
  'strength.name.goblet-squat': tpl('Goblet squat', {}, { shape: 'label' }),
  'strength.name.split-squat': tpl('Split squat', {}, { shape: 'label' }),
  'strength.name.step-up': tpl('Step-up', {}, { shape: 'label' }),
  'strength.name.tempo-squat': tpl('Tempo squat', {}, { shape: 'label' }),
  'strength.name.single-leg-box-squat': tpl('Single-leg box squat', {}, { shape: 'label' }),
  'strength.name.romanian-deadlift': tpl('Romanian deadlift', {}, { shape: 'label' }),
  'strength.name.dumbbell-rdl': tpl('Dumbbell Romanian deadlift', {}, { shape: 'label' }),
  'strength.name.kettlebell-rdl': tpl('Kettlebell Romanian deadlift', {}, { shape: 'label' }),
  'strength.name.leg-curl': tpl('Leg curl', {}, { shape: 'label' }),
  'strength.name.hip-thrust': tpl('Hip thrust (glute bridge)', {}, { shape: 'label' }),
  'strength.name.single-leg-rdl': tpl('Single-leg Romanian deadlift', {}, { shape: 'label' }),
  'strength.name.standing-calf-raise': tpl('Standing calf raise', {}, { shape: 'label' }),
  'strength.name.seated-calf-raise': tpl('Bent-knee calf raise', {}, { shape: 'label' }),
  'strength.name.single-leg-calf-raise': tpl('Single-leg calf raise', {}, { shape: 'label' }),
  'strength.name.pogo-hop': tpl('Pogo hops', {}, { shape: 'label' }),
  'strength.name.line-hop': tpl('Line hops', {}, { shape: 'label' }),
  'strength.name.squat-jump': tpl('Squat jumps', {}, { shape: 'label' }),
  'strength.name.single-leg-hop': tpl('Single-leg hops in place', {}, { shape: 'label' }),
  'strength.name.side-plank': tpl('Side plank', {}, { shape: 'label' }),
  'strength.name.dead-bug': tpl('Dead bug', {}, { shape: 'label' }),
  'strength.name.banded-lateral-walk': tpl('Banded lateral walk', {}, { shape: 'label' }),
  'strength.name.pallof-press': tpl('Pallof press', {}, { shape: 'label' }),
  'strength.name.farmer-carry': tpl('Farmer carry', {}, { shape: 'label' }),

  // ---- Cues: how an exercise is done (design 7.6), no number in any of them ---------------------
  'strength.cue.back-squat': tpl(
    'Bar on the upper back, feet about shoulder width, sit back and down until the thighs are about parallel, and stand up.',
  ),
  'strength.cue.leg-press': tpl(
    'Feet about shoulder width on the plate and the back flat on the pad. Lower until the knees bend deeply, then press up short of locking the knees.',
  ),
  'strength.cue.goblet-squat': tpl(
    'Hold one weight against the chest with the elbows down, sit down between the knees with the chest tall, and stand up.',
  ),
  'strength.cue.split-squat': tpl(
    'Take a long step forward, lower the back knee straight down until the front thigh is about parallel, then press through the front foot to stand.',
  ),
  'strength.cue.step-up': tpl(
    'Put the whole front foot on the step, stand up by pushing through that leg alone, and step down slowly.',
  ),
  'strength.cue.tempo-squat': tpl(
    'Feet about shoulder width, sit back and down slowly with the chest tall until the thighs are about parallel, then stand up.',
  ),
  'strength.cue.single-leg-box-squat': tpl(
    'Stand on one leg in front of a box, sit back until the hips touch it lightly, and stand up on the same leg. Hold a rail if balance needs it.',
  ),
  'strength.cue.romanian-deadlift': tpl(
    'Hold the bar at the thighs, soften the knees, push the hips back with a flat back until the bar passes the knees, then drive the hips forward.',
  ),
  'strength.cue.dumbbell-rdl': tpl(
    'Hold a dumbbell in each hand at the thighs, soften the knees, push the hips back with a flat back as the weights slide down the legs, then stand tall.',
  ),
  'strength.cue.kettlebell-rdl': tpl(
    'Hold the kettlebell in both hands at the thighs, soften the knees, push the hips back with a flat back as it slides down the legs, then stand tall.',
  ),
  'strength.cue.leg-curl': tpl(
    'Set the pad just above the heels, curl the heels toward the hips, and let them return slowly without the hips lifting.',
  ),
  'strength.cue.hip-thrust': tpl(
    'Upper back on a bench or the floor, feet flat, drive the hips up until the body is a line from shoulders to knees, then lower under control.',
  ),
  'strength.cue.single-leg-rdl': tpl(
    'Stand on one leg with a soft knee, hinge at the hip and reach toward the floor as the other leg extends back, then stand tall again.',
  ),
  'strength.cue.standing-calf-raise': tpl(
    'Balls of the feet on the edge of a step or a plate, knees straight, rise as high as possible, pause, and lower to a full stretch.',
  ),
  'strength.cue.seated-calf-raise': tpl(
    'Seated with the knees bent and the weight on the thighs, rise onto the balls of the feet as high as possible, pause, and lower to a full stretch.',
  ),
  'strength.cue.single-leg-calf-raise': tpl(
    'On one foot at the edge of a step, holding a rail for balance, rise as high as possible, pause, and lower to a full stretch.',
  ),
  'strength.cue.pogo-hop': tpl(
    'Stand tall and hop on the balls of both feet with stiff ankles, in small quick jumps that spend as little time on the ground as possible.',
  ),
  'strength.cue.line-hop': tpl(
    'Hop side to side over a line on the floor with both feet together, landing softly on the balls of the feet and keeping each contact quick.',
  ),
  'strength.cue.squat-jump': tpl(
    'Lower into a quarter squat, jump up, land softly with the knees bent, and settle before the next jump.',
  ),
  'strength.cue.single-leg-hop': tpl(
    'Hop in place on one foot with a soft knee and a tall posture, landing on the ball of the foot and leaving the ground quickly.',
  ),
  'strength.cue.side-plank': tpl(
    'Lie on one side with the elbow under the shoulder, lift the hips so the body is a straight line, and breathe steadily. Do both sides.',
  ),
  'strength.cue.dead-bug': tpl(
    'Lie on the back with the arms up and the knees bent over the hips, lower the opposite arm and leg slowly with the lower back flat, then switch.',
  ),
  'strength.cue.banded-lateral-walk': tpl(
    'Band just above the knees and the knees slightly bent, step sideways with the toes forward, pushing the knees out against the band.',
  ),
  'strength.cue.pallof-press': tpl(
    'Stand side-on to an anchored band with the hands at the chest, press straight out, resist the pull to rotate, and return.',
  ),
  'strength.cue.farmer-carry': tpl(
    'Hold a weight in each hand at the sides, stand tall with the shoulders back, and walk with short steady steps without leaning to either side.',
  ),

  // ---- Notes: tempo and effort (design 7.6, grade D, gap 7) -------------------------------------
  // The lowering seconds are `f7.lowerSeconds`. The slow lowering is the eccentric emphasis of
  // rule H5; no eccentric load above the lifted load is prescribed.
  'strength.note.lower-stand': tpl(
    'Lower over {seconds} seconds, then stand up without a pause.',
    { seconds: 'count' },
    { fallback: 'Lower slowly, then stand up without a pause.' },
  ),
  'strength.note.lower-return': tpl(
    'Lower over {seconds} seconds, then return without a pause.',
    { seconds: 'count' },
    { fallback: 'Lower slowly, then return without a pause.' },
  ),
  'strength.note.calf': tpl(
    'Lower over {seconds} seconds to a full stretch, pause briefly, then rise.',
    { seconds: 'count' },
    { fallback: 'Lower slowly to a full stretch, pause briefly, then rise.' },
  ),
  'strength.note.plyo': tpl(
    'Land softly and leave the ground quickly. Stop the set when contacts get slower.',
  ),
  'strength.note.controlled': tpl('Move slowly and stay in control.'),

  // ---- The safety line (design 7.6), once at the top of the setup and under a barbell lift -----
  'strength.safety': tpl(
    'Stop a set if anything hurts or form changes. Learn barbell lifts from a coach before adding load.',
  ),

  // ---- What strength work may do (design 4.5): the one sentence about benefit -------------------
  // `lo` and `hi` are `f7.expectedBenefitPct`. Design 4.5 and ADR 0014 ask for the three qualifiers
  // of the figure in the same breath: it needs a full block, it is small, and it says nothing about
  // race time.
  'strength.benefit': tpl(
    'Strength work may lower the oxygen cost of running by about {lo} to {hi} after a full block. That is small, and it says nothing about race time.',
    { lo: 'count', hi: 'percent' },
  ),

  // ---- The workout in a row (design 11.1, 11.6) -------------------------------------------------
  // `lo` and `hi` are the rep range of the template, `rirLo` and `rirHi` the reps left to aim at.
  'strength.hero.workout-row': tpl(
    '{exercise}: {sets} x {lo} to {hi}, {load}, leave {rirLo} to {rirHi}.',
    {
      exercise: 'text',
      sets: 'count',
      lo: 'count',
      hi: 'count',
      load: 'load',
      rirLo: 'count',
      rirHi: 'count',
    },
  ),
  'strength.hero.workout-row-bodyweight': tpl(
    '{exercise}: {sets} x {lo} to {hi}, leave {rirLo} to {rirHi}.',
    { exercise: 'text', sets: 'count', lo: 'count', hi: 'count', rirLo: 'count', rirHi: 'count' },
  ),
  'strength.hero.plyo-row': tpl('{movement}, {contacts} contacts.', {
    movement: 'text',
    contacts: 'count',
  }),
  'strength.hero.trunk-row': tpl('{movements}, {sets} sets.', {
    movements: 'text',
    sets: 'count',
  }),
  // A day of lower readiness (design 10.4, 11.1): `sets` reads "one set" (from
  // `f9.lowReadinessSetsCut`) and `pct` is `f9.lowReadinessLoadPct`.
  'strength.lighter-today': tpl(
    'Lighter today: {sets} fewer and {pct} less. The usual load is one tap away.',
    { sets: 'text', pct: 'percent' },
  ),
  'strength.use-usual': tpl('Use the usual load', {}, { shape: 'label' }),
  // `hours` is `f4.strengthSeparationHours`.
  'strength.separation': tpl('Lift at least {hours} hours before or after a run.', {
    hours: 'count',
  }),

  // ---- Where a session stands in the block (design 8.1, 9.1, 11.3) ------------------------------
  'strength.heading': tpl(
    'Strength, {template} {variant}',
    { template: 'text', variant: 'text' },
    { shape: 'label', fallback: 'Strength' },
  ),
  'strength.template.ramp-in': tpl('ramp-in', {}, { shape: 'label' }),
  'strength.template.heavy': tpl('heavy', {}, { shape: 'label' }),
  'strength.template.lighter-week': tpl('lighter week', {}, { shape: 'label' }),
  'strength.template.maintenance': tpl('maintenance', {}, { shape: 'label' }),
  'strength.template.taper': tpl('taper', {}, { shape: 'label' }),
  'strength.template.return': tpl('return', {}, { shape: 'label' }),

  // ---- What a load means, shown beside the field (design 5.2) -----------------------------------
  'strength.basis.total-with-bar': tpl('Total, including the bar', {}, { shape: 'label' }),
  'strength.basis.stack': tpl('Stack or plate total', {}, { shape: 'label' }),
  'strength.basis.one-implement': tpl(
    'Weight of one dumbbell or kettlebell',
    {},
    { shape: 'label' },
  ),
  'strength.basis.added': tpl('Added weight', {}, { shape: 'label' }),

  // ---- The estimated maximum: a history figure, never on Today (design 6.3, decided 2026-10-24, section 18, question 10) --
  'strength.max-label': tpl('Estimated maximum, from submaximal sets', {}, { shape: 'label' }),
  // `pct` is the load as a share of the estimate, `floor` the heavy floor `flib.heavyMinPct1rm`.
  'strength.max-share': tpl(
    'About {pct} of the estimated maximum; heavy work asks for {floor} or more.',
    {
      pct: 'percent',
      floor: 'percent',
    },
  ),

  // ---- The app's own words (design 11.6) --------------------------------------------------------
  'strength.label.suggested': tpl('Suggested', {}, { shape: 'label' }),
  'strength.label.reps-left': tpl('Reps left', {}, { shape: 'label' }),
  'strength.label.reps-left-first': tpl('Reps left in reserve', {}, { shape: 'label' }),
  'strength.label.short-of-range': tpl('Short of the range', {}, { shape: 'label' }),
  'strength.label.heaviest-set': tpl('Heaviest set', {}, { shape: 'label' }),
  'strength.label.lighter-day': tpl('Lighter day', {}, { shape: 'label' }),
  'strength.label.up-one-step': tpl('Up one step', {}, { shape: 'label' }),
  'strength.label.load-holds': tpl('The load holds', {}, { shape: 'label' }),
  'strength.label.log-sets': tpl('Log sets', {}, { shape: 'label' }),
  'strength.label.add-sets': tpl('Add the sets', {}, { shape: 'label' }),

  // ---- Reasons (design 10.2 to 10.4, 11.6): the facts of a `SuggestionBasis` ---------------------
  // A reason stored on a log is a template id with slots, so a wording fix and a change of unit
  // reach old logs. `exercise` is the rendered name of the exercise.
  'strength.reason.increase': tpl(
    'Every set of {exercise} reached {top} reps with reps left, so the load goes up one step.',
    { exercise: 'text', top: 'count' },
    { fallback: REASON_FALLBACK },
  ),
  // `rir` is `f8.bigStepRir`.
  'strength.reason.increase-two': tpl(
    'Every set of {exercise} reached {top} reps with {rir} or more reps left, so the load goes up two steps.',
    { exercise: 'text', top: 'count', rir: 'count' },
    { fallback: REASON_FALLBACK },
  ),
  'strength.reason.hold-unrecorded': tpl(
    'The count of reps left was not recorded, so the load holds.',
  ),
  'strength.reason.hold-range': tpl(
    'Not every set of {exercise} reached {top} reps yet, so the load holds and each set aims one rep higher.',
    { exercise: 'text', top: 'count' },
    { fallback: REASON_FALLBACK },
  ),
  // `pct` is `f8.maxStepPct`.
  'strength.reason.hold-step': tpl(
    'The next step up from {load} would be more than {pct} of the load, so the load holds.',
    { load: 'load', pct: 'percent' },
    { fallback: REASON_FALLBACK },
  ),
  // `pct` is the top of `flib.heavyMinPct1rm`.
  'strength.reason.hold-ceiling': tpl(
    'The next step would pass {pct} of the estimated maximum, so the load holds.',
    { pct: 'percent' },
    { fallback: REASON_FALLBACK },
  ),
  // For a set that ended at two reps or fewer, or none: a set that ended at one rep has its own
  // template, so the sentence never reads "1 reps".
  'strength.reason.reduce': tpl(
    'Set {set} of {exercise} ended at {count} reps, below the {lo} to {hi} range, so the load comes down one step.',
    { set: 'count', exercise: 'text', count: 'count', lo: 'count', hi: 'count' },
    { fallback: REASON_FALLBACK },
  ),
  'strength.reason.reduce-one': tpl(
    'Set {set} of {exercise} ended at one rep, below the {lo} to {hi} range, so the load comes down one step.',
    { set: 'count', exercise: 'text', lo: 'count', hi: 'count' },
    { fallback: REASON_FALLBACK },
  ),
  // `days` is the gap, at least `f8.layoffDays`; `share` is `f8.layoffLoadFraction`.
  'strength.reason.return': tpl(
    'The last session of {exercise} was {days} days ago, so the load comes back to about {share} of the last working load.',
    { exercise: 'text', days: 'count', share: 'share' },
    { fallback: REASON_FALLBACK },
  ),
  // `sessions` is `f8.ceilingSessions`; `next` is the rendered name of the harder movement.
  'strength.reason.variation': tpl(
    '{exercise} stayed at the top of the range for {sessions} sessions with no usable step, so the next movement is {next}.',
    { exercise: 'text', sessions: 'count', next: 'text' },
    { fallback: REASON_FALLBACK },
  ),
  // The first session of an exercise (design 10.3); `pct` is `f8.startPctOf1rm`.
  'strength.reason.start-anchor': tpl(
    '{exercise} has no sets logged yet, so it starts at {pct} of the estimated maximum.',
    { exercise: 'text', pct: 'percent' },
    { fallback: REASON_FALLBACK },
  ),
  'strength.reason.start-bodyweight': tpl(
    '{exercise} has no sets logged yet, so it starts light, as a share of body weight, and later sessions adjust it.',
    { exercise: 'text' },
    { fallback: REASON_FALLBACK },
  ),
  'strength.reason.start-lightest': tpl(
    '{exercise} has no sets logged yet, so it starts at the lightest load the equipment makes.',
    { exercise: 'text' },
    { fallback: REASON_FALLBACK },
  ),
  'strength.reason.start-unloaded': tpl(
    '{exercise} has no sets logged yet, so it starts with no added load.',
    { exercise: 'text' },
    { fallback: REASON_FALLBACK },
  ),
  // F9 (design 10.4); `sets` is a count in words built from the Param ("one set", "two sets").
  'strength.reason.lighter-day': tpl(
    'Readiness is lower than usual today, so each lift has {sets} fewer at a lighter load.',
    { sets: 'text' },
    { fallback: REASON_FALLBACK },
  ),
  'strength.reason.lighter-week': tpl(
    'This is a lighter week, so each lift has {sets} at the usual load.',
    { sets: 'text' },
    { fallback: REASON_FALLBACK },
  ),
  'strength.reason.taper': tpl(
    'The taper keeps the lead lift and the calf raise at the usual load, with {sets} of each.',
    { sets: 'text' },
    { fallback: REASON_FALLBACK },
  ),

  // ---- What the API says when it refuses (design 9.4); the activity form shows it as it is ------
  'strength.api.type-locked': tpl(
    'This activity has sets logged, so its type stays strength. Remove the sets to change it.',
  ),
} satisfies Record<string, Template>

export type StrengthTemplateId = keyof typeof STRENGTH_TEMPLATES

/**
 * What `PUT /api/activities/:id` answers (409) to a change of type on a strength activity that has
 * a log. The sentence holds no distance, pace or climb, so one fixed system serves every runner.
 */
export function strengthTypeLockedMessage(): string {
  return render(STRENGTH_TEMPLATES['strength.api.type-locked'], {}, 'km')
}

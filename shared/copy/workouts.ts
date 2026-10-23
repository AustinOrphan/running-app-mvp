// The words of a workout on the runner's watch, in the intervals.icu text and in the workout file
// (phase 3a design 6.5): step names, the target phrases and the eased line, and the reasons a
// download is refused. They reach the runner outside the app, so they are templates like every
// other app-authored string and the copy-lint test renders each of them.
// `shared/workouts/plan.ts` chooses which step word a step takes; no other module writes these
// words.
//
// Ids are `workout.<group>.<name>`. The `workout.file.*` ones are sentences; all others are
// labels: short phrases for a step or a line of a description.
import { tpl, type Template } from './template.ts'

export const WORKOUT_TEMPLATES = {
  // The name of a step, the same on every surface.
  'workout.step.walk': tpl('Walk', {}, { shape: 'label' }),
  'workout.step.warm-up': tpl('Warm up', {}, { shape: 'label' }),
  'workout.step.cool-down': tpl('Cool down', {}, { shape: 'label' }),
  'workout.step.recover': tpl('Recover', {}, { shape: 'label' }),
  'workout.step.run': tpl('Run', {}, { shape: 'label' }),
  'workout.step.hike': tpl('Hike', {}, { shape: 'label' }),
  'workout.step.race-pace': tpl('Race pace', {}, { shape: 'label' }),
  'workout.step.stride': tpl('Stride', {}, { shape: 'label' }),
  'workout.step.hill': tpl('Hill', {}, { shape: 'label' }),
  'workout.step.fast': tpl('Fast', {}, { shape: 'label' }),
  'workout.step.threshold': tpl('Threshold', {}, { shape: 'label' }),

  // The target of a step, after the step's name and length. A range arrives as text because it
  // prints its unit once ("4:10 to 4:00 /km").
  'workout.target.hr-ceiling': tpl(
    'heart rate under {limit}',
    { limit: 'bpm' },
    { shape: 'label' },
  ),
  'workout.target.hr-band': tpl('heart rate {range}', { range: 'text' }, { shape: 'label' }),
  'workout.target.pace': tpl('pace {range}', { range: 'text' }, { shape: 'label' }),
  'workout.target.effort': tpl('by effort', {}, { shape: 'label' }),

  // The line of a day that was eased. The reason is never named.
  'workout.eased': tpl('Eased for today', {}, { shape: 'label' }),

  // Why a workout file is not made. The reason is a fact about the plan or the day, never about
  // the runner's body.
  'workout.file.not-found': tpl('That session is not in the active plan.'),
  'workout.file.not-a-run': tpl('This session is not a run, so it has no workout file.'),
  'workout.file.settled': tpl(
    'This session is already done or skipped, so it has no workout file.',
  ),
  'workout.file.rest': tpl('Rest is the better choice today, so there is no workout file.'),
  'workout.file.week-empty': tpl('This week has no runs left to put on a watch.'),

  // Steps that repeat: "7 x: Run 1 min; Walk 2 min".
  'workout.repeat': tpl(
    '{count} x: {steps}',
    { count: 'count', steps: 'text' },
    { shape: 'label' },
  ),
} satisfies Record<string, Template>

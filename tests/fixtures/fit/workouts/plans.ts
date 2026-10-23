// Three synthetic workouts, written out by hand so that a change in the engine cannot move them:
// an easy run, an interval session and a long run with a fuel line. `workoutFit.test.ts` checks
// that `encodeWorkoutFit` still writes the committed `.fit` files byte for byte; the same files
// are the ones to load on a watch for the manual check of the format (design 6.10).
//
// To write the files again after an intended change of the format:
//   npx tsx tests/fixtures/fit/workouts/write.ts
import type { ResolvedTargets } from '../../../../shared/engine/types.ts'
import type { WorkoutNode, WorkoutPlan } from '../../../../shared/workouts/types.ts'

/** The time and serial every golden file is written with. */
export const GOLDEN_OPTIONS = { createdAt: new Date('2026-07-10T06:30:00Z'), serial: 4_000_000_001 }

const BASE_TARGETS: ResolvedTargets = {
  zone: 'z1',
  mode: 'hr-ceiling',
  hrCeiling: 142,
  hrRange: null,
  paceSecPerKm: [360, 330],
  rpe: [2, 3],
  hot: false,
  hotNote: null,
  zonesNote: null,
  source: 'zones',
}

function plan(
  title: string,
  kind: WorkoutPlan['kind'],
  nodes: WorkoutNode[],
  over: Partial<WorkoutPlan> = {},
): WorkoutPlan {
  const seconds = nodes.reduce(
    (sum, node) =>
      sum +
      (node.type === 'step'
        ? node.durationSec
        : node.count * node.steps.reduce((inner, step) => inner + step.durationSec, 0)),
    0,
  )
  return {
    title,
    kind,
    nodes,
    totalSec: seconds,
    description: '',
    targets: BASE_TARGETS,
    eased: false,
    fuelLine: null,
    units: 'km',
    ...over,
  }
}

const open = { kind: 'open' } as const

export const EASY_RUN = plan('Easy run, 45 min', 'easy', [
  {
    type: 'step',
    intent: 'steady',
    label: 'Run',
    walk: false,
    durationSec: 2700,
    target: { kind: 'hr-ceiling', floorBpm: 40, ceilingBpm: 142 },
  },
])

export const INTERVALS = plan(
  'Intervals, 1 h',
  'intervals',
  [
    {
      type: 'step',
      intent: 'warmup',
      label: 'Warm up',
      walk: false,
      durationSec: 600,
      target: open,
    },
    {
      type: 'repeat',
      count: 5,
      steps: [
        {
          type: 'step',
          intent: 'work',
          label: 'Fast',
          walk: false,
          durationSec: 240,
          target: { kind: 'pace', slowSecPerKm: 272, fastSecPerKm: 258 },
        },
        {
          type: 'step',
          intent: 'recover',
          label: 'Recover',
          walk: false,
          durationSec: 240,
          target: open,
        },
      ],
    },
    {
      type: 'step',
      intent: 'cooldown',
      label: 'Cool down',
      walk: false,
      durationSec: 600,
      target: open,
    },
  ],
  { targets: { ...BASE_TARGETS, zone: 'z3', mode: 'pace', hrCeiling: null, rpe: [6, 7] } },
)

export const LONG_RUN = plan(
  'Long run, 2 h',
  'long',
  [
    {
      type: 'step',
      intent: 'steady',
      label: 'Run',
      walk: false,
      durationSec: 7200,
      target: { kind: 'hr-ceiling', floorBpm: 40, ceilingBpm: 142 },
    },
  ],
  { fuelLine: 'Fuel 60 g/h carbs. Drink to thirst.' },
)

/** File name to plan, in the order the manual check loads them. */
export const GOLDEN_WORKOUTS: ReadonlyArray<readonly [string, WorkoutPlan]> = [
  ['easy-run-45min.fit', EASY_RUN],
  ['intervals-5x4min.fit', INTERVALS],
  ['long-run-2h.fit', LONG_RUN],
]

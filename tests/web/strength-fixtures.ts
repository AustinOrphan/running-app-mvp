// Synthetic fixtures of the strength web tests (E14-7): a workout of three lifts, a trunk movement
// and a jump dose; the same for a runner with no equipment; the Strength page view; and the answers
// of the settings and log routes. No real history, equipment or names.
import { addDays } from '../../shared/dates.ts'
import { toGrams } from '../../shared/domain/weight.ts'
import { workoutFor } from '../../shared/engine/strength.ts'
import type {
  Activity,
  EquipmentKind,
  LiftEvidence,
  StrengthLog,
  StrengthLogResult,
  StrengthNextLoad,
  StrengthSet,
  StrengthSettings,
  StrengthSnapshotLift,
  StrengthView,
  StrengthWorkout,
  UserSettings,
  WorkoutLift,
} from '../../shared/types.ts'
import { activity } from '../unit/engine/e8-fixtures.ts'
import {
  have,
  log as engineLog,
  sessionRef,
  setsOf as engineSetsOf,
  withSetup,
} from '../unit/engine/strength-fixtures.ts'

/** Whole pounds as grams, the way a stored load is. */
export const lb = (pounds: number): number => toGrams(pounds, 'lb')

const count = (n: number) => ({ kind: 'count', n }) as const

/** A lift that was never logged: the rules read no session for it. */
const NO_EVIDENCE: LiftEvidence = { latest: null, judged: null, estimateG: null }

/** The session the fixtures stand on, and the day it is logged on. */
export const SESSION_ID = 's5a'
export const DAY = '2026-03-18'

/** Back squat on a bar: 4 sets of 3 to 6 at 110 lb, the bar in 5 lb jumps, leave 1 to 3. */
export function squat(over: Partial<WorkoutLift> = {}): WorkoutLift {
  return {
    exerciseId: 'back-squat',
    slot: 'knee',
    implement: 'barbell',
    sets: 4,
    range: { min: 3, max: 6 },
    targets: [5, 5, 4, 4],
    loadG: lb(110),
    steps: { minG: lb(45), stepG: lb(5), maxG: null },
    rir: { min: 1, max: 3 },
    change: 'increase',
    usualLoadG: null,
    basis: {
      rule: 'F8',
      facts: [
        {
          template: 'strength.reason.increase',
          slots: { exercise: 'Back squat', top: count(6) },
        },
      ],
    },
    evidence: NO_EVIDENCE,
    ...over,
  }
}

/** Dumbbell Romanian deadlift: 3 sets of 3 to 6 at 40 lb, from a list of dumbbells. */
export function rdl(over: Partial<WorkoutLift> = {}): WorkoutLift {
  return {
    exerciseId: 'dumbbell-rdl',
    slot: 'hip',
    implement: 'dumbbells',
    sets: 3,
    range: { min: 3, max: 6 },
    targets: [6, 6, 6],
    loadG: lb(40),
    steps: { loadsG: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60].map(lb) },
    rir: { min: 2, max: 2 },
    change: 'hold',
    usualLoadG: null,
    basis: {
      rule: 'F8',
      facts: [{ template: 'strength.reason.hold-unrecorded', slots: {} }],
    },
    evidence: NO_EVIDENCE,
    ...over,
  }
}

/** Standing calf raise with nothing added: the bodyweight path, no load field. */
export function calf(over: Partial<WorkoutLift> = {}): WorkoutLift {
  return {
    exerciseId: 'standing-calf-raise',
    slot: 'calf',
    implement: null,
    sets: 3,
    range: { min: 8, max: 15 },
    targets: [12, 12, 12],
    loadG: null,
    steps: null,
    rir: { min: 1, max: 3 },
    change: 'start',
    usualLoadG: null,
    basis: {
      rule: 'F8',
      facts: [
        {
          template: 'strength.reason.start-unloaded',
          slots: { exercise: 'Standing calf raise' },
        },
      ],
    },
    evidence: NO_EVIDENCE,
    ...over,
  }
}

/** A side plank: two holds counted in seconds, with no effort target and no load. */
export function plank(over: Partial<WorkoutLift> = {}): WorkoutLift {
  return {
    exerciseId: 'side-plank',
    slot: 'trunk',
    implement: null,
    sets: 2,
    range: { min: 30, max: 45 },
    targets: [30, 30],
    loadG: null,
    steps: null,
    rir: null,
    change: 'hold',
    usualLoadG: null,
    basis: { rule: 'F7', facts: [] },
    evidence: NO_EVIDENCE,
    ...over,
  }
}

/** A heavy session A: the three lifts, one jump movement and a side plank, planned for 40 minutes. */
export function makeWorkout(over: Partial<StrengthWorkout> = {}): StrengthWorkout {
  return {
    sessionId: SESSION_ID,
    date: DAY,
    template: 'heavy',
    variant: 'A',
    block: { week: 6, of: 12, rampInWeeks: 3 },
    budgetMin: 40,
    setupSaved: true,
    lifts: [squat(), rdl(), calf()],
    plyo: { contacts: 40, movements: ['pogo-hop'] },
    trunk: [plank()],
    rules: ['F-lib', 'F4', 'E5', 'F7'],
    ...over,
  }
}

/** The same session for a runner with no equipment: a tempo squat and a glute bridge, no loads. */
export function bodyweightWorkout(): StrengthWorkout {
  const bodyweight = (over: Partial<WorkoutLift>): WorkoutLift =>
    calf({ range: { min: 8, max: 15 }, targets: [10, 10, 10], ...over })
  return makeWorkout({
    template: 'ramp-in',
    block: { week: 1, of: 12, rampInWeeks: 3 },
    lifts: [
      bodyweight({ exerciseId: 'tempo-squat', slot: 'knee' }),
      bodyweight({ exerciseId: 'hip-thrust', slot: 'hip' }),
      bodyweight({}),
    ],
    plyo: null,
    trunk: [],
  })
}

/** A lighter day: each lift a set fewer, the load 10% lower, the usual load beside it. */
export function lighterDayWorkout(): StrengthWorkout {
  return makeWorkout({
    lifts: [
      squat({
        sets: 3,
        targets: [5, 5, 4],
        loadG: lb(100),
        usualLoadG: lb(110),
        change: 'lighter-day',
        basis: {
          rule: 'F9',
          facts: [{ template: 'strength.reason.lighter-day', slots: { sets: 'one set' } }],
        },
      }),
      rdl({ sets: 2, targets: [6, 6] }),
    ],
    plyo: null,
    trunk: [],
  })
}

/** A workout the engine derives for a runner with a bar and dumbbells, in week 6 of the block. */
export function engineWorkout(variant: 0 | 1 = 0): StrengthWorkout {
  const ctx = withSetup({ equipment: have('barbell', 'dumbbells', 'bands', 'step') })
  return workoutFor(ctx, sessionRef(5, variant))
}

/**
 * What the engine derives for a lighter day when the lifts are already at the lightest load the
 * dumbbells make: the cut can take sets and no load, so each lift keeps `usualLoadG` equal to
 * `loadG` and there is no usual load to go back to. A runner with two dumbbells (10 and 15 lb) held
 * every lift at 10 lb in the session before; the readiness read of the day is lower than usual.
 */
export function lightestRungWorkout(): StrengthWorkout {
  const ref = sessionRef(5)
  const rows = (reps: number) => Array.from({ length: 4 }, () => [10, reps, 2] as const)
  const ctx = {
    ...withSetup(
      {
        equipment: [
          ...have('step'),
          { kind: 'dumbbells', loads: { loadsG: [lb(10), lb(15)] } },
        ] as never,
      },
      {
        today: ref.date,
        logs: [
          engineLog('seed', addDays(ref.date, -3), {
            sets: [
              ...engineSetsOf('goblet-squat', rows(4)),
              ...engineSetsOf('dumbbell-rdl', rows(4), 10),
              ...engineSetsOf('standing-calf-raise', rows(8), 20),
            ],
          }),
        ],
      },
    ),
    readiness: { date: ref.date, state: 'possible-fatigue', pain: null, illness: 'clear' },
  } as never
  return workoutFor(ctx, ref)
}

export const SETTINGS: UserSettings = {
  email: 'runner@example.com',
  displayName: null,
  units: 'mi',
  weightUnit: 'lb',
}

export const STRENGTH_SETTINGS: StrengthSettings = {
  equipment: have('barbell', 'dumbbells', 'bands', 'step'),
  level: 'some',
  currentlyLifting: true,
  avoid: [],
  pinned: {},
  note: null,
  savedAt: '2026-03-01T09:00:00.000Z',
}

/** One logged set. */
export function set(
  exerciseId: string,
  position: number,
  pounds: number | null,
  reps: number,
  rir: number | null = null,
): StrengthSet {
  return { exerciseId, position, loadG: pounds === null ? null : lb(pounds), count: reps, rir }
}

/** What a log's snapshot shows of a lift: the exercise and the equipment its load was for. */
export function snapLift(
  exerciseId: string,
  implement: EquipmentKind | null,
  pounds: number | null,
): StrengthSnapshotLift {
  return {
    exerciseId,
    implement,
    sets: 3,
    range: { min: 3, max: 6 },
    rir: { min: 1, max: 3 },
    baseLoadG: pounds === null ? null : lb(pounds),
    shownLoadG: pounds === null ? null : lb(pounds),
    change: 'hold',
    basis: { rule: 'F8', facts: [] },
  }
}

/**
 * A saved log, as the page's `recent` list holds it. `lifts` is what its snapshot shows: the
 * default shows none, which the rules read as "any implement".
 */
export function makeLog(
  id: string,
  date: string,
  sets: StrengthSet[],
  lifts: StrengthSnapshotLift[] = [],
): StrengthLog {
  return {
    id,
    activityId: `a-${id}`,
    date,
    durationMin: 40,
    rpe: null,
    pain: null,
    notes: null,
    prescribed: { template: 'heavy', variant: 'A', week: 5, mode: 'normal', lifts },
    sets,
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
  }
}

/** The Strength page view, with the logs of last week: squat 105 lb for 5 x 3 and a deadlift. */
export function makeView(over: Partial<StrengthView> = {}): StrengthView {
  return {
    asOf: DAY,
    settings: STRENGTH_SETTINGS,
    anchors: [],
    setupSaved: true,
    block: { week: 6, of: 12, rampInWeeks: 3, template: 'heavy' },
    next: [],
    recent: [
      makeLog('l-last', '2026-03-12', [
        set('back-squat', 0, 105, 5, 2),
        set('back-squat', 1, 105, 5, 2),
        set('back-squat', 2, 105, 4, 1),
        set('dumbbell-rdl', 3, 35, 6, 3),
        set('dumbbell-rdl', 4, 35, 6, 3),
      ]),
    ],
    lifts: [],
    weeks: [],
    lowCountWeeks: 0,
    countPrompt: false,
    facts: [],
    ...over,
  }
}

/** What `PUT /api/strength/logs/:logId` answers: the log and its activity, and the loads for next time. */
export function savedLog(
  logId: string,
  next: StrengthNextLoad[] = [],
  activityOver: Partial<Activity> = {},
): StrengthLogResult {
  return {
    log: { ...makeLog(logId, DAY, []), id: logId },
    activity: activity(DAY, { type: 'strength', durationSec: 2400, ...activityOver }),
    next,
  }
}

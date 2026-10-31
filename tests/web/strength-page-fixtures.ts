// Synthetic fixtures of the Strength page tests (E14-9): the page view with a saved setup, lifts with
// their summaries, the history of one lift, a profile with an injury, and the answers of the setup
// routes. No real history, equipment or names.
import type { HistorySession } from '../../shared/engine/strength.ts'
import type {
  AthleteProfile,
  StrengthExerciseView,
  StrengthLiftSummary,
  StrengthLog,
  StrengthSet,
  StrengthSettings,
  StrengthView,
  WorkoutLift,
} from '../../shared/types.ts'
import { lb, makeLog, makeView, makeWorkout, rdl, set, squat } from './strength-fixtures.ts'

const count = (n: number) => ({ kind: 'count', n }) as const

/** The sentences that restate a Param, as `GET /api/strength` sends them (design 11.6). */
export const PAGE_FACTS: StrengthView['facts'] = [
  {
    template: 'strength.benefit',
    slots: { lo: count(2), hi: { kind: 'percent', pct: 4 } },
  },
  { template: 'strength.separation', slots: { hours: count(3) } },
]

/** The back squat as the Lifts list shows it: 105 lb after 100 lb, an estimate of 125 lb. */
export const SQUAT_SUMMARY: StrengthLiftSummary = {
  exerciseId: 'back-squat',
  lastDate: '2026-03-12',
  gapDays: 6,
  workingLoadG: lb(105),
  estimateG: lb(125),
  lastChange: { fromG: lb(100), toG: lb(105), date: '2026-03-12' },
  sessionCount: 3,
}

/** A dumbbell Romanian deadlift that has not moved and has no estimate. */
export const RDL_SUMMARY: StrengthLiftSummary = {
  exerciseId: 'dumbbell-rdl',
  lastDate: '2026-03-12',
  gapDays: 6,
  workingLoadG: lb(35),
  estimateG: null,
  lastChange: null,
  sessionCount: 1,
}

/** The ids of the two logs of the page view: long enough for the outbox's route to match them. */
export const LOG_LAST = '5d1e0c52-3f0a-4b8e-9a77-2a6a1c0e0001'
export const LOG_FIRST = '5d1e0c52-3f0a-4b8e-9a77-2a6a1c0e0002'

/** A logged session whose snapshot holds the lifts the sheet showed, as a save writes it. */
export function sessionLog(
  id: string,
  date: string,
  sets: StrengthSet[],
  lifts: WorkoutLift[],
): StrengthLog {
  const log = makeLog(id, date, sets)
  return {
    ...log,
    prescribed: {
      ...log.prescribed,
      lifts: lifts.map((lift) => ({
        exerciseId: lift.exerciseId,
        implement: lift.implement,
        sets: lift.sets,
        range: lift.range,
        rir: lift.rir,
        baseLoadG: lift.loadG,
        shownLoadG: lift.loadG,
        change: lift.change,
        basis: lift.basis,
      })),
    },
  }
}

/** A page view in week 6 of a block, the setup saved, two logs, two lifts and the next workout. */
export function pageView(over: Partial<StrengthView> = {}): StrengthView {
  return makeView({
    next: [makeWorkout()],
    recent: [
      sessionLog(
        LOG_LAST,
        '2026-03-12',
        [
          set('back-squat', 0, 105, 5, 2),
          set('back-squat', 1, 105, 5, 2),
          set('back-squat', 2, 105, 4, 1),
          set('dumbbell-rdl', 3, 35, 6, 3),
          set('dumbbell-rdl', 4, 35, 6, 3),
        ],
        [squat({ sets: 3, loadG: lb(105) }), rdl({ sets: 2, loadG: lb(35) })],
      ),
      sessionLog(
        LOG_FIRST,
        '2026-03-05',
        [set('back-squat', 0, 100, 5, 2), set('back-squat', 1, 100, 5, 2)],
        [squat({ sets: 2, loadG: lb(100) })],
      ),
    ],
    lifts: [SQUAT_SUMMARY, RDL_SUMMARY],
    facts: PAGE_FACTS,
    ...over,
  })
}

/** The view before the setup is saved: bodyweight only, the equipment and the offer to set up. */
export function unsavedView(over: Partial<StrengthView> = {}): StrengthView {
  const settings: StrengthSettings = {
    equipment: [],
    level: 'some',
    currentlyLifting: false,
    avoid: [],
    pinned: {},
    note: null,
    savedAt: null,
  }
  return pageView({
    setupSaved: false,
    settings,
    next: [makeWorkout({ setupSaved: false })],
    recent: [],
    lifts: [],
    ...over,
  })
}

/** One logged session of the back squat, as the history lists it. */
export function squatSession(
  logId: string,
  date: string,
  pounds: number,
  estimate: number | null,
  mode: HistorySession['mode'] = 'normal',
): HistorySession {
  return {
    logId,
    date,
    mode,
    sets: [
      { position: 0, loadG: lb(pounds), count: 5, rir: 2 },
      { position: 1, loadG: lb(pounds), count: 5, rir: 2 },
      { position: 2, loadG: lb(pounds), count: 4, rir: null },
    ],
    heaviest: { loadG: lb(pounds), count: 5 },
    workingLoadG: lb(pounds),
    estimateG: estimate === null ? null : lb(estimate),
  }
}

/** The history of the back squat: three sessions, newest first, two of them with an estimate. */
export function squatHistory(over: Partial<StrengthExerciseView> = {}): StrengthExerciseView {
  return {
    exerciseId: 'back-squat',
    anchor: null,
    summary: SQUAT_SUMMARY,
    sessions: [
      squatSession(LOG_LAST, '2026-03-12', 105, 125),
      squatSession('l-mid', '2026-03-08', 100, 120, 'lighter-day'),
      squatSession(LOG_FIRST, '2026-03-05', 100, null),
    ],
    ...over,
  }
}

/** A profile with one injury on record, which the units section lists. */
export const PROFILE: AthleteProfile = {
  birthYear: 1985,
  sex: 'unspecified',
  heightCm: null,
  weightKg: null,
  hrMax: null,
  hrMaxSource: null,
  hrRest: null,
  lthr: null,
  thresholdPaceSecPerKm: null,
  runningSinceYear: null,
  injuries: [
    { area: 'left knee', side: 'left', year: 2024, month: null, kind: 'joint', notes: null },
  ],
  availability: {
    mon: { available: true, maxMin: null },
    tue: { available: true, maxMin: null },
    wed: { available: true, maxMin: null },
    thu: { available: true, maxMin: null },
    fri: { available: true, maxMin: null },
    sat: { available: true, maxMin: null },
    sun: { available: true, maxMin: null },
  },
  longRunDay: 'sat',
  terrain: { trail: false, hills: false, treadmill: false, track: false },
  strengthPreference: 2,
  timezone: 'UTC',
  homeLat: null,
  homeLng: null,
  useHomeWeather: false,
}

// The nine synthetic athletes of the plan matrix [design section 9]: each has a profile, a run
// history of completed weeks and a goal. No personal data; dates are fixed so plans are stable.
import { addDays } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { goalModel } from '../../../shared/engine/goal.ts'
import type { EngineInput } from '../../../shared/engine/types.ts'
import type { Activity, AthleteProfile, Goal, Weekday } from '../../../shared/types.ts'
import { activity, goal as placeholderGoal, profile as baseProfile, TODAY } from './e8-fixtures.ts'

/** A Wednesday; the current week starts 2026-10-19 and holds no history, so week 0 is a part week. */
export { TODAY }

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const MON = '2026-10-19'

interface Run {
  /** 0 = Monday. */
  dow: number
  min: number
  /** Metres gained, for trail history. */
  gainM?: number
}

interface History {
  /** Weeks back from the current week, inclusive: 1 is last week. */
  fromWeek: number
  toWeek: number
  runs: Run[]
  paceSecPerKm: number
}

/** Completed runs for the given week ranges, oldest first. */
function runsOf(history: History[]): Activity[] {
  const out: Activity[] = []
  for (const block of history) {
    for (let w = block.toWeek; w >= block.fromWeek; w--) {
      const monday = addDays(MON, -7 * w)
      for (const r of block.runs) {
        const date = addDays(monday, r.dow)
        out.push(
          activity(date, {
            id: `run-${date}`,
            durationSec: r.min * 60,
            movingSec: r.min * 60,
            distanceM: Math.round(((r.min * 60) / block.paceSecPerKm) * 1000),
            elevationGainM: r.gainM ?? null,
            elevationLossM: r.gainM ?? null,
            rpe: 3,
          }),
        )
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** A completed race, the anchor of a race-based prediction. */
function raceResult(date: string, distanceM: number, timeSec: number): Activity {
  return activity(date, {
    id: `race-${date}`,
    type: 'race',
    durationSec: timeSec,
    movingSec: timeSec,
    distanceM,
    rpe: 9,
  })
}

function goalOf(over: Partial<Goal> & Pick<Goal, 'name' | 'targetDate' | 'distanceM'>): Goal {
  return {
    id: 'goal-1',
    userId: 'u1',
    priority: 'A',
    status: 'target',
    dateProvisional: false,
    location: null,
    successCriteria: null,
    notes: null,
    url: null,
    isActive: true,
    gainM: null,
    lossM: null,
    surface: 'road',
    goalType: 'time',
    targetTimeSec: null,
    startTime: null,
    raceLat: null,
    raceLng: null,
    supportLevel: 'aided',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  }
}

function avail(
  over: Partial<Record<Weekday, { available: boolean; maxMin: number | null }>> = {},
): AthleteProfile['availability'] {
  const day = { available: true, maxMin: null }
  return {
    ...(Object.fromEntries(WEEKDAYS.map((d) => [d, day])) as AthleteProfile['availability']),
    ...over,
  }
}

export interface MatrixAthlete {
  id: string
  label: string
  input: EngineInput
  /** Whether the goal is an ultra, so the ultra caps apply. */
  isUltra: boolean
}

function build(
  id: string,
  label: string,
  profile: AthleteProfile,
  history: History[],
  goal: Goal,
  climate: { wbgtC: number; source: 'forecast' | 'climatology' } | null = null,
  races: Activity[] = [],
): MatrixAthlete {
  const base: EngineInput = {
    today: TODAY,
    profile,
    activities: [...runsOf(history), ...races].sort((a, b) => (a.date < b.date ? -1 : 1)),
    wellness: [],
    reviews: [],
    goal: placeholderGoal(),
    forecast: null,
    existing: null,
    options: {},
  }
  const model = goalModel(goal, estimateState(base), climate)
  return { id, label, input: { ...base, goal: model }, isUltra: model.isUltra }
}

export function athletes(): MatrixAthlete[] {
  const steady: Run[] = [
    { dow: 1, min: 45 },
    { dow: 3, min: 50 },
    { dow: 4, min: 40 },
    { dow: 5, min: 80 },
  ]
  return [
    build(
      'novice-5k',
      'novice 5 km',
      baseProfile({ birthYear: 1996, sex: 'female', runningSinceYear: null, longRunDay: 'sat' }),
      [],
      goalOf({
        name: 'Synthetic 5 km',
        targetDate: '2027-01-16',
        distanceM: 5000,
        targetTimeSec: 1980,
      }),
    ),
    build(
      'half',
      'recreational half marathon',
      baseProfile({ birthYear: 1988, longRunDay: 'sat' }),
      [{ fromWeek: 1, toWeek: 12, runs: steady, paceSecPerKm: 330 }],
      goalOf({
        name: 'Synthetic half',
        targetDate: '2027-02-28',
        distanceM: 21_097,
        targetTimeSec: 6600,
      }),
    ),
    build(
      'marathon',
      'time-goal marathon',
      baseProfile({ birthYear: 1984, longRunDay: 'sat' }),
      [
        {
          fromWeek: 1,
          toWeek: 12,
          runs: [
            { dow: 0, min: 45 },
            { dow: 1, min: 60 },
            { dow: 3, min: 60 },
            { dow: 4, min: 40 },
            { dow: 5, min: 120 },
          ],
          paceSecPerKm: 315,
        },
      ],
      goalOf({
        name: 'Synthetic marathon',
        targetDate: '2027-03-14',
        distanceM: 42_195,
        targetTimeSec: 12_600,
      }),
      null,
      [raceResult('2026-09-12', 10_000, 3000)],
    ),
    build(
      'trail-50k',
      '50 km trail',
      baseProfile({
        birthYear: 1986,
        longRunDay: 'sat',
        terrain: { trail: true, hills: true, treadmill: false, track: false },
      }),
      [
        {
          fromWeek: 1,
          toWeek: 12,
          runs: [
            { dow: 1, min: 50, gainM: 150 },
            { dow: 3, min: 60, gainM: 250 },
            { dow: 4, min: 45, gainM: 100 },
            { dow: 5, min: 130, gainM: 600 },
          ],
          paceSecPerKm: 400,
        },
      ],
      goalOf({
        name: 'Synthetic 50 km trail',
        targetDate: '2027-03-06',
        distanceM: 50_000,
        gainM: 2200,
        lossM: 2200,
        surface: 'trail',
        goalType: 'finish',
        startTime: '07:00',
      }),
    ),
    build(
      'first-100-mile',
      'first 100-mile',
      baseProfile({
        birthYear: 1985,
        longRunDay: 'sat',
        terrain: { trail: true, hills: true, treadmill: false, track: false },
      }),
      [
        {
          fromWeek: 1,
          toWeek: 12,
          runs: [
            { dow: 0, min: 45 },
            { dow: 1, min: 60, gainM: 200 },
            { dow: 3, min: 60, gainM: 200 },
            { dow: 4, min: 45 },
            { dow: 5, min: 150, gainM: 700 },
          ],
          paceSecPerKm: 400,
        },
      ],
      goalOf({
        name: 'Synthetic 100 miles',
        targetDate: '2027-05-08',
        distanceM: 160_934,
        gainM: 4500,
        lossM: 4500,
        surface: 'trail',
        goalType: 'finish',
        startTime: '06:00',
      }),
    ),
    build(
      'masters',
      'masters marathon, limited days',
      baseProfile({
        birthYear: 1968,
        sex: 'female',
        longRunDay: 'sun',
        availability: avail({
          mon: { available: false, maxMin: null },
          wed: { available: false, maxMin: null },
          fri: { available: true, maxMin: 45 },
        }),
      }),
      [
        {
          fromWeek: 1,
          toWeek: 12,
          runs: [
            { dow: 1, min: 45 },
            { dow: 3, min: 45 },
            { dow: 4, min: 30 },
            { dow: 6, min: 75 },
          ],
          paceSecPerKm: 360,
        },
      ],
      goalOf({
        name: 'Synthetic masters marathon',
        targetDate: '2027-02-21',
        distanceM: 42_195,
        targetTimeSec: 16_200,
      }),
    ),
    build(
      'returning',
      'returning after six weeks off',
      baseProfile({ birthYear: 1990, longRunDay: 'sat' }),
      [
        {
          fromWeek: 7,
          toWeek: 16,
          runs: [
            { dow: 1, min: 50 },
            { dow: 3, min: 55 },
            { dow: 4, min: 40 },
            { dow: 5, min: 95 },
          ],
          paceSecPerKm: 340,
        },
      ],
      goalOf({
        name: 'Synthetic returning half',
        targetDate: '2027-03-07',
        distanceM: 21_097,
        targetTimeSec: 7200,
      }),
    ),
    build(
      'prior-bsi',
      'prior bone stress injury',
      baseProfile({
        birthYear: 1992,
        sex: 'female',
        heightCm: 168,
        weightKg: 52,
        longRunDay: 'sat',
        injuries: [
          { area: 'tibia', side: 'left', year: 2026, month: 4, kind: 'bone-stress', notes: null },
        ],
      }),
      [
        {
          fromWeek: 1,
          toWeek: 12,
          runs: [
            { dow: 1, min: 40 },
            { dow: 3, min: 40 },
            { dow: 5, min: 60 },
          ],
          paceSecPerKm: 360,
        },
      ],
      goalOf({
        name: 'Synthetic 10 km',
        targetDate: '2027-01-30',
        distanceM: 10_000,
        targetTimeSec: 3000,
      }),
    ),
    build(
      'hot-race',
      'hot marathon',
      baseProfile({ birthYear: 1990, sex: 'female', longRunDay: 'sun' }),
      [
        {
          fromWeek: 1,
          toWeek: 12,
          runs: [
            { dow: 1, min: 50 },
            { dow: 2, min: 40 },
            { dow: 4, min: 50 },
            { dow: 6, min: 100 },
          ],
          paceSecPerKm: 345,
        },
      ],
      goalOf({
        name: 'Synthetic hot marathon',
        targetDate: '2027-04-18',
        distanceM: 42_195,
        targetTimeSec: 14_400,
      }),
      { wbgtC: 27, source: 'climatology' },
    ),
  ]
}

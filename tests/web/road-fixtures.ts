// Synthetic road race plans for the web tests (rule H15, ADR 0023): the real engine over made-up
// goals, round-tripped through JSON as the wire does. No real race, runner or place.
import { addDays } from '../../shared/dates.ts'
import { replayLadder } from '../../shared/engine/fuel.ts'
import {
  roadRacePlanFor,
  roadSummaryOf,
  type RoadRacePlan,
  type RoadRacePlanInput,
  type RoadRacePlanSummary,
} from '../../shared/engine/racePlanRoad.ts'
import type { FuelRunInput, GoalModel } from '../../shared/engine/types.ts'

const HOUR = 3600
const MIN = 60

export const ROAD_TODAY = '2026-06-08'
export const ROAD_RACE = '2026-06-13'

const BASE_GOAL: GoalModel = {
  goalId: 'goal-road',
  name: 'Example Marathon',
  date: ROAD_RACE,
  distanceM: 42_195,
  gainM: 0,
  lossM: 0,
  surface: 'road',
  goalType: 'finish',
  targetTimeSec: null,
  startTime: '08:00',
  isUltra: false,
  distanceClass: 'marathon',
  expectedDurationSec: 4 * HOUR,
  crossesDarkness: false,
  raceWbgtC: 12,
}

const OPEN = { optIn90: true, optInAdvanced: true, giDisease: false }

function toleratedRun(n: number): FuelRunInput {
  return {
    activityId: `a${String(n).padStart(3, '0')}`,
    date: addDays('2026-03-02', n * 7),
    startTime: null,
    elapsedSec: 3 * HOUR,
    weather: { tempC: 12, humidityPct: 60, windKph: 5 },
    sessionFlags: null,
    log: {
      skipped: false,
      items: [
        { name: 'Gel', sodiumMg: null, kcal: null, servings: 1, carbsG: 375, multiCarb: true },
      ],
      gut: 0,
      nausea: null,
      hotOverride: null,
    },
  }
}

export type RoadFixtureKind = 'marathon-heat' | 'half-under-2h' | '10k' | 'trail-marathon'

/** A plan for one of the four classes the screenshots and the tests cover. */
export function roadPlan(kind: RoadFixtureKind = 'marathon-heat'): RoadRacePlan {
  const mid = {
    'marathon-heat': 4 * HOUR,
    'half-under-2h': 1 * HOUR + 38 * MIN,
    '10k': 52 * MIN,
    'trail-marathon': 5 * HOUR + 10 * MIN,
  }[kind]
  const goal: GoalModel = {
    ...BASE_GOAL,
    expectedDurationSec: mid,
    ...(kind === 'marathon-heat' ? { raceWbgtC: 24 } : {}),
    ...(kind === 'half-under-2h' ? { distanceM: 21_097.5, distanceClass: 'half' as const } : {}),
    ...(kind === '10k' ? { distanceM: 10_000, distanceClass: '10k' as const } : {}),
    ...(kind === 'trail-marathon' ? { surface: 'trail' as const, gainM: 1400, lossM: 1400 } : {}),
  }
  const input: RoadRacePlanInput = {
    goal,
    supportLevel: 'aided',
    prediction: {
      predictedSec: mid,
      lowSec: mid * 0.95,
      highSec: mid * 1.05,
      rules: ['L6', 'L2', 'I2'],
    },
    coolPredictedSec: kind === 'marathon-heat' ? mid - 7 * MIN : mid,
    cs: { mps: 4.2, fromTraining: false, widened: false },
    ladder: replayLadder({
      settings: OPEN,
      runs: [toleratedRun(0), toleratedRun(1), toleratedRun(2)],
      gutTrainingWeeks: [],
    }),
    weightKg: 70,
    acclimationCredit: 0.4,
    today: ROAD_TODAY,
  }
  return JSON.parse(JSON.stringify(roadRacePlanFor(input))) as RoadRacePlan
}

/** The Today summary of a plan for a viewed day; null outside race week and for a 10 km. */
export function roadSummary(plan: RoadRacePlan, date: string): RoadRacePlanSummary | null {
  const summary = roadSummaryOf(plan, date)
  return summary === null ? null : (JSON.parse(JSON.stringify(summary)) as RoadRacePlanSummary)
}

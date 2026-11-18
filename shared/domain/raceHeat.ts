// Whether the plan can know the race heat (rule I8, batch RH1). The heat block, the hot-race lines
// of the race plan and the earlier nausea plan all read the race's climate normal, which is cached
// for one place: the goal's own race place when both its coordinates are set, else the home place
// when the profile allows it and both home coordinates are set (`climateKeyFor`,
// `server/services/weatherCache.ts`; one coordinate never pairs with a home one). Pure: the caller
// says whether the cache has a value, so nothing here reads the database or the network.
import type { GoalModel } from '../engine/types.ts'

/**
 * The classes of the road race plan (`isRoadPlanClass`). Listed here and not imported: the road
 * engine module is read only by the race service and the road pieces (`racePlanIsolation.test.ts`).
 */
const ROAD_PLAN_CLASSES: ReadonlyArray<GoalModel['distanceClass']> = ['10k', 'half', 'marathon']

/** What the plan can tell about the race heat: known, no place to read it for, or a place not read yet. */
export type RaceHeatState = 'known' | 'no-place' | 'unread'

/** Which place the climate is read for: the race's own, else home, else none. */
export type RaceHeatPlace = 'race' | 'home' | null

export interface RaceHeatPlaces {
  /** The place that is set and used: the race place first, then home when its weather switch is on. */
  using: RaceHeatPlace
  /** Both coordinates of the goal's race place are set. */
  racePlaceSet: boolean
  /** Both coordinates of the home place are set. */
  homePlaceSet: boolean
  /** The profile lets the home place stand in for weather (`useHomeWeather`). */
  homeWeatherOn: boolean
  state: RaceHeatState
}

export interface RaceHeatInput {
  goal: { raceLat: number | null; raceLng: number | null; targetDate: string }
  /** The goal as the engine models it; only its class is read. */
  model: Pick<GoalModel, 'isUltra' | 'distanceClass'>
  home: { lat: number | null; lng: number | null; use: boolean }
  /** `GoalModel.raceWbgtC !== null`: the cache holds a usable value for the race. */
  climateKnown: boolean
  today: string
}

/**
 * The places and the state of the race heat for a goal whose heat the engine reads, or null for any
 * other goal: a class with no race plan (the I8 block still reads the heat, but the plan and the
 * notice are for an ultra and the 10 km to marathon classes) or a race whose date is past.
 */
export function raceHeatPlaces(input: RaceHeatInput): RaceHeatPlaces | null {
  const { goal, model, home } = input
  if (!model.isUltra && !ROAD_PLAN_CLASSES.includes(model.distanceClass)) return null
  if (goal.targetDate < input.today) return null
  const racePlaceSet = goal.raceLat !== null && goal.raceLng !== null
  const homePlaceSet = home.lat !== null && home.lng !== null
  const using: RaceHeatPlace = racePlaceSet ? 'race' : homePlaceSet && home.use ? 'home' : null
  const state: RaceHeatState = input.climateKnown ? 'known' : using === null ? 'no-place' : 'unread'
  return { using, racePlaceSet, homePlaceSet, homeWeatherOn: home.use, state }
}

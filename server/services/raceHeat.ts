// The places the race heat is read for and whether it is known (rule I8, RH1): the one builder the
// Race page, Explain and "What the plan can see" share, so the three tell the same story. Reads the
// cached climate only, never fetches or waits.
import { raceHeatPlaces, type RaceHeatPlaces } from '../../shared/domain/raceHeat.ts'
import type { GoalModel } from '../../shared/engine/types.ts'
import type { Goal } from '../../shared/types.ts'
import type { PrismaClient } from '../db.ts'
import type { AthleteContext } from './athleteState.ts'
import { climateFailed } from './weatherCache.ts'

/**
 * `raceHeatPlaces` for `goal` and its model, or null when the notice does not apply. The model must
 * carry the cached climate (`goalModelFor(..., { climate: true })`).
 */
export async function loadRaceHeat(
  prisma: PrismaClient,
  context: Pick<AthleteContext, 'profile' | 'prediction'>,
  goal: Goal,
  model: GoalModel,
  today: string,
): Promise<RaceHeatPlaces | null> {
  const home = {
    lat: context.profile.homeLat,
    lng: context.profile.homeLng,
    use: context.profile.useHomeWeather,
  }
  const known = model.raceWbgtC !== null
  // The road plan measures its fuel block by the prediction's middle, else the goal's own time.
  const prediction = await context.prediction(goal.id)
  return raceHeatPlaces({
    goal,
    model,
    home,
    climateKnown: known,
    climateFailed: known ? false : await climateFailed(prisma, goal, home),
    expectedSec: prediction?.predictedSec ?? model.expectedDurationSec,
    today,
  })
}

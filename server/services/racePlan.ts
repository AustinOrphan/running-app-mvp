// The race plan of the goal (rule H14, ADR 0018): the pure `racePlanFor` fed from the athlete
// snapshot, the replayed fuel ladder and the cached race climate, memoised by data version and day.
// Nothing here writes, waits or reads the network: the race WBGT is the climate normal in
// `ClimateCache` (a state table), so the plan reads no forecast and its change key is the data
// version and the day (`athleteKey`).
import { daysBetween } from '../../shared/dates.ts'
import { courseSilhouettePoints } from '../../shared/domain/courseSilhouette.ts'
import { racePlanFor, summaryOf } from '../../shared/engine/racePlan.ts'
import type { RacePlanSummary } from '../../shared/engine/racePlan.ts'
import type { CourseSilhouettePoint, RacePlanView } from '../../shared/types.ts'
import { goalModelFor, loadAthleteContext, memoByVersion } from './athleteState.ts'
import type { SnapshotDeps } from './athleteState.ts'
import { loadFuelState } from './fuel.ts'
import { listRaceCheckpoints } from './raceCheckpoints.ts'

export type RaceDeps = SnapshotDeps

/**
 * The plan of the runner's current goal (`currentGoalFor`), or why there is none: no goal, a goal
 * with no distance, a goal that is not an ultra (every class above the marathon, as H11), or a race
 * that is over. Computed once per data version and day; the result is deep-frozen.
 */
export function loadRacePlan(
  deps: RaceDeps,
  args: { userId: string; today: string },
): Promise<RacePlanView> {
  const { userId, today } = args
  return memoByVersion(deps, { userId, today, name: 'race.plan' }, () =>
    buildRacePlan(deps, userId, today),
  )
}

async function buildRacePlan(deps: RaceDeps, userId: string, today: string): Promise<RacePlanView> {
  const context = await loadAthleteContext(deps, { userId, today })
  const goal = context.goal
  if (goal === null) return { plan: null, reason: 'no-goal' }
  if (goal.distanceM === null) return { plan: null, reason: 'no-distance' }
  if (daysBetween(today, goal.targetDate) < 0) return { plan: null, reason: 'race-over' }
  const model = await goalModelFor(context, goal.id, { climate: true })
  if (model === null) return { plan: null, reason: 'no-distance' }
  if (!model.isUltra) return { plan: null, reason: 'not-ultra' }

  const [prediction, fuel, checkpoints] = await Promise.all([
    context.prediction(goal.id),
    loadFuelState(deps, userId),
    // The one read of the table besides its own route: the plan's memo drops with a save.
    listRaceCheckpoints(deps.prisma, { userId, goalId: goal.id }),
  ])
  const plan = racePlanFor({
    goal: model,
    supportLevel: goal.supportLevel,
    prediction,
    z1CeilingBpm: context.zones.hr?.z1[1] ?? null,
    ladder: fuel.ladder,
    weightKg: context.profile.weightKg,
    acclimationCredit: context.state.heatAcclimation,
    checkpoints,
    history: {
      activities: context.activities,
      homeLat: context.profile.homeLat,
      homeLng: context.profile.homeLng,
    },
    today,
  })
  // The same rows the plan was drawn from: no second read of the table.
  return { plan, reason: null, course: courseSilhouettePoints(checkpoints, goal) }
}

/**
 * The Today slot `race`: the race-week card and the race-day block for the viewed day, cut from the
 * plan, or null outside race week, for a goal that is not an ultra and once the race is over. It
 * reads state only (the plan's own memo), so the data version in the page's ETag covers it.
 */
export async function todayRaceSlot(
  deps: RaceDeps,
  args: { userId: string; today: string; date: string },
): Promise<RacePlanSummary | null> {
  const view = await loadRacePlan(deps, { userId: args.userId, today: args.today })
  return view.plan === null ? null : summaryOf(view.plan, args.date)
}

/**
 * The coarse profile of the current goal's course for Today's countdown (`courseSilhouettePoints`):
 * null without a goal, a distance, or a climb or descent in the runner's course points. Not part of
 * the plan, so it serves any goal class. Computed once per data version (`RaceCheckpoint` and `Goal`
 * are state models, so a save drops it); the table is read here and nowhere else beside the plan.
 */
export function loadRaceCourse(
  deps: RaceDeps,
  args: { userId: string; today: string },
): Promise<CourseSilhouettePoint[] | null> {
  const { userId, today } = args
  return memoByVersion(deps, { userId, name: 'race.course' }, async () => {
    const goal = (await loadAthleteContext(deps, { userId, today })).goal
    if (goal === null) return null
    const checkpoints = await listRaceCheckpoints(deps.prisma, { userId, goalId: goal.id })
    return courseSilhouettePoints(checkpoints, goal)
  })
}

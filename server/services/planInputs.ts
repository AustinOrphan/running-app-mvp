// What the plan can see (rule T2): the counts of the data the engine reads for one runner, from the
// athlete snapshot and nothing else but the ids of the stored streams. Memoised by data version, day
// and `climateFailureStamp` (the race heat notice reads `ClimateFailure`, not state); nothing here writes, waits or reads the network.
import { isDuplicate } from '../../shared/engine/load.ts'
import { planInputs, type PlanInputsView } from '../../shared/domain/planInputs.ts'
import { PROVIDERS } from '../providers/registry.ts'
import {
  goalModelFor,
  hrModelOf,
  loadAthleteContext,
  memoByVersion,
  type SnapshotDeps,
} from './athleteState.ts'
import { loadRaceHeat } from './raceHeat.ts'
import { climateFailureStamp } from './weatherCache.ts'

const MEMO = 'plan-inputs.view'

/** The counts of one runner's data as of `today`. */
export async function loadPlanInputs(
  deps: SnapshotDeps,
  args: { userId: string; today: string; climateStamp?: string },
): Promise<PlanInputsView> {
  const { userId, today } = args
  // The race heat notice reads `ClimateFailure`, which is not state: its stamp is in the memo name
  // (a caller that has read it for the page tag passes it in).
  const stamp = args.climateStamp ?? (await climateFailureStamp(deps.prisma))
  return memoByVersion(deps, { userId, today, name: `${MEMO}:${stamp}` }, async () => {
    const context = await loadAthleteContext(deps, { userId, today })
    const runIds = context.activities
      .filter((a) => (a.type === 'run' || a.type === 'race') && !isDuplicate(a))
      .map((a) => a.id)
    // The snapshot holds no column for the stored stream, so its presence is one read of the ids.
    const streams =
      runIds.length === 0
        ? []
        : await deps.prisma.activityStream.findMany({
            where: { activityId: { in: runIds } },
            select: { activityId: true },
          })
    const goal = context.goal
    const model = goal === null ? null : await goalModelFor(context, goal.id, { climate: true })
    const raceHeat =
      goal === null || model === null
        ? null
        : await loadRaceHeat(deps.prisma, context, goal, model, today)
    return planInputs({
      raceHeat,
      windows: context.disruptions,
      today,
      profile: { sex: context.profile.sex, birthYear: context.profile.birthYear },
      wellness: context.wellness,
      wellnessWindowDays: context.inputs.wellness.windowDays,
      activities: context.activities,
      watchRatings: context.watchRatings,
      streamIds: new Set(streams.map((row) => row.activityId)),
      zones: context.zones,
      hrModel: await hrModelOf(deps, context),
      providerLabels: Object.values(PROVIDERS).map(({ info }) => ({
        key: info.key,
        label: info.label,
      })),
    })
  })
}

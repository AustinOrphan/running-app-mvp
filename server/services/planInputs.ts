// What the plan can see (rule T2): the counts of the data the engine reads for one runner, from the
// athlete snapshot and nothing else but the ids of the stored streams. Memoised by data version and
// day; nothing here writes, waits or reads the network.
import { isDuplicate } from '../../shared/engine/load.ts'
import { planInputs, type PlanInputsView } from '../../shared/domain/planInputs.ts'
import { PROVIDERS } from '../providers/registry.ts'
import { hrModelOf, loadAthleteContext, memoByVersion, type SnapshotDeps } from './athleteState.ts'

const MEMO = 'plan-inputs.view'

/** The counts of one runner's data as of `today`. */
export function loadPlanInputs(
  deps: SnapshotDeps,
  args: { userId: string; today: string },
): Promise<PlanInputsView> {
  const { userId, today } = args
  return memoByVersion(deps, { userId, today, name: MEMO }, async () => {
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
    return planInputs({
      today,
      profile: context.profile,
      wellness: context.wellness,
      wellnessWindowDays: context.inputs.wellness.windowDays,
      activities: context.activities,
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

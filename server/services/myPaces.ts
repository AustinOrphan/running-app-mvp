// My paces (rule C9, ADR 0020): the pure `myPaces` fed from the athlete snapshot and the heart-rate
// line, memoised by data version and day. Nothing here writes, waits or reads the network. A custom
// course is one more `eventRow` over the same snapshot, so it is not part of the memo.
import { eventRow, myPaces, type EventRow, type MyPaces } from '../../shared/engine/myPaces.ts'
import { PACE_EVENTS } from '../../shared/domain/paceEvents.ts'
import { hrModelOf, loadAthleteContext, memoByVersion, type SnapshotDeps } from './athleteState.ts'

const MEMO = 'paces.view'

/** The easy pace, the standard events and the test of one runner as of `today`. */
export function loadMyPaces(
  deps: SnapshotDeps,
  args: { userId: string; today: string },
): Promise<MyPaces> {
  const { userId, today } = args
  return memoByVersion(deps, { userId, today, name: MEMO }, async () => {
    const context = await loadAthleteContext(deps, { userId, today })
    return myPaces(
      {
        state: context.state,
        zones: context.zones,
        hrModel: await hrModelOf(deps, context),
        activities: context.activities,
        today,
      },
      PACE_EVENTS,
    )
  })
}

/** The prediction row of a course the runner named: flat road, or trail when it climbs. */
export async function loadCustomEvent(
  deps: SnapshotDeps,
  args: { userId: string; today: string; distanceM: number; gainM: number },
): Promise<EventRow> {
  const { userId, today, distanceM, gainM } = args
  const context = await loadAthleteContext(deps, { userId, today })
  return eventRow(context.state, { key: 'custom', distanceM, gainM })
}

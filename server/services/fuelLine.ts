// The seam between the deliverable builder and the fuel lab (phase 3a design 6.5 and 10.5). The
// builder calls `loadFuelContext` once per build and `fuelLineFor` once per session, so the line
// on a watch, in a workout file and in a calendar description comes from one place. The fuel
// module (`shared/engine/fuel.ts`) is pure; the context it reads is loaded here from the shared
// replay of the ladder (`server/services/fuel.ts`), which is memoised by data version, and from
// the cached home forecast for the days a hot forecast holds a target back.
import type { FuelContext } from '../../shared/engine/fuel.ts'
import { fuelLineForSession } from '../../shared/engine/fuel.ts'
import type { FuelSessionInput } from '../../shared/engine/types.ts'
import type { Deps } from '../app.ts'
import { buildFuelContext, type FuelContextArgs, type FuelHeld } from './fuel.ts'

export type { FuelContextArgs, FuelHeld }

/**
 * The fuel context for sessions from `today` to `horizonDays` after it: the settings, the replayed
 * ladder and the forecast's peaks by date. Reads no network. A caller that already holds the
 * athlete snapshot or the cached forecast passes it in `held`, so the build reads each once.
 */
export function loadFuelContext(
  deps: Deps,
  args: FuelContextArgs,
  held?: FuelHeld,
): Promise<FuelContext> {
  return buildFuelContext(deps, args, held)
}

/** The watch line of a session (at most 60 characters), or null without a context or a target. */
export function fuelLineFor(context: FuelContext | null, session: FuelSessionInput): string | null {
  return context === null ? null : fuelLineForSession(context, session)
}

// The seam between the deliverable builder and the fuel lab (phase 3a design 6.5 and 10.5). The
// builder calls `loadFuelContext` once per build and `fuelLineFor` once per session, so the line
// on a watch, in a workout file and in a calendar description comes from one place. The fuel
// module (`shared/engine/fuel.ts`) is pure; the context it reads is loaded here.
//
// A stub until E6-5, which replaces `loadFuelContext` with the real load (the settings, the
// replayed ladder and the forecast's peaks by date). Until then the context is null and no session
// carries a fuel line. `fuelLineFor` already calls the real pure function for a context it is given.
import type { FuelContext } from '../../shared/engine/fuel.ts'
import { fuelLineForSession } from '../../shared/engine/fuel.ts'
import type { FuelSessionInput } from '../../shared/engine/types.ts'
import type { Deps } from '../app.ts'

export interface FuelContextArgs {
  userId: string
  today: string
  /** Days after `today` that the sessions asked about can fall on. */
  horizonDays: number
}

/** The fuel context for a run of sessions, or null while the fuel lab is not wired in. */
export function loadFuelContext(_deps: Deps, _args: FuelContextArgs): Promise<FuelContext | null> {
  return Promise.resolve(null)
}

/** The watch line of a session (at most 60 characters), or null without a context or a target. */
export function fuelLineFor(context: FuelContext | null, session: FuelSessionInput): string | null {
  return context === null ? null : fuelLineForSession(context, session)
}

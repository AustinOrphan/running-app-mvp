// The clock that Strava's API Policy 7.4 needs (SC1, ADR 0025): when Strava refuses a runner's
// token, the runs that came from Strava are removed 25 days later unless the runner connects
// again. The date is kept in the Strava `Integration` row's `config` as `deleteAt` (an ISO
// instant), so no schema change is needed. Pure: the sync service and the daily job write and read it.

/** The `Integration.provider` key and the `Activity.source` value of Strava. */
export const STRAVA_KEY = 'strava'

/** Days between a refused token and the removal of the runs that came from Strava. */
export const REMOVAL_DAYS = 25

const DAY_MS = 86_400_000
const KEY = 'deleteAt'

/** The removal date a config holds, or null when it holds none or an unreadable one. */
export function removalDateOf(config: Readonly<Record<string, unknown>>): Date | null {
  const value = config[KEY]
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms)
}

/**
 * The config with the clock started at `now`. A clock that already runs keeps its date: a second
 * refusal must not push the removal out.
 */
export function withRemovalClock(
  config: Readonly<Record<string, unknown>>,
  now: Date,
): Record<string, unknown> {
  if (removalDateOf(config) !== null) return { ...config }
  return { ...config, [KEY]: new Date(now.getTime() + REMOVAL_DAYS * DAY_MS).toISOString() }
}

/** The config with no clock: the runner connected again. */
export function withoutRemovalClock(
  config: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const { [KEY]: _dropped, ...rest } = config
  return rest
}

/** Whether the clock has run out at `now`. */
export function removalIsDue(config: Readonly<Record<string, unknown>>, now: Date): boolean {
  const date = removalDateOf(config)
  return date !== null && date.getTime() <= now.getTime()
}

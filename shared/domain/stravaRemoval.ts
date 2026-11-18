// Strava's API Policy 7.4 (SC1, ADR 0025): when Strava refuses a runner's token (a refused refresh
// token or a 401), the runs that came from Strava are deleted at once, the way Disconnect deletes
// them. The row keeps `config.refusedAt` (an ISO instant) so Today and the card can say why the
// connection needs signing in; connecting again clears it and the next run reads the last year.
// Pure: the sync service and the daily job write and read it.

/** The `Integration.provider` key and the `Activity.source` value of Strava. */
export const STRAVA_KEY = 'strava'

const KEY = 'refusedAt'

/** When Strava refused the token, or null when the config holds no refusal or an unreadable one. */
export function refusedAtOf(config: Readonly<Record<string, unknown>>): Date | null {
  const value = config[KEY]
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms)
}

/** The config with the refusal noted at `now`; an earlier refusal keeps its date. */
export function withRefusal(
  config: Readonly<Record<string, unknown>>,
  now: Date,
): Record<string, unknown> {
  if (refusedAtOf(config) !== null) return { ...config }
  return { ...config, [KEY]: now.toISOString() }
}

/** The config with no refusal: the runner connected again. */
export function withoutRefusal(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { [KEY]: _dropped, ...rest } = config
  return rest
}

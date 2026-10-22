// Stub from the data-foundation scaffold; Task D6 implements it. The OAuth helpers keep these
// signatures so that Task D10 (routes) compiles against them.
import type { ProviderCtx, PullProvider } from './types.ts'

/** Non-secret Strava config: the client id and the optional public base URL. */
export interface StravaConfig {
  clientId: string
  publicBaseUrl?: string
}

/** The consent-screen URL for `GET https://www.strava.com/oauth/authorize`. */
export function authorizeUrl(config: StravaConfig, redirectUri: string, state: string): string {
  void config
  void redirectUri
  void state
  throw new Error('not implemented')
}

/** Exchanges an OAuth `code` and returns the new secret (client secret plus tokens). */
export function exchangeCode(
  code: string,
  redirectUri: string,
  ctx: ProviderCtx,
): Promise<Record<string, unknown>> {
  void code
  void redirectUri
  void ctx
  return Promise.reject(new Error('not implemented'))
}

/** Returns a valid access token, refreshing (and saving through `ctx.saveSecret`) when needed. */
export function refreshIfNeeded(ctx: ProviderCtx): Promise<string> {
  void ctx
  return Promise.reject(new Error('not implemented'))
}

export const stravaProvider: PullProvider = {
  connect() {
    throw new Error('not implemented')
  },
  listActivities() {
    throw new Error('not implemented')
  },
  fetchActivity() {
    throw new Error('not implemented')
  },
}

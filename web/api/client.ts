import { QueryClient } from '@tanstack/react-query'
import type { ApiErrorBody, ApiErrorCode, ValidationIssue } from '../../shared/types.ts'

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details?: unknown
  /** The server's request id, from the body of a 5xx (ER1); absent on any other failure. */
  readonly ref?: string

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
    ref?: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    if (ref !== undefined) this.ref = ref
  }
}

/** The reference `error` carries, or null: only an `ApiError` from a 5xx has one. */
export function referenceOf(error: unknown): string | null {
  return error instanceof ApiError && error.ref !== undefined ? error.ref : null
}

/**
 * The reference (the server's request id) of the newest failed response that carried one, or of the
 * newest render error; a later 5xx without one clears it (a success does not: queries run side by side,
 * and one that succeeds must not hide the reference of one that failed). `ErrorState` and the feedback note read it,
 * so a failed screen and the note the runner sends name the same line in the server log (ER1).
 */
let latestReference: string | null = null

export function reference(): string | null {
  return latestReference
}

export function setReference(value: string | null): void {
  latestReference = value
}

/** Window event fired when a signed-in request comes back 401, so the app can go to /login. */
export const UNAUTHORIZED_EVENT = 'rl:unauthorized'

/**
 * Paths where a 401 is an expected answer (wrong password, no account yet), not an expiry, so it
 * raises no `UNAUTHORIZED_EVENT`. `GET /auth/me` is the exception that is an expiry: `useMe` turns
 * its 401 into "signed out" and purges the device's data itself.
 */
function isAuthFlow(path: string): boolean {
  return path === '/setup' || path.startsWith('/auth/')
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = value.error
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  )
}

/**
 * Same-origin JSON request. `path` is relative to `/api` (for example `/plan`); a leading `/api`
 * is accepted too. Failures throw `ApiError`. Resolves to `undefined` for an empty (204) body. A
 * `signal` that fires cancels the request: it is an `ApiError` with status 0 when it had not
 * answered yet.
 */
export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const relative = path.startsWith('/api/') ? path.slice(4) : path
  let response: Response
  try {
    response = await fetch(`/api${relative}`, {
      method,
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch {
    throw new ApiError(0, 'internal', 'The server did not respond.')
  }

  const text = await response.text()
  let payload: unknown
  if (text !== '') {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = undefined
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !isAuthFlow(relative.split('?')[0] ?? relative)) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    if (isErrorBody(payload)) {
      const { code, message, details, ref } = payload.error
      const own = response.status >= 500 && typeof ref === 'string' && ref !== '' ? ref : undefined
      if (own !== undefined) latestReference = own
      else if (response.status >= 500) latestReference = null
      throw new ApiError(response.status, code, message, details, own)
    }
    if (response.status >= 500) latestReference = null
    throw new ApiError(response.status, 'internal', 'The server returned an unexpected response.')
  }

  return payload as T
}

/** Query string for the defined values, with a leading `?`; empty when there are none. */
export function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const text = search.toString()
  return text === '' ? '' : `?${text}`
}

/** Field messages from a validation error, keyed by path; empty for any other error. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== 'validation') return {}
  const issues = (err.details as { issues?: ValidationIssue[] } | undefined)?.issues
  const result: Record<string, string> = {}
  for (const issue of issues ?? []) {
    if (!(issue.path in result)) result[issue.path] = issue.message
  }
  return result
}

/**
 * The app's query client. `networkMode: 'always'` for queries and mutations: the library's default
 * pauses a request while the browser says it is offline, and a paused request never reaches what
 * can answer it. A read then never reaches the service worker, which answers an allowlisted one from
 * the phone's copy, and a check-in tapped after the connection went never reaches the outbox, which
 * keeps it on the phone: it would wait in memory and be lost with the page. Both now run, fail fast
 * and say so (ADR 0012).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'always',
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          failureCount < 2 &&
          !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
      mutations: { networkMode: 'always', retry: false },
    },
  })
}

export const keys = {
  me: 'me',
  setup: 'setup',
  settings: 'settings',
  activities: 'activities',
  imports: 'imports',
  goals: 'goals',
  plan: 'plan',
  reviews: 'reviews',
  weeks: 'weeks',
  profile: 'profile',
  wellness: 'wellness',
  integrations: 'integrations',
  syncRuns: 'syncRuns',
  jobs: 'jobs',
  activityDetail: 'activityDetail',
  planRevisions: 'planRevisions',
  planArchived: 'planArchived',
  disruptions: 'disruptions',
  brief: 'brief',
  fuel: 'fuel',
  strength: 'strength',
  race: 'race',
  today: 'today',
  zones: 'zones',
  zoneProposals: 'zoneProposals',
  predictions: 'predictions',
  paces: 'paces',
  planInputs: 'planInputs',
  screenings: 'screenings',
  planNotice: 'planNotice',
  researchParams: 'researchParams',
  explain: 'explain',
  state: 'state',
  stats: 'stats',
  trends: 'trends',
  wrist: 'wrist',
  mapArea: 'mapArea',
  usualStart: 'usualStart',
} as const

/**
 * Drops every cached answer except `me` and `setup`, which the caller sets itself: the answers of
 * one account are not shown to the next in the same tab (a 401, then another account signs in; the
 * cache would otherwise hand the second account the first one's Today for up to five minutes).
 * Reads still in flight are cancelled. The two kept queries stay in the cache because their
 * observers (the auth gate, the login page) stay mounted, and a query removed under an observer is
 * no longer the one the observer reads.
 */
export function dropUserQueries(queryClient: QueryClient): void {
  // The reference of the last session's failure is not the next account's to see in a feedback note.
  latestReference = null
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== keys.me && query.queryKey[0] !== keys.setup,
  })
}

/**
 * Every query that reads the plan or what a change to it moves: the plan and its sessions (the
 * session workout sits under its key), the revision list, the rest windows, the reviews, the weekly
 * brief, the athlete state, Today, the watch status (the sessions it lists are the plan's), the
 * fuel targets (the run targets they follow are the plan's) and the strength readers (the workouts
 * are derived from the stored plan's strength sessions).
 */
const PLAN_READER_KEYS = [
  keys.plan,
  keys.planRevisions,
  keys.disruptions,
  keys.reviews,
  keys.brief,
  keys.state,
  keys.today,
  keys.wrist,
  keys.fuel,
  keys.strength,
] as const

/**
 * Reads those queries again after a write to the plan (an undo, a re-plan, an adjusted session, a
 * rest window, a week edit, a new plan, a zone decision, a run linked to a session). `skip` leaves
 * out the queries it names (the dry run of the edit that was just applied, which would read
 * "nothing to change"); `also` adds the keys that only some writes move (a new plan also changes the
 * goals and the archived plans, a zone decision the zones and their proposals, a link the
 * activities).
 *
 * Deliberately not routed through here, each with its own list: the writes to activity data (a run
 * added, edited, deleted, imported or synced; `invalidateActivityData`), which link and assess
 * sessions against what was run but record no revision; a profile save (`useUpdateProfile`) and a
 * goal edit that leaves the plan alone, which record no revision; and the "seen" stamps, which move
 * only the revision list, the brief and Today. A new write that records a revision or changes what
 * a session asks for goes through this function.
 */
export function invalidatePlanReaders(
  queryClient: QueryClient,
  skip?: (queryKey: readonly unknown[]) => boolean,
  also: readonly string[] = [],
): Promise<unknown> {
  return Promise.all(
    [...PLAN_READER_KEYS, ...also].map((key) =>
      queryClient.invalidateQueries({
        queryKey: [key],
        predicate: skip === undefined ? undefined : (query) => !skip(query.queryKey),
      }),
    ),
  )
}

/**
 * What a new plan moves beyond the readers of the plan: the goals (the plan's goal becomes the
 * active goal), the archived plans (the old plan is archived) and the predictions.
 */
export const NEW_PLAN_KEYS = [keys.goals, keys.planArchived, keys.predictions] as const

/**
 * Everything that reads the plan or the goal it follows, after a new plan replaces the old one
 * (a restored plan, an activated goal that replaces it). The readers of the plan include the weekly
 * brief, which describes the plan it was built from.
 */
export function invalidateNewPlan(queryClient: QueryClient): Promise<unknown> {
  return invalidatePlanReaders(queryClient, undefined, NEW_PLAN_KEYS)
}

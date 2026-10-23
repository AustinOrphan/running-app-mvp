import { QueryClient } from '@tanstack/react-query'
import type { ApiErrorBody, ApiErrorCode, ValidationIssue } from '../../shared/types.ts'

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details?: unknown

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Window event fired when a signed-in request comes back 401, so the app can go to /login. */
export const UNAUTHORIZED_EVENT = 'rl:unauthorized'

/** Paths where a 401 is an expected answer (wrong password, no account yet), not an expiry. */
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
 * is accepted too. Failures throw `ApiError`. Resolves to `undefined` for an empty (204) body.
 */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
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
      const { code, message, details } = payload.error
      throw new ApiError(response.status, code, message, details)
    }
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

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          failureCount < 2 &&
          !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
      mutations: { retry: false },
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
  today: 'today',
  checkins: 'checkins',
  zones: 'zones',
  zoneProposals: 'zoneProposals',
  predictions: 'predictions',
  screenings: 'screenings',
  researchParams: 'researchParams',
} as const

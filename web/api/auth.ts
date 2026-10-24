import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { SessionUser } from '../../shared/types.ts'
import { purgeDeviceData } from '../pwa/outbox.ts'
import { api, ApiError, dropUserQueries, keys } from './client.ts'

/**
 * The signed-in user, or null when there is no valid session. A 401 here is the expired session
 * that meets the app when it opens: `api()` raises no `UNAUTHORIZED_EVENT` for an `/auth/` path
 * (a wrong password is a 401 too), and no listener runs with nobody signed in, so the purge is made
 * here. The check-in queue and the drafts of the session that ended leave the device now, not at
 * the next sign-in (ADR 0012, spec 7.6). A network failure is not a 401 and purges nothing.
 */
export function useMe() {
  return useQuery({
    queryKey: [keys.me],
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        return await api<SessionUser>('GET', '/auth/me')
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          void purgeDeviceData()
          return null
        }
        throw error
      }
    },
    retry: false,
  })
}

export function useSetupStatus() {
  return useQuery({
    queryKey: [keys.setup],
    queryFn: () => api<{ needsSetup: boolean }>('GET', '/setup'),
  })
}

export interface LoginRequest {
  email: string
  password: string
}

export interface SetupRequest extends LoginRequest {
  displayName?: string
}

/**
 * The id of the signed-in user as the `me` cache holds it, read without a request: null when it is
 * not cached. For keys that must not be shared between accounts on one browser.
 */
export function useCachedUserId(): string | null {
  const queryClient = useQueryClient()
  return queryClient.getQueryData<SessionUser | null>([keys.me])?.id ?? null
}

/**
 * Starts a session: nothing of the one that ended is left to show or to send. The page's cached
 * answers go first (they are the previous account's), then the device's drafts, outbox and copy of
 * the server's answers, through the one purge (`purgeDeviceData`).
 */
async function startSession(queryClient: QueryClient): Promise<void> {
  dropUserQueries(queryClient)
  await purgeDeviceData()
}

/**
 * Signs in; the returned user goes straight into the `me` cache. A new session starts with an
 * empty page cache, no drafts, an empty outbox and an empty copy of the server's answers on the
 * device: whatever is there belongs to the session that ended.
 */
export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: LoginRequest) => api<SessionUser>('POST', '/auth/login', request),
    onSuccess: async (user) => {
      await startSession(queryClient)
      queryClient.setQueryData([keys.me], user)
    },
  })
}

/** Creates the first account; the new session user is cached and setup is marked done. */
export function useSetup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: SetupRequest) => api<SessionUser>('POST', '/setup', request),
    onSuccess: async (user) => {
      await startSession(queryClient)
      queryClient.setQueryData([keys.me], user)
      queryClient.setQueryData([keys.setup], { needsSetup: false })
    },
  })
}

/**
 * Signs out and drops every cached query, every unsent draft, every write waiting in the outbox and
 * the device's copy of the server's answers, so no data outlives the session.
 */
export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('POST', '/auth/logout'),
    onSuccess: async () => {
      queryClient.clear()
      queryClient.setQueryData([keys.me], null)
      await purgeDeviceData()
    },
  })
}

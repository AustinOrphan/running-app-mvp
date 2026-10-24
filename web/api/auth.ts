import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SessionUser } from '../../shared/types.ts'
import { getOutbox, purgeDeviceData } from '../pwa/outbox.ts'
import { purgeApiCache } from '../pwa/register.ts'
import { api, ApiError, keys } from './client.ts'

/** The signed-in user, or null when there is no valid session. */
export function useMe() {
  return useQuery({
    queryKey: [keys.me],
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        return await api<SessionUser>('GET', '/auth/me')
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
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
 * Signs in; the returned user goes straight into the `me` cache. A new session starts with an
 * empty outbox and an empty copy of the server's answers on the device: whatever is there belongs
 * to the session that ended.
 */
export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: LoginRequest) => api<SessionUser>('POST', '/auth/login', request),
    onSuccess: async (user) => {
      await Promise.all([getOutbox().clear(), purgeApiCache()])
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
      await Promise.all([getOutbox().clear(), purgeApiCache()])
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

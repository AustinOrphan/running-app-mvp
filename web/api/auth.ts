import { useQuery } from '@tanstack/react-query'
import type { SessionUser } from '../../shared/types.ts'
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

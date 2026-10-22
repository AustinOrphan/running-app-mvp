import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { IntegrationStatus } from '../../shared/types.ts'
import { invalidateActivityData } from './activities.ts'
import { api, keys } from './client.ts'

/** The answer to a connect call; OAuth providers also return the page to send the owner to. */
export type ConnectResult = IntegrationStatus & { authorizeUrl?: string }

/** A sync adds activities and wellness, so those lists go stale with the status. */
function invalidateSyncData(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: [keys.integrations] }),
    queryClient.invalidateQueries({ queryKey: [keys.imports] }),
    queryClient.invalidateQueries({ queryKey: [keys.wellness] }),
    invalidateActivityData(queryClient),
  ])
}

/** One status per registry provider, connected or not, in registry order. */
export function useIntegrations() {
  return useQuery({
    queryKey: [keys.integrations],
    queryFn: () => api<IntegrationStatus[]>('GET', '/integrations'),
  })
}

/** `input` is the provider-specific connect body. */
export function useConnectIntegration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, input }: { provider: string; input: unknown }) =>
      api<ConnectResult>('PUT', `/integrations/${encodeURIComponent(provider)}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [keys.integrations] }),
  })
}

/** Starts a background sync (the server answers 202); `from` is the first day to pull. */
export function useSyncIntegration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, from }: { provider: string; from?: string }) =>
      api<IntegrationStatus>(
        'POST',
        `/integrations/${encodeURIComponent(provider)}/sync`,
        from === undefined ? {} : { from },
      ),
    onSuccess: () => invalidateSyncData(queryClient),
  })
}

/** Forgets the credentials; imported activities stay. */
export function useDisconnectIntegration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (provider: string) =>
      api<void>('DELETE', `/integrations/${encodeURIComponent(provider)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [keys.integrations] }),
  })
}

/** A new push token, shown once; it replaces any earlier token. */
export function useCreatePushToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (provider: string) =>
      api<{ token: string }>('POST', `/integrations/${encodeURIComponent(provider)}/push-token`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [keys.integrations] }),
  })
}

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

/** How often the list is fetched again while a sync the owner started is running. */
export const SYNC_POLL_MS = 2000
/** A sync that has not shown a new `lastSyncAt` after this long is no longer waited for. */
const SYNC_WATCH_LIMIT_MS = 5 * 60_000
const WATCH_KEY = 'integrationsSyncWatch'

/** Per provider: the `lastSyncAt` it had when the sync started, and when that was. */
type SyncWatch = Record<string, { lastSyncAt: string | null; startedAt: number }>

/**
 * One status per registry provider, connected or not, in registry order. While a sync started
 * here is running the list is fetched again every `SYNC_POLL_MS`, and stops when the provider
 * shows a newer `lastSyncAt` (the run finished), needs reconnecting, or the wait limit passes.
 * The sync endpoint answers 202 at once, so the finish is only visible this way.
 */
export function useIntegrations() {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: [keys.integrations],
    queryFn: () => api<IntegrationStatus[]>('GET', '/integrations'),
    refetchInterval: (query) => {
      const watch = queryClient.getQueryData<SyncWatch>([WATCH_KEY]) ?? {}
      const waiting = Object.keys(watch)
      if (waiting.length === 0) return false
      const list = query.state.data
      const open: SyncWatch = {}
      let finished = false
      for (const provider of waiting) {
        const entry = watch[provider]!
        const item = list?.find((candidate) => candidate.provider === provider)
        const done =
          item !== undefined &&
          (item.lastSyncAt !== entry.lastSyncAt ||
            item.status === 'needs_auth' ||
            Date.now() - entry.startedAt > SYNC_WATCH_LIMIT_MS)
        if (done) finished = true
        else open[provider] = entry
      }
      if (finished) {
        queryClient.setQueryData([WATCH_KEY], open)
        // The run stored its activities and wellness after the first refresh.
        void invalidateSyncData(queryClient)
      }
      return Object.keys(open).length > 0 ? SYNC_POLL_MS : false
    },
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
    onMutate: ({ provider }) => {
      // The list as shown before the sync: a newer `lastSyncAt than this marks the finish.
      const list = queryClient.getQueryData<IntegrationStatus[]>([keys.integrations])
      const before = list?.find((item) => item.provider === provider)?.lastSyncAt ?? null
      return { provider, before }
    },
    onSuccess: (_status, { provider }, context) => {
      const watch = queryClient.getQueryData<SyncWatch>([WATCH_KEY]) ?? {}
      queryClient.setQueryData<SyncWatch>([WATCH_KEY], {
        ...watch,
        [provider]: { lastSyncAt: context.before, startedAt: Date.now() },
      })
      return invalidateSyncData(queryClient)
    },
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

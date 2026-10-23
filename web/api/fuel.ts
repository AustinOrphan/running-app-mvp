import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { FuelLabView, FuelLogResult, FuelLogView, FuelTargetView } from '../../shared/types.ts'
import { getOutbox, refreshAfterSend } from '../pwa/outbox.ts'
import { api, keys, qs } from './client.ts'

/**
 * One item of a log request: a product of the runner's list with the servings taken (the server
 * copies the product's name and amounts into the log), or food of the runner's own. The keys are
 * exactly those of `server/routes/fuel.ts`, which rejects any other.
 */
export type FuelItemBody =
  | { productId: string; servings: number }
  | {
      name: string
      carbsG: number
      sodiumMg?: number | null
      kcal?: number | null
      multiCarb?: boolean
      servings: number
    }

/** The body of `PUT /api/fuel/logs/:activityId`: a full replacement, so a repeat leaves one row. */
export interface FuelLogBody {
  items: FuelItemBody[]
  fluidMl: number | null
  sodiumMg: number | null
  /** 0 to `h7.gutSymptomScaleMax`; required. */
  gut: number
  nausea: number | null
  /** The runner's own answer to "it was hot"; null leaves it to the weather on every replay. */
  hot: boolean | null
  notes: string | null
}

/**
 * The Fuel lab view: the ladder replayed from the logs, the products, the latest logs and the
 * safety card. The log form reads its products, its history and the target from it.
 */
export function useFuelLab(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.fuel, 'lab'],
    queryFn: () => api<FuelLabView>('GET', '/fuel'),
    enabled: options.enabled ?? true,
  })
}

/** The fuel log of a run; the data is null when the run has none. */
export function useFuelLog(activityId: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.fuel, 'log', activityId],
    queryFn: () =>
      api<FuelLogView | null>('GET', `/fuel/logs/${encodeURIComponent(activityId ?? '')}`),
    enabled: (options.enabled ?? true) && activityId !== undefined && activityId !== '',
  })
}

/** The fuel targets of the active plan's runs from `from` to `to` (at most 62 days). */
export function useFuelTargets(from: string, to: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.fuel, 'targets', from, to],
    queryFn: () => api<FuelTargetView[]>('GET', `/fuel/targets${qs({ from, to })}`),
    enabled: options.enabled ?? true,
  })
}

/** A log changes the ladder, the targets of the runs ahead and the prompts on Today. */
function invalidateAfterLog(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [keys.fuel, keys.today].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  )
}

/** The URL of the fuel log of one run: the key of its entry in the outbox. */
export function fuelLogUrl(activityId: string): string {
  return `/api/fuel/logs/${encodeURIComponent(activityId)}`
}

/** Where a saved fuel log ended up. */
export type FuelSaveResult =
  /** The server has it; `message` is its sentence ("Tolerated at 60 g/h. ..."), when it sent one. */
  | { status: 'sent'; message: string | null }
  /** It is kept on this phone and goes out when a connection allows. */
  | { status: 'queued' }
  /** The server refused it, in these words; it is not queued. */
  | { status: 'rejected'; reason: string }

/** The sentence of a `FuelLogResult` in an answer the outbox handed back, or null. */
function messageOf(response: unknown): string | null {
  if (typeof response !== 'object' || response === null || !('message' in response)) return null
  return typeof response.message === 'string' ? response.message : null
}

/**
 * Saves the log of a run through the outbox: the request is an idempotent upsert, so it is kept on
 * this phone first and sent at once, or later when there is no connection. A sent answer carries the
 * sentence to show ("Tolerated at 60 g/h. Next long run: 70 g/h."). The ladder, the targets and
 * Today are read again once the server has the log: by the outbox listener (`useOutboxReplay`),
 * which also covers a log sent later, and here, joining that read, so the answer comes back with the
 * fresh data in place (`refreshAfterSend`).
 */
export function useSaveFuelLog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      activityId,
      body,
    }: {
      activityId: string
      body: FuelLogBody
    }): Promise<FuelSaveResult> => {
      const result = await getOutbox().save(fuelLogUrl(activityId), { ...body })
      return result.status === 'sent'
        ? { status: 'sent', message: messageOf(result.response) }
        : result
    },
    onSuccess: (result, { activityId }) =>
      result.status === 'sent'
        ? refreshAfterSend(queryClient, fuelLogUrl(activityId), { cancelRefetch: false })
        : undefined,
  })
}

/** "Not this time": the run does not count toward the ladder. A 409 when the run has a log. */
export function useSkipFuelLog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (activityId: string) =>
      api<FuelLogResult>('POST', `/fuel/logs/${encodeURIComponent(activityId)}/skip`),
    onSuccess: () => invalidateAfterLog(queryClient),
  })
}

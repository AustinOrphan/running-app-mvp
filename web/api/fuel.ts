import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  FuelLabView,
  FuelLogResult,
  FuelLogView,
  FuelProduct,
  FuelProductKind,
  FuelSettings,
  FuelTargetView,
} from '../../shared/types.ts'
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

/**
 * Saves the log of a run. The request is an idempotent upsert, so sending it twice leaves the same
 * row; the answer carries the sentence to show ("Tolerated at 60 g/h. Next long run: 70 g/h.").
 */
export function useSaveFuelLog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ activityId, body }: { activityId: string; body: FuelLogBody }) =>
      api<FuelLogResult>('PUT', `/fuel/logs/${encodeURIComponent(activityId)}`, body),
    onSuccess: () => invalidateAfterLog(queryClient),
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

/**
 * The body of `POST /api/fuel/products` and `PUT /api/fuel/products/:id`: a full replacement, so a
 * repeat leaves one row. The keys are exactly those of `server/routes/fuel.ts`.
 */
export interface FuelProductBody {
  name: string
  kind: FuelProductKind
  servingLabel: string
  carbsG: number
  sodiumMg: number | null
  kcal: number | null
  multiCarb: boolean
}

/** The lab view carries the products, the ladder's ceiling and the plan's block: all of it moves. */
function invalidateFuel(queryClient: QueryClient): Promise<unknown> {
  return queryClient.invalidateQueries({ queryKey: [keys.fuel] })
}

/** Adds a product to the runner's list. A 409 when the name is taken or the list is full. */
export function useCreateFuelProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: FuelProductBody) => api<FuelProduct>('POST', '/fuel/products', body),
    onSuccess: () => invalidateFuel(queryClient),
  })
}

/** Replaces the fields of a live product. */
export function useUpdateFuelProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: FuelProductBody }) =>
      api<FuelProduct>('PUT', `/fuel/products/${encodeURIComponent(id)}`, body),
    onSuccess: () => invalidateFuel(queryClient),
  })
}

/** Archives a product: it leaves the pick list and old logs keep its name and amounts. */
export function useArchiveFuelProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<undefined>('DELETE', `/fuel/products/${encodeURIComponent(id)}`),
    onSuccess: () => invalidateFuel(queryClient),
  })
}

/**
 * Saves the four switches and answers with what the server kept: a gut condition forces the others
 * off. A 400 on `optInAdvanced` before the second tier was tolerated carries the sentence to show.
 * The ladder and every target follow the switches at once, so Today's fuel line is read again too.
 */
export function useSaveFuelSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: FuelSettings) => api<FuelSettings>('PUT', '/fuel/settings', body),
    onSuccess: () =>
      Promise.all(
        [keys.fuel, keys.today].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      ),
  })
}

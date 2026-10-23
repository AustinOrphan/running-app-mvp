import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { ACTIVITY_PAGE_MAX } from '../../shared/limits.ts'
import type {
  Activity,
  ActivityDetail,
  ActivityListItem,
  ActivityListPage,
  ActivityType,
  Feel,
} from '../../shared/types.ts'
import { api, keys, qs } from './client.ts'

/** Rows the Activities page adds with each "Show more". */
export const ACTIVITY_VIEW_PAGE = 50
/**
 * Pages `useActivities` follows before it stops: 20 pages of `ACTIVITY_PAGE_MAX` rows is 10,000
 * activities, far beyond a history, and bounds a server that keeps saying there is more.
 */
export const ACTIVITY_FOLLOW_MAX_PAGES = 20

export interface ActivityInput {
  date: string
  startTime?: string | null
  type: ActivityType
  durationSec: number
  distanceM?: number | null
  rpe?: number | null
  avgHr?: number | null
  maxHr?: number | null
  elevationGainM?: number | null
  notes?: string | null
  feel?: Feel | null
  pain?: number | null
}

/** Partial update of the three feedback fields; `null` clears one. */
export interface FeedbackPatch {
  rpe?: number | null
  feel?: Feel | null
  pain?: number | null
}

export interface ActivityParams {
  from?: string
  to?: string
  type?: ActivityType
}

/**
 * Activities feed the week rows, the statistics, the review suggestions and the detail page, and
 * the server links, assesses and re-evaluates plan sessions on every change (so the plan, today's
 * advice and the predictions move too), and so does the athlete state they all read: all go stale
 * together.
 */
export function invalidateActivityData(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [
      keys.activities,
      keys.activityDetail,
      keys.weeks,
      keys.reviews,
      keys.today,
      keys.plan,
      keys.predictions,
      keys.state,
      keys.stats,
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  )
}

function pageUrl(params: ActivityParams, limit: number, offset: number): string {
  return `/activities${qs({ from: params.from, to: params.to, type: params.type, limit, offset })}`
}

/**
 * Every activity the filters match, as list rows, read page by page (`nextOffset`) in pages of
 * `ACTIVITY_PAGE_MAX`, at most `ACTIVITY_FOLLOW_MAX_PAGES`. For the screens that need a whole
 * bounded window (the week strip, a review, the days around a session); a screen that shows the
 * list uses `useActivityPages`.
 */
export function useActivities(params: ActivityParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.activities, params],
    enabled: options.enabled ?? true,
    queryFn: async (): Promise<ActivityListItem[]> => {
      const items: ActivityListItem[] = []
      let offset: number | null = 0
      for (let page = 0; offset !== null && page < ACTIVITY_FOLLOW_MAX_PAGES; page += 1) {
        const result: ActivityListPage = await api<ActivityListPage>(
          'GET',
          pageUrl(params, ACTIVITY_PAGE_MAX, offset),
        )
        items.push(...result.items)
        offset = result.nextOffset
      }
      return items
    },
  })
}

/** What `useActivityPages` hands to a page: the rows loaded so far and the server's total. */
export interface ActivityPages {
  items: ActivityListItem[]
  /** Every row the filters match, as of the newest page read. */
  total: number
}

/**
 * The rows of every page read, each id once. Pages are read by offset, so a write between two
 * reads (an hourly sync adding a run) shifts a row onto the next page; the first copy wins.
 */
export function joinPages(data: { pages: ActivityListPage[] }): ActivityPages {
  const last = data.pages.at(-1)
  const seen = new Set<string>()
  const items: ActivityListItem[] = []
  for (const page of data.pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
  }
  return { items, total: last?.total ?? 0 }
}

/**
 * The activities list a page shows, `ACTIVITY_VIEW_PAGE` rows at a time: `fetchNextPage` adds the
 * next page, `hasNextPage` says whether there is one, and `isFetchNextPageError` marks a failed
 * "show more" that left the rows already loaded in place.
 */
export function useActivityPages(params: ActivityParams = {}, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: [keys.activities, 'pages', params],
    enabled: options.enabled ?? true,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<ActivityListPage>('GET', pageUrl(params, ACTIVITY_VIEW_PAGE, pageParam)),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    select: joinPages,
  })
}

/** One activity with its stream and laps; `id` may be undefined while the route resolves. */
export function useActivityDetail(id: string | undefined) {
  return useQuery({
    queryKey: [keys.activityDetail, id],
    queryFn: () => api<ActivityDetail>('GET', `/activities/${encodeURIComponent(id ?? '')}/detail`),
    enabled: id !== undefined && id !== '',
  })
}

export function useCreateActivity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ActivityInput) => api<Activity>('POST', '/activities', input),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}

export function useUpdateActivity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ActivityInput }) =>
      api<Activity>('PUT', `/activities/${encodeURIComponent(id)}`, input),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}

export function useDeleteActivity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>('DELETE', `/activities/${encodeURIComponent(id)}`),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}

export function useResolveDuplicate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'confirmed' | 'dismissed' }) =>
      api<Activity>('POST', `/activities/${encodeURIComponent(id)}/duplicate`, { status }),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}

/** RPE, feel and pain for one activity (`PATCH /activities/:id/feedback`). */
export function useSaveFeedback(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: FeedbackPatch) =>
      api<Activity>('PATCH', `/activities/${encodeURIComponent(id)}/feedback`, patch),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}

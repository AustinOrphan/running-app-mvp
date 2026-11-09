import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MapAreaView } from '../../shared/types.ts'
import { useOnline } from '../components/useOnline.ts'
import { api, keys } from './client.ts'

/** How often the area is read again while runs inside it still wait for their shares. */
const PROGRESS_POLL_MS = 15_000
/** How often it is read while a download runs (also one started from another tab), area or not. */
const BUSY_POLL_MS = 5_000

/** The downloaded map area (M1d) and how many of the runs inside it are worked out. */
export function useMapArea() {
  const online = useOnline()
  return useQuery({
    queryKey: [keys.mapArea],
    queryFn: () => api<MapAreaView>('GET', '/map-area'),
    enabled: online,
    refetchInterval: (q) => {
      const data = q.state.data
      if (data?.busy) return BUSY_POLL_MS
      return data?.area && data.area.done < data.area.runs ? PROGRESS_POLL_MS : false
    },
  })
}

/**
 * The one request to OpenStreetMap for the area: first download or "Download again". The answer is
 * the new area; every run's shares are worked out again in the background.
 */
export function useDownloadMapArea() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<MapAreaView>('POST', '/map-area', {}),
    onSuccess: (view) => {
      queryClient.setQueryData([keys.mapArea], view)
      return queryClient.invalidateQueries({ queryKey: [keys.activityDetail] })
    },
    // A refused or dropped download leaves the server's state unknown (a 409 means another is
    // running): read it again.
    onError: () => queryClient.invalidateQueries({ queryKey: [keys.mapArea] }),
  })
}

/** Removes the ways and the area and clears the shares on every run. */
export function useRemoveMapArea() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<MapAreaView>('DELETE', '/map-area'),
    onSuccess: (view) => {
      queryClient.setQueryData([keys.mapArea], view)
      return queryClient.invalidateQueries({ queryKey: [keys.activityDetail] })
    },
  })
}

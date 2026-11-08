import { useQuery } from '@tanstack/react-query'
import type { EventRow } from '../../shared/engine/myPaces.ts'
import type { MyPacesView } from '../../shared/types.ts'
import { api, keys, qs } from './client.ts'

/** A course the runner named, in metres; the climb is optional. */
export interface CustomCourse {
  distanceM: number
  gainM: number | null
}

/**
 * The easy pace, what the runner can run now at the standard distances, the test the engine
 * supports (`paces`), and the row of a course of their own when they name one (`custom`), rule C9,
 * ADR 0020. The server derives it on every read from the activities and the profile, so a write
 * that changes either invalidates the key (`ACTIVITY_DATA_KEYS`, the profile and the zones); it is
 * not one of the reads the service worker keeps (ADR 0012), so offline the page says it needs a
 * connection. The custom course is a query of its own, so a failure to answer it leaves the page
 * as it is, and the previous course stays on screen while a new one loads.
 */
export function useMyPaces(course: CustomCourse | null) {
  const paces = useQuery({
    queryKey: [keys.paces],
    queryFn: () => api<MyPacesView>('GET', '/paces'),
    staleTime: 0,
  })
  const custom = useQuery({
    queryKey: [keys.paces, 'custom', course?.distanceM ?? null, course?.gainM ?? null],
    queryFn: async (): Promise<EventRow | null> =>
      (
        await api<MyPacesView>(
          'GET',
          `/paces${qs({ distanceM: course?.distanceM, gainM: course?.gainM ?? undefined })}`,
        )
      ).custom,
    enabled: course !== null,
    staleTime: 0,
    placeholderData: (previous) => previous,
  })
  return { paces, custom }
}

import { useQuery } from '@tanstack/react-query'
import type { MyPacesView } from '../../shared/types.ts'
import { api, keys, qs } from './client.ts'

/** A course the runner named, in metres; the climb is optional. */
export interface CustomCourse {
  distanceM: number
  gainM: number | null
}

/**
 * The easy pace, what the runner can run now at the standard distances and at a course of their
 * own, and the test the engine supports (rule C9, ADR 0020). The server derives it on every read
 * from the activities and the profile, so a write that changes either invalidates the key
 * (`ACTIVITY_DATA_KEYS`, the profile and the zones); it is not one of the reads the service worker
 * keeps (ADR 0012), so offline the page says it needs a connection. The course is part of the key,
 * and the previous answer stays on screen while a new course loads.
 */
export function useMyPaces(course: CustomCourse | null) {
  return useQuery({
    queryKey: [keys.paces, course?.distanceM ?? null, course?.gainM ?? null],
    queryFn: () =>
      api<MyPacesView>(
        'GET',
        `/paces${qs({ distanceM: course?.distanceM, gainM: course?.gainM ?? undefined })}`,
      ),
    staleTime: 0,
    placeholderData: (previous) => previous,
  })
}

import { useMutation, useQuery } from '@tanstack/react-query'
import type { UsualStart } from '../../shared/domain/usualStart.ts'
import { api, keys } from './client.ts'

/** One match of the place search; `lat` and `lng` are already rounded to 0.01 degrees. */
export interface PlaceMatch {
  name: string
  region: string | null
  country: string | null
  lat: number
  lng: number
}

/**
 * Searches a town or postcode. A mutation, not a query: each search is an outside request, so it
 * runs only when the runner submits, is never repeated by a refetch and is never cached.
 */
export function usePlaceSearch() {
  return useMutation({
    mutationFn: (query: string) =>
      api<{ places: PlaceMatch[] }>('POST', '/places/search', { query }).then((r) => r.places),
  })
}

/**
 * The most common start cell of the runner's runs. On demand: nothing is read until the caller
 * runs `refetch()` (the runner pressed "Use where my runs start"), and each press reads again, so a
 * run imported since shows.
 */
export function useUsualStart() {
  return useQuery({
    queryKey: [keys.usualStart],
    queryFn: () => api<{ start: UsualStart | null }>('GET', '/places/usual-start'),
    enabled: false,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

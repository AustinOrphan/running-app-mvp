import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether a CSS media query matches now, and again whenever that changes (a rotated phone, a
 * resized window). The first render already has the answer, so a page never paints one layout and
 * then another. Without `matchMedia` the query does not match.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => {
        list.removeEventListener('change', notify)
      }
    },
    [query],
  )
  const getSnapshot = useCallback(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    [query],
  )
  return useSyncExternalStore(subscribe, getSnapshot)
}

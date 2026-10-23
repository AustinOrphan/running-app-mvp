import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** `navigator.onLine` is false only when the browser knows there is no network. */
const isOnline = (): boolean => navigator.onLine !== false

/**
 * Whether the browser says it is online. A page that would otherwise show something it cannot
 * check (a status the server reports, not the page) hides it while this is false.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true)
}

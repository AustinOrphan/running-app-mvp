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
 * Whether the browser believes it has a connection. A true answer can still be a dead connection
 * (a captive portal, one bar of signal), so a request that fails is handled as offline too; this
 * only decides what to say before the request is made, and a page that would otherwise show a
 * status it cannot check (one the server reports, not the page) hides it while this is false.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true)
}

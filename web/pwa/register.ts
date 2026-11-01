// The page's side of the offline shell (phase 3a design 7.6, ADR 0012): registering the service
// worker in a production build, saying whether offline use is ready, emptying the device's copy of
// the server's answers, and reloading once when an update has replaced a file the page still wants.
// The worker itself is `web/sw/sw.js`.
import { useSyncExternalStore } from 'react'

/**
 * The cache that holds the server's answers (Today, settings, ...). Health data: emptied on
 * sign-out and on any 401, here and in the worker. The same name is written in `web/sw/sw.js`, and
 * `tests/unit/shared/pwaAssets.test.ts` checks the two agree.
 */
export const API_CACHE_NAME = 'rl-api-v1'
/** The worker's small bookkeeping cache (the time of its last warm). Emptied with the answers. */
export const META_CACHE_NAME = 'rl-meta'

/**
 * Whether the app can open with no connection: the worker is active, or still installing, or it is
 * not possible and the reason is named, so Settings can say what to change. `development`: the
 * build is not a production build. `no-https`: the page is not on https or localhost, where a
 * browser runs no worker. `unsupported`: a secure page in a browser with no service workers.
 * `refused`: the browser has them and did not let this one register.
 */
export type OfflineStatus =
  'ready' | 'installing' | 'development' | 'no-https' | 'unsupported' | 'refused'

let status: OfflineStatus = 'development'
const listeners = new Set<() => void>()

function setStatus(next: OfflineStatus): void {
  if (next === status) return
  status = next
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Whether offline use is ready, for the Settings row. */
export function useOfflineStatus(): OfflineStatus {
  return useSyncExternalStore(subscribe, () => status)
}

/** Back to the state before any registration, so one test's status does not reach the next. */
export function resetOfflineStatusForTests(): void {
  status = 'development'
}

/**
 * Registers the worker. Only a production build does: the development server serves modules the
 * worker would hold on to. A browser without `navigator.serviceWorker` (a page that is not on
 * https or localhost, an old browser) and a registration that is refused (a blocked worker) leave
 * the app working as it did before; the status says which of them it was.
 *
 * Registration waits for the page's `load` so it does not compete with the first paint. Once the
 * worker is active the page asks it to warm its cache (the worker throttles that itself), because
 * the requests of a first visit went out before the worker took the page over; and a return to the
 * foreground asks the browser to check for a new worker, for a window that stays open for days.
 */
export function registerServiceWorker(options: { production?: boolean } = {}): void {
  const { production = import.meta.env.PROD } = options
  if (!production) {
    setStatus('development')
    return
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    // A page that is not on https or localhost has no `navigator.serviceWorker`; so does an old
    // browser. `isSecureContext` tells the two apart.
    setStatus(
      typeof window !== 'undefined' && window.isSecureContext === false
        ? 'no-https'
        : 'unsupported',
    )
    return
  }
  setStatus('installing')
  const container = navigator.serviceWorker
  const start = () => {
    container
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(() => container.ready)
      .then((ready) => {
        ready.active?.postMessage({ type: 'rl:warm' })
        setStatus('ready')
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void ready.update().catch(() => {})
        })
      })
      .catch(() => {
        setStatus('refused')
      })
  }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

/**
 * Empties the device's copy of the server's answers. The worker's own 401 rule covers a session
 * that ended on the server; this covers one the runner ended, and a sign-in, so nothing of an
 * earlier session is served to the next. Cache Storage is missing outside https and localhost,
 * where there is nothing to empty.
 *
 * Only `purgeDeviceData` in `outbox.ts` calls this, together with the drafts and the outbox: a page
 * that needs the device emptied calls that one, so there is a single purge to extend
 * (`tests/web/deviceData.test.tsx` checks that no other module imports this).
 */
export async function purgeApiCache(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    await caches.delete(API_CACHE_NAME)
    await caches.delete(META_CACHE_NAME)
  } catch {
    // Storage that cannot be reached keeps no copy for the next session to find.
  }
}

const RELOAD_KEY = 'rl_preload_reload'
/** A second preload error within this time of a reload is left alone: reloading again would loop. */
const RELOAD_GUARD_MS = 60_000

/** True once per `RELOAD_GUARD_MS`; false when the tab's storage cannot keep the record. */
function mayReload(now: number): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY))
    if (last > 0 && now - last < RELOAD_GUARD_MS) return false
    window.sessionStorage.setItem(RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}

/**
 * An update replaced a file that the open page still asks for (a lazy chunk named by the old
 * build): Vite reports it as `vite:preloadError`, and the page reloads once to pick up the new
 * build. The record is the tab's own, so a second failure right after the reload shows the error
 * (a sheet says it did not open) instead of looping. The worker keeps two builds so this is rare.
 *
 * While the browser says it is offline the error is left alone and the record is not touched: a
 * file that failed because the connection is gone says nothing about the build, a reload could not
 * fetch a newer one, and it would drop what the page holds (an open sheet) and spend the minute's
 * reload for the next error that follows a real update. The lazy import then fails to its own
 * notice (`lazySheets.tsx`). Returns the way to stop listening.
 */
export function reloadOnPreloadError(
  reload: () => void = () => window.location.reload(),
): () => void {
  const onError = (event: Event) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    if (!mayReload(Date.now())) return
    event.preventDefault()
    reload()
  }
  window.addEventListener('vite:preloadError', onError)
  return () => {
    window.removeEventListener('vite:preloadError', onError)
  }
}

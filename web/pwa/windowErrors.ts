// Reports the errors that no React boundary sees (E1, FB1): an event handler, a timer, async code
// and a rejected promise reach `window` as `error` and `unhandledrejection`. They go through the
// boundary's `reportClientError`, so the cap of five per page load, the five-second dedupe and the
// six fields are the same.
import { reportClientError } from './clientErrors.ts'

/** The URL schemes of browser extensions: their scripts are not the app's. */
const EXTENSION_URL = /(?:chrome|moz|safari-web|safari)-extension:\/\//

/** Failed chunk loads: the chunk boundary shows them, and `reloadOnPreloadError` reloads on one. */
const DYNAMIC_IMPORT_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i

/** Chrome's and Firefox's notice about a layout loop: noise, not a fault of the app. */
const RESIZE_OBSERVER = /^ResizeObserver loop/

/** A string field of `value`, or '' when it is missing or reading it throws (a getter can). */
function fieldOf(value: unknown, field: 'name' | 'message' | 'stack'): string {
  try {
    if (typeof value === 'string') return field === 'message' ? value : ''
    if (typeof value !== 'object' || value === null) return ''
    const read = (value as Record<string, unknown>)[field]
    return typeof read === 'string' ? read : ''
  } catch {
    return ''
  }
}

/** Whether `error` is a failed chunk load (the `ChunkLoadError` the app throws, or the browser's own). */
function isChunkFailure(error: unknown): boolean {
  return (
    fieldOf(error, 'name') === 'ChunkLoadError' ||
    DYNAMIC_IMPORT_FAILURE.test(fieldOf(error, 'message'))
  )
}

/** Reports what a window `error` event carries, unless it is not the app's or is already answered for. */
export function onWindowError(event: ErrorEvent): void {
  const { message, filename } = event
  const error: unknown = event.error
  const hasError = error !== undefined && error !== null
  // A cross-origin script gives "Script error." and nothing else: there is nothing to act on.
  if (!hasError && (message === '' || /^Script error\.?$/.test(message))) return
  if (!hasError && RESIZE_OBSERVER.test(message)) return
  if (EXTENSION_URL.test(filename) || EXTENSION_URL.test(fieldOf(error, 'stack'))) return
  if (isChunkFailure(hasError ? error : message)) return
  reportClientError(hasError ? error : message, null)
}

/** Reports a promise rejection that nothing handled. A reason that is not an `Error` is coerced by the report. */
export function onUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason: unknown = event.reason
  if (EXTENSION_URL.test(fieldOf(reason, 'stack'))) return
  if (isChunkFailure(reason)) return
  reportClientError(reason, null)
}

let installed: (() => void) | null = null

/**
 * Starts the two listeners, once; a second call changes nothing. Returns the function that removes
 * them (tests). The app calls it at start in a production build only.
 */
export function installWindowErrorReporting(): () => void {
  if (installed !== null) return installed
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  const remove = () => {
    window.removeEventListener('error', onWindowError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    installed = null
  }
  installed = remove
  return remove
}

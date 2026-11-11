// Reports an error that an error boundary caught to the server (E1), so a blank screen leaves a
// trace in the server's log. Sent with `fetch` keepalive, once per error, never retried and never
// through the outbox: offline, or when the request fails, the report is dropped.

/** Reports per page load: a screen that fails in a loop does not send an endless stream. */
const MAX_REPORTS = 5
const reported = new WeakSet<object>()
let sent = 0

/** The build id the service worker uses, read from the name of its shell cache. */
async function buildId(): Promise<string> {
  try {
    const prefix = 'rl-shell-'
    const name = (await caches.keys()).find((key) => key.startsWith(prefix))
    return name === undefined ? 'unknown' : name.slice(prefix.length)
  } catch {
    return 'unknown'
  }
}

/** Back to a page that has reported nothing, for tests. */
export function resetClientErrorReportsForTests(): void {
  sent = 0
}

export function reportClientError(error: unknown, componentStack: string | null | undefined): void {
  if (typeof error === 'object' && error !== null) {
    if (reported.has(error)) return
    reported.add(error)
  }
  if (sent >= MAX_REPORTS) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  sent += 1
  const path = window.location.pathname
  void (async () => {
    const body = {
      message: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      stack: (error instanceof Error ? (error.stack ?? '') : '').slice(0, 6000),
      componentStack: (componentStack ?? '').slice(0, 4000),
      path: path.slice(0, 300),
      buildId: (await buildId()).slice(0, 64),
      userAgent: navigator.userAgent.slice(0, 300),
    }
    try {
      await fetch('/api/client-errors', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      // Dropped: the console has the error too.
    }
  })()
}

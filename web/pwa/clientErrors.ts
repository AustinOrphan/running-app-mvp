// Reports an error that an error boundary caught to the server (E1), so a blank screen leaves a
// trace in the server's log. Sent with `fetch` keepalive, once per error, never retried and never
// through the outbox: offline, or when the request fails, the report is dropped.
import { BUILD_ID } from './buildId.ts'

/** Reports per page load: a screen that fails in a loop does not send an endless stream. */
const MAX_REPORTS = 5
/** Under the server's 16 KB parser, which counts bytes. */
const MAX_BODY_BYTES = 15 * 1024
const reported = new WeakSet<object>()
let sent = 0
const encoder = new TextEncoder()

/** Back to a page that has reported nothing, for tests. */
export function resetClientErrorReportsForTests(): void {
  sent = 0
}

/** The text of `read()`, or `fallback` when it is not a string or reading it throws (a getter can). */
function textOf(read: () => unknown, fallback: string): string {
  try {
    const value = read()
    if (typeof value === 'string') return value
    if (value === undefined || value === null) return fallback
    // An object may have no string form: the catch below answers for that.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(value)
  } catch {
    return fallback
  }
}

function fieldsOf(error: unknown, componentStack: string | null | undefined) {
  const record = (): Record<string, unknown> =>
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
  const message = textOf(() => (error instanceof Error ? error.message : error), '')
  return {
    message: (message === '' ? 'Unknown error' : message).slice(0, 2000),
    stack: textOf(() => record()['stack'], '').slice(0, 6000),
    componentStack: textOf(() => componentStack, '').slice(0, 4000),
    path: window.location.pathname.slice(0, 300),
    buildId: BUILD_ID.slice(0, 64),
    userAgent: navigator.userAgent.slice(0, 300),
  }
}

/**
 * The JSON body, under `MAX_BODY_BYTES` bytes: the stack and the component stack are cut first (by
 * halves, at a character boundary), then the message, so multi-byte text never costs the report.
 */
export function clientErrorBody(error: unknown, componentStack: string | null | undefined): string {
  const fields = fieldsOf(error, componentStack)
  let body = JSON.stringify(fields)
  for (const key of ['stack', 'componentStack', 'message'] as const) {
    while (encoder.encode(body).length > MAX_BODY_BYTES && fields[key] !== '') {
      fields[key] = fields[key].slice(0, Math.floor(fields[key].length / 2))
      body = JSON.stringify(fields)
    }
  }
  return body
}

export function reportClientError(error: unknown, componentStack: string | null | undefined): void {
  if (typeof error === 'object' && error !== null) {
    if (reported.has(error)) return
    reported.add(error)
  }
  if (sent >= MAX_REPORTS) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  sent += 1
  void (async () => {
    try {
      await fetch('/api/client-errors', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: clientErrorBody(error, componentStack),
      })
    } catch {
      // Dropped: the console has the error too.
    }
  })()
}

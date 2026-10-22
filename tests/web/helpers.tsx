import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

export interface MockRequest {
  body: unknown
  query: URLSearchParams
}
export type MockResponse = unknown
export type MockRoutes = Record<string, (req: MockRequest) => MockResponse>

/** Calls that matched no route since the last check; tests/web/setup.ts fails the test on any. */
export const unmatchedCalls: string[] = []

function isStatusResponse(value: unknown): value is { status: number; body: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'number' &&
    'body' in value
  )
}

/**
 * Replaces `fetch` with a stub. Route keys look like `'GET /api/plan'` (no query string). A
 * handler returns the JSON body (200), or `{ status, body }` for another status; a `body` of
 * `undefined` sends an empty response. A call with no matching route fails the test.
 */
export function mockApi(routes: MockRoutes): {
  calls: Array<{ method: string; url: string; body: unknown }>
} {
  const calls: Array<{ method: string; url: string; body: unknown }> = []

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const rawBody = typeof init?.body === 'string' ? init.body : undefined
    const body: unknown = rawBody === undefined ? undefined : JSON.parse(rawBody)
    calls.push({ method, url: `${url.pathname}${url.search}`, body })

    const handler = routes[`${method} ${url.pathname}`]
    if (!handler) {
      unmatchedCalls.push(`${method} ${url.pathname}`)
      return Promise.reject(new Error(`Unmocked request: ${method} ${url.pathname}`))
    }

    const result = handler({ body, query: url.searchParams })
    const status = isStatusResponse(result) ? result.status : 200
    const payload = isStatusResponse(result) ? result.body : result
    return Promise.resolve(
      new Response(payload === undefined ? null : JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  return { calls }
}

export function renderWithProviders(ui: ReactElement, opts: { route?: string } = {}): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[opts.route ?? '/']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

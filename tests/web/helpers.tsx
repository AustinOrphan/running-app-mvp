import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { lintText } from '../../shared/copy/lint.ts'

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

/** Attributes whose text a reader or a screen reader gets, so the lint covers them too. */
const COPY_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt']
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE'])

interface CopyItem {
  where: string
  text: string
}

function collectCopy(node: Node, found: CopyItem[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim() ?? ''
    if (text !== '') found.push({ where: 'text', text })
    return
  }
  if (!(node instanceof Element) || SKIPPED_TAGS.has(node.tagName)) return
  for (const name of COPY_ATTRIBUTES) {
    const text = node.getAttribute(name)?.trim() ?? ''
    if (text !== '') found.push({ where: `<${node.tagName.toLowerCase()} ${name}>`, text })
  }
  for (const child of node.childNodes) collectCopy(child, found)
}

/**
 * Fails when any copy under `container` breaks the G5 lint (`shared/copy/lint.ts`): every text node
 * and the accessible-name attributes. A sheet renders in a portal on `document.body`, so pass the
 * dialog (or `document.body`), not only the `container` of `render`. Text a provider returned is
 * outside the lint; render a fixture without it.
 */
export function expectCleanCopy(container: Element): void {
  const found: CopyItem[] = []
  collectCopy(container, found)
  const problems = found.flatMap(({ where, text }) =>
    lintText(text).map((hit) => `${where}: "${hit.match}" in ${JSON.stringify(text)}`),
  )
  if (problems.length > 0) {
    throw new Error(`Copy breaks the G5 lint:\n${problems.join('\n')}`)
  }
}

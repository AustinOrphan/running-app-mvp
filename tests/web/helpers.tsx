import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { lintText } from '../../shared/copy/lint.ts'
import type { ActivityListItem, ActivityListPage } from '../../shared/types.ts'

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

/** A list row as the server sends it: the stored activity without its heart-rate histogram. */
function listItem(item: ActivityListItem): ActivityListItem {
  const row: Record<string, unknown> = { ...item }
  delete row['hrHistogram']
  return row as unknown as ActivityListItem
}

/**
 * The body of `GET /api/activities` for `items`: by default one page that holds them all. `total`
 * and `nextOffset` say more rows wait on the server.
 */
export function activityPage(
  items: ActivityListItem[],
  over: Partial<Omit<ActivityListPage, 'items'>> = {},
): ActivityListPage {
  const offset = over.offset ?? 0
  return {
    items: items.map(listItem),
    total: over.total ?? offset + items.length,
    limit: over.limit ?? 100,
    offset,
    nextOffset: over.nextOffset ?? null,
  }
}

/**
 * A `GET /api/activities` handler that serves `all` page by page, as the server does: the request's
 * `limit` and `offset` choose the slice, `total` is the whole list and `nextOffset` points past it.
 */
export function activityRoute(all: ActivityListItem[]): (req: MockRequest) => ActivityListPage {
  return ({ query }) => {
    const limit = Number(query.get('limit') ?? 100)
    const offset = Number(query.get('offset') ?? 0)
    const items = all.slice(offset, offset + limit)
    const next = offset + items.length
    return activityPage(items, {
      total: all.length,
      limit,
      offset,
      nextOffset: items.length > 0 && next < all.length ? next : null,
    })
  }
}

/**
 * The `explain` a mocked `WhyDrawer` was opened with. The page tests stand a small element in for
 * the drawer and put `JSON.stringify(explain ?? null)` in `data-explain`; a call site that passes
 * no subject reads `null`.
 */
export function explainOf(drawer: HTMLElement): unknown {
  return JSON.parse(drawer.getAttribute('data-explain') ?? 'null')
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

/** Elements whose text reads as part of the sentence around them; any other element ends a run. */
const INLINE_TAGS = new Set([
  'A',
  'ABBR',
  'B',
  'BDI',
  'BDO',
  'CITE',
  'CODE',
  'DFN',
  'EM',
  'I',
  'KBD',
  'MARK',
  'Q',
  'S',
  'SAMP',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'U',
  'VAR',
])

interface InlineRun {
  /** The nearest block-level element around the run. */
  owner: Element
  /** The text nodes that read as one sentence, in order; at least two, so markup splits them. */
  nodes: Text[]
}

/** Runs of text nodes that inline markup splits, such as `You <b>should</b> have gone`. */
function inlineRuns(root: Element): InlineRun[] {
  const runs: InlineRun[] = []
  let owner = root
  let nodes: Text[] = []
  const flush = (): void => {
    if (nodes.length > 1) runs.push({ owner, nodes })
    nodes = []
  }
  const visit = (element: Element): void => {
    const inline = INLINE_TAGS.has(element.tagName)
    const outer = owner
    if (!inline) {
      flush()
      owner = element
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) nodes.push(child as Text)
      else if (child instanceof Element && !SKIPPED_TAGS.has(child.tagName)) visit(child)
    }
    if (!inline) {
      flush()
      owner = outer
    }
  }
  visit(root)
  flush()
  return runs
}

/**
 * Banned phrases that a run's markup splits across text nodes, which the per-node check cannot see.
 * The run's text has whitespace collapsed; a hit counts only when it crosses a node boundary, so a
 * hit inside one node is reported once, by the per-node check.
 */
function splitPhraseProblems(container: Element): string[] {
  return inlineRuns(container).flatMap(({ owner, nodes }) => {
    let text = ''
    const boundaries: number[] = []
    for (const node of nodes) {
      const piece = (node.textContent ?? '').replace(/\s+/g, ' ')
      text += text.endsWith(' ') && piece.startsWith(' ') ? piece.slice(1) : piece
      boundaries.push(text.length)
    }
    return lintText(text)
      .filter((hit) => boundaries.some((at) => hit.index < at && at < hit.index + hit.match.length))
      .map(
        (hit) =>
          `<${owner.tagName.toLowerCase()}>: "${hit.match}" in ${JSON.stringify(text.trim())}, split by markup`,
      )
  })
}

/**
 * Fails when any copy under `container` breaks the G5 lint (`shared/copy/lint.ts`): every text node,
 * the text of each block with its inline markup joined (so `You <b>should</b> have gone` fails on
 * "should have"), and the accessible-name attributes. A sheet renders in a portal on
 * `document.body`, so pass the dialog (or `document.body`), not only the `container` of `render`.
 * Text a provider returned is outside the lint; render a fixture without it.
 */
export function expectCleanCopy(container: Element): void {
  const found: CopyItem[] = []
  collectCopy(container, found)
  const problems = [
    ...found.flatMap(({ where, text }) =>
      lintText(text).map((hit) => `${where}: "${hit.match}" in ${JSON.stringify(text)}`),
    ),
    ...splitPhraseProblems(container),
  ]
  if (problems.length > 0) {
    throw new Error(`Copy breaks the G5 lint:\n${problems.join('\n')}`)
  }
}

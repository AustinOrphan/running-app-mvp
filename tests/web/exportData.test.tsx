import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { SettingsPage } from '../../web/pages/SettingsPage.tsx'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

const user = { id: 'u1', email: 'runner@example.com', displayName: null, units: 'mi' as const }

function Pages() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </ToastProvider>
  )
}

function refusal(status: number, code: string, details?: unknown) {
  return { status, body: { error: { code, message: 'Refused.', details } } }
}

function routes(token: () => unknown) {
  return {
    'GET /api/settings': () => user,
    'GET /api/auth/me': () => user,
    'POST /api/export/token': token,
  }
}

describe('Settings: download all your data', () => {
  const clicked: Array<{ href: string; download: string }> = []
  beforeEach(() => {
    clicked.length = 0
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download })
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('says what is included and what is not, and passes the G5 lint', async () => {
    mockApi(routes(() => ({ token: 't', expiresInSec: 60 })))
    const { container } = renderWithProviders(<Pages />, { route: '/settings' })
    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.getByRole('button', { name: 'Download all your data' })).toBeEnabled()
    expect(screen.getByText(/every activity and its stream/)).toBeInTheDocument()
    expect(screen.getByText(/leaves out your password and the keys and tokens/)).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('asks for a token, then follows a link so the browser streams the file', async () => {
    const { calls } = mockApi(routes(() => ({ token: 'abc/123+x', expiresInSec: 60 })))
    const { container } = renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await typist.click(screen.getByRole('button', { name: 'Download all your data' }))
    expect(await screen.findByText(/Your download has started/)).toBeInTheDocument()
    expect(clicked).toEqual([{ href: '/api/export?token=abc%2F123%2Bx', download: '' }])
    // The page itself never fetches the archive: only the token step goes through the API client.
    expect(calls.filter((call) => call.url.startsWith('/api/export'))).toEqual([
      { method: 'POST', url: '/api/export/token', body: undefined },
    ])
    expectCleanCopy(container)
  })

  test('shows a busy state while the token is requested, and ignores a second press', async () => {
    let finish: (value: unknown) => void = () => {}
    const { calls } = mockApi(routes(() => ({})))
    // mockApi answers at once; hold the token step open instead.
    const answer = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
      if (url.pathname === '/api/export/token') {
        calls.push({ method: 'POST', url: url.pathname, body: undefined })
        return new Promise<Response>((resolve) => {
          finish = () => {
            resolve(
              new Response(JSON.stringify({ token: 't', expiresInSec: 60 }), {
                headers: { 'Content-Type': 'application/json' },
              }),
            )
          }
        })
      }
      return answer(input, init)
    })
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    const button = screen.getByRole('button', { name: 'Download all your data' })
    await typist.click(button)
    expect(await screen.findByText('Getting the download ready.')).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await typist.click(button)
    expect(calls.filter((call) => call.url === '/api/export/token')).toHaveLength(1)

    finish(undefined)
    expect(await screen.findByText(/Your download has started/)).toBeInTheDocument()
    expect(button).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText('Getting the download ready.')).toBeNull()
  })

  test('an export already running says so, and a later try works', async () => {
    let attempt = 0
    mockApi(
      routes(() =>
        ++attempt === 1
          ? refusal(429, 'conflict', { code: 'export-running' })
          : { token: 't', expiresInSec: 60 },
      ),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await typist.click(screen.getByRole('button', { name: 'Download all your data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An export is already running. Wait for it to finish, then try again.',
    )
    expect(clicked).toEqual([])
    await typist.click(screen.getByRole('button', { name: 'Download all your data' }))
    expect(await screen.findByText(/Your download has started/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('any other 429 gets the general line, not "already running"', async () => {
    mockApi(routes(() => refusal(429, 'internal', { retryAfterSec: 30 })))
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await typist.click(screen.getByRole('button', { name: 'Download all your data' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Too many requests just now. Try again in a few minutes.')
    expect(alert).not.toHaveTextContent('already running')
  })

  test('a history too large for one ZIP is named', async () => {
    mockApi(routes(() => refusal(413, 'validation', { code: 'export-too-many-files' })))
    const { container } = renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await typist.click(screen.getByRole('button', { name: 'Download all your data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'more files than one archive can hold',
    )
    expectCleanCopy(container)
  })

  test('a server error is a plain line', async () => {
    mockApi(routes(() => refusal(500, 'internal')))
    const { container } = renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await typist.click(screen.getByRole('button', { name: 'Download all your data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The download could not be started. Try again; nothing was changed.',
    )
    expect(clicked).toEqual([])
    expectCleanCopy(container)
  })
})

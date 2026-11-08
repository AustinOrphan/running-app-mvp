import { screen, waitFor } from '@testing-library/react'
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

/** The settings routes of `mockApi`, plus an answer for `/api/export` chosen by the test. */
function withExport(answer: () => Promise<Response>) {
  const { calls } = mockApi({
    'GET /api/settings': () => user,
    'GET /api/auth/me': () => user,
  })
  const others = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    if (url.pathname === '/api/export') {
      calls.push({ method: 'GET', url: url.pathname, body: undefined })
      return answer()
    }
    return others(input, init)
  })
  return { calls }
}

function zipResponse(): Response {
  return new Response(new Uint8Array([0x50, 0x4b, 0x05, 0x06]), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="running-log-export-2026-11-08.zip"',
    },
  })
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Settings: download all your data', () => {
  const downloads: Array<{ name: string; href: string }> = []
  beforeEach(() => {
    downloads.length = 0
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }),
    )
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ name: this.download, href: this.href })
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('says what is included and what is not, and passes the G5 lint', async () => {
    withExport(() => Promise.resolve(zipResponse()))
    const { container } = renderWithProviders(<Pages />, { route: '/settings' })
    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.getByRole('button', { name: 'Download all your data' })).toBeEnabled()
    expect(screen.getByText(/every activity and its stream/)).toBeInTheDocument()
    expect(screen.getByText(/leaves out your password and the keys and tokens/)).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('shows a busy state while the archive is made, then saves it under the server name', async () => {
    let finish: (response: Response) => void = () => {}
    const { calls } = withExport(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    const button = screen.getByRole('button', { name: 'Download all your data' })
    await typist.click(button)
    expect(await screen.findByText(/Preparing the archive/)).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-busy', 'true')
    // A second press while it runs sends nothing.
    await typist.click(button)
    expect(calls.filter((call) => call.url === '/api/export')).toHaveLength(1)

    finish(zipResponse())
    expect(await screen.findByText('Archive downloaded.')).toBeInTheDocument()
    expect(downloads).toEqual([{ name: 'running-log-export-2026-11-08.zip', href: 'blob:test' }])
    expect(button).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText(/Preparing the archive/)).toBeNull()
  })

  test('a server error is a plain line and a second try works', async () => {
    let attempt = 0
    withExport(() =>
      Promise.resolve(
        ++attempt === 1 ? errorResponse(500, 'internal', 'Something went wrong.') : zipResponse(),
      ),
    )
    const { container } = renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await typist.click(screen.getByRole('button', { name: 'Download all your data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The archive could not be made. Try again; nothing was changed.',
    )
    expect(downloads).toEqual([])
    expectCleanCopy(container)

    await typist.click(screen.getByRole('button', { name: 'Download all your data' }))
    await waitFor(() => {
      expect(downloads).toHaveLength(1)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('an export already running says so', async () => {
    withExport(() =>
      Promise.resolve(errorResponse(429, 'conflict', 'An export is already running.')),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await typist.click(screen.getByRole('button', { name: 'Download all your data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An export is already running. Wait for it to finish, then try again.',
    )
  })

  test('a network error is the same plain line', async () => {
    withExport(() => Promise.reject(new TypeError('network down')))
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await typist.click(screen.getByRole('button', { name: 'Download all your data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The archive could not be made.')
  })
})

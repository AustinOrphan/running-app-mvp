import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { App } from '../../web/App.tsx'
import { ChunkLoadError } from '../../web/components/ChunkBoundary.tsx'
import { resetClientErrorReportsForTests } from '../../web/pwa/clientErrors.ts'
import { activityPage, mockApi, renderWithProviders } from './helpers.tsx'

// E1: a render-time throw in a routed page or a lazy sheet is answered by a boundary, not by a
// blank page. The pages are stood in for so that one throws while it draws.

vi.mock('../../web/pages/PlanPage.tsx', () => ({
  PlanPage: () => {
    throw new Error('Plan page exploded')
  },
}))
vi.mock('../../web/pages/ReviewPage.tsx', async () => {
  const { DoneSheet } = await import('../../web/components/lazySheets.tsx')
  const { createElement: h } = await import('react')
  return {
    ReviewPage: () =>
      h(DoneSheet, {
        plan: { kind: 'easy', durationMin: 40, distanceM: 6000 },
        sessionId: 's1',
        date: '2026-03-18',
        units: 'km',
        onClose: () => {},
        onSaved: () => {},
      }),
  }
})
vi.mock('../../web/components/today/DoneSheet.tsx', () => ({
  DoneSheet: () => {
    throw new Error('Done sheet exploded')
  },
}))
vi.mock('../../web/pages/BriefPage.tsx', () => ({
  BriefPage: () => {
    throw new ChunkLoadError(new Error('stand-in'))
  },
}))

const signedIn = {
  'GET /api/setup': () => ({ needsSetup: false }),
  'GET /api/auth/me': () => ({
    id: 'u1',
    email: 'runner@example.com',
    displayName: null,
    units: 'km',
  }),
  'GET /api/activities': () => activityPage([]),
  'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
  'POST /api/client-errors': () => ({ status: 204, body: undefined }),
}

function reportsOf(calls: Array<{ method: string; url: string; body: unknown }>) {
  return calls.filter((call) => call.method === 'POST' && call.url === '/api/client-errors')
}

beforeEach(() => {
  resetClientErrorReportsForTests()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('the error boundaries', () => {
  test('a page that throws shows the recoverable screen, keeps the tabs and reports once', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/plan?week=3')
    const { calls } = mockApi(signedIn)
    renderWithProviders(<App />, { route: '/plan' })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This screen hit a problem.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()

    // The navigation beside the page still works, and the next page replaces the screen.
    const primary = screen.getByRole('navigation', { name: 'Primary' })
    await user.click(within(primary).getByRole('link', { name: 'Log' }))
    await waitFor(() => {
      expect(screen.queryByText('This screen hit a problem.')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(reportsOf(calls)).toHaveLength(1)
    })
    const report = reportsOf(calls)[0]?.body as Record<string, string>
    expect(report['message']).toBe('Plan page exploded')
    expect(report['path']).toBe('/plan')
    expect(report['componentStack']).toContain('PageBoundary')
    expect(report['userAgent']).toBeTruthy()
    expect(report['buildId']).toBe('unknown')

    // The console has the error and its component stack.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Render error'),
      expect.objectContaining({ message: 'Plan page exploded' }),
      expect.stringContaining('PageBoundary'),
    )
  })

  test('a lazy sheet that throws closes into the page boundary', async () => {
    window.history.replaceState(null, '', '/review')
    const { calls } = mockApi(signedIn)
    renderWithProviders(<App />, { route: '/review' })

    expect(await screen.findByRole('alert')).toHaveTextContent('This screen hit a problem.')
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    await waitFor(() => {
      expect(reportsOf(calls)).toHaveLength(1)
    })
    expect((reportsOf(calls)[0]?.body as Record<string, string>)['message']).toBe(
      'Done sheet exploded',
    )
  })

  test('a failed chunk load keeps its own state and sends no report', async () => {
    const { calls } = mockApi(signedIn)
    renderWithProviders(<App />, { route: '/brief' })
    // The chunk boundary answers for its own error: the failed-load state, and nothing reported.
    expect(await screen.findByRole('alert')).toHaveTextContent('This page did not load.')
    expect(screen.queryByText('This screen hit a problem.')).not.toBeInTheDocument()
    expect(reportsOf(calls)).toHaveLength(0)
  })

  test('nothing is sent while the browser is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.history.replaceState(null, '', '/plan')
    const { calls } = mockApi(signedIn)
    renderWithProviders(<App />, { route: '/plan' })
    expect(await screen.findByRole('alert')).toHaveTextContent('This screen hit a problem.')
    expect(reportsOf(calls)).toHaveLength(0)
  })
})

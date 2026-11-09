import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import type { ActivityListItem } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { useActivityGlyphs } from '../../web/api/activities.ts'
import { useUpdateSettings } from '../../web/api/settings.ts'
import { ActivitiesPage } from '../../web/pages/ActivitiesPage.tsx'
import { makeActivity } from '../factories.ts'
import { activityRoute, mockApi, renderWithProviders } from './helpers.tsx'

afterEach(cleanup)

const GLYPH = { d: 'M10 90L50 10L90 90' }

function render(activities: ActivityListItem[], glyphs: Record<string, { d: string }>) {
  const api = mockApi({
    'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'mi' }),
    'GET /api/activities': activityRoute(activities),
    'GET /api/activities/glyphs': ({ query }) => ({
      glyphs: Object.fromEntries(
        (query.get('ids') ?? '')
          .split(',')
          .filter((id) => id in glyphs)
          .map((id) => [id, glyphs[id]]),
      ),
    }),
  })
  renderWithProviders(
    <ToastProvider>
      <ActivitiesPage />
    </ToastProvider>,
    { route: '/activities' },
  )
  return api
}

const glyphCalls = (api: ReturnType<typeof mockApi>) =>
  api.calls.filter((c) => c.url.startsWith('/api/activities/glyphs'))

describe('route glyphs in the Log', () => {
  test('a run with a track shows a decorative drawing in its row; a run without shows nothing', async () => {
    const withTrack = makeActivity({ id: 'with-track', date: '2026-03-02' })
    const without = makeActivity({ id: 'without-track', date: '2026-03-01' })
    render([withTrack, without], { 'with-track': GLYPH })

    const links = await screen.findAllByRole('link', { name: /^Run/ })
    expect(links).toHaveLength(2)
    await waitFor(() => {
      expect(links[0]!.querySelector('svg')).not.toBeNull()
    })
    const svg = links[0]!.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg.querySelector('path')).toHaveAttribute('d', GLYPH.d)
    expect(links[1]!.querySelector('svg')).toBeNull()
    // The drawing adds nothing to what a screen reader hears.
    expect(within(links[0]!).queryByRole('img')).toBeNull()
  })

  test('one glyph read per page of the list; strength and treadmill rows are not asked for', async () => {
    const user = userEvent.setup()
    const runs = Array.from({ length: 58 }, (_, i) =>
      makeActivity({ id: `r${String(i).padStart(2, '0')}`, date: addDays('2026-03-01', -i) }),
    )
    const lift = makeActivity({ id: 'lift', type: 'strength', date: '2026-03-02' })
    const belt = makeActivity({ id: 'belt', subtype: 'treadmill', date: '2026-03-02' })
    const api = render([lift, belt, ...runs], {})
    await screen.findByText('Showing 50 of 60 activities')
    await waitFor(() => {
      expect(glyphCalls(api)).toHaveLength(1)
    })
    const ids = decodeURIComponent(glyphCalls(api)[0]!.url.split('ids=')[1]!).split(',')
    expect(ids).toHaveLength(48)
    expect(ids).not.toContain('lift')
    expect(ids).not.toContain('belt')

    await user.click(screen.getByRole('button', { name: /^Show \d+ more$/ }))
    await screen.findByText('60 activities')
    await waitFor(() => {
      expect(glyphCalls(api)).toHaveLength(2)
    })
    // The second read carries exactly the runs of the new page, none of the first page's.
    const second = decodeURIComponent(glyphCalls(api)[1]!.url.split('ids=')[1]!).split(',')
    expect(second).toEqual(runs.slice(48).map((run) => run.id))
    expect(second.filter((id) => ids.includes(id))).toEqual([])
  })
})

function GlyphProbe() {
  const glyphs = useActivityGlyphs([{ id: 'g1', type: 'run', subtype: null }])
  const save = useUpdateSettings()
  return (
    <div>
      <p data-testid="glyph">{glyphs.get('g1')?.d ?? 'none'}</p>
      <button
        onClick={() => {
          save.mutate({ hideMapEnds: true })
        }}
      >
        Hide ends
      </button>
    </div>
  )
}

describe('route glyphs and the hide-ends setting', () => {
  test('saving it drops every drawn glyph at once, so none built with the old setting stays painted', async () => {
    const user = userEvent.setup()
    let hidden = false
    mockApi({
      'GET /api/activities/glyphs': () => ({
        glyphs: { g1: { d: hidden ? 'M1 1L2 2' : 'M0 0L9 9' } },
      }),
      'PUT /api/settings': () => {
        hidden = true
        return { email: 'runner@example.com', displayName: null, units: 'mi', hideMapEnds: true }
      },
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'mi' }),
      'GET /api/auth/me': () => ({ email: 'runner@example.com' }),
    })
    // Glyph reads after the first wait for the gate, so the moment between the save and the new
    // answer can be looked at.
    const inner = globalThis.fetch
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    let glyphReads = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes('/api/activities/glyphs') && ++glyphReads > 1) await gate
      return inner(input, init)
    })
    renderWithProviders(<GlyphProbe />)
    await waitFor(() => {
      expect(screen.getByTestId('glyph')).toHaveTextContent('M0 0L9 9')
    })
    await user.click(screen.getByRole('button', { name: 'Hide ends' }))
    await waitFor(() => {
      expect(screen.getByTestId('glyph')).toHaveTextContent('none')
    })
    open()
    await waitFor(() => {
      expect(screen.getByTestId('glyph')).toHaveTextContent('M1 1L2 2')
    })
  })
})

import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import type { ActivityListItem } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
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
  })
})

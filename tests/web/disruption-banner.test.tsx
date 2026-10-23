import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { P } from '../../shared/engine/params/index.ts'
import type { DisruptionResult, DisruptionView } from '../../shared/types.ts'
import { useDisruptions } from '../../web/api/disruptions.ts'
import { DisruptionBanners } from '../../web/components/disruption/DisruptionBanner.tsx'
import { RevisionDiff } from '../../web/components/revisions/RevisionDiff.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import {
  makeDiff,
  makePreview,
  makeRevision,
  makeWeekLine,
  makeWindow,
  settings,
} from './plan-fixtures.ts'
import { TODAY } from './today-fixtures.ts'

// Wednesday 18 March 2026. An illness window from Monday 16 to Friday 20 March: rest through the
// symptom-free day (Saturday), easy running Sunday to Tuesday, hard sessions again on Wednesday 25.
function illness(over: Partial<DisruptionView> = {}): DisruptionView {
  return makeWindow({
    id: 'w1',
    startDate: '2026-03-16',
    endDate: '2026-03-20',
    runFrom: '2026-03-22',
    qualityFrom: '2026-03-25',
    phase: 'resting',
    ...over,
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

function Live({ units = 'km' as const }: { units?: 'km' | 'mi' }) {
  const windows = useDisruptions()
  return <DisruptionBanners windows={windows.data ?? []} today={TODAY} units={units} />
}

function renderBanners(windows: DisruptionView[], extra: MockRoutes = {}) {
  const { calls } = mockApi({
    'GET /api/settings': () => settings,
    'GET /api/plan/disruptions': () => windows,
    ...extra,
  })
  renderWithProviders(
    <ToastProvider>
      <Live />
    </ToastProvider>,
  )
  return { calls }
}

describe('DisruptionBanner, the line for each phase', () => {
  test.each<[string, Partial<DisruptionView>, string]>([
    ['resting for illness', {}, 'Resting for illness until Fri 20 Mar.'],
    [
      'resting for a niggle',
      { reason: 'niggle', pain: 3 },
      'Resting for a niggle until Fri 20 Mar.',
    ],
    [
      'no running while travelling',
      { reason: 'travel' },
      'No running while travelling until Fri 20 Mar.',
    ],
    [
      'no running while short on time',
      { reason: 'short-on-time' },
      'No running while short on time until Fri 20 Mar.',
    ],
    [
      'the wait for a symptom-free day',
      { phase: 'rest-gate' },
      'One symptom-free day first, then easy running from Sun 22 Mar.',
    ],
    [
      'easy running only',
      { phase: 'easy-only' },
      'Easy running only until Tue 24 Mar. Hard sessions return on Wed 25 Mar.',
    ],
    [
      'short runs while travelling',
      { reason: 'travel', mode: 'limited', maxRunMin: 30, phase: 'limited' },
      'Travelling: runs up to 30 min until Fri 20 Mar.',
    ],
    ['the return week', { phase: 'returning', returnWeekMin: 240 }, 'Return week: up to 240 min.'],
    [
      'a window that has not started',
      { phase: 'upcoming', startDate: '2026-03-23', endDate: '2026-03-25' },
      'A window starts on Mon 23 Mar and lasts until Wed 25 Mar.',
    ],
  ])('%s', async (_name, over, line) => {
    renderBanners([illness(over)])
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    expect(within(banner).getByText(line)).toBeInTheDocument()
    expectCleanCopy(banner)
  })

  test('the symptom-free wait reads the Params', async () => {
    expect(P.n3.illnessSymptomFreeDays.value).toBe(1)
    renderBanners([illness({ phase: 'rest-gate' })])
    expect(await screen.findByText(/^One symptom-free day first/)).toBeInTheDocument()
  })

  test('a window that is over shows nothing', async () => {
    const { calls } = renderBanners([illness({ phase: 'done' })])
    await waitFor(() => {
      expect(calls.some((c) => c.url.startsWith('/api/plan/disruptions'))).toBe(true)
    })
    expect(screen.queryByRole('region', { name: 'Rest window' })).not.toBeInTheDocument()
  })
})

describe('DisruptionBanner, the buttons', () => {
  test('a window in force offers I am better, Extend and Remove window', async () => {
    renderBanners([illness()])
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    expect(
      within(banner)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(["I'm better", 'Extend', 'Remove window'])
  })

  test('a window about travel says Finish early, and the wait after an illness has no early end', async () => {
    renderBanners([
      illness({ id: 'w2', reason: 'travel', mode: 'limited', maxRunMin: 30, phase: 'limited' }),
      illness({ id: 'w3', phase: 'rest-gate' }),
    ])
    const banners = await screen.findAllByRole('region', { name: 'Rest window' })
    expect(within(banners[0]!).getByRole('button', { name: 'Finish early' })).toBeInTheDocument()
    expect(
      within(banners[1]!).queryByRole('button', { name: "I'm better" }),
    ).not.toBeInTheDocument()
    expect(within(banners[1]!).getByRole('button', { name: 'Extend' })).toBeInTheDocument()
  })

  test('a window that starts today cannot end yesterday', async () => {
    renderBanners([illness({ startDate: TODAY })])
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    expect(within(banner).queryByRole('button', { name: "I'm better" })).not.toBeInTheDocument()
  })
})

function applied(summary: string, id = 'w1'): DisruptionResult {
  return {
    disruption: illness({ id }),
    revision: makeRevision({
      id: 'r8',
      reason: 'disruption',
      auto: false,
      summary,
      diff: makeDiff([], [makeWeekLine({ weekStart: '2026-03-16', runMinAfter: 280 })]),
      causes: { sessions: {}, weeks: { '2027-01-11': ['disruption'] } },
      undo: { available: true, reasons: [], undoneAt: null },
      seenAt: null,
      disruptionId: id,
    }),
  }
}

describe('DisruptionBanner, I am better', () => {
  test('ends the window yesterday: previews it, then applies that preview with its hash', async () => {
    const user = userEvent.setup()
    const { calls } = renderBanners([illness()], {
      'POST /api/plan/preview': () =>
        makePreview({
          action: { type: 'disruption-update', id: 'w1', endDate: '2026-03-17' },
          summary: 'Changed the window (illness) to run from Mon 16 Mar to Tue 17 Mar.',
          hash: 'd'.repeat(64),
          diff: makeDiff([], [makeWeekLine({ weekStart: '2026-03-16', runMinAfter: 280 })]),
        }),
      'PATCH /api/plan/disruptions/w1': () =>
        applied('Changed the window (illness) to run from Mon 16 Mar to Tue 17 Mar.'),
      'POST /api/plan/revisions/r8/seen': () => ({ status: 204, body: undefined }),
    })
    await user.click(await screen.findByRole('button', { name: "I'm better" }))
    const dialog = await screen.findByRole('dialog', { name: "I'm better" })
    expect(
      await within(dialog).findByText(
        'Changed the window (illness) to run from Mon 16 Mar to Tue 17 Mar.',
      ),
    ).toBeInTheDocument()
    expect(calls.find((c) => c.url === '/api/plan/preview')?.body).toEqual({
      type: 'disruption-update',
      id: 'w1',
      endDate: '2026-03-17',
    })
    expectCleanCopy(dialog)

    await user.click(within(dialog).getByRole('button', { name: 'Apply to my plan' }))
    const changed = await within(dialog).findByRole('heading', { name: 'Window changed' })
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      endDate: '2026-03-17',
      expectHash: 'd'.repeat(64),
    })
    expect(within(dialog).getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
    // The Apply button is gone: focus moves to what was done, inside the dialog.
    await waitFor(() => {
      expect(changed).toHaveFocus()
    })
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/plan/revisions/r8/seen')).toBe(true)
    })
  })

  test('is titled for the button that opened it: I am better for an illness', async () => {
    const user = userEvent.setup()
    renderBanners([illness()], { 'POST /api/plan/preview': () => makePreview() })
    await user.click(await screen.findByRole('button', { name: "I'm better" }))
    const dialog = await screen.findByRole('dialog', { name: "I'm better" })
    expect(
      within(dialog).getByText(
        'The window ends yesterday. The return is sized from the days you rested.',
      ),
    ).toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test('is titled for the button that opened it: Finish early for a travel window', async () => {
    const user = userEvent.setup()
    const travel = illness({
      id: 'w2',
      reason: 'travel',
      mode: 'limited',
      maxRunMin: 30,
      phase: 'limited',
    })
    const { calls } = renderBanners([travel], {
      'POST /api/plan/preview': () =>
        makePreview({
          action: { type: 'disruption-update', id: 'w2', endDate: '2026-03-17' },
        }),
    })
    await user.click(await screen.findByRole('button', { name: 'Finish early' }))
    const dialog = await screen.findByRole('dialog', { name: 'Finish early' })
    expect(screen.queryByRole('dialog', { name: "I'm better" })).not.toBeInTheDocument()
    // Nothing here talks about days rested: a travel window is not a layoff.
    expect(within(dialog).queryByText(/days you rested/)).not.toBeInTheDocument()
    expect(
      within(dialog).getByText('The window ends yesterday. The plan picks up from today.'),
    ).toBeInTheDocument()
    expectCleanCopy(dialog)
    await waitFor(() => {
      expect(calls.find((c) => c.url === '/api/plan/preview')?.body).toEqual({
        type: 'disruption-update',
        id: 'w2',
        endDate: '2026-03-17',
      })
    })
  })

  test('a niggle is a health window too: I am better', async () => {
    const user = userEvent.setup()
    renderBanners([illness({ reason: 'niggle', pain: 3 })], {
      'POST /api/plan/preview': () => makePreview(),
    })
    await user.click(await screen.findByRole('button', { name: "I'm better" }))
    expect(await screen.findByRole('dialog', { name: "I'm better" })).toBeInTheDocument()
  })

  test('a revision that was seen when it was written is not stamped as seen again', async () => {
    const user = userEvent.setup()
    const written = applied('Changed the window (illness) to run from Mon 16 Mar to Tue 17 Mar.')
    const { calls } = renderBanners([illness()], {
      'POST /api/plan/preview': () => makePreview({ hash: 'd'.repeat(64) }),
      'PATCH /api/plan/disruptions/w1': () => ({
        ...written,
        revision: { ...written.revision, seenAt: '2026-03-18T12:00:00.000Z' },
      }),
    })
    await user.click(await screen.findByRole('button', { name: "I'm better" }))
    const dialog = await screen.findByRole('dialog', { name: "I'm better" })
    await user.click(await within(dialog).findByRole('button', { name: 'Apply to my plan' }))
    await within(dialog).findByRole('heading', { name: 'Window changed' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(calls.filter((c) => c.url.endsWith('/seen'))).toEqual([])
  })
})

describe('DisruptionBanner, Extend', () => {
  test('previews the day after the last day and asks again when the date changes', async () => {
    const user = userEvent.setup()
    const { calls } = renderBanners([illness()], {
      'POST /api/plan/preview': ({ body }) =>
        makePreview({
          action: body as never,
          summary: `Changed the window (illness) to run to ${(body as { endDate: string }).endDate}.`,
          hash: 'e'.repeat(64),
        }),
      'PATCH /api/plan/disruptions/w1': () => applied('Changed the window (illness).'),
      'POST /api/plan/revisions/r8/seen': () => ({ status: 204, body: undefined }),
    })
    await user.click(await screen.findByRole('button', { name: 'Extend' }))
    const dialog = await screen.findByRole('dialog', { name: 'Extend this window' })
    const until = within(dialog).getByLabelText('Until')
    expect(until).toHaveValue('2026-03-21')
    expect(await within(dialog).findByText(/to 2026-03-21/)).toBeInTheDocument()

    fireEvent.change(until, { target: { value: '2026-03-23' } })
    expect(await within(dialog).findByText(/to 2026-03-23/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Apply to my plan' }))
    await within(dialog).findByText('Window changed')
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      endDate: '2026-03-23',
      expectHash: 'e'.repeat(64),
    })
  })

  test('shows the server refusal under the date', async () => {
    const user = userEvent.setup()
    renderBanners([illness()], {
      'POST /api/plan/preview': () => ({
        status: 400,
        body: {
          error: {
            code: 'validation',
            message: 'Some fields need attention.',
            details: { issues: [{ path: 'endDate', message: 'A window can last up to 28 days.' }] },
          },
        },
      }),
    })
    await user.click(await screen.findByRole('button', { name: 'Extend' }))
    const dialog = await screen.findByRole('dialog', { name: 'Extend this window' })
    expect(await within(dialog).findByText('A window can last up to 28 days.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Apply to my plan' })).toBeDisabled()
  })
})

describe('DisruptionBanner, Remove window', () => {
  test('previews the removal, applies it, and the sheet stays after the banner has gone', async () => {
    const user = userEvent.setup()
    let removed = false
    const { calls } = renderBanners([illness()], {
      'GET /api/plan/disruptions': () => (removed ? [] : [illness()]),
      'POST /api/plan/preview': () =>
        makePreview({
          action: { type: 'disruption-remove', id: 'w1' },
          summary: 'Removed the window (illness) from Mon 16 Mar to Fri 20 Mar.',
          hash: 'f'.repeat(64),
        }),
      'DELETE /api/plan/disruptions/w1': () => {
        removed = true
        return applied('Removed the window (illness) from Mon 16 Mar to Fri 20 Mar.')
      },
      'POST /api/plan/revisions/r8/seen': () => ({ status: 204, body: undefined }),
    })
    await user.click(await screen.findByRole('button', { name: 'Remove window' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this window' })
    expect(
      await within(dialog).findByText(
        'Removed the window (illness) from Mon 16 Mar to Fri 20 Mar.',
      ),
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Days already skipped stay skipped.')
    await user.click(within(dialog).getByRole('button', { name: 'Apply to my plan' }))

    const removedHeading = await within(dialog).findByRole('heading', { name: 'Window removed' })
    await waitFor(() => {
      expect(removedHeading).toHaveFocus()
    })
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe(
      `/api/plan/disruptions/w1?expectHash=${'f'.repeat(64)}`,
    )
    // The list has read the windows again and the banner is gone; the sheet is not.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Rest window' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('dialog', { name: 'Remove this window' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
  })

  test('a preview that went stale shows the new one, then applies it', async () => {
    const user = userEvent.setup()
    let commits = 0
    const newer = makePreview({
      action: { type: 'disruption-remove', id: 'w1' },
      summary: 'Removed the window (illness) from Mon 16 Mar to Fri 20 Mar.',
      hash: '9'.repeat(64),
    })
    const { calls } = renderBanners([illness()], {
      'POST /api/plan/preview': () => makePreview({ hash: '8'.repeat(64) }),
      'DELETE /api/plan/disruptions/w1': () => {
        commits += 1
        return commits === 1
          ? {
              status: 409,
              body: {
                error: {
                  code: 'conflict',
                  message: 'This preview is out of date. Review the new one before applying it.',
                  details: { code: 'stale-preview', preview: newer },
                },
              },
            }
          : applied('Removed the window (illness) from Mon 16 Mar to Fri 20 Mar.')
      },
      'POST /api/plan/revisions/r8/seen': () => ({ status: 204, body: undefined }),
    })
    await user.click(await screen.findByRole('button', { name: 'Remove window' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this window' })
    await user.click(await within(dialog).findByRole('button', { name: 'Apply to my plan' }))
    expect(
      await within(dialog).findByText(
        'The plan changed while you were reading. This is the new preview.',
      ),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Apply to my plan' }))
    await within(dialog).findByText('Window removed')
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('=')[1])).toEqual([
      '8'.repeat(64),
      '9'.repeat(64),
    ])
  })

  test('Cancel closes the sheet and writes nothing', async () => {
    const user = userEvent.setup()
    const { calls } = renderBanners([illness()], {
      'POST /api/plan/preview': () => makePreview(),
    })
    await user.click(await screen.findByRole('button', { name: 'Remove window' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this window' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'DELETE' || c.method === 'PATCH')).toEqual([])
    expect(screen.getByRole('button', { name: 'Remove window' })).toHaveFocus()
  })

  test('Escape closes the sheet, writes nothing and gives focus back to the button', async () => {
    const user = userEvent.setup()
    const { calls } = renderBanners([illness()], {
      'POST /api/plan/preview': () => makePreview(),
    })
    await user.click(await screen.findByRole('button', { name: 'Extend' }))
    const dialog = await screen.findByRole('dialog', { name: 'Extend this window' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await within(dialog).findByRole('button', { name: 'Apply to my plan' })
    expectCleanCopy(dialog)
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Extend' })).toHaveFocus()
    expect(calls.filter((c) => c.method === 'DELETE' || c.method === 'PATCH')).toEqual([])
  })
})

describe('A window whose undo is refused', () => {
  function refused(): ReturnType<typeof makeRevision> {
    return makeRevision({
      id: 'r4',
      reason: 'disruption',
      auto: false,
      summary: 'Added a window (illness) from Mon 16 Mar to Fri 20 Mar.',
      disruptionId: 'w1',
      undo: {
        available: false,
        undoneAt: null,
        reasons: [
          {
            code: 'edited-since',
            message: 'Easy run on Thu 19 Mar changed after this update, so it cannot be restored.',
            sessionId: 's1',
          },
        ],
      },
    })
  }

  function renderRevision(windows: DisruptionView[], extra: MockRoutes = {}) {
    const { calls } = mockApi({
      'GET /api/settings': () => settings,
      'GET /api/plan/disruptions': () => windows,
      ...extra,
    })
    renderWithProviders(
      <ToastProvider>
        <RevisionDiff revision={refused()} units="km" />
      </ToastProvider>,
    )
    return { calls }
  }

  test('offers to remove the window instead, and opens the removal preview', async () => {
    const user = userEvent.setup()
    const { calls } = renderRevision([illness()], {
      'POST /api/plan/preview': () =>
        makePreview({ action: { type: 'disruption-remove', id: 'w1' }, hash: '7'.repeat(64) }),
    })
    expect(
      screen.getByText(/changed after this update, so it cannot be restored/),
    ).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Remove this rest window instead' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this window' })
    await within(dialog).findByRole('button', { name: 'Apply to my plan' })
    expect(calls.find((c) => c.url === '/api/plan/preview')?.body).toEqual({
      type: 'disruption-remove',
      id: 'w1',
    })
    expectCleanCopy(dialog)
  })

  test('offers nothing once the window is no longer in force', async () => {
    const { calls } = renderRevision([])
    await waitFor(() => {
      expect(calls.some((c) => c.url.startsWith('/api/plan/disruptions'))).toBe(true)
    })
    expect(
      screen.queryByRole('button', { name: 'Remove this rest window instead' }),
    ).not.toBeInTheDocument()
  })

  test('is not offered for a refusal that is not about edits since', () => {
    mockApi({ 'GET /api/settings': () => settings })
    renderWithProviders(
      <ToastProvider>
        <RevisionDiff
          revision={makeRevision({
            reason: 'disruption',
            disruptionId: 'w1',
            undo: {
              available: false,
              undoneAt: null,
              reasons: [{ code: 'window-passed', message: 'The 7-day window has passed.' }],
            },
          })}
          units="km"
        />
      </ToastProvider>,
    )
    expect(
      screen.queryByRole('button', { name: 'Remove this rest window instead' }),
    ).not.toBeInTheDocument()
  })
})

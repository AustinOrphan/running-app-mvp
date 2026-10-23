import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PlanPreview, UndoResult, WeekStripMark } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { DashboardPage } from '../../web/pages/DashboardPage.tsx'
import {
  activityPage,
  explainOf,
  expectCleanCopy,
  mockApi,
  renderWithProviders,
} from './helpers.tsx'
import {
  makeCoach,
  makeHero,
  makeRace,
  makeSession,
  makeStrip,
  makeToday,
} from './today-fixtures.ts'
import { AVAILABLE, makeDiff, makeRevision } from './plan-fixtures.ts'
import { renderToday, settingsOf, startToday } from './today-render.tsx'

// Stands in for the real drawer so the wiring is visible: which rules it was opened with.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, explain, open }: { rules: string[]; explain?: unknown; open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Why" data-explain={JSON.stringify(explain ?? null)}>
        {`rules: ${rules.join(', ')}`}
      </div>
    ) : null,
}))

beforeEach(startToday)

afterEach(() => {
  vi.useRealTimers()
})

describe('Today: the week strip', () => {
  function stripDay(date: string, mark: WeekStripMark, runMin = 0) {
    return [
      date,
      {
        mark,
        runMin,
        sessions:
          mark === 'free' ? [] : [makeSession({ id: `s-${date}`, date, title: 'Easy run' })],
      },
    ] as const
  }

  const week = Object.fromEntries([
    stripDay('2026-03-16', 'done', 40),
    stripDay('2026-03-17', 'unlogged'),
    stripDay('2026-03-18', 'planned'),
    stripDay('2026-03-19', 'free'),
    stripDay('2026-03-20', 'skipped'),
    stripDay('2026-03-21', 'partial', 20),
    stripDay('2026-03-22', 'planned'),
  ])

  function withWeek(over: Parameters<typeof makeStrip>[0] = {}) {
    return makeToday({ coach: makeCoach({ weekStrip: makeStrip(over, week) }) })
  }

  test('names every day with its mark and the run time logged, and marks today', async () => {
    const { container } = renderToday(withWeek({ runMin: 60, targetRunMin: 300 }))
    const strip = await screen.findByRole('region', { name: 'This week' })
    expect(within(strip).getAllByRole('listitem')).toHaveLength(7)
    for (const name of [
      'Monday 16 Mar, Done, 40 min logged',
      'Tuesday 17 Mar, Planned, no run logged',
      'Wednesday 18 Mar, Planned',
      'Friday 20 Mar, Skipped',
      'Saturday 21 Mar, Partly done, 20 min logged',
      'Sunday 22 Mar, Planned',
    ]) {
      expect(within(strip).getByRole('button', { name })).toBeInTheDocument()
    }
    // A day with nothing planned is a name, not a button.
    expect(within(strip).getByText('Thursday 19 Mar, No run planned')).toBeInTheDocument()
    expect(within(strip).getAllByRole('button')).toHaveLength(6)
    const current = within(strip).getByRole('button', { name: 'Wednesday 18 Mar, Planned' })
    expect(current).toHaveAttribute('aria-current', 'date')
    expect(strip.querySelectorAll('[aria-current]')).toHaveLength(1)
    expectCleanCopy(container)
  })

  test('shows the hours against the target as a Meter, and the advisory split', async () => {
    renderToday(
      withWeek({
        runMin: 186,
        targetRunMin: 450,
        remaining: { remainingMin: 264, remainingDays: 4, perDayMin: 66 },
      }),
    )
    const strip = await screen.findByRole('region', { name: 'This week' })
    expect(within(strip).getByRole('meter', { name: 'Run time this week' })).toHaveAttribute(
      'aria-valuetext',
      '3.1 of 7.5 hours',
    )
    expect(within(strip).getByText('3.1 h of 7.5 h target')).toBeInTheDocument()
    expect(within(strip).getByText('66 min a day left, through Sunday')).toBeInTheDocument()
    expect(within(strip).getByText('advisory')).toBeInTheDocument()
  })

  test('says nothing is left to plan once the week is covered', async () => {
    renderToday(
      withWeek({
        runMin: 460,
        targetRunMin: 450,
        remaining: { remainingMin: 0, remainingDays: 4, perDayMin: 0 },
      }),
    )
    const strip = await screen.findByRole('region', { name: 'This week' })
    expect(within(strip).getByText('Nothing left to plan this week')).toBeInTheDocument()
    expect(within(strip).getByText('0.2 h past target')).toBeInTheDocument()
  })

  test('without a target it states the hours run and draws no Meter', async () => {
    renderToday(withWeek({ runMin: 120, targetRunMin: null }))
    const strip = await screen.findByRole('region', { name: 'This week' })
    expect(within(strip).getByText('2.0 h run this week')).toBeInTheDocument()
    expect(within(strip).queryByRole('meter')).not.toBeInTheDocument()
  })

  test('is left out when nothing is planned or logged and there is no target', async () => {
    renderToday(makeToday({ coach: makeCoach({ weekStrip: makeStrip() }) }))
    await screen.findByText(/No plan yet/)
    expect(screen.queryByRole('region', { name: 'This week' })).not.toBeInTheDocument()
  })

  test("a tap on a day opens that day's session", async () => {
    const user = userEvent.setup()
    renderToday(withWeek({ targetRunMin: 300 }), {
      'GET /api/activities': () => activityPage([]),
    })
    await user.click(
      await screen.findByRole('button', { name: 'Monday 16 Mar, Done, 40 min logged' }),
    )
    const sheet = await screen.findByRole('dialog', { name: 'Easy run' })
    expect(within(sheet).getByText(/Mon 16 Mar 2026/)).toBeInTheDocument()
  })
})

describe('Today: the race countdown', () => {
  test('counts the days and names the race', async () => {
    renderToday(makeToday({ coach: makeCoach({ race: makeRace() }) }))
    const race = await screen.findByRole('region', { name: 'Race' })
    expect(within(race).getByText('87')).toBeInTheDocument()
    expect(race.querySelector('p')).toHaveTextContent('87 days to the race')
    expect(within(race).getByText('Example Half, Sat 13 Jun 2026')).toBeInTheDocument()
    expect(within(race).queryByText(/Finish estimate/)).not.toBeInTheDocument()
  })

  test('says "Race day" on the day, and marks a provisional date', async () => {
    renderToday(
      makeToday({
        coach: makeCoach({ race: makeRace({ daysToRace: 0, dateProvisional: true }) }),
      }),
    )
    const race = await screen.findByRole('region', { name: 'Race' })
    expect(within(race).getByText('Race day')).toBeInTheDocument()
    expect(within(race).getByText(/, date provisional$/)).toBeInTheDocument()
  })

  test('has no countdown without a race', async () => {
    renderToday(makeToday())
    await screen.findByText(/No plan yet/)
    expect(screen.queryByRole('region', { name: 'Race' })).not.toBeInTheDocument()
  })

  test('gives the finish estimate with its range, rounded as the design words it', async () => {
    const { container } = renderToday(
      makeToday({
        coach: makeCoach({
          race: makeRace({
            prediction: {
              method: 'critical-speed',
              predictedSec: 7140,
              lowSec: 6780,
              highSec: 7560,
            },
          }),
        }),
      }),
    )
    const race = await screen.findByRole('region', { name: 'Race' })
    expect(
      within(race).getByText(
        'Finish estimate 1 h 53 min to 2 h 6 min, most likely about 1 h 59 min.',
      ),
    ).toBeInTheDocument()
    expect(within(race).queryByText(/wide on purpose/)).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test("says an ultra range is wide on purpose, with the distance in the runner's units", async () => {
    const user = userEvent.setup()
    const race = makeRace({
      name: 'Example 100',
      distanceM: 160934,
      daysToRace: 200,
      prediction: {
        method: 'critical-speed',
        predictedSec: 114_720,
        lowSec: 99_660,
        highSec: 130_800,
      },
      range: { wide: true, minHalfWidthPct: 15, rules: ['L4', 'L6'], grade: 'D' },
    })
    const { container } = renderToday(makeToday({ coach: makeCoach({ race }) }))
    const region = await screen.findByRole('region', { name: 'Race' })
    expect(
      within(region).getByText(
        'Finish estimate 27 h 40 min to 36 h 20 min, most likely about 31 h 50 min.',
      ),
    ).toBeInTheDocument()
    expect(
      within(region).getByText(
        'The range is wide on purpose. Predictions for 100 mi rest on thin evidence (grade D).',
      ),
    ).toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: 'Why: the finish estimate' }))
    const drawer = await screen.findByRole('dialog', { name: 'Why' })
    expect(drawer).toHaveTextContent('rules: L4, L6')
    expect(explainOf(drawer)).toEqual({ subject: 'prediction', goalId: 'g1' })
    expectCleanCopy(container)
  })
})

describe('Today: the change line', () => {
  const change = {
    id: 'rev1',
    createdAt: '2026-03-16T12:30:00',
    reason: 'weekly' as const,
    summary: 'Moved the long run to Sunday and cut Tuesday by 10 min.',
  }

  test('fills the brief slot with the stored summary and a Details button', async () => {
    const { container } = renderToday(makeToday({ coach: makeCoach({ change }) }))
    const line = await screen.findByRole('region', { name: 'What changed' })
    expect(line.closest('[data-slot]')).toHaveAttribute('data-slot', 'brief')
    expect(line.closest('[data-slot]')).toHaveAttribute('data-budget-px', '52')
    expect(within(line).getByText(change.summary)).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test("puts the summary in the runner's units", async () => {
    renderToday(
      makeToday({ coach: makeCoach({ change: { ...change, summary: 'Long run to 32 km.' } }) }),
    )
    expect(await screen.findByText('Long run to 19.9 mi.')).toBeInTheDocument()
  })

  test('Details opens a sheet with the update through the shared diff, stamped as seen', async () => {
    const user = userEvent.setup()
    const { api } = renderToday(makeToday({ coach: makeCoach({ change }) }), {
      'GET /api/plan/revisions': () => [
        makeRevision({
          id: change.id,
          createdAt: change.createdAt,
          reason: change.reason,
          summary: change.summary,
          changes: [],
          seenAt: null,
        }),
      ],
      'POST /api/plan/revisions/rev1/seen': () => ({ status: 204, body: undefined }),
    })
    // Above the fold the page asks for neither the list nor the stamp.
    await screen.findByRole('region', { name: 'What changed' })
    expect(api.calls.some((call) => call.url.includes('/plan/revisions'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Details of this update' }))
    const sheet = await screen.findByRole('dialog', { name: 'What changed' })
    expect(await within(sheet).findByText('Weekly update')).toBeInTheDocument()
    expect(within(sheet).getByText('16 Mar')).toBeInTheDocument()
    expect(within(sheet).getByText(change.summary)).toBeInTheDocument()
    // The marker stays while the sheet is open, though opening stamped the update.
    expect(within(sheet).getByText('New')).toBeInTheDocument()
    await waitFor(() => {
      expect(
        api.calls.filter((call) => call.url.includes('/seen')).map((call) => call.url),
      ).toEqual(['/api/plan/revisions/rev1/seen'])
    })
    expect(within(sheet).getByRole('link', { name: 'Open the plan' })).toHaveAttribute(
      'href',
      '/plan',
    )
  })

  test('the sheet gives the kind, the day and the summary when the list has no such update', async () => {
    const user = userEvent.setup()
    renderToday(makeToday({ coach: makeCoach({ change }) }), {
      'GET /api/plan/revisions': () => [],
    })
    await user.click(await screen.findByRole('button', { name: 'Details of this update' }))
    const sheet = await screen.findByRole('dialog', { name: 'What changed' })
    expect(within(sheet).getByText('Weekly update')).toBeInTheDocument()
    expect(within(sheet).getByText('Mon 16 Mar 2026')).toBeInTheDocument()
    expect(within(sheet).getByText(change.summary)).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Open the plan' })).toHaveAttribute(
      'href',
      '/plan',
    )
  })

  test('the sheet gives the label of every reason the line can carry, before the list arrives', async () => {
    const user = userEvent.setup()
    renderToday(makeToday({ coach: makeCoach({ change: { ...change, reason: 'break' } }) }), {
      'GET /api/plan/revisions': () => [],
    })
    await user.click(await screen.findByRole('button', { name: 'Details of this update' }))
    const sheet = await screen.findByRole('dialog', { name: 'What changed' })
    expect(within(sheet).getByText('Restart after a break')).toBeInTheDocument()
  })

  test('undoing the only update from its sheet leaves focus on the page, not on the body', async () => {
    const user = userEvent.setup()
    let undone = false
    const revision = makeRevision({
      id: change.id,
      createdAt: change.createdAt,
      reason: change.reason,
      summary: change.summary,
      changes: [],
      diff: makeDiff([]),
      undo: AVAILABLE,
      seenAt: change.createdAt,
    })
    const preview: PlanPreview = {
      action: { type: 'undo', revisionId: change.id },
      diff: makeDiff([]),
      summary: 'Undid: nothing.',
      warnings: [],
      blocked: false,
      guards: [],
      reasons: [],
      hash: 'a'.repeat(64),
      today: '2026-03-18',
    }
    const result: UndoResult = {
      revision: makeRevision({ id: 'rev2', reason: 'undo', undoOf: change.id }),
      target: { ...revision, undo: { available: false, reasons: [], undoneAt: change.createdAt } },
    }
    // The server stops reporting an undone update, and the undo itself is not a weekly update, so
    // the line (and the sheet it opens) goes once Today is read again.
    mockApi({
      'GET /api/today': () => makeToday({ coach: makeCoach({ change: undone ? null : change }) }),
      'GET /api/settings': () => settingsOf('mi'),
      'GET /api/plan/revisions': () => [
        undone ? { ...revision, undo: result.target.undo } : revision,
      ],
      'POST /api/plan/preview': () => preview,
      'POST /api/plan/revisions/rev1/undo': () => {
        undone = true
        return result
      },
    })
    // Layout supplies the landmark in the app.
    renderWithProviders(
      <ToastProvider>
        <main id="main" tabIndex={-1}>
          <DashboardPage />
        </main>
      </ToastProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Details of this update' }))
    const sheet = await screen.findByRole('dialog', { name: 'What changed' })
    await user.click(await within(sheet).findByRole('button', { name: 'Undo update' }))
    const confirm = await within(sheet).findByRole('dialog', { name: 'Undo this update' })
    await user.click(await within(confirm).findByRole('button', { name: 'Undo update' }))

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'What changed' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveFocus()
  })

  test('no update, no line and no slot', async () => {
    renderToday(makeToday())
    await screen.findByText(/No plan yet/)
    expect(screen.queryByRole('region', { name: 'What changed' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot]')).toBeNull()
  })
})

describe('Today: a day ahead', () => {
  test('a preview has no verdict, no signals and no check-in', async () => {
    const hero = makeHero()
    renderToday(
      makeToday({
        sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
        coach: makeCoach({ preview: true, verdict: null, signals: [], hero }),
      }),
    )
    await screen.findByRole('article', { name: 'Easy run' })
    expect(screen.queryByRole('region', { name: 'Readiness' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Check-in' })).not.toBeInTheDocument()
  })
})

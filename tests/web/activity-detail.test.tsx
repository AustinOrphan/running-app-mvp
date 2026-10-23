import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import type { ExecutionAssessment } from '../../shared/engine/types.ts'
import type { ActivityDetail, Feel, PlanWithSessions, Units } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ActivityDetailPage } from '../../web/pages/ActivityDetailPage.tsx'
import { makeActivity } from '../factories.ts'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { makeSession, makeV2Plan } from './plan-fixtures.ts'

function makeDetail(over: Partial<ActivityDetail> = {}): ActivityDetail {
  const t = Array.from({ length: 12 }, (_, i) => i * 10)
  return {
    activity: makeActivity({
      id: 'a1',
      date: '2026-03-02',
      startTime: '07:30',
      durationSec: 1800,
      distanceM: 5000,
      movingSec: 1750,
      avgHr: 148,
      maxHr: 171,
      elevationGainM: 60,
      elevationLossM: 55,
      avgCadence: 168,
      deviceName: 'Example Watch',
      source: 'strava',
      tempC: 10,
      dewPointC: 5,
      humidityPct: 70,
      windKph: 16,
      weatherSource: 'open-meteo',
      decouplingPct: 3.4,
      hrHistogram: { start: 138, width: 1, sec: [30, 30, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60] },
    }),
    stream: {
      sampleSec: 10,
      t,
      d: t.map((_, i) => (i + 1) * 30),
      hr: t.map((_, i) => 140 + i),
      alt: t.map((_, i) => 100 + i),
      cad: null,
      pwr: null,
    },
    laps: [
      {
        startSec: 0,
        durationSec: 600,
        distanceM: 1609,
        avgHr: 140,
        maxHr: 150,
        avgCadence: 166,
      },
      {
        startSec: 600,
        durationSec: 610,
        distanceM: 1609,
        avgHr: 150,
        maxHr: 160,
        avgCadence: 168,
      },
    ],
    hasFile: true,
    ...over,
  }
}

/** An assessment as the engine builds it: parts[rpeDelta, feel] decide whether a rating is behind it. */
function makeExecution(
  score: ExecutionAssessment['effort']['score'] = 1,
  parts: Partial<ExecutionAssessment['effort']['parts']> = {},
): ExecutionAssessment {
  return {
    completion: 'completed',
    intensity: 'on',
    effort: {
      score,
      confidence: 'low',
      parts: { rpeDelta: null, feel: null, hrResidualZ: 1.4, paceResidualPct: null, ...parts },
    },
    conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
    flags: [],
    lines: [],
  }
}

/** The active plan with one completed session linked to activity `a1`. */
function planWith(execution: ExecutionAssessment | null, activityId = 'a1'): PlanWithSessions {
  return makeV2Plan({
    sessions: [makeSession({ id: 's1', status: 'completed', activityId, execution })],
  })
}

const RATING_ASK = /Rate this activity \(effort or feel\) so the plan can adjust\./
const RATING_CAVEAT =
  /Without a rating, the plan's read of this activity stays a low-confidence guess/

/** Lets a query that has just been answered reach the page, so an absence check is not premature. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function renderDetail(
  opts: {
    detail?: ActivityDetail
    units?: Units
    plan?: PlanWithSessions | null
    routes?: MockRoutes
  } = {},
) {
  const detail = opts.detail ?? makeDetail()
  const api = mockApi({
    'GET /api/settings': () => ({
      email: 'runner@example.com',
      displayName: null,
      units: opts.units ?? 'mi',
    }),
    'GET /api/activities/a1/detail': () => detail,
    'GET /api/plan': () => opts.plan ?? null,
    ...opts.routes,
  })
  renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/activities/:id" element={<ActivityDetailPage />} />
        <Route path="/activities" element={<p>Activities list</p>} />
      </Routes>
    </ToastProvider>,
    { route: '/activities/a1' },
  )
  return api
}

describe('ActivityDetailPage', () => {
  test('summary shows the type, date, time, distance and pace', async () => {
    renderDetail()
    expect(await screen.findByRole('heading', { level: 1, name: 'Run' })).toBeInTheDocument()
    expect(screen.getByText('Mon 2 Mar 2026, 07:30')).toBeInTheDocument()
    const summary = screen.getByRole('region', { name: 'Summary' })
    expect(within(summary).getByText('3.11 mi')).toBeInTheDocument()
    expect(within(summary).getByText('9:39 /mi')).toBeInTheDocument()
    expect(within(summary).getByText('30:00')).toBeInTheDocument()
    expect(within(summary).getByText('29:10')).toBeInTheDocument()
    expect(within(summary).getByText('148 bpm')).toBeInTheDocument()
    expect(within(summary).getByText('Example Watch')).toBeInTheDocument()
    expect(within(summary).getByText('197 ft')).toBeInTheDocument()
  })

  test('units follow settings', async () => {
    renderDetail({ units: 'km' })
    const summary = await screen.findByRole('region', { name: 'Summary' })
    expect(within(summary).getByText('5.00 km')).toBeInTheDocument()
    expect(within(summary).getByText('6:00 /km')).toBeInTheDocument()
    expect(within(summary).getByText('60 m')).toBeInTheDocument()
  })

  test('pace, heart rate and elevation charts share the page', async () => {
    renderDetail()
    expect(await screen.findByRole('img', { name: /^Pace, average/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Heart rate, average/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Elevation, from/ })).toBeInTheDocument()
  })

  test('a stream without distance still charts heart rate against time', async () => {
    const detail = makeDetail()
    renderDetail({ detail: { ...detail, stream: detail.stream && { ...detail.stream, d: null } } })
    expect(await screen.findByRole('img', { name: /^Heart rate, average/ })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^Pace/ })).not.toBeInTheDocument()
    expect(screen.getAllByText(/against time in minutes/i).length).toBeGreaterThan(0)
  })

  test('no stream means no charts and a plain line saying so', async () => {
    renderDetail({ detail: makeDetail({ stream: null, laps: null, hasFile: false }) })
    await screen.findByRole('heading', { level: 1, name: 'Run' })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('No chart data for this activity.')).toBeInTheDocument()
  })

  test('laps table', async () => {
    renderDetail()
    const scroller = await screen.findByRole('region', { name: 'Laps table, scrolls sideways' })
    expect(scroller).toHaveAttribute('tabindex', '0')
    expect(within(scroller).getByRole('table', { name: 'Laps' })).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Laps' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(within(rows[1] as HTMLElement).getByText('10:00')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText('1.00 mi')).toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).getByText('150')).toBeInTheDocument()
  })

  test('weather in Fahrenheit for miles', async () => {
    renderDetail()
    const weather = await screen.findByRole('region', { name: 'Weather' })
    expect(within(weather).getByText('50 °F')).toBeInTheDocument()
    expect(within(weather).getByText('41 °F')).toBeInTheDocument()
    expect(within(weather).getByText('70%')).toBeInTheDocument()
    expect(within(weather).getByText('10 mph')).toBeInTheDocument()
  })

  test('weather in Celsius for km', async () => {
    renderDetail({ units: 'km' })
    const weather = await screen.findByRole('region', { name: 'Weather' })
    expect(within(weather).getByText('10 °C')).toBeInTheDocument()
    expect(within(weather).getByText('16 km/h')).toBeInTheDocument()
  })

  test('no weather section without weather', async () => {
    const base = makeDetail()
    renderDetail({
      detail: {
        ...base,
        activity: {
          ...base.activity,
          tempC: null,
          dewPointC: null,
          humidityPct: null,
          windKph: null,
        },
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Run' })
    expect(screen.queryByRole('region', { name: 'Weather' })).not.toBeInTheDocument()
  })

  test('heart rate distribution in 10 bpm bands, and decoupling', async () => {
    renderDetail()
    const section = await screen.findByRole('region', { name: 'Heart rate distribution' })
    const list = within(section).getByRole('list', { name: 'Time in 10 bpm bands' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('130–139 bpm')
    expect(items[0]).toHaveTextContent('1:00')
    expect(items[1]).toHaveTextContent('140–149 bpm')
    expect(items[1]).toHaveTextContent('10:00')
    expect(within(section).getByText('3.4%')).toBeInTheDocument()
  })

  test('source and original file download', async () => {
    renderDetail()
    const link = await screen.findByRole('link', { name: 'Download original file' })
    expect(link).toHaveAttribute('href', '/api/activities/a1/file')
    expect(screen.getByText('Strava')).toBeInTheDocument()
  })

  test('no download link when there is no file', async () => {
    renderDetail({ detail: makeDetail({ hasFile: false }) })
    await screen.findByRole('heading', { level: 1, name: 'Run' })
    expect(screen.queryByRole('link', { name: 'Download original file' })).not.toBeInTheDocument()
  })

  test('saves RPE, feel and pain together', async () => {
    const user = userEvent.setup()
    const api = renderDetail({ routes: { 'PATCH /api/activities/a1/feedback': () => ({}) } })
    const section = await screen.findByRole('region', { name: 'How did it go?' })
    await user.click(within(section).getByRole('button', { name: 'RPE 7' }))
    await user.click(within(section).getByRole('button', { name: 'Harder' }))
    await user.click(within(section).getByRole('button', { name: 'Pain 2' }))
    await user.click(within(section).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true)
    })
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      rpe: 7,
      feel: 1,
      pain: 2,
    })
  })

  test('feedback starts from the saved values and can be cleared', async () => {
    const user = userEvent.setup()
    const base = makeDetail()
    const api = renderDetail({
      detail: { ...base, activity: { ...base.activity, rpe: 5, feel: -1, pain: 0 } },
      routes: { 'PATCH /api/activities/a1/feedback': () => ({}) },
    })
    const section = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(section).getByRole('button', { name: 'RPE 5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(section).getByRole('button', { name: 'Easier' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(section).getByRole('button', { name: 'RPE 5' }))
    await user.click(within(section).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true)
    })
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      rpe: null,
      feel: -1,
      pain: 0,
    })
  })

  test('feedback follows the stored values when they change after the page loaded', async () => {
    const user = userEvent.setup()
    const base = makeDetail()
    // The stored values are what the server answers with; a rating from elsewhere replaces them.
    let stored = {
      rpe: 5 as number | null,
      feel: null as number | null,
      pain: null as number | null,
    }
    const api = mockApi({
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'mi' }),
      'GET /api/activities/a1/detail': () => ({
        ...base,
        activity: { ...base.activity, ...stored },
      }),
      'GET /api/plan': () => null,
      'PATCH /api/activities/a1/feedback': () => {
        stored = { rpe: 8, feel: 1, pain: 0 }
        return {}
      },
    })
    renderWithProviders(
      <ToastProvider>
        <Routes>
          <Route path="/activities/:id" element={<ActivityDetailPage />} />
        </Routes>
      </ToastProvider>,
      { route: '/activities/a1' },
    )
    const section = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(section).getByRole('button', { name: 'RPE 5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(section).getByRole('button', { name: 'RPE 7' }))
    await user.click(within(section).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true)
    })
    // The stored rating is 8 now, whatever was picked: the section shows what is stored.
    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'How did it go?' })).getByRole('button', {
          name: 'RPE 8',
        }),
      ).toHaveAttribute('aria-pressed', 'true')
    })
    expect(
      within(screen.getByRole('region', { name: 'How did it go?' })).getByRole('button', {
        name: 'Harder',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Feedback saved')).toBeInTheDocument()
  })

  test('a failed feedback save says so and keeps the entries', async () => {
    const user = userEvent.setup()
    renderDetail({
      routes: {
        'PATCH /api/activities/a1/feedback': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'Server error' } },
        }),
      },
    })
    const section = await screen.findByRole('region', { name: 'How did it go?' })
    await user.click(within(section).getByRole('button', { name: 'RPE 6' }))
    await user.click(within(section).getByRole('button', { name: 'Save' }))
    expect(await within(section).findByRole('alert')).toHaveTextContent(/Feedback not saved/)
    expect(within(section).getByRole('button', { name: 'RPE 6' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  describe('asking for a rating', () => {
    test('an unrated activity with an assessed session says a rating lets the plan adjust', async () => {
      renderDetail({ plan: planWith(makeExecution(1)) })
      const section = await screen.findByRole('region', { name: 'How did it go?' })
      expect(await within(section).findByText(RATING_ASK)).toBeInTheDocument()
      expect(within(section).getByText(RATING_CAVEAT)).toBeInTheDocument()
      expect(within(section).getByText(/the plan never changes because of it/)).toBeInTheDocument()
      // The controls to act on it are in the same section.
      expect(within(section).getByRole('button', { name: 'RPE 7' })).toBeInTheDocument()
      expect(within(section).getByRole('button', { name: 'Harder' })).toBeInTheDocument()
      // The copy follows the app's tone.
      expect(section.textContent).not.toMatch(/behind|missed|streak|!/i)
    })

    test('a session with no effort score gets the ask but not the talk of a guess', async () => {
      renderDetail({ plan: planWith(makeExecution(null, { hrResidualZ: null })) })
      const section = await screen.findByRole('region', { name: 'How did it go?' })
      expect(await within(section).findByText(RATING_ASK)).toBeInTheDocument()
      expect(within(section).queryByText(/low-confidence guess/)).not.toBeInTheDocument()
    })

    test.each<[string, { rpe: number | null; feel: Feel | null }]>([
      ['an RPE', { rpe: 5, feel: null }],
      ['a feel', { rpe: null, feel: 0 }],
    ])('has no note when the activity already has %s', async (_name, rating) => {
      const base = makeDetail()
      const api = renderDetail({
        detail: { ...base, activity: { ...base.activity, ...rating } },
        plan: planWith(makeExecution(1, { rpeDelta: rating.rpe === null ? null : 0.5 })),
      })
      const section = await screen.findByRole('region', { name: 'How did it go?' })
      await waitFor(() => {
        expect(api.calls.some((c) => c.url === '/api/plan')).toBe(true)
      })
      await settle()
      expect(within(section).queryByText(RATING_ASK)).not.toBeInTheDocument()
      expect(within(section).queryByText(RATING_CAVEAT)).not.toBeInTheDocument()
    })

    describe('an activity of a different kind than its session', () => {
      const FEEL_ASK = 'Rate how this activity felt so the plan can adjust.'
      const modified = (parts: Partial<ExecutionAssessment['effort']['parts']> = {}) => ({
        ...makeExecution(null, { hrResidualZ: null, ...parts }),
        completion: 'modified' as const,
        intensity: 'unknown' as const,
      })

      test('asks for a feel rating only', async () => {
        renderDetail({ plan: planWith(modified()) })
        const section = await screen.findByRole('region', { name: 'How did it go?' })
        expect(await within(section).findByText(FEEL_ASK)).toBeInTheDocument()
        expect(within(section).queryByText(RATING_ASK)).not.toBeInTheDocument()
      })

      test('still asks when only an RPE is stored, because the engine ignores it there', async () => {
        const base = makeDetail()
        renderDetail({
          detail: { ...base, activity: { ...base.activity, rpe: 6, feel: null } },
          plan: planWith(modified()),
        })
        const section = await screen.findByRole('region', { name: 'How did it go?' })
        expect(await within(section).findByText(FEEL_ASK)).toBeInTheDocument()
      })

      test('has no note once a feel is stored', async () => {
        const base = makeDetail()
        const api = renderDetail({
          detail: { ...base, activity: { ...base.activity, rpe: null, feel: 0 } },
          plan: planWith(modified({ feel: 0 })),
        })
        const section = await screen.findByRole('region', { name: 'How did it go?' })
        await waitFor(() => {
          expect(api.calls.some((c) => c.url === '/api/plan')).toBe(true)
        })
        await settle()
        expect(within(section).queryByText(FEEL_ASK)).not.toBeInTheDocument()
        expect(within(section).queryByText(RATING_ASK)).not.toBeInTheDocument()
      })
    })

    test('has no note when the activity is not linked to an assessed session', async () => {
      const api = renderDetail({ plan: planWith(null) })
      const section = await screen.findByRole('region', { name: 'How did it go?' })
      await waitFor(() => {
        expect(api.calls.some((c) => c.url === '/api/plan')).toBe(true)
      })
      await settle()
      expect(within(section).queryByText(RATING_ASK)).not.toBeInTheDocument()
    })

    test('has no note when only another activity fulfils an assessed session', async () => {
      const api = renderDetail({ plan: planWith(makeExecution(1), 'other') })
      const section = await screen.findByRole('region', { name: 'How did it go?' })
      await waitFor(() => {
        expect(api.calls.some((c) => c.url === '/api/plan')).toBe(true)
      })
      await settle()
      expect(within(section).queryByText(RATING_ASK)).not.toBeInTheDocument()
    })

    test('the note goes away once a rating is saved, and returns when it is cleared', async () => {
      const user = userEvent.setup()
      const base = makeDetail()
      let stored = { rpe: null as number | null, feel: null as number | null }
      mockApi({
        'GET /api/settings': () => ({
          email: 'runner@example.com',
          displayName: null,
          units: 'mi',
        }),
        'GET /api/activities/a1/detail': () => ({
          ...base,
          activity: { ...base.activity, ...stored },
        }),
        'GET /api/plan': () => planWith(makeExecution(-1)),
        'PATCH /api/activities/a1/feedback': (req) => {
          const body = req.body as { rpe: number | null; feel: number | null }
          stored = { rpe: body.rpe, feel: body.feel }
          return {}
        },
      })
      renderWithProviders(
        <ToastProvider>
          <Routes>
            <Route path="/activities/:id" element={<ActivityDetailPage />} />
          </Routes>
        </ToastProvider>,
        { route: '/activities/a1' },
      )
      const region = () => screen.getByRole('region', { name: 'How did it go?' })
      expect(
        await within(await screen.findByRole('region', { name: 'How did it go?' })).findByText(
          RATING_ASK,
        ),
      ).toBeInTheDocument()

      await user.click(within(region()).getByRole('button', { name: 'RPE 4' }))
      await user.click(within(region()).getByRole('button', { name: 'Save' }))
      await waitFor(() => {
        expect(within(region()).queryByText(RATING_ASK)).not.toBeInTheDocument()
      })
      expect(within(region()).getByRole('button', { name: 'RPE 4' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )

      await user.click(within(region()).getByRole('button', { name: 'RPE 4' }))
      await user.click(within(region()).getByRole('button', { name: 'Save' }))
      expect(await within(region()).findByText(RATING_ASK)).toBeInTheDocument()
    })
  })

  test('Edit opens the activity form', async () => {
    const user = userEvent.setup()
    renderDetail()
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('dialog', { name: 'Edit activity' })).toBeInTheDocument()
  })

  test('Delete asks first, then returns to the list', async () => {
    const user = userEvent.setup()
    const api = renderDetail({ routes: { 'DELETE /api/activities/a1': () => undefined } })
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Delete activity' }))
    expect(await screen.findByText('Activities list')).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  test('an unknown activity says so and links back', async () => {
    mockApi({
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'mi' }),
      'GET /api/activities/a1/detail': () => ({
        status: 404,
        body: { error: { code: 'not_found', message: 'Activity not found.' } },
      }),
    })
    renderWithProviders(
      <Routes>
        <Route path="/activities/:id" element={<ActivityDetailPage />} />
      </Routes>,
      { route: '/activities/a1' },
    )
    expect(await screen.findByText('This activity was not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All activities' })).toHaveAttribute(
      'href',
      '/activities',
    )
  })
})

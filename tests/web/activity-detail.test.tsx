import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { stepNote } from '../../shared/engine/fuelCopy.ts'
import type { ExecutionAssessment } from '../../shared/engine/types.ts'
import { fromGrams } from '../../shared/domain/weight.ts'
import type {
  ActivityDetail,
  Feel,
  FuelLogView,
  PlanWithSessions,
  StrengthLog,
  Units,
  UserSettings,
} from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ActivityDetailPage } from '../../web/pages/ActivityDetailPage.tsx'
import { makeActivity } from '../factories.ts'
import { loggedRun, logOf, makeLab, saved } from './fuel-fixtures.ts'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { makeSession, makeV2Plan } from './plan-fixtures.ts'
import {
  DAY,
  SETTINGS as STRENGTH_USER_SETTINGS,
  dayRoute,
  lb,
  makeLog,
  makeView,
  makeWorkout,
  savedLog,
  set,
} from './strength-fixtures.ts'

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
    'GET /api/activities/a1/standout': () => ({ items: [], more: 0 }),
    'GET /api/plan': () => opts.plan ?? null,
    'GET /api/strength': () => makeView(),
    'GET /api/strength/logs': () => [],
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
    // The charts load as their own chunk, so each is waited for.
    expect(await screen.findByRole('img', { name: /^Pace, average/ })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /^Heart rate, average/ })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /^Elevation, from/ })).toBeInTheDocument()
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

  test('What stood out sits above How did it go? on a run', async () => {
    renderDetail({
      routes: {
        'GET /api/activities/a1/standout': () => ({
          items: [
            {
              id: 'design-explain.grade',
              template: 'standout.grade',
              slots: {
                gain: { kind: 'climb', m: 400 },
                distance: { kind: 'distance', m: 8000 },
                grade: { kind: 'percent', pct: 5 },
              },
              rule: 'design-explain',
              sources: [],
              moreSources: 0,
              state: 'used',
            },
          ],
          more: 0,
        }),
      },
    })
    const standout = await screen.findByRole('region', { name: 'What stood out' })
    expect(
      await within(standout).findByText(
        'This run climbed 1312 ft over 5 mi, an average grade of 5%.',
      ),
    ).toBeInTheDocument()
    const feedback = screen.getByRole('region', { name: 'How did it go?' })
    expect(
      standout.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  test('a strength activity has no What stood out', async () => {
    const strength = makeDetail()
    renderDetail({
      detail: { ...strength, activity: { ...strength.activity, type: 'strength' } },
    })
    await screen.findByRole('region', { name: 'How did it go?' })
    expect(screen.queryByRole('region', { name: 'What stood out' })).not.toBeInTheDocument()
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
      'GET /api/activities/a1/standout': () => ({ items: [], more: 0 }),
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
        'GET /api/activities/a1/standout': () => ({ items: [], more: 0 }),
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

describe('ActivityDetailPage: the Fuel section', () => {
  const longRun = (over: Parameters<typeof makeActivity>[0] = {}) =>
    makeDetail({
      activity: makeActivity({
        id: 'a1',
        date: '2026-03-02',
        durationSec: 3 * 3600,
        distanceM: 30000,
        tempC: 12,
        humidityPct: 60,
        windKph: 5,
        ...over,
      }),
    })
  const runs = [loggedRun(1, { servings: 6, gut: 1, nausea: 0, activityId: 'a1' })]

  test('is not there for a short run, and nothing asks for a log', async () => {
    const short = renderDetail()
    await screen.findByRole('heading', { level: 1, name: 'Run' })
    expect(screen.queryByRole('region', { name: 'Fuel' })).not.toBeInTheDocument()
    expect(short.calls.some((call) => call.url.startsWith('/api/fuel'))).toBe(false)
  })

  test('is not there for a long activity that is not a run', async () => {
    const api = renderDetail({ detail: longRun({ type: 'strength' }) })
    await screen.findByRole('heading', { level: 1, name: 'Strength' })
    expect(screen.queryByRole('region', { name: 'Fuel' })).not.toBeInTheDocument()
    expect(api.calls.some((call) => call.url.startsWith('/api/fuel'))).toBe(false)
  })

  test('a long run without a log says so and offers Log fuel, which opens the form', async () => {
    const user = userEvent.setup()
    renderDetail({
      detail: longRun(),
      routes: { 'GET /api/fuel/logs/a1': () => null, 'GET /api/fuel': () => makeLab() },
    })
    const section = await screen.findByRole('region', { name: 'Fuel' })
    expect(await within(section).findByText('No fuel log for this run yet.')).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Log fuel' }))
    const sheet = await screen.findByRole('dialog', { name: 'Fuel log' })
    expect(await within(sheet).findByRole('button', { name: 'Save fuel log' })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Fuel log' })).not.toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Log fuel' })).toHaveFocus()
  })

  test('shows what was logged, the total against the target, the scores and whether it counted', async () => {
    renderDetail({
      detail: longRun(),
      routes: {
        'GET /api/fuel/logs/a1': () => logOf(runs, 'a1'),
        'GET /api/fuel': () => makeLab(runs),
      },
    })
    const section = await screen.findByRole('region', { name: 'Fuel' })
    expect(await within(section).findByText('6 × Example gel')).toBeInTheDocument()
    expect(
      within(section).getByText(
        'You took 150 g of carbohydrate in 3 h: 50 g/h. Target was 30 to 50 g/h.',
      ),
    ).toBeInTheDocument()
    expect(within(section).getByText('Mild, 1 of 4')).toBeInTheDocument()
    expect(within(section).getByText('None, 0 of 4')).toBeInTheDocument()
    expect(within(section).getByText('Counted toward your ladder.')).toBeInTheDocument()
    expect(within(section).getByText(stepNote(logOf(runs, 'a1').step))).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Edit fuel log' })).toBeInTheDocument()
    expectCleanCopy(section)
  })

  test('a run marked "not this time" shows the reason and still offers Log fuel', async () => {
    const skipped = loggedRun(1, { activityId: 'a1' })
    skipped.log.skipped = true
    renderDetail({
      detail: longRun(),
      routes: { 'GET /api/fuel/logs/a1': () => logOf([skipped], 'a1') },
    })
    const section = await screen.findByRole('region', { name: 'Fuel' })
    expect(
      await within(section).findByText(
        'Not logged this time, so this run does not count toward your ladder.',
      ),
    ).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Log fuel' })).toBeInTheDocument()
  })

  test('says the log did not load, in an alert, and offers no button', async () => {
    renderDetail({
      detail: longRun(),
      routes: {
        'GET /api/fuel/logs/a1': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'No.' } },
        }),
      },
    })
    const section = await screen.findByRole('region', { name: 'Fuel' })
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'The fuel log did not load. Reload the page to try again.',
    )
    expect(within(section).queryByRole('button')).not.toBeInTheDocument()
  })

  test('editing the log saves it, closes the sheet, reads the log again and keeps focus on the button', async () => {
    const user = userEvent.setup()
    let current: FuelLogView | null = logOf(runs, 'a1')
    const better = [loggedRun(1, { servings: 6, gut: 0, nausea: 0, activityId: 'a1' })]
    const api = renderDetail({
      detail: longRun(),
      routes: {
        'GET /api/fuel/logs/a1': () => current,
        'GET /api/fuel': () => makeLab(runs),
        'PUT /api/fuel/logs/a1': () => {
          current = logOf(better, 'a1')
          return saved(better, 'a1')
        },
      },
    })
    const section = await screen.findByRole('region', { name: 'Fuel' })
    await user.click(await within(section).findByRole('button', { name: 'Edit fuel log' }))
    const sheet = await screen.findByRole('dialog', { name: 'Fuel log' })
    await user.click(
      within(within(sheet).getByRole('radiogroup', { name: 'Gut' })).getByRole('radio', {
        name: '0 None',
      }),
    )
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Fuel log' })).not.toBeInTheDocument()
    })
    expect(api.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
    expect(await within(section).findByText('Counted toward your ladder.')).toBeInTheDocument()
    expect(within(section).queryByText('Mild, 1 of 4')).not.toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Edit fuel log' })).toHaveFocus()
  })
})

// ---- The sets of a strength activity (strength design 11.4) -----------------------------------

describe('ActivityDetailPage: a strength activity', () => {
  const LOG_ID = '3f2b7c1e-8d4a-4f6b-9a31-5c0e2d7b6a10'
  const strengthDetail = (): ActivityDetail =>
    makeDetail({
      activity: makeActivity({
        id: 'a1',
        date: DAY,
        type: 'strength',
        startTime: null,
        durationSec: 2400,
        distanceM: null,
        source: 'manual',
      }),
      stream: null,
      laps: null,
      hasFile: false,
    })
  /** Three sets of the squat, two of the deadlift, a calf raise with nothing added, a plank hold. */
  const sets = [
    set('back-squat', 0, 105, 5, 2),
    set('back-squat', 1, 105, 5, 2),
    set('back-squat', 2, 105, 4, 1),
    set('dumbbell-rdl', 3, 35, 6, null),
    set('dumbbell-rdl', 4, 35, 6, null),
    set('standing-calf-raise', 5, null, 12, 3),
    set('side-plank', 6, null, 30, null),
  ]
  const logged = (over: Partial<StrengthLog> = {}): StrengthLog => ({
    ...makeLog(LOG_ID, DAY, sets),
    activityId: 'a1',
    ...over,
  })
  const sectionOf = () => screen.findByRole('region', { name: 'Sets' })
  const rowsOf = (table: HTMLElement) =>
    within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent))

  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  test('shows its sets as a labelled table: exercise, set, load in the runner’s unit, reps and reps left', async () => {
    renderDetail({
      detail: strengthDetail(),
      routes: { 'GET /api/strength/logs': () => [logged()] },
    })
    const section = await sectionOf()
    const table = await within(section).findByRole('table')
    expect(
      within(within(section).getByRole('region', { name: 'Sets of this session' })).getByRole(
        'table',
      ),
    ).toBe(table)
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Exercise', 'Set', 'Load', 'Reps', 'Reps left'])
    expect(rowsOf(table)).toEqual([
      ['Back squat', '1', '105 lb', '5', '2'],
      ['Back squat', '2', '105 lb', '5', '2'],
      ['Back squat', '3', '105 lb', '4', '1'],
      ['Dumbbell Romanian deadlift', '1', '35 lb', '6', 'Not recorded'],
      ['Dumbbell Romanian deadlift', '2', '35 lb', '6', 'Not recorded'],
      ['Standing calf raise', '1', 'No added load', '12', '3'],
      ['Side plank', '1', 'No added load', '30 seconds', 'Not recorded'],
    ])
    expect(within(section).getByRole('button', { name: 'Edit sets' })).toBeVisible()
    expect(within(section).queryByRole('button', { name: 'Add the sets' })).not.toBeInTheDocument()
    expectCleanCopy(section)
  })

  test('shows the loads in kilograms for a runner who chose them, on the same grams', async () => {
    const kg: UserSettings = { ...STRENGTH_USER_SETTINGS, weightUnit: 'kg', units: 'km' }
    renderDetail({
      detail: strengthDetail(),
      units: 'km',
      routes: {
        'GET /api/settings': () => kg,
        'GET /api/strength/logs': () => [logged()],
      },
    })
    const table = await within(await sectionOf()).findByRole('table')
    expect(rowsOf(table)[0]?.[2]).toBe(`${String(fromGrams(lb(105), 'kg'))} kg`)
  })

  test('"Edit sets" opens the sheet on the log as it was saved, and saving it replaces the sets', async () => {
    const user = userEvent.setup()
    let current = logged()
    const api = renderDetail({
      detail: strengthDetail(),
      routes: {
        'GET /api/strength/logs': () => [current],
        [`PUT /api/strength/logs/${LOG_ID}`]: ({ body }) => {
          const sent = body as { sets: Array<{ exerciseId: string; count: number }> }
          current = {
            ...current,
            sets: current.sets.map((s, i) => ({ ...s, count: sent.sets[i]?.count ?? s.count })),
          }
          return { ...savedLog(LOG_ID), log: current }
        },
      },
    })
    const section = await sectionOf()
    await user.click(await within(section).findByRole('button', { name: 'Edit sets' }))
    const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
    // the sets as they were logged, with the rules' own steps for the saved equipment
    const reps = await within(dialog).findByRole('textbox', { name: 'Back squat, set 3, reps' })
    expect(reps).toHaveValue('4')
    await user.click(
      within(within(dialog).getByRole('group', { name: 'Back squat, set 3, reps' })).getByRole(
        'button',
        { name: /^Raise the reps by/ },
      ),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
    })
    const put = api.calls.find((call) => call.method === 'PUT')
    expect(put?.url).toBe(`/api/strength/logs/${LOG_ID}`)
    expect(put?.body).toMatchObject({ date: DAY, activityId: 'a1' })
    expect(put?.body).not.toHaveProperty('sessionId')
    // and the table reads again
    await waitFor(() => {
      expect(rowsOf(within(section).getByRole('table'))[2]?.[3]).toBe('5')
    })
  })

  test('says so when the activity has no sets, and "Add the sets" starts from the next planned session', async () => {
    const user = userEvent.setup()
    let current: StrengthLog | null = null
    const ahead = makeWorkout({ sessionId: 's9z', date: '2026-03-20' })
    const api = renderDetail({
      detail: strengthDetail(),
      routes: {
        'GET /api/strength/logs': () => (current === null ? [] : [current]),
        'GET /api/strength/workout': dayRoute(ahead, 'next-planned'),
        [`PUT /api/strength/logs/${LOG_ID}`]: () => {
          current = logged()
          return { ...savedLog(LOG_ID), log: current }
        },
      },
    })
    const section = await sectionOf()
    expect(await within(section).findByText('No sets are logged for this session.')).toBeVisible()
    expect(within(section).queryByRole('table')).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Edit sets' })).not.toBeInTheDocument()
    expectCleanCopy(section)

    // an import brought no sets: the sheet starts from the day's own start, off the plan
    vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
    await user.click(within(section).getByRole('button', { name: 'Add the sets' }))
    const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
    expect(await within(dialog).findByText('From the next planned session.')).toBeVisible()
    expect(
      api.calls.filter((call) => call.url.startsWith('/api/strength/workout')).map((c) => c.url),
    ).toEqual([`/api/strength/workout?date=${DAY}`])
    await user.click(within(dialog).getByRole('button', { name: 'As suggested' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
    })
    // the sets attach to this activity, on its own day, and link no other session
    const put = api.calls.find((call) => call.method === 'PUT')
    expect(put?.body).toMatchObject({ date: DAY, activityId: 'a1' })
    expect(put?.body).not.toHaveProperty('sessionId')
    expect(await within(section).findByRole('table')).toBeVisible()
    expect(within(section).getByRole('button', { name: 'Edit sets' })).toBeVisible()
  })

  test('"Add the sets" starts from the session the activity is linked to, which is the day’s own workout', async () => {
    const user = userEvent.setup()
    const session = makeSession({
      id: 's1',
      kind: 'strength',
      title: 'Strength',
      date: DAY,
      weekStart: '2026-03-16',
      status: 'completed',
      activityId: 'a1',
      execution: null,
    })
    const api = renderDetail({
      detail: strengthDetail(),
      plan: makeV2Plan({ sessions: [session] }),
      routes: {
        'GET /api/strength/workout': dayRoute(makeWorkout({ sessionId: 's1', date: DAY })),
      },
    })
    const section = await sectionOf()
    // the plan has to be in before the button knows the session
    await waitFor(() => {
      expect(api.calls.some((call) => call.url === '/api/plan')).toBe(true)
    })
    await settle()
    await user.click(await within(section).findByRole('button', { name: 'Add the sets' }))
    const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
    expect(
      api.calls.filter((call) => call.url.startsWith('/api/strength/workout')).map((c) => c.url),
    ).toEqual([`/api/strength/workout?date=${DAY}&sessionId=s1`])
    // the workout is the session’s own, so the header names no other session
    expect(within(dialog).queryByText(/^From /)).not.toBeInTheDocument()
    expect(within(dialog).getByText(`Wed 18 Mar. Loads are in pounds.`)).toBeVisible()
  })

  test('says so when the sets did not load, and reads them again on request', async () => {
    const user = userEvent.setup()
    let connected = false
    renderDetail({
      detail: strengthDetail(),
      routes: {
        'GET /api/strength/logs': () =>
          connected
            ? [logged()]
            : { status: 503, body: { error: { code: 'internal', message: 'No connection.' } } },
      },
    })
    const section = await sectionOf()
    expect(await within(section).findByRole('alert')).toHaveTextContent('The sets did not load.')
    connected = true
    await user.click(within(section).getByRole('button', { name: 'Try again' }))
    expect(await within(section).findByRole('table')).toBeVisible()
  })

  test('is not on the page of any other kind of activity, which asks nothing about sets', async () => {
    const api = renderDetail()
    await screen.findByRole('region', { name: 'How did it go?' })
    expect(screen.queryByRole('region', { name: 'Sets' })).not.toBeInTheDocument()
    expect(api.calls.some((call) => call.url.startsWith('/api/strength'))).toBe(false)
  })

  test('keeps the buttons at 44 px and the table inside 360 px: the exercise wraps instead of scrolling', () => {
    const css = readFileSync(
      join(process.cwd(), 'web/components/strength/ActivitySets.module.css'),
      'utf8',
    )
    expect(css).toMatch(/\.exercise \{[^}]*overflow-wrap: anywhere;/s)
    expect(css).not.toMatch(/white-space: nowrap/)
    expect(css).not.toMatch(/min-width: \d/)
    const button = readFileSync(join(process.cwd(), 'web/components/Button.module.css'), 'utf8')
    expect(button).toMatch(/min-height: var\(--control-h\)/)
  })
})

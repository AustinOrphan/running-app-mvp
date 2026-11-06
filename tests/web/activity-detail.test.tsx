import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { QueryClient } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { EXECUTION_TEMPLATES } from '../../shared/copy/execution.ts'
import { render } from '../../shared/copy/template.ts'
import { stepNote } from '../../shared/engine/fuelCopy.ts'
import type { ExecutionAssessment } from '../../shared/engine/types.ts'
import { fromGrams } from '../../shared/domain/weight.ts'
import type {
  ActivityDetail,
  Feel,
  FuelLogView,
  PlanSessionView,
  PlanWithSessions,
  StrengthLog,
  Units,
  UserSettings,
} from '../../shared/types.ts'
import { keys } from '../../web/api/client.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ActivityDetailPage } from '../../web/pages/ActivityDetailPage.tsx'
import { makeActivity } from '../factories.ts'
import { loggedRun, logOf, makeLab, saved } from './fuel-fixtures.ts'
import {
  delayResponses,
  expectCleanCopy,
  expectTouchScale,
  makeTestQueryClient,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
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
    /** A client the test has put something in before the page mounts. */
    queryClient?: QueryClient
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
    {
      route: '/activities/a1',
      ...(opts.queryClient === undefined ? {} : { queryClient: opts.queryClient }),
    },
  )
  return api
}

/** What stood out on the run: one climb, so the section has a sentence to show. */
const GRADE_STANDOUT_VIEW = {
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
}

/** The `<dt>` of a labelled figure inside a region (a term takes no name from its content). */
function termOf(region: HTMLElement, label: string): HTMLElement | undefined {
  return within(region)
    .queryAllByRole('term')
    .find((term) => term.textContent === label)
}

/** The value text of a labelled figure (a `<dt>` and its `<dd>`) inside a region. */
function figureOf(region: HTMLElement, label: string): string | null {
  return termOf(region, label)?.nextElementSibling?.textContent ?? null
}

describe('ActivityDetailPage', () => {
  test('summary shows the type, date, time, distance and pace', async () => {
    renderDetail()
    expect(await screen.findByRole('heading', { level: 1, name: 'Run' })).toBeInTheDocument()
    expect(screen.getByText('Mon 2 Mar 2026, 07:30')).toBeInTheDocument()
    const summary = screen.getByRole('region', { name: 'Summary' })
    expect(figureOf(summary, 'Distance')).toBe('3.11 mi')
    expect(figureOf(summary, 'Elapsed pace')).toBe('9:39 /mi')
    expect(figureOf(summary, 'Duration')).toBe('30:00')
    expect(figureOf(summary, 'Moving time')).toBe('29:10')
    expect(figureOf(summary, 'Average HR')).toBe('148 bpm')
    expect(figureOf(summary, 'Max HR')).toBe('171 bpm')
    expect(within(summary).getByText('Example Watch · Strava')).toBeInTheDocument()
    expect(figureOf(summary, 'Elevation gain')).toBe('197 ft')
  })

  test('units follow settings', async () => {
    renderDetail({ units: 'km' })
    const summary = await screen.findByRole('region', { name: 'Summary' })
    expect(figureOf(summary, 'Distance')).toBe('5.00 km')
    expect(figureOf(summary, 'Elapsed pace')).toBe('6:00 /km')
    expect(figureOf(summary, 'Moving pace')).toBe('5:50 /km')
    expect(figureOf(summary, 'Elevation gain')).toBe('60 m')
  })

  describe('the summary in three tiers', () => {
    const TERMS = [
      'Duration',
      'Distance',
      'Elapsed pace',
      'Moving pace',
      'Elevation gain',
      'Average HR',
      'Max HR',
      'Moving time',
      'Elevation loss',
      'Cadence',
    ]

    test('duration and distance lead, the readings follow and kind, device and source are one line', async () => {
      const base = makeDetail()
      renderDetail({
        detail: { ...base, activity: { ...base.activity, subtype: 'trail' } },
      })
      const summary = await screen.findByRole('region', { name: 'Summary' })
      const terms = within(summary).getAllByRole('term')
      expect(terms.map((term) => term.textContent)).toEqual(TERMS)
      // tier 1: duration and distance share a list, apart from the readings
      const lead = terms[0]?.closest('dl')
      expect(terms[1]?.closest('dl')).toBe(lead)
      // tier 2: the readings share the next list
      const readings = terms[2]?.closest('dl')
      expect(readings).not.toBe(lead)
      for (const term of terms.slice(2)) expect(term.closest('dl')).toBe(readings)
      // tier 3: one muted line, in no list, and the labels Kind and Source are not figures
      expect(within(summary).getByText('Trail · Example Watch · Strava')).toBeInTheDocument()
      expect(termOf(summary, 'Kind')).toBeUndefined()
      expect(termOf(summary, 'Source')).toBeUndefined()
    })

    test('the distance carries its unit beside the value, set apart from it', async () => {
      renderDetail()
      const summary = await screen.findByRole('region', { name: 'Summary' })
      const distance = termOf(summary, 'Distance')?.nextElementSibling ?? null
      expect(distance).not.toBeNull()
      expect(within(distance as HTMLElement).getByText('3.11')).toBeInTheDocument()
      expect(within(distance as HTMLElement).getByText('mi')).toBeInTheDocument()
      // the words read as one figure ("3.11 mi"), with the space in the text
      expect(distance?.textContent).toBe('3.11 mi')
    })

    test('a hand-entered run names its source on the muted line and leaves out what it lacks', async () => {
      renderDetail({
        detail: makeDetail({
          activity: makeActivity({ id: 'a1', durationSec: 2700, distanceM: 8000 }),
          stream: null,
          laps: null,
          hasFile: false,
        }),
      })
      const summary = await screen.findByRole('region', { name: 'Summary' })
      expect(
        within(summary)
          .getAllByRole('term')
          .map((t) => t.textContent),
      ).toEqual(['Duration', 'Distance', 'Pace'])
      expect(within(summary).getByText('Entered by hand')).toBeInTheDocument()
    })

    describe('which pace is which', () => {
      const withMoving = (movingSec: number | null) => {
        const base = makeDetail()
        return { ...base, activity: { ...base.activity, movingSec } }
      }

      test('with a moving pace beside it, the first is the elapsed pace and the second the moving pace', async () => {
        renderDetail({ detail: withMoving(1750) })
        const summary = await screen.findByRole('region', { name: 'Summary' })
        // the figure that leads is still the elapsed one, from the duration
        expect(figureOf(summary, 'Elapsed pace')).toBe('9:39 /mi')
        expect(figureOf(summary, 'Moving pace')).toBe('9:23 /mi')
        expect(termOf(summary, 'Pace')).toBeUndefined()
        // the two paces stand side by side in the readings
        const labels = within(summary)
          .getAllByRole('term')
          .map((term) => term.textContent)
        expect(labels.indexOf('Moving pace')).toBe(labels.indexOf('Elapsed pace') + 1)
      })

      test('with no moving time there is one pace, and it is "Pace"', async () => {
        renderDetail({ detail: withMoving(null) })
        const summary = await screen.findByRole('region', { name: 'Summary' })
        expect(figureOf(summary, 'Pace')).toBe('9:39 /mi')
        expect(termOf(summary, 'Elapsed pace')).toBeUndefined()
        expect(termOf(summary, 'Moving pace')).toBeUndefined()
        expect(termOf(summary, 'Moving time')).toBeUndefined()
      })

      test('a moving time within a second of the elapsed time is the same time: one pace, "Pace"', async () => {
        renderDetail({ detail: withMoving(1800) })
        const summary = await screen.findByRole('region', { name: 'Summary' })
        expect(figureOf(summary, 'Pace')).toBe('9:39 /mi')
        expect(termOf(summary, 'Elapsed pace')).toBeUndefined()
        expect(termOf(summary, 'Moving pace')).toBeUndefined()
      })

      test('an activity with no pace gets neither label', async () => {
        const base = makeDetail()
        renderDetail({
          detail: {
            ...base,
            activity: { ...base.activity, type: 'cross', movingSec: 1750 },
          },
        })
        const summary = await screen.findByRole('region', { name: 'Summary' })
        expect(termOf(summary, 'Pace')).toBeUndefined()
        expect(termOf(summary, 'Elapsed pace')).toBeUndefined()
        expect(termOf(summary, 'Moving pace')).toBeUndefined()
        expect(termOf(summary, 'Moving time')).toBeDefined()
      })
    })

    test('the type steps are the tokens: xl for the lead figures, 22 px for readings, 15 px for the line', () => {
      const figure = readFileSync(join(process.cwd(), 'web/components/Figure.module.css'), 'utf8')
      expect(figure).toMatch(/\.value \{[^}]*font-size: var\(--text-xl\);/s)
      expect(figure).toMatch(
        /\.unit \{[^}]*color: var\(--text-muted\);[^}]*font-size: var\(--text-lg\);/s,
      )
      // the hero's display step is not borrowed
      expect(figure).not.toMatch(/font-size: var\(--text-display/)
      const page = readFileSync(
        join(process.cwd(), 'web/pages/ActivityDetailPage.module.css'),
        'utf8',
      )
      expect(page).toMatch(/\.figure dd \{[^}]*font-size: var\(--text-lg\);/s)
      expect(page).toMatch(/\.note,\n\.muted \{[^}]*font-size: var\(--text-sm\);/s)
      expect(page).not.toMatch(/font-size: var\(--text-display/)
    })
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

  test('no stream means no Charts section at all, and no line saying so', async () => {
    renderDetail({ detail: makeDetail({ stream: null, laps: null, hasFile: false }) })
    await screen.findByRole('heading', { level: 1, name: 'Run' })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Charts' })).not.toBeInTheDocument()
    expect(screen.queryByText(/No chart data/)).not.toBeInTheDocument()
  })

  test('a stream with nothing to draw gets no Charts section either', async () => {
    const detail = makeDetail()
    renderDetail({
      detail: {
        ...detail,
        stream: detail.stream && { ...detail.stream, d: null, hr: null, alt: null },
      },
    })
    await screen.findByRole('heading', { level: 1, name: 'Run' })
    expect(screen.queryByRole('region', { name: 'Charts' })).not.toBeInTheDocument()
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
    expect(screen.getByText('Example Watch · Strava')).toBeInTheDocument()
  })

  test('no download link when there is no file', async () => {
    renderDetail({ detail: makeDetail({ hasFile: false }) })
    await screen.findByRole('heading', { level: 1, name: 'Run' })
    expect(screen.queryByRole('link', { name: 'Download original file' })).not.toBeInTheDocument()
  })

  test('How did it go? sits above What stood out on a run', async () => {
    renderDetail({ routes: { 'GET /api/activities/a1/standout': () => GRADE_STANDOUT_VIEW } })
    const standout = await screen.findByRole('region', { name: 'What stood out' })
    expect(
      await within(standout).findByText(
        'This run climbed 1312 ft over 5 mi, an average grade of 5%.',
      ),
    ).toBeInTheDocument()
    const feedback = screen.getByRole('region', { name: 'How did it go?' })
    expect(
      feedback.compareDocumentPosition(standout) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  test('nothing unusual on a run leaves out What stood out, and nothing stands in while it loads', async () => {
    const api = renderDetail()
    await screen.findByRole('region', { name: 'How did it go?' })
    await waitFor(() => {
      expect(api.calls.some((c) => c.url === '/api/activities/a1/standout')).toBe(true)
    })
    await settle()
    expect(screen.queryByRole('region', { name: 'What stood out' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Nothing unusual/)).not.toBeInTheDocument()
  })

  test('a failed load of What stood out keeps the section, with its plain line', async () => {
    renderDetail({
      routes: {
        'GET /api/activities/a1/standout': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'No.' } },
        }),
      },
    })
    const standout = await screen.findByRole('region', { name: 'What stood out' })
    expect(
      within(standout).getByText(
        'What stood out could not be loaded. Reload the page to try again.',
      ),
    ).toBeInTheDocument()
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

  test('feedback sets RPE and pain as touch scales: 5 and 5, and 6 and 5', async () => {
    renderDetail({})
    const section = await screen.findByRole('region', { name: 'How did it go?' })
    expectTouchScale(within(section).getByRole('group', { name: 'RPE' }), {
      steps: 10,
      columns: 5,
    })
    expectTouchScale(within(section).getByRole('group', { name: 'Pain' }), {
      steps: 11,
      columns: 6,
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

// ---- The post-run screen: the result against the plan, then the rating, then the recording -----

describe('ActivityDetailPage: against the plan', () => {
  const sentence = (id: keyof typeof EXECUTION_TEMPLATES, slots: Record<string, unknown> = {}) =>
    render(EXECUTION_TEMPLATES[id], slots as never, 'km')
  const PLANNED = '30 min against 55 min planned (55%).'
  const ON_TARGET = sentence('execution.intensity-on')
  const GUESSED = sentence('execution.effort-harder')
  // the fixture session's expected RPE is 6 to 7 (middle 6.5)
  const quoted = (rpe: number) =>
    sentence('execution.effort-harder-rpe', {
      rpe: { kind: 'count', n: rpe },
      low: { kind: 'count', n: 6 },
      high: { kind: 'count', n: 7 },
    })
  const RATED = quoted(8)
  const withLines = (
    lines: string[],
    parts: Partial<ExecutionAssessment['effort']['parts']> = {},
    over: Partial<ExecutionAssessment> = {},
  ): ExecutionAssessment => ({ ...makeExecution(1, parts), ...over, lines })
  const block = () => screen.findByRole('region', { name: 'Against the plan' })
  const linkedPlan = (execution: ExecutionAssessment | null, over: Partial<PlanSessionView> = {}) =>
    makeV2Plan({
      sessions: [
        makeSession({
          id: 's1',
          status: 'completed',
          activityId: 'a1',
          title: 'Long run',
          durationMin: 175,
          execution,
          ...over,
        }),
      ],
    })
  const rated = (rpe: number | null, feel: Feel | null = null) => {
    const base = makeDetail()
    return { ...base, activity: { ...base.activity, rpe, feel } }
  }

  test('a run that filled a session says what was planned and what was run, then the assessment', async () => {
    renderDetail({ plan: linkedPlan(withLines([PLANNED, ON_TARGET])) })
    const section = await block()
    expect(await within(section).findByText(PLANNED)).toBeInTheDocument()
    expect(
      within(section).getByText('Planned: Long run, 2 h 55 min. Ran: 30 min, 3.1 mi.'),
    ).toBeInTheDocument()
    expect(within(section).getByText(ON_TARGET)).toBeInTheDocument()
    // the context line comes first, and the page's own sentences state no grade
    const lines = within(section)
      .getAllByText(/./)
      .filter((node) => node.tagName === 'P')
      .map((node) => node.textContent)
    expect(lines).toEqual([
      'Planned: Long run, 2 h 55 min. Ran: 30 min, 3.1 mi.',
      PLANNED,
      ON_TARGET,
    ])
    expectCleanCopy(section)
  })

  test('the figures read in kilometres for a runner who chose them', async () => {
    renderDetail({ plan: linkedPlan(withLines([PLANNED])), units: 'km' })
    const section = await block()
    expect(
      await within(section).findByText('Planned: Long run, 2 h 55 min. Ran: 30 min, 5 km.'),
    ).toBeInTheDocument()
  })

  test('a rated run shows the effort line with the rating in it', async () => {
    renderDetail({
      detail: rated(8),
      plan: linkedPlan(withLines([PLANNED, ON_TARGET, RATED], { rpeDelta: 1.5 })),
    })
    const section = await block()
    expect(await within(section).findByText(RATED)).toBeInTheDocument()
    expect(within(section).getByText(ON_TARGET)).toBeInTheDocument()
  })

  test('a feel counts as a rating too', async () => {
    renderDetail({
      detail: rated(null, 1),
      plan: linkedPlan(withLines([PLANNED, GUESSED], { feel: 1 })),
    })
    expect(await within(await block()).findByText(GUESSED)).toBeInTheDocument()
  })

  test('a harder verdict beside an RPE inside the expected band is left out: the pace tipped it', async () => {
    renderDetail({
      detail: rated(6),
      plan: linkedPlan(withLines([PLANNED, ON_TARGET, quoted(6)], { rpeDelta: -0.5 })),
    })
    const section = await block()
    expect(await within(section).findByText(PLANNED)).toBeInTheDocument()
    expect(within(section).getByText(ON_TARGET)).toBeInTheDocument()
    expect(section.textContent).not.toMatch(/Effort/)
  })

  test('a harder verdict beside a feel of "as expected" is left out', async () => {
    renderDetail({
      detail: rated(null, 0),
      plan: linkedPlan(withLines([PLANNED, GUESSED], { feel: 0 })),
    })
    const section = await block()
    expect(await within(section).findByText(PLANNED)).toBeInTheDocument()
    expect(within(section).queryByText(GUESSED)).not.toBeInTheDocument()
  })

  test('an RPE above the band shows the verdict, quoting the rating', async () => {
    renderDetail({
      detail: rated(9),
      plan: linkedPlan(withLines([PLANNED, quoted(9)], { rpeDelta: 2.5 })),
    })
    expect(await within(await block()).findByText(quoted(9))).toBeInTheDocument()
  })

  test('a feel below 0 shows an easier verdict', async () => {
    const easier = sentence('execution.effort-easier')
    renderDetail({
      detail: rated(null, -1),
      plan: linkedPlan(withLines([PLANNED, easier], { feel: -1 }, {})),
    })
    expect(await within(await block()).findByText(easier)).toBeInTheDocument()
  })

  test('a feel above 0 does not carry an RPE inside the band into the sentence', async () => {
    renderDetail({
      detail: rated(6, 1),
      plan: linkedPlan(withLines([PLANNED, quoted(6)], { rpeDelta: -0.5, feel: 1 })),
    })
    const section = await block()
    expect(await within(section).findByText(GUESSED)).toBeInTheDocument()
    expect(within(section).queryByText(quoted(6))).not.toBeInTheDocument()
  })

  test('an unrated run never shows the effort verdict that heart rate and pace inferred', async () => {
    renderDetail({ plan: linkedPlan(withLines([PLANNED, ON_TARGET, GUESSED])) })
    const section = await block()
    expect(await within(section).findByText(PLANNED)).toBeInTheDocument()
    expect(within(section).getByText(ON_TARGET)).toBeInTheDocument()
    expect(within(section).queryByText(GUESSED)).not.toBeInTheDocument()
    expect(section.textContent).not.toMatch(/Effort/)
    // the ask for a rating stays where the rating is, in "How did it go?"
    expect(
      within(screen.getByRole('region', { name: 'How did it go?' })).getByText(RATING_ASK),
    ).toBeInTheDocument()
  })

  test('every guessed effort sentence is left out of an unrated run, the "matched" one too', async () => {
    renderDetail({
      plan: linkedPlan(
        withLines([
          PLANNED,
          sentence('execution.effort-matched'),
          sentence('execution.spike', { days: { kind: 'count', n: 30 } }),
        ]),
      ),
    })
    const section = await block()
    expect(await within(section).findByText(PLANNED)).toBeInTheDocument()
    expect(within(section).queryByText('Effort matched expectation.')).not.toBeInTheDocument()
    // the other sentences of the assessment stay
    expect(within(section).getByText(/^Longer or steeper than the longest run/)).toBeInTheDocument()
  })

  test('an RPE does not rate an activity of a different kind than its session', async () => {
    renderDetail({
      detail: rated(7),
      plan: linkedPlan(
        withLines([PLANNED, GUESSED], { hrResidualZ: 1.4 }, { completion: 'modified' }),
      ),
    })
    const section = await block()
    expect(await within(section).findByText(PLANNED)).toBeInTheDocument()
    expect(within(section).queryByText(GUESSED)).not.toBeInTheDocument()
  })

  test('a session with no assessment yet gives the context line alone', async () => {
    renderDetail({ plan: linkedPlan(null) })
    const section = await block()
    expect(
      await within(section).findByText('Planned: Long run, 2 h 55 min. Ran: 30 min, 3.1 mi.'),
    ).toBeInTheDocument()
    expect(
      within(section)
        .getAllByText(/./)
        .filter((node) => node.tagName === 'P'),
    ).toHaveLength(1)
  })

  test('a run with no distance gives its time alone', async () => {
    const run = makeDetail()
    renderDetail({
      detail: { ...run, activity: { ...run.activity, distanceM: null } },
      plan: linkedPlan(null),
    })
    expect(
      await within(await block()).findByText('Planned: Long run, 2 h 55 min. Ran: 30 min.'),
    ).toBeInTheDocument()
  })

  test('a strength activity says "Did", not "Ran"', async () => {
    const base = makeDetail()
    renderDetail({
      detail: { ...base, activity: { ...base.activity, type: 'strength', distanceM: null } },
      plan: linkedPlan(null, { kind: 'strength', title: 'Strength', durationMin: 40 }),
    })
    expect(
      await within(await block()).findByText('Planned: Strength, 40 min. Did: 30 min.'),
    ).toBeInTheDocument()
  })

  test('a run with no linked session and no plan says that no session was planned', async () => {
    renderDetail({ plan: null })
    const section = await block()
    expect(
      await within(section).findByText('No session was planned for this day.'),
    ).toBeInTheDocument()
    expect(within(section).queryByText(/^Planned:/)).not.toBeInTheDocument()
    expectCleanCopy(section)
  })

  test('a plan with no session on the day says the same, and a rest day is no session', async () => {
    renderDetail({
      plan: makeV2Plan({
        sessions: [
          makeSession({ id: 'rest', date: '2026-03-02', kind: 'rest', title: 'Rest' }),
          makeSession({ id: 'later', date: '2026-03-03', title: 'Easy run' }),
        ],
      }),
    })
    expect(
      await within(await block()).findByText('No session was planned for this day.'),
    ).toBeInTheDocument()
  })

  test('a session on the day that is not this run’s is not called "no session planned"', async () => {
    renderDetail({
      plan: makeV2Plan({
        sessions: [
          makeSession({
            id: 'other',
            date: '2026-03-02',
            activityId: 'someone-else',
            status: 'completed',
          }),
        ],
      }),
    })
    const section = await block()
    expect(
      await within(section).findByText('This activity is not linked to a planned session.'),
    ).toBeInTheDocument()
    expect(
      within(section).queryByText('No session was planned for this day.'),
    ).not.toBeInTheDocument()
  })

  test('waits for the plan that was marked old by a write, and never says "not linked" from the one before it', async () => {
    // a hand-logged run was linked to its session on the server; the plan this client holds is from
    // before, with the session unlinked, and was only marked old (nothing on the list watched it)
    const queryClient = makeTestQueryClient()
    queryClient.setQueryData(
      [keys.plan],
      makeV2Plan({
        sessions: [
          makeSession({ id: 's1', date: '2026-03-02', title: 'Long run', durationMin: 175 }),
        ],
      }),
    )
    await queryClient.invalidateQueries({ queryKey: [keys.plan], refetchType: 'none' })
    const api = renderDetail({ plan: linkedPlan(withLines([PLANNED])), queryClient })
    delayResponses(60)
    const section = await block()
    expect(within(section).queryByText(/not linked/)).not.toBeInTheDocument()
    expect(within(section).queryByText(/No session/)).not.toBeInTheDocument()
    // the plan as the server has it now: the run is linked to the session
    expect(await within(section).findByText(PLANNED)).toBeInTheDocument()
    expect(within(section).queryByText(/not linked/)).not.toBeInTheDocument()
    expect(api.calls.some((call) => call.url === '/api/plan')).toBe(true)
  })

  test('does not hold the block back for the reads that follow, such as the one after a rating is saved', async () => {
    const user = userEvent.setup()
    const api = renderDetail({
      plan: linkedPlan(withLines([PLANNED])),
      routes: { 'PATCH /api/activities/a1/feedback': () => ({}) },
    })
    const section = await block()
    expect(await within(section).findByText(PLANNED)).toBeInTheDocument()
    delayResponses(80)
    await user.click(screen.getByRole('button', { name: 'RPE 7' }))
    await user.click(
      within(screen.getByRole('region', { name: 'How did it go?' })).getByRole('button', {
        name: 'Save',
      }),
    )
    await waitFor(() => {
      expect(api.calls.filter((call) => call.url === '/api/plan').length).toBeGreaterThan(1)
    })
    // the plan is read again, and the block keeps what it says
    expect(screen.getByText(PLANNED)).toBeInTheDocument()
  })

  test('says nothing, and never fails the page, when the plan did not load', async () => {
    const api = renderDetail({
      routes: {
        'GET /api/plan': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'No.' } },
        }),
      },
    })
    await screen.findByRole('region', { name: 'How did it go?' })
    await waitFor(() => {
      expect(api.calls.some((c) => c.url === '/api/plan')).toBe(true)
    })
    await settle()
    expect(screen.queryByRole('region', { name: 'Against the plan' })).not.toBeInTheDocument()
    expect(screen.queryByText(/No session was planned/)).not.toBeInTheDocument()
  })

  test('holds its place, and states no absence, until the plan is read', async () => {
    const api = renderDetail({ plan: linkedPlan(withLines([PLANNED])) })
    delayResponses(40)
    expect(await screen.findByRole('region', { name: 'Against the plan' })).toBeInTheDocument()
    expect(screen.queryByText('No session was planned for this day.')).not.toBeInTheDocument()
    expect(
      screen.queryByText('This activity is not linked to a planned session.'),
    ).not.toBeInTheDocument()
    expect(await screen.findByText(PLANNED)).toBeInTheDocument()
    expect(api.calls.some((c) => c.url === '/api/plan')).toBe(true)
  })

  test('the page reads in the order of the post-run screen', async () => {
    const base = makeDetail()
    const runs = [loggedRun(1, { servings: 6, gut: 1, nausea: 0, activityId: 'a1' })]
    renderDetail({
      detail: {
        ...base,
        activity: {
          ...base.activity,
          durationSec: 3 * 3600,
          distanceM: 30_000,
          notes: 'Easy loop',
        },
      },
      plan: linkedPlan(withLines([PLANNED, ON_TARGET])),
      routes: {
        'GET /api/activities/a1/standout': () => GRADE_STANDOUT_VIEW,
        'GET /api/fuel/logs/a1': () => logOf(runs, 'a1'),
        'GET /api/fuel': () => makeLab(runs),
      },
    })
    await screen.findByRole('region', { name: 'What stood out' })
    await screen.findByRole('region', { name: 'Fuel' })
    await screen.findByText(PLANNED)
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual([
      'Summary',
      'Against the plan',
      'How did it go?',
      'Fuel',
      'Charts',
      'Laps',
      'Weather',
      'Heart rate distribution',
      'What stood out',
      'Notes',
    ])
  })

  test('an empty run reads: summary, against the plan, how did it go, and nothing between or after but what it has', async () => {
    renderDetail({
      detail: makeDetail({ stream: null, laps: null, hasFile: false }),
      plan: null,
    })
    await screen.findByText('No session was planned for this day.')
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings.slice(0, 3)).toEqual(['Summary', 'Against the plan', 'How did it go?'])
    expect(headings).not.toContain('Charts')
    expect(headings).not.toContain('What stood out')
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
      ['Side plank', '1', 'No added load', '30 s', 'Not recorded'],
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
    const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy, session A' })
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
      expect(
        screen.queryByRole('dialog', { name: 'Strength, heavy, session A' }),
      ).not.toBeInTheDocument()
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
    const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy, session A' })
    expect(await within(dialog).findByText('From the next planned session.')).toBeVisible()
    expect(
      api.calls.filter((call) => call.url.startsWith('/api/strength/workout')).map((c) => c.url),
    ).toEqual([`/api/strength/workout?date=${DAY}`])
    await user.click(within(dialog).getByRole('button', { name: 'As suggested' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Strength, heavy, session A' }),
      ).not.toBeInTheDocument()
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
    const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy, session A' })
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

  test('keeps the buttons at 44 px and the table inside 360 px: the exercise wraps between words instead of the table scrolling', () => {
    const css = readFileSync(
      join(process.cwd(), 'web/components/strength/ActivitySets.module.css'),
      'utf8',
    )
    expect(css).toMatch(/\.exercise \{[^}]*overflow-wrap: break-word;/s)
    expect(css).not.toMatch(/white-space: nowrap/)
    expect(css).not.toMatch(/min-width: \d/)
    const button = readFileSync(join(process.cwd(), 'web/components/Button.module.css'), 'utf8')
    expect(button).toMatch(/min-height: var\(--control-h\)/)
  })
})

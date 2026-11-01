import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveTargets } from '../../shared/engine/targets.ts'
import { publishable } from '../../shared/workouts/labels.ts'
import { toWorkoutPlan } from '../../shared/workouts/plan.ts'
import type { WorkoutPlan } from '../../shared/workouts/types.ts'
import type {
  PlanSession,
  PlanSessionView,
  StrengthWorkout,
  TodayView,
} from '../../shared/types.ts'
import { SessionSheet } from '../../web/components/SessionSheet.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { makeActivity } from '../factories.ts'
import {
  activityPage,
  delayResponses,
  expectCleanCopy,
  explainOf,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import {
  makeBrief,
  makeDiff,
  makeLine,
  makeRevision,
  makeSession,
  settings,
} from './plan-fixtures.ts'
import { prescribed, SESSION_KINDS, zoneSetFixture } from '../unit/engine/fixtures.ts'
import { SESSION_ID, makeView, makeWorkout, savedLog } from './strength-fixtures.ts'
import { makeCoach, makeHero, makeToday } from './today-fixtures.ts'
import { makeWorkoutView, sheetRoutes } from './wrist-fixtures.ts'

vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, explain, open }: { rules: string[]; explain?: unknown; open: boolean }) =>
    open ? (
      <div
        role="complementary"
        aria-label="Why drawer"
        data-explain={JSON.stringify(explain ?? null)}
      >
        {rules.join(',')}
      </div>
    ) : null,
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

const nearby = [
  makeActivity({ id: 'act1', date: '2027-01-13', durationSec: 3300, distanceM: 9100 }),
  makeActivity({ id: 'act2', date: '2027-01-12', durationSec: 1800, distanceM: 5000 }),
]

function renderSheet(session: PlanSessionView, extra: MockRoutes = {}) {
  const onClose = vi.fn()
  const api = mockApi({
    'GET /api/settings': () => settings,
    'GET /api/activities': () => activityPage(nearby),
    ...sheetRoutes([session]),
    ...extra,
  })
  renderWithProviders(
    <ToastProvider>
      <SessionSheet session={session} onClose={onClose} />
    </ToastProvider>,
  )
  return { ...api, onClose }
}

describe('SessionSheet', () => {
  test('shows the prescription: title, date, duration, distance, targets, steps and purpose', async () => {
    renderSheet(makeSession())
    const dialog = await screen.findByRole('dialog', { name: 'Threshold intervals' })
    expect(within(dialog).getByText(/Wed 13 Jan 2027/)).toBeInTheDocument()
    expect(within(dialog).getByText('55 min')).toBeInTheDocument()
    expect(await within(dialog).findByText('9.00 km')).toBeInTheDocument()
    expect(within(dialog).getByText('60 m')).toBeInTheDocument()
    expect(within(dialog).getByText('Zone 3')).toBeInTheDocument()
    expect(await within(dialog).findByText('6 to 7 out of 10')).toBeInTheDocument()
    expect(within(dialog).getByText('158 to 168 bpm')).toBeInTheDocument()
    expect(within(dialog).getByText('5:10 to 5:30 /km')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Warm afternoon: start the work reps by feel.'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Raise the pace you can hold for a long stretch without adding distance.',
      ),
    ).toBeInTheDocument()
    const steps = within(dialog)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    // the words are the workout's: what the watch, the file and the calendar call these steps
    expect(steps).toContain('Warm up 15 min, Zone 1')
    expect(steps).toContain('3 x Threshold 8 min, Zone 3')
    expect(steps).toContain('3 x Recover 2 min, Zone 1')
    expect(steps).toContain('Cool down 10 min, Zone 1')
  })

  test('a hot-day note on a session of another day does not say today', async () => {
    const session = makeSession({ id: 's9', date: '2027-01-16' })
    renderSheet(session, {
      'GET /api/plan/sessions/s9/workout': () =>
        makeWorkoutView(session, { targets: resolveTargets(session, null, { hot: true }) }),
    })
    const dialog = await screen.findByRole('dialog', { name: 'Threshold intervals' })
    expect(await within(dialog).findByText('Go by this when you run it.')).toBeInTheDocument()
    expect(within(dialog).getByText('It runs high in heat.')).toBeInTheDocument()
    expect(within(dialog).queryByText('Go by this today.')).not.toBeInTheDocument()
  })

  test('a single work step is named as the workout names it', async () => {
    renderSheet(
      makeSession({
        structure: [{ kind: 'work', reps: 1, durationSec: 1200, distanceM: null, zone: 'z3' }],
      }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Threshold 20 min, Zone 3')).toBeInTheDocument()
  })

  test('converts distance and pace to miles when the runner uses miles', async () => {
    renderSheet(makeSession(), { 'GET /api/settings': () => ({ ...settings, units: 'mi' }) })
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('5.59 mi')).toBeInTheDocument()
    expect(await within(dialog).findByText('8:19 to 8:51 /mi')).toBeInTheDocument()
    // The climb follows the setting too: 60 m is 197 ft.
    expect(within(dialog).getByText('197 ft')).toBeInTheDocument()
    expect(within(dialog).queryByText('60 m')).not.toBeInTheDocument()
  })

  describe('the distance estimate', () => {
    test('replaces the plan’s distance with "about", naming the easy pace for an easy-paced run', async () => {
      renderSheet(makeSession({ distanceEstimate: { distanceM: 8400, basis: 'easy' } }), {
        'GET /api/settings': () => ({ ...settings, units: 'km' }),
      })
      const dialog = await screen.findByRole('dialog', { name: 'Threshold intervals' })
      expect(await within(dialog).findByText('about 8 km at your easy pace')).toBeInTheDocument()
      // One distance, not two: the plan's own 9.00 km gives way to the estimate.
      expect(within(dialog).queryByText('9.00 km')).not.toBeInTheDocument()
      expect(within(dialog).getByText('Distance').nextElementSibling).toHaveTextContent(
        'about 8 km at your easy pace',
      )
    })

    test('names the recent pace when the recent logged runs stand in for the zones', async () => {
      renderSheet(makeSession({ distanceEstimate: { distanceM: 8400, basis: 'recent' } }), {
        'GET /api/settings': () => ({ ...settings, units: 'km' }),
      })
      const dialog = await screen.findByRole('dialog', { name: 'Threshold intervals' })
      expect(await within(dialog).findByText('about 8 km at your recent pace')).toBeInTheDocument()
      expect(within(dialog).queryByText(/easy pace/)).not.toBeInTheDocument()
    })

    test('is the figure alone for a session with a pace target of its own, in miles for a runner of miles', async () => {
      renderSheet(makeSession({ distanceEstimate: { distanceM: 10_900, basis: 'pace' } }), {
        'GET /api/settings': () => ({ ...settings, units: 'mi' }),
      })
      const dialog = await screen.findByRole('dialog')
      expect(await within(dialog).findByText('about 7 mi')).toBeInTheDocument()
      expect(within(dialog).queryByText(/easy pace/)).not.toBeInTheDocument()
    })

    test('without an estimate the plan’s own distance stands, and a session without either shows none', async () => {
      renderSheet(makeSession({ distanceEstimate: null }))
      const dialog = await screen.findByRole('dialog')
      expect(await within(dialog).findByText('9.00 km')).toBeInTheDocument()
      expect(within(dialog).queryByText(/about/)).not.toBeInTheDocument()
    })

    test('reads an answer the phone kept from before the estimate existed as no estimate', async () => {
      const stale = makeSession() as Partial<PlanSessionView>
      delete stale.distanceEstimate
      renderSheet(stale as PlanSessionView)
      const dialog = await screen.findByRole('dialog')
      expect(await within(dialog).findByText('9.00 km')).toBeInTheDocument()
    })

    test('never grades: it is an estimate, with no target and no comparison with what was run', async () => {
      renderSheet(
        makeSession({
          status: 'completed',
          activityId: 'act1',
          distanceEstimate: { distanceM: 8400, basis: 'easy' },
        }),
      )
      const dialog = await screen.findByRole('dialog')
      const estimate = await within(dialog).findByText('about 8 km at your easy pace')
      expect(estimate.textContent).not.toMatch(/target|ahead|behind|short|over/i)
      expect(within(dialog).getByText('Distance')).toBeInTheDocument()
      expectCleanCopy(dialog)
    })
  })

  test('the why button opens the drawer on the session and its rule ids', async () => {
    const user = userEvent.setup()
    renderSheet(makeSession())
    const dialog = await screen.findByRole('dialog')
    expect(screen.queryByLabelText('Why drawer')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Why this session' }))
    const drawer = await screen.findByLabelText('Why drawer')
    expect(drawer).toHaveTextContent('e-2,f-1')
    expect(explainOf(drawer)).toEqual({ subject: 'session', id: 's1' })
  })

  test('shows the execution assessment in plain words, with no judging copy', async () => {
    renderSheet(
      makeSession({
        status: 'completed',
        activityId: 'act1',
        linkSource: 'auto',
        execution: {
          completion: 'completed',
          intensity: 'above',
          effort: {
            score: 1,
            confidence: 'moderate',
            parts: { rpeDelta: 1, feel: 1, hrResidualZ: null, paceResidualPct: null },
          },
          conditions: { wbgtC: 24, heatAdjusted: true, gradeAdjusted: false },
          flags: ['hr-unqualified'],
          lines: ['Felt harder than the plan expected on a warm day.'],
        },
      }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Completed as planned')).toBeInTheDocument()
    expect(within(dialog).getByText('Above the target zone')).toBeInTheDocument()
    expect(within(dialog).getByText(/Harder than expected/)).toBeInTheDocument()
    expect(within(dialog).getByText(/moderate confidence/)).toBeInTheDocument()
    expect(within(dialog).getByText(/WBGT 24/)).toBeInTheDocument()
    expect(within(dialog).getByText('Adjusted for heat')).toBeInTheDocument()
    expect(within(dialog).getByText('Heart rate not reliable enough to use')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Felt harder than the plan expected on a warm day.'),
    ).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/behind|missed|streak/i)
  })

  describe('an effort verdict without a rating', () => {
    const unrated = {
      completion: 'completed',
      intensity: 'on',
      effort: {
        score: 1,
        confidence: 'low',
        parts: { rpeDelta: null, feel: null, hrResidualZ: 1.4, paceResidualPct: 4 },
      },
      conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
      flags: [],
      lines: [],
    } as const satisfies NonNullable<PlanSession['execution']>

    test('says a rating is what lets the plan adjust, and links to where to give it', async () => {
      renderSheet(
        makeSession({
          status: 'completed',
          activityId: 'act1',
          linkSource: 'auto',
          execution: unrated,
        }),
      )
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/Harder than expected, low confidence/)).toBeInTheDocument()
      const note = within(dialog).getByRole('note')
      expect(note).toHaveTextContent(
        "Rate this activity (effort or feel) so the plan can adjust. Without a rating, the plan's read of this activity stays a low-confidence guess from heart rate and pace, and the plan never changes because of it.",
      )
      expect(
        within(note).getByRole('link', { name: 'Open the activity to rate it.' }),
      ).toHaveAttribute('href', '/activities/act1')
      expect(dialog.textContent).not.toMatch(/behind|missed|streak/i)
    })

    test('with no score the note only asks', async () => {
      renderSheet(
        makeSession({
          status: 'completed',
          activityId: 'act1',
          execution: {
            ...unrated,
            effort: {
              ...unrated.effort,
              score: null,
              parts: { ...unrated.effort.parts, hrResidualZ: null, paceResidualPct: null },
            },
          },
        }),
      )
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Effort not assessed')).toBeInTheDocument()
      const note = within(dialog).getByRole('note')
      expect(note).toHaveTextContent('Rate this activity (effort or feel) so the plan can adjust.')
      expect(note).not.toHaveTextContent(/low-confidence guess/)
    })

    test('an activity of a different kind asks for a feel rating only', async () => {
      renderSheet(
        makeSession({
          status: 'completed',
          activityId: 'act1',
          execution: {
            ...unrated,
            completion: 'modified',
            intensity: 'unknown',
            effort: {
              score: null,
              confidence: 'low',
              parts: { rpeDelta: null, feel: null, hrResidualZ: null, paceResidualPct: null },
            },
          },
        }),
      )
      const dialog = await screen.findByRole('dialog')
      const note = within(dialog).getByRole('note')
      expect(note).toHaveTextContent('Rate how this activity felt so the plan can adjust.')
      expect(note).not.toHaveTextContent(/effort or feel/)
      expect(
        within(note).getByRole('link', { name: 'Open the activity to rate it.' }),
      ).toHaveAttribute('href', '/activities/act1')
    })

    test.each([
      ['an RPE', { rpeDelta: 1, feel: null }],
      ['a feel', { rpeDelta: null, feel: 1 }],
    ])('has no note once %s is behind the verdict', async (_name, rating) => {
      renderSheet(
        makeSession({
          status: 'completed',
          activityId: 'act1',
          execution: {
            ...unrated,
            effort: { ...unrated.effort, parts: { ...unrated.effort.parts, ...rating } },
          },
        }),
      )
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/Harder than expected/)).toBeInTheDocument()
      expect(within(dialog).queryByRole('note')).not.toBeInTheDocument()
      expect(within(dialog).queryByText(/Rate this activity/)).not.toBeInTheDocument()
    })
  })

  test('a linked activity is described and can be unlinked', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet(
      makeSession({ status: 'completed', activityId: 'act1', linkSource: 'owner' }),
      { 'POST /api/plan/sessions/s1/link': () => makeSession() },
    )
    const dialog = await screen.findByRole('dialog')
    const linked = await within(dialog).findByRole('link', { name: /Wed 13 Jan/ })
    expect(linked).toHaveAttribute('href', '/activities/act1')
    expect(within(dialog).getByText(/Linked by you/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Unlink' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true)
    })
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/plan/sessions/s1/link',
      body: { activityId: null },
    })
  })

  test('an unlinked session offers nearby activities to link', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet(makeSession(), {
      'POST /api/plan/sessions/s1/link': () => makeSession({ activityId: 'act2' }),
    })
    const dialog = await screen.findByRole('dialog')
    const select = await within(dialog).findByLabelText('Link an activity')
    expect(calls.find((c) => c.url.startsWith('/api/activities'))?.url).toBe(
      '/api/activities?from=2027-01-06&to=2027-01-20&limit=500&offset=0',
    )
    const link = within(dialog).getByRole('button', { name: 'Link' })
    expect(link).toBeDisabled()
    await user.selectOptions(select, 'act2')
    await user.click(link)
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true)
    })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ activityId: 'act2' })
  })

  test.each([
    ['a completed session', makeSession({ status: 'completed', activityId: 'act1' })],
    ['a session linked to an activity', makeSession({ status: 'planned', activityId: 'act1' })],
    ['a partial session', makeSession({ status: 'partial', activityId: null })],
  ])('keeps "Change this session" after the linked activity for %s', async (_name, session) => {
    renderSheet(session)
    const dialog = await screen.findByRole('dialog', { name: 'Threshold intervals' })
    const change = await within(dialog).findByRole('region', { name: 'Change this session' })
    const watch = within(dialog).getByRole('region', { name: 'On your watch' })
    const linked = within(dialog).getByRole('region', { name: 'Linked activity' })
    const follows = (a: HTMLElement, b: HTMLElement) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    // only the refusal sentence is in it, and it comes last, as it always did
    expect(follows(watch, change)).toBe(true)
    expect(follows(linked, change)).toBe(true)
    expect(within(change).queryByRole('button', { name: 'Skip session' })).not.toBeInTheDocument()
  })

  test('puts "Change this session" before the watch and the linked activity', async () => {
    renderSheet(makeSession())
    const dialog = await screen.findByRole('dialog', { name: 'Threshold intervals' })
    const change = await within(dialog).findByRole('region', { name: 'Change this session' })
    const watch = within(dialog).getByRole('region', { name: 'On your watch' })
    const linked = within(dialog).getByRole('region', { name: 'Linked activity' })
    const before = (a: HTMLElement, b: HTMLElement) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(before(change, watch)).toBe(true)
    expect(before(change, linked)).toBe(true)
    // the prescription and the fuel come first, as before
    const prescription = within(dialog).getByRole('region', { name: 'Prescription' })
    expect(before(prescription, change)).toBe(true)
  })

  test('holds the change section: a move is asked about, applied with its hash, and the sheet stays', async () => {
    const user = userEvent.setup()
    const dry = {
      allowed: true,
      guards: [],
      diff: makeDiff([
        makeLine({
          externalId: 'x1',
          sessionId: 's1',
          date: '2027-01-15',
          before: makeBrief({ date: '2027-01-13' }),
          after: makeBrief({ date: '2027-01-15' }),
          fields: ['date'],
        }),
      ]),
      session: makeSession({ date: '2027-01-15', status: 'moved' }),
      revision: null,
      hash: '1'.repeat(64),
    }
    const { calls, onClose } = renderSheet(makeSession(), {
      'POST /api/plan/sessions/s1/adjust': ({ body }) =>
        (body as { dryRun?: boolean }).dryRun === true
          ? dry
          : {
              ...dry,
              revision: makeRevision({
                id: 'r5',
                reason: 'owner',
                auto: false,
                summary: 'Moved Threshold intervals from Wed 13 Jan to Fri 15 Jan.',
                seenAt: null,
              }),
            },
      'POST /api/plan/revisions/r5/seen': () => ({ status: 204, body: undefined }),
    })
    const dialog = await screen.findByRole('dialog')
    const section = within(dialog).getByRole('region', { name: 'Change this session' })
    expect(within(section).getByLabelText('Move to')).toHaveValue('2027-01-13')
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    await user.click(await within(section).findByRole('button', { name: 'Apply change' }))
    expect(
      await screen.findAllByText(/^Moved Threshold intervals from Wed 13 Jan/),
    ).not.toHaveLength(0)
    const writes = calls.filter(
      (c) =>
        c.url === '/api/plan/sessions/s1/adjust' &&
        (c.body as { dryRun?: boolean }).dryRun !== true,
    )
    expect(writes.map((c) => c.body)).toEqual([
      { adjustment: { type: 'move', date: '2027-01-15' }, expectHash: '1'.repeat(64) },
    ])
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
    // The sheet shows what was done and stays open for the undo.
    expect(onClose).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('group', { name: 'Applied change' })).toBeInTheDocument()
  })

  test('a skip waits for the confirmation and says it is not made up later', async () => {
    const user = userEvent.setup()
    const { calls, onClose } = renderSheet(makeSession(), {
      'POST /api/plan/sessions/s1/adjust': () => ({
        allowed: true,
        guards: [],
        diff: makeDiff([]),
        session: makeSession({ status: 'skipped' }),
        revision: null,
        hash: '1'.repeat(64),
      }),
    })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('A skipped session is not made up later.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Skip session' }))
    await within(dialog).findByText('This would not change the plan.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).getByRole('button', { name: 'Skip session' })).toBeInTheDocument()
    // Keeping the session writes nothing: every call to the adjust route was a dry run.
    const asked = calls.filter((c) => c.url === '/api/plan/sessions/s1/adjust')
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((c) => (c.body as { dryRun?: boolean }).dryRun === true)).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  test('a skipped session can be restored', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet(makeSession({ status: 'skipped' }), {
      'POST /api/plan/sessions/s1/adjust': () => ({
        allowed: true,
        guards: [],
        diff: makeDiff([]),
        session: makeSession(),
        revision: null,
        hash: '1'.repeat(64),
      }),
    })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Skip session' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Restore session' }))
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/plan/sessions/s1/adjust')).toBe(true)
    })
    expect(calls.find((c) => c.url === '/api/plan/sessions/s1/adjust')?.body).toEqual({
      adjustment: { type: 'restore' },
      dryRun: true,
    })
  })

  test('a completed session cannot be moved or skipped', async () => {
    renderSheet(makeSession({ status: 'completed', activityId: 'act1', linkSource: 'auto' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText('Move to')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Skip session' })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/so it stays as it is/)).toBeInTheDocument()
  })

  test('an eased session shows what it was before', async () => {
    renderSheet(
      makeSession({
        status: 'downgraded',
        durationMin: 40,
        original: { durationMin: 55, title: 'Threshold intervals', kind: 'threshold' },
      }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Eased/)).toBeInTheDocument()
    expect(
      within(dialog).getByText(/First planned: Threshold intervals, 55 min/),
    ).toBeInTheDocument()
  })
})

// The sheet lists the engine's steps; the watch, the workout file, the intervals.icu text and the
// calendar outline list the steps of the workout built from the same session. A step has one name
// on every surface (`stepName`, shared/workouts/plan.ts), so this renders the sheet for each kind
// the engine prescribes and compares its words with the workout's.
describe('SessionSheet: the names of the steps', () => {
  const zones = zoneSetFixture()

  function stepNames(workout: WorkoutPlan): Set<string> {
    return new Set(
      workout.nodes.flatMap((node) =>
        node.type === 'step' ? [node.label] : node.steps.map((step) => step.label),
      ),
    )
  }

  async function sheetNames(session: PlanSessionView): Promise<string[]> {
    renderSheet(session)
    const dialog = await screen.findByRole('dialog')
    const list = within(dialog).getByRole('heading', { name: 'Steps' }).nextElementSibling
    expect(list).not.toBeNull()
    return within(list as HTMLElement)
      .getAllByRole('listitem')
      .map((item) => /^(?:\d+ x )?(.+?) [\d.]+ (?:min|m), /.exec(item.textContent)?.[1] ?? '?')
  }

  test.each(
    SESSION_KINDS.filter((kind) => publishable(kind) && prescribed(kind).structure.length > 0),
  )('a %s session lists the steps by the names its workout gives them', async (kind) => {
    const spec = prescribed(kind, zones)
    const session = makeSession({ ...spec, id: 's-names' })
    const workout = toWorkoutPlan(spec, resolveTargets(spec, zones, { hot: false }), {
      units: 'km',
    })
    const names = await sheetNames(session)
    expect(names.length).toBeGreaterThan(0)
    const known = stepNames(workout)
    // every word on the sheet is one the workout uses ...
    for (const name of names) expect(known, `${kind}: ${name}`).toContain(name)
    // ... and every word of the workout is on the sheet, bar the cool-down the workout adds to
    // fill the planned minutes
    for (const name of known) {
      if (name !== 'Cool down') expect(names, `${kind}: ${name}`).toContain(name)
    }
  })

  test('the breaks and the framing steps of a run-walk session are walks, as on the watch', async () => {
    const spec = prescribed('easy', zones, {
      flags: ['run-walk'],
      structure: [
        { kind: 'warmup', reps: 1, durationSec: 300, distanceM: null, zone: 'z1' },
        { kind: 'work', reps: 4, durationSec: 60, distanceM: null, zone: 'z1' },
        { kind: 'recover', reps: 4, durationSec: 120, distanceM: null, zone: 'z1' },
        { kind: 'cooldown', reps: 1, durationSec: 300, distanceM: null, zone: 'z1' },
      ],
    })
    const workout = toWorkoutPlan(spec, resolveTargets(spec, zones, { hot: false }), {
      units: 'km',
    })
    const names = await sheetNames(makeSession({ ...spec, id: 's-walk' }))
    expect(names).toEqual(['Walk', 'Run', 'Walk', 'Walk'])
    expect([...stepNames(workout)].sort()).toEqual(['Run', 'Walk'])
  })
})

// The Strength section (strength design 11.2): the workout of a strength session opened from the Plan
// page or the week strip, in the words of the Today hero, with "Why" for each lift and "Log sets" for
// a session on today's date or an earlier one. The clock is Wednesday 13 January 2027.
describe('SessionSheet: the Strength section', () => {
  const LOG_ID = '3f2b7c1e-8d4a-4f6b-9a31-5c0e2d7b6a10'
  const strengthSession = (over: Partial<PlanSessionView> = {}) =>
    makeSession({
      id: SESSION_ID,
      kind: 'strength',
      title: 'Strength',
      durationMin: 40,
      distanceM: null,
      gainM: null,
      structure: [],
      flags: [],
      target: { zone: 'strength', rpe: [5, 6], hr: null, paceSecPerKm: null, heatNote: null },
      purpose: 'Heavy lifts and jumps for a stronger stride.',
      rules: ['F7'],
      ...over,
    })
  const unreachable = {
    status: 503,
    body: { error: { code: 'internal', message: 'No connection.' } },
  }

  /** The Today payload the page holds: the server's day and, in its slot, one workout. */
  const todayOf = (workout: StrengthWorkout | null, over: Partial<TodayView> = {}): TodayView =>
    makeToday({
      date: '2027-01-13',
      coach: makeCoach({
        slots: {
          disruption: null,
          fuel: null,
          watch: null,
          brief: null,
          fuelPrompt: null,
          strength: workout,
          strengthSetup: null,
        },
      }),
      ...over,
    })

  function renderStrength(
    session: PlanSessionView,
    routes: MockRoutes = {},
    workout: StrengthWorkout | null = makeWorkout({ date: session.date }),
  ) {
    return renderSheet(session, {
      'GET /api/today': () => todayOf(workout),
      'GET /api/strength': () => makeView(),
      ...routes,
    })
  }

  const section = async (name = 'Strength, heavy A') =>
    within(await screen.findByRole('dialog', { name: 'Strength' })).findByRole('region', { name })

  test("shows the template and week, the lifts, the jumps and the trunk work, from the page's own payload", async () => {
    const { calls } = renderStrength(strengthSession())
    const strength = await section()
    expect(within(strength).getByText('Week 6 of 12 of the strength block.')).toBeVisible()
    expect(
      within(strength)
        .getAllByRole('listitem')
        .map((item) => item.firstElementChild?.textContent),
    ).toEqual([
      'Back squat: 4 x 3 to 6, 110 lb, leave 1 to 3.',
      'Dumbbell Romanian deadlift: 3 x 3 to 6, 40 lb, leave 2 or more.',
      'Standing calf raise: 3 x 8 to 15, leave 1 to 3.',
      'Pogo hops, 40 contacts.',
      'Side plank, 2 sets.',
    ])
    expect(within(strength).getByText('Lift at least 3 hours before or after a run.')).toBeVisible()
    expect(within(strength).getByRole('button', { name: 'Log sets' })).toBeVisible()
    // a session on today's day is not "as of today", and its workout is the one Today holds
    expect(within(strength).queryByText(/^As of today/)).not.toBeInTheDocument()
    expect(calls.some((call) => call.url.startsWith('/api/strength/workouts'))).toBe(false)
    expectCleanCopy(strength)
  })

  test('has a "Why" for each lift, on the lift of the session with its rule, and none for the jumps', async () => {
    renderStrength(strengthSession())
    const strength = await section()
    expect(within(strength).getAllByRole('button', { name: /^Why: / })).toHaveLength(3)
    const user = userEvent.setup()
    await user.click(within(strength).getByRole('button', { name: 'Why: Back squat' }))
    const drawer = await screen.findByRole('complementary', { name: 'Why drawer' })
    expect(drawer).toHaveTextContent('F8')
    expect(explainOf(drawer)).toEqual({
      subject: 'strength',
      id: SESSION_ID,
      exercise: 'back-squat',
    })
  })

  test('reads the loads in the weight unit of the settings', async () => {
    renderStrength(strengthSession(), {
      'GET /api/settings': () => ({ ...settings, weightUnit: 'kg' }),
    })
    const strength = await section()
    expect(within(strength).getByText('Back squat: 4 x 3 to 6, 50 kg, leave 1 to 3.')).toBeVisible()
  })

  test('a session ahead reads the workouts of its own day, says it is as of today and offers no Log sets', async () => {
    const ahead = strengthSession({ date: '2027-01-15' })
    const { calls } = renderStrength(
      ahead,
      { 'GET /api/strength/workouts': () => [makeWorkout({ date: '2027-01-15' })] },
      null,
    )
    const strength = await section()
    expect(
      within(strength).getByText(
        'As of today: the loads can change with the sessions before this one.',
      ),
    ).toBeVisible()
    expect(
      within(strength).getByText('Back squat: 4 x 3 to 6, 110 lb, leave 1 to 3.'),
    ).toBeVisible()
    expect(within(strength).queryByRole('button', { name: 'Log sets' })).not.toBeInTheDocument()
    expect(calls.map((call) => call.url)).toContain(
      '/api/strength/workouts?from=2027-01-15&to=2027-01-15',
    )
  })

  test('an earlier session still to be done offers Log sets, and the sheet logs it on its own day', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
    const earlier = strengthSession({ date: '2027-01-11' })
    const { calls } = renderStrength(
      earlier,
      {
        'GET /api/strength/workouts': () => [makeWorkout({ date: '2027-01-11' })],
        [`PUT /api/strength/logs/${LOG_ID}`]: () => savedLog(LOG_ID),
      },
      null,
    )
    const strength = await section()
    expect(within(strength).queryByText(/^As of today/)).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(within(strength).getByRole('button', { name: 'Log sets' }))
    const sheet = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
    await user.click(await within(sheet).findByRole('button', { name: 'As suggested' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
    })
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
      date: '2027-01-11',
      sessionId: SESSION_ID,
    })
    // the session sheet is still open under it
    expect(screen.getByRole('dialog', { name: 'Strength' })).toBeVisible()
  })

  test('Log sets opens the logging sheet on the workout the section shows', async () => {
    const user = userEvent.setup()
    renderStrength(strengthSession())
    const strength = await section()
    await user.click(within(strength).getByRole('button', { name: 'Log sets' }))
    const sheet = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
    expect(
      await within(sheet).findByRole('textbox', { name: 'Back squat, set 1, load' }),
    ).toHaveValue('110')
  })

  test('a settled session shows its workout and no Log sets', async () => {
    renderStrength(strengthSession({ status: 'completed', activityId: 'act1' }))
    const strength = await section()
    expect(
      within(strength).getByText('Back squat: 4 x 3 to 6, 110 lb, leave 1 to 3.'),
    ).toBeVisible()
    expect(within(strength).queryByRole('button', { name: 'Log sets' })).not.toBeInTheDocument()
  })

  test('says so when the workout cannot be read, and keeps the rest of the sheet', async () => {
    renderStrength(
      strengthSession({ date: '2027-01-15' }),
      { 'GET /api/strength/workouts': () => unreachable },
      null,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Strength' })
    expect(await within(dialog).findByText('The workout could not be loaded.')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Why this session' })).toBeVisible()
  })

  test('after a save the section says so and no longer offers Log sets', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
    const user = userEvent.setup()
    renderStrength(strengthSession(), {
      [`PUT /api/strength/logs/${LOG_ID}`]: () => savedLog(LOG_ID),
    })
    const strength = await section()
    await user.click(within(strength).getByRole('button', { name: 'Log sets' }))
    const sheet = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
    await user.click(await within(sheet).findByRole('button', { name: 'As suggested' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
    })
    expect(within(strength).getByText('Strength log saved.')).toBeVisible()
    expect(within(strength).queryByRole('button', { name: 'Log sets' })).not.toBeInTheDocument()
  })

  test('after a save kept on the phone it says that, and a second tap is not on offer either', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
    const user = userEvent.setup()
    renderStrength(strengthSession(), { [`PUT /api/strength/logs/${LOG_ID}`]: () => unreachable })
    const strength = await section()
    await user.click(within(strength).getByRole('button', { name: 'Log sets' }))
    const sheet = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
    await user.click(await within(sheet).findByRole('button', { name: 'As suggested' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
    })
    expect(
      within(strength).getByText(
        'Strength log saved on this phone. It is sent when a connection returns.',
      ),
    ).toBeVisible()
    expect(within(strength).queryByRole('button', { name: 'Log sets' })).not.toBeInTheDocument()
  })

  test('does not say the workout is unavailable while it is still being read', async () => {
    const { calls } = renderStrength(
      strengthSession({ date: '2027-01-15' }),
      {
        // Today's own read fails, which is why the workouts of the day are asked for
        'GET /api/today': () => unreachable,
        'GET /api/strength/workouts': () => [makeWorkout({ date: '2027-01-15' })],
      },
      null,
    )
    delayResponses(80)
    await waitFor(() => {
      expect(calls.some((call) => call.url.startsWith('/api/strength/workouts'))).toBe(true)
    })
    // Today has failed and the workouts are on their way: nothing is wrong yet
    expect(screen.queryByText('The workout could not be loaded.')).not.toBeInTheDocument()
    expect(await section()).toBeVisible()
    expect(screen.queryByText('The workout could not be loaded.')).not.toBeInTheDocument()
  })

  test("takes the day from the server's zone, not from the phone's calendar, for a copy kept on the phone", async () => {
    // 10:30 UTC on 13 January is 00:30 on the 14th in Kiritimati, where the server is: the payload
    // the phone kept is of the 13th, which is yesterday there, and the session is today's. A phone
    // anywhere else is still on the 13th (or earlier) by its own calendar.
    vi.setSystemTime(new Date('2027-01-13T10:30:00Z'))
    renderStrength(
      strengthSession({ date: '2027-01-14' }),
      {
        'GET /api/today': () =>
          todayOf(makeWorkout({ date: '2027-01-14' }), {
            date: '2027-01-13',
            tz: 'Pacific/Kiritimati',
            servedFromCache: true,
          }),
      },
      makeWorkout({ date: '2027-01-14' }),
    )
    const strength = await section()
    expect(within(strength).getByRole('button', { name: 'Log sets' })).toBeVisible()
    expect(within(strength).queryByText(/^As of today/)).not.toBeInTheDocument()
  })

  test('a live preview of a day ahead cannot tell today, so it offers no Log sets', async () => {
    renderStrength(
      strengthSession({ date: '2027-01-14' }),
      {
        'GET /api/today': () =>
          makeToday({
            date: '2027-01-14',
            coach: makeCoach({
              preview: true,
              slots: {
                disruption: null,
                fuel: null,
                watch: null,
                brief: null,
                fuelPrompt: null,
                strength: makeWorkout({ date: '2027-01-14' }),
                strengthSetup: null,
              },
            }),
          }),
      },
      makeWorkout({ date: '2027-01-14' }),
    )
    const strength = await section()
    expect(
      within(strength).getByText('Back squat: 4 x 3 to 6, 110 lb, leave 1 to 3.'),
    ).toBeVisible()
    expect(within(strength).queryByRole('button', { name: 'Log sets' })).not.toBeInTheDocument()
  })

  test('a strength session with no workout in the answer shows no section and no complaint', async () => {
    const { calls } = renderStrength(
      strengthSession({ date: '2027-01-15' }),
      { 'GET /api/strength/workouts': () => [] },
      null,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Strength' })
    await waitFor(() => {
      expect(calls.some((call) => call.url.startsWith('/api/strength/workouts'))).toBe(true)
    })
    await within(dialog).findByRole('button', { name: 'Why this session' })
    expect(screen.queryByRole('region', { name: /^Strength, / })).not.toBeInTheDocument()
    expect(screen.queryByText('The workout could not be loaded.')).not.toBeInTheDocument()
  })

  test("a run's sheet on a day with strength has no Strength section and asks for no workout", async () => {
    const run = makeSession({ id: 'run1', date: '2027-01-13' })
    const hero = { ...makeHero(), session: run, others: [strengthSession()] }
    const { calls } = renderSheet(run, {
      'GET /api/today': () =>
        makeToday({
          date: '2027-01-13',
          coach: makeCoach({
            hero,
            slots: {
              disruption: null,
              fuel: null,
              watch: null,
              brief: null,
              fuelPrompt: null,
              strength: makeWorkout({ date: '2027-01-13' }),
              strengthSetup: null,
            },
          }),
        }),
    })
    await screen.findByRole('dialog', { name: 'Threshold intervals' })
    expect(screen.queryByRole('region', { name: /^Strength/ })).not.toBeInTheDocument()
    expect(calls.some((call) => call.url.startsWith('/api/strength'))).toBe(false)
    expect(calls.some((call) => call.url === '/api/today')).toBe(false)
  })

  test('a run has no Strength section and asks for no workout', async () => {
    const { calls } = renderSheet(makeSession())
    await screen.findByRole('dialog', { name: 'Threshold intervals' })
    expect(screen.queryByRole('region', { name: /^Strength/ })).not.toBeInTheDocument()
    expect(calls.some((call) => call.url.startsWith('/api/strength'))).toBe(false)
    expect(calls.some((call) => call.url === '/api/today')).toBe(false)
  })
})

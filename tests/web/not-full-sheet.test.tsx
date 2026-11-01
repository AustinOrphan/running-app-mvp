import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import { untilHint } from '../../shared/copy/windowView.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { DisruptionResult, PlanPreview, TodayView } from '../../shared/types.ts'
import { NotFullSheet } from '../../web/components/disruption/NotFullSheet.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import {
  expectCleanCopy,
  expectTouchScale,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import {
  AVAILABLE,
  makeBrief,
  makeDiff,
  makeLine,
  makePreview,
  makeRevision,
  makeV2Plan,
  makeV2Week,
  makeSession,
  makeWindow,
  settings,
} from './plan-fixtures.ts'
import { makeCoach, makeRace, makeToday, TODAY } from './today-fixtures.ts'

// Wednesday 18 March 2026 is the server's day; the half marathon is on 13 June.
const RACE = '2026-06-13'
const ILLNESS_HASH = 'b'.repeat(64)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

function todayView(): TodayView {
  return makeToday({ coach: makeCoach({ race: makeRace({ targetDate: RACE }) }) })
}

/**
 * Four weeks of runs from Monday 16 March: an easy 100 minutes on Tuesday and Thursday and a
 * 110-minute long run on Sunday. From Wednesday 18 March that is 210 minutes this week and 310 in
 * each of the next three: 1,140 minutes still to come.
 */
function plan() {
  const starts = ['2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06']
  const sessions = starts.flatMap((weekStart, week) =>
    [
      [1, 'easy', 100],
      [3, 'easy', 100],
      [6, 'long', 110],
    ].map(([offset, kind, durationMin], i) =>
      makeSession({
        id: `s${String(week)}${String(i)}`,
        weekStart,
        date: addDays(weekStart, offset as number),
        kind: kind as 'easy' | 'long',
        title: kind === 'easy' ? 'Easy run' : 'Long run',
        durationMin: durationMin as number,
      }),
    ),
  )
  return makeV2Plan({
    weeks: starts.map((weekStart, i) => makeV2Week(i, { weekStart, targetRunMin: 310 })),
    sessions,
    warnings: [
      { code: 'ramp-capped', severity: 'warn', message: 'Held at the ramp limit.', rules: ['g-3'] },
    ],
  })
}

const brief = (date: string, durationMin: number) =>
  makeBrief({
    date,
    kind: durationMin === 0 ? 'rest' : 'easy',
    title: durationMin === 0 ? 'Rest: illness' : 'Easy run',
    durationMin,
    distanceM: null,
  })

/** Thursday's easy run held as rest, and the next Tuesday's cut to 70 minutes: 130 minutes fewer. */
function illnessDiff() {
  return makeDiff([
    makeLine({
      externalId: 'x1',
      date: '2026-03-19',
      before: brief('2026-03-19', 100),
      after: brief('2026-03-19', 0),
      fields: ['kind', 'durationMin'],
    }),
    makeLine({
      externalId: 'x2',
      date: '2026-03-24',
      before: brief('2026-03-24', 100),
      after: brief('2026-03-24', 70),
      fields: ['durationMin'],
    }),
  ])
}

function illnessPreview(over: Partial<PlanPreview> = {}): PlanPreview {
  return makePreview({
    action: {
      type: 'disruption-create',
      reason: 'illness-above-neck',
      mode: 'rest',
      startDate: '2026-03-18',
      endDate: '2026-03-20',
    },
    diff: illnessDiff(),
    // The server's figure for the 28 days from Wed 18 Mar: the 1,140 min of runs still to come,
    // less Thursday's 100 min held as rest and 30 min cut from the next Tuesday.
    runMin: { before: 1140, after: 1010 },
    summary: 'Added a window (illness) from Wed 18 Mar to Fri 20 Mar.',
    hash: ILLNESS_HASH,
    today: TODAY,
    ...over,
  })
}

function created(): DisruptionResult {
  const revision = makeRevision({
    id: 'r7',
    reason: 'disruption',
    auto: false,
    summary: 'Added a window (illness) from Wed 18 Mar to Fri 20 Mar.',
    diff: illnessDiff(),
    causes: { sessions: { x1: ['disruption'] }, weeks: {} },
    undo: AVAILABLE,
    seenAt: null,
    disruptionId: 'w9',
  })
  return {
    disruption: makeWindow({ id: 'w9', startDate: '2026-03-18', endDate: '2026-03-20' }),
    revision,
  }
}

function baseRoutes(): MockRoutes {
  return {
    'GET /api/settings': () => settings,
    'GET /api/today': () => todayView(),
    'GET /api/plan': () => plan(),
    'GET /api/plan/disruptions': () => [],
  }
}

function renderSheet(extra: MockRoutes = {}, props: { today?: string } = {}) {
  const onClose = vi.fn()
  const { calls } = mockApi({ ...baseRoutes(), ...extra })
  renderWithProviders(
    <ToastProvider>
      <NotFullSheet onClose={onClose} {...props} />
    </ToastProvider>,
  )
  return { calls, onClose }
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Not 100%' })
  // The sheet waits for the server's day before it draws the form.
  await within(dialog).findByRole('radio', { name: /Ill, above the neck/ })
  return { dialog, user }
}

async function toWhen(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: RegExp) {
  await user.click(within(dialog).getByRole('radio', { name }))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await within(dialog).findByRole('heading', { name: 'When' })
}

const previewCalls = (calls: Array<{ method: string; url: string; body: unknown }>) =>
  calls.filter((c) => c.method === 'POST' && c.url === '/api/plan/preview')

describe('Not 100%, step 1', () => {
  test('asks what is going on with five reasons and says minutes rested are not added back', async () => {
    renderSheet()
    const { dialog } = await open(userEvent.setup())
    expect(within(dialog).getByText('Step 1 of 3')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Tell the plan what is going on. Minutes you rest are not added back later.',
      ),
    ).toBeInTheDocument()
    const group = within(dialog).getByRole('group', { name: 'What is going on' })
    const names = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent)
    expect(names).toEqual([
      'Ill, above the neckCold, sore throat, blocked nose.',
      'Ill, below the neckChest, fever, aches, stomach.',
      'A niggle or pain',
      'Short on time',
      'Travelling',
    ])
    expect(within(dialog).getByRole('button', { name: 'Next' })).toBeDisabled()
    expectCleanCopy(dialog)
  })

  test('Cancel closes the sheet and sends nothing', async () => {
    const user = userEvent.setup()
    const { calls, onClose } = renderSheet()
    const { dialog } = await open(user)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
  })
})

describe('Not 100%, step 2', () => {
  test('an illness starts today, may start in the past, and states the n-3 rule from the Params', async () => {
    const user = userEvent.setup()
    renderSheet()
    const { dialog } = await open(user)
    await toWhen(user, dialog, /Ill, above the neck/)

    expect(within(dialog).getByText('Step 2 of 3')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('From')).toHaveValue('2026-03-18')
    expect(within(dialog).getByLabelText('Until')).toHaveValue('2026-03-18')
    expect(within(dialog).getByText('You can start this in the past.')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'The last day you feel it. The plan adds a symptom-free day and three easy days after it. You can change it later.',
      ),
    ).toBeInTheDocument()
    // The bounds are the Params': a start up to j9.maxBackdateDays back, a window of up to j9.maxWindowDays.
    expect(P.j9.maxBackdateDays.value).toBe(28)
    expect(P.j9.maxWindowDays.value).toBe(28)
    expect(within(dialog).getByLabelText('From')).toHaveAttribute('min', '2026-02-18')
    expect(within(dialog).getByLabelText('Until')).toHaveAttribute('min', '2026-03-18')
    expect(within(dialog).getByLabelText('Until')).toHaveAttribute('max', '2026-04-14')
    // Illness is rest only, and states the wait before intensity, with the Params' counts.
    expect(P.n3.illnessSymptomFreeDays.value).toBe(1)
    expect(P.n3.illnessEasyDaysBeforeIntensity.value).toBe(3)
    expect(
      within(dialog).getByText(
        'Running waits until you have had one symptom-free day, then three easy days before any hard session.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/see a clinician/)).not.toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test('an illness below the neck adds the clinician line', async () => {
    const user = userEvent.setup()
    renderSheet()
    const { dialog } = await open(user)
    await toWhen(user, dialog, /Ill, below the neck/)
    expect(
      within(dialog).getByText(
        'With a fever, chest symptoms or aches all over, see a clinician before running again.',
      ),
    ).toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test.each([
    {
      reason: /Ill, above the neck/,
      hint: 'The last day you feel it. The plan adds a symptom-free day and three easy days after it. You can change it later.',
    },
    {
      reason: /Ill, below the neck/,
      hint: 'The last day you feel it. The plan adds a symptom-free day and three easy days after it. You can change it later.',
    },
    {
      // a niggle has no symptom-free wait: the rule note under the dates says so
      reason: /A niggle or pain/,
      hint: 'The last day you feel it. The plan adds three easy days after it. You can change it later.',
    },
    { reason: /Travelling/, hint: 'The last day you are away. You can change it later.' },
    {
      reason: /Short on time/,
      hint: 'The last day you are short on time. You can change it later.',
    },
  ])('the hint under Until says what the last day is for $reason', async ({ reason, hint }) => {
    const user = userEvent.setup()
    renderSheet()
    const { dialog } = await open(user)
    await toWhen(user, dialog, reason)
    expect(within(dialog).getByText(hint)).toBeInTheDocument()
    // the old hint named no reason and left out what the plan adds after the last day
    expect(dialog).not.toHaveTextContent('The last day it affects training')
    expectCleanCopy(dialog)
  })

  test('the counts in the hint are the n-3 and j9 Params', () => {
    expect(P.n3.illnessSymptomFreeDays.value).toBe(1)
    expect(P.n3.illnessEasyDaysBeforeIntensity.value).toBe(3)
    expect(P.j9.niggleEasyDays.value).toBe(3)
    expect(untilHint('illness-above-neck', 'km')).toBe(
      'The last day you feel it. The plan adds a symptom-free day and three easy days after it.',
    )
    expect(untilHint('niggle', 'mi', { changeLater: true })).toBe(
      'The last day you feel it. The plan adds three easy days after it. You can change it later.',
    )
  })

  test('a niggle takes the area, a 0 to 10 pain, the gait change and the bone-pain notice', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet({ 'POST /api/plan/preview': () => illnessPreview() })
    const { dialog } = await open(user)
    await toWhen(user, dialog, /A niggle or pain/)

    expect(
      within(dialog).getByText(
        'There is no symptom-free wait after a niggle. Easy running only for three days, then hard sessions return.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: "Open today's check-in" })).toHaveAttribute(
      'href',
      '/',
    )
    expect(dialog).toHaveTextContent('Pain at one spot on a bone pauses progression')
    await user.type(within(dialog).getByLabelText('Where is it?'), 'Left calf')
    expectTouchScale(within(dialog).getByRole('group', { name: 'Pain (0 to 10)' }), {
      steps: 11,
      columns: 6,
    })
    await user.click(within(dialog).getByRole('button', { name: 'Pain (0 to 10) 3' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'It changes how I walk or run' }))
    // A niggle may rest or allow short easy runs; resting is the start.
    expect(within(dialog).getByRole('radio', { name: 'No running' })).toBeChecked()
    await user.click(within(dialog).getByRole('radio', { name: 'Short easy runs' }))
    await user.click(within(dialog).getByRole('radio', { name: '45 min' }))
    fireEvent.change(within(dialog).getByLabelText('Until'), { target: { value: '2026-03-20' } })
    expectCleanCopy(dialog)

    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await within(dialog).findByRole('heading', { name: 'What would change' })
    expect(previewCalls(calls)[0]?.body).toEqual({
      type: 'disruption-create',
      reason: 'niggle',
      mode: 'limited',
      startDate: '2026-03-18',
      endDate: '2026-03-20',
      maxRunMin: 45,
      area: 'Left calf',
      pain: 3,
      gaitChange: true,
    })
  })

  test('travel and short time offer no running or short easy runs of 20, 30, 45 or 60 minutes', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet({ 'POST /api/plan/preview': () => illnessPreview() })
    const { dialog } = await open(user)
    await toWhen(user, dialog, /Travelling/)
    expect(within(dialog).getByRole('radio', { name: 'Short easy runs' })).toBeChecked()
    const caps = within(dialog).getAllByRole('radio', { name: /^\d+ min$/ })
    expect(caps.map((cap) => cap.textContent)).toEqual(['20 min', '30 min', '45 min', '60 min'])
    expect(within(dialog).getByRole('radio', { name: '30 min' })).toBeChecked()
    expect(within(dialog).queryByLabelText('Where is it?')).not.toBeInTheDocument()
    expect(dialog).not.toHaveTextContent('symptom-free')

    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await within(dialog).findByRole('heading', { name: 'What would change' })
    expect(previewCalls(calls)[0]?.body).toEqual({
      type: 'disruption-create',
      reason: 'travel',
      mode: 'limited',
      startDate: '2026-03-18',
      endDate: '2026-03-18',
      maxRunMin: 30,
    })
  })

  test('a last day before the first, or a start too long ago, is refused here with the server wording', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet()
    const { dialog } = await open(user)
    await toWhen(user, dialog, /Ill, above the neck/)

    fireEvent.change(within(dialog).getByLabelText('Until'), { target: { value: '2026-03-17' } })
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(
      await within(dialog).findByText('The last day cannot come before the first day.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Until')).toHaveFocus()
    expect(within(dialog).getByLabelText('Until')).toBeInvalid()

    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-02-01' } })
    fireEvent.change(within(dialog).getByLabelText('Until'), { target: { value: '2026-02-03' } })
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(
      await within(dialog).findByText('A window can start up to 28 days ago.'),
    ).toBeInTheDocument()
    expect(previewCalls(calls)).toHaveLength(0)
  })

  test('a refusal from the server is shown under the field it names', async () => {
    const user = userEvent.setup()
    renderSheet({
      'POST /api/plan/preview': () => ({
        status: 400,
        body: {
          error: {
            code: 'validation',
            message: 'Some fields need attention.',
            details: {
              issues: [{ path: 'endDate', message: 'A window cannot end after the race.' }],
            },
          },
        },
      }),
    })
    const { dialog } = await open(user)
    await toWhen(user, dialog, /Ill, above the neck/)
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(
      await within(dialog).findByText('A window cannot end after the race.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'When' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Until')).toHaveFocus()
  })
})

describe('Not 100%, step 3', () => {
  async function toReview(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    until = '2026-03-20',
  ) {
    await toWhen(user, dialog, /Ill, above the neck/)
    fireEvent.change(within(dialog).getByLabelText('Until'), { target: { value: until } })
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await within(dialog).findByRole('heading', { name: 'What would change' })
  }

  test('shows the window in words, the running time, what is worth knowing and the rows of the diff', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet({
      'POST /api/plan/preview': () =>
        illnessPreview({
          warnings: [
            // already on the plan, so not repeated
            {
              code: 'ramp-capped',
              severity: 'warn',
              message: 'Held at the ramp limit.',
              rules: ['g-3'],
            },
            {
              code: 'long-gap',
              severity: 'info',
              message: 'A long gap before the race.',
              rules: [],
            },
          ],
        }),
    })
    const { dialog } = await open(user)
    await toReview(user, dialog)

    expect(previewCalls(calls)[0]?.body).toEqual({
      type: 'disruption-create',
      reason: 'illness-above-neck',
      mode: 'rest',
      startDate: '2026-03-18',
      endDate: '2026-03-20',
    })
    expect(within(dialog).getByText('Step 3 of 3')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Rest from Wed 18 Mar to Sat 21 Mar. Easy running only from Sun 22 Mar to Tue 24 Mar. Back to the planned week on Wed 25 Mar.',
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Running time over the next four weeks: 19.0 h becomes 16.8 h. The minutes you rest are not added back.',
      ),
    ).toBeInTheDocument()
    const worth = within(dialog).getByRole('list', { name: 'Worth knowing' })
    expect(
      within(worth)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['A long gap before the race.'])
    const rows = within(dialog).getByRole('list', { name: 'Changes in this update' })
    expect(
      within(rows).getByText(/Thu 19 Mar: Easy run 100 min to Rest: illness 0 min/),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Apply to my plan' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test('moves focus to the heading of each step, and Back keeps what was entered', async () => {
    const user = userEvent.setup()
    renderSheet({ 'POST /api/plan/preview': () => illnessPreview() })
    const { dialog } = await open(user)
    await toWhen(user, dialog, /Ill, above the neck/)
    expect(within(dialog).getByRole('heading', { name: 'When' })).toHaveFocus()
    fireEvent.change(within(dialog).getByLabelText('Until'), { target: { value: '2026-03-20' } })
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(await within(dialog).findByRole('heading', { name: 'What would change' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Back' }))
    expect(within(dialog).getByRole('heading', { name: 'When' })).toHaveFocus()
    expect(within(dialog).getByLabelText('Until')).toHaveValue('2026-03-20')
    await user.click(within(dialog).getByRole('button', { name: 'Back' }))
    expect(within(dialog).getByRole('radio', { name: /Ill, above the neck/ })).toBeChecked()
  })

  test('states the running time the server sent, whatever plan the page holds', async () => {
    const user = userEvent.setup()
    // The plan query answers an empty plan: the figure cannot come from it, and is not negative.
    renderSheet({
      'GET /api/plan': () => makeV2Plan({ sessions: [] }),
      'POST /api/plan/preview': () => illnessPreview({ runMin: { before: 600, after: 480 } }),
    })
    const { dialog } = await open(user)
    await toReview(user, dialog)
    expect(
      within(dialog).getByText(
        'Running time over the next four weeks: 10.0 h becomes 8.0 h. The minutes you rest are not added back.',
      ),
    ).toBeInTheDocument()
  })

  test('leaves the running-time line out when the server sent no figure', async () => {
    const user = userEvent.setup()
    renderSheet({ 'POST /api/plan/preview': () => illnessPreview({ runMin: null }) })
    const { dialog } = await open(user)
    await toReview(user, dialog)
    expect(within(dialog).queryByText(/Running time over the next four weeks/)).toBeNull()
  })

  test('a window over the race day says the plan keeps the race', async () => {
    const user = userEvent.setup()
    renderSheet({ 'POST /api/plan/preview': () => illnessPreview() })
    const { dialog } = await open(user)
    await toWhen(user, dialog, /Ill, above the neck/)
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-06-12' } })
    fireEvent.change(within(dialog).getByLabelText('Until'), { target: { value: RACE } })
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await within(dialog).findByRole('heading', { name: 'What would change' })
    const worth = within(dialog).getByRole('list', { name: 'Worth knowing' })
    expect(
      within(worth).getByText(
        'The window includes race day. The plan keeps the race; whether to start is your decision.',
      ),
    ).toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test('Apply sends the hash of the preview, then shows the revision with its undo', async () => {
    const user = userEvent.setup()
    const { calls, onClose } = renderSheet({
      'POST /api/plan/preview': () => illnessPreview(),
      'POST /api/plan/disruptions': () => ({ status: 201, body: created() }),
      'POST /api/plan/revisions/r7/seen': () => ({ status: 204, body: undefined }),
    })
    const { dialog } = await open(user)
    await toReview(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Apply to my plan' }))

    expect(await within(dialog).findByRole('heading', { name: 'Window added' })).toHaveFocus()
    const sent = calls.find((c) => c.method === 'POST' && c.url === '/api/plan/disruptions')
    expect(sent?.body).toEqual({
      reason: 'illness-above-neck',
      mode: 'rest',
      startDate: '2026-03-18',
      endDate: '2026-03-20',
      expectHash: ILLNESS_HASH,
    })
    expect(
      within(dialog).getByText('Added a window (illness) from Wed 18 Mar to Fri 20 Mar.'),
    ).toBeInTheDocument()
    // The runner is looking at it, so it is stamped seen and carries no "New" marker.
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/plan/revisions/r7/seen')).toBe(true)
    })
    expect(within(dialog).queryByText('New')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
    expectCleanCopy(dialog)

    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })

  test('a stale preview is replaced by the new one, with a sentence, and applied on the next tap', async () => {
    const user = userEvent.setup()
    const newer = illnessPreview({
      hash: 'c'.repeat(64),
      runMin: { before: 1140, after: 980 },
      diff: makeDiff([
        makeLine({
          externalId: 'x1',
          date: '2026-03-19',
          before: brief('2026-03-19', 100),
          after: brief('2026-03-19', 0),
          fields: ['kind', 'durationMin'],
        }),
        makeLine({
          externalId: 'x2',
          date: '2026-03-24',
          before: brief('2026-03-24', 100),
          after: brief('2026-03-24', 40),
          fields: ['durationMin'],
        }),
      ]),
    })
    let commits = 0
    const { calls } = renderSheet({
      'POST /api/plan/preview': () => illnessPreview(),
      'POST /api/plan/disruptions': () => {
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
          : { status: 201, body: created() }
      },
      'POST /api/plan/revisions/r7/seen': () => ({ status: 204, body: undefined }),
    })
    const { dialog } = await open(user)
    await toReview(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Apply to my plan' }))

    expect(
      await within(dialog).findByText(
        'The plan changed while you were reading. This is the new preview.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'What would change' })).toBeInTheDocument()
    expect(
      within(dialog).queryByText(/Tue 24 Mar: Easy run 100 min to Easy run 70 min/),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Running time over the next four weeks: 19.0 h becomes 16.3 h. The minutes you rest are not added back.',
      ),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Apply to my plan' }))
    await within(dialog).findByRole('heading', { name: 'Window added' })
    const hashes = calls
      .filter((c) => c.url === '/api/plan/disruptions')
      .map((c) => (c.body as { expectHash: string }).expectHash)
    expect(hashes).toEqual([ILLNESS_HASH, 'c'.repeat(64)])
  })

  test('a preview the plan checks refuse says why and cannot be applied', async () => {
    const user = userEvent.setup()
    renderSheet({
      'POST /api/plan/preview': () =>
        illnessPreview({
          blocked: true,
          reasons: [
            {
              code: 'checklist',
              message: 'The plan did not pass the plan checks, so it was not published.',
            },
          ],
        }),
    })
    const { dialog } = await open(user)
    await toReview(user, dialog)
    expect(within(dialog).getByText('This cannot be applied right now.')).toBeInTheDocument()
    const why = within(dialog).getByRole('list', { name: 'Why this cannot be applied' })
    expect(within(why).getByText(/did not pass the plan checks/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Apply to my plan' })).toBeDisabled()
    expectCleanCopy(dialog)
  })

  test('offline, the preview and the apply say nothing was changed', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet({ 'POST /api/plan/preview': () => illnessPreview() })
    const { dialog } = await open(user)
    await toWhen(user, dialog, /Ill, above the neck/)
    const online = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      (input instanceof Request ? input.url : String(input)).includes('/plan/preview')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : online(input, init),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You are offline. Nothing was changed.',
    )
    expect(within(dialog).getByRole('heading', { name: 'When' })).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
    expectCleanCopy(dialog)
  })

  test('the sheet starts from the day it is given, not from the clock', async () => {
    const user = userEvent.setup()
    renderSheet({}, { today: '2026-03-21' })
    const { dialog } = await open(user)
    await toWhen(user, dialog, /Ill, above the neck/)
    expect(within(dialog).getByLabelText('From')).toHaveValue('2026-03-21')
  })
})

describe('Not 100%, as a dialog', () => {
  function Opener() {
    const [shown, setShown] = useState(false)
    return (
      <ToastProvider>
        <button
          type="button"
          onClick={() => {
            setShown(true)
          }}
        >
          Open the sheet
        </button>
        {shown ? (
          <NotFullSheet
            onClose={() => {
              setShown(false)
            }}
          />
        ) : null}
      </ToastProvider>
    )
  }

  test('Escape closes it and focus goes back to the button that opened it', async () => {
    const user = userEvent.setup()
    mockApi(baseRoutes())
    renderWithProviders(<Opener />)
    const opener = screen.getByRole('button', { name: 'Open the sheet' })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Not 100%' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(opener).toHaveFocus()
  })
})

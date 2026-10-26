import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { activityWindowRefusal, resultRefusal } from '../../shared/copy/trackRecord.ts'
import { addDays, formatLongDate, todayIso } from '../../shared/dates.ts'
import { RESULT_ACTIVITY_WINDOW_DAYS } from '../../shared/limits.ts'
import type {
  Activity,
  Goal,
  RaceResultView,
  TrackRecordView,
  UserSettings,
} from '../../shared/types.ts'
import { timeScale } from '../../web/components/charts/PredictionTrackChart.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { GoalsPage } from '../../web/pages/GoalsPage.tsx'
import { makeActivity } from '../factories.ts'
import {
  activityPage,
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import { makeRace, makeRecord, makeScored } from './track-record-fixtures.ts'

// The Goals page's two additions of E10s-4: the result sheet and the prediction track record
// (phase 3a design 11.6). The words come from `shared/copy/trackRecord.ts`; the figures come from
// the payload.

const today = todayIso()
const raceDay = addDays(today, -10)

const miUser: UserSettings = {
  email: 'runner@example.com',
  displayName: null,
  units: 'mi',
  weightUnit: 'lb',
}
const kmUser: UserSettings = { ...miUser, units: 'km' }

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    userId: 'u1',
    name: 'Spring half',
    priority: 'A',
    status: 'target',
    targetDate: raceDay,
    dateProvisional: false,
    distanceM: 21_098,
    location: null,
    successCriteria: null,
    notes: null,
    url: null,
    isActive: false,
    gainM: null,
    lossM: null,
    surface: 'road',
    goalType: 'time',
    targetTimeSec: null,
    startTime: null,
    raceLat: null,
    raceLng: null,
    supportLevel: 'aided',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  }
}

function saved(over: Partial<RaceResultView> = {}): RaceResultView {
  return {
    id: 'r1',
    goalId: 'g1',
    activityId: null,
    date: raceDay,
    distanceM: 21_098,
    gainM: null,
    outcome: 'finished',
    timeSec: 14_170,
    note: null,
    scoredPredictions: 12,
    activityMarkedAsRace: false,
    ...over,
  }
}

function problem(status: number, code: string, message: string, issues?: unknown[]) {
  return {
    status,
    body: {
      error: { code, message, ...(issues === undefined ? {} : { details: { issues } }) },
    },
  }
}

/** What the server holds while a test runs; the result routes change the record as the server does. */
interface World {
  goals: Goal[]
  record: TrackRecordView
  user: UserSettings
  activities: Activity[]
}

function world(over: Partial<World> = {}): World {
  return {
    goals: [makeGoal()],
    record: makeRecord(),
    user: miUser,
    activities: [],
    ...over,
  }
}

function routes(state: World, extra: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/goals': () => state.goals,
    'GET /api/settings': () => state.user,
    'GET /api/plan': () => null,
    'GET /api/plan/archived': () => [],
    'GET /api/predictions': () => ({ prediction: null, log: [] }),
    'GET /api/predictions/record': () => state.record,
    'GET /api/activities': ({ query }) => {
      const from = query.get('from') ?? ''
      const to = query.get('to') ?? '9999-12-31'
      return activityPage(state.activities.filter((a) => a.date >= from && a.date <= to))
    },
    ...extra,
  }
}

function renderPage() {
  return renderWithProviders(
    <ToastProvider>
      <GoalsPage />
    </ToastProvider>,
  )
}

type User = ReturnType<typeof userEvent.setup>

async function openSheet(user: User, name: string) {
  await user.click(await screen.findByRole('button', { name }))
  return screen.findByRole('dialog', { name: /^(Record|Edit) result$/ })
}

const SECTION = 'Prediction track record'
const recordSection = () => screen.findByRole('region', { name: SECTION })

/** The list item that holds a race of the record, found by its heading (a goal row is an article). */
async function raceCard(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name, level: 3 })
  const item = heading.closest('li')
  if (item === null) throw new Error(`The heading ${name} is not in a list item.`)
  return item
}

// ---------------------------------------------------------------------------------------------
// The track record
// ---------------------------------------------------------------------------------------------

describe('The prediction track record', () => {
  test('explains itself before any race is recorded, and promises no pattern yet', async () => {
    mockApi(routes(world()))
    renderPage()

    const section = await recordSection()
    expect(within(section).getByRole('heading', { name: SECTION, level: 2 })).toBeInTheDocument()
    expect(section).toHaveTextContent(
      'The app writes down its predicted finish time once a week. After a race, each prediction is compared with what happened. The comparison describes the prediction, not the race.',
    )
    expect(section).toHaveTextContent(
      'No race compared so far. A summary across races needs 3 more; until then each race stands on its own.',
    )
    expect(within(section).queryByRole('heading', { level: 3 })).toBeNull()
    expectCleanCopy(document.body)
  })

  test('is not shown on a page without goals', async () => {
    mockApi(routes(world({ goals: [] })))
    renderPage()
    expect(await screen.findByText('No goals yet.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: SECTION })).toBeNull()
  })

  test('shows each race newest first, with its headline, a named chart and a captioned table', async () => {
    const newer = makeRace({ goalId: 'g2', goalName: 'Autumn 10K', date: raceDay })
    const older = makeRace({
      goalId: 'g1',
      goalName: 'Spring half',
      date: '2026-05-09',
      resultSec: 14_000,
    })
    mockApi(routes(world({ record: makeRecord([newer, older]) })))
    renderPage()

    const section = await recordSection()
    const names = within(section)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(names).toEqual(['Autumn 10K', 'Spring half'])

    const race = await raceCard('Autumn 10K')
    expect(race).toHaveTextContent(`${formatLongDate(raceDay)} · 13.11 mi · Result 3:56:10`)
    expect(race).toHaveTextContent(
      'The last prediction, made 12 days before the race, was 3 h 52 min (3 h 40 min to 4 h 4 min). The result was 4 min 10 s slower than predicted (1.8%), inside the range.',
    )
    // The chart loads as its own chunk, after the headline and the table.
    expect(
      await within(race).findByRole('img', {
        name: 'Weekly predicted finish times and ranges for Autumn 10K, against the result',
      }),
    ).toBeInTheDocument()

    const table = within(race).getByRole('table', {
      name: 'Weekly predictions for Autumn 10K compared with the result.',
    })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Weeks before', 'Predicted', 'Range', 'Result against prediction', 'In range'])
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(4)
    const last = within(rows[3] as HTMLElement)
    expect(last.getByRole('rowheader')).toHaveTextContent('1')
    expect(last.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '3 h 52 min',
      '3 h 40 min to 4 h 4 min',
      '4 min 10 s slower (1.8%)',
      'Yes',
    ])
    // The first week was predicted slower than the result: the direction is in the words.
    expect(
      within(rows[1] as HTMLElement)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toContain('3 min 50 s faster (1.6%)')
    // A wide table scrolls inside a region the keyboard can reach, not the page.
    expect(
      within(race).getByRole('region', {
        name: 'Weekly predictions for Autumn 10K compared with the result.',
      }),
    ).toHaveAttribute('tabindex', '0')
    expectCleanCopy(document.body)
  })

  test('says "outside the range" in words, with no colour or verdict', async () => {
    const late = makeScored({
      predictedSec: 13_920,
      lowSec: 13_200,
      highSec: 14_000,
      errorSec: 600,
      errorPct: (600 / 13_920) * 100,
      inside: false,
    })
    mockApi(
      routes(
        world({
          record: makeRecord([
            makeRace({ points: [late], headline: late, resultSec: 14_520, inside: false }),
          ]),
        }),
      ),
    )
    renderPage()

    const race = await raceCard('Spring half')
    expect(race).toHaveTextContent(
      'The result was 10 min slower than predicted (4.3%), outside the range.',
    )
    expect(within(race).getAllByRole('cell').at(-1)).toHaveTextContent('No')
    expectCleanCopy(document.body)
  })

  test('shows the pattern only from three scored races, with the counts from the payload', async () => {
    const races = [
      makeRace({ goalId: 'g1', goalName: 'Spring half', date: '2026-10-11' }),
      makeRace({ goalId: 'g2', goalName: 'Summer 10K', date: '2026-07-11' }),
    ]
    // The server says 5 more are needed; the page prints that, whatever its own arithmetic says.
    mockApi(routes(world({ record: makeRecord(races, { needed: 5 }) })))
    const first = renderPage()
    const section = await recordSection()
    expect(section).toHaveTextContent(
      'Two races compared so far. A summary across races needs 5 more; until then each race stands on its own.',
    )
    expect(section).not.toHaveTextContent(/Across \d+ races/)
    first.unmount()

    const three = [
      ...races,
      makeRace({ goalId: 'g3', goalName: 'Winter 5K', date: '2026-02-14', resultSec: 13_000 }),
    ]
    mockApi(
      routes(
        world({
          record: makeRecord(three, {
            raceCount: 3,
            insideCount: 2,
            medianSignedPct: 2.1,
            medianAbsPct: 2.1,
            enough: true,
            needed: 0,
          }),
        }),
      ),
    )
    renderPage()
    const enough = await recordSection()
    expect(enough).toHaveTextContent(
      'Across 3 races the result was inside the predicted range twice. The median difference was 2.1% slower than predicted.',
    )
    expect(enough).not.toHaveTextContent('needs')
    expectCleanCopy(document.body)
  })

  test('a race not finished is shown unscored: no headline, no chart, no table', async () => {
    const race = makeRace({
      outcome: 'did-not-finish',
      resultSec: null,
      points: [],
      headline: null,
      inside: null,
      unscoredCount: 12,
    })
    mockApi(routes(world({ record: makeRecord([race], { raceCount: 0, needed: 3 }) })))
    renderPage()

    const card = await raceCard('Spring half')
    expect(card).toHaveTextContent(
      'Did not finish. There is nothing to compare, so these 12 predictions are not scored.',
    )
    expect(card).not.toHaveTextContent('Result')
    expect(within(card).queryByRole('img')).toBeNull()
    expect(within(card).queryByRole('table')).toBeNull()
    expect(card).not.toHaveTextContent(/slower|faster/)
    expect(await recordSection()).toHaveTextContent('No race compared so far.')
  })

  test('says why a finished race has nothing to compare, or only some of it', async () => {
    const none = makeRace({
      goalId: 'g1',
      goalName: 'Spring half',
      points: [],
      headline: null,
      inside: null,
    })
    const other = makeRace({
      goalId: 'g2',
      goalName: 'Autumn 10K',
      date: '2026-06-01',
      unscoredCount: 2,
    })
    mockApi(routes(world({ record: makeRecord([none, other]) })))
    renderPage()

    const first = await raceCard('Spring half')
    expect(first).toHaveTextContent(
      'No predictions were logged before this race, so there is nothing to compare.',
    )
    expect(within(first).queryByRole('table')).toBeNull()
    const second = await raceCard('Autumn 10K')
    expect(second).toHaveTextContent(
      '2 predictions were made for a different course, so they are not scored.',
    )
    expect(within(second).getByRole('table')).toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('reads in the runner s units', async () => {
    mockApi(routes(world({ user: kmUser, record: makeRecord([makeRace()]) })))
    renderPage()
    expect(await raceCard('Spring half')).toHaveTextContent('21.10 km')
  })

  test('a record that did not load says so and leaves the goals usable', async () => {
    mockApi(
      routes(world(), {
        'GET /api/predictions/record': () => problem(500, 'internal', 'Broken.'),
      }),
    )
    renderPage()

    const section = await recordSection()
    expect(within(section).getByRole('alert')).toHaveTextContent(
      'The track record did not load. Reload the page to try again.',
    )
    expect(screen.getByRole('button', { name: 'Edit Spring half' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------------
// The result sheet
// ---------------------------------------------------------------------------------------------

const RECORD_BUTTON = 'Record result for Spring half'
const EDIT_BUTTON = 'Edit result for Spring half'

/** A PUT that stores the body as the server does and answers with the saved result. */
function putResult(state: World, answer: Partial<RaceResultView> = {}): MockRoutes {
  return {
    'PUT /api/goals/g1/result': ({ body }) => {
      const sent = body as {
        outcome: 'finished' | 'did-not-finish'
        timeSec: number | null
        date: string
        distanceM: number | null
        gainM: number | null
        activityId: string | null
        note: string | null
      }
      state.record = makeRecord([
        makeRace({
          date: sent.date,
          outcome: sent.outcome,
          resultSec: sent.timeSec,
          activityId: sent.activityId,
          gainM: sent.gainM,
          note: sent.note,
          distanceM: sent.distanceM ?? 21_098,
        }),
      ])
      return {
        status: 201,
        body: saved({
          outcome: sent.outcome,
          timeSec: sent.timeSec,
          date: sent.date,
          activityId: sent.activityId,
          ...answer,
        }),
      }
    },
  }
}

function putBodies(calls: Array<{ method: string; url: string; body: unknown }>) {
  return calls.filter((c) => c.method === 'PUT' && c.url === '/api/goals/g1/result')
}

describe('The result sheet', () => {
  test('opens with the fields of the design, the goal s own date and distance, and focus on the first', async () => {
    const user = userEvent.setup()
    mockApi(routes(world()))
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    expect(dialog).toHaveAccessibleName('Record result')
    const outcome = within(dialog).getByRole('radiogroup', { name: 'Outcome' })
    expect(within(outcome).getByRole('radio', { name: 'Finished' })).toBeChecked()
    expect(within(outcome).getByRole('radio', { name: 'Did not finish' })).not.toBeChecked()
    expect(within(outcome).getByRole('radio', { name: 'Finished' })).toHaveFocus()
    const time = within(dialog).getByLabelText('Finish time (h:mm:ss)')
    expect(time).toHaveValue('')
    expect(time).toHaveAccessibleDescription('Official time as h:mm:ss, like 3:52:10.')
    expect(within(dialog).getByLabelText('Race date')).toHaveValue(raceDay)
    expect(within(dialog).getByLabelText('Distance (mi)')).toHaveValue('13.11')
    expect(within(dialog).getByLabelText('Activity')).toHaveValue('')
    expect(within(dialog).getByRole('option', { name: 'Not linked' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('')
    expect(within(dialog).getByRole('button', { name: 'Save result' })).toBeEnabled()
    expect(within(dialog).queryByRole('button', { name: 'Remove result' })).toBeNull()
    expectCleanCopy(dialog)
  })

  test('lists the runs and races within three days of the date, and no other activity', async () => {
    const user = userEvent.setup()
    const activities = [
      makeActivity({ id: 'near-run', date: addDays(raceDay, -2), type: 'run' }),
      makeActivity({ id: 'on-race', date: raceDay, type: 'race' }),
      makeActivity({ id: 'strength', date: raceDay, type: 'strength' }),
      makeActivity({
        id: 'twin',
        date: raceDay,
        type: 'run',
        duplicateOfId: 'on-race',
        duplicateStatus: 'confirmed',
      }),
      makeActivity({ id: 'far', date: addDays(raceDay, -5), type: 'run' }),
    ]
    const { calls } = mockApi(routes(world({ activities })))
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    await waitFor(() => {
      expect(within(dialog).getAllByRole('option')).toHaveLength(3)
    })
    const options = within(dialog).getAllByRole('option')
    expect(options.map((o) => (o as HTMLOptionElement).value).sort()).toEqual(
      ['', 'near-run', 'on-race'].sort(),
    )
    const window = calls.find(
      (c) => c.url.startsWith('/api/activities') && c.url.includes('from='),
    )?.url
    const query = new URLSearchParams(window?.split('?')[1])
    expect(query.get('from')).toBe(addDays(raceDay, -RESULT_ACTIVITY_WINDOW_DAYS))
    expect(query.get('to')).toBe(addDays(raceDay, RESULT_ACTIVITY_WINDOW_DAYS))
    expect(within(dialog).getByLabelText('Activity')).toHaveAccessibleDescription(
      'Runs and races within 3 days of the race date.',
    )
  })

  test('choosing an activity fills in its time, date and distance, says it becomes a race, and links it', async () => {
    const user = userEvent.setup()
    const state = world({
      activities: [
        makeActivity({
          id: 'a-run',
          date: addDays(raceDay, -1),
          type: 'run',
          durationSec: 14_170,
          distanceM: 21_097,
        }),
      ],
    })
    const { calls } = mockApi(routes(state, putResult(state)))
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    await within(dialog).findByRole('option', { name: /3:56:10/ })
    await user.selectOptions(within(dialog).getByLabelText('Activity'), 'a-run')

    expect(within(dialog).getByLabelText('Finish time (h:mm:ss)')).toHaveValue('3:56:10')
    expect(within(dialog).getByLabelText('Race date')).toHaveValue(addDays(raceDay, -1))
    expect(within(dialog).getByLabelText('Distance (mi)')).toHaveValue('13.11')
    const notice =
      'Linking marks this activity as a race, so later predictions can use it as an anchor, and zones and watch targets may change with it.'
    expect(within(dialog).getByText(notice)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Activity')).toHaveAccessibleDescription(notice)
    expectCleanCopy(dialog)

    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    await waitFor(() => {
      expect(putBodies(calls)).toHaveLength(1)
    })
    // The metres of the run go back as they came, not re-read from the rounded text.
    expect(putBodies(calls)[0]?.body).toEqual({
      outcome: 'finished',
      timeSec: 14_170,
      date: addDays(raceDay, -1),
      distanceM: 21_097,
      gainM: null,
      activityId: 'a-run',
      note: null,
    })
  })

  test('saving says how many predictions were compared, closes the sheet, and the record shows the race', async () => {
    const user = userEvent.setup()
    const state = world()
    const { calls } = mockApi(routes(state, putResult(state)))
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    await user.type(within(dialog).getByLabelText('Finish time (h:mm:ss)'), '3:56:10')
    await user.type(within(dialog).getByLabelText('Notes'), '  Cool start.  ')
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))

    expect(await screen.findByText('Result saved. 12 predictions compared.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(putBodies(calls)[0]?.body).toEqual({
      outcome: 'finished',
      timeSec: 14_170,
      date: raceDay,
      distanceM: 21_098,
      gainM: null,
      activityId: null,
      note: 'Cool start.',
    })

    // The goal now offers Edit, the same button keeps focus, and the record lists the race.
    const edit = await screen.findByRole('button', { name: EDIT_BUTTON })
    expect(edit).toHaveFocus()
    expect(await raceCard('Spring half')).toHaveTextContent('Result 3:56:10')
    expect(screen.queryByRole('button', { name: RECORD_BUTTON })).toBeNull()
  })

  test('the closing toast counts one prediction in the singular', async () => {
    const user = userEvent.setup()
    const state = world()
    mockApi(routes(state, putResult(state, { scoredPredictions: 1 })))
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    await user.type(within(dialog).getByLabelText('Finish time (h:mm:ss)'), '3:56:10')
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    expect(await screen.findByText('Result saved. 1 prediction compared.')).toBeInTheDocument()
  })

  test('a race not finished needs no time, is saved without one, and nothing is compared', async () => {
    const user = userEvent.setup()
    const state = world()
    const { calls } = mockApi(routes(state, putResult(state, { scoredPredictions: 0 })))
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    await user.type(within(dialog).getByLabelText('Finish time (h:mm:ss)'), '1:00:00')
    await user.click(within(dialog).getByRole('radio', { name: 'Did not finish' }))
    expect(within(dialog).queryByLabelText('Finish time (h:mm:ss)')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))

    expect(
      await screen.findByText('Result saved. Nothing to compare for a race not finished.'),
    ).toBeInTheDocument()
    expect(putBodies(calls)[0]?.body).toMatchObject({ outcome: 'did-not-finish', timeSec: null })
  })

  test('a time that is missing or not a time is refused in the sheet, with focus on the field', async () => {
    const user = userEvent.setup()
    const state = world()
    const { calls } = mockApi(routes(state, putResult(state)))
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    const time = within(dialog).getByLabelText('Finish time (h:mm:ss)')
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    expect(await within(dialog).findByText('Enter the official finish time.')).toBeInTheDocument()
    expect(time).toHaveAttribute('aria-invalid', 'true')
    expect(time).toHaveFocus()

    await user.type(time, 'soon')
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    expect(await within(dialog).findByText('Enter a time like 3:52:10.')).toBeInTheDocument()
    expect(time).toHaveFocus()
    expect(putBodies(calls)).toHaveLength(0)
    expectCleanCopy(dialog)
  })

  test('the server s refusals appear under their fields, in the templates words, with focus on the first', async () => {
    const user = userEvent.setup()
    const state = world()
    const { calls } = mockApi(
      routes(state, {
        'PUT /api/goals/g1/result': () =>
          problem(400, 'validation', 'Some fields need attention.', [
            { path: 'date', message: resultRefusal('date-passed') },
            { path: 'distanceM', message: resultRefusal('distance') },
            { path: 'activityId', message: activityWindowRefusal(RESULT_ACTIVITY_WINDOW_DAYS) },
          ]),
      }),
    )
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    await user.type(within(dialog).getByLabelText('Finish time (h:mm:ss)'), '3:56:10')
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))

    const date = within(dialog).getByLabelText('Race date')
    await waitFor(() => {
      expect(date).toHaveAccessibleDescription('Use a race date that has passed.')
    })
    expect(date).toHaveFocus()
    expect(within(dialog).getByLabelText('Distance (mi)')).toHaveAccessibleDescription(
      'Enter the distance that was raced.',
    )
    expect(within(dialog).getByLabelText('Activity')).toHaveAccessibleDescription(
      'Choose an activity within 3 days of the race date.',
    )
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')?.textContent ?? '').toBe('')
    expect(putBodies(calls)).toHaveLength(1)
    expectCleanCopy(dialog)
  })

  test('an activity that is another race s result is refused under Activity', async () => {
    const user = userEvent.setup()
    const state = world({
      activities: [makeActivity({ id: 'a-run', date: raceDay, type: 'run' })],
    })
    mockApi(
      routes(state, {
        'PUT /api/goals/g1/result': () => problem(409, 'conflict', resultRefusal('activity-taken')),
      }),
    )
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    await within(dialog).findByRole('option', { name: /run/ })
    await user.selectOptions(within(dialog).getByLabelText('Activity'), 'a-run')
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))

    const select = within(dialog).getByLabelText('Activity')
    await waitFor(() => {
      expect(select).toHaveAccessibleDescription(
        'That activity is already linked to the result of another race.',
      )
    })
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveFocus()
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  test('a failure no field explains is shown above the buttons', async () => {
    const user = userEvent.setup()
    const state = world()
    mockApi(
      routes(state, {
        'PUT /api/goals/g1/result': () => problem(404, 'not-found', 'Goal not found.'),
      }),
    )
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    await user.type(within(dialog).getByLabelText('Finish time (h:mm:ss)'), '3:56:10')
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Result not saved. Goal not found.',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('a distance left alone goes back as stored metres, a typed one is read in the runner s units, a goal s climb is kept', async () => {
    const user = userEvent.setup()
    const state = world({ goals: [makeGoal({ distanceM: 15_000, gainM: 800 })] })
    const { calls } = mockApi(routes(state, putResult(state)))
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    expect(within(dialog).getByLabelText('Distance (mi)')).toHaveValue('9.32')
    await user.type(within(dialog).getByLabelText('Finish time (h:mm:ss)'), '1:30:00')
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    await waitFor(() => {
      expect(putBodies(calls)).toHaveLength(1)
    })
    expect(putBodies(calls)[0]?.body).toMatchObject({ distanceM: 15_000, gainM: 800 })

    // Typing over it is read as miles.
    const again = await openSheet(user, EDIT_BUTTON)
    const distance = within(again).getByLabelText('Distance (mi)')
    await user.clear(distance)
    await user.type(distance, '10')
    await user.click(within(again).getByRole('button', { name: 'Save result' }))
    await waitFor(() => {
      expect(putBodies(calls)).toHaveLength(2)
    })
    expect(putBodies(calls)[1]?.body).toMatchObject({ distanceM: 16_093 })
  })

  test('a goal without a distance sends none, and the server s refusal appears under Distance', async () => {
    const user = userEvent.setup()
    const state = world({ goals: [makeGoal({ distanceM: null })] })
    const { calls } = mockApi(
      routes(state, {
        'PUT /api/goals/g1/result': () =>
          problem(400, 'validation', 'Some fields need attention.', [
            { path: 'distanceM', message: resultRefusal('distance') },
          ]),
      }),
    )
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    expect(within(dialog).getByLabelText('Distance (mi)')).toHaveValue('')
    await user.type(within(dialog).getByLabelText('Finish time (h:mm:ss)'), '3:56:10')
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Distance (mi)')).toHaveAccessibleDescription(
        'Enter the distance that was raced.',
      )
    })
    expect(putBodies(calls)[0]?.body).toMatchObject({ distanceM: null })
  })

  test('Escape closes the sheet and focus goes back to the button that opened it', async () => {
    const user = userEvent.setup()
    mockApi(routes(world()))
    renderPage()

    await openSheet(user, RECORD_BUTTON)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: RECORD_BUTTON })).toHaveFocus()
  })
})

// ---------------------------------------------------------------------------------------------
// Editing and removing
// ---------------------------------------------------------------------------------------------

describe('Editing and removing a result', () => {
  const stored = () =>
    makeRace({
      date: raceDay,
      resultSec: 14_170,
      activityId: 'a-run',
      note: 'Windy on the back half.',
      gainM: 120,
    })

  function recorded(extra: Partial<World> = {}) {
    return world({
      record: makeRecord([stored()]),
      activities: [
        makeActivity({
          id: 'a-run',
          date: raceDay,
          type: 'race',
          durationSec: 14_170,
          distanceM: 21_098,
        }),
      ],
      ...extra,
    })
  }

  test('starts from the stored result and sends it back whole, with the stored climb', async () => {
    const user = userEvent.setup()
    const state = recorded()
    const { calls } = mockApi(routes(state, putResult(state)))
    renderPage()

    const dialog = await openSheet(user, EDIT_BUTTON)
    expect(dialog).toHaveAccessibleName('Edit result')
    expect(within(dialog).getByRole('radio', { name: 'Finished' })).toBeChecked()
    expect(within(dialog).getByLabelText('Finish time (h:mm:ss)')).toHaveValue('3:56:10')
    expect(within(dialog).getByLabelText('Race date')).toHaveValue(raceDay)
    expect(within(dialog).getByLabelText('Distance (mi)')).toHaveValue('13.11')
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('Windy on the back half.')
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Activity')).toHaveValue('a-run')
    })
    expect(within(dialog).getByRole('button', { name: 'Remove result' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    await waitFor(() => {
      expect(putBodies(calls)).toHaveLength(1)
    })
    expect(putBodies(calls)[0]?.body).toEqual({
      outcome: 'finished',
      timeSec: 14_170,
      date: raceDay,
      distanceM: 21_098,
      gainM: 120,
      activityId: 'a-run',
      note: 'Windy on the back half.',
    })
  })

  test('shows a linked activity before the list has loaded, and unlinking sends none', async () => {
    const user = userEvent.setup()
    const state = recorded()
    const { calls } = mockApi(routes(state, putResult(state)))
    renderPage()

    const dialog = await openSheet(user, EDIT_BUTTON)
    const select = within(dialog).getByLabelText('Activity')
    await waitFor(() => {
      expect(within(dialog).getByRole('option', { name: /race$/ })).toBeInTheDocument()
    })
    await user.selectOptions(select, '')
    expect(select).toHaveValue('')
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    await waitFor(() => {
      expect(putBodies(calls)).toHaveLength(1)
    })
    expect(putBodies(calls)[0]?.body).toMatchObject({ activityId: null })
  })

  test('a stored race not finished opens as one, without a time', async () => {
    const user = userEvent.setup()
    const dnf = makeRace({
      outcome: 'did-not-finish',
      resultSec: null,
      points: [],
      headline: null,
      inside: null,
    })
    mockApi(routes(world({ record: makeRecord([dnf]) })))
    renderPage()

    const dialog = await openSheet(user, EDIT_BUTTON)
    expect(within(dialog).getByRole('radio', { name: 'Did not finish' })).toBeChecked()
    expect(within(dialog).queryByLabelText('Finish time (h:mm:ss)')).toBeNull()
  })

  test('Remove result asks first, in the template s words; Cancel and Escape close only the question', async () => {
    const user = userEvent.setup()
    const state = recorded()
    const { calls } = mockApi(routes(state))
    renderPage()

    const dialog = await openSheet(user, EDIT_BUTTON)
    await user.click(within(dialog).getByRole('button', { name: 'Remove result' }))
    const question = within(dialog).getByRole('group', { name: /^Remove this result\?/ })
    const text = within(question).getByText(
      'Remove this result? The weekly predictions stay logged and are no longer compared.',
    )
    expect(text).toHaveFocus()
    // The opener is replaced by the question's own button.
    expect(within(dialog).getAllByRole('button', { name: 'Remove result' })).toHaveLength(1)
    expectCleanCopy(dialog)

    await user.click(within(question).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).queryByRole('group')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Remove result' })).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Remove result' }))
    await user.keyboard('{Escape}')
    expect(within(dialog).queryByRole('group')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Edit result' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove result' })).toHaveFocus()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  test('confirming removes the result, says so, and the goal and the record forget it', async () => {
    const user = userEvent.setup()
    const state = recorded()
    const { calls } = mockApi(
      routes(state, {
        'DELETE /api/goals/g1/result': () => {
          state.record = makeRecord()
          return { status: 204, body: undefined }
        },
      }),
    )
    renderPage()

    const dialog = await openSheet(user, EDIT_BUTTON)
    await user.click(within(dialog).getByRole('button', { name: 'Remove result' }))
    await user.click(within(dialog).getByRole('button', { name: 'Remove result' }))

    expect(await screen.findByText('Result removed.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      '/api/goals/g1/result',
    ])
    const record = await screen.findByRole('button', { name: RECORD_BUTTON })
    expect(record).toHaveFocus()
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Spring half', level: 3 })).toBeNull()
    })
    expect(await recordSection()).toHaveTextContent('No race compared so far.')
  })

  test('a removal that fails keeps the question open with the server s words', async () => {
    const user = userEvent.setup()
    mockApi(
      routes(recorded(), {
        'DELETE /api/goals/g1/result': () => problem(404, 'not-found', resultRefusal('no-result')),
      }),
    )
    renderPage()

    const dialog = await openSheet(user, EDIT_BUTTON)
    await user.click(within(dialog).getByRole('button', { name: 'Remove result' }))
    await user.click(within(dialog).getByRole('button', { name: 'Remove result' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No result is recorded for this goal.',
    )
    expect(within(dialog).getByRole('group')).toBeInTheDocument()
  })

  test('editing the date by hand moves the activity window', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(routes(world()))
    renderPage()

    const dialog = await openSheet(user, RECORD_BUTTON)
    const earlier = addDays(raceDay, -20)
    fireEvent.change(within(dialog).getByLabelText('Race date'), { target: { value: earlier } })
    await waitFor(() => {
      expect(
        calls.some((c) => c.url.includes(`from=${addDays(earlier, -RESULT_ACTIVITY_WINDOW_DAYS)}`)),
      ).toBe(true)
    })
  })
})

describe('The chart scale', () => {
  test('rounds around the ranges and the result, with the result always inside', () => {
    const { domain, ticks } = timeScale([13_200, 14_640, 14_170])
    expect(domain).toEqual([13_200, 15_000])
    expect(ticks).toEqual([13_200, 13_800, 14_400, 15_000])

    // A result far outside every range widens the scale instead of being clipped.
    const wide = timeScale([13_200, 14_640, 18_000])
    expect(wide.domain[0]).toBeLessThanOrEqual(13_200)
    expect(wide.domain[1]).toBeGreaterThanOrEqual(18_000)
    expect(wide.ticks.length).toBeLessThanOrEqual(6)
  })

  test('gives a single time a span to draw in', () => {
    const { domain, ticks } = timeScale([14_000])
    expect(domain[1]).toBeGreaterThan(domain[0])
    expect(ticks.length).toBeGreaterThanOrEqual(2)
  })
})

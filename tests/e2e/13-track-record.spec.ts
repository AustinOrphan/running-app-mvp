import { expect, test, type Locator, type Page } from '@playwright/test'
import { addDays, daysBetween, mondayOf, todayIso } from '../../shared/dates.ts'
import {
  resetData,
  seedPredictionLogs,
  signedInApi,
  toast,
  type Api,
  type SeededPrediction,
} from './helpers.ts'

// Recording the result of a goal race from the Goals page (phase 3a design 11.6, rule L7): the
// sheet, the activity link that marks a run as a race, the prediction track record that follows,
// editing and removing the result again, the summary across races once there are three, and the
// 360 px layout.

const TRACK_RECORD = 'Prediction track record'
const HALF_M = 21_097

/**
 * Three weekly predictions for a race that is already over: 26, 19 and 12 days before it, each in
 * a different local week. The last one (3 h 52 min, 3 h 40 min to 4 h 4 min) is the headline.
 */
const WEEKLY: SeededPrediction[] = [
  { daysBefore: 26, predictedSec: 14_400, lowSec: 13_680, highSec: 15_120 },
  { daysBefore: 19, predictedSec: 14_100, lowSec: 13_380, highSec: 14_820 },
  { daysBefore: 12, predictedSec: 13_920, lowSec: 13_200, highSec: 14_640 },
]

/** A goal whose race day passed `daysAgo` days ago. */
async function createPastGoal(api: Api, name: string, daysAgo: number) {
  const raceDay = addDays(todayIso(), -daysAgo)
  const goal = (await api.post('/goals', {
    name,
    priority: 'A',
    targetDate: raceDay,
    distanceM: HALF_M,
    goalType: 'finish',
  })) as { id: string }
  return { goal, raceDay }
}

/**
 * A goal whose race day passed 30 days ago, a run on that day that could have been the race and
 * the three weekly predictions that were logged before it.
 */
async function seedPastRace(page: Page, baseURL: string | undefined) {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  const { goal, raceDay } = await createPastGoal(api, 'Result half', 30)
  const run = (await api.post('/activities', {
    date: raceDay,
    type: 'run',
    durationSec: 14_170,
    distanceM: HALF_M,
  })) as { id: string }
  await seedPredictionLogs(goal.id, raceDay, WEEKLY)
  return { api, raceDay, goal, run }
}

/** How far the page reaches past the viewport sideways, in pixels. */
function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/**
 * The row of the weekly table for the prediction made `daysBefore` days before the race. Its first
 * cell counts calendar weeks (Monday to Monday), so the expected number comes from the clock-based
 * race day. The `has` locator starts at the page: Playwright looks for it inside each row.
 */
function weeklyRow(table: Locator, raceDay: string, daysBefore: number): Locator {
  const weeks = daysBetween(mondayOf(addDays(raceDay, -daysBefore)), mondayOf(raceDay)) / 7
  return table
    .getByRole('row')
    .filter({ has: table.page().getByRole('rowheader', { name: String(weeks), exact: true }) })
}

/** What the log holds for a goal: how many rows, and the result each one is scored against. */
async function loggedActuals(api: Api, goalId: string): Promise<Array<number | null>> {
  const view = (await api.get(`/predictions?goalId=${goalId}`)) as {
    log: Array<{ actualSec: number | null }>
  }
  return view.log.map((entry) => entry.actualSec)
}

test('records, persists, changes and removes a result, and the weekly predictions follow it', async ({
  page,
  baseURL,
}) => {
  const { api, raceDay, goal, run } = await seedPastRace(page, baseURL)
  await page.goto('/goals')

  // Before any result the record explains itself and promises no pattern, and the log holds the
  // three weekly predictions with nothing to compare them with.
  const record = page.getByRole('region', { name: TRACK_RECORD })
  await expect(record).toContainText(
    'The app writes down its predicted finish time once a week. After a race, each prediction is compared with what happened.',
  )
  await expect(record).toContainText(
    'No race compared so far. A summary across races needs 3 more; until then each race stands on its own.',
  )
  expect(await loggedActuals(api, goal.id)).toEqual([null, null, null])

  // Record the result, linking the run: the sheet fills in what the run records and says what the
  // link does before anything is saved.
  await page.getByRole('button', { name: 'Record result for Result half' }).click()
  const sheet = page.getByRole('dialog', { name: 'Record result' })
  await expect(sheet.getByRole('radio', { name: 'Finished' })).toBeFocused()
  await sheet.getByLabel('Activity').selectOption(run.id)
  await expect(sheet.getByLabel('Finish time (h:mm:ss)')).toHaveValue('3:56:10')
  await expect(sheet.getByText(/^Linking marks this activity as a race/)).toBeVisible()
  await sheet.getByLabel('Notes').fill('Cool and calm.')
  await sheet.getByRole('button', { name: 'Save result' }).click()

  await expect(toast(page, 'Result saved. 3 predictions compared.')).toBeVisible()
  await expect(sheet).toBeHidden()
  // The same button keeps focus and now edits.
  await expect(page.getByRole('button', { name: 'Edit result for Result half' })).toBeFocused()
  const race = record.getByRole('listitem').filter({ hasText: 'Result half' })
  await expect(race).toContainText('Result 3:56:10')
  await expect(race).toContainText(
    'The last prediction, made 12 days before the race, was 3 h 52 min (3 h 40 min to 4 h 4 min). ' +
      'The result was 4 min 10 s slower than predicted (1.8%), inside the range.',
  )
  // The linked activity became a race, and each prediction now holds the result it is scored against.
  expect(((await api.get(`/activities/${run.id}`)) as { type: string }).type).toBe('race')
  expect(await loggedActuals(api, goal.id)).toEqual([14_170, 14_170, 14_170])

  // It stays after a reload, and the sheet opens on what was saved.
  await page.reload()
  await expect(race).toContainText('Result 3:56:10')
  await expect(race).toContainText('4 min 10 s slower than predicted (1.8%), inside the range.')
  await page.getByRole('button', { name: 'Edit result for Result half' }).click()
  const editing = page.getByRole('dialog', { name: 'Edit result' })
  await expect(editing.getByLabel('Finish time (h:mm:ss)')).toHaveValue('3:56:10')
  await expect(editing.getByLabel('Notes')).toHaveValue('Cool and calm.')
  await expect(editing.getByLabel('Activity')).toHaveValue(run.id)

  // A time that is not a time is refused in the sheet; a corrected one replaces the result and
  // scores every prediction again, here as outside the last range.
  const time = editing.getByLabel('Finish time (h:mm:ss)')
  await time.fill('soon')
  await editing.getByRole('button', { name: 'Save result' }).click()
  await expect(editing.getByText('Enter a time like 3:52:10.')).toBeVisible()
  await expect(time).toBeFocused()
  expect(await loggedActuals(api, goal.id)).toEqual([14_170, 14_170, 14_170])
  await time.fill('3:36:00')
  await editing.getByRole('button', { name: 'Save result' }).click()
  await expect(toast(page, 'Result saved. 3 predictions compared.')).toBeVisible()
  await expect(race).toContainText('Result 3:36:00')
  await expect(race).toContainText(
    'The result was 16 min faster than predicted (6.9%), outside the range.',
  )
  expect(await loggedActuals(api, goal.id)).toEqual([12_960, 12_960, 12_960])

  // The change is stored, not only shown.
  await page.reload()
  await expect(race).toContainText('Result 3:36:00')
  await expect(race).toContainText('16 min faster than predicted (6.9%), outside the range.')
  const table = race.getByRole('table', {
    name: 'Weekly predictions for Result half compared with the result.',
  })
  await expect(weeklyRow(table, raceDay, 12).getByRole('cell')).toHaveText([
    '3 h 52 min',
    '3 h 40 min to 4 h 4 min',
    '16 min faster (6.9%)',
    'No',
  ])

  // Removing asks first and keeps the sheet open until it is confirmed.
  await page.getByRole('button', { name: 'Edit result for Result half' }).click()
  const removing = page.getByRole('dialog', { name: 'Edit result' })
  await removing.getByRole('button', { name: 'Remove result' }).click()
  await expect(
    removing.getByText(
      'Remove this result? The weekly predictions stay logged and are no longer compared.',
    ),
  ).toBeFocused()
  await removing.getByRole('button', { name: 'Cancel' }).click()
  await expect(removing.getByRole('button', { name: 'Remove result' })).toBeFocused()
  expect(await loggedActuals(api, goal.id)).toEqual([12_960, 12_960, 12_960])
  await removing.getByRole('button', { name: 'Remove result' }).click()
  await removing.getByRole('group').getByRole('button', { name: 'Remove result' }).click()

  await expect(toast(page, 'Result removed.')).toBeVisible()
  await expect(removing).toBeHidden()
  await expect(page.getByRole('button', { name: 'Record result for Result half' })).toBeFocused()
  await expect(record.getByRole('listitem')).toHaveCount(0)
  await expect(record).toContainText('No race compared so far.')

  // The weekly predictions stay logged and are no longer compared, also after a reload.
  expect(await loggedActuals(api, goal.id)).toEqual([null, null, null])
  await page.reload()
  await expect(page.getByRole('button', { name: 'Record result for Result half' })).toBeVisible()
  await expect(record.getByRole('listitem')).toHaveCount(0)
})

test('the summary across races waits for the third race', async ({ page, baseURL }) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()

  // Three finished half marathons, each with one prediction, made 12 days before. Against it the
  // results are 4 min 10 s (1.8%) slower and inside the range, 6 min 40 s (2.8%) faster and
  // inside, and 15 min (6.3%) slower and outside: two inside, the median 1.8% slower.
  const races = [
    {
      name: 'Spring half',
      daysAgo: 30,
      predicted: 13_920,
      low: 13_200,
      high: 14_640,
      result: 14_170,
    },
    {
      name: 'Autumn half',
      daysAgo: 120,
      predicted: 14_100,
      low: 13_380,
      high: 14_820,
      result: 13_700,
    },
  ]
  for (const race of races) {
    const { goal, raceDay } = await createPastGoal(api, race.name, race.daysAgo)
    await seedPredictionLogs(goal.id, raceDay, [
      { daysBefore: 12, predictedSec: race.predicted, lowSec: race.low, highSec: race.high },
    ])
    await api.put(`/goals/${goal.id}/result`, {
      outcome: 'finished',
      timeSec: race.result,
      date: raceDay,
      distanceM: HALF_M,
    })
  }
  const winter = await createPastGoal(api, 'Winter half', 210)
  await seedPredictionLogs(winter.goal.id, winter.raceDay, [
    { daysBefore: 12, predictedSec: 14_400, lowSec: 13_680, highSec: 15_120 },
  ])

  await page.goto('/goals')
  const record = page.getByRole('region', { name: TRACK_RECORD })
  await expect(record.getByRole('listitem')).toHaveCount(2)
  await expect(record).toContainText(
    'Two races compared so far. A summary across races needs 1 more; until then each race stands on its own.',
  )
  await expect(record).not.toContainText('Across 3 races')

  // The third result, recorded in the sheet, turns the sentence without a reload.
  await page.getByRole('button', { name: 'Record result for Winter half' }).click()
  const sheet = page.getByRole('dialog', { name: 'Record result' })
  await sheet.getByLabel('Finish time (h:mm:ss)').fill('4:15:00')
  await sheet.getByRole('button', { name: 'Save result' }).click()
  await expect(toast(page, 'Result saved. 1 prediction compared.')).toBeVisible()

  await expect(record).toContainText(
    'Across 3 races the result was inside the predicted range twice. The median difference was 1.8% slower than predicted.',
  )
  await expect(record).not.toContainText('compared so far')
  await expect(record.getByRole('listitem')).toHaveCount(3)
  await expect(record.getByRole('listitem').filter({ hasText: 'Winter half' })).toContainText(
    'The result was 15 min slower than predicted (6.3%), outside the range.',
  )
})

test('the weekly predictions are compared with the result, and it all fits 360 px', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  const { raceDay, run } = await seedPastRace(page, baseURL)
  await page.goto('/goals')

  await page.getByRole('button', { name: 'Record result for Result half' }).click()
  const sheet = page.getByRole('dialog', { name: 'Record result' })
  await sheet.getByLabel('Activity').selectOption(run.id)
  const box = await sheet.boundingBox()
  expect(box).not.toBeNull()
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360 + 0.5)
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
  const save = sheet.getByRole('button', { name: 'Save result' })
  await expect(save).toBeInViewport()
  await save.click()
  await expect(toast(page, 'Result saved. 3 predictions compared.')).toBeVisible()

  // The last prediction against the result, in words, then the chart and the table.
  const record = page.getByRole('region', { name: TRACK_RECORD })
  const race = record.getByRole('listitem')
  await expect(race).toHaveCount(1)
  await expect(race).toContainText(
    'The last prediction, made 12 days before the race, was 3 h 52 min (3 h 40 min to 4 h 4 min). ' +
      'The result was 4 min 10 s slower than predicted (1.8%), inside the range.',
  )
  const chart = race.getByRole('img', {
    name: 'Weekly predicted finish times and ranges for Result half, against the result',
  })
  await chart.scrollIntoViewIfNeeded()
  const chartBox = await chart.boundingBox()
  expect(chartBox?.width ?? 0).toBeGreaterThan(200)
  expect(chartBox?.height ?? 0).toBeGreaterThan(100)
  await expect(chart.locator('svg')).toBeVisible()
  const table = race.getByRole('table', {
    name: 'Weekly predictions for Result half compared with the result.',
  })
  await expect(table.getByRole('row')).toHaveCount(4)
  await expect(table.getByRole('columnheader')).toHaveText([
    'Weeks before',
    'Predicted',
    'Range',
    'Result against prediction',
    'In range',
  ])
  // Every week's prediction against the same result, each with the direction in words: the result
  // was faster than the earliest prediction and slower than the middle one.
  await expect(weeklyRow(table, raceDay, 26).getByRole('cell')).toHaveText([
    '4 h',
    '3 h 48 min to 4 h 12 min',
    '3 min 50 s faster (1.6%)',
    'Yes',
  ])
  await expect(weeklyRow(table, raceDay, 19).getByRole('cell')).toHaveText([
    '3 h 55 min',
    '3 h 43 min to 4 h 7 min',
    '1 min 10 s slower (0.5%)',
    'Yes',
  ])
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0)

  // The table is wider than the screen and scrolls inside its own region, not the page.
  const region = race.getByRole('region', {
    name: 'Weekly predictions for Result half compared with the result.',
  })
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

  // The edit sheet, with its removal question open, still fits.
  await page.getByRole('button', { name: 'Edit result for Result half' }).click()
  const editing = page.getByRole('dialog', { name: 'Edit result' })
  await editing.getByRole('button', { name: 'Remove result' }).click()
  const cancel = editing.getByRole('button', { name: 'Cancel' })
  await cancel.scrollIntoViewIfNeeded()
  await expect(cancel).toBeInViewport()
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
})

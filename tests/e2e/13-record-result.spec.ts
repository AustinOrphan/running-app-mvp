import { expect, test, type Page } from '@playwright/test'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { RUNNER, resetData, signedInApi, toast } from './helpers.ts'

// Recording the result of a goal race from the Goals page (phase 3a design 11.6): the sheet, the
// activity link that marks a run as a race, the prediction track record that follows, and removing
// the result again.

const TRACK_RECORD = 'Prediction track record'

/** A goal whose race day has passed, and a run on that day that could have been the race. */
async function seedPastRace(page: Page, baseURL: string | undefined) {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  const raceDay = addDays(todayIso(), -30)
  const goal = (await api.post('/goals', {
    name: 'Result half',
    priority: 'A',
    targetDate: raceDay,
    distanceM: 21_097,
    goalType: 'finish',
  })) as { id: string }
  const run = (await api.post('/activities', {
    date: raceDay,
    type: 'run',
    durationSec: 14_170,
    distanceM: 21_097,
  })) as { id: string }
  return { api, raceDay, goal, run }
}

/**
 * Three weekly predictions for a race that is already over: 26, 19 and 12 days before it. The weekly
 * log is written on the day a prediction is made, so a test cannot get a past race's predictions
 * from the API; the rows are written through Prisma, as the app would have written them then.
 */
async function seedWeeklyPredictions(goalId: string, raceDay: string) {
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: RUNNER.email } })
    const weeks = [
      { daysBefore: 26, predictedSec: 14_400, lowSec: 13_680, highSec: 15_120 },
      { daysBefore: 19, predictedSec: 14_100, lowSec: 13_380, highSec: 14_820 },
      { daysBefore: 12, predictedSec: 13_920, lowSec: 13_200, highSec: 14_640 },
    ]
    for (const week of weeks) {
      const loggedOn = addDays(raceDay, -week.daysBefore)
      await prisma.predictionLog.create({
        data: {
          userId: user.id,
          goalId,
          method: 'Critical speed',
          predictedSec: week.predictedSec,
          lowSec: week.lowSec,
          highSec: week.highSec,
          weekStart: mondayOf(loggedOn),
          loggedOn,
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

/** How far the page reaches past the viewport sideways, in pixels. */
function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

test('records, changes and removes the result of a race, and the record follows', async ({
  page,
  baseURL,
}) => {
  const { api, run } = await seedPastRace(page, baseURL)
  await page.goto('/goals')

  // Before any result the record explains itself and promises no pattern.
  const record = page.getByRole('region', { name: TRACK_RECORD })
  await expect(record).toContainText(
    'The app writes down its predicted finish time once a week. After a race, each prediction is compared with what happened.',
  )
  await expect(record).toContainText(
    'No race compared so far. A summary across races needs 3 more; until then each race stands on its own.',
  )

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

  await expect(toast(page, /^Result saved\./)).toBeVisible()
  await expect(sheet).toBeHidden()
  // The same button keeps focus and now edits.
  const edit = page.getByRole('button', { name: 'Edit result for Result half' })
  await expect(edit).toBeFocused()
  const race = record.getByRole('listitem').filter({ hasText: 'Result half' })
  await expect(race).toContainText('Result 3:56:10')
  await expect(race).toContainText(
    'No predictions were logged before this race, so there is nothing to compare.',
  )
  expect(((await api.get(`/activities/${run.id}`)) as { type: string }).type).toBe('race')

  // It stays after a reload, and the sheet opens on what was saved.
  await page.reload()
  await expect(race).toContainText('Result 3:56:10')
  await page.getByRole('button', { name: 'Edit result for Result half' }).click()
  const editing = page.getByRole('dialog', { name: 'Edit result' })
  await expect(editing.getByLabel('Finish time (h:mm:ss)')).toHaveValue('3:56:10')
  await expect(editing.getByLabel('Notes')).toHaveValue('Cool and calm.')
  await expect(editing.getByLabel('Activity')).toHaveValue(run.id)

  // A time that is not a time is refused in the sheet; a corrected one replaces the result.
  const time = editing.getByLabel('Finish time (h:mm:ss)')
  await time.fill('soon')
  await editing.getByRole('button', { name: 'Save result' }).click()
  await expect(editing.getByText('Enter a time like 3:52:10.')).toBeVisible()
  await expect(time).toBeFocused()
  await time.fill('3:50:00')
  await editing.getByRole('button', { name: 'Save result' }).click()
  await expect(toast(page, /^Result saved\./)).toBeVisible()
  await expect(race).toContainText('Result 3:50:00')

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
  await removing.getByRole('button', { name: 'Remove result' }).click()
  await removing.getByRole('group').getByRole('button', { name: 'Remove result' }).click()

  await expect(toast(page, 'Result removed.')).toBeVisible()
  await expect(removing).toBeHidden()
  await expect(page.getByRole('button', { name: 'Record result for Result half' })).toBeFocused()
  await expect(record.getByRole('listitem')).toHaveCount(0)
  await expect(record).toContainText('No race compared so far.')
})

test('the weekly predictions are compared with the result, and it all fits 360 px', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  const { raceDay, goal, run } = await seedPastRace(page, baseURL)
  await seedWeeklyPredictions(goal.id, raceDay)
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

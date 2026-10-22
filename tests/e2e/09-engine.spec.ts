import { expect, test } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi, toast } from './helpers.ts'

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The weekday name of a `YYYY-MM-DD` date, as the Profile page labels its availability rows. */
function weekdayName(date: string): string {
  return WEEKDAY_NAMES[new Date(`${date}T12:00:00`).getDay()] ?? ''
}

// The golden path of the training engine: a profile and a goal with race descriptors, a generated
// plan, today's session with its reasons, the matching run rated afterwards, the plan's account of
// how it went, and a decided review of the finished week that re-plans.
test('profile, goal, plan, today, a rated run, its assessment, a review and what changed', async ({
  page,
  baseURL,
}) => {
  const { today, thisMonday, raceDate } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()

  // History through the API: eight weeks of four runs, so the engine has something to plan from.
  for (let week = 1; week <= 8; week += 1) {
    for (const [day, minutes] of [
      [0, 40],
      [2, 45],
      [4, 35],
      [5, 70],
    ] as const) {
      await api.post('/activities', {
        date: addDays(thisMonday, -7 * week + day),
        type: 'run',
        durationSec: minutes * 60,
        distanceM: minutes * 160,
        rpe: 3,
      })
    }
  }

  // Profile: age and a measured maximum heart rate give heart-rate zones; one day is closed. The
  // closed day is three days from today, never today itself, so today always has a session.
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()
  await page.getByLabel('Birth year').fill('1985')
  await page.getByLabel('Maximum heart rate', { exact: true }).fill('188')
  await page.getByLabel('Maximum heart rate source').selectOption('measured')
  await page.getByLabel(weekdayName(addDays(today, 3)), { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(toast(page, 'Profile saved')).toBeVisible()

  // Goal with race descriptors.
  await page.goto('/goals')
  await page.getByRole('button', { name: 'Add goal' }).click()
  const goalSheet = page.getByRole('dialog', { name: 'Add goal' })
  await goalSheet.getByLabel('Name').fill('Synthetic marathon')
  await goalSheet.getByRole('radio', { name: 'A', exact: true }).click()
  await goalSheet.getByLabel('Race date').fill(raceDate)
  await goalSheet.getByRole('button', { name: 'Marathon' }).click()
  await goalSheet.getByLabel('Elevation gain (m)').fill('250')
  await goalSheet.getByLabel('Surface').selectOption('mixed')
  await goalSheet.getByLabel('Start time').fill('07:00')
  await goalSheet.getByRole('button', { name: 'Save goal' }).click()
  await expect(toast(page, 'Goal saved')).toBeVisible()

  // Generate the plan from the Plan page.
  await page.goto('/plan')
  await page.getByRole('button', { name: 'Generate plan' }).click()
  await expect(toast(page, 'Plan generated')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Feasibility' })).toBeVisible()

  // Today's session: whichever run is planned for today.
  const plan = (await api.get('/plan')) as PlanWithSessions
  expect(plan.generatorVersion).toBe(2)
  const todays = plan.sessions.find(
    (s) => s.date === today && !['strength', 'mobility', 'rest'].includes(s.kind),
  )
  if (todays === undefined) throw new Error(`The plan has no run for ${today}.`)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()
  const card = page.getByRole('article', { name: todays.title })
  await expect(card).toBeVisible()
  await expect(card.getByText(todays.purpose)).toBeVisible()
  await card.getByRole('button', { name: 'Why this session' }).click()
  const why = page.getByRole('dialog', { name: 'Why this?' })
  await expect(why.getByRole('heading', { name: /^Rule / }).first()).toBeVisible()
  await expect(why.getByText(/Grade A is the strongest evidence/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(why).toBeHidden()

  // The run that fulfils it is logged; the server links it to the session at once.
  await api.post('/activities', {
    date: today,
    type: 'run',
    durationSec: todays.durationMin * 60,
    distanceM: todays.durationMin * 160,
  })

  // Rate it on Today: RPE and how it felt.
  await page.goto('/')
  const feedback = page.getByRole('region', { name: 'How did it go?' })
  await expect(feedback).toBeVisible()
  await feedback.getByRole('button', { name: 'RPE 4' }).click()
  await feedback.getByRole('button', { name: 'As expected' }).click()
  await feedback.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(feedback).toBeHidden()

  // The plan's session sheet shows the assessment of the linked run.
  await page.goto('/plan')
  // Only the linked session is marked completed, whatever else shares its title this week.
  await page.locator('button[data-status="completed"]').filter({ hasText: todays.title }).click()
  const sheet = page.getByRole('dialog', { name: todays.title })
  await expect(sheet.getByRole('heading', { name: 'How it went against the plan' })).toBeVisible()
  await expect(sheet.getByText('Completed as planned')).toBeVisible()
  // The rating counts as effort evidence, whichever way it compares with the session's range.
  await expect(
    sheet.getByText(/^(As expected|(Much )?(easier|harder) than expected), \w+ confidence$/i),
  ).toBeVisible()
  await expect(sheet.getByText('Linked automatically.')).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()

  // Review of last week, which finished before the plan began: a decided review re-plans.
  await page.goto('/review')
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible()
  await page.getByRole('radio', { name: 'Data complete' }).click()
  await page
    .getByRole('radiogroup', { name: 'Fatigue (1-10)' })
    .getByRole('radio', { name: '3', exact: true })
    .click()
  await page
    .getByRole('radiogroup', { name: 'Symptoms' })
    .getByRole('radio', { name: 'None' })
    .click()
  await page
    .getByRole('radiogroup', { name: 'Final decision' })
    .getByRole('radio', { name: 'Hold' })
    .click()
  await page.getByLabel('Next week minutes').fill('150')
  await page.getByRole('button', { name: 'Save review' }).click()
  await expect(toast(page, /^Week of .* saved$/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What changed' })).toBeVisible()

  // The same re-plan is listed on the Plan page, after the plan's own creation.
  await page.goto('/plan')
  await page.getByText('What changed', { exact: true }).click()
  await expect(page.getByText('After a review')).toBeVisible()
  await expect(page.getByText('Plan generated', { exact: true })).toBeVisible()
})

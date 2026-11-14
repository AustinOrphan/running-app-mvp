import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { relativeDates, resetData, RUNNER, signedInApi } from './helpers.ts'

// What the plan can see (rule T2): the counts of the data the engine reads. A runner whose watch
// reports heart-rate variability as SDNN sees that the plan does not use it. The wellness rows and
// the runs are synthetic and are written straight to the database, because the wellness API takes
// no source and the activity API takes no stream.

test.describe.configure({ mode: 'serial' })

const WIDTHS = [
  { width: 360, height: 740 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const

let page: Page

async function scrollsSideways(): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

async function seedSdnnRunner(): Promise<void> {
  const { today } = relativeDates()
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: RUNNER.email } })
    for (let i = 1; i <= 14; i += 1) {
      await prisma.wellnessDay.create({
        data: {
          userId: user.id,
          date: addDays(today, -i),
          hrvSdnn: 48,
          restingHr: 52,
          sleepSec: 7 * 3600,
          source: 'apple-health',
        },
      })
    }
    for (let i = 0; i < 3; i += 1) {
      const run = await prisma.activity.create({
        data: {
          userId: user.id,
          date: addDays(today, -(2 + i * 3)),
          type: 'run',
          durationSec: 2400,
          distanceM: 6000,
          source: 'manual',
        },
      })
      if (i === 0) {
        await prisma.activityStream.create({
          data: { activityId: run.id, sampleSec: 10, data: '{}' },
        })
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  page = await context.newPage()
  await signedInApi(page, baseURL ?? '')
  await resetData()
})

test.afterAll(async () => {
  await page.context().close()
})

test('with an empty log every count is zero and the page is type only', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/more')
  await page
    .getByRole('navigation', { name: 'More pages' })
    .getByRole('link', { name: /^What the plan can see/ })
    .click()
  await expect(page).toHaveURL(/\/plan-inputs$/)
  await expect(page.getByRole('heading', { level: 1, name: 'What the plan can see' })).toBeVisible()
  const hrv = page.getByRole('region', { name: 'Heart-rate variability' })
  await expect(hrv.getByText('No heart-rate variability readings are stored.')).toBeVisible()
  const sources = page.getByRole('region', { name: 'Sources' })
  await expect(sources.getByText('No activities or wellness days yet.')).toBeVisible()
  await expect(page.locator('main img, main svg')).toHaveCount(0)
  expect(await scrollsSideways()).toBe(false)
})

test('a runner whose watch reports SDNN is told the plan does not use it', async () => {
  await seedSdnnRunner()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/plan-inputs')

  const hrv = page.getByRole('region', { name: 'Heart-rate variability' })
  await expect(hrv.getByText(/SDNN readings, which the plan does not use/)).toBeVisible()
  await expect(hrv.getByText('Days with an SDNN reading').locator('..')).toContainText('14')
  await expect(
    hrv.getByText('rMSSD readings in the baseline for today').locator('..'),
  ).toContainText('0')

  const sleep = page.getByRole('region', { name: 'Sleep' })
  await expect(sleep.getByText('Nights recorded in the last 7').locator('..')).toContainText('7')

  const runs = page.getByRole('region', { name: 'Runs' })
  await expect(runs.getByText('Runs and races', { exact: true }).locator('..')).toContainText('3')
  await expect(runs.getByText('With a stored stream').locator('..')).toContainText('1')

  const sources = page.getByRole('region', { name: 'Sources' })
  await expect(sources.getByText('Apple Health: activities 0, wellness days 14')).toBeVisible()
})

test('Profile links to the page', async () => {
  await page.goto('/profile')
  await page.getByRole('link', { name: 'What the plan can see' }).click()
  await expect(page).toHaveURL(/\/plan-inputs$/)
  await expect(page.getByRole('heading', { level: 1, name: 'What the plan can see' })).toBeVisible()
})

for (const viewport of WIDTHS) {
  test(`the page stays inside ${String(viewport.width)} px`, async () => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/plan-inputs')
    await expect(page.getByRole('region', { name: 'Zones' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Sources' })).toBeVisible()
    expect(await scrollsSideways()).toBe(false)
  })
}

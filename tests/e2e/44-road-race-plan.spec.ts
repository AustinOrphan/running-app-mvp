import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { PlanSession } from '../../shared/types.ts'
import { createPrisma } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { planWithRunToday, relativeDates, signedInApi, type Api } from './helpers.ts'

// The road race plan (rule H15, ADR 0023) for each distance class, read by role at 360 px through the
// API-made goal: the Race page, the More row, and the race-week card on Today. The goal starts as the
// marathon with a plan and a run today (as the Today spec has it) and is edited into the class each
// case needs; the plan itself is not regenerated. A 10 km race result gives the prediction.

test.describe.configure({ mode: 'serial' })

const PHONE = { width: 360, height: 740 } as const

let page: Page
let api: Api
let goalId: string
let origin: string
let run: PlanSession

/** The goal as a race `daysAhead` days from today, on a road course, edited in place. */
async function raceOf(distanceM: number, daysAhead: number): Promise<void> {
  const { today } = relativeDates()
  await api.put(`/goals/${goalId}`, {
    distanceM,
    gainM: 0,
    lossM: 0,
    surface: 'road',
    goalType: 'finish',
    startTime: '08:00',
    targetDate: addDays(today, daysAhead),
  })
}

async function scrollsSideways(): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

test.beforeAll(async ({ browser, baseURL }) => {
  origin = baseURL ?? ''
  const context = await browser.newContext({ baseURL })
  page = await context.newPage()
  await page.setViewportSize(PHONE)
  api = await signedInApi(page, origin)
  run = await planWithRunToday(api, page, origin, 'Road race plan')
  const goals = (await api.get('/goals')) as Array<{ id: string }>
  goalId = goals[0]?.id ?? ''
  expect(goalId).not.toBe('')
  // A 10 km race in 46 minutes, so the half marathon's expected time falls under two hours.
  const { today } = relativeDates()
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    const user = await prisma.user.findFirstOrThrow()
    await prisma.activity.create({
      data: {
        userId: user.id,
        date: addDays(today, -30),
        type: 'race',
        durationSec: 46 * 60,
        movingSec: 46 * 60,
        distanceM: 10_000,
        rpe: 9,
        source: 'manual',
      },
    })
  } finally {
    await prisma.$disconnect()
  }
})

test.afterAll(async () => {
  await page.context().close()
})

async function openRacePage(): Promise<void> {
  await page.goto('/more')
  await page
    .getByRole('navigation', { name: 'More pages' })
    .getByRole('link', { name: /^Race plan/ })
    .click()
  await expect(page).toHaveURL(/\/race$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Race plan' })).toBeVisible()
}

test('a marathon on the road has the full road plan: time, pace, fuel, race week and what it leaves out', async () => {
  await raceOf(42_195, 40)
  await openRacePage()
  const headings = page.getByRole('heading', { level: 2 })
  await expect(headings.filter({ hasText: 'Expected time' })).toBeVisible()
  await expect(headings.filter({ hasText: 'Average pace' })).toBeVisible()
  await expect(headings.filter({ hasText: 'Fuel and fluid' })).toBeVisible()
  await expect(headings.filter({ hasText: 'Race week' })).toBeVisible()
  await expect(headings.filter({ hasText: 'Not in this plan' })).toBeVisible()
  // The ultra page's blocks do not appear for a road race.
  await expect(headings.filter({ hasText: 'Effort' })).toHaveCount(0)
  await expect(headings.filter({ hasText: 'Dark hours' })).toHaveCount(0)
  await expect(headings.filter({ hasText: 'Rehearsal' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit checkpoints' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Disclaimer' })).toBeVisible()
  const body = (await page.getByRole('main').textContent()) ?? ''
  expect(body).not.toMatch(/behind|missed|streak|minimum/i)
  expect(await scrollsSideways()).toBe(false)
  await page.screenshot({ path: test.info().outputPath('road-marathon-360.png') })
})

test('a half marathon under two hours has no fuel rate, and says why', async () => {
  await raceOf(21_097, 40)
  await openRacePage()
  const headings = page.getByRole('heading', { level: 2 })
  await expect(headings.filter({ hasText: 'Expected time' })).toBeVisible()
  await expect(headings.filter({ hasText: 'Average pace' })).toBeVisible()
  await expect(headings.filter({ hasText: 'First half' })).toHaveCount(0)
  await expect(headings.filter({ hasText: 'Fuel and fluid' })).toBeVisible()
  await expect(page.getByText(/The fuel ladder counts runs of .* or more/)).toBeVisible()
  expect(await scrollsSideways()).toBe(false)
})

test('a 10 km has the time and pace blocks only', async () => {
  await raceOf(10_000, 40)
  await openRacePage()
  const headings = page.getByRole('heading', { level: 2 })
  await expect(headings.filter({ hasText: 'Expected time' })).toBeVisible()
  await expect(headings.filter({ hasText: 'Average pace' })).toBeVisible()
  await expect(headings.filter({ hasText: 'Fuel and fluid' })).toHaveCount(0)
  await expect(headings.filter({ hasText: 'Race week' })).toHaveCount(0)
  await expect(headings.filter({ hasText: 'First half' })).toHaveCount(0)
})

test('a 5 km has no plan: the page says so and More has no row', async () => {
  await raceOf(5_000, 40)
  await page.goto('/more')
  const nav = page.getByRole('navigation', { name: 'More pages' })
  await expect(nav.getByRole('link', { name: /^Settings/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Race plan/ })).toHaveCount(0)
  await page.goto('/race')
  await expect(page.getByText(/The race plan covers 10 km, half marathons/)).toBeVisible()
})

test('Today shows the race-week card of a marathon and of a half, and none for a 10 km', async () => {
  for (const [distanceM, shows] of [
    [42_195, true],
    [21_097, true],
    [10_000, false],
  ] as const) {
    await raceOf(distanceM, 3)
    await page.goto('/')
    await expect(page.getByRole('article', { name: run.title })).toBeVisible()
    const slot = page.locator('[data-slot="race"]')
    if (shows) {
      await expect(slot.getByText('3 days to go')).toBeVisible()
      await expect(slot.getByRole('link', { name: /race plan/i })).toHaveAttribute('href', '/race')
    } else {
      await expect(slot.getByText(/days to go/)).toHaveCount(0)
    }
    expect(await scrollsSideways()).toBe(false)
  }
})

test('on the race day the card says so', async () => {
  await raceOf(42_195, 0)
  await page.goto('/')
  await expect(page.locator('[data-slot="race"]').getByText('Race day')).toBeVisible()
})

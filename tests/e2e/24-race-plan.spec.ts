import { expect, test, type Page } from '@playwright/test'
import { addDays, mondayOf } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { PlanSession, PlanWithSessions } from '../../shared/types.ts'
import { createPrisma } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { planWithRunToday, relativeDates, resetData, signedInApi, type Api } from './helpers.ts'

// The race plan of an ultra goal (rule H14, ADR 0018), read by role at the two phone widths the app
// is checked at: the empty states, the page, the More row, the race-week card on Today and the
// measured first screen with that card filled, the carbohydrate line and the race day. The goal
// starts as a marathon with a plan and a run today (as the Today spec has it) and is edited into
// a 100-mile race at the date each case needs; the plan itself is not regenerated.

test.describe.configure({ mode: 'serial' })

const WIDTHS = [
  { width: 390, height: 844, name: '390 x 844' },
  { width: 360, height: 740, name: '360 x 740' },
] as const

/** The tab bar under the content on a phone (`--tabbar-h`). */
const TAB_BAR_PX = 56

let page: Page
let api: Api
let goalId: string
let origin: string
let run: PlanSession

/** The goal as an ultra race `daysAhead` days from today, edited in place. */
async function raceIn(daysAhead: number, over: Record<string, unknown> = {}): Promise<void> {
  const { today } = relativeDates()
  await api.put(`/goals/${goalId}`, {
    distanceM: 160_934,
    gainM: 5000,
    lossM: 5000,
    surface: 'trail',
    goalType: 'finish',
    startTime: '06:00',
    supportLevel: 'aided',
    targetDate: addDays(today, daysAhead),
    ...over,
  })
}

async function scrollsSideways(): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

/** The bottom edge of the hero's Done button, from the top of the viewport. */
async function doneBottom(): Promise<number> {
  const box = await page
    .getByRole('article', { name: run.title })
    .getByRole('button', { name: 'Done', exact: true })
    .boundingBox()
  if (box === null) throw new Error('Done has no box on the page.')
  return box.y + box.height
}

test.beforeAll(async ({ browser, baseURL }) => {
  origin = baseURL ?? ''
  const context = await browser.newContext({ baseURL })
  page = await context.newPage()
  api = await signedInApi(page, origin)
  run = await planWithRunToday(api, page, origin, 'Race plan marathon')
  const goals = (await api.get('/goals')) as Array<{ id: string }>
  goalId = goals[0]?.id ?? ''
  expect(goalId).not.toBe('')
})

test.afterAll(async () => {
  await page.context().close()
})

test('a marathon goal has no race plan: the page says so and More has no row', async () => {
  await page.goto('/more')
  const nav = page.getByRole('navigation', { name: 'More pages' })
  await expect(nav.getByRole('link', { name: /^Settings/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Race plan/ })).toHaveCount(0)
  await page.goto('/race')
  await expect(page.getByRole('heading', { level: 1, name: 'Race plan' })).toBeVisible()
  await expect(page.getByText('The race plan is for ultra distances.')).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('article', { name: run.title })).toBeVisible()
  await expect(page.locator('[data-slot="race"]')).toHaveCount(0)
})

for (const viewport of WIDTHS) {
  test(`the race plan page reads by role at ${viewport.name}, from the More row`, async () => {
    await raceIn(40)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/more')
    await page
      .getByRole('navigation', { name: 'More pages' })
      .getByRole('link', { name: /^Race plan/ })
      .click()
    await expect(page).toHaveURL(/\/race$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Race plan' })).toBeVisible()

    const headings = page.getByRole('heading', { level: 2 })
    await expect(headings.filter({ hasText: 'Expected time' })).toBeVisible()
    await expect(headings.filter({ hasText: 'Effort' })).toBeVisible()
    await expect(headings.filter({ hasText: 'Fuel and fluid' })).toBeVisible()
    await expect(headings.filter({ hasText: 'Race week' })).toBeVisible()
    await expect(headings.filter({ hasText: 'Dark hours' })).toBeVisible()
    await expect(headings.filter({ hasText: 'Rehearsal' })).toBeVisible()

    const parts = page.getByRole('article', { name: /^Part \d of \d$/ })
    await expect(parts).toHaveCount(P.r1.thirds.value)
    await expect(parts.first()).toContainText(/Keep heart rate at or below|Go by effort/)

    // a plan is a sketch: the disclaimer is on the page, and the range is called wide
    await expect(page.getByRole('region', { name: 'Disclaimer' })).toBeVisible()
    await page.getByText('About these ranges').click()
    await expect(page.getByText(/The range is wide on purpose/)).toBeVisible()
    // no pace, no split and no cutoff anywhere
    const body = (await page.getByRole('main').textContent()) ?? ''
    expect(body).not.toMatch(/\bsplits?\b|cutoff|min\/km/i)
    expect(await scrollsSideways()).toBe(false)
    await page.screenshot({ path: test.info().outputPath(`race-${String(viewport.width)}.png`) })
  })
}

test("the Rehearsal block counts a night run and downhill time from the runner's own runs", async () => {
  await raceIn(40)
  const { today } = relativeDates()
  const prisma = createPrisma(E2E_DATABASE_URL)
  const date = addDays(today, -2)
  try {
    const user = await prisma.user.findFirstOrThrow()
    await prisma.athleteProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, homeLat: 40.01, homeLng: -105.27, timezone: 'UTC' },
      update: { homeLat: 40.01, homeLng: -105.27 },
    })
    // 07:00 UTC is midnight to 1 am at the home place: dark in every season.
    await prisma.activity.create({
      data: {
        userId: user.id,
        date,
        type: 'run',
        durationSec: 5400,
        movingSec: 5400,
        distanceM: 12_000,
        source: 'manual',
        startUtc: `${date}T07:00:00Z`,
        terrainBins: JSON.stringify({
          v: 1,
          windowM: 60,
          walkMps: 1,
          edgesPct: [-15, -10, -6, -3, 3, 6, 10, 15],
          sec: [0, 0, 1800, 0, 3600, 0, 0, 0, 0],
          m: [0, 0, 3000, 0, 9000, 0, 0, 0, 0],
          walkSec: [0, 0, 0, 0, 0, 0, 0, 0, 0],
          flatCv: null,
        }),
      },
    })
    for (const viewport of WIDTHS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/race')
      const block = page.getByRole('region', { name: 'Rehearsal' })
      await expect(
        block.getByText(/^Night runs: 1 since .*, 1 h 30 min in the dark\.$/),
      ).toBeVisible()
      await expect(block.getByText('Downhill: 30 min on grades of 6% or steeper.')).toBeVisible()
      await expect(block.getByText('Long runs with 10 min or more of it: 1.')).toBeVisible()
      const text = (await block.textContent()) ?? ''
      expect(text).not.toMatch(/behind|missed|streak|should|goal|target/i)
      expect(await scrollsSideways()).toBe(false)
    }
  } finally {
    await prisma.activity.deleteMany({
      where: { date, source: 'manual', startUtc: `${date}T07:00:00Z` },
    })
    await prisma.$disconnect()
  }
})

test('Today shows no race card before race week', async () => {
  await raceIn(P.r1.raceWeekCardDays.value + 3)
  await page.goto('/')
  await expect(page.getByRole('article', { name: run.title })).toBeVisible()
  await expect(page.locator('[data-slot="race"]')).toHaveCount(0)
})

test('in race week Today shows the card below the fold and Done stays inside it, at both widths', async () => {
  await raceIn(P.r1.raceWeekCardDays.value)
  await page.goto('/')
  const card = page.locator('[data-slot="race"]')
  await expect(card).toBeVisible()
  await expect(
    card.getByRole('heading', { name: `${String(P.r1.raceWeekCardDays.value)} days to go` }),
  ).toBeVisible()
  await expect(card.getByRole('link', { name: 'Open the race plan' })).toHaveAttribute(
    'href',
    '/race',
  )
  // before the final window there is no carbohydrate line
  await expect(card.getByText(/of carbohydrate per kg/)).toHaveCount(0)
  await expect(page.getByRole('radiogroup', { name: 'How do you feel today?' })).toBeVisible()
  // no budget: the card cannot take height from the first screen
  await expect(card).not.toHaveAttribute('data-budget-px', /.+/)

  const heights: string[] = []
  for (const viewport of WIDTHS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const done = await doneBottom()
    const box = await card.boundingBox()
    heights.push(
      `${viewport.name}: Done ends at ${String(Math.round(done))} px, card ${String(Math.round(box?.height ?? 0))} px`,
    )
    // the phone's viewport above the 56 px tab bar
    expect(done).toBeLessThanOrEqual(viewport.height - (viewport.width === 390 ? TAB_BAR_PX : 0))
    expect(await scrollsSideways()).toBe(false)
  }
  test.info().annotations.push({ type: 'race-week-card', description: heights.join('; ') })
})

test('on the last two days the card carries the carbohydrate line, and its height is measured', async () => {
  await raceIn(1)
  await page.goto('/')
  const card = page.locator('[data-slot="race"]')
  await expect(card.getByRole('heading', { name: '1 day to go' })).toBeVisible()
  await expect(card.getByText(/of carbohydrate per kg of body mass a day/)).toBeVisible()
  const measured: string[] = []
  for (const viewport of WIDTHS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const done = await doneBottom()
    const box = await card.boundingBox()
    measured.push(
      `${viewport.name}: Done ends at ${String(Math.round(done))} px, card ${String(Math.round(box?.height ?? 0))} px`,
    )
    expect(done).toBeLessThanOrEqual(viewport.height - (viewport.width === 390 ? TAB_BAR_PX : 0))
    expect(await scrollsSideways()).toBe(false)
  }
  test.info().annotations.push({ type: 'day-before-card', description: measured.join('; ') })
})

test('on the race day the card names the day and the effort, and the plan page agrees', async () => {
  await raceIn(0)
  await page.goto('/')
  const card = page.locator('[data-slot="race"]')
  await expect(card.getByRole('heading', { name: 'Race day' })).toBeVisible()
  const effort = (await card.locator('p').first().textContent()) ?? ''
  expect(effort).toMatch(/out of 10/)
  const measured: string[] = []
  for (const viewport of WIDTHS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const done = await doneBottom()
    const box = await card.boundingBox()
    measured.push(
      `${viewport.name}: Done ends at ${String(Math.round(done))} px, card ${String(Math.round(box?.height ?? 0))} px`,
    )
    expect(done).toBeLessThanOrEqual(viewport.height - (viewport.width === 390 ? TAB_BAR_PX : 0))
  }
  test.info().annotations.push({ type: 'race-day-card', description: measured.join('; ') })

  await card.getByRole('link', { name: 'Open the race plan' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Race plan' })).toBeVisible()
  // the page opens with the same effort sentence as the card
  await expect(page.getByText(effort).first()).toBeVisible()
  await expect(page.getByText(/\. Race day\.$/)).toBeVisible()
})

test('the sheet of the race session of an ultra plan carries the race-day block on the race day', async () => {
  // A plan drawn for the 100-mile goal itself, so that its race session is the zone 1 session of
  // rule H11, with the race moved to today and the goal dated today.
  const { today, lastWednesday } = relativeDates()
  await resetData()
  for (let i = 0; i < 6; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (60 + 10 * i) * 60,
      distanceM: 9000 + i * 1000,
    })
  }
  const goal = (await api.post('/goals', {
    name: 'Race day ultra',
    priority: 'A',
    targetDate: addDays(today, 7 * 30),
    distanceM: 160_934,
    gainM: 5000,
    lossM: 5000,
    surface: 'trail',
    goalType: 'finish',
    startTime: '06:00',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id, strengthPreference: 0 })
  const plan = (await api.get('/plan')) as PlanWithSessions
  const race = plan.sessions.find((session) => session.kind === 'race')
  expect(race?.target.zone).toBe('z1')
  // The plan API will not move a race, so the rows are changed in the database, as a plan drawn for
  // today would hold them.
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    // the other sessions of today step aside, and the race takes the day
    await prisma.planSession.deleteMany({
      where: { planId: plan.id, date: today, id: { not: race?.id ?? '' } },
    })
    await prisma.planSession.update({
      where: { id: race?.id ?? '' },
      data: { date: today, weekStart: mondayOf(today) },
    })
  } finally {
    await prisma.$disconnect()
  }
  await api.put(`/goals/${goal.id}`, { targetDate: today })

  for (const viewport of WIDTHS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')
    await expect(
      page.locator('[data-slot="race"]').getByRole('heading', { name: 'Race day' }),
    ).toBeVisible()
    await page
      .getByRole('region', { name: 'This week' })
      .locator('button[aria-current="date"]')
      .click()
    const sheet = page.getByRole('dialog', { name: 'Race' })
    await expect(sheet).toBeVisible()
    const block = sheet.getByRole('heading', { name: 'Race day', level: 3 })
    await expect(block).toBeVisible()
    await expect(sheet.getByText(/Keep heart rate at or below|Go by effort/).first()).toBeVisible()
    await expect(sheet.getByText(/^Carbohydrate: /)).toBeVisible()
    await expect(sheet.getByText(/Drink to thirst and never force fluids/)).toBeVisible()
    await expect(sheet.getByRole('note', { name: /Low blood sodium/ })).toBeVisible()
    await sheet.getByRole('link', { name: 'Open the race plan' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Race plan' })).toBeVisible()
    expect(await scrollsSideways()).toBe(false)
  }
})

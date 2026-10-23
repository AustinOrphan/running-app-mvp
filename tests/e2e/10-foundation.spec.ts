import { expect, test } from '@playwright/test'
import { addDays, formatShortDate, todayIso } from '../../shared/dates.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { RUNNER, relativeDates, resetData, signedInApi, toast } from './helpers.ts'

// The foundation of phase 3a, seen from the browser: Make active moves the plan and the plan can
// come back, long histories load in pages, the server's cached picture follows a write by another
// process, and Integrations says what the advice reads.

test('Make active builds the plan for the new goal, and the archived plan comes back', async ({
  page,
  baseURL,
}) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  const { lastWednesday, thisMonday } = relativeDates()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  const half = (await api.post('/goals', {
    name: 'Foundation half',
    priority: 'A',
    targetDate: addDays(thisMonday, 7 * 14 + 5),
    distanceM: 21_097,
    goalType: 'finish',
  })) as { id: string }
  const tenK = (await api.post('/goals', {
    name: 'Foundation 10K',
    priority: 'B',
    targetDate: addDays(thisMonday, 7 * 10 + 5),
    distanceM: 10_000,
    goalType: 'finish',
  })) as { id: string }
  await api.post(`/goals/${half.id}/activate`)
  await api.post('/plan/generate', { goalId: half.id })
  const planGoal = async () => ((await api.get('/plan')) as { goalId: string }).goalId

  await page.goto('/goals')
  const halfCard = page.getByRole('article', { name: 'Foundation half' })
  const tenKCard = page.getByRole('article', { name: 'Foundation 10K' })
  await expect(halfCard.getByText('Active goal')).toBeVisible()

  // The question names what a new plan does to the current one; Escape closes it and builds nothing.
  await tenKCard.getByRole('button', { name: 'Make active' }).click()
  const question = tenKCard.getByRole('group', { name: /^The plan follows Foundation half\./ })
  await expect(question).toBeVisible()
  await expect(
    question.getByText(
      'The plan follows Foundation half. Making Foundation 10K active builds a new plan for it. ' +
        'The current plan is archived, not deleted, and targets you set by hand do not carry over.',
    ),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(question).toBeHidden()
  await expect(tenKCard.getByRole('button', { name: 'Make active' })).toBeFocused()
  expect(await planGoal()).toBe(half.id)

  // Cancel does the same.
  await tenKCard.getByRole('button', { name: 'Make active' }).click()
  await question.getByRole('button', { name: 'Cancel' }).click()
  await expect(question).toBeHidden()
  expect(await planGoal()).toBe(half.id)

  // Building the plan moves the goal, the plan and the countdown together.
  await tenKCard.getByRole('button', { name: 'Make active' }).click()
  await question.getByRole('button', { name: 'Build plan for Foundation 10K' }).click()
  await expect(toast(page, 'Plan built for Foundation 10K.')).toBeVisible()
  await expect(tenKCard.getByText('Active goal')).toBeVisible()
  await expect(halfCard.getByText('Active goal')).toBeHidden()
  expect(await planGoal()).toBe(tenK.id)
  const revisions = (await api.get('/plan/revisions')) as Array<{ reason: string }>
  expect(revisions[0]?.reason).toBe('goal-switch')

  // The old plan is archived, not deleted, and comes back with one click.
  const archivedOn = formatShortDate(todayIso())
  await expect(
    halfCard.getByText(`The plan for Foundation half was archived on ${archivedOn}.`),
  ).toBeVisible()
  await halfCard.getByRole('button', { name: 'Restore this plan' }).click()
  await expect(toast(page, 'Plan restored.')).toBeVisible()
  await expect(halfCard.getByText('Active goal')).toBeVisible()
  await expect(tenKCard.getByText('Active goal')).toBeHidden()
  expect(await planGoal()).toBe(half.id)
  await expect(
    tenKCard.getByText(`The plan for Foundation 10K was archived on ${archivedOn}.`),
  ).toBeVisible()
})

test('Activities load 50 at a time and say how many there are', async ({ page, baseURL }) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  const today = todayIso()
  for (let i = 1; i <= 55; i += 1) {
    await api.post('/activities', {
      date: addDays(today, -i),
      type: 'run',
      durationSec: (30 + i) * 60,
      distanceM: 5000 + i * 50,
    })
  }

  await page.goto('/activities')
  const count = page.getByRole('status').filter({ hasText: 'activities' })
  await expect(count).toHaveText('Showing 50 of 55 activities')
  const rows = page.getByRole('main').getByRole('listitem')
  await expect(rows.last()).toBeVisible()
  const firstPage = await rows.count()

  await page.getByRole('button', { name: 'Show 5 more' }).click()
  await expect(count).toHaveText('55 activities')
  await expect(rows).toHaveCount(firstPage + 5)
  await expect(page.getByRole('button', { name: /^Show \d+ more$/ })).toHaveCount(0)
})

test('GET /api/state is a 304 until another process writes, then a new picture', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()

  const first = await page.request.get('/api/state')
  expect(first.status()).toBe(200)
  expect(first.headers()['cache-control']).toBe('private, no-cache')
  const etag = first.headers()['etag'] ?? ''
  expect(etag).toMatch(/^W\//)
  expect(
    ((await first.json()) as { inputs: { activities: { count: number } } }).inputs.activities.count,
  ).toBe(0)
  const unchanged = await page.request.get('/api/state', { headers: { 'If-None-Match': etag } })
  expect(unchanged.status()).toBe(304)

  // A write through another connection, as a restore or a script would make. The server did not
  // see it happen, and its next answer still reflects it.
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: RUNNER.email } })
    await prisma.activity.create({
      data: {
        userId: user.id,
        date: addDays(todayIso(), -1),
        type: 'run',
        durationSec: 40 * 60,
        distanceM: 7000,
        source: 'manual',
      },
    })
  } finally {
    await prisma.$disconnect()
  }

  const changed = await page.request.get('/api/state', { headers: { 'If-None-Match': etag } })
  expect(changed.status()).toBe(200)
  const newTag = changed.headers()['etag'] ?? ''
  expect(newTag).not.toBe(etag)
  const view = (await changed.json()) as { inputs: { activities: { count: number } } }
  expect(view.inputs.activities.count).toBe(1)
  const again = await page.request.get('/api/state', { headers: { 'If-None-Match': newTag } })
  expect(again.status()).toBe(304)
})

test('Integrations says what the training advice reads', async ({ page, baseURL }) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  const today = todayIso()
  const latestRun = addDays(today, -2)
  const latestWellness = addDays(today, -1)
  for (const offset of [2, 5, 9]) {
    await api.post('/activities', {
      date: addDays(today, -offset),
      type: 'run',
      durationSec: 40 * 60,
      distanceM: 7000,
    })
  }
  await page.goto('/integrations')
  const reads = page.getByRole('status').filter({ hasText: 'Training advice reads' })
  await expect(reads).toHaveText(
    `Training advice reads 3 activities, the latest on ${formatShortDate(latestRun)}. No wellness data yet.`,
  )

  for (const date of [latestWellness, addDays(today, -3)]) {
    await api.put(`/wellness/${date}`, { restingHr: 52 })
  }
  await page.reload()
  await expect(reads).toHaveText(
    `Training advice reads 3 activities, the latest on ${formatShortDate(latestRun)}, ` +
      `and 2 days of wellness, the latest on ${formatShortDate(latestWellness)}.`,
  )
})

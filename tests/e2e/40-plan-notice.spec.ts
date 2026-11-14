import { expect, test } from '@playwright/test'
import { createPrisma } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { relativeDates, resetData, signedInApi, toast } from './helpers.ts'

// The health notice before a first plan (FS1): the server holds plan generation until the notice is
// confirmed, a birth year under 18 closes it, and an account that already has a plan sees the notice
// once on the Profile without losing the plan.
test('a runner under 18 by the profile gets no plan; an account with a plan confirms from the Profile', async ({
  page,
  baseURL,
}) => {
  const { raceDate } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '', { planNotice: false })
  await resetData()
  const goal = (await api.post('/goals', {
    name: 'Test half',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 21098,
  })) as { id: string }

  // The server answers a plan request before the notice with a conflict.
  const refused = await page.request.post('/api/plan/generate', {
    headers: { Origin: baseURL ?? '' },
    data: { goalId: goal.id },
  })
  expect(refused.status()).toBe(409)

  // A birth year that makes the runner 17: the page says the plan is not for them.
  const year = new Date().getFullYear()
  await api.put('/profile', { birthYear: year - 17 })
  await page.goto('/plan')
  await expect(page.getByText(/younger than 18/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'I have read this' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Generate plan' })).toHaveCount(0)

  // An adult birth year needs no age statement.
  await api.put('/profile', { birthYear: year - 35 })
  await page.goto('/plan')
  await expect(page.getByRole('checkbox', { name: 'I am 18 or older' })).toHaveCount(0)
  await page.getByRole('button', { name: 'I have read this' }).click()
  await page.getByRole('button', { name: 'Generate plan' }).click()
  await expect(toast(page, 'Plan generated')).toBeVisible()

  // An account from before the notice: it has a plan and no confirmation, and is not blocked. The
  // Profile shows the notice once.
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await prisma.user.updateMany({ data: { planNoticeVersion: null, planNoticeAt: null } })
  } finally {
    await prisma.$disconnect()
  }
  await page.goto('/profile')
  await page.getByRole('button', { name: 'I have read this' }).click()
  await expect(page.getByRole('heading', { name: 'Health notice' })).toBeVisible()
  await expect(page.getByText(/^Confirmed on /)).toBeVisible()
  await page.goto('/plan')
  await expect(page.getByRole('table', { name: /Weekly plan/ })).toBeVisible()
})

import { expect, test, type Page } from '@playwright/test'
import { signedInApi } from './helpers.ts'

// The Warning signs page: reachable from More and from Profile, two levels, no sideways scroll at
// 360 px.

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 740 } })
  page = await context.newPage()
  await signedInApi(page, baseURL ?? '')
})

test.afterAll(async () => {
  await page.context().close()
})

test('opens from the More page and shows both levels', async () => {
  await page.goto('/more')
  await page.getByRole('link', { name: /^Warning signs/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Warning signs' })).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 2, name: 'Stop and call emergency services' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 2, name: 'Stop and see a clinician' }),
  ).toBeVisible()
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(sideways).toBe(false)
})

test('opens from the Profile page', async () => {
  await page.goto('/profile')
  await page
    .getByRole('region', { name: 'Injury history' })
    .getByRole('link', { name: 'Warning signs' })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'Warning signs' })).toBeVisible()
})

import { expect, test } from '@playwright/test'
import { RUNNER } from './helpers.ts'

// Runs first (file names are sorted) because it owns the empty database: the account can be
// created through the UI only once. The other specs create or reuse the account through the API.
test('a fresh database sends visitors to setup, then setup, sign out and sign in work', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.getByRole('heading', { name: 'Set up your training log' })).toBeVisible()

  await page.getByLabel('Email').fill(RUNNER.email)
  await page.getByLabel('Display name (optional)').fill('Test Runner')
  await page.getByLabel('Password', { exact: true }).fill(RUNNER.password)
  await page.getByLabel('Confirm password').fill(RUNNER.password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  // A signed-out visitor is sent back to the login page.
  await page.goto('/activities')
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('Email').fill(RUNNER.email)
  await page.getByLabel('Password').fill('not the right password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password')

  await page.getByLabel('Password').fill(RUNNER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

  // The cookie keeps the session across a reload.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('setup is closed once the account exists', async ({ page, request }) => {
  const response = await request.get('/api/setup')
  expect(await response.json()).toEqual({ needsSetup: false })
  await page.goto('/setup')
  await expect(page).toHaveURL(/\/login$/)
})

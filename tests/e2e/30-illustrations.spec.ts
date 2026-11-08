import { expect, test } from '@playwright/test'
import { resetData, signedInApi } from './helpers.ts'

// The Illustrations switch (visual design, section 5): off by default, and a line drawing on an empty
// page only while it is on.

test('Illustrations: off by default, on draws art on an empty page, off draws none', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  const art = page.locator('svg[data-art]')

  await page.goto('/activities')
  await expect(page.getByText('No activities yet.')).toBeVisible()
  await expect(art).toHaveCount(0)

  await page.goto('/settings')
  const box = page.getByRole('checkbox', { name: 'Illustrations' })
  await expect(box).not.toBeChecked()
  await box.check()
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved')

  await page.goto('/activities')
  await expect(page.getByText('No activities yet.')).toBeVisible()
  await expect(art).toHaveCount(1)
  await expect(art).toHaveAttribute('data-art', 'runs')
  await expect(art).toHaveAttribute('aria-hidden', 'true')

  await page.goto('/settings')
  await expect(box).toBeChecked()
  await box.uncheck()
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved')

  await page.goto('/activities')
  await expect(page.getByText('No activities yet.')).toBeVisible()
  await expect(art).toHaveCount(0)
})

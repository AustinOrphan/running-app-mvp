import { expect, test } from '@playwright/test'
import { resetData, signedInApi } from './helpers.ts'

// A desktop window: text is read at one measure and a form sits at another, so nothing runs the
// whole 72rem page or leaves a column empty beside a short one (Layout.module.css).
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page, baseURL }) => {
  await resetData()
  await signedInApi(page, baseURL ?? '')
})

test('Settings holds its sections at the form measure', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  const sections = page.getByRole('main').locator('section')
  const count = await sections.count()
  expect(count).toBeGreaterThan(1)
  const form = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.width = 'var(--measure-form)'
    document.getElementById('main')?.appendChild(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    return width
  })
  expect(form, 'the form measure is set').toBeGreaterThan(400)
  for (let i = 0; i < count; i += 1) {
    const box = await sections.nth(i).boundingBox()
    expect(box?.width ?? 0, `Settings section ${String(i)}`).toBeLessThanOrEqual(form + 1)
  }
})

test('the Research filter is as wide as the list under it', async ({ page }) => {
  await page.goto('/research')
  const filter = page.getByRole('radiogroup', { name: 'Grade' })
  await expect(filter).toBeVisible()
  const list = page.getByRole('main').locator('ul').first()
  await expect(list).toBeVisible()
  const [a, b] = await Promise.all([filter.boundingBox(), list.boundingBox()])
  expect(a?.x).toBeCloseTo(b?.x ?? -1, 0)
  expect((a?.x ?? 0) + (a?.width ?? 0)).toBeCloseTo((b?.x ?? 0) + (b?.width ?? 0), 0)
})

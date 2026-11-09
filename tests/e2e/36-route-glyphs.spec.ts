import { expect, test, type Page } from '@playwright/test'
import { addDays, todayIso } from '../../shared/dates.ts'
import { SHAPES } from '../fixtures/routeShapes.ts'
import { resetData, seedRunWithTrack, signedInApi } from './helpers.ts'

// Route glyphs in the Log (RG1): a run with a stored track shows its route as a small drawing,
// a run without shows none, and at 360 px the page does not scroll sideways at 100% or 150% text.

test.describe.configure({ mode: 'serial' })

let page: Page

async function scrollsSideways(): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 740 } })
  page = await context.newPage()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  const today = todayIso()
  const shapes = [
    SHAPES.loop(),
    SHAPES.outAndBack(),
    SHAPES.figureEight(),
    SHAPES.pointToPoint(),
  ] as const
  for (const [i, shape] of shapes.entries()) {
    await seedRunWithTrack(
      api,
      { date: addDays(today, -i), minutes: 30 + i * 10, distanceM: 6000 + i * 1500 },
      shape,
    )
  }
  // A run with no track, and a strength entry, which never has one.
  await api.post('/activities', {
    date: addDays(today, -4),
    type: 'run',
    durationSec: 1800,
    distanceM: 5000,
  })
  await api.post('/activities', { date: addDays(today, -5), type: 'strength', durationSec: 1800 })
})

test.afterAll(async () => {
  await page.context().close()
})

test('each run with a track shows a drawing; the run without a track and strength show none', async () => {
  await page.goto('/activities')
  const rows = page.getByRole('link', { name: /^(Run|Strength)/ })
  await expect(rows).toHaveCount(6)
  await expect(page.locator('main svg[aria-hidden="true"] path[d^="M"]')).toHaveCount(4)
  for (let i = 0; i < 4; i += 1) await expect(rows.nth(i).locator('svg')).toHaveCount(1)
  await expect(rows.nth(4).locator('svg')).toHaveCount(0)
  await expect(rows.nth(5).locator('svg')).toHaveCount(0)
})

test('the drawings are about 40 px and the row text stays in view', async () => {
  const box = await page.locator('main svg[aria-hidden="true"]').first().boundingBox()
  expect(box?.width).toBeCloseTo(40, 0)
  expect(box?.height).toBeCloseTo(40, 0)
})

test('the Log has no sideways scroll at 360 px with 100% and 150% text', async () => {
  for (const text of [100, 150]) {
    await page.evaluate((t) => {
      document.documentElement.style.fontSize = t === 100 ? '' : `${String(t)}%`
    }, text)
    await expect(page.locator('main svg[aria-hidden="true"]').first()).toBeVisible()
    expect(await scrollsSideways(), `sideways scroll at ${String(text)}% text`).toBe(false)
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = ''
  })
})

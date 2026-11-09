import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

// The course profile that leads the Race page, at 360 px with the text at 100 % and 150 %: the
// names of five close course points clear each other, every mark the data gives is drawn (the
// band, the diamonds, the hourly ticks) and the readout keeps its text inside its box. The
// course points are synthetic.

test.describe.configure({ mode: 'serial' })

let page: Page

async function scrollsSideways(): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  page = await context.newPage()
  await page.setViewportSize({ width: 360, height: 740 })
  const api = await signedInApi(page, baseURL ?? '')
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
    name: 'Profile ultra',
    priority: 'A',
    targetDate: addDays(today, 7 * 20),
    distanceM: 160_934,
    gainM: 5000,
    lossM: 5000,
    surface: 'trail',
    goalType: 'finish',
    startTime: '06:00',
    supportLevel: 'aided',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id, strengthPreference: 0 })
  // five points within 16 km of each other: their names cannot all stand side by side at 360 px
  await api.put('/race/checkpoints', {
    checkpoints: [
      {
        name: 'A very long station name that goes on',
        distanceM: 20_000,
        gainM: 400,
        lossM: 100,
        cutoffSec: 4 * 3600,
      },
      { name: 'Aid 2', distanceM: 24_000, gainM: 200, lossM: 100, cutoffSec: 5 * 3600 },
      { name: 'Aid 3', distanceM: 28_000, gainM: 300, lossM: 100, cutoffSec: 6 * 3600 },
      { name: 'Aid 4', distanceM: 32_000, gainM: 100, lossM: 300, cutoffSec: null },
      { name: 'Aid 5', distanceM: 36_000, gainM: 100, lossM: 200, cutoffSec: 8 * 3600 },
      { name: 'Aid 6', distanceM: 100_000, gainM: 900, lossM: 400, cutoffSec: 20 * 3600 },
    ],
  })
})

test.afterAll(async () => {
  await page.context().close()
})

for (const percent of [100, 150]) {
  test(`at ${String(percent)} % text the names clear each other, the marks are drawn and nothing scrolls sideways`, async () => {
    // the size is set before the page loads, so the labels are placed at it from the first frame
    await page.addInitScript((p) => {
      document.documentElement.style.fontSize = `${String(p)}%`
    }, percent)
    await page.goto('/race')
    const picture = page.getByRole('img', { name: /^Course profile over/ })
    await expect(picture).toBeVisible()
    const section = page.getByRole('region', { name: 'Course', exact: true })
    await expect(section.locator('figcaption')).toContainText('Net height by leg')
    expect(await scrollsSideways(), `sideways scroll at ${String(percent)} %`).toBe(false)

    // names: kept inside the screen, none over another, and more than one kept
    const boxes = await section.locator('[class*="_label_"]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      }),
    )
    expect(boxes.length, 'names kept').toBeGreaterThan(1)
    expect(boxes.length, 'names thinned').toBeLessThan(6)
    for (const [i, a] of boxes.entries()) {
      expect(a.left).toBeGreaterThanOrEqual(0)
      expect(a.right).toBeLessThanOrEqual(360)
      for (const b of boxes.slice(i + 1)) {
        const apart =
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
        expect(apart, 'names overlap').toBe(true)
      }
    }

    // marks: the band against the dark table, the diamonds against the cutoffs, the ticks
    // against the fuel table; a firm and a possible stretch are drawn differently
    const darkRows = await section
      .getByRole('table', { name: 'Stretches in the dark' })
      .locator('tbody tr')
      .count()
    const bands = section.locator('.recharts-reference-area-rect')
    await expect(bands).toHaveCount(darkRows)
    expect(darkRows).toBeGreaterThan(0)
    const fills = await bands.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('fill')))
    if (darkRows > 1) expect(new Set(fills).size, 'firm and possible differ').toBeGreaterThan(1)
    await expect(section.locator('.recharts-reference-dot')).toHaveCount(5)
    const fuelRows = await section
      .getByRole('table', { name: 'Hourly fuel marks' })
      .locator('tbody tr')
      .count()
    expect(fuelRows).toBeGreaterThan(10)
    await expect(section.locator('line[stroke-width="1.5"]')).toHaveCount(fuelRows)

    // the units are on the axes, since the caption does not carry them
    await expect(section.locator('svg.recharts-surface')).toContainText(/\d+ mi/)
    await expect(section.locator('svg.recharts-surface')).toContainText(/\d+ ft/)

    // the readout keeps its text inside its box, on the long name too
    await section.getByRole('group', { name: 'Readout' }).focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    const readout = section.locator('[class*="_readout_"]')
    await expect(readout).toContainText('A very long station name that goes on')
    const fits = await readout.evaluate((el) => el.scrollHeight <= el.clientHeight)
    expect(fits, 'readout text fits its box').toBe(true)
    await expect(readout).toContainText('Next: Aid 2')
    await page.screenshot({ path: test.info().outputPath(`profile-360-${String(percent)}.png`) })
  })
}

import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

// The Plan page's current week row and the table around it, measured at a phone width and at a
// desktop width: one line for the date, the phase and "This week"; Days and Edit side by side and
// each a thumb's size; the table inside the page column.

/** A runner with some history, an active marathon goal and a plan from this Monday. */
async function seedPlan(page: Page, baseURL: string | undefined): Promise<PlanWithSessions> {
  const { today, lastWednesday, raceDate } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  await api.post('/activities', { date: today, type: 'run', durationSec: 40 * 60, distanceM: 7000 })
  const goal = (await api.post('/goals', {
    name: 'Row marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id })
  return (await api.get('/plan')) as PlanWithSessions
}

test.describe('the current week row at 360 px', () => {
  test.use({ viewport: { width: 360, height: 740 } })

  test('keeps the date, phase and "This week" on one line, with Days and Edit side by side', async ({
    page,
    baseURL,
  }) => {
    await seedPlan(page, baseURL)
    await page.goto('/plan')
    const row = page.locator('tr[aria-current="date"]')
    await expect(row).toBeVisible()

    const weekLabel = row.getByText('This week', { exact: true })
    const label = await weekLabel.boundingBox()
    const date = await row.locator('td').first().boundingBox()
    const chip = await row.locator('td').nth(1).boundingBox()
    const hours = await row.locator('[data-cell="target"]').boundingBox()
    if (label === null || date === null || chip === null || hours === null) {
      throw new Error('A cell of the current week row has no box.')
    }
    // "This week" is one line: its box is no taller than one small text line.
    expect(label.height).toBeLessThan(26)
    // The date, the label, the chip and the hours share the first line of the row.
    const line = date.y + date.height / 2
    for (const [name, box] of [
      ['label', label],
      ['phase', chip],
      ['hours', hours],
    ] as const) {
      expect(Math.abs(box.y + Math.min(box.height, 28) / 2 - line), name).toBeLessThan(14)
    }
    // The hours are at the right edge of the row.
    expect(hours.x + hours.width).toBeGreaterThan(360 - 16 - 8)

    const days = row.getByRole('button', { name: /^Days for week of / })
    const edit = row.getByRole('button', { name: /^Edit week of / })
    const daysBox = await days.boundingBox()
    const editBox = await edit.boundingBox()
    if (daysBox === null || editBox === null) throw new Error('Days or Edit has no box.')
    for (const [name, box] of [
      ['Days', daysBox],
      ['Edit', editBox],
    ] as const) {
      expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44)
      expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44)
    }
    // Side by side: the same top, Edit to the right of Days.
    expect(Math.abs(daysBox.y - editBox.y)).toBeLessThan(2)
    expect(editBox.x).toBeGreaterThanOrEqual(daysBox.x + daysBox.width - 1)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('the week table at 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('stays inside the page column, on the strip left edge and inside the gutter', async ({
    page,
    baseURL,
  }) => {
    await seedPlan(page, baseURL)
    await page.goto('/plan')
    const strip = await page.getByRole('region', { name: 'Season' }).boundingBox()
    const table = page.getByRole('table', { name: /Weekly plan/ })
    await expect(table).toBeVisible()
    const box = await table.boundingBox()
    const heading = await page.getByRole('heading', { name: 'Plan', level: 1 }).boundingBox()
    if (strip === null || box === null || heading === null) {
      throw new Error('The strip, the table or the title has no box.')
    }
    // The page column ends one gutter short of the viewport (--gutter is 2rem from 900 px).
    const columnRight = 1280 - 32
    expect(box.x + box.width).toBeLessThanOrEqual(columnRight + 0.5)
    expect(Math.abs(box.x - strip.x)).toBeLessThan(1)
    expect(Math.abs(box.x - heading.x)).toBeLessThan(1)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    const row = page.locator('tr[aria-current="date"]')
    const days = await row.getByRole('button', { name: /^Days for week of / }).boundingBox()
    const edit = await row.getByRole('button', { name: /^Edit week of / }).boundingBox()
    if (days === null || edit === null) throw new Error('Days or Edit has no box.')
    // Side by side here too.
    expect(Math.abs(days.y - edit.y)).toBeLessThan(2)
    expect(edit.x).toBeGreaterThanOrEqual(days.x + days.width - 1)
    expect(edit.x + edit.width).toBeLessThanOrEqual(columnRight + 0.5)
  })
})

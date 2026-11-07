import { expect, test, type Page } from '@playwright/test'
import { addDays, daysBetween, mondayOf } from '../../shared/dates.ts'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

// The Trends page at a phone's 360 px: months of running read by role, the range switch, the hidden
// table of the same numbers, and a page that never scrolls sideways.

test.use({ viewport: { width: 360, height: 740 } })

type Api = Awaited<ReturnType<typeof signedInApi>>

/** The page's reach past the viewport sideways, in pixels. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/** Runs every third day for 20 weeks, a race and two strength sessions in the middle. */
async function seedRunning(api: Api): Promise<void> {
  const { thisMonday } = relativeDates()
  await resetData()
  for (let i = 0; i < 46; i += 1) {
    await api.post('/activities', {
      date: addDays(thisMonday, -7 - 3 * i),
      type: 'run',
      durationSec: (35 + (i % 5) * 6) * 60,
      distanceM: 6000 + (i % 5) * 900,
    })
  }
  await api.post('/activities', {
    date: addDays(thisMonday, -7 * 6 - 5),
    type: 'race',
    durationSec: 50 * 60,
    distanceM: 10_000,
  })
  for (const back of [7 * 4 + 1, 7 * 4 + 3]) {
    await api.post('/activities', {
      date: addDays(thisMonday, -back),
      type: 'strength',
      durationSec: 30 * 60,
    })
  }
}

/** A night a day for 70 days before today: rMSSD, resting heart rate and sleep. */
async function seedNights(api: Api): Promise<void> {
  const { today } = relativeDates()
  for (let back = 1; back <= 70; back += 1) {
    await api.put(`/wellness/${addDays(today, -back)}`, {
      hrvRmssd: 55 + ((back * 7) % 11),
      restingHr: 48 + ((back * 3) % 5),
      sleepSec: Math.round((6.5 + ((back * 5) % 4) * 0.5) * 3600),
    })
  }
}

test('Trends reads by role, switches range and stays inside 360 px', async ({ page, baseURL }) => {
  const api = await signedInApi(page, baseURL ?? '')
  await seedRunning(api)
  await seedNights(api)

  // From More, as a phone reaches it.
  await page.goto('/more')
  await page.getByRole('link', { name: /^Trends/ }).click()
  await expect(page).toHaveURL(/\/trends$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Trends' })).toBeVisible()
  await expect(page.getByText('Nothing here is a target.')).toBeVisible()

  // The 12-month chart, with its lazy chunk drawn, and its hidden table of the same weeks.
  const chart = page.getByRole('img', { name: /^Run hours per week, last 12 months\./ })
  await expect(chart).toBeVisible()
  const table = page.getByRole('table', { name: /^Run hours per week, last 12 months\./ })
  // The plot starts at the first week with a record (the oldest run is 20 weeks back), not at the
  // edge of the range, and a muted line names the start.
  const { thisMonday, today } = relativeDates()
  const firstRunWeek = mondayOf(addDays(thisMonday, -7 - 3 * 45))
  const runWeeks = daysBetween(firstRunWeek, thisMonday) / 7 + 1
  await expect(table.getByRole('row')).toHaveCount(1 + runWeeks)
  await expect(page.getByText(/^Records start \d{1,2} \w{3}\.$/).first()).toBeVisible()
  await expect(table.getByRole('row', { name: /Yes$/ })).toHaveCount(1)

  // Strength squares stand under the weeks that held a session.
  const squares = page.getByTestId('strength-squares')
  await expect(squares.locator('[data-strength="2"]')).toHaveCount(1)
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  // The recovery readings: three panels, each with its caption, its range line and its table.
  await expect(page.getByRole('heading', { level: 2, name: 'Recovery readings' })).toBeVisible()
  for (const name of [
    /^Overnight HRV in ms, weekly mean/,
    /^Resting heart rate in bpm, weekly mean/,
  ]) {
    await expect(page.getByRole('img', { name })).toBeVisible()
  }
  await expect(page.getByRole('img', { name: /^Sleep in hours, weekly mean/ })).toBeVisible()
  await expect(
    page.getByText(/^The band is your recent range: the mean of the latest 10 readings/),
  ).toHaveCount(2)
  await expect(page.getByText('Heart-rate variability alone never changes a plan.')).toBeVisible()
  const hrvTable = page.getByRole('table', { name: /^Overnight HRV in ms, weekly mean/ })
  const firstNightWeek = mondayOf(addDays(today, -70))
  await expect(hrvTable.getByRole('row')).toHaveCount(
    1 + daysBetween(firstNightWeek, thisMonday) / 7 + 1,
  )
  await expect(hrvTable.getByRole('columnheader')).toHaveText([
    'Week of',
    'Mean (ms)',
    'Nights',
    'Low (ms)',
    'High (ms)',
  ])
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  // 24 months, then 6, each with its own hidden table; the page stays inside the window.
  const range = page.getByRole('radiogroup', { name: 'Range' })
  await range.getByRole('radio', { name: '24 months' }).click()
  const wide = page.getByRole('table', { name: /^Run hours per week, last 24 months\./ })
  await expect(wide.getByRole('row')).toHaveCount(1 + runWeeks)
  await expect(page.getByRole('img', { name: /^Run hours per week, last 24 months/ })).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await range.getByRole('radio', { name: '6 months' }).click()
  await expect(
    page.getByRole('table', { name: /^Run hours per week, last 6 months\./ }).getByRole('row'),
  ).toHaveCount(1 + runWeeks)

  // The choice is remembered on this device.
  await page.reload()
  await expect(
    page.getByRole('radiogroup', { name: 'Range' }).getByRole('radio', { name: '6 months' }),
  ).toBeChecked()

  // Distance, in the runner's unit.
  await page
    .getByRole('radiogroup', { name: 'Show' })
    .getByRole('radio', { name: 'Distance' })
    .click()
  await expect(page.getByText(/^Bars are run distance per week, in (km|mi)\.$/)).toBeVisible()
  await expect(
    page.getByRole('img', { name: /^Run distance per week, last 6 months\./ }),
  ).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

test('Trends draws body weight only after Settings turns it on, and hiding it deletes nothing', async ({
  page,
  baseURL,
}) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  await api.put('/settings', { showBodyWeight: false, weightUnit: 'kg' })
  const { thisMonday } = relativeDates()
  // Two weigh-ins in each of the last six complete weeks.
  for (let week = 1; week <= 6; week += 1) {
    for (const day of [0, 2]) {
      await api.put(`/wellness/${addDays(thisMonday, -7 * week + day)}`, {
        weightKg: 70 + week * 0.2 + day * 0.1,
      })
    }
  }

  // Off by default: no section, no word about weight.
  await page.goto('/trends')
  await expect(page.getByRole('heading', { level: 2, name: 'Running per week' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Recovery readings' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Body weight' })).toHaveCount(0)
  await expect(page.getByText(/weigh-in/i)).toHaveCount(0)

  // Settings: the Trends section, one switch and a line saying hiding deletes nothing.
  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 2, name: 'Trends' })).toBeVisible()
  await expect(
    page.getByText('Hiding the chart deletes nothing. Every weigh-in stays.'),
  ).toBeVisible()
  await page.getByRole('checkbox', { name: 'Show body weight on Trends' }).check()
  await expect(page.getByText('Settings saved')).toBeVisible()

  // On: the chart, in the runner's unit, with its hidden table of weekly means.
  await page.goto('/trends')
  await expect(page.getByRole('heading', { level: 2, name: 'Body weight' })).toBeVisible()
  await expect(
    page.getByRole('img', { name: /^Body weight, weekly mean, last 12 months\./ }),
  ).toBeVisible()
  const table = page.getByRole('table', { name: /^Body weight, weekly mean, last 12 months\./ })
  await expect(table.getByRole('row')).toHaveCount(1 + 52)
  await expect(table.getByRole('columnheader')).toHaveText(['Week of', 'Mean (kg)', 'Weigh-ins'])
  await expect(table.getByRole('cell', { name: '70.3', exact: true })).toHaveCount(1)
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  // Off again: the section goes, and every weigh-in is still there.
  await page.goto('/settings')
  await page.getByRole('checkbox', { name: 'Show body weight on Trends' }).uncheck()
  await expect(page.getByText('Settings saved')).toBeVisible()
  await page.goto('/trends')
  await expect(page.getByRole('heading', { level: 2, name: 'Recovery readings' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Body weight' })).toHaveCount(0)
  const kept = (await api.get(
    `/wellness?from=${addDays(thisMonday, -7 * 6)}&to=${addDays(thisMonday, -1)}`,
  )) as Array<{ weightKg: number | null }>
  expect(kept.filter((day) => day.weightKg !== null)).toHaveLength(12)
})

test('Trends says there are no runs when the range holds none', async ({ page, baseURL }) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  await api.get('/settings')
  await page.goto('/trends')
  await expect(page.getByText('No runs in this range yet.')).toBeVisible()
  await expect(page.getByText('No rMSSD readings yet.')).toBeVisible()
  await expect(page.getByText('No sleep readings yet.')).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Range' })).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

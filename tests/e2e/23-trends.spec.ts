import { expect, test, type Page } from '@playwright/test'
import { addDays, daysBetween, mondayOf } from '../../shared/dates.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { relativeDates, resetData, RUNNER, signedInApi } from './helpers.ts'

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
  await page
    .getByRole('navigation', { name: 'More pages' })
    .getByRole('link', { name: /^Trends/ })
    .click()
  await expect(page).toHaveURL(/\/trends$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Trends' })).toBeVisible()
  await expect(page.getByText('Nothing here is a target.')).toBeVisible()

  // The 12-month chart, with its lazy chunk drawn, and its hidden table of the same weeks.
  const chart = page.getByRole('img', { name: /^Run hours per week, since the week of / })
  await expect(chart).toBeVisible()
  const table = page.getByRole('table', { name: /^Run hours per week, since the week of / })
  // The plot starts at the first week with a record (the oldest run is 20 weeks back), not at the
  // edge of the range, and a muted line names the start.
  const { thisMonday, today } = relativeDates()
  const firstRunWeek = mondayOf(addDays(thisMonday, -7 - 3 * 45))
  const runWeeks = daysBetween(firstRunWeek, thisMonday) / 7 + 1
  await expect(table.getByRole('row')).toHaveCount(1 + runWeeks)
  await expect(page.getByText(/^Records start the week of \d{1,2} \w{3}\.$/).first()).toBeVisible()
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
  const wide = page.getByRole('table', { name: /^Run hours per week, since the week of / })
  await expect(wide.getByRole('row')).toHaveCount(1 + runWeeks)
  await expect(
    page.getByRole('img', { name: /^Run hours per week, since the week of / }),
  ).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await range.getByRole('radio', { name: '6 months' }).click()
  await expect(
    page.getByRole('table', { name: /^Run hours per week, since the week of / }).getByRole('row'),
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
    page.getByRole('img', { name: /^Run distance per week, since the week of / }),
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
  await expect(page.getByRole('status', { name: 'Save status' }).getByText('Saved')).toBeVisible()

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
  await expect(page.getByRole('status', { name: 'Save status' }).getByText('Saved')).toBeVisible()
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
  // The two run panels name what would fill them.
  await expect(page.getByText('No long-run readings in this range yet.')).toBeVisible()
  await expect(page.getByText('No heart-rate line in this range yet.')).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Range' })).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

// The run panels (rules T1, A7 and A11): heart-rate drift of long runs, and the heart rate of the
// runner's own line at one speed. The runs are synthetic and are written straight to the database,
// because the activity API takes no heart-rate histogram and no drift reading.

const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const

/**
 * Six two-hour runs on cool days, one a week, with drift readings of 2 to 7 percent; one hilly long
 * run, which the drift panel leaves out; and fifty steady runs, one every four days, on the
 * line HR = 90 + 20 x speed (2.4 to 3.0 m/s).
 */
async function seedRunPanels(): Promise<void> {
  const { today } = relativeDates()
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: RUNNER.email } })
    for (let i = 0; i < 6; i += 1) {
      await prisma.activity.create({
        data: {
          userId: user.id,
          date: addDays(today, -10 - 7 * i),
          type: 'run',
          durationSec: (115 + (i % 3) * 5) * 60,
          distanceM: 20_000,
          elevationGainM: 40,
          tempC: 12 + (i % 4),
          decouplingPct: 2 + i,
        },
      })
    }
    // A 45-minute run with a reading is a dot but no candidate of rule A7: a ring.
    await prisma.activity.create({
      data: {
        userId: user.id,
        date: addDays(today, -3),
        type: 'run',
        durationSec: 2700,
        distanceM: 8000,
        elevationGainM: 20,
        tempC: 14,
        decouplingPct: 9,
      },
    })
    await prisma.activity.create({
      data: {
        userId: user.id,
        date: addDays(today, -5),
        type: 'run',
        durationSec: 7200,
        distanceM: 20_000,
        elevationGainM: 900,
        tempC: 14,
        decouplingPct: 15,
      },
    })
    const durationSec = 40 * 60
    for (let i = 0; i < 50; i += 1) {
      const speed = 2.4 + (i % 7) * 0.1
      const avgHr = Math.round(90 + 20 * speed)
      const metres = Math.round(speed * durationSec)
      await prisma.activity.create({
        data: {
          userId: user.id,
          date: addDays(today, -(2 + i * 4)),
          type: 'run',
          durationSec,
          distanceM: metres,
          gapDistanceM: metres,
          elevationGainM: 20,
          avgHr,
          hrHistogram: JSON.stringify({
            start: 100,
            width: 5,
            sec: Array.from({ length: 20 }, (_, bin) =>
              bin === Math.floor((avgHr - 100) / 5) ? durationSec : 0,
            ),
          }),
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

test.describe('the run panels', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL })
    const page = await context.newPage()
    await signedInApi(page, baseURL ?? '')
    await resetData()
    await seedRunPanels()
    await context.close()
  })

  test('read by role: dots, a median, a pace and a hidden table of the same numbers', async ({
    page,
    baseURL,
  }) => {
    await signedInApi(page, baseURL ?? '')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/trends')

    const drift = page.getByRole('region', { name: 'Heart-rate drift on long runs' })
    await expect(drift.getByRole('img', { name: /^Heart-rate drift of 7 runs/ })).toBeVisible()
    await expect(
      drift.getByText(/^Median \d(\.\d)?% over 6 comparable runs of about 2 h on cool days\.$/),
    ).toBeVisible()
    await expect(
      drift.getByText(/^Filled dots are the largest set of comparable runs/),
    ).toBeVisible()
    await expect(
      drift.getByText(/Comparable runs last 90 min to 3 h in air under (25 °C|77 °F)/),
    ).toBeVisible()
    await expect(
      drift.getByText(
        /A run that climbs more than (15 m per km|79 ft per mile) is drawn only when/,
      ),
    ).toBeVisible()
    const driftTable = drift.getByRole('table', { name: /^Heart-rate drift of 7 runs/ })
    // Six flat runs; the hilly run of 900 m is not among them.
    await expect(driftTable.getByRole('row')).toHaveCount(1 + 7)
    // Oldest first: drift 7 down to 2, and never the 15 of the hilly run.
    await expect(driftTable.locator('tbody tr td:nth-child(2)')).toHaveText([
      '7',
      '6',
      '5',
      '4',
      '3',
      '2',
      '9',
    ])

    const speed = page.getByRole('region', { name: 'Heart rate at one speed' })
    await expect(
      speed.getByRole('img', { name: /one point per 8-week window, last 12 months/ }),
    ).toBeVisible()
    await expect(
      speed.getByText(/^Each point is the heart rate your own line gives at /),
    ).toBeVisible()
    const speedTable = speed.getByRole('table', { name: /one point per 8-week window/ })
    await expect(speedTable.getByRole('columnheader')).toHaveText([
      'Window ending',
      'Heart rate (bpm)',
      'Runs fitted',
      'Runs in the window',
    ])
    // Thirteen windows end inside 12 months; the oldest had no run and say why.
    await expect(speedTable.getByRole('row')).toHaveCount(1 + 13)
    await expect(speedTable.getByRole('cell', { name: 'Too few runs' }).first()).toBeVisible()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
  })

  test('a hovered ring and a hovered gap each have their tooltip', async ({ page, baseURL }) => {
    await signedInApi(page, baseURL ?? '')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/trends')
    const drift = page.getByRole('region', { name: 'Heart-rate drift on long runs' })
    await expect(drift.getByRole('img')).toBeVisible()
    // The ring is hollow: the pointer lands in its middle, and the tooltip still answers.
    await drift.locator('svg circle[fill="transparent"]').first().hover()
    const tooltip = page.locator('div[class*="_tooltip_"]')
    await expect(tooltip).toContainText('In the median')
    await expect(tooltip).toContainText('Drift9%')

    const speed = page.getByRole('region', { name: 'Heart rate at one speed' })
    await speed.getByRole('img').scrollIntoViewIfNeeded()
    const plot = await speed.getByRole('img').boundingBox()
    expect(plot).not.toBeNull()
    // The oldest window sits at the left of the plot, past the value axis, and had no runs.
    await page.mouse.move(plot!.x + 60, plot!.y + plot!.height / 2)
    await expect(tooltip).toContainText('Too few runs')
  })

  test('the range switch from the keyboard moves both panels', async ({ page, baseURL }) => {
    await signedInApi(page, baseURL ?? '')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/trends')
    const range = page.getByRole('radiogroup', { name: 'Range' })
    await expect(range.getByRole('radio', { name: '12 months' })).toBeChecked()
    await range.getByRole('radio', { name: '12 months' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(range.getByRole('radio', { name: '24 months' })).toBeChecked()
    await expect(
      page.getByRole('img', { name: /^Heart-rate drift of 7 runs, last 24 months/ }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('table', { name: /one point per 8-week window, last 24 months/ })
        .getByRole('row'),
    ).toHaveCount(1 + 26)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(range.getByRole('radio', { name: '6 months' })).toBeChecked()
    await expect(
      page
        .getByRole('table', { name: /one point per 8-week window, last 6 months/ })
        .getByRole('row'),
    ).toHaveCount(1 + 7)
  })

  for (const viewport of WIDTHS) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`stay inside ${String(viewport.width)} px in ${scheme}, with reduced motion`, async ({
        page,
        baseURL,
      }) => {
        await signedInApi(page, baseURL ?? '')
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
        await page.goto('/trends')
        const drift = page.getByRole('region', { name: 'Heart-rate drift on long runs' })
        const speed = page.getByRole('region', { name: 'Heart rate at one speed' })
        await expect(drift.getByRole('img')).toBeVisible()
        await expect(speed.getByRole('img')).toBeVisible()
        expect(await overflow(page)).toBeLessThanOrEqual(0)
        await page.screenshot({
          path: test.info().outputPath(`runs-${String(viewport.width)}-${scheme}.png`),
          fullPage: true,
        })
      })
    }
  }

  test('draw nothing in red and use no word of grade, in light and dark (rule G5)', async ({
    page,
    baseURL,
  }) => {
    await signedInApi(page, baseURL ?? '')
    await page.setViewportSize({ width: 390, height: 844 })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' })
      await page.goto('/trends')
      const drift = page.getByRole('region', { name: 'Heart-rate drift on long runs' })
      const speed = page.getByRole('region', { name: 'Heart rate at one speed' })
      await expect(drift.getByRole('img')).toBeVisible()
      await expect(speed.getByRole('img')).toBeVisible()
      const reds = await page.evaluate(() => {
        const red = (value: string): boolean => {
          const found = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value)
          if (found === null) return false
          const [r, g, b] = [Number(found[1]), Number(found[2]), Number(found[3])]
          const alpha = found[4] === undefined ? 1 : Number(found[4])
          return alpha > 0 && r - g >= 60 && r - b >= 60
        }
        const found: string[] = []
        const sections = document.querySelectorAll(
          'section[aria-labelledby="trends-drift-heading"], section[aria-labelledby="trends-hr-heading"]',
        )
        for (const section of sections) {
          for (const element of section.querySelectorAll('*')) {
            const style = getComputedStyle(element)
            for (const property of [
              'color',
              'backgroundColor',
              'borderTopColor',
              'fill',
              'stroke',
            ] as const) {
              if (red(style[property])) found.push(`${element.tagName.toLowerCase()} ${property}`)
            }
          }
        }
        return found
      })
      expect(reds).toEqual([])
      const words = `${(await drift.textContent()) ?? ''} ${(await speed.textContent()) ?? ''}`
      expect(words).not.toMatch(/\b(behind|missed|failed|streak|better|worse|poor|fitter)\b|!/i)
    }
  })

  test('say so once when the answer does not come, and leave the rest of the page', async ({
    page,
    baseURL,
  }) => {
    await signedInApi(page, baseURL ?? '')
    await page.route('**/api/trends/runs', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }),
      }),
    )
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto('/trends')
    await expect(
      page.getByRole('alert').filter({ hasText: 'The run data did not load.' }),
    ).toHaveCount(1)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Long runs and heart rate' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByRole('img', { name: /^Run hours per week/ })).toBeVisible()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
  })
})

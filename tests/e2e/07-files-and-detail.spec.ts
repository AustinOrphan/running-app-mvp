import { expect, test, type Locator, type Page } from '@playwright/test'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

/** The height of the tab bar that sits over the foot of a phone's viewport. */
const TAB_BAR_PX = 56

/** The computed font size of an element, in pixels. */
async function fontPx(locator: Locator): Promise<number> {
  return locator.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
}

/** Whether the page is wider than the window. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

interface UploadFile {
  name: string
  mimeType: string
  buffer: Buffer
}

/**
 * A synthetic 30-minute run with heart rate, altitude, distance and two laps, started yesterday
 * at noon on the runner's local clock. The file carries the machine's offset, so the importer
 * assigns it to yesterday's calendar day, which keeps it inside the Today card's seven days.
 */
function syntheticRun(): UploadFile {
  const start = new Date()
  start.setDate(start.getDate() - 1)
  start.setHours(12, 0, 0, 0)
  const startUnix = Math.floor(start.getTime() / 1000)
  const durationSec = 30 * 60
  const speedMps = 3
  const records = Array.from({ length: durationSec / 10 + 1 }, (_, i) => ({
    t: i * 10,
    distanceM: i * 10 * speedMps,
    speedMps,
    hr: 140 + Math.round(10 * Math.sin(i / 20)),
    cadence: 84,
    altitudeM: 100 + Math.round(8 * Math.sin(i / 15)),
  }))
  const bytes = buildFit({
    serial: 4_100_000_002,
    utcOffsetMin: -start.getTimezoneOffset(),
    productName: 'Synthetic Watch',
    sessions: [
      {
        sport: 1,
        startUnix,
        durationSec,
        distanceM: durationSec * speedMps,
        ascentM: 40,
        descentM: 38,
        avgHr: 140,
        maxHr: 152,
        avgCadence: 84,
        records,
        laps: [
          { startSec: 0, durationSec: 900, distanceM: 900 * speedMps, avgHr: 138, maxHr: 148 },
          { startSec: 900, durationSec: 900, distanceM: 900 * speedMps, avgHr: 142, maxHr: 152 },
        ],
      },
    ],
  })
  return {
    name: 'synthetic-run.fit',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(bytes),
  }
}

async function importRun(page: Page, file: UploadFile) {
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Import activities' })
  await sheet.getByRole('radio', { name: 'Activity files' }).check()
  await sheet.getByLabel('Activity files (FIT, GPX, TCX, ZIP)').setInputFiles(file)
  await sheet.getByRole('button', { name: 'Import files' }).click()
  return sheet
}

test('a FIT file imports once, opens its detail page and is rated from the Today card', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  const file = syntheticRun()
  await page.goto('/activities')

  // Import, then import the same file again: the second pass changes nothing.
  const first = await importRun(page, file)
  await expect(first.getByText('1 imported, 0 already imported, 0 skipped')).toBeVisible()
  await first.getByRole('button', { name: 'Done' }).click()
  await expect(first).toBeHidden()
  await expect(page.getByText('1 activity')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Run 30:00 .*File import$/ })).toBeVisible()

  const second = await importRun(page, file)
  await expect(second.getByText('0 imported, 1 already imported, 0 skipped')).toBeVisible()
  await second.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('1 activity')).toBeVisible()

  // Detail page: summary, charts, laps and the original file.
  await page.getByRole('link', { name: /^Details, Run on / }).click()
  await expect(page.getByRole('heading', { name: 'Run', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible()
  await expect(page.getByText('Synthetic Watch')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Pace, average / })).toBeVisible()
  await expect(page.getByRole('img', { name: /^Heart rate, average / })).toBeVisible()
  await expect(page.getByRole('img', { name: /^Elevation, from / })).toBeVisible()
  const laps = page.getByRole('table', { name: 'Laps' })
  await expect(laps.getByRole('row')).toHaveCount(3)
  await expect(page.getByRole('heading', { name: 'Heart rate distribution' })).toBeVisible()
  // The import described the run: its card loads, with a sentence or a plain "nothing unusual".
  const standout = page.getByRole('region', { name: 'What stood out' })
  await expect(standout.locator('p').first()).toBeVisible()
  await expect(standout.getByText(/could not be loaded/)).toBeHidden()
  await expect(page.getByRole('link', { name: 'Download original file' })).toBeVisible()

  // Today lists the unrated run; rating it from the card removes it from the card.
  await page.goto('/')
  const card = page.getByRole('region', { name: 'How did it go?' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'RPE 6', exact: true }).click()
  await card.getByRole('button', { name: 'Harder', exact: true }).click()
  await card.getByRole('button', { name: 'Save' }).click()
  await expect(card).toBeHidden()

  // The detail page shows what was saved.
  await page.goto('/activities')
  await page.getByRole('link', { name: /^Details, Run on / }).click()
  await expect(page.getByRole('button', { name: 'RPE 6', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Harder', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('the activity page leads with the run’s figures, in three sizes, at 390 x 844 and 360 x 740', async ({
  page,
  baseURL,
}) => {
  const { today } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  // The long run of the critique: 3:05:00 over 17.46 mi, entered by hand.
  const run = (await api.post('/activities', {
    date: today,
    type: 'run',
    subtype: 'trail',
    durationSec: 3 * 3600 + 5 * 60,
    distanceM: 28_100,
    avgHr: 148,
    maxHr: 171,
    elevationGainM: 320,
  })) as { id: string }

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 740 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto(`/activities/${run.id}`)
    const summary = page.getByRole('region', { name: 'Summary' })
    await expect(summary).toBeVisible()

    // tier 1: duration and distance at 32 px (--text-xl), the unit smaller and muted beside it
    const duration = summary.getByText('3:05:00', { exact: true })
    const distance = summary.getByText('17.46', { exact: true })
    expect(await fontPx(duration)).toBe(32)
    expect(await fontPx(distance)).toBe(32)
    expect(await fontPx(summary.getByText('mi', { exact: true }))).toBe(22)
    // one row: both lead figures sit on the same line
    const durationBox = await duration.boundingBox()
    const distanceBox = await distance.boundingBox()
    expect(durationBox?.y).toBe(distanceBox?.y)

    // tier 2: pace, climb and the two heart rates at 22 px, two by two
    const pace = summary.getByText(/^\d+:\d\d \/mi$/)
    const gain = summary.getByText(/^\d+ ft$/)
    const averageHr = summary.getByText('148 bpm', { exact: true })
    const maxHr = summary.getByText('171 bpm', { exact: true })
    for (const reading of [pace, gain, averageHr, maxHr]) expect(await fontPx(reading)).toBe(22)
    const [paceBox, gainBox, averageBox, maxBox] = await Promise.all(
      [pace, gain, averageHr, maxHr].map((reading) => reading.boundingBox()),
    )
    expect(paceBox?.y).toBe(gainBox?.y)
    expect(averageBox?.y).toBe(maxBox?.y)
    expect(averageBox?.y).toBeGreaterThan(paceBox?.y ?? Number.POSITIVE_INFINITY)

    // tier 3: kind and source as one muted 15 px line, on one line at both widths
    const described = summary.getByText('Trail · Entered by hand', { exact: true })
    expect(await fontPx(described)).toBe(15)
    expect((await described.boundingBox())?.height).toBeLessThanOrEqual(22)

    // the page has no fold test: the first screen is measured and attached, not asserted
    expect(await scrollsSideways(page)).toBe(false)
    const first = await summary.boundingBox()
    const info = test.info()
    await info.attach(`activity-${String(viewport.width)}x${String(viewport.height)}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    info.annotations.push({
      type: `activity first screen ${String(viewport.width)}x${String(viewport.height)}`,
      description: `Summary ends at ${String(Math.round((first?.y ?? 0) + (first?.height ?? 0)))} px of ${String(viewport.height - TAB_BAR_PX)} px`,
    })
  }
})

test('a link with no class of its own is the app’s accent in both colour schemes, never the browser’s blue', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await page.goto('/activities/no-such-activity')
  const link = page.getByRole('link', { name: 'All activities' })
  await expect(link).toBeVisible()

  /** The colour of the link, and what `var(--accent)` computes to on the same page. */
  const colours = () =>
    link.evaluate((el) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--accent)'
      document.body.append(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      return { link: getComputedStyle(el).color, accent }
    })

  await page.emulateMedia({ colorScheme: 'light' })
  const light = await colours()
  expect(light.link).toBe(light.accent)
  expect(light.link).not.toBe('rgb(0, 0, 238)')

  await page.emulateMedia({ colorScheme: 'dark' })
  const dark = await colours()
  expect(dark.link).toBe(dark.accent)
  // the dark accent is the lighter lavender of the tokens, not the light scheme's indigo
  expect(dark.link).not.toBe(light.link)
})

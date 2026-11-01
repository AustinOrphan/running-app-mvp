import { expect, test, type Page } from '@playwright/test'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { resetData, signedInApi } from './helpers.ts'

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

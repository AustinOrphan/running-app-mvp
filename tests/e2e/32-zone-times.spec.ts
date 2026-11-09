import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { syntheticRun } from '../fixtures/syntheticRoute.ts'
import { resetData, signedInApi } from './helpers.ts'

// The heart-rate bands on the activity page ("time in zone") at a phone's narrowest width with the
// text size raised: the page must not scroll sideways and every band keeps its time in view.
//
// Setting ZONE_SHOTS_DIR makes the spec also write a screenshot of the section per pass.

const SHOTS_DIR = process.env.ZONE_SHOTS_DIR

/** A half-hour run whose heart rate climbs through five 10 bpm bands. */
function bandRun() {
  const start = new Date()
  start.setDate(start.getDate() - 1)
  start.setHours(12, 0, 0, 0)
  const fixes = syntheticRun(1800)
  const records = fixes
    .filter((f) => f.t % 5 === 0)
    .map((f) => ({
      t: f.t,
      lat: f.lat,
      lng: f.lng,
      distanceM: f.distanceM,
      hr: 125 + Math.min(49, Math.floor(f.t / 36)),
      altitudeM: 100,
    }))
  const bytes = buildFit({
    serial: 4_100_000_032,
    utcOffsetMin: -start.getTimezoneOffset(),
    productName: 'Synthetic Watch',
    sessions: [
      {
        sport: 1,
        startUnix: Math.floor(start.getTime() / 1000),
        durationSec: 1800,
        distanceM: fixes.at(-1)?.distanceM ?? 0,
        records,
      },
    ],
  })
  return { name: 'band-run.fit', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) }
}

async function importRun(page: Page): Promise<void> {
  await page.goto('/activities')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Import activities' })
  await sheet.getByRole('radio', { name: 'Activity files' }).check()
  await sheet.getByLabel('Activity files (FIT, GPX, TCX, ZIP)').setInputFiles(bandRun())
  await sheet.getByRole('button', { name: 'Import files' }).click()
  await expect(sheet.getByText(/1 added to your log\./)).toBeVisible()
  await sheet.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('link', { name: /^Run, / }).click()
}

test('the heart-rate bands fit 320 px at 150% and 200% text with every time in view', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  await importRun(page)
  const bands = page.getByRole('list', { name: 'Time in 10 bpm bands' })
  await expect(bands).toBeVisible()
  const rows = bands.getByRole('listitem')
  expect(await rows.count()).toBeGreaterThanOrEqual(4)

  for (const text of [100, 150, 200]) {
    await page.setViewportSize({ width: 320, height: 700 })
    await page.evaluate((t) => {
      document.documentElement.style.fontSize = t === 100 ? '' : `${String(t)}%`
    }, text)
    await bands.scrollIntoViewIfNeeded()
    if (SHOTS_DIR !== undefined) {
      mkdirSync(SHOTS_DIR, { recursive: true })
      await bands.screenshot({ path: join(SHOTS_DIR, `zones-320-text${String(text)}.png`) })
    }
    const label = `${String(text)}% text`
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(scrolls, `sideways scroll at ${label}`).toBe(false)
    const viewport = page.viewportSize()?.width ?? 0
    for (let i = 0; i < (await rows.count()); i += 1) {
      // the time reads "m:ss (n%)" and sits wholly inside the viewport
      const time = rows.nth(i).locator('span').last()
      await expect(time, `band ${String(i)} at ${label}`).toHaveText(/\d.*\(\d+%\)/)
      const box = await time.boundingBox()
      expect(box, `band ${String(i)} box at ${label}`).not.toBeNull()
      expect(box?.x ?? -1, `band ${String(i)} left at ${label}`).toBeGreaterThanOrEqual(0)
      expect(
        (box?.x ?? 0) + (box?.width ?? 0),
        `band ${String(i)} right at ${label}`,
      ).toBeLessThanOrEqual(viewport)
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = ''
  })
})

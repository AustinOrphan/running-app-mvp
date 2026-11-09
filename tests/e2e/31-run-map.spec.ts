import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { syntheticRun } from '../fixtures/syntheticRoute.ts'
import { resetData, signedInApi } from './helpers.ts'

// The route map on the activity page (M1b). The tile server is never reached: every request to it is
// answered here with a drawn tile, and the spec fails on a request to any other host. A tile that
// loads proves the page's Content-Security-Policy lets the tile host through (a blocked image never
// reaches the network at all).
//
// Setting MAP_SHOTS_DIR makes the viewport pass also write a screenshot of the map section.

const TILE_HOST = 'tile.openstreetmap.org'
const SHOTS_DIR = process.env.MAP_SHOTS_DIR

/** A made-up street map for one tile: land, a river, a few roads and blocks, from the tile address. */
function tileSvg(z: number, x: number, y: number): string {
  const seed = (x * 7919 + y * 104729 + z * 31) % 97
  const roads = [0, 1, 2, 3].map((k) => 32 + ((seed * (k + 3) * 13) % 190))
  const lines = roads
    .map(
      (r, k) =>
        `<path d="M${k % 2 ? r : 0} ${k % 2 ? 0 : r} L${k % 2 ? r : 256} ${k % 2 ? 256 : r}" stroke="#ffffff" stroke-width="${k === 0 ? 7 : 4}" fill="none"/>`,
    )
    .join('')
  const blocks = roads
    .map(
      (r, k) =>
        `<rect x="${(r + k * 40) % 200}" y="${(r * 3 + k * 70) % 200}" width="40" height="30" fill="#dcd6c6"/>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#ece8dc"/><path d="M0 ${60 + seed} C80 ${seed} 160 ${140 - seed} 256 ${90 + seed}" stroke="#a9c8e8" stroke-width="14" fill="none"/>${blocks}${lines}</svg>`
}

/** Answers the tile server from the page and records every outside request. */
async function mockTiles(
  page: Page,
): Promise<{ tiles: string[]; outside: string[]; referers: Array<string | undefined> }> {
  const seen = {
    tiles: [] as string[],
    outside: [] as string[],
    referers: [] as Array<string | undefined>,
  }
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === TILE_HOST) {
      seen.tiles.push(url.pathname)
      seen.referers.push(route.request().headers()['referer'])
      const m = /^\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url.pathname)
      if (m === null) return route.fulfill({ status: 404 })
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: tileSvg(Number(m[1]), Number(m[2]), Number(m[3])),
      })
    }
    if (url.hostname !== 'localhost') {
      seen.outside.push(url.href)
      return route.abort()
    }
    return route.continue()
  })
  return seen
}

/** A half-hour run round the synthetic loop, with heart rate and altitude. */
function mapRun() {
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
      hr: 140 + Math.round(10 * Math.sin(f.t / 100)),
      altitudeM: 100 + Math.round(8 * Math.sin(f.t / 70)),
    }))
  const bytes = buildFit({
    serial: 4_100_000_031,
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
  return { name: 'map-run.fit', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) }
}

async function importMapRun(page: Page): Promise<void> {
  await page.goto('/activities')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Import activities' })
  await sheet.getByRole('radio', { name: 'Activity files' }).check()
  await sheet.getByLabel('Activity files (FIT, GPX, TCX, ZIP)').setInputFiles(mapRun())
  await sheet.getByRole('button', { name: 'Import files' }).click()
  await expect(sheet.getByText(/1 added to your log\./)).toBeVisible()
  await sheet.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('link', { name: /^Run, / }).click()
}

const section = (page: Page) => page.getByRole('region', { name: 'Route of this run' })
const dot = (page: Page) => page.locator('[data-marker="cursor"]')

test('the run map: tiles through the CSP, the route, hidden ends, the chart dot, the switch, no sideways scroll', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  const seen = await mockTiles(page)
  const violations: string[] = []
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text())
  })

  await importMapRun(page)
  const map = section(page)
  await expect(map.getByRole('img', { name: 'Map of the route' })).toBeVisible()

  // tiles load: the policy let the tile host through, and the page asked no other outside host
  const tiles = map.locator('img[src^="https://tile.openstreetmap.org/"]')
  await expect.poll(() => tiles.count()).toBeGreaterThan(0)
  await expect
    .poll(() =>
      tiles.evaluateAll(
        (all) => all.filter((img) => (img as HTMLImageElement).naturalWidth > 0).length,
      ),
    )
    .toBeGreaterThan(0)
  expect(seen.outside).toEqual([])
  expect(violations).toEqual([])

  // the route, the credit, the scale, and the default of hidden ends
  await expect(map.locator('polyline')).toHaveCount(2)
  await expect(map.getByRole('link', { name: '© OpenStreetMap contributors' })).toHaveAttribute(
    'href',
    'https://www.openstreetmap.org/copyright',
  )
  await expect(map.locator('[data-scale]')).toBeVisible()
  await expect(map.getByText('The first and last 200 m are hidden.')).toBeVisible()
  await expect(map.locator('[data-marker="cut-start"]')).toBeVisible()
  await expect(map.locator('[data-marker="start"]')).toHaveCount(0)

  // a chart pointer moves the dot, and the dot goes when the pointer leaves
  const pace = page.getByRole('img', { name: /^Pace, average/ })
  await pace.scrollIntoViewIfNeeded()
  const box = (await pace.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 4 })
  await expect(dot(page)).toBeVisible()
  const early = (await dot(page).boundingBox())!
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 4 })
  await expect
    .poll(async () => {
      const now = await dot(page).boundingBox()
      return now === null ? 0 : Math.hypot(now.x - early.x, now.y - early.y)
    })
    .toBeGreaterThan(8)
  await page.mouse.move(2, 2, { steps: 2 })
  await expect(dot(page)).toBeHidden()

  // every viewport and both themes: no sideways scroll, the height asked for, the route in view
  const passes = [
    { width: 320, height: 700, scheme: 'light', mapPx: 240, text: 100 },
    { width: 320, height: 700, scheme: 'dark', mapPx: 240, text: 100 },
    { width: 360, height: 780, scheme: 'light', mapPx: 240, text: 100 },
    { width: 360, height: 780, scheme: 'dark', mapPx: 240, text: 100 },
    { width: 390, height: 844, scheme: 'light', mapPx: 240, text: 100 },
    { width: 390, height: 844, scheme: 'dark', mapPx: 240, text: 100 },
    // larger text: the root size is raised, as a runner's browser setting does, and the map (15rem)
    // and the chips grow with it
    { width: 320, height: 700, scheme: 'light', mapPx: 360, text: 150 },
    { width: 320, height: 700, scheme: 'dark', mapPx: 360, text: 150 },
    { width: 390, height: 844, scheme: 'light', mapPx: 360, text: 150 },
    { width: 390, height: 844, scheme: 'dark', mapPx: 360, text: 150 },
    { width: 768, height: 1024, scheme: 'light', mapPx: 320, text: 100 },
    { width: 1280, height: 900, scheme: 'dark', mapPx: 320, text: 100 },
  ] as const
  for (const pass of passes) {
    await page.setViewportSize({ width: pass.width, height: pass.height })
    await page.emulateMedia({
      colorScheme: pass.scheme,
      reducedMotion: pass.scheme === 'dark' ? 'reduce' : 'no-preference',
    })
    await page.evaluate((text) => {
      document.documentElement.style.fontSize = text === 100 ? '' : `${String(text)}%`
    }, pass.text)
    await expect(map.getByRole('img', { name: 'Map of the route' })).toBeVisible()
    const frame = map.getByRole('img', { name: 'Map of the route' }).locator('..')
    await expect
      .poll(async () => Math.round((await frame.boundingBox())?.height ?? 0))
      .toBe(pass.mapPx)
    // Nothing on the page reaches past the viewport, whatever the text size.
    const reaching = await page.evaluate(() => {
      const all = Array.from(document.body.querySelectorAll('*'))
      const limit = document.documentElement.clientWidth + 1
      return all
        .filter((el) => {
          if (el.getBoundingClientRect().right <= limit) return false
          // what a clipping ancestor hides cannot widen the page
          for (let up = el.parentElement; up !== null; up = up.parentElement) {
            const style = getComputedStyle(up)
            if (style.overflowX !== 'visible' || style.clip !== 'auto') return false
          }
          return true
        })
        .slice(0, 4)
        .map((el) => `${el.tagName}.${String(el.className)}`)
    })
    expect(reaching, `reaches past the viewport at ${String(pass.width)} px`).toEqual([])
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(scrolls, `sideways scroll at ${String(pass.width)}`).toBe(false)
    // the line is inside the frame, the chips do not overlap each other, and the route runs under
    // neither (polled: the fit follows the chips' measured height a frame after the text grows)
    const label = `${String(pass.width)} px at ${String(pass.text)}% text`
    await expect
      .poll(async () => {
        const line = await map.locator('polyline').last().boundingBox()
        const frameBox = await frame.boundingBox()
        const scaleBox = await map.locator('[data-scale]').boundingBox()
        const creditBox = await map.getByRole('link', { name: /OpenStreetMap/ }).boundingBox()
        if (!line || !frameBox || !scaleBox || !creditBox) return 'missing'
        const inside =
          line.x >= frameBox.x - 1 &&
          line.x + line.width <= frameBox.x + frameBox.width + 1 &&
          line.y >= frameBox.y - 1 &&
          line.y + line.height <= frameBox.y + frameBox.height + 1
        const apart =
          scaleBox.x + scaleBox.width <= creditBox.x ||
          creditBox.x + creditBox.width <= scaleBox.x ||
          scaleBox.y + scaleBox.height <= creditBox.y ||
          creditBox.y + creditBox.height <= scaleBox.y
        const clear = line.y + line.height <= Math.min(scaleBox.y, creditBox.y)
        const chipsInside =
          Math.max(scaleBox.y + scaleBox.height, creditBox.y + creditBox.height) <=
            frameBox.y + frameBox.height + 1 &&
          Math.max(scaleBox.x + scaleBox.width, creditBox.x + creditBox.width) <=
            frameBox.x + frameBox.width + 1
        return JSON.stringify({ inside, apart, clear, chipsInside })
      }, label)
      .toBe(JSON.stringify({ inside: true, apart: true, clear: true, chipsInside: true }))
    if (SHOTS_DIR !== undefined) {
      mkdirSync(SHOTS_DIR, { recursive: true })
      await map.scrollIntoViewIfNeeded()
      await map.screenshot({
        path: join(
          SHOTS_DIR,
          `map-${String(pass.width)}-${pass.scheme}${pass.text === 100 ? '' : `-text${String(pass.text)}`}.png`,
        ),
      })
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = ''
  })
  await page.emulateMedia({ colorScheme: null, reducedMotion: null })
  await page.setViewportSize({ width: 1280, height: 900 })

  // the whole route when the runner stops hiding the ends
  await page.goto('/settings')
  const hide = page.getByRole('checkbox', { name: /^Hide the first and last 200 m/ })
  await hide.uncheck()
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved')
  await page.goBack()
  await page.reload()
  await expect(map.locator('[data-marker="start"]')).toBeVisible()
  await expect(map.locator('[data-marker="finish"]')).toBeVisible()
  await expect(map.getByText('The first and last 200 m are hidden.')).toHaveCount(0)
  if (SHOTS_DIR !== undefined) {
    await map.screenshot({ path: join(SHOTS_DIR, 'map-1280-whole-route.png') })
  }
  await page.goto('/settings')
  await page.getByRole('checkbox', { name: /^Hide the first and last 200 m/ }).check()
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved')

  // Map tiles off: no request for a tile, the route and the scale alone on the paper
  await page.goto('/settings')
  const tilesBox = page.getByRole('checkbox', { name: 'Map tiles' })
  await expect(tilesBox).toBeChecked()
  await tilesBox.uncheck()
  const before = seen.tiles.length
  await page.goBack()
  await page.reload()
  await expect(map.getByRole('img', { name: 'Map of the route' })).toBeVisible()
  await expect(map.locator('polyline')).toHaveCount(2)
  await expect(map.locator('[data-scale]')).toBeVisible()
  await expect(map.getByText('Map tiles are off.')).toBeVisible()
  await expect(tiles).toHaveCount(0)
  expect(seen.tiles.length).toBe(before)
  if (SHOTS_DIR !== undefined) {
    await map.screenshot({ path: join(SHOTS_DIR, 'map-1280-tiles-off.png') })
  }
  await page.goto('/settings')
  await page.getByRole('checkbox', { name: 'Map tiles' }).check()

  // the whole run, not only its first load: no other host was asked, no policy blocked anything,
  // and every tile request carried the app's origin as its referer (the tile policy needs one)
  expect(seen.outside).toEqual([])
  expect(violations).toEqual([])
  expect(seen.referers.length).toBeGreaterThan(0)
  const origin = new URL(baseURL ?? '').origin
  for (const referer of seen.referers) expect(referer).toBe(`${origin}/`)
})

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createPrisma } from '../../server/db.ts'
import { OVERPASS_URL, downloadMapArea } from '../../server/services/mapArea.ts'
import { backfillSurfaceBins } from '../../server/services/surfaceBackfill.ts'
import { addDays, todayIso } from '../../shared/dates.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { trackOf, type Metres } from '../fixtures/routeShapes.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { resetData, seedRunWithTrack, signedInApi } from './helpers.ts'

// Trail and road (M1d): Settings, Maps, "Trail and road" downloads the area, and a run inside it
// says how much of it was on trail and road. The server makes the one request to Overpass, which a
// browser route cannot reach, so the spec answers the download itself: the route handler runs the
// server's own `downloadMapArea` against this database with a synthetic Overpass answer, and the
// `surface` job's tick (the 5-minute job) is run by `backfillSurfaceBins`. The page, the API reads
// and the delete are the real ones.
//
// Setting TRAIL_SHOTS_DIR also writes screenshots of the block and of the run page line at 390 px,
// light and dark.

const SHOTS_DIR = process.env.TRAIL_SHOTS_DIR
/** A straight 3 km run east, in open ocean. */
const SHAPE: Metres = [
  [0, 0],
  [3000, 0],
]

const block = (page: Page) => page.getByRole('group', { name: 'Trail and road' })

async function shot(page: Page, name: string, target: ReturnType<Page['locator']>) {
  if (SHOTS_DIR === undefined) return
  mkdirSync(SHOTS_DIR, { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await target.scrollIntoViewIfNeeded()
    await target.screenshot({ path: join(SHOTS_DIR, `${name}-${scheme}.png`) })
  }
}

test('download the area, see a run’s shares, remove the area', async ({ page, baseURL }) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  const api = await signedInApi(page, baseURL ?? '')
  const runId = await seedRunWithTrack(
    api,
    { date: addDays(todayIso(), -1), minutes: 20, distanceM: 3000 },
    SHAPE,
  )

  // An Overpass answer with one trail along the first half of the run and one street along the second.
  const track = trackOf(SHAPE)
  const lat = track.bbox.minLat + 0.00004
  const midLng = (track.bbox.minLng + track.bbox.maxLng) / 2
  const way = (id: number, tags: Record<string, string>, from: number, to: number) => ({
    type: 'way',
    id,
    tags,
    geometry: [
      { lat, lon: from },
      { lat, lon: to },
    ],
  })
  const answer = {
    version: 0.6,
    osm3s: { timestamp_osm_base: '2026-11-08T09:00:00Z' },
    elements: [
      way(1, { highway: 'path' }, track.bbox.minLng - 0.001, midLng),
      way(2, { highway: 'residential' }, midLng, track.bbox.maxLng + 0.001),
    ],
  }
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    const user = await prisma.user.findFirstOrThrow()
    const requests: string[] = []
    const deps = {
      prisma,
      config: {} as never,
      fetch: fakeFetch({
        [`POST ${OVERPASS_URL}`]: async (req) => {
          requests.push(await req.text())
          return new Response(JSON.stringify(answer))
        },
      }),
    }
    await page.route('**/api/map-area', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({ json: await downloadMapArea(deps, user.id) })
    })

    await page.goto('/settings')
    const group = block(page)
    await expect(group).toBeVisible()
    await expect(
      group.getByText(
        'One request to OpenStreetMap with a box of up to 40 × 40 km around where you run. No run or route is sent.',
      ),
    ).toBeVisible()
    await expect(group.getByRole('button', { name: 'Remove' })).toHaveCount(0)
    await shot(page, 'settings-before', group)

    await group.getByRole('button', { name: 'Download map data' }).click()
    await expect(
      group.getByText(
        /^Downloaded .*: 2 ways in an area of \d+ × \d+ (km|mi), 1 of your runs inside it\.$/,
      ),
    ).toBeVisible()
    await expect(group.getByText('The OpenStreetMap data is from Sun 8 Nov 2026.')).toBeVisible()
    await expect(group.getByText(/0 of 1 runs are worked out so far/)).toBeVisible()
    await expect(group.getByRole('button', { name: 'Download again' })).toBeVisible()
    await expect(group.getByRole('button', { name: 'Remove' })).toBeVisible()
    expect(requests).toHaveLength(1)
    // The one request carries the box and nothing else.
    expect([...new URLSearchParams(requests[0]).keys()]).toEqual(['data'])
    expect(requests[0]).not.toContain(runId)

    // The job's tick, then the shares show on the run page and the block counts the run done.
    expect(await backfillSurfaceBins(deps, user.id)).toMatchObject({ filled: 1, remaining: 0 })
    await page.reload()
    await expect(block(page).getByText('Every run inside the area has its shares.')).toBeVisible()
    await shot(page, 'settings-after', block(page))

    await page.goto(`/activities/${runId}`)
    const line = page.getByText(/^Trail \d+ % · road \d+ %$/)
    await expect(line).toBeVisible()
    const [trail] = (await line.textContent())!.match(/\d+/) ?? ['0']
    expect(Number(trail)).toBeGreaterThanOrEqual(40)
    expect(Number(trail)).toBeLessThanOrEqual(60)
    await expect(page.getByText('Map data © OpenStreetMap contributors')).toBeVisible()
    await shot(
      page,
      'run-line',
      page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Summary' }) }),
    )

    // Remove: the block goes back to the button, and the run says nothing about surfaces.
    await page.goto('/settings')
    await block(page).getByRole('button', { name: 'Remove' }).click()
    await expect(block(page).getByRole('button', { name: 'Download map data' })).toBeVisible()
    await expect(block(page).getByRole('button', { name: 'Remove' })).toHaveCount(0)
    await page.goto(`/activities/${runId}`)
    await expect(page.getByRole('heading', { level: 2, name: 'Summary' })).toBeVisible()
    await expect(page.getByText(/^Trail \d+ %/)).toHaveCount(0)
    expect(await prisma.mapWay.count()).toBe(0)
    expect(await prisma.mapArea.count()).toBe(0)
  } finally {
    await prisma.$disconnect()
  }
})

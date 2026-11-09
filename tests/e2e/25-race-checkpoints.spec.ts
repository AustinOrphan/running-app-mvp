import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { courseGpx } from '../fixtures/course/buildCourseGpx.ts'
import { relativeDates, resetData, signedInApi, toast, type Api } from './helpers.ts'

// The runner's checkpoint table on the Race page (rule H14, ADR 0018, step 4 of the race plan):
// enter two points, read the arrival ranges, edit them, and read the same table after a reload. The
// names are synthetic. It runs at 360 px, the narrowest phone the app is checked at, and a table
// that reads by role there reads anywhere. The goal is a 100-mile race with a start time, so the
// table shows the clock and a cutoff in both forms; a second goal state checks the self-supported
// wording.

test.describe.configure({ mode: 'serial' })

let page: Page
let api: Api
let goalId: string

async function scrollsSideways(): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  page = await context.newPage()
  await page.setViewportSize({ width: 360, height: 740 })
  api = await signedInApi(page, baseURL ?? '')
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
    name: 'Checkpoint ultra',
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
  goalId = goal.id
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id, strengthPreference: 0 })
})

test.afterAll(async () => {
  await page.context().close()
})

test('a plan with no rows says it works without them, and offers the editor', async () => {
  await page.goto('/race')
  const heading = page.getByRole('heading', { level: 2, name: 'Checkpoints' })
  await expect(heading).toBeVisible()
  await expect(page.getByText(/The plan works without them/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit checkpoints' })).toBeVisible()
  expect(await scrollsSideways()).toBe(false)
})

test('enters two points and reads their arrival ranges, the cutoff and the finish', async () => {
  await page.goto('/race')
  await page.getByRole('button', { name: 'Edit checkpoints' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit checkpoints' })
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Add a checkpoint' }).click()
  const first = dialog.getByRole('group', { name: 'Point 1' })
  await first.getByLabel('Name').fill('Checkpoint A')
  await first.getByLabel(/^Distance from the start/).fill('30')
  await first.getByLabel(/^Climb \(/).fill('900')
  await first.getByLabel('Cutoff entered as').selectOption('clock')
  await first.getByLabel('Cutoff, time of day').fill('14:30')

  await dialog.getByRole('button', { name: 'Add a checkpoint' }).click()
  const second = dialog.getByRole('group', { name: 'Point 2' })
  await second.getByLabel('Name').fill('Checkpoint B')
  await second.getByLabel(/^Distance from the start/).fill('80')
  await second.getByLabel(/^Descent \(/).fill('500')
  await second.getByLabel('Cutoff, hours and minutes into the race').fill('21:00')

  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(toast(page, 'Saved')).toBeVisible()
  await expect(dialog).toBeHidden()

  const list = page.getByRole('list', { name: 'Arrival times by point' })
  const rows = list.getByRole('article')
  await expect(rows).toHaveCount(3)
  const a = list.getByRole('article', { name: 'Checkpoint A' })
  await expect(a.getByText(/^About \d\d:\d\d( the next day)? to \d\d:\d\d/)).toBeVisible()
  // the cutoff stands in its own lines, in the clock and in time into the race
  await expect(a.getByText('Cutoff 14:30')).toBeVisible()
  await expect(a.getByText('Cutoff 8 h 30 min into the race')).toBeVisible()
  await expect(
    a.getByText('900 m of climb, as entered.').or(a.getByText(/ft of climb, as entered/)),
  ).toBeVisible()
  const b = list.getByRole('article', { name: 'Checkpoint B' })
  await expect(b.getByText(/of descent, shown and not counted/)).toBeVisible()
  await expect(b.getByText(/^Cutoff 03:00 the next day$/)).toBeVisible()
  const finish = list.getByRole('article', { name: 'Finish' })
  await expect(finish.getByText(/^About \d\d:\d\d/)).toBeVisible()
  // grams to carry for an aided race, labelled an estimate
  await expect(a.getByText(/^Carry about \d+ to \d+ g of carbohydrate\.$/)).toBeVisible()
  await expect(page.getByText(/Grams to carry are an estimate/)).toBeVisible()
  // no sentence sets a cutoff against the range
  const table = (await page.getByRole('region', { name: 'Checkpoints' }).textContent()) ?? ''
  expect(table).not.toMatch(/\b(before|after|inside|within|ahead|margin|enough)\b.*cutoff/i)
  expect(await scrollsSideways()).toBe(false)
  await page.screenshot({ path: test.info().outputPath('checkpoints-360.png') })
})

test('the table is still there after a reload, and the plan API holds the finish equal to the expected range', async () => {
  await page.reload()
  const list = page.getByRole('list', { name: 'Arrival times by point' })
  await expect(list.getByRole('article')).toHaveCount(3)
  const view = (await api.get('/race/plan')) as {
    plan: {
      expected: { lowSec: number; highSec: number }
      splits: { rows: Array<{ lowSec: number; highSec: number; finish: boolean }> }
    }
  }
  const finish = view.plan.splits.rows.at(-1)
  expect([finish?.lowSec, finish?.highSec]).toEqual([
    view.plan.expected.lowSec,
    view.plan.expected.highSec,
  ])
  for (const row of view.plan.splits.rows) {
    expect(row.lowSec).toBeLessThanOrEqual(view.plan.expected.highSec)
    expect(row.highSec).toBeLessThanOrEqual(view.plan.expected.highSec)
  }
})

test('edits the table: moves a point, drops another, and the rows change', async () => {
  await page.goto('/race')
  await page.getByRole('button', { name: 'Edit checkpoints' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit checkpoints' })
  const first = dialog.getByRole('group', { name: 'Point 1' })
  await expect(first.getByLabel('Name')).toHaveValue('Checkpoint A')
  await first.getByLabel(/^Distance from the start/).fill('45')
  await dialog.getByRole('button', { name: 'Remove Point 2' }).click()
  await expect(dialog.getByRole('group', { name: 'Point 2' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(toast(page, 'Saved')).toBeVisible()

  const list = page.getByRole('list', { name: 'Arrival times by point' })
  await expect(list.getByRole('article')).toHaveCount(2)
  await expect(list.getByRole('article', { name: 'Checkpoint B' })).toHaveCount(0)
  await expect(list.getByRole('article', { name: 'Checkpoint A' })).toBeVisible()
})

test('the editor refuses a point without a name and a distance past the finish, and keeps the saved table', async () => {
  await page.goto('/race')
  await page.getByRole('button', { name: 'Edit checkpoints' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit checkpoints' })
  await dialog.getByRole('button', { name: 'Add a checkpoint' }).click()
  const second = dialog.getByRole('group', { name: 'Point 2' })
  await second.getByLabel(/^Distance from the start/).fill('999')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(second.getByText(/Give the point a name/)).toBeVisible()
  await expect(second.getByText(/past the start and before the finish/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole('list', { name: 'Arrival times by point' }).getByRole('article'),
  ).toHaveCount(2)
})

test('a self-supported race calls them course points, with no aid wording and no grams to carry', async () => {
  await api.put(`/goals/${goalId}`, { supportLevel: 'self' })
  await page.goto('/race')
  await expect(page.getByRole('heading', { level: 2, name: 'Course points' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit course points' })).toBeVisible()
  const section = page.getByRole('region', { name: 'Course points' })
  await expect(section.getByRole('article')).toHaveCount(2)
  const text = (await section.textContent()) ?? ''
  expect(text).not.toMatch(/aid|checkpoint(?!\s[A-C])|Carry about|Grams to carry/i)
  expect(await scrollsSideways()).toBe(false)
})

test('imports a course GPX file: proposes its waypoints, draws the profile, and saves only the confirmed rows', async () => {
  await api.put(`/goals/${goalId}`, { supportLevel: 'aided' })
  await page.goto('/race')
  const file = courseGpx({
    waypoints: [
      { name: 'Station A', at: 40 },
      { name: 'Station B', at: 90 },
      { name: 'Station C', at: 120 },
    ],
  })
  await page.getByLabel('Course GPX file').setInputFiles({
    name: 'example-course.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(file),
  })
  const dialog = page.getByRole('dialog', { name: 'Checkpoints from the course' })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByText('Proposed from the waypoints in the file: 3.', { exact: false }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('img', { name: /^Elevation profile, from \d+ (m|ft) to \d+ (m|ft)$/ }),
  ).toBeVisible()
  await expect(dialog.getByRole('group', { name: 'Point 3' })).toBeVisible()
  // the dialog holds its width at 360 px, the chart included
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('course-import-360.png') })

  const first = dialog.getByRole('group', { name: 'Point 1' })
  await expect(first.getByLabel('Name')).toHaveValue('Station A')
  await first.getByLabel('Name').fill('Lower station')
  await first.getByLabel('Cutoff, hours and minutes into the race').fill('9:30')
  await dialog.getByRole('button', { name: 'Remove Point 2' }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(toast(page, 'Saved')).toBeVisible()
  await expect(dialog).toBeHidden()

  const list = page.getByRole('list', { name: 'Arrival times by point' })
  await expect(list.getByRole('article')).toHaveCount(3)
  await expect(
    list
      .getByRole('article', { name: 'Lower station' })
      .getByText('Cutoff 9 h 30 min into the race'),
  ).toBeVisible()
  await expect(list.getByRole('article', { name: 'Station C' })).toBeVisible()
  await expect(list.getByRole('article', { name: 'Station B' })).toHaveCount(0)
  // the table holds the rows alone: nothing of the track was stored
  const saved = (await api.get('/race/checkpoints')) as {
    checkpoints: Array<Record<string, unknown>>
  }
  expect(saved.checkpoints.map((row) => Object.keys(row).sort())).toEqual([
    ['cutoffSec', 'distanceM', 'gainM', 'lossM', 'name'],
    ['cutoffSec', 'distanceM', 'gainM', 'lossM', 'name'],
  ])
  expect(await scrollsSideways()).toBe(false)
})

test('a file that is not a course says so and opens nothing', async () => {
  await page.goto('/race')
  await page.getByLabel('Course GPX file').setInputFiles({
    name: 'not-a-course.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from('<gpx></gpx>'),
  })
  await expect(page.getByRole('alert')).toContainText('That file could not be read as a course')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the race card prints on one or two pages, black on white, with no navigation, in either theme', async () => {
  await api.put('/race/checkpoints', {
    checkpoints: Array.from({ length: 24 }, (_unused, i) => ({
      name: `Station ${String(i + 1)}`,
      distanceM: (i + 1) * 6000,
      gainM: 150 + i,
      lossM: 120,
      cutoffSec: (i + 2) * 3600,
    })),
  })
  await page.goto('/race?view=card')
  const list = page.getByRole('list', { name: 'Race card, one block for each stop' })
  await expect(list.getByRole('article')).toHaveCount(26)
  await list
    .getByRole('textbox', { name: 'Crew note for Station 3' })
    .fill('Crew parks at the lower lot and walks up')
  expect(await scrollsSideways()).toBe(false)
  // the split sheet leads the card, one row for the start, each stop and the finish
  const sheet = page.getByRole('table', { name: /^Each stop with its distance/ })
  await expect(sheet.getByRole('row')).toHaveCount(27)
  await expect(sheet.getByRole('rowheader', { name: /^Station 3/ })).toBeVisible()
  // at 360 px the sheet has no scroll box: two or three columns, the cutoff under the arrival
  await expect(sheet.getByRole('columnheader')).toHaveCount(3)
  await expect(sheet.getByRole('columnheader', { name: 'Cutoff' })).toBeHidden()
  await expect(sheet.getByRole('row', { name: /^Station 3 / })).toContainText(
    'Cutoff 10:00, 4 h into the race',
  )
  expect(
    await sheet.evaluate((el) => el.scrollWidth <= (el.parentElement?.clientWidth ?? 0) + 1),
  ).toBe(true)

  // the rail of a wide screen is app chrome too: the wordmark and the theme button stay off paper
  await page.setViewportSize({ width: 1280, height: 800 })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ media: 'print', colorScheme: scheme })
    await expect(page.getByText('Running log', { exact: true })).toBeHidden()
    await expect(page.getByText(/^Theme:/)).toBeHidden()
    // no navigation, and the page is black on white whatever the theme
    await expect(page.getByRole('navigation')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeHidden()
    const colours = await page.evaluate(() => {
      const block = document.querySelector('article')
      return {
        page: getComputedStyle(document.body).backgroundColor,
        text: block === null ? '' : getComputedStyle(block).color,
        border: block === null ? '' : getComputedStyle(block).borderTopColor,
      }
    })
    expect(colours).toEqual({
      page: 'rgb(255, 255, 255)',
      text: 'rgb(0, 0, 0)',
      border: 'rgb(0, 0, 0)',
    })
    // the note prints as text and the field stays on the screen
    await expect(page.getByText('Crew note:')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Crew note for Station 3' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Print the card' })).toBeHidden()
    await expect(page.getByRole('radio', { name: 'Race card' })).toBeHidden()

    // nothing is wider than the paper: at the width of each sheet (A4 794 px, Letter 816 px) the
    // sheet, the blocks and the card stay inside the page, and the page does not scroll sideways
    for (const [paper, width] of [
      ['A4', 794],
      ['Letter', 816],
    ] as const) {
      await page.setViewportSize({ width, height: 1123 })
      const wide = await page.evaluate(() => {
        const root = document.documentElement
        const limit = root.clientWidth
        const past = [
          ...document.querySelectorAll('section[aria-labelledby="race-card-heading"] *'),
        ].filter((el) => el.getBoundingClientRect().right > limit + 1)
        return { past: past.length, scrolls: root.scrollWidth > root.clientWidth }
      })
      expect(wide, `${paper} width in print, ${scheme}`).toEqual({ past: 0, scrolls: false })
    }
    await page.setViewportSize({ width: 1280, height: 800 })

    for (const format of ['A4', 'Letter'] as const) {
      const pdf = await page.pdf({ format, printBackground: true })
      const pages = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0
      expect(pages, `${format} in ${scheme}`).toBeGreaterThanOrEqual(1)
      expect(pages, `${format} in ${scheme}`).toBeLessThanOrEqual(2)
    }
  }
  await page.emulateMedia({ media: null, colorScheme: null })
  await page.setViewportSize({ width: 360, height: 740 })
  // the screen is as it was
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
  await api.put('/race/checkpoints', { checkpoints: [] })
  await page.evaluate(() => {
    window.localStorage.clear()
  })
})

test('a stop with a 60-character name and no break in it does not widen the card at 360 px', async () => {
  const long = 'W'.repeat(60)
  await api.put('/race/checkpoints', {
    checkpoints: [{ name: long, distanceM: 40_000, gainM: 100, lossM: 50, cutoffSec: 9 * 3600 }],
  })
  await page.goto('/race?view=card')
  await expect(page.getByRole('article', { name: long })).toBeVisible()
  await page.getByRole('textbox', { name: `Crew note for ${long}` }).fill('Z'.repeat(120))
  expect(await scrollsSideways()).toBe(false)
  await page.goto('/race')
  await expect(page.getByRole('article', { name: long })).toBeVisible()
  expect(await scrollsSideways()).toBe(false)
  await api.put('/race/checkpoints', { checkpoints: [] })
  await page.evaluate(() => {
    window.localStorage.clear()
  })
})

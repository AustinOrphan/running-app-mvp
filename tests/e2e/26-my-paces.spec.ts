import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { athlete, scaledCurve, syntheticRuns } from '../unit/engine/gradeCurve-fixtures.ts'
import { relativeDates, resetData, RUNNER, signedInApi, type Api } from './helpers.ts'

// My paces (rule C9, ADR 0020): the easy pace, the zones and what the runner can run now, read by
// role. The empty log first (no pace, no time, the test open), then a runner with nine steady runs
// on a heart-rate line, a measured maximum and a 10 km race, at the widths the app is checked at,
// in light and dark, with reduced motion and from the keyboard. The runs are synthetic and are
// written straight to the database, because the activity API takes no heart-rate histogram.

test.describe.configure({ mode: 'serial' })

const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const

/** The tab bar under the content on a phone (`--tabbar-h`). */
const TAB_BAR_PX = 56

let page: Page
let api: Api

async function scrollsSideways(): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

/**
 * Nine steady flat runs inside the last eight weeks on the line HR = 90 + 20 x speed, speeds 2.3 to
 * 3.1 m/s, and a 10 km race 40 days ago. With a measured maximum of 190 the top of zone 1 is 148
 * bpm, where the line meets 2.9 m/s.
 */
async function seedRunner(): Promise<void> {
  const { today } = relativeDates()
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: RUNNER.email } })
    const durationSec = 40 * 60
    for (let i = 0; i < 9; i += 1) {
      const speed = 2.3 + i * 0.1
      const avgHr = Math.round(90 + 20 * speed)
      const metres = Math.round(speed * durationSec)
      await prisma.activity.create({
        data: {
          userId: user.id,
          date: addDays(today, -(3 + i * 3)),
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
    await prisma.activity.create({
      data: {
        userId: user.id,
        date: addDays(today, -40),
        type: 'race',
        durationSec: 50 * 60,
        distanceM: 10_000,
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Forty steady runs with terrain bins of a runner half as steep as the default curve (synthetic,
 * seeded), on top of the nine: enough for the climbing bands to pass the test of rule I13. They
 * carry no heart-rate histogram, so the heart-rate line and the predictions do not change.
 */
async function seedTerrainRuns(): Promise<void> {
  const { today } = relativeDates()
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: RUNNER.email } })
    for (const run of syntheticRuns(athlete(scaledCurve(0.5), 0.03), 40, today, 21, 2)) {
      await prisma.activity.create({
        data: {
          userId: user.id,
          date: run.date,
          type: 'run',
          durationSec: 3600,
          distanceM: 9000,
          terrainBins: JSON.stringify(run.bins),
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  page = await context.newPage()
  api = await signedInApi(page, baseURL ?? '')
  await resetData()
})

test.afterAll(async () => {
  await page.context().close()
})

test('with an empty log the page says what would give a pace, opens the test and predicts nothing', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/more')
  await page
    .getByRole('navigation', { name: 'More pages' })
    .getByRole('link', { name: /^My paces/ })
    .click()
  await expect(page).toHaveURL(/\/paces$/)
  await expect(page.getByRole('heading', { level: 1, name: 'My paces' })).toBeVisible()

  const easy = page.getByRole('region', { name: 'Easy pace' })
  await expect(easy.getByText('No easy pace yet')).toBeVisible()
  // No age and no maximum heart rate on the profile: there is no ceiling to read the line against.
  await expect(easy.getByText(/^Your zones hold no heart-rate ceiling yet\./)).toBeVisible()
  await expect(easy.getByRole('link', { name: 'Open Profile' })).toBeVisible()
  await expect(easy.getByRole('link', { name: 'A short test' })).toBeVisible()

  const events = page.getByRole('region', { name: 'What you can run now' })
  await expect(events.getByText('Not enough to say yet for this distance.')).toHaveCount(5)

  // The steps of the test are open, from the Params of the fit.
  const test_ = page.getByRole('region', { name: 'A short test' })
  await expect(
    test_.getByText(/^Run 3 hard, flat efforts of .+ to .+, on separate days/),
  ).toBeVisible()
  await expect(test_.getByText('0 of 3 efforts found so far.')).toBeVisible()
  // No grade data: every grade shows the default, and the section says what gives data.
  const grades = page.getByRole('region', { name: 'Climbs and descents' })
  await expect(grades.getByText(/^No steady run has grade data yet/)).toBeVisible()
  await expect(grades.getByRole('row')).toHaveCount(10)
  await expect(grades.getByText('Yours', { exact: true })).toHaveCount(0)
  await expect(grades.getByText(/^No climbing grade has enough runs to say/)).toBeVisible()
  expect(await scrollsSideways()).toBe(false)
})

test('a runner with a heart-rate line gets a pace range, a hot day, a climb and the events', async () => {
  await seedRunner()
  await api.put('/profile', { hrMax: 190, hrMaxSource: 'measured', birthYear: 1985 })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/paces')

  const easy = page.getByRole('region', { name: 'Easy pace' })
  await expect(
    easy.getByText(/^Easy running keeps your heart rate at or under 148 bpm/),
  ).toBeVisible()
  await expect(easy.getByText(/^From 9 steady runs since /)).toBeVisible()
  await expect(easy.getByText('Confidence is moderate.')).toBeVisible()
  await expect(easy.getByText('Evidence grade D')).toBeVisible()
  const terms = easy.getByRole('term')
  await expect(terms).toHaveCount(3)
  await expect(terms.nth(0)).toHaveText('Cool and flat')
  await expect(terms.nth(1)).toHaveText(/^Hot day, WBGT 25 °C, default heat rise$/)
  await expect(terms.nth(2)).toHaveText('Climb of 5%')
  await expect(
    easy.getByText(/^The climb row uses the default cost of a grade: too few/),
  ).toBeVisible()

  // The first screen at 390 x 844: the heading, the jump links and the lead figure are in view.
  const unit = easy.getByText(/^\/(km|mi)$/).first()
  const box = await unit.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y + box!.height).toBeLessThan(844 - TAB_BAR_PX)

  // The zones are the Profile's: the same boundaries with their sources.
  const zones = page.getByRole('region', { name: 'Zones' })
  await expect(zones.getByText('Easy heart rate limit')).toBeVisible()
  await expect(zones.getByRole('row', { name: /^Zone 1/ })).toBeVisible()

  // The five distances, the 10 km from the race.
  const events = page.getByRole('region', { name: 'What you can run now' })
  for (const name of ['5 km', '10 km', 'Half marathon', 'Marathon', '50 km']) {
    await expect(events.getByRole('article', { name, exact: true })).toBeVisible()
  }
  const ten = events.getByRole('article', { name: '10 km', exact: true })
  await expect(ten.getByText(/^From your .+ on /)).toBeVisible()
  await expect(ten.getByText('Evidence grade D')).toBeVisible()
  await expect(
    events
      .getByRole('article', { name: 'Marathon', exact: true })
      .getByText('One source only, so the range is wider.'),
  ).toBeVisible()

  // A course of the runner's own, with climb.
  await events.getByLabel(/^Distance \((km|mi)\)$/).fill('15')
  await events.getByLabel('Climb (m), optional').fill('300')
  await events.getByRole('button', { name: 'Show paces' }).click()
  const custom = events.getByRole('article', { name: /^(15\.00 km|15\.00 mi)$/ })
  await expect(custom).toBeVisible()
  await expect(custom.getByText(/^Climb is counted as flat distance/)).toBeVisible()
  await events.getByRole('button', { name: 'Clear' }).click()
  await expect(custom).toHaveCount(0)

  // The disclosure traces a figure to its rule.
  await easy.getByText('How this is made').click()
  await expect(easy.getByText(/\(A8\)/)).toBeVisible()
  await easy.getByRole('button', { name: 'Why: the easy pace' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The test is closed: critical speed is not in place, so its steps stay one tap away.
  const test_ = page.getByRole('region', { name: 'A short test' })
  await expect(test_.getByText('Make the longest last at least 2 times')).not.toBeVisible()
  await test_.getByText('The steps').click()
  await expect(test_.getByText('Make the longest last at least 2 times')).toBeVisible()
})

test('with enough steady runs on grades the climb row and the table show the runner own speed', async () => {
  await seedTerrainRuns()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/paces')

  const easy = page.getByRole('region', { name: 'Easy pace' })
  await expect(easy.getByRole('term').nth(2)).toHaveText(
    'Climb of 5%, from your own runs on this grade',
  )
  await expect(easy.getByText(/^The climb row uses the speed you kept on this grade/)).toBeVisible()

  const grades = page.getByRole('region', { name: 'Climbs and descents' })
  await expect(grades.getByText(/^From 40 steady runs in the last 52 weeks/)).toBeVisible()
  await expect(grades.getByText(/^No steady run has grade data yet/)).toHaveCount(0)
  const row = grades.getByRole('row', { name: /^3% to 6%/ })
  await expect(row.getByText('Yours', { exact: true })).toBeVisible()
  await expect(grades.getByRole('row', { name: /^Flat, -3% to 3%/ })).toContainText('100%')
  await expect(grades.getByText(/^Walking passes half the time from \d+%\./)).toBeVisible()
  await expect(
    grades.getByText(/^Walking here means slower than \d+:\d{2} \/(km|mi)\.$/),
  ).toBeVisible()

  // The disclosure names the rules, the gate and that nothing else reads the curve.
  await grades.getByText('How this is made').click()
  await expect(grades.getByText(/leaving each run out in turn/)).toBeVisible()
  await expect(grades.getByText(/a sign test at 1%\), on at least 7 tested runs/)).toBeVisible()
  await expect(
    grades.getByText(/^This is display only: predictions still count climb/),
  ).toBeVisible()
  await grades.getByRole('button', { name: 'Why: the speed by grade' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await scrollsSideways()).toBe(false)
})

test('a failed read shows the shared error state, and Try again brings the page back', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/paces', (route) => route.abort())
  await page.goto('/paces')
  await expect(page.getByRole('alert')).toHaveText('My paces did not load.')
  await page.unroute('**/api/paces')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('region', { name: 'Climbs and descents' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

for (const viewport of WIDTHS) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the page stays inside ${String(viewport.width)} px in ${scheme}, with reduced motion`, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await page.goto('/paces')
      await expect(page.getByRole('region', { name: 'Easy pace' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'What you can run now' })).toBeVisible()
      await expect(page.getByRole('row', { name: /^3% to 6%/ })).toBeVisible()
      expect(await scrollsSideways()).toBe(false)
      if (scheme === 'light') {
        await page.screenshot({
          path: test.info().outputPath(`paces-${String(viewport.width)}.png`),
          fullPage: true,
        })
      }
    })
  }
}

test('the page works from the keyboard: Tab to a jump link, Enter, and open a disclosure', async () => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/paces')
  const nav = page.getByRole('navigation', { name: 'On this page' })
  await nav.getByRole('link', { name: 'Easy pace' }).focus()
  await page.keyboard.press('Tab')
  const zones = nav.getByRole('link', { name: 'Zones' })
  await expect(zones).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#zones$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Zones' })).toBeInViewport()
  const grades = nav.getByRole('link', { name: 'Climbs and descents' })
  await grades.focus()
  await expect(grades).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#grades$/)
  await expect(
    page.getByRole('heading', { level: 2, name: 'Climbs and descents' }),
  ).toBeInViewport()

  // A disclosure opens and closes from its summary with the keyboard.
  const how = page.getByRole('region', { name: 'Easy pace' }).getByText('How this is made')
  await how.focus()
  await expect(how).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Easy pace' }).getByText(/\(A8\)/)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('region', { name: 'Easy pace' }).getByText(/\(A8\)/),
  ).not.toBeVisible()
})

for (const scheme of ['light', 'dark'] as const) {
  test(`nothing on the page is drawn in red, in ${scheme} (rule G5), and its words are plain`, async () => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/paces')
    await expect(page.getByRole('region', { name: 'What you can run now' })).toBeVisible()
    // Every colour the page paints (text, background, border, outline) is read as the browser
    // computes it; a colour is red when its red channel leads both others by 60 or more.
    const reds = await page.evaluate(() => {
      const red = (value: string): boolean => {
        const found = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value)
        if (found === null) return false
        const [r, g, b] = [Number(found[1]), Number(found[2]), Number(found[3])]
        const alpha = found[4] === undefined ? 1 : Number(found[4])
        return alpha > 0 && r - g >= 60 && r - b >= 60
      }
      const found: string[] = []
      for (const element of document.querySelectorAll('main, main *')) {
        const style = getComputedStyle(element)
        for (const property of [
          'color',
          'backgroundColor',
          'borderTopColor',
          'outlineColor',
        ] as const) {
          if (red(style[property])) found.push(`${element.tagName.toLowerCase()} ${property}`)
        }
      }
      return found
    })
    expect(reds).toEqual([])
    const body = (await page.getByRole('main').textContent()) ?? ''
    expect(body).not.toMatch(/\b(behind|missed|failed|streak)\b|!/i)
  })
}

test('Profile and a goal prediction link to the page', async () => {
  const { today } = relativeDates()
  await page.goto('/profile')
  await page.getByRole('link', { name: 'Your easy pace and what you can run now' }).click()
  await expect(page).toHaveURL(/\/paces$/)

  const goal = (await api.post('/goals', {
    name: 'Paces check 10k',
    priority: 'A',
    targetDate: addDays(today, 70),
    distanceM: 10_000,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await page.goto('/goals')
  await page.getByRole('link', { name: 'See your paces at other distances' }).click()
  await expect(page).toHaveURL(/\/paces$/)
  await expect(page.getByRole('heading', { level: 1, name: 'My paces' })).toBeVisible()
})

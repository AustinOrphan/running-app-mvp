import { expect, test, type Locator, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import type { PlanSession, PlanWithSessions, WristItem, WristStatus } from '../../shared/types.ts'
import { publishable } from '../../shared/workouts/labels.ts'
import {
  logStrengthSession,
  nextStrengthWorkout,
  planWithRunToday,
  relativeDates,
  resetData,
  saveStrengthSetup,
  signedInApi,
  strengthOnlyToday,
} from './helpers.ts'

// A phone-width viewport: nothing may be clipped out of reach or push the page sideways.
// One shared signed-in page keeps the specs within the login limiter's 10 attempts per window.
test.describe.configure({ mode: 'serial' })

let page: Page
let api: Awaited<ReturnType<typeof signedInApi>>

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 740 } })
  page = await context.newPage()
  api = await signedInApi(page, baseURL ?? '')
})

test.afterAll(async () => {
  await page.context().close()
})

test('every Fatigue rating sits inside its control at 360 px and can be chosen', async () => {
  const { lastWednesday, raceDate } = relativeDates()
  await resetData()
  await api.post('/activities', {
    date: lastWednesday,
    type: 'run',
    durationSec: 45 * 60,
    distanceM: 8047,
  })
  const goal = (await api.post('/goals', {
    name: 'Narrow marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', {
    goalId: goal.id,
    strengthPreference: 2,
  })

  await page.goto('/review')
  const group = page.getByRole('radiogroup', { name: 'Fatigue (1-10)' })
  await expect(group).toBeVisible()
  const groupBox = await group.boundingBox()
  expect(groupBox).not.toBeNull()
  for (const rating of ['1', '9', '10']) {
    const radio = group.getByRole('radio', { name: rating, exact: true })
    const box = await radio.boundingBox()
    expect(box, `rating ${rating}`).not.toBeNull()
    if (!box || !groupBox) continue
    expect(box.x, `rating ${rating} left edge`).toBeGreaterThanOrEqual(groupBox.x - 0.5)
    expect(box.x + box.width, `rating ${rating} right edge`).toBeLessThanOrEqual(
      groupBox.x + groupBox.width + 0.5,
    )
  }
  await group.getByRole('radio', { name: '10', exact: true }).click()
  await expect(group.getByRole('radio', { name: '10', exact: true })).toBeChecked()
})

test('the check-in row keeps five answers on one line at 360 px, none clipped, no scrolling', async () => {
  await resetData()
  await page.goto('/')
  const group = page.getByRole('radiogroup', { name: 'How do you feel today?' })
  await expect(group).toBeVisible()
  const groupBox = await group.boundingBox()
  expect(groupBox).not.toBeNull()
  expect(await group.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  const tops = new Set<number>()
  for (const word of ['Fresh', 'Good', 'Normal', 'Tired', 'Drained']) {
    const radio = group.getByRole('radio', { name: word, exact: true })
    const box = await radio.boundingBox()
    expect(box, word).not.toBeNull()
    if (!box || !groupBox) continue
    tops.add(Math.round(box.y))
    expect(box.x, `${word} left edge`).toBeGreaterThanOrEqual(groupBox.x - 0.5)
    expect(box.x + box.width, `${word} right edge`).toBeLessThanOrEqual(
      groupBox.x + groupBox.width + 0.5,
    )
    expect(box.height, `${word} height`).toBeGreaterThanOrEqual(44)
    // The word fits inside its own button.
    expect(await radio.evaluate((el) => el.scrollWidth - el.clientWidth), word).toBeLessThanOrEqual(
      0,
    )
  }
  expect(tops.size, 'all five answers share one line').toBe(1)
  expect(await pageOverflow()).toBeLessThanOrEqual(0)
})

test('the check-in sheet has 44 px targets at 360 px and does not scroll sideways', async () => {
  await resetData()
  await page.goto('/')
  await page.getByRole('button', { name: "Something hurts, or I'm ill" }).click()
  const sheet = page.getByRole('dialog', { name: 'Check-in' })
  await expect(sheet).toBeVisible()
  // Measure after the slide-up animation ends.
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))

  const scales = ['Fatigue', 'Soreness', 'Sleep quality', 'Mood', 'Stress', 'Pain today']
  for (const scale of scales) {
    const buttons = await sheet.getByRole('group', { name: scale }).getByRole('button').all()
    expect(buttons.length, scale).toBeGreaterThanOrEqual(5)
    for (const button of buttons) {
      const box = await button.boundingBox()
      const label = (await button.getAttribute('aria-label')) ?? scale
      expect(box, label).not.toBeNull()
      expect(box?.width ?? 0, `${label} width`).toBeGreaterThanOrEqual(43.5)
      expect(box?.height ?? 0, `${label} height`).toBeGreaterThanOrEqual(43.5)
    }
  }
  for (const name of ['Feeling ill', 'Point tenderness on a bone']) {
    const row = sheet.locator('label').filter({ hasText: name })
    const box = await row.boundingBox()
    expect(box, name).not.toBeNull()
    expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(43.5)
  }
  const form = sheet.locator('form')
  expect(await form.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  expect(await pageOverflow()).toBeLessThanOrEqual(0)

  // The pain scale wraps to a second row instead of shrinking its buttons.
  const pain = await sheet.getByRole('group', { name: 'Pain today' }).getByRole('button').all()
  const rows = new Set<number>()
  for (const button of pain) rows.add(Math.round((await button.boundingBox())?.y ?? 0))
  expect(rows.size).toBe(2)
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()
})

test('the Activities type filter needs no scrolling at 360 px', async () => {
  await resetData()
  await api.post('/activities', {
    date: relativeDates().lastWednesday,
    type: 'run',
    durationSec: 45 * 60,
    distanceM: 8047,
  })
  await page.goto('/activities')
  const group = page.getByRole('radiogroup', { name: /type/i })
  await expect(group).toBeVisible()
  const overflow = await group.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the Stats page does not scroll sideways at 360 px; wide tables scroll inside', async () => {
  const { lastWednesday } = relativeDates()
  await resetData()
  await api.post('/activities', {
    date: lastWednesday,
    type: 'run',
    durationSec: 45 * 60,
    distanceM: 8047,
  })

  await page.goto('/stats')
  await expect(page.getByRole('heading', { name: 'Weekly history' })).toBeVisible()
  // The charts are lazy chunks that draw after the tables, and a chart is 640 px wide for its first
  // frame, before it measures its box. Measure with both in place, so a pass covers them.
  await expect(page.getByRole('img', { name: 'Run hours per week, last 12 weeks' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Run hours per month' })).toBeVisible()
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBeLessThanOrEqual(0)
  const region = page.getByRole('region', { name: 'Weekly history table' })
  const scrollable = await region.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(scrollable).toBe(true)
})

/** True when the element's centre is the element itself or inside it, so nothing sits on top. */
async function isUncovered(locator: ReturnType<Page['locator']>): Promise<boolean> {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return top !== null && el.contains(top)
  })
}

/** How far the page reaches past the viewport sideways, in pixels. */
async function pageOverflow(): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

test('Integrations with Recent syncs open does not scroll sideways at 360 px', async () => {
  const { lastWednesday } = relativeDates()
  await resetData()
  // A connected source with two runs in its log: the same push twice.
  const issued = (await api.post('/integrations/apple-health/push-token')) as { token: string }
  const workouts = [6, 7, 8].map((hour) => ({
    id: `narrow-${String(hour)}`,
    name: 'Outdoor Run',
    start: `${lastWednesday} 0${String(hour)}:00:00 +0000`,
    end: `${lastWednesday} 0${String(hour)}:30:00 +0000`,
    distance: { qty: 5, units: 'km' },
  }))
  for (let push = 0; push < 2; push += 1) {
    const res = await page.request.post('/api/ingest/apple-health', {
      headers: { Authorization: `Bearer ${issued.token}` },
      data: { data: { metrics: [], workouts } },
    })
    expect(res.ok(), `push ${String(push)} answered ${String(res.status())}`).toBe(true)
  }

  await page.goto('/integrations')
  const card = page.getByRole('region', { name: 'Apple Health' })
  await expect(card).toBeVisible()
  const history = card.locator('details').filter({ hasText: 'Recent syncs' })
  await history.getByText('Recent syncs').click()
  const runs = history.getByRole('listitem')
  await expect(runs).toHaveCount(2)
  await expect(runs.first()).toContainText('Stored 3 new activities')
  expect(await pageOverflow()).toBeLessThanOrEqual(0)
  // Every line of the log stays inside the card.
  const cardBox = await card.boundingBox()
  expect(cardBox).not.toBeNull()
  for (const run of await runs.all()) {
    const box = await run.boundingBox()
    expect(box).not.toBeNull()
    if (!box || !cardBox) continue
    expect(box.x).toBeGreaterThanOrEqual(cardBox.x - 0.5)
    expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5)
  }
})

test('the Goals question for Make active fits at 360 px and clears the tab bar', async () => {
  const { lastWednesday, thisMonday } = relativeDates()
  await resetData()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  const longName = 'The narrow viewport marathon with a rather long name to wrap'
  const first = (await api.post('/goals', {
    name: longName,
    priority: 'A',
    targetDate: addDays(thisMonday, 7 * 14 + 5),
    distanceM: 42_195,
    goalType: 'finish',
  })) as { id: string }
  // The goal that is made active names the build button, so its name is the long one that has to
  // wrap over several lines inside the button.
  const nextName =
    'Narrow 10K around the reservoir and back along the river path past the old mill and the lake to the trailhead car park'
  await api.post('/goals', {
    name: nextName,
    priority: 'B',
    // Later than the plan's race, so its card is the last one and the question ends the page.
    targetDate: addDays(thisMonday, 7 * 16 + 5),
    distanceM: 10_000,
    goalType: 'finish',
  })
  await api.post(`/goals/${first.id}/activate`)
  await api.post('/plan/generate', { goalId: first.id })

  await page.goto('/goals')
  const card = page.getByRole('article', { name: nextName })
  await card.getByRole('button', { name: 'Make active' }).click()
  const question = card.getByRole('group', { name: /^The plan follows/ })
  await expect(question).toBeVisible()
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
  })

  expect(await pageOverflow()).toBeLessThanOrEqual(0)
  const viewport = page.viewportSize()
  const navHeight = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())?.height
  const limit = (viewport?.height ?? 0) - (navHeight ?? 0)
  const questionBox = await question.boundingBox()
  expect(questionBox).not.toBeNull()
  expect((questionBox?.x ?? 0) + (questionBox?.width ?? 0)).toBeLessThanOrEqual(
    (viewport?.width ?? 0) + 0.5,
  )
  for (const name of [`Build plan for ${nextName}`, 'Cancel']) {
    const button = question.getByRole('button', { name })
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box, name).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0), `${name} right edge`).toBeLessThanOrEqual(
      (viewport?.width ?? 0) + 0.5,
    )
    expect((box?.y ?? 0) + (box?.height ?? 0), `${name} bottom edge`).toBeLessThanOrEqual(limit)
    expect(await isUncovered(button), name).toBe(true)
  }
  // The label wraps over several lines, which keep room above and below them in the button.
  const padding = await question
    .getByRole('button', { name: `Build plan for ${nextName}` })
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return Math.min(parseFloat(style.paddingTop), parseFloat(style.paddingBottom))
    })
  expect(padding).toBeGreaterThan(0)
  await question.getByRole('button', { name: 'Cancel' }).click()
  await expect(question).toBeHidden()
})

test('the Not 100% sheet and the window banner fit at 360 px, with every button reachable', async () => {
  const { lastWednesday, thisMonday, today } = relativeDates()
  await resetData()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  const goal = (await api.post('/goals', {
    name: 'Narrow window half',
    priority: 'A',
    targetDate: addDays(thisMonday, 7 * 14 + 5),
    distanceM: 21_097,
    goalType: 'finish',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id })
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/plan')

  await page.getByRole('button', { name: 'Not 100%' }).click()
  const sheet = page.getByRole('dialog', { name: 'Not 100%' })
  await expect(sheet).toBeVisible()
  // Measure after the slide-up animation ends.
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))

  const navHeight = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())?.height
  expect(navHeight).toBeGreaterThan(0)
  const viewport = page.viewportSize()
  const width = viewport?.width ?? 0
  const height = viewport?.height ?? 0
  /** The sheet is inside the screen, does not scroll sideways, and its buttons can be tapped. */
  async function expectReachable(buttons: string[]) {
    expect(await pageOverflow(), 'the page').toBeLessThanOrEqual(0)
    expect(
      await sheet.evaluate((el) => el.scrollWidth - el.clientWidth),
      'the sheet',
    ).toBeLessThanOrEqual(0)
    // Nothing inside the sheet reaches past the right edge of the screen.
    const outside = await sheet.evaluate((el) =>
      [...el.querySelectorAll('*')]
        .filter((node) => {
          const box = node.getBoundingClientRect()
          return box.width > 0 && box.right > window.innerWidth + 0.5
        })
        .map((node) => `${node.tagName.toLowerCase()} "${node.textContent?.slice(0, 40) ?? ''}"`),
    )
    expect(outside, 'past the right edge').toEqual([])
    for (const name of buttons) {
      const button = sheet.getByRole('button', { name, exact: true })
      await expect(button, name).toBeVisible()
      const box = await button.boundingBox()
      expect(box, name).not.toBeNull()
      expect((box?.x ?? 0) + (box?.width ?? 0), `${name} right edge`).toBeLessThanOrEqual(
        width + 0.5,
      )
      expect((box?.y ?? 0) + (box?.height ?? 0), `${name} bottom edge`).toBeLessThanOrEqual(height)
      expect(await isUncovered(button), name).toBe(true)
    }
  }

  // Step 1: five reasons, each a whole row.
  await expectReachable(['Cancel', 'Next'])
  for (const radio of await sheet.getByRole('radio').all()) {
    const box = await radio.locator('xpath=ancestor::label').boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 0.5)
  }

  // Step 2, the longest: a niggle with its scale, notice, mode and the caps.
  await sheet.getByRole('radio', { name: /A niggle or pain/ }).check()
  await sheet.getByRole('button', { name: 'Next' }).click()
  await expect(sheet.getByRole('heading', { name: 'When' })).toBeVisible()
  await sheet.getByRole('radio', { name: 'Short easy runs' }).click()
  await sheet.getByLabel('Until').fill(addDays(today, 2))
  await sheet.getByRole('button', { name: 'Pain (0 to 10) 10' }).scrollIntoViewIfNeeded()
  for (const rating of ['0', '10']) {
    const pain = await sheet.getByRole('button', { name: `Pain (0 to 10) ${rating}` }).boundingBox()
    expect((pain?.x ?? 0) + (pain?.width ?? 0), `pain ${rating}`).toBeLessThanOrEqual(width + 0.5)
    expect(pain?.x ?? -1, `pain ${rating}`).toBeGreaterThanOrEqual(0)
  }
  await expectReachable(['Cancel', 'Back', 'Next'])

  // Step 3: the preview, whose rows and buttons stay inside the screen.
  await sheet.getByRole('button', { name: 'Next' }).click()
  await expect(sheet.getByRole('heading', { name: 'What would change' })).toBeVisible()
  await expectReachable(['Cancel', 'Back', 'Apply to my plan'])
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await expect(sheet).toBeHidden()

  // A window in force: the banner wraps inside the screen and its three buttons stay in reach.
  await api.post('/plan/disruptions', {
    reason: 'illness-above-neck',
    mode: 'rest',
    startDate: addDays(today, -1),
    endDate: addDays(today, 1),
  })
  await page.goto('/plan')
  const banner = page.getByRole('region', { name: 'Rest window' })
  await expect(banner).toBeVisible()
  expect(await pageOverflow()).toBeLessThanOrEqual(0)
  const bannerBox = await banner.boundingBox()
  expect((bannerBox?.x ?? 0) + (bannerBox?.width ?? 0)).toBeLessThanOrEqual(width + 0.5)
  for (const name of ["I'm better", 'Extend', 'Remove window']) {
    const button = banner.getByRole('button', { name })
    const box = await button.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual(width + 0.5)
    expect(await isUncovered(button), name).toBe(true)
  }

  // Its sheets fit too: Extend asks for a date and shows the preview above its two buttons.
  await banner.getByRole('button', { name: 'Extend' }).click()
  const extend = page.getByRole('dialog', { name: 'Extend this window' })
  await expect(extend.getByRole('button', { name: 'Apply to my plan' })).toBeEnabled()
  await extend.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  for (const name of ['Cancel', 'Apply to my plan']) {
    const box = await extend.getByRole('button', { name }).boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual(width + 0.5)
    expect((box?.y ?? 0) + (box?.height ?? 0), name).toBeLessThanOrEqual(height)
  }
  expect(await pageOverflow()).toBeLessThanOrEqual(0)
})

for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
]) {
  const name = `${String(size.width)}x${String(size.height)}`

  test(`the fixed tab bar never covers the end of a long page or a sheet's Save at ${name}`, async () => {
    const { lastWednesday, raceDate } = relativeDates()
    await resetData()
    // One run a day for two weeks: a long list, and a history the engine can plan from.
    for (let i = 0; i < 14; i += 1) {
      await api.post('/activities', {
        date: addDays(lastWednesday, -i),
        type: 'run',
        durationSec: (30 + i) * 60,
        distanceM: 5000 + i * 100,
      })
    }
    const goal = (await api.post('/goals', {
      name: 'Tab bar marathon',
      priority: 'A',
      targetDate: raceDate,
      distanceM: 42_195,
    })) as { id: string }
    await api.post(`/goals/${goal.id}/activate`)
    await api.post('/plan/generate', {
      goalId: goal.id,
      strengthPreference: 2,
    })
    await page.setViewportSize(size)
    const navHeight = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())
      ?.height
    expect(navHeight).toBeGreaterThan(0)
    const limit = size.height - (navHeight ?? 0)

    // Last row of a long Activities list, scrolled as far as the page goes.
    await page.goto('/activities')
    const lastRow = page.getByRole('main').getByRole('listitem').last()
    await expect(lastRow).toBeVisible()
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    const rowBox = await lastRow.boundingBox()
    expect(rowBox, 'last activity row').not.toBeNull()
    expect((rowBox?.y ?? 0) + (rowBox?.height ?? 0)).toBeLessThanOrEqual(limit)
    expect(await isUncovered(lastRow)).toBe(true)

    // The Review page's Save button, at the very end of its form.
    await page.goto(`/review`)
    await expect(page.getByText(`Week of`).first()).toBeVisible()
    const save = page.getByRole('button', { name: 'Save review' })
    await save.scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    const saveBox = await save.boundingBox()
    expect(saveBox, 'Save review').not.toBeNull()
    expect((saveBox?.y ?? 0) + (saveBox?.height ?? 0)).toBeLessThanOrEqual(limit)
    expect(await isUncovered(save)).toBe(true)

    // A sheet sits above the tab bar: its Save button is fully on screen and not covered.
    await page.goto('/activities?new=1')
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    // Measure after the slide-up animation ends.
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    const sheetSave = sheet.getByRole('button', { name: 'Save' })
    await expect(sheetSave).toBeVisible()
    const sheetBox = await sheetSave.boundingBox()
    expect(sheetBox, 'sheet Save').not.toBeNull()
    expect((sheetBox?.y ?? 0) + (sheetBox?.height ?? 0)).toBeLessThanOrEqual(size.height)
    expect(await isUncovered(sheetSave)).toBe(true)
  })
}

test('the Plan page keeps the watch strip, its chips and the sheet section inside 360 px', async () => {
  const { lastWednesday, raceDate, today } = relativeDates()
  await resetData()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  const goal = (await api.post('/goals', {
    name: 'Watch marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id })

  // The test is named for this width; the viewport the earlier tests left is not its to rely on.
  await page.setViewportSize({ width: 360, height: 740 })
  // Sending is off in a fresh account: the strip says so and keeps the files one tap away.
  await page.goto('/plan')
  // The disclosure rows of the page are 44 px taps: Plan checks, What changed, Earlier weeks.
  for (const row of [
    page.locator('summary#checks-title'),
    page.locator('summary').filter({ hasText: 'What changed' }),
  ]) {
    const box = await row.boundingBox()
    expect(box, 'a disclosure row').not.toBeNull()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5)
  }
  const strip = page.getByRole('region', { name: 'Watch' })
  await expect(strip).toContainText('Sending to your watch is off.')
  await expect(strip.getByRole('link', { name: 'Download this week as .zip' })).toBeVisible()
  expect(await pageOverflow()).toBeLessThanOrEqual(0)

  // Sending on, with the longest words the chips and sentences can take. The status is the
  // server's to report, and intervals.icu cannot be reached from a test, so the answer is made.
  const plan = (await api.get('/plan')) as PlanWithSessions
  const runs = plan.sessions
    .filter((s) => s.date >= today && publishable(s.kind) && isToRun(s.status))
    .slice(0, 4)
  expect(runs.length).toBe(4)
  const words: Array<Partial<WristItem>> = [
    { status: 'not-delivered', failCode: 'auth' },
    { status: 'waiting', failCode: 'rate-limit', retryAt: new Date().toISOString() },
    {
      status: 'not-delivered',
      failCode: 'device',
      deviceMessage:
        'The workout has more steps than this watch can hold, so Garmin Connect left it out of the upload',
    },
    { status: 'removed', failCode: 'owner-removed' },
  ]
  const item = (session: PlanSession, over: Partial<WristItem>): WristItem => ({
    externalId: session.externalId,
    sessionId: session.id,
    date: session.date,
    kind: session.kind,
    title: 'Easy run, 45 min',
    variant: 'planned',
    status: 'sent',
    failCode: null,
    failMessage: null,
    deviceMessage: null,
    warnings: ['no-threshold-pace'],
    retryAt: null,
    sentAt: null,
    ...over,
  })
  const status: WristStatus = {
    from: today,
    to: addDays(today, 13),
    connection: 'connected',
    settings: { enabled: true, garminLinked: true, lastRunAt: null, running: false },
    calendar: { enabled: false, tokenCreatedAt: null },
    items: runs.map((s, i) => item(s, words[i] ?? {})),
  }
  await page.route('**/api/wrist/status', (route) => route.fulfill({ json: status }))
  try {
    await page.goto('/plan')
    await expect(strip).toContainText('Watch: next 14 days.')
    await expect(strip).toContainText('1 waiting')
    await expect(strip.getByRole('button', { name: 'Send again' })).toBeVisible()
    expect(await pageOverflow()).toBeLessThanOrEqual(0)
    const viewportWidth = page.viewportSize()?.width ?? 0
    for (const control of [
      strip,
      strip.getByRole('button', { name: 'Send again' }),
      strip.getByRole('link', { name: 'Download this week as .zip' }),
    ]) {
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewportWidth + 0.5)
    }
    // The current week opens to its days by itself; a run in a later week shows its chip only
    // once its week is opened, which a run of the suite late in the week would otherwise miss.
    for (const weekStart of new Set(runs.map((s) => s.weekStart))) {
      const toggle = page
        .locator(`tr[data-week="${weekStart}"]`)
        .getByRole('button', { name: /^Days for week of/ })
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    }
    // A chip sits inside the card of its session, not beside it.
    const chips = page.locator('span[data-status]')
    await expect(chips.first()).toBeVisible()
    for (const chip of await chips.all()) {
      const box = await chip.boundingBox()
      expect(box).not.toBeNull()
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewportWidth + 0.5)
    }

    // The sheet of a run whose watch refused it: sentence, warning and both actions on screen.
    await chips.nth(2).locator('xpath=ancestor::button').click()
    const dialog = page.getByRole('dialog')
    const section = dialog.getByRole('region', { name: 'On your watch' })
    await expect(section).toContainText('Garmin Connect did not take it:')
    await section.scrollIntoViewIfNeeded()
    await expect(section.getByRole('button', { name: 'Send again' })).toBeVisible()
    await expect(section.getByRole('link', { name: 'Download the workout file' })).toBeVisible()
    expect(await pageOverflow()).toBeLessThanOrEqual(0)
    for (const part of [
      section,
      section.getByRole('button', { name: 'Send again' }),
      section.getByRole('link', { name: 'Download the workout file' }),
    ]) {
      const box = await part.boundingBox()
      expect(box).not.toBeNull()
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewportWidth + 0.5)
    }
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  } finally {
    await page.unroute('**/api/wrist/status')
  }
})

test('the RPE and pain scales after a run are 44 px squares in two balanced rows at 360 px', async ({
  baseURL,
}) => {
  const run = await planWithRunToday(api, page, baseURL ?? '', 'Scales marathon')
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/')
  await page
    .getByRole('article', { name: run.title })
    .getByRole('button', { name: 'Done', exact: true })
    .click()
  const sheet = page.getByRole('dialog', { name: "Log today's run" })
  await expect(sheet).toBeVisible()
  // Measure after the slide-up animation ends.
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))

  // RPE: ten answers in rows of five, each at least 44 px each way and inside the screen.
  const rpe = sheet.getByRole('group', { name: 'RPE' })
  await rpe.scrollIntoViewIfNeeded()
  const buttons = await rpe.getByRole('button').all()
  expect(buttons.length).toBe(10)
  const rows = new Map<number, number>()
  for (const button of buttons) {
    const box = await button.boundingBox()
    const label = (await button.getAttribute('aria-label')) ?? 'RPE'
    expect(box, label).not.toBeNull()
    expect(box?.width ?? 0, `${label} width`).toBeGreaterThanOrEqual(43.5)
    expect(box?.height ?? 0, `${label} height`).toBeGreaterThanOrEqual(43.5)
    expect((box?.x ?? 0) + (box?.width ?? 0), `${label} right edge`).toBeLessThanOrEqual(360)
    const top = Math.round(box?.y ?? 0)
    rows.set(top, (rows.get(top) ?? 0) + 1)
  }
  expect([...rows.values()], 'RPE 1 to 10 reads as 5 and 5').toEqual([5, 5])

  // Save stays pinned at the foot of the sheet, on screen and uncovered, with the taller scale.
  const save = sheet.getByRole('button', { name: 'Save' })
  const saveBox = await save.boundingBox()
  expect(saveBox).not.toBeNull()
  expect((saveBox?.y ?? 0) + (saveBox?.height ?? 0)).toBeLessThanOrEqual(740)
  expect(await isUncovered(save)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  // The card after a run on Today and the activity page share one pair of scales; the manual
  // form's Pain is the same component: 0 to 10 reads as 6 and 5.
  await page.goto('/activities?new=1')
  const form = page.getByRole('dialog')
  await form.getByRole('button', { name: 'More details' }).click()
  const pain = form.getByRole('group', { name: 'Pain' })
  await pain.scrollIntoViewIfNeeded()
  const painRows = new Map<number, number>()
  for (const button of await pain.getByRole('button').all()) {
    const box = await button.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5)
    const top = Math.round(box?.y ?? 0)
    painRows.set(top, (painRows.get(top) ?? 0) + 1)
  }
  expect([...painRows.values()], 'pain 0 to 10 reads as 6 and 5').toEqual([6, 5])
  expect(await pageOverflow()).toBeLessThanOrEqual(0)
})

test('a tap on Skip in the session sheet shows what would change, with Apply change on screen', async () => {
  const { lastWednesday, raceDate, thisMonday } = relativeDates()
  await resetData()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  const goal = (await api.post('/goals', {
    name: 'Sheet marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id })

  const size = { width: 360, height: 740 }
  await page.setViewportSize(size)
  await page.goto('/plan')
  // this week's days are open when the page opens; open its first run still to do
  await page
    .locator(`tr[data-days-for="${thisMonday}"] button[data-status="planned"]`)
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  const change = dialog.getByRole('region', { name: 'Change this session' })
  // Measure after the slide-up animation ends.
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))

  // The change section is not the last: the watch and the linked activity come after it.
  const names = await dialog
    .getByRole('region')
    .evaluateAll((regions) =>
      regions.map((region) => region.querySelector('h3')?.textContent ?? ''),
    )
  expect(names.indexOf('Change this session')).toBeGreaterThan(-1)
  expect(names.indexOf('Change this session')).toBeLessThan(names.indexOf('Linked activity'))

  // Skip sits at the foot of the screen, so the answer that mounts below it starts off screen.
  const skip = change.getByRole('button', { name: 'Skip session' })
  await skip.evaluate((el) => {
    el.scrollIntoView({ block: 'end' })
  })
  await skip.click()
  const check = change.getByRole('status', { name: 'Check of this change' })
  await expect(check.getByText('What would change')).toBeVisible()
  // The answer came into view with its buttons: both inside the screen and not under anything.
  const apply = check.getByRole('button', { name: 'Apply change' })
  const cancel = check.getByRole('button', { name: 'Cancel' })
  await expect(apply).toBeVisible()
  for (const [name, button] of [
    ['Apply change', apply],
    ['Cancel', cancel],
  ] as const) {
    const box = await button.boundingBox()
    expect(box, name).not.toBeNull()
    expect((box?.y ?? 0) + (box?.height ?? 0), name).toBeLessThanOrEqual(size.height)
    expect(box?.y ?? -1, name).toBeGreaterThanOrEqual(0)
    expect(await isUncovered(button), name).toBe(true)
  }
  // Scrolled back up to the rows of the change, the buttons stay at the foot of the sheet.
  await check.getByText('What would change').scrollIntoViewIfNeeded()
  expect(await isUncovered(apply)).toBe(true)
  expect(await pageOverflow()).toBeLessThanOrEqual(0)

  // Cancel changes nothing.
  await cancel.click()
  await expect(change.getByText('What would change')).toBeHidden()
})

test('the Fuel lab and an open fuel log fit 360 px, with every control reachable', async () => {
  const { lastWednesday, raceDate, today } = relativeDates()
  await resetData()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  const goal = (await api.post('/goals', {
    name: 'Narrow fuel marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
    goalType: 'finish',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id })
  // A product with a long name, two logged long runs (so the history has rows and the ladder has
  // stepped) and a third waiting for a log.
  const product = (await api.post('/fuel/products', {
    name: 'Synthetic electrolyte drink mix with a very long name',
    kind: 'drink',
    servingLabel: 'One scoop in a 500 mL bottle, shaken',
    carbsG: 40,
    sodiumMg: 300,
    multiCarb: true,
  })) as { id: string }
  const runIds: string[] = []
  for (const daysAgo of [5, 3, 1]) {
    const run = (await api.post('/activities', {
      date: addDays(today, -daysAgo),
      type: 'run',
      durationSec: 3 * 3600,
      distanceM: 30_000,
    })) as { id: string }
    runIds.push(run.id)
  }
  for (const [index, id] of runIds.slice(0, 2).entries()) {
    await api.put(`/fuel/logs/${id}`, {
      items: [{ productId: product.id, servings: 4 + index }],
      fluidMl: 1500,
      gut: index,
      nausea: index,
    })
  }

  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/fuel')
  await expect(page.getByRole('heading', { name: 'Fuel lab', level: 1 })).toBeVisible()
  const history = page.getByRole('region', { name: 'Fuel history, newest first' })
  await expect(history.getByRole('row')).toHaveCount(3)
  const width = page.viewportSize()?.width ?? 0
  const height = page.viewportSize()?.height ?? 0

  /** What sticks out past the right edge of the screen, leaving out the table that scrolls inside. */
  async function pastRightEdge(root: ReturnType<Page['locator']>): Promise<string[]> {
    return root.evaluate(
      (el, limit) =>
        [...el.querySelectorAll('*')]
          .filter((node) => {
            if (node.closest('[role="region"][tabindex="0"]') !== null) return false
            const box = node.getBoundingClientRect()
            return box.width > 0 && box.right > limit + 0.5
          })
          .map((node) => `${node.tagName.toLowerCase()} "${node.textContent?.slice(0, 40) ?? ''}"`),
      width,
    )
  }

  // The page: nothing pushes it sideways, and the history table scrolls inside its own box.
  expect(await pageOverflow(), 'the lab page').toBeLessThanOrEqual(0)
  expect(await pastRightEdge(page.getByRole('main')), 'past the right edge').toEqual([])
  // The grades on the ladder are explained in a line of the page, since a phone shows no hover
  // text, and a rung no longer says "Low certainty" beside a C or D badge that says it.
  const ladder = page.getByRole('region', { name: 'Tier ladder' })
  await ladder.scrollIntoViewIfNeeded()
  await expect(ladder.getByText(/Grade C: small trials, observational data/)).toBeVisible()
  await expect(ladder.getByText(/Grade D: a convention or engineering default/)).toBeVisible()
  await expect(ladder.getByText('Low certainty')).toHaveCount(0)
  const historyBox = await history.boundingBox()
  expect((historyBox?.x ?? -1) + (historyBox?.width ?? 0)).toBeLessThanOrEqual(width + 0.5)
  expect(historyBox?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(await history.evaluate((el) => el.scrollWidth > el.clientWidth), 'table scrolls').toBe(
    true,
  )

  // Every button of the lab is on screen when scrolled to and is at least 44 px tall.
  for (const name of ['Add a product', 'Save settings']) {
    const button = page.getByRole('button', { name, exact: true })
    await button.scrollIntoViewIfNeeded()
    const box = await button.boundingBox()
    expect(box, name).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0), `${name} right edge`).toBeLessThanOrEqual(width + 0.5)
    expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(43.5)
    expect(await isUncovered(button), name).toBe(true)
  }

  // The product form opens inside the screen, with Save product in reach.
  await page.getByRole('button', { name: 'Add a product' }).click()
  const productForm = page.getByRole('form', { name: 'Add a product' })
  await expect(productForm).toBeVisible()
  const save = productForm.getByRole('button', { name: 'Save product' })
  await save.scrollIntoViewIfNeeded()
  expect(await pastRightEdge(productForm), 'product form past the right edge').toEqual([])
  expect(await isUncovered(save), 'Save product').toBe(true)
  await productForm.getByRole('button', { name: 'Cancel' }).click()
  await expect(productForm).toBeHidden()

  // The log form of the run still waiting for a log, opened from the lab's own prompt.
  await page.getByRole('button', { name: /^Log fuel for / }).click()
  const sheet = page.getByRole('dialog', { name: 'Fuel log' })
  await expect(sheet).toBeVisible()
  // Measure after the slide-up animation ends.
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const chip = sheet.getByRole('button', { name: /^Add one Synthetic electrolyte/ })
  await chip.click()
  await chip.click()
  await expect(sheet.getByRole('status')).toContainText('You took 80 g of carbohydrate')
  expect(await pageOverflow(), 'the page with the sheet open').toBeLessThanOrEqual(0)
  expect(
    await sheet.evaluate((el) => el.scrollWidth - el.clientWidth),
    'the sheet',
  ).toBeLessThanOrEqual(0)
  expect(await pastRightEdge(sheet), 'sheet past the right edge').toEqual([])
  for (const button of [chip, sheet.getByRole('button', { name: /^Remove one Synthetic/ })]) {
    const box = await button.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5)
  }

  // Both scales: five answers each, inside their group, none under 44 px.
  for (const scale of ['Gut', 'Nausea (optional)']) {
    const group = sheet.getByRole('radiogroup', { name: scale })
    await group.scrollIntoViewIfNeeded()
    const groupBox = await group.boundingBox()
    const radios = await group.getByRole('radio').all()
    expect(radios.length, scale).toBe(5)
    for (const radio of radios) {
      const box = await radio.boundingBox()
      const label = `${scale} ${(await radio.textContent()) ?? ''}`
      expect(box, label).not.toBeNull()
      expect(box?.x ?? -1, `${label} left edge`).toBeGreaterThanOrEqual((groupBox?.x ?? 0) - 0.5)
      expect((box?.x ?? 0) + (box?.width ?? 0), `${label} right edge`).toBeLessThanOrEqual(
        (groupBox?.x ?? 0) + (groupBox?.width ?? 0) + 0.5,
      )
      expect(box?.height ?? 0, `${label} height`).toBeGreaterThanOrEqual(43.5)
      expect(
        await radio.evaluate((el) => el.scrollWidth - el.clientWidth),
        label,
      ).toBeLessThanOrEqual(0)
    }
  }

  // The end of the form: Save and Not this time are fully on screen and not under the tab bar.
  for (const name of ['Save fuel log', 'Not this time']) {
    const button = sheet.getByRole('button', { name, exact: true })
    await button.scrollIntoViewIfNeeded()
    const box = await button.boundingBox()
    expect(box, name).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0), `${name} right edge`).toBeLessThanOrEqual(width + 0.5)
    expect((box?.y ?? 0) + (box?.height ?? 0), `${name} bottom edge`).toBeLessThanOrEqual(height)
    expect(await isUncovered(button), name).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

/**
 * What sticks out past `limit` pixels from the left edge inside `root`, as element and text, leaving
 * out a table that scrolls inside its own box (a region with a tab stop).
 */
async function pastRightEdge(root: Locator, limit: number): Promise<string[]> {
  return root.evaluate(
    (el, edge) =>
      [...el.querySelectorAll('*')]
        .filter((node) => {
          if (node.closest('[role="region"][tabindex="0"]') !== null) return false
          const box = node.getBoundingClientRect()
          return box.width > 0 && box.right > edge + 0.5
        })
        .map((node) => `${node.tagName.toLowerCase()} "${node.textContent.slice(0, 40)}"`),
    limit,
  )
}

/**
 * The controls of `root` that are on the page and smaller than 44 px either way, by name and size.
 * A checkbox is measured by the label that holds it, because the label is what the finger meets.
 */
async function controlsUnder44(root: Locator): Promise<string[]> {
  return root.evaluate((el) => {
    const small: string[] = []
    const selector = 'button, a[href], input, select, textarea, [role="radio"]'
    for (const node of el.querySelectorAll(selector)) {
      if (node instanceof HTMLInputElement && node.type === 'hidden') continue
      const target =
        node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio')
          ? (node.closest('label') ?? node)
          : node
      const box = target.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (box.width < 43.5 || box.height < 43.5) {
        const name = node.getAttribute('aria-label') ?? node.textContent.trim()
        small.push(
          `${node.tagName.toLowerCase()} "${name.slice(0, 40)}" ${String(Math.round(box.width))} x ${String(Math.round(box.height))}`,
        )
      }
    }
    return small
  })
}

test('the Strength page and its setup and logging sheets fit 360 px with every control 44 px', async ({
  baseURL,
}) => {
  const { today } = relativeDates()
  await strengthOnlyToday(page, baseURL ?? '')
  await api.put('/settings', { weightUnit: 'lb' })
  await saveStrengthSetup(api)
  // one session already logged, so that the page holds every section it has: the lifts, the
  // history of a lift and a recent session, beside the next session
  const logged = await nextStrengthWorkout(api)
  await logStrengthSession(api, logged, { date: today, sessionId: logged.sessionId })

  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/strength')
  await expect(page.getByRole('heading', { name: 'Strength', level: 1 })).toBeVisible()
  const next = page.getByRole('region', { name: 'Next session' })
  await expect(next.getByRole('button', { name: 'Log sets' })).toBeVisible()
  await page
    .getByRole('region', { name: 'Lifts' })
    .getByRole('button', { name: 'History of Goblet squat' })
    .click()
  await expect(
    page.getByRole('region', { name: 'History of Goblet squat', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Recent sessions' })).toBeVisible()

  // the page: nothing pushes it sideways, and every control is a 44 px target
  expect(await pageOverflow(), 'the page').toBeLessThanOrEqual(0)
  expect(await pastRightEdge(page.getByRole('main'), 360), 'page past the right edge').toEqual([])
  expect(await controlsUnder44(page.getByRole('main')), 'page controls under 44 px').toEqual([])

  // the setup sheet at its tallest: every kind of equipment ticked, so every field is on show
  await page.getByRole('button', { name: 'Edit equipment' }).click()
  const setup = page.getByRole('dialog', { name: 'Equipment' })
  await expect(setup).toBeVisible()
  await setup.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  for (const kind of ['Kettlebells', 'Bands', 'A step or box', 'Leg press', 'Calf raise machine']) {
    await setup.getByRole('checkbox', { name: kind }).check()
  }
  await setup.getByRole('checkbox', { name: 'Leg curl machine' }).check()
  expect(await pageOverflow(), 'the page with the setup sheet open').toBeLessThanOrEqual(0)
  expect(
    await setup.evaluate((el) => el.scrollWidth - el.clientWidth),
    'the setup sheet',
  ).toBeLessThanOrEqual(0)
  expect(await pastRightEdge(setup, 360), 'setup sheet past the right edge').toEqual([])
  expect(await controlsUnder44(setup), 'setup sheet controls under 44 px').toEqual([])
  const save = setup.getByRole('button', { name: 'Save', exact: true })
  await save.scrollIntoViewIfNeeded()
  const saveBox = await save.boundingBox()
  expect((saveBox?.y ?? 0) + (saveBox?.height ?? 0), 'Save bottom edge').toBeLessThanOrEqual(740)
  expect(await isUncovered(save), 'Save').toBe(true)
  await page.keyboard.press('Escape')
  await expect(setup).toBeHidden()

  // the logging sheet filled as suggested: the steppers and the scales, the footer and Save
  await next.getByRole('button', { name: 'Log sets' }).click()
  const sheet = page.getByRole('dialog', { name: /^Strength, / })
  await expect(sheet.getByRole('button', { name: 'As suggested' })).toBeVisible()
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  await sheet.getByRole('button', { name: 'As suggested' }).click()
  await sheet.getByRole('button', { name: 'More details' }).click()
  expect(await pageOverflow(), 'the page with the logging sheet open').toBeLessThanOrEqual(0)
  expect(
    await sheet.evaluate((el) => el.scrollWidth - el.clientWidth),
    'the logging sheet',
  ).toBeLessThanOrEqual(0)
  expect(await pastRightEdge(sheet, 360), 'logging sheet past the right edge').toEqual([])
  expect(await controlsUnder44(sheet), 'logging sheet controls under 44 px').toEqual([])

  // a set is two lines: the load and the reps side by side, then the reps left under them
  const squat = sheet.getByRole('region', { name: 'Goblet squat', exact: true })
  const load = await squat.getByRole('group', { name: 'Goblet squat, set 1, load' }).boundingBox()
  const reps = await squat
    .getByRole('group', { name: 'Goblet squat, set 1, reps', exact: true })
    .boundingBox()
  const left = await squat
    .getByRole('group', { name: 'Goblet squat, set 1, reps left' })
    .boundingBox()
  expect(Math.abs((load?.y ?? -100) - (reps?.y ?? 100)), 'load and reps share a line').toBeLessThan(
    2,
  )
  expect(left?.y ?? 0, 'reps left under them').toBeGreaterThanOrEqual(
    (load?.y ?? 0) + (load?.height ?? 0) - 1,
  )

  // the footer: Save is pinned in view at the top of the sheet and again at the end of it
  const pinned = sheet.getByRole('button', { name: 'Save', exact: true })
  const pinnedBox = await pinned.boundingBox()
  expect(pinnedBox, 'Save').not.toBeNull()
  expect((pinnedBox?.y ?? 0) + (pinnedBox?.height ?? 0), 'Save bottom edge').toBeLessThanOrEqual(
    740,
  )
  expect(await isUncovered(pinned), 'Save').toBe(true)
  await sheet.getByRole('textbox', { name: 'Note' }).scrollIntoViewIfNeeded()
  expect(await isUncovered(pinned), 'Save at the end of the sheet').toBe(true)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

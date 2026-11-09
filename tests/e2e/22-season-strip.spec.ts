import { expect, test, type Page } from '@playwright/test'
import { addDays, formatShortDate } from '../../shared/dates.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

// The season strip above the Plan page's week table, read by role and tapped, at the two phone
// widths the app is checked at. The same case measures what the first screen holds.

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
]

/** A runner with some history, an active marathon goal and a plan from this Monday. */
async function seedPlan(page: Page, baseURL: string | undefined): Promise<PlanWithSessions> {
  const { today, lastWednesday, raceDate } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  // a run today, so this week has minutes run and the strip draws a solid bar for it
  await api.post('/activities', { date: today, type: 'run', durationSec: 40 * 60, distanceM: 7000 })
  const goal = (await api.post('/goals', {
    name: 'Strip marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id })
  return (await api.get('/plan')) as PlanWithSessions
}

/** Gives the plan two warnings of different weights, each long enough to run past one phone line. */
async function withTwoWarnings(page: Page) {
  await page.route('**/api/plan', async (route) => {
    const response = await route.fetch()
    const plan = (await response.json()) as PlanWithSessions
    plan.warnings = [
      {
        code: 'sunday-caution',
        severity: 'info',
        message:
          'Only one day of this week is left, so its target is a sketch and what you run today sets the week.',
        rules: ['H4'],
      },
      {
        code: 'sunday-held',
        severity: 'hold',
        message:
          'The week after this one is held at the weekly ramp limit, so the long run stays where it is.',
        rules: ['H4'],
      },
    ]
    await route.fulfill({ response, json: plan })
  })
}

for (const viewport of WIDTHS) {
  test.describe(`the season strip at ${String(viewport.width)} px`, () => {
    test.use({ viewport })

    test('reads by role, answers a tap, and leaves the first screen measured', async ({
      page,
      baseURL,
    }) => {
      const { thisMonday } = relativeDates()
      const plan = await seedPlan(page, baseURL)
      const weeks = plan.weeks.length
      expect(weeks).toBeGreaterThan(20)

      // The worst day for the first screen: two warnings above the table, as a Sunday brings (the
      // week has one day left and the plan says so). Each takes one line, so the week row holds.
      await withTwoWarnings(page)
      await page.goto('/plan')
      const season = page.getByRole('region', { name: 'Season' })
      await expect(season).toBeVisible()
      const warnings = page.getByRole('region', { name: 'Warnings' })
      await expect(warnings.getByRole('listitem')).toHaveCount(2)
      // The weightiest first, and each warning one line of a tap's height.
      const lines = warnings.getByRole('button', { name: /^(Held back|Caution|Note) / })
      await expect(lines.first()).toHaveAccessibleName(/^Held back The week after this one/)
      for (const line of await lines.all()) {
        const box = await line.boundingBox()
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
        expect(box?.height ?? 0).toBeLessThan(52)
      }

      // The strip's accessible form: the plan in a sentence, then one button per week.
      await expect(season).toHaveAccessibleDescription(
        new RegExp(
          `^A ${String(weeks)}-week plan: .*race week of ${formatShortDate(plan.raceWeekStart)}.* This week is the week of ${formatShortDate(thisMonday)}\\.$`,
        ),
      )
      const group = season.getByRole('group', { name: 'Weeks of the plan' })
      const buttons = group.getByRole('button')
      await expect(buttons).toHaveCount(weeks)
      const now = group.getByRole('button', { name: /^This week, week of / })
      await expect(now).toHaveCount(1)
      await expect(now).toHaveAttribute('aria-current', 'date')
      await expect(now).toHaveAccessibleName(/, 0\.\d h run$/)

      // The bars: one outline per week, a solid bar for the week with the run, one flag.
      const bars = season.locator('[data-compact="true"]')
      await expect(bars.locator('rect[fill="none"]')).toHaveCount(weeks)
      await expect(bars.locator('rect[fill="var(--chart-actual)"]')).toHaveCount(1)
      await expect(bars.locator('[data-mark="race"]')).toHaveCount(1)
      await expect(bars.locator('[data-mark="current"]')).toHaveCount(1)

      // A button sits over the bar of its week, and the page does not scroll sideways.
      for (const index of [0, Math.floor(weeks / 2), weeks - 1]) {
        const bar = await bars.locator('rect[fill="none"]').nth(index).boundingBox()
        const button = await buttons.nth(index).boundingBox()
        expect(bar, `bar ${String(index)}`).not.toBeNull()
        expect(button, `button ${String(index)}`).not.toBeNull()
        const barCentre = (bar?.x ?? 0) + (bar?.width ?? 0) / 2
        const buttonCentre = (button?.x ?? 0) + (button?.width ?? 0) / 2
        expect(Math.abs(barCentre - buttonCentre)).toBeLessThan(1)
      }
      // Every week is on screen, and no month label or axis tick runs past the strip or the window.
      const stripBox = await season.boundingBox()
      const right = Math.min(viewport.width, (stripBox?.x ?? 0) + (stripBox?.width ?? 0))
      const outlines = await bars.locator('rect[fill="none"]').all()
      for (const outline of outlines) {
        const box = await outline.boundingBox()
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(stripBox?.x ?? 0)
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(right + 0.5)
      }
      const monthNames = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/
      const months = await season.locator('span').filter({ hasText: monthNames }).all()
      expect(months.length).toBeGreaterThan(0)
      expect(months.length).toBeLessThanOrEqual(5)
      for (const month of months) {
        const box = await month.boundingBox()
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(right + 0.5)
      }
      const ticks = await season
        .locator('span')
        .filter({ hasText: /^\d+(\.\d)?( h)?$/ })
        .all()
      expect(ticks.length).toBeGreaterThanOrEqual(3)
      for (const tick of ticks) {
        const box = await tick.boundingBox()
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
      }
      const widest = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(widest).toBeLessThanOrEqual(0)

      // The first screen: the header, the strip, and what follows it down to the tab bar.
      const tabBar = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
      const strip = await season.boundingBox()
      const currentRow = await page.locator('tr[aria-current="date"]').boundingBox()
      const feasibility = await page.getByRole('heading', { name: 'Feasibility' }).boundingBox()
      const rowCell = page.locator('tr[aria-current="date"]').first()
      await expect(rowCell).toBeVisible()
      const column = await buttons.nth(1).boundingBox()
      expect(tabBar).not.toBeNull()
      expect(strip).not.toBeNull()
      expect(currentRow).not.toBeNull()
      expect(feasibility).not.toBeNull()
      const measured = {
        viewport: `${String(viewport.width)}x${String(viewport.height)}`,
        tabBarTop: Math.round(tabBar?.y ?? 0),
        stripTop: Math.round(strip?.y ?? 0),
        stripBottom: Math.round((strip?.y ?? 0) + (strip?.height ?? 0)),
        stripHeight: Math.round(strip?.height ?? 0),
        weekColumnWidth: Math.round((column?.width ?? 0) * 10) / 10,
        feasibilityTop: Math.round(feasibility?.y ?? 0),
        thisWeekRowTop: Math.round(currentRow?.y ?? 0),
      }
      test.info().annotations.push({ type: 'first-screen', description: JSON.stringify(measured) })
      console.log(`first screen ${JSON.stringify(measured)}`)
      // the strip, whole, is on the first screen: above the tab bar that covers its foot
      expect(measured.stripBottom).toBeLessThanOrEqual(measured.tabBarTop)
      // this week's row is on the first screen too, under the strip and above the tab bar; the
      // explanatory panels (Feasibility first) come after the table
      expect(measured.thisWeekRowTop).toBeGreaterThanOrEqual(measured.stripBottom)
      expect(measured.thisWeekRowTop).toBeLessThan(measured.tabBarTop)
      expect(measured.feasibilityTop).toBeGreaterThan(measured.thisWeekRowTop)

      // A tap on a week to come scrolls to its row and opens its days.
      const later = plan.weeks.find((w) => w.weekStart === addDays(thisMonday, 7 * 3))
      if (later === undefined) throw new Error('The plan has no week three weeks from now.')
      const laterRow = page.locator(`tr[data-week="${later.weekStart}"]`)
      const laterDays = laterRow.getByRole('button', { name: /^Days for week of/ })
      await expect(laterDays).toHaveAttribute('aria-expanded', 'false')
      await group
        .getByRole('button', { name: new RegExp(`^Week of ${formatShortDate(later.weekStart)},`) })
        .click()
      await expect(laterDays).toHaveAttribute('aria-expanded', 'true')
      await expect(laterRow).toBeInViewport()
      await expect(laterRow).toBeFocused()
      // the scroll is smooth: the row settles in the upper half of the screen
      await expect
        .poll(() => laterRow.evaluate((row) => row.getBoundingClientRect().top))
        .toBeLessThan(viewport.height / 2)
    })

    test('a tap on a week before this Monday opens "Earlier weeks" first', async ({
      page,
      baseURL,
    }) => {
      const { thisMonday } = relativeDates()
      const plan = await seedPlan(page, baseURL)
      // Three weeks on, by the page's own clock: the first three weeks of the plan are behind it.
      await page.clock.setFixedTime(new Date(`${addDays(thisMonday, 21)}T12:00:00`))
      await page.goto('/plan')

      const season = page.getByRole('region', { name: 'Season' })
      await expect(season).toBeVisible()
      const earlier = page.getByRole('button', { name: 'Earlier weeks (3)' })
      await expect(earlier).toHaveAttribute('aria-expanded', 'false')
      await expect(
        season.getByRole('button', { name: /^This week, week of / }),
      ).toHaveAccessibleName(
        new RegExp(`^This week, week of ${formatShortDate(addDays(thisMonday, 21))},`),
      )
      await expect(season).toHaveAccessibleDescription(
        new RegExp(`This week is the week of ${formatShortDate(addDays(thisMonday, 21))}\\.$`),
      )

      const second = plan.weeks[1]
      if (second === undefined) throw new Error('The plan has no second week.')
      const row = page.locator(`tr[data-week="${second.weekStart}"]`)
      await expect(row).toHaveCount(0)
      await season
        .getByRole('button', { name: new RegExp(`^Week of ${formatShortDate(second.weekStart)},`) })
        .click()

      await expect(earlier).toHaveAttribute('aria-expanded', 'true')
      await expect(row).toBeInViewport()
      await expect(row).toBeFocused()
      await expect(row.getByRole('button', { name: /^Days for week of/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
    })
  })
}

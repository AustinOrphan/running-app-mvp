import { expect, test } from '@playwright/test'
import { clockInZone, formatWeekdayDate, isoDateInZone, todayIso } from '../../shared/dates.ts'
import type { TodayView } from '../../shared/types.ts'
import { DAY_HOLDS_MS } from './globalSetup.ts'
import { resetData, signedInApi, toast } from './helpers.ts'

// D10 step 5 (ADR 0022): a runner's days follow the zone saved on the Profile page. The two zones
// are 25 hours apart, so one of them always reads another date than the process does; the spec
// takes that one, and one whose midnight is not about to pass, and works out the date it expects
// from the zone, never from the process.
const FAR_ZONES = ['Pacific/Kiritimati', 'Pacific/Pago_Pago']

function pickZone(now: Date): string {
  const processDay = todayIso(now)
  for (const zone of FAR_ZONES) {
    const { date, minute } = clockInZone(now, zone)
    if (date !== processDay && (1440 - minute) * 60_000 > DAY_HOLDS_MS) return zone
  }
  throw new Error('No far zone has a date other than the process and a day that holds')
}

test('Today follows the zone saved on the Profile page', async ({ page, baseURL }) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  const zone = pickZone(new Date())
  const expected = isoDateInZone(new Date(), zone)

  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()
  await page.getByRole('combobox', { name: 'Timezone' }).selectOption(zone)
  await expect(page.getByText(`Saving makes days follow ${zone}.`)).toBeVisible()
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(toast(page, 'Profile saved')).toBeVisible()
  await expect(
    page.getByText(new RegExp(`^Days follow ${zone}, the zone saved here\\.`)),
  ).toBeVisible()

  const today = await page.request.get('/api/today')
  expect(today.ok()).toBe(true)
  const view = (await today.json()) as TodayView
  expect(view.tz).toBe(zone)
  expect(view.date).toBe(expected)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await expect(page.getByText(formatWeekdayDate(expected), { exact: true }).first()).toBeVisible()

  await resetData()
})

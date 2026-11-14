import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { DisruptionView, PlanWithSessions } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi, type Api } from './helpers.ts'

// The offer for one sore area reported on several check-ins (rule J11), the way a runner meets it:
// three check-ins that name the same calf, Today asks, "Set one up" opens the sheet with the niggle,
// the area and the pain filled in, the preview shows what would change and the cross-training
// sentence, and nothing is written until the runner applies it. Undone, the window is gone.
test.describe.configure({ mode: 'serial' })

let page: Page
let api: Api

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  page = await context.newPage()
  api = await signedInApi(page, baseURL ?? '')
  await seedPlan(api)
})

test.afterAll(async () => {
  await page.context().close()
})

/** A history to plan from, a goal 14 weeks out and a plan with sessions. */
async function seedPlan(api: Api): Promise<PlanWithSessions> {
  await resetData()
  const { lastWednesday, thisMonday } = relativeDates()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  const goal = (await api.post('/goals', {
    name: 'Repeat pain half',
    priority: 'A',
    targetDate: addDays(thisMonday, 7 * 14 + 5),
    distanceM: 21_097,
    goalType: 'finish',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  return (await api.post('/plan/generate', { goalId: goal.id })) as PlanWithSessions
}

const windowsOf = async () => (await api.get('/plan/disruptions')) as DisruptionView[]

const ASK = 'The same spot was sore on 3 of the last 7 days. Set a rest window and a return plan?'

test('three check-ins on one calf: the offer, the filled-in sheet, the preview, the commit and the undo', async () => {
  const { today } = relativeDates()
  // Different words, one side, scores of 2 or more, not on consecutive days, none today at 4.
  await api.put(`/checkins/${addDays(today, -5)}`, { painScore: 2, painArea: 'Left calf' })
  await api.put(`/checkins/${addDays(today, -3)}`, { painScore: 3, painArea: 'calf (left)' })
  await api.put(`/checkins/${today}`, { painScore: 2, painArea: 'my left calf is tight' })

  await page.goto('/')
  const offer = page.getByRole('region', { name: 'Rest window offer' })
  await expect(offer.getByText(ASK)).toBeVisible()
  // Asking creates nothing.
  expect(await windowsOf()).toEqual([])

  await offer.getByRole('button', { name: 'Set one up' }).click()
  const sheet = page.getByRole('dialog', { name: 'Not 100%' })
  await expect(sheet.getByRole('heading', { name: 'When' })).toBeVisible()
  await expect(sheet.getByLabel('Where is it?')).toHaveValue('my left calf is tight')
  await expect(sheet.getByRole('button', { name: 'Pain (0 to 10) 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(sheet.getByText('Filled in from your check-ins. Change anything.')).toBeVisible()
  await expect(sheet.getByRole('link', { name: 'Warning signs' })).toHaveAttribute(
    'href',
    '/warning-signs',
  )

  await sheet.getByRole('button', { name: 'Next' }).click()
  await expect(sheet.getByRole('heading', { name: 'What would change' })).toBeVisible()
  await expect(
    sheet.getByText(
      'Easy cycling or pool work is an option while you are not running. It does not count toward run load.',
    ),
  ).toBeVisible()
  // The preview wrote nothing.
  expect(await windowsOf()).toEqual([])

  await sheet.getByRole('button', { name: 'Apply to my plan' }).click()
  await expect(sheet.getByRole('heading', { name: 'Window added' })).toBeVisible()
  expect(await windowsOf()).toMatchObject([
    { reason: 'niggle', area: 'my left calf is tight', pain: 3, status: 'active' },
  ])
  await sheet.getByRole('button', { name: 'Undo update' }).click()
  const confirm = page.getByRole('dialog', { name: 'Undo this update' })
  await confirm.getByRole('button', { name: 'Undo update' }).click()
  await expect.poll(async () => (await windowsOf()).length).toBe(0)
})

test('the Warning signs page carries the background sentence and no pain level', async () => {
  await page.goto('/warning-signs')
  await expect(
    page.getByText(
      'Physiotherapists sometimes use a pain-monitoring model in tendon rehabilitation, with limits they set for each person; the app does not apply it.',
    ),
  ).toBeVisible()
  await expect(page.getByText(/next morning|5 of 10/i)).toHaveCount(0)
})

import { expect, test, type Page } from '@playwright/test'
import { addDays, formatWeekdayDate } from '../../shared/dates.ts'
import type {
  AdjustResult,
  DisruptionView,
  PlanSession,
  PlanWithSessions,
} from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi, toast, type Api } from './helpers.ts'

// "Not 100%" the way a runner uses it: a window reported after the fact, previewed, applied and
// undone; a move that a rule refuses and the swap that works.
//
// The e2e server runs with NODE_ENV=development, which allows 20000 `/api` requests per 15 minutes
// per IP (1000 in production; static files are outside the count), and the whole suite spends about
// 1,170 of them. This spec shares one browser context (the built assets are cached for a year, so
// only the first page load fetches them) and one plan to keep that count low, each test puts back
// what it changed, and it stays small: the shorten, the banner's three buttons and the re-plan
// sheet are covered by the web tests against mocked routes. No service worker may stand between
// the page and the server.
test.describe.configure({ mode: 'serial' })

let page: Page
let api: Api
let plan: PlanWithSessions

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  page = await context.newPage()
  api = await signedInApi(page, baseURL ?? '')
  plan = await seedPlan(api)
})

test.afterAll(async () => {
  await page.context().close()
})

const RUN_KINDS = ['easy', 'recovery', 'long', 'threshold', 'intervals', 'strides', 'hills']

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
    name: 'Disruption half',
    priority: 'A',
    targetDate: addDays(thisMonday, 7 * 14 + 5),
    distanceM: 21_097,
    goalType: 'finish',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  return (await api.post('/plan/generate', { goalId: goal.id })) as PlanWithSessions
}

const windowsOf = async () => (await api.get('/plan/disruptions')) as DisruptionView[]

test('a back-dated illness is previewed, applied, shown on the plan and undone', async () => {
  const { today, thisMonday } = relativeDates()
  const from = addDays(today, -2)
  const until = addDays(today, 1)

  await page.goto('/plan')
  await page.getByRole('button', { name: 'Not 100%' }).click()
  const sheet = page.getByRole('dialog', { name: 'Not 100%' })

  // Step 1: a reason.
  await expect(sheet.getByText('Step 1 of 3')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Next' })).toBeDisabled()
  await sheet.getByRole('radio', { name: /Ill, above the neck/ }).check()
  await sheet.getByRole('button', { name: 'Next' }).click()

  // Step 2: the first day may be in the past; illness shows the wait before intensity.
  await expect(sheet.getByRole('heading', { name: 'When' })).toBeFocused()
  await expect(sheet.getByLabel('From')).toHaveValue(today)
  await expect(
    sheet.getByText(
      'Running waits until you have had one symptom-free day, then three easy days before any hard session.',
    ),
  ).toBeVisible()
  await sheet.getByLabel('From').fill(from)
  await sheet.getByLabel('Until').fill(until)
  await sheet.getByRole('button', { name: 'Next' }).click()

  // Step 3: what would change, from the server; nothing is written yet.
  await expect(sheet.getByRole('heading', { name: 'What would change' })).toBeFocused()
  await expect(sheet.getByText(`Rest from ${formatWeekdayDate(from)} to `)).toBeVisible()
  await expect(sheet.getByText(/^Running time over the next four weeks: /)).toBeVisible()
  await expect(sheet.getByRole('list', { name: 'Changes in this update' })).toBeVisible()
  expect(await windowsOf()).toEqual([])

  await sheet.getByRole('button', { name: 'Apply to my plan' }).click()
  await expect(sheet.getByRole('heading', { name: 'Window added' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Undo update' })).toBeVisible()
  expect(await windowsOf()).toMatchObject([
    { reason: 'illness-above-neck', mode: 'rest', startDate: from, endDate: until },
  ])
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(sheet).toBeHidden()

  // The plan says so: a banner for the phase, the week's chip and a rest day with its meta.
  const banner = page.getByRole('region', { name: 'Rest window' })
  await expect(
    banner.getByText(`Resting for illness until ${formatWeekdayDate(until)}.`),
  ).toBeVisible()
  await expect(
    banner.getByRole('button', { name: /^(I'm better|Extend|Remove window)$/ }),
  ).toHaveCount(3)
  const row = page.locator(`tr[data-week="${thisMonday}"]`)
  await expect(row.getByText('Rest window', { exact: true })).toBeVisible()
  const days = page.locator(`tr[data-days-for="${thisMonday}"]`)
  await expect(days.getByRole('button', { name: /Rest: illness/ }).first()).toContainText(
    'Rest window',
  )

  // Undo it from the list of changes, as the runner would.
  const changed = page.getByRole('region', { name: 'What changed' })
  await changed.getByText('What changed', { exact: true }).click()
  const revision = changed.locator('[data-revision]').filter({ hasText: 'Rest window' }).first()
  await expect(revision.getByText(/^Added a window \(illness\)/)).toBeVisible()
  await expect(revision.getByText('New', { exact: true })).toBeHidden()
  await revision.getByRole('button', { name: 'Undo update' }).click()
  const confirm = page.getByRole('dialog', { name: 'Undo this update' })
  await expect(confirm.getByRole('list', { name: 'What would change back' })).toBeVisible()
  await confirm.getByRole('button', { name: 'Undo update' }).click()
  await expect(toast(page, /^Plan restored to how it was on /)).toBeVisible()

  // The window is withdrawn and the page has read the windows again.
  expect(await windowsOf()).toEqual([])
  await expect(banner).toBeHidden()
  await expect(row.getByText('Rest window', { exact: true })).toBeHidden()
})

/** A move onto another run's day that a rule refuses, with the swap that works instead. */
async function findRefusedMove() {
  const { thisMonday } = relativeDates()
  const runs = plan.sessions.filter(
    (s) => s.weekStart > thisMonday && s.status === 'planned' && RUN_KINDS.includes(s.kind),
  )
  for (const mover of runs) {
    for (const other of runs) {
      if (other.id === mover.id || other.weekStart !== mover.weekStart) continue
      const asked = (await api.post(`/plan/sessions/${mover.id}/adjust`, {
        adjustment: { type: 'move', date: other.date },
        dryRun: true,
      })) as AdjustResult
      const swap = asked.guards.find((g) => g.effect === 'blocks')?.suggest
      const adjustment = swap?.adjustment
      if (!asked.allowed && swap !== undefined && swap !== null && adjustment?.type === 'swap') {
        const partner = plan.sessions.find((s) => s.id === adjustment.withSessionId)
        if (partner !== undefined) return { mover, other, partner, label: swap.label }
      }
    }
  }
  throw new Error('The plan has no move that a rule refuses with a swap to offer.')
}

async function openSession(session: PlanSession) {
  await page.goto('/plan')
  // The current week opens to its days by itself; the others open on request.
  const toggle = page
    .locator(`tr[data-week="${session.weekStart}"]`)
    .getByRole('button', { name: /^Days for week of/ })
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await page
    .locator(`tr[data-days-for="${session.weekStart}"] button`)
    .filter({ hasText: session.title })
    .first()
    .click()
  return page.getByRole('dialog', { name: session.title })
}

test('a move a rule refuses names the rule and offers the swap, which is applied and undone', async () => {
  const { mover, other, partner, label } = await findRefusedMove()

  const sheet = await openSession(mover)
  const section = sheet.getByRole('region', { name: 'Change this session' })
  await section.getByLabel('Move to').fill(other.date)

  // The refusal is information with its rule; nothing can be applied.
  const why = section.getByRole('list', { name: 'Why this cannot be done' })
  await expect(why).toBeVisible()
  await expect(why).toContainText('already has a run')
  await expect(section.getByRole('button', { name: 'Apply change' })).toBeDisabled()

  // The one-tap swap is dry-run in turn and applied only on a second tap.
  await why.getByRole('button', { name: label }).click()
  await expect(section.getByText('What would change')).toBeVisible()
  await expect(section.getByRole('list', { name: 'Why this cannot be done' })).toBeHidden()
  await section.getByRole('button', { name: 'Apply change' }).click()
  await expect(toast(page, /^Swapped /)).toBeVisible()
  const applied = section.getByRole('group', { name: 'Applied change' })
  await expect(applied).toBeFocused()

  const after = (await api.get('/plan')) as PlanWithSessions
  const dateOf = (s: PlanSession) => after.sessions.find((x) => x.id === s.id)?.date
  expect(dateOf(mover)).toBe(partner.date)
  expect(dateOf(partner)).toBe(mover.date)

  // Undone from the result, the sessions are back on their days.
  await applied.getByRole('button', { name: 'Undo update' }).click()
  await page
    .getByRole('dialog', { name: 'Undo this update' })
    .getByRole('button', { name: 'Undo update' })
    .click()
  await expect(toast(page, /^Plan restored to how it was on /)).toBeVisible()
  const restored = (await api.get('/plan')) as PlanWithSessions
  expect(restored.sessions.find((s) => s.id === mover.id)?.date).toBe(mover.date)
  expect(restored.sessions.find((s) => s.id === partner.id)?.date).toBe(partner.date)
})

import { expect, test } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { AdjustResult, PlanWithSessions } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi, toast } from './helpers.ts'

test('create a goal, activate it, generate a plan and edit one week with a note', async ({
  page,
  baseURL,
}) => {
  const { thisMonday, raceDate } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()

  // Goal
  await page.goto('/goals')
  await expect(page.getByText('No goals yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Add goal' }).click()
  const goalSheet = page.getByRole('dialog', { name: 'Add goal' })
  await goalSheet.getByLabel('Name').fill('Test marathon')
  await goalSheet.getByRole('radio', { name: 'A', exact: true }).click()
  await goalSheet.getByLabel('Race date').fill(raceDate)
  await goalSheet.getByRole('button', { name: 'Marathon' }).click()
  await goalSheet.getByRole('button', { name: 'Save goal' }).click()
  await expect(toast(page, 'Goal saved')).toBeVisible()

  const goal = page.getByRole('article', { name: 'Test marathon' })
  await expect(goal.getByText('Priority A')).toBeVisible()
  await goal.getByRole('button', { name: 'Make active' }).click()
  await expect(goal.getByText('Active goal')).toBeVisible()

  // Plan
  await page.goto('/plan')
  await expect(page.getByText('No plan yet.').first()).toBeVisible()
  await page.getByRole('button', { name: 'Generate plan' }).click()
  await expect(toast(page, 'Plan generated')).toBeVisible()

  const table = page.getByRole('table', { name: 'Weekly plan, target and actual run hours' })
  await expect(table).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Feasibility' })).toBeVisible()
  await expect(table.getByText('Taper', { exact: true }).first()).toBeVisible()
  // The weeks after the race (the post-race window, counted in days) keep the race phase but read
  // "After the race".
  const raceRow = table.getByRole('row', { name: /Race week/ })
  await expect(raceRow).toBeVisible()
  await expect(raceRow).toHaveAttribute('data-race', 'true')
  await expect(table.getByRole('row', { name: /After the race/ }).first()).toBeVisible()

  // Edit a future week: a changed target needs a note.
  const week = addDays(thisMonday, 7)
  const row = table.locator(`tr[data-week="${week}"]`)
  const before = await row.locator('[data-cell="target"]').innerText()
  await row.getByRole('button', { name: /^Edit week of/ }).click()
  const edit = page.getByRole('dialog', { name: /^Edit week of/ })
  await edit.getByLabel('Target (minutes)').fill('200')
  await edit.getByRole('button', { name: 'Save week' }).click()
  await expect(edit.getByText('Add a note explaining the change')).toBeVisible()

  await edit.getByLabel('Override note').fill('Visiting family, one long day instead of two')
  await edit.getByRole('button', { name: 'Save week' }).click()
  await expect(toast(page, /^Week of .* saved$/)).toBeVisible()
  await expect(edit).toBeHidden()

  const target = row.locator('[data-cell="target"]')
  await expect(target.getByText('3.3 h')).toBeVisible()
  await expect(target.getByRole('button', { name: 'edited' })).toBeVisible()
  expect(before).not.toContain('3.3 h')

  // The note shows on demand and survives a reload.
  await page.reload()
  const reloaded = page.locator(`tr[data-week="${week}"] [data-cell="target"]`)
  await reloaded.getByRole('button', { name: 'edited' }).focus()
  await expect(reloaded.getByRole('note')).toHaveText(
    'Visiting family, one long day instead of two',
  )

  // Owner edits of one session go through one guarded action. The session sheet asks the server
  // about a move as it is chosen and applies that answer; the shorten here goes through the API
  // and the page shows what it left. No e2e drives the sheet's own Shorten or Restore session:
  // tests/web/session-adjust.test.tsx covers them against mocked routes.
  const plan = (await api.get('/plan')) as PlanWithSessions
  const isRun = (s: PlanSessionLike) => !['strength', 'mobility', 'rest', 'cross'].includes(s.kind)
  const inWeek = plan.sessions.filter((s) => s.weekStart === week)
  const moving = inWeek.find((s) => s.kind === 'easy')
  if (moving === undefined) throw new Error(`The plan has no easy run in the week of ${week}.`)
  // a day without a run, with no hard session on it or next to it
  const free = [0, 1, 2, 3, 4, 5, 6]
    .map((i) => addDays(week, i))
    .find((date) =>
      inWeek.every(
        (s) =>
          !(isRun(s) && s.date === date) &&
          !(HARD.includes(s.kind) && Math.abs(Date.parse(s.date) - Date.parse(date)) <= 86_400_000),
      ),
    )
  if (free === undefined) throw new Error(`The week of ${week} has no free day.`)

  // A move through the sheet.
  await page.goto('/plan')
  await row.getByRole('button', { name: /^Days for week of/ }).click()
  await page
    .locator(`tr[data-days-for="${week}"] button[data-status="planned"]`)
    .filter({ hasText: moving.title })
    .first()
    .click()
  const sheet = page.getByRole('dialog', { name: moving.title })
  await sheet.getByLabel('Move to').fill(free)
  await sheet.getByRole('button', { name: 'Apply change' }).click()
  await expect(toast(page, /^Moved /)).toBeVisible()

  // A shorten through the action, on the first easy run that is long enough to lose five minutes:
  // the page reads it as shortened.
  const shortening = plan.sessions.find(
    (s) => s.weekStart > thisMonday && s.kind === 'easy' && s.durationMin >= 30,
  )
  if (shortening === undefined) throw new Error('The plan has no easy run of 30 minutes.')
  const shorter = shortening.durationMin - 5
  const done = (await api.post(`/plan/sessions/${shortening.id}/adjust`, {
    adjustment: { type: 'shorten', durationMin: shorter },
  })) as AdjustResult
  expect(done.session).toMatchObject({ status: 'adjusted', durationMin: shorter })
  expect(done.revision?.summary).toMatch(/^Shortened /)
  await page.reload()
  await page
    .locator(`tr[data-week="${shortening.weekStart}"]`)
    .getByRole('button', { name: /^Days for week of/ })
    .click()
  const shortened = page.locator(
    `tr[data-days-for="${shortening.weekStart}"] button[data-status="adjusted"]`,
  )
  await expect(shortened).toHaveCount(1)
  await expect(shortened).toContainText('Shortened')
  await expect(shortened).toContainText(`${String(shorter)}`)

  // A move onto a day that already has a run is refused with its rule (a dry run: 200, allowed false).
  const crowded = plan.sessions.find(
    (s) => s.weekStart === shortening.weekStart && isRun(s) && s.id !== shortening.id,
  )
  if (crowded === undefined) throw new Error('The week has no other run.')
  const refused = await page.request.post(`/api/plan/sessions/${shortening.id}/adjust`, {
    headers: { Origin: baseURL ?? '' },
    data: { adjustment: { type: 'move', date: crowded.date }, dryRun: true },
  })
  expect(refused.ok()).toBe(true)
  const result = (await refused.json()) as AdjustResult
  expect(result.allowed).toBe(false)
  expect(result.guards[0]?.message).toMatch(/already has a run/)
})

/** Kinds that need an easy day on either side of them [rule F1]. */
const HARD = ['threshold', 'intervals', 'race-pace', 'hills', 'long-fast-finish', 'b2b', 'race']
type PlanSessionLike = Pick<PlanWithSessions['sessions'][number], 'kind' | 'date'>

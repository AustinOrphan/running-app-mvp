import { expect, test } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi, toast } from './helpers.ts'

// A revision seen the way the runner sees it: listed under "What changed" with its words, undone
// from a preview, and said to be undone afterwards.

test('an edit of the plan is listed, previewed and undone from What changed', async ({
  page,
  baseURL,
}) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  const { today, lastWednesday, thisMonday } = relativeDates()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  const goal = (await api.post('/goals', {
    name: 'Presentation half',
    priority: 'A',
    targetDate: addDays(thisMonday, 7 * 14 + 5),
    distanceM: 21_097,
    goalType: 'finish',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  const plan = (await api.post('/plan/generate', { goalId: goal.id })) as PlanWithSessions
  const skipped = plan.sessions.find(
    (s) => s.date > today && s.kind === 'easy' && s.status === 'planned',
  )
  expect(skipped, 'the plan has an easy run still to come').toBeDefined()
  await api.put(`/plan/sessions/${skipped!.id}`, { skip: true })
  const status = async () =>
    ((await api.get('/plan')) as PlanWithSessions).sessions.find((s) => s.id === skipped!.id)!
      .status
  expect(await status()).toBe('skipped')

  await page.goto('/plan')
  const changed = page.getByRole('region', { name: 'What changed' })
  await changed.getByText('What changed', { exact: true }).click()
  const edit = changed.locator('[data-revision]').filter({ hasText: 'Your edit' })
  await expect(edit.getByText(/^Skipped /)).toBeVisible()
  await expect(edit.getByText('You made this change yourself.')).toBeVisible()
  // The runner made this change, so it is not marked New.
  await expect(edit.getByText('New', { exact: true })).toBeHidden()

  // The preview comes first: a dialog with the question, what stays, and the rows it would put back.
  await edit.getByRole('button', { name: 'Undo update' }).click()
  const dialog = page.getByRole('dialog', { name: 'Undo this update' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toBeFocused()
  await expect(dialog.getByText('Put the plan back as it was before this update?')).toBeVisible()
  await expect(dialog.getByRole('list', { name: 'What would change back' })).toBeVisible()
  expect(await status()).toBe('skipped')

  // Keep closes it, and focus goes back to where it came from.
  await dialog.getByRole('button', { name: 'Keep' }).click()
  await expect(dialog).toBeHidden()
  await expect(edit.getByRole('button', { name: 'Undo update' })).toBeFocused()

  await edit.getByRole('button', { name: 'Undo update' }).click()
  await dialog.getByRole('button', { name: 'Undo update' }).click()
  await expect(toast(page, /^Plan restored to how it was on /)).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(await status()).toBe('planned')

  // The list now has the undo, and the update it reverted says so.
  await expect(changed.locator('strong', { hasText: /^Undo$/ })).toBeVisible()
  await expect(edit.getByText('This update was already undone.')).toBeVisible()
  await expect(edit.getByRole('button', { name: 'Undo update' })).toBeHidden()
})

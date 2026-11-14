import { expect, test } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { relativeDates, resetData, signedInApi, toast } from './helpers.ts'

test('logging a run from the Activities page shows it in the list and on the dashboard', async ({
  page,
  baseURL,
}) => {
  const { lastWednesday } = relativeDates()
  await signedInApi(page, baseURL ?? '')
  await resetData()

  await page.goto('/activities')
  await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible()
  await expect(page.getByText('No activities yet.')).toBeVisible()

  await page.getByRole('button', { name: 'Log activity' }).click()
  const sheet = page.getByRole('dialog', { name: 'Log activity' })
  await sheet.getByLabel('Date').fill(lastWednesday)
  await sheet.getByLabel('Duration').fill('45')
  await sheet.getByLabel('Distance (mi)').fill('5')
  await sheet.getByRole('button', { name: 'Save' }).click()

  await expect(toast(page, 'Run saved')).toBeVisible()
  await expect(sheet).toBeHidden()

  const row = page.getByRole('link', { name: /^Run 5\.00 mi 45:00/ })
  await expect(row).toBeVisible()
  await expect(page.getByText('1 activity')).toBeVisible()

  await page.getByRole('link', { name: 'Today' }).first().click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  // The history sections load when the foot of the page comes near the viewport.
  await page.getByRole('region', { name: 'Disclaimer' }).scrollIntoViewIfNeeded()
  await expect(page.getByText('1 run, 5.00 mi in the last 28 days')).toBeVisible()

  // The row opens the activity's page; its edit sheet opens on the saved values, and the
  // activity can be deleted again from the page.
  await page.goto('/activities')
  await row.click()
  await expect(page).toHaveURL(/\/activities\/[^/?]+$/)
  await page.getByRole('button', { name: 'Edit' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit activity' })
  await expect(edit.getByLabel('Duration')).toHaveValue('45:00')
  await edit.getByRole('button', { name: 'Close' }).click()
  await expect(edit).toBeHidden()
  const deleteButton = page.getByRole('button', { name: 'Delete', exact: true })
  await deleteButton.click()
  // The question is a sheet: Escape keeps the activity and gives focus back to Delete.
  const ask = page.getByRole('dialog', { name: 'Delete this activity?' })
  await expect(ask).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ask).toBeHidden()
  await expect(deleteButton).toBeFocused()
  // The confirming button is a secondary one, not red.
  await deleteButton.click()
  const confirm = ask.getByRole('button', { name: 'Delete activity' })
  await expect(confirm.locator('svg[aria-hidden="true"]')).toHaveCount(1)
  const { danger, colour, border } = await confirm.evaluate((node) => {
    // resolve the --danger token the way the old variant did, then compare what the button draws
    const probe = document.createElement('span')
    probe.style.color = 'var(--danger)'
    document.body.append(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    const style = getComputedStyle(node)
    return { danger: resolved, colour: style.color, border: style.borderTopColor }
  })
  expect(colour).not.toBe(danger)
  expect(border).not.toBe(danger)
  await confirm.click()
  await expect(toast(page, 'Activity deleted')).toBeVisible()
  await expect(page.getByText('No activities yet.')).toBeVisible()
})

test('a run logged for today opens its own page, the post-run screen, and the toast goes with it', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()

  await page.goto('/activities')
  await page.getByRole('button', { name: 'Log activity' }).click()
  const sheet = page.getByRole('dialog', { name: 'Log activity' })
  // the date is today unless the runner changes it
  await sheet.getByLabel('Duration').fill('45')
  await sheet.getByLabel('Distance (mi)').fill('5')
  await sheet.getByRole('button', { name: 'Save' }).click()

  await expect(page).toHaveURL(/\/activities\/[^/?]+$/)
  await expect(page.getByRole('heading', { name: 'Run', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Against the plan' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'How did it go?' })).toBeVisible()
  await expect(toast(page, 'Run saved')).toBeVisible()
  await expect(sheet).toBeHidden()

  // the run is in the list behind it (the case above is the back-fill that stays on the list)
  await page.getByRole('link', { name: 'All activities' }).click()
  await expect(page.getByRole('link', { name: /^Run 5\.00 mi 45:00/ })).toBeVisible()
})

test('a long row from a source shows the moving pace and names it, and is no taller at 360 px', async ({
  page,
  baseURL,
}) => {
  const { today } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  // The longest row there is: a source label, a 100-mile distance and a 30-hour duration. Every row
  // that has a moving time carries a source label (a manual row has none), so this is the row.
  const long = {
    type: 'run',
    durationSec: 30 * 3600,
    distanceM: 160_934,
  }
  const withMoving = (await api.post('/activities', {
    ...long,
    date: addDays(today, -3),
  })) as { id: string }
  const without = (await api.post('/activities', {
    ...long,
    date: addDays(today, -4),
  })) as { id: string }
  // the API makes manual rows with no moving time and no source; a recording stores both, so the
  // rows are written straight to the table, as other specs write what the API cannot
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    await prisma.activity.update({
      where: { id: withMoving.id },
      data: { movingSec: 29 * 3600, source: 'garmin', providerKey: 'garmin:pace-a' },
    })
    await prisma.activity.update({
      where: { id: without.id },
      data: { source: 'garmin', providerKey: 'garmin:pace-b' },
    })
  } finally {
    await prisma.$disconnect()
  }

  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/activities')
  const rows = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: /^Run / }) })
  await expect(rows).toHaveCount(2)
  // told apart by the label a screen reader reads, which is all the row says of it
  const moving = rows.filter({ has: page.getByRole('link', { name: /, moving pace$/ }) })
  const plain = rows.filter({ hasNot: page.getByRole('link', { name: /, moving pace$/ }) })
  await expect(moving).toHaveCount(1)
  await expect(plain).toHaveCount(1)
  await expect(moving.getByText('elapsed', { exact: true })).toHaveCount(0)
  // the row that qualifies its pace is no taller than the same row without a moving time
  const [tall, short] = await Promise.all([moving.boundingBox(), plain.boundingBox()])
  expect(tall?.height).toBeLessThanOrEqual(short?.height ?? 0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false)
})

test('a duration the form cannot read is reported and nothing is saved', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()

  await page.goto('/activities')
  await page.getByRole('button', { name: 'Log activity' }).click()
  const sheet = page.getByRole('dialog', { name: 'Log activity' })
  await sheet.getByLabel('Duration').fill('soon')
  await sheet.getByRole('button', { name: 'Save' }).click()

  await expect(sheet.getByText('Enter minutes like 45, or 0:45:00')).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('No activities yet.')).toBeVisible()
})

test('a long history pages 50 at a time, and Stats reads its totals from the server', async ({
  page,
  baseURL,
}) => {
  const { today } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  for (let day = 0; day < 55; day += 1) {
    await api.post('/activities', {
      date: addDays(today, -day),
      type: 'run',
      durationSec: 1800,
      distanceM: 5000,
    })
  }
  const requested: string[] = []
  page.on('request', (request) => {
    requested.push(new URL(request.url()).pathname)
  })

  await page.goto('/activities')
  await expect(page.getByText('Showing 50 of 55 activities')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Run/ })).toHaveCount(50)
  await page.getByRole('button', { name: 'Show 5 more' }).click()
  await expect(page.getByText('55 activities', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Run/ })).toHaveCount(55)
  await expect(page.getByRole('button', { name: /^Show \d+ more$/ })).toHaveCount(0)

  requested.length = 0
  await page.goto('/stats')
  await expect(page.getByRole('table', { name: 'Monthly totals' })).toBeVisible()
  expect(requested).toContain('/api/stats')
  expect(requested).not.toContain('/api/activities')
})

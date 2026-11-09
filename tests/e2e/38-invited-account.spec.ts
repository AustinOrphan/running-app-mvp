import { expect, test } from '@playwright/test'
import { createUser } from '../../server/auth/createUser.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { resetData, signedInApi } from './helpers.ts'

const FRIEND = 'friend@example.com'
const NEW_PASSWORD = 'a brand new passphrase'

/** Removes the invited account, so the specs after this one meet only the runner. */
async function removeFriend() {
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    await prisma.user.deleteMany({ where: { email: FRIEND } })
  } finally {
    await prisma.$disconnect()
  }
}

test.afterEach(removeFriend)

// a runner in Germany: the browser says kilometres and Europe/Berlin
test.use({ locale: 'de-DE', timezoneId: 'Europe/Berlin' })

test('an account made by create-user chooses its own password, then lands on Today', async ({
  page,
  baseURL,
}) => {
  // the runner exists first, as on a real install; the invited account is the second one
  await signedInApi(page, baseURL ?? '')
  await resetData()
  await removeFriend()
  const prisma = createPrisma(E2E_DATABASE_URL)
  let temporary: string
  try {
    await initSqlite(prisma)
    temporary = (await createUser(prisma, { email: FRIEND, displayName: 'Friend' }))
      .temporaryPassword
  } finally {
    await prisma.$disconnect()
  }
  await page.context().clearCookies()

  await page.goto('/login')
  await page.getByLabel('Email').fill(FRIEND)
  await page.getByLabel('Password').fill(temporary)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // nothing but the password screen until the temporary password is replaced
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await page.getByLabel('Current password', { exact: true }).fill(temporary)
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

  // the browser's locale and zone (de-DE, Europe/Berlin) were taken once, not the miles and UTC the
  // account started with
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Kilometres' })).toBeChecked()
  await expect(page.getByRole('heading', { name: 'Password', level: 2 })).toBeVisible()
  const profile = await page.request.get('/api/profile')
  expect(((await profile.json()) as { timezone: string }).timezone).toBe('Europe/Berlin')

  // after a reload the flags are cleared and the password screen does not return
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toHaveCount(0)
  const me = (await (await page.request.get('/api/auth/me')).json()) as Record<string, unknown>
  expect(me).toMatchObject({
    mustChangePassword: false,
    unitsFromBrowser: false,
    zoneFromBrowser: false,
  })
})

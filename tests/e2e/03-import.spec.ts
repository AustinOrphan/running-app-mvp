import { expect, test, type Page } from '@playwright/test'
import { resetData, signedInApi } from './helpers.ts'

const FIXTURE = 'tests/fixtures/smashrun-sample.csv'

async function importFixture(page: Page) {
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Import activities' })
  // the dialog opens on Activity files; this spec imports a Smashrun CSV
  await expect(sheet.getByRole('radio', { name: 'Activity files' })).toBeChecked()
  await sheet.getByRole('radio', { name: 'Smashrun' }).click()
  await expect(sheet.getByRole('radio', { name: 'mi' })).toBeChecked()
  await sheet.getByLabel('CSV file').setInputFiles(FIXTURE)
  await sheet.getByRole('button', { name: 'Import file' }).click()
  return sheet
}

test('importing the Smashrun sample reports the rows, lists them and is idempotent', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  await page.goto('/activities')

  const first = await importFixture(page)
  await expect(
    first.getByText('3 added to your log. 0 already there. 0 could not be read.'),
  ).toBeVisible()
  await first.getByRole('button', { name: 'Done' }).click()
  await expect(first).toBeHidden()

  await expect(page.getByText('3 activities')).toBeVisible()
  await expect(
    page.getByRole('link', { name: /^Run, [^,]+, 3\.10 mi, 30:00.*Smashrun$/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: /^Run, [^,]+, 5\.00 mi, 45:00.*Smashrun$/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: /^Run, [^,]+, 8\.00 mi, 1:20:00.*Smashrun$/ }),
  ).toBeVisible()

  const second = await importFixture(page)
  await expect(
    second.getByText('0 added to your log. 3 already there. 0 could not be read.'),
  ).toBeVisible()
  await second.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('3 activities')).toBeVisible()
})

test('a manual run matching an imported one is flagged and can be confirmed as a duplicate', async ({
  page,
  baseURL,
}) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  // Same day and distance as the first row of the fixture (3.1 mi).
  await api.post('/activities', {
    date: '2026-03-02',
    type: 'run',
    durationSec: 1750,
    distanceM: 4989,
  })
  await page.goto('/activities')

  const sheet = await importFixture(page)
  await expect(
    sheet.getByText('3 added to your log. 0 already there. 0 could not be read.'),
  ).toBeVisible()
  await sheet.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByText('Possible duplicate')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm duplicate' }).click()
  await expect(page.getByText('Possible duplicate')).toBeHidden()
  await expect(page.getByText('Duplicate, not counted')).toBeVisible()
})

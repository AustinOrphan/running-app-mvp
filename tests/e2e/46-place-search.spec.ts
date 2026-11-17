import { expect, test, type Page } from '@playwright/test'
import { relativeDates, resetData, signedInApi, toast } from './helpers.ts'

// Setting a place without typing coordinates (PL2, ADR 0024). The server's outside call to the
// geocoder cannot be mocked from the browser, so the two place routes are answered in the page; the
// profile and goal writes are the real ones.

const EXAMPLETON = {
  name: 'Exampleton',
  region: 'Sample County',
  country: 'Testland',
  lat: 12.35,
  lng: -65.43,
}

async function mockPlaces(page: Page, startOf: { runs: number; of: number } | null) {
  await page.route('**/api/places/search', (route) =>
    route.fulfill({ json: { places: [EXAMPLETON] } }),
  )
  await page.route('**/api/places/usual-start', (route) =>
    route.fulfill({
      json: { start: startOf === null ? null : { lat: 23.46, lng: -76.54, ...startOf } },
    }),
  )
}

test('a searched town fills the home place, and Save keeps it', async ({ page, baseURL }) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  await mockPlaces(page, null)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()

  await page.getByLabel('Town or postcode').fill('Exampleton')
  await page.getByLabel('Town or postcode').press('Enter')
  await page.getByRole('button', { name: 'Exampleton, Sample County, Testland' }).click()
  await expect(page.getByLabel('Home latitude')).toHaveValue('12.35')
  await expect(page.getByLabel('Home longitude')).toHaveValue('-65.43')

  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(toast(page, 'Profile saved')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Home latitude')).toHaveValue('12.35')
  await expect(page.getByLabel('Home longitude')).toHaveValue('-65.43')
})

test('"Use where my runs start" says how many runs and fills the home place', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  await mockPlaces(page, { runs: 18, of: 24 })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Use where my runs start' }).click()
  await expect(page.getByText('18 of 24 runs start here. Save to keep the place.')).toBeVisible()
  await expect(page.getByLabel('Home latitude')).toHaveValue('23.46')
  await expect(page.getByLabel('Home longitude')).toHaveValue('-76.54')
})

test('a searched town fills the race place of a goal, and Save keeps it', async ({
  page,
  baseURL,
}) => {
  const { raceDate } = relativeDates()
  await signedInApi(page, baseURL ?? '')
  await resetData()
  await mockPlaces(page, null)
  await page.goto('/goals')
  await page.getByRole('button', { name: 'Add goal' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add goal' })
  await sheet.getByLabel('Name').fill('Synthetic marathon')
  await sheet.getByLabel('Race date').fill(raceDate)
  await sheet.getByRole('button', { name: 'Marathon' }).click()
  await sheet.getByLabel('Town or postcode').fill('Exampleton')
  await sheet.getByRole('button', { name: 'Search' }).click()
  await sheet.getByRole('button', { name: 'Exampleton, Sample County, Testland' }).click()
  await expect(sheet.getByLabel('Race latitude')).toHaveValue('12.35')
  await expect(sheet.getByLabel('Race longitude')).toHaveValue('-65.43')
  await sheet.getByRole('button', { name: 'Save goal' }).click()
  await expect(toast(page, 'Goal saved')).toBeVisible()

  await page.getByRole('button', { name: 'Edit Synthetic marathon' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit goal' })
  await expect(edit.getByLabel('Race latitude')).toHaveValue('12.35')
  await expect(edit.getByLabel('Race longitude')).toHaveValue('-65.43')
})

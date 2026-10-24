import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { FuelProduct } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi, toast, type Api } from './helpers.ts'

// The Fuel lab of phase 3a, seen from the browser: a product is added, a 3-hour run is logged in
// the sheet and the target steps up, two runs scored 2 take it back with the lab saying why, and a
// 100-mile goal gets the stronger safety card. The ladder is replayed from the logs on every read
// (design 10.5), so each step is read from the lab page rather than from a toast.

const HOUR = 3600
const EAH_HEADING = 'Low blood sodium from drinking too much'

/** Eight weeks of four runs, so the engine has a history to plan from. */
async function seedHistory(api: Api, thisMonday: string): Promise<void> {
  for (let week = 1; week <= 8; week += 1) {
    for (const [day, minutes] of [
      [0, 40],
      [2, 45],
      [4, 35],
      [5, 70],
    ] as const) {
      await api.post('/activities', {
        date: addDays(thisMonday, -7 * week + day),
        type: 'run',
        durationSec: minutes * 60,
        distanceM: minutes * 160,
        rpe: 3,
      })
    }
  }
}

/** A 3-hour run `daysAgo` days back; returns its id. */
async function longRun(api: Api, today: string, daysAgo: number): Promise<string> {
  const run = (await api.post('/activities', {
    date: addDays(today, -daysAgo),
    type: 'run',
    durationSec: 3 * HOUR,
    distanceM: 30_000,
  })) as { id: string }
  return run.id
}

/** The ladder's rung for a rate, by the words on it ("60 g/h", "Next up"). */
function rung(page: Page, rate: string) {
  return page
    .getByRole('list', { name: 'Carbohydrate rates, lowest first' })
    .getByRole('listitem')
    .filter({ hasText: rate })
}

test('a product, a logged 3-hour run, a step up, and two runs scored 2 take the target back', async ({
  page,
  baseURL,
}) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  const { today, thisMonday, raceDate } = relativeDates()
  await seedHistory(api, thisMonday)
  const goal = (await api.post('/goals', {
    name: 'Fuel marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
    goalType: 'finish',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id })
  // Three long runs; the ladder replays them oldest first. The first is logged in the browser, the
  // other two through the API, which keeps the spec short.
  await longRun(api, today, 5)
  const second = await longRun(api, today, 3)
  const third = await longRun(api, today, 1)

  // The lab is one of the pages under More.
  await page.goto('/more')
  await page.getByRole('link', { name: /Fuel lab/ }).click()
  await expect(page.getByRole('heading', { name: 'Fuel lab', level: 1 })).toBeVisible()

  // Before any log: the floor, the standard safety card, and the three runs waiting for a log.
  const target = page.getByRole('region', { name: /^Fuel target:/ })
  await expect(
    target.getByRole('heading', { name: 'Fuel target: 30 to 50 g/h of carbohydrate' }),
  ).toBeVisible()
  const eah = page.getByRole('note', { name: EAH_HEADING })
  await expect(eah).toBeVisible()
  await expect(eah).not.toContainText('On events over')
  await expect(rung(page, '30 to 50 g/h')).toContainText('Next up')

  // Add a product.
  const products = page.getByRole('region', { name: 'Products' })
  await products.getByRole('button', { name: 'Add a product' }).click()
  const productForm = products.getByRole('form', { name: 'Add a product' })
  await productForm.getByLabel('Name', { exact: true }).fill('Synthetic gel')
  await productForm.getByLabel('What one serving is').fill('1 gel')
  await productForm.getByLabel('Carbohydrate in one serving, in grams').fill('40')
  await productForm.getByRole('button', { name: 'Save product' }).click()
  await expect(toast(page, 'Product saved.')).toBeVisible()
  await expect(products.getByText('Synthetic gel', { exact: true })).toBeVisible()

  // Log the oldest run: three gels in three hours is 40 g/h, inside the floor.
  const prompts = page.getByRole('region', { name: 'Fuel log' })
  await expect(prompts.getByRole('listitem')).toHaveCount(3)
  await prompts
    .getByRole('button', { name: /^Log fuel for / })
    .last()
    .click()
  const sheet = page.getByRole('dialog', { name: 'Fuel log' })
  await expect(sheet).toBeVisible()
  const addGel = sheet.getByRole('button', { name: 'Add one Synthetic gel' })
  for (let i = 0; i < 3; i += 1) await addGel.click()
  await expect(sheet.getByRole('status')).toHaveText(
    /^You took 120 g of carbohydrate in .*: 40 g\/h\. Target was 30 to 50 g\/h\.$/,
  )
  await sheet
    .getByRole('radiogroup', { name: 'Gut' })
    .getByRole('radio', { name: '0 None' })
    .click()
  await sheet.getByRole('button', { name: 'Save fuel log' }).click()
  await expect(toast(page, 'Tolerated at 30 to 50 g/h. Next long run: 60 g/h.')).toBeVisible()
  await expect(sheet).toBeHidden()

  // The target stepped up, and the ladder and the history say so.
  await expect(
    target.getByRole('heading', { name: 'Fuel target: 60 g/h of carbohydrate' }),
  ).toBeVisible()
  await expect(target).toContainText(
    'The last run that counted went well at 30 to 50 g/h, so this run tries 60 g/h.',
  )
  await expect(rung(page, '30 to 50 g/h')).toContainText('Tolerated')
  await expect(rung(page, '60 g/h')).toContainText('Next up')
  const history = page.getByRole('region', { name: 'Fuel history, newest first' })
  await expect(history.getByRole('row')).toHaveCount(2)
  await expect(history).toContainText('Tolerated at 30 to 50 g/h. Next long run: 60 g/h.')
  await expect(prompts.getByRole('listitem')).toHaveCount(2)

  // A run scored 2 at 60 g/h (five gels, 67 g/h) holds the rung: it is tried again.
  const gel = ((await api.get('/fuel/products')) as FuelProduct[])[0]
  if (gel === undefined) throw new Error('The product was not saved.')
  const scoredTwo = { items: [{ productId: gel.id, servings: 5 }], gut: 2 }
  await api.put(`/fuel/logs/${second}`, scoredTwo)
  await page.reload()
  await expect(
    target.getByRole('heading', { name: 'Fuel target: 60 g/h of carbohydrate' }),
  ).toBeVisible()
  await expect(target).toContainText(
    'The last run at 60 g/h sat less well, so this run tries 60 g/h again.',
  )
  await expect(rung(page, '60 g/h')).toContainText('Repeat')
  await expect(history).toContainText(
    'Scored 2 of 4 at 60 g/h. The target holds there for the next long run.',
  )

  // A second run scored 2 in a row takes the target back to the last rate that went well.
  await api.put(`/fuel/logs/${third}`, scoredTwo)
  await page.reload()
  await expect(
    target.getByRole('heading', { name: 'Fuel target: 30 to 50 g/h of carbohydrate' }),
  ).toBeVisible()
  await expect(target).toContainText(
    'After runs that sat less well, the target is back at 30 to 50 g/h, the last rate that went well.',
  )
  await expect(rung(page, '30 to 50 g/h')).toContainText('Tolerated')
  await expect(rung(page, '60 g/h')).toContainText('Later')
  await expect(history).toContainText(
    'Scored 2 of 4 at 60 g/h. The target is back at 30 to 50 g/h, the last rate that went well.',
  )
  // Every run is answered, so nothing is left to log.
  await expect(page.getByRole('region', { name: 'Fuel log' })).toHaveCount(0)
})

test('a 100-mile goal gets the stronger safety card on the lab page', async ({ page, baseURL }) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  const { thisMonday, raceDate } = relativeDates()
  await seedHistory(api, thisMonday)
  const goal = (await api.post('/goals', {
    name: 'Fuel 100 miles',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 160_934,
    goalType: 'time',
    targetTimeSec: 30 * HOUR,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)

  await page.goto('/fuel')
  const eah = page.getByRole('note', { name: EAH_HEADING })
  await expect(eah).toBeVisible()
  await expect(eah).toContainText(
    `On events over ${String(P.n7.eahStrongerAlertHours.value)} hours, or in heat, take extra care`,
  )
  // The thirst-led lines are on every variant.
  await expect(eah).toContainText('Drink to thirst. Never force fluids')
})

import { expect, test, type Page } from '@playwright/test'
import { planWithRunToday, signedInApi, type Api } from './helpers.ts'

// The Condensed figures switch (an experiment): off by default, and then the page never asks for
// Archivo; on, the latin font loads and the Today hero figure is set in it. The 360 px checks run
// with the switch on, since a narrower face must never push the page sideways.

test.describe.configure({ mode: 'serial' })

let page: Page
let api: Api
const archivoRequests: string[] = []

const heroFigure = () => page.locator('article [class*="display"].figure-type')

async function familyOf(locator: ReturnType<typeof heroFigure>): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).fontFamily)
}

async function scrollsSideways(): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 740 } })
  page = await context.newPage()
  page.on('request', (request) => {
    if (/archivo/i.test(request.url())) archivoRequests.push(request.url())
  })
  api = await signedInApi(page, baseURL ?? '')
  await planWithRunToday(api, page, baseURL ?? '', 'Condensed marathon')
})

test.afterAll(async () => {
  await page.context().close()
})

test('with the switch off no Archivo is requested and the hero figure keeps its serif', async () => {
  await page.goto('/settings')
  await expect(page.getByRole('checkbox', { name: 'Condensed figures' })).not.toBeChecked()
  await page.goto('/')
  await expect(heroFigure()).toBeVisible()
  expect(await familyOf(heroFigure())).toContain('Source Serif 4')
  expect(
    await page.evaluate(() => document.documentElement.hasAttribute('data-condensed-figures')),
  ).toBe(false)
  expect(archivoRequests).toEqual([])
})

test('with the switch on the latin font loads and the hero figure is set in it', async () => {
  await page.goto('/settings')
  await page.getByRole('checkbox', { name: 'Condensed figures' }).check()
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved')

  await page.goto('/')
  await expect(heroFigure()).toBeVisible()
  expect(await familyOf(heroFigure())).toContain('Archivo Variable')
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('700 40px "Archivo Variable"')))
    .toBe(true)
  await expect
    .poll(() => archivoRequests.filter((url) => /archivo-latin-wdth/.test(url)).length)
    .toBeGreaterThan(0)
  // the latin file only, never the other scripts
  expect(archivoRequests.some((url) => /latin-ext|vietnamese/.test(url))).toBe(false)
  const stretch = await heroFigure().evaluate((el) => getComputedStyle(el).fontStretch)
  expect(stretch).toBe('75%')
})

test('with the switch on nothing overflows at 360 px on Today, Plan and My paces', async () => {
  for (const path of ['/', '/plan', '/paces', '/activities']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await scrollsSideways(), `${path} scrolls sideways`).toBe(false)
  }
})

test('turning the switch off again restores the serif', async () => {
  await page.goto('/settings')
  await page.getByRole('checkbox', { name: 'Condensed figures' }).uncheck()
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved')
  await page.goto('/')
  await expect(heroFigure()).toBeVisible()
  expect(await familyOf(heroFigure())).toContain('Source Serif 4')
})

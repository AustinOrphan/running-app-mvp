import { readFile } from 'node:fs/promises'
import { expect, request, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import type { PlanSession, PlanWithSessions } from '../../shared/types.ts'
import { FILE_SLUGS, publishable } from '../../shared/workouts/labels.ts'
import { createPrisma } from '../../server/db.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { RUNNER, relativeDates, resetData, signedInApi, toast, type Api } from './helpers.ts'

// Sessions on the wrist the way a runner meets them without an intervals.icu account: the workout
// file of one session and the zip of a week from the Plan page, the sentence that says sending is
// off, Today's watch line at a phone's width, and the private calendar link made, read by a
// calendar app that has no cookie, and revoked. Connecting intervals.icu needs the network, so the
// line is shown from rows the publisher would have written, put in the database directly.
//
// The server counts every API request against one budget of 1000 per 15 minutes for the whole e2e
// run, and the specs before this one leave about 50 of it. This spec therefore shares one signed-in
// page and one plan, loads each page once where it can, and leaves the finer cases (every state of
// the line, the failures of the dialog) to the web and API tests. No service worker may stand
// between the page and the server.
test.describe.configure({ mode: 'serial' })

let page: Page
let api: Api
let origin: string
let hero: PlanSession
let plan: PlanWithSessions

const RUN_KINDS = ['easy', 'recovery', 'long', 'threshold', 'intervals', 'hills', 'race-pace']

test.beforeAll(async ({ browser, baseURL }) => {
  origin = baseURL ?? ''
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  page = await context.newPage()
  api = await signedInApi(page, origin)
  hero = await planWithRunToday()
})

test.afterAll(async () => {
  await page.context().close()
})

/** A little history, a goal and a plan with a run on today (moved there when the plan has none). */
async function planWithRunToday(): Promise<PlanSession> {
  const { today, lastWednesday, raceDate } = relativeDates()
  await resetData()
  await api.post('/activities', {
    date: lastWednesday,
    type: 'run',
    durationSec: 40 * 60,
    distanceM: 6500,
  })
  const goal = (await api.post('/goals', {
    name: 'Wrist marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  plan = (await api.post('/plan/generate', {
    goalId: goal.id,
    strengthPreference: 0,
  })) as PlanWithSessions

  const isRun = (session: PlanSession) => RUN_KINDS.includes(session.kind)
  const found = plan.sessions.find((session) => session.date === today && isRun(session))
  if (found !== undefined) return found
  // No run falls on today in this plan: move the next one here, the way the runner would.
  for (const candidate of plan.sessions.filter((s) => s.date > today && isRun(s))) {
    const response = await page.request.put(`/api/plan/sessions/${candidate.id}`, {
      headers: { Origin: origin },
      data: { date: today },
    })
    if (!response.ok()) continue
    const moved = (await response.json()) as PlanSession
    plan = {
      ...plan,
      sessions: plan.sessions.map((s) => (s.id === moved.id ? moved : s)),
    }
    return moved
  }
  throw new Error(`The plan has no run for ${today} and none could be moved there.`)
}

const SENDING_OFF =
  'Sending to your watch is off. Download the workout file, or turn it on under Integrations.'

test('Plan says sending is off, and offers a named FIT file for a session and a zip for the week', async () => {
  const { thisMonday, today } = relativeDates()
  await page.goto('/plan')

  const strip = page.getByRole('region', { name: 'Watch' })
  await expect(strip.getByText(SENDING_OFF)).toBeVisible()
  await expect(strip.getByRole('link', { name: 'Open Integrations' })).toBeVisible()

  // this week's days are open when the page opens
  await page
    .locator(`tr[data-days-for="${thisMonday}"] button[data-status="planned"]`)
    .filter({ hasText: hero.title })
    .first()
    .click()
  const sheet = page.getByRole('dialog', { name: hero.title })
  const section = sheet.getByRole('region', { name: 'On your watch' })
  await expect(section.getByText(SENDING_OFF)).toBeVisible()

  const [file] = await Promise.all([
    page.waitForEvent('download'),
    section.getByRole('link', { name: 'Download the workout file' }).click(),
  ])
  // the date and the allowlisted kind, never the title
  expect(file.suggestedFilename()).toBe(`${today}-${FILE_SLUGS[hero.kind]}.fit`)
  const bytes = await readFile(await file.path())
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('.FIT')

  // the week: one `.fit` for each run of it still to be done
  await sheet.getByRole('button', { name: 'Close' }).click()
  const [zip] = await Promise.all([
    page.waitForEvent('download'),
    page
      .locator(`tr[data-days-for="${thisMonday}"]`)
      .getByRole('link', { name: /^Download the week of .+ as \.zip$/ })
      .click(),
  ])
  expect(zip.suggestedFilename()).toBe(`workouts-${thisMonday}.zip`)
  const files = unzipSync(new Uint8Array(await readFile(await zip.path())))
  const runs = plan.sessions.filter(
    (s) => s.weekStart === thisMonday && publishable(s.kind) && isToRun(s.status),
  )
  expect(runs.length).toBeGreaterThan(0)
  const stems = (names: string[]) => names.map((name) => name.replace(/(-\d)?\.fit$/, '')).sort()
  expect(stems(Object.keys(files))).toEqual(
    stems(runs.map((s) => `${s.date}-${FILE_SLUGS[s.kind]}.fit`)),
  )
  for (const entry of Object.values(files)) {
    expect(Buffer.from(entry).subarray(8, 12).toString('ascii')).toBe('.FIT')
  }
})

test("Today's watch line fits its 24 px at 360 px, in its first state and in the widest", async () => {
  const { today } = relativeDates()
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: RUNNER.email } })
    await prisma.deliveryChannel.create({
      data: { userId: user.id, channel: 'intervals', enabled: true, garminLinked: true },
    })
    const publication = await prisma.wristPublication.create({
      data: {
        userId: user.id,
        channel: 'intervals',
        externalId: hero.externalId,
        date: today,
        kind: hero.kind,
        title: 'Easy run, 45 min',
        state: 'sent',
        desiredHash: 'synthetic-hash',
        sentHash: 'synthetic-hash',
        remoteId: '5001',
        // an hour ago: past the 15 minutes "On your watch" waits for
        sentAt: new Date(Date.now() - 60 * 60_000),
      },
    })

    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto('/')
    const card = page.getByRole('article', { name: hero.title })
    const slot = card.locator('[data-slot="watch"]')
    await expect(slot.getByText('On your watch.')).toBeVisible()
    await expect(slot).toHaveAttribute('data-budget-px', '24')
    expect((await slot.boundingBox())!.height).toBeLessThanOrEqual(24)

    // the longest line it writes: the reason of the widest code, with the workout file beside it
    await prisma.wristPublication.update({
      where: { id: publication.id },
      data: {
        state: 'failed',
        failCode: 'rate-limit',
        attempts: 1,
        nextAttemptAt: new Date(Date.now() + 60 * 60_000),
      },
    })
    await page.reload()
    await expect(
      slot.getByText('Not on the watch yet: intervals.icu asked the app to wait.'),
    ).toBeVisible()
    const link = slot.getByRole('link', { name: 'Download the workout file' })
    await expect(link).toBeVisible()
    expect((await slot.boundingBox())!.height).toBeLessThanOrEqual(24)
    // the link stays inside the viewport and the page does not scroll sideways
    const box = (await link.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(360)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  } finally {
    await prisma.wristPublication.deleteMany({ where: { externalId: hero.externalId } })
    await prisma.deliveryChannel.deleteMany({ where: { channel: 'intervals' } })
    await prisma.$disconnect()
    await page.setViewportSize({ width: 1280, height: 720 })
  }
})

test('the calendar link is made once, read without a cookie, and stops working when turned off', async ({
  baseURL,
}) => {
  await page.goto('/integrations')
  const section = page.getByRole('region', { name: 'Calendar link' })
  await expect(section.getByText('The calendar link is off.')).toBeVisible()
  await expect(
    section.getByText('The calendar shows the next 28 days; the watch gets the next 14.', {
      exact: false,
    }),
  ).toBeVisible()

  await section.getByRole('button', { name: 'Create calendar link' }).click()
  const dialog = page.getByRole('dialog', { name: 'Your calendar link' })
  const address = await dialog.getByRole('textbox', { name: 'Calendar link address' }).inputValue()
  expect(address).toMatch(new RegExp(`^${baseURL}/api/calendar/[A-Za-z0-9_-]{43}/plan\\.ics$`))
  await expect(dialog.getByRole('link', { name: 'Open in a calendar app' })).toHaveAttribute(
    'href',
    /^webcal:\/\/.+\/api\/calendar\/[A-Za-z0-9_-]{43}\/plan\.ics$/,
  )

  // A calendar app sends no cookie: a new context holds none.
  const anonymous = await request.newContext()
  try {
    const feed = await anonymous.get(address)
    expect(feed.status()).toBe(200)
    expect(feed.headers()['content-type']).toContain('text/calendar')
    expect(feed.headers()['referrer-policy']).toBe('no-referrer')
    const text = await feed.text()
    expect(text).toContain('BEGIN:VCALENDAR')
    expect(text).toContain('SUMMARY:')
    // titles name the kind of run and its length, never a figure of the body
    expect(text).not.toMatch(/bpm|heart rate|injur|illness|pain/i)

    // The token is shown once: closing the dialog drops it, and the page never gets it back.
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    const token = address.split('/')[5]!
    expect(await page.content()).not.toContain(token)
    await expect(section.getByText(/^The calendar link works\. It was made on /)).toBeVisible()

    await section.getByRole('button', { name: 'Turn off the link' }).click()
    await expect(toast(page, 'Calendar link turned off')).toBeVisible()
    await expect(section.getByText('The calendar link is off.')).toBeVisible()

    // revoked: the same address is now an unknown route
    const gone = await anonymous.get(address)
    expect(gone.status()).toBe(404)
    expect(await gone.text()).not.toContain('BEGIN:VCALENDAR')
  } finally {
    await anonymous.dispose()
  }
})

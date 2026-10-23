import { expect, test, type Locator, type Page } from '@playwright/test'
import { causeSentence } from '../../shared/copy/revisionView.ts'
import { addDays } from '../../shared/dates.ts'
import type {
  ActivityListPage,
  BriefView,
  PlanRevisionView,
  PlanWithSessions,
} from '../../shared/types.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type AddressInfo } from 'node:net'
import type { Deps } from '../../server/app.ts'
import { loadConfig } from '../../server/config.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { runReplanJob } from '../../server/jobs/scheduler.ts'
import { E2E_DATABASE_URL } from './env.ts'
import { relativeDates, resetData, signedInApi, toast, type Api } from './helpers.ts'

// The Monday brief the way a runner meets it: what the weekly update changed, with its cause, in
// one column on a phone and two from 900 px; the undo previewed before it is done; the undo refused
// while a warning sign from a check-in is active and once a run is linked to a changed session.
//
// The weekly update is the scheduler's job, which no request can start, so the spec runs it itself,
// as of next Monday: the plan was made this week, so the update that has a week to decide about
// that Monday's update has a week to decide about, and the spec opens that week's brief. Illness
// reported this week makes it a lighter week with a decision that cites rule n-3, rows to show and
// an earlier plan that still passes the plan checks.
//
// The server counts every API request against one budget of 1000 per 15 minutes for the whole
// suite, and the specs before this one leave about 40 of it. So this spec starts a server of its
// own (the same build on the same database file, so a budget of its own) instead of using the
// suite's, and reads the plan and the brief through it. No service worker may stand between the
// page and it.
test.describe.configure({ mode: 'serial' })

const SESSION_SECRET = 'e2e-test-only-secret-0123456789abcdef!!'

let page: Page
let api: Api
let deps: Deps
let app: ChildProcess
/** The plan as generated, to compare with the plan after an undo. */
let original: string

/** Starts `dist/server/index.js` on a free port and resolves with its origin once it listens. */
async function startApp(): Promise<string> {
  const port = await new Promise<number>((found, failed) => {
    const probe = createServer()
    probe.once('error', failed)
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address() as AddressInfo
      probe.close(() => {
        found(free)
      })
    })
  })
  app = spawn(process.execPath, ['dist/server/index.js'], {
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET,
      PORT: String(port),
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((ready, failed) => {
    app.once('exit', (code) => {
      failed(new Error(`The app exited with code ${String(code)} before it listened.`))
    })
    app.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('"msg":"server listening"')) ready()
    })
  })
  return `http://localhost:${String(port)}`
}

test.beforeAll(async ({ browser }) => {
  const prisma = createPrisma(E2E_DATABASE_URL)
  await initSqlite(prisma)
  const config = loadConfig({
    DATABASE_URL: E2E_DATABASE_URL,
    SESSION_SECRET,
    NODE_ENV: 'development',
    LOG_LEVEL: 'silent',
  })
  // The update reads cached weather only; a request for more fails the spec loudly.
  deps = { prisma, config, fetch: () => Promise.reject(new Error('The e2e spec has no network.')) }
  const origin = await startApp()
  const context = await browser.newContext({
    baseURL: origin,
    serviceWorkers: 'block',
    viewport: { width: 360, height: 740 },
  })
  page = await context.newPage()
  api = await signedInApi(page, origin)
  await seedPlan(api)
  original = await planState()
})

test.afterAll(async () => {
  await page.context().close()
  await new Promise((stopped) => {
    app.once('exit', stopped)
    app.kill('SIGTERM')
  })
  await deps.prisma.$disconnect()
})

/** Eight weeks of four runs to plan from, a goal 14 weeks out and a plan with sessions. */
async function seedPlan(api: Api): Promise<void> {
  await resetData()
  const { thisMonday } = relativeDates()
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
  const goal = (await api.post('/goals', {
    name: 'Brief half',
    priority: 'A',
    targetDate: addDays(thisMonday, 7 * 14 + 5),
    distanceM: 21_097,
    goalType: 'finish',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id })
}

/** Every session of the plan by the identity that survives a re-plan, as the plan holds it. */
async function planState(): Promise<string> {
  const current = (await api.get('/plan')) as PlanWithSessions
  return JSON.stringify(
    current.sessions
      .map(({ externalId, date, kind, durationMin, status }) => [
        externalId,
        date,
        kind,
        durationMin,
        status,
      ])
      .sort(),
  )
}

/** The Monday update, run as the scheduler runs it on `monday` at 03:00, writing its revision and brief. */
async function runWeeklyUpdate(monday: string): Promise<void> {
  await runReplanJob(deps, { now: new Date(`${monday}T03:00:00`) })
}

/** The brief of the week that opens on `monday`, which the update just described. */
async function briefOf(monday: string): Promise<BriefView & { revision: PlanRevisionView }> {
  const { brief } = (await api.get(`/brief?weekStart=${monday}`)) as { brief: BriefView | null }
  expect(brief, 'the week has a brief').not.toBeNull()
  expect(brief?.revision, 'the weekly update wrote a revision').not.toBeNull()
  return brief as BriefView & { revision: PlanRevisionView }
}

/** The kinds of session a run can fulfil. */
const RUN_KINDS = [
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'b2b',
]

/** The check-in of a day says whether the runner was ill; the update reads it from the record. */
async function reportIllness(date: string, ill: boolean): Promise<void> {
  await api.put(`/checkins/${date}`, { illness: ill })
}

/** Where a section sits on the page, for the layout checks. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box as NonNullable<typeof box>
}

async function noSidewaysScroll() {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0)
}

test("Today's brief line fits its 52 px slot at 360 px and opens the brief", async () => {
  // The current week's brief exists once it has been asked for; before Monday's update it reads
  // today's plan. No update has changed the plan yet, so the page leaves the slot to the brief line.
  await page.goto('/brief')
  await expect(
    page.getByText("The weekly update has not run yet. This brief reads today's plan."),
  ).toBeVisible()
  await page.goto('/')
  // The line is asked for once its slot is near the viewport, and the slot sits under the week.
  await page.getByRole('region', { name: 'This week' }).scrollIntoViewIfNeeded()
  const line = page.getByRole('region', { name: 'Weekly brief' })
  await expect(line).toBeVisible()
  await expect(line).toHaveText(
    /^Since last week: no changes, (next key session .*|no key session this week\.) Open the brief$/,
  )
  const slot = page.locator('[data-slot="brief"]')
  await expect(slot).toHaveAttribute('data-budget-px', '52')
  expect((await boxOf(slot)).height).toBeLessThanOrEqual(52)
  await noSidewaysScroll()
  await slot.screenshot({ path: test.info().outputPath('brief-line-360.png') })
  await line.getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Weekly brief' })).toBeVisible()
  await expect(page).toHaveURL(/\/brief$/)
})

test('the brief lists a change with its cause, in one column on a phone and two from 900 px', async () => {
  const { thisMonday } = relativeDates()
  const monday = addDays(thisMonday, 7)
  await reportIllness(thisMonday, true)
  await runWeeklyUpdate(monday)
  await reportIllness(thisMonday, false)
  const { revision } = await briefOf(monday)
  expect(revision.diff?.empty, 'the update has rows to show').toBe(false)
  expect(revision.undo.available).toBe(true)
  expect(await planState(), 'the update changed the plan').not.toEqual(original)

  // Phone width: one column, in the order of the design.
  await page.goto(`/brief/${monday}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Weekly brief' })).toBeVisible()
  await expect(page.getByText(/^Week of \d{1,2} \w{3}$/)).toBeVisible()
  await expect(
    page.getByText(/^(Last week you ran |No running was logged last week)/),
  ).toBeVisible()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'What changed and why',
    'What the plan noticed',
    'Next key session',
    'Since this brief',
  ])
  const changed = page.getByRole('region', { name: 'What changed and why' })
  const noticed = page.getByRole('region', { name: 'What the plan noticed' })
  const key = page.getByRole('region', { name: 'Next key session' })
  const since = page.getByRole('region', { name: 'Since this brief' })
  await expect(changed.getByText(/^The weekly update (changed|adjusted) /)).toBeVisible()

  // The change as from and to, and why: the cause is in the runner's words.
  await expect(
    changed.getByRole('list', { name: 'Changes in this update' }).getByRole('listitem').first(),
  ).toBeVisible()
  const causes = [
    ...new Set([
      ...Object.values(revision.causes?.sessions ?? {}).flat(),
      ...Object.values(revision.causes?.weeks ?? {}).flat(),
    ]),
  ]
  expect(causes.length, 'every change has a cause').toBeGreaterThan(0)
  const sentences = causes.map((cause) => changed.getByText(causeSentence(cause, 'km')))
  await expect(sentences.reduce((either, one) => either.or(one)).first()).toBeVisible()
  // The update is new until the page has been opened once.
  await expect(changed.getByText('New', { exact: true })).toBeVisible()
  await expect(since.getByText('Nothing has changed since this brief.')).toBeVisible()

  const phone = await Promise.all([changed, noticed, key, since].map(boxOf))
  for (const [above, below] of [
    [phone[0], phone[1]],
    [phone[1], phone[2]],
    [phone[2], phone[3]],
  ] as const) {
    expect(below!.y, 'each section sits below the one before').toBeGreaterThan(
      above!.y + above!.height - 1,
    )
    expect(below!.x).toBeCloseTo(above!.x, 0)
  }
  await noSidewaysScroll()
  await page.screenshot({ path: test.info().outputPath('brief-360.png'), fullPage: true })

  // From 900 px the update takes the left column and the other three stack on the right.
  await page.setViewportSize({ width: 900, height: 900 })
  await expect(changed).toBeVisible()
  const wide = await Promise.all([changed, noticed, key, since].map(boxOf))
  expect(wide[1]!.x, 'what the plan noticed is right of the update').toBeGreaterThan(
    wide[0]!.x + wide[0]!.width - 1,
  )
  expect(wide[1]!.y).toBeCloseTo(wide[0]!.y, 0)
  expect(wide[2]!.x).toBeCloseTo(wide[1]!.x, 0)
  expect(wide[2]!.y).toBeGreaterThan(wide[1]!.y + wide[1]!.height - 1)
  expect(wide[3]!.x).toBeCloseTo(wide[1]!.x, 0)
  expect(wide[3]!.y).toBeGreaterThan(wide[2]!.y + wide[2]!.height - 1)
  await noSidewaysScroll()
  await page.screenshot({ path: test.info().outputPath('brief-900.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await noSidewaysScroll()
  await page.screenshot({ path: test.info().outputPath('brief-1280.png'), fullPage: true })
  await page.setViewportSize({ width: 360, height: 740 })

  // Its Why opens the figures of last week's decision, from the server, never an error.
  await changed.getByRole('button', { name: 'Why this update' }).click()
  const why = page.getByRole('dialog', { name: 'Why this?' })
  await expect(why.getByRole('heading', { name: 'From your numbers' })).toBeVisible()
  await expect(why.getByText(/Your figures could not be loaded/)).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(why).toBeHidden()

  // Opening stamped the update as seen: the marker is gone when the page is read again.
  await page.reload()
  await expect(changed.getByRole('list', { name: 'Changes in this update' })).toBeVisible()
  await expect(changed.getByText('New', { exact: true })).toBeHidden()
})

test('undo is refused while a warning sign from a check-in is active, and offered again when it clears', async () => {
  const { today, thisMonday } = relativeDates()
  const monday = addDays(thisMonday, 7)
  const { revision } = await briefOf(monday)
  const rules = revision.decision?.signals.flatMap((signal) => signal.rules) ?? []
  expect(rules, 'the decision cites the illness rule').toContain('n-3')
  expect(revision.undo.available, 'nothing is wrong today yet').toBe(true)

  // The sign is active today.
  await reportIllness(today, true)
  const listed = (await api.get('/plan/revisions')) as PlanRevisionView[]
  const refused = listed.find((candidate) => candidate.id === revision.id)!
  const reason = refused.undo.reasons.find((candidate) => candidate.code === 'safety-rule')
  expect(reason, 'the server names the warning sign').toBeDefined()

  await page.goto(`/brief/${monday}`)
  const changed = page.getByRole('region', { name: 'What changed and why' })
  await expect(changed.getByRole('list', { name: 'Changes in this update' })).toBeVisible()
  await expect(changed.getByRole('button', { name: 'Undo update' })).toBeHidden()
  const reasons = changed.getByRole('list', { name: 'Why this cannot be undone' })
  await expect(reasons.getByText(reason!.message, { exact: true })).toBeVisible()
  await expect(
    reasons.getByText(/followed a safety rule that still applies \(illness\)/),
  ).toBeVisible()
  await noSidewaysScroll()

  // The sign clears: the same update can be undone again.
  await reportIllness(today, false)
  await page.reload()
  await expect(changed.getByRole('button', { name: 'Undo update' })).toBeVisible()
})

test('undo shows what it would change back before it does, and restores the plan', async () => {
  const { thisMonday } = relativeDates()
  await page.goto(`/brief/${addDays(thisMonday, 7)}`)
  const changed = page.getByRole('region', { name: 'What changed and why' })
  const updated = await planState()
  await changed.getByRole('button', { name: 'Undo update' }).click()
  const dialog = page.getByRole('dialog', { name: 'Undo this update' })
  await expect(dialog).toBeFocused()
  await expect(dialog.getByText('Put the plan back as it was before this update?')).toBeVisible()
  await expect(dialog.getByRole('list', { name: 'What would change back' })).toBeVisible()
  // The preview writes nothing; Keep closes it and puts focus back where it came from.
  expect(await planState()).toEqual(updated)
  await dialog.getByRole('button', { name: 'Keep' }).click()
  await expect(dialog).toBeHidden()
  await expect(changed.getByRole('button', { name: 'Undo update' })).toBeFocused()

  await changed.getByRole('button', { name: 'Undo update' }).click()
  await dialog.getByRole('button', { name: 'Undo update' }).click()
  await expect(toast(page, /^Plan restored to how it was on /)).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(changed.getByText('This update was already undone.')).toBeVisible()
  await expect(changed.getByRole('button', { name: 'Undo update' })).toBeHidden()
  expect(await planState(), 'the plan is as it was').toEqual(original)
})

test('undo is refused once a run is linked to a session the update changed', async () => {
  const { today, thisMonday } = relativeDates()
  const monday = addDays(thisMonday, 7)
  // The undone update is made again by the next run of the job, on the same report of illness.
  await reportIllness(thisMonday, true)
  await runWeeklyUpdate(monday)
  await reportIllness(thisMonday, false)
  const { revision } = await briefOf(monday)
  expect(revision.undo.available).toBe(true)
  const line = revision.diff?.sessions.find(
    (candidate) =>
      candidate.sessionId !== null &&
      candidate.after !== null &&
      RUN_KINDS.includes(candidate.after.kind) &&
      candidate.date >= today,
  )
  expect(line, 'the update changed a run that is still to come').toBeDefined()
  // A run that fulfils no other session: the link route refuses one that is already taken.
  const current = (await api.get('/plan')) as PlanWithSessions
  const taken = new Set(
    current.sessions.flatMap((s) => (s.activityId === null ? [] : [s.activityId])),
  )
  const runs = (await api.get('/activities?type=run&limit=100')) as ActivityListPage
  const free = runs.items.find((item) => !taken.has(item.id))
  expect(free, 'a run that no session has taken').toBeDefined()
  await api.post(`/plan/sessions/${line!.sessionId}/link`, { activityId: free!.id })

  const listed = (await api.get('/plan/revisions')) as PlanRevisionView[]
  const refused = listed.find((candidate) => candidate.id === revision.id)!
  expect(refused.undo.available).toBe(false)
  const reason = refused.undo.reasons.find((candidate) => candidate.code === 'session-run')
  expect(reason, 'the server names the run').toBeDefined()
  expect(reason!.message).not.toBe('')

  await page.goto(`/brief/${monday}`)
  const changed = page.getByRole('region', { name: 'What changed and why' })
  await expect(changed.getByRole('list', { name: 'Changes in this update' })).toBeVisible()
  await expect(changed.getByRole('button', { name: 'Undo update' })).toBeHidden()
  const reasons = changed.getByRole('list', { name: 'Why this cannot be undone' })
  await expect(reasons.getByText(reason!.message, { exact: true })).toBeVisible()
  await noSidewaysScroll()
})

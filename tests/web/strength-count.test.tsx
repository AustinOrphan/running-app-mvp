// The count prompt of the Strength page (E14-10b; strength design 12.4). The weeks of
// every view here come from the real `summariseHistory` over a synthetic plan of two sessions a week,
// so the threshold the page honours is the one `f9.countPromptWeeks` gives.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import { summariseHistory } from '../../shared/engine/strength.ts'
import type { StrengthLogEntry } from '../../shared/engine/types.ts'
import type { AthleteProfile, StrengthView, UserSettings } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { STRENGTH_PROMPT_PREFIX, purgeDrafts, readCountNotNow } from '../../web/pwa/drafts.ts'
import { StrengthPage } from '../../web/pages/StrengthPage.tsx'
import { context, log, sessionRef, sessionsOf } from '../unit/engine/strength-fixtures.ts'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { SETTINGS } from './strength-fixtures.ts'
import { PROFILE, pageView } from './strength-page-fixtures.ts'

const QUESTION = 'Two a week is the plan; one fits a busy stretch too. Plan one a week?'
const STORAGE_KEY = `${STRENGTH_PROMPT_PREFIX}count-not-now`
const LOW_WEEKS = P.f9.countPromptWeeks.value

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

// ---- The views ---------------------------------------------------------------------------------

/** The plan of the fixtures: two sessions a week for the six weeks up to and including today's. */
const TODAY = context().today

/** Both sessions of week `i` logged. */
const full = (i: number): StrengthLogEntry[] => [
  log(`f${String(i)}a`, sessionRef(i, 0).date),
  log(`f${String(i)}b`, sessionRef(i, 1).date),
]

/** One of the two sessions of week `i` logged. */
const one = (i: number): StrengthLogEntry[] => [log(`o${String(i)}`, sessionRef(i, 0).date)]

/** The last `n` finished weeks logged one session of two, the weeks before them both. */
function lowWeeks(n: number): StrengthLogEntry[] {
  const finished = 4
  return Array.from({ length: finished + 1 }, (_, i) => i).flatMap((i) =>
    i > finished - n ? one(i) : full(i),
  )
}

/** A page view whose weeks, low-week count and prompt flag are the engine's answer for `logs`. */
function viewFor(logs: StrengthLogEntry[], over: Partial<StrengthView> = {}): StrengthView {
  const summary = summariseHistory(context({ logs, sessions: sessionsOf(6) }))
  return pageView({
    asOf: TODAY,
    weeks: summary.weeks,
    lowCountWeeks: summary.lowCountWeeks,
    countPrompt: summary.countPrompt,
    ...over,
  })
}

// ---- The page ----------------------------------------------------------------------------------

interface Options {
  settings?: UserSettings
  profile?: AthleteProfile
  routes?: MockRoutes
}

function openPage(view: StrengthView, options: Options = {}) {
  const { calls } = mockApi({
    'GET /api/settings': () => options.settings ?? SETTINGS,
    'GET /api/strength': () => view,
    'GET /api/profile': () => options.profile ?? PROFILE,
    'PUT /api/profile': ({ body }) => ({ ...(options.profile ?? PROFILE), ...(body as object) }),
    ...options.routes,
  })
  renderWithProviders(
    <ToastProvider>
      <StrengthPage />
    </ToastProvider>,
    { route: '/strength' },
  )
  return { calls }
}

async function page() {
  await screen.findByRole('region', { name: 'Next session' })
}

const prompt = () => screen.queryByRole('group', { name: QUESTION })
const writes = (calls: Array<{ method: string }>) => calls.filter((call) => call.method !== 'GET')

/** The profile route has answered, so the prompt has had what it needs to appear or not. */
async function settled(calls: Array<{ method: string; url: string }>) {
  await waitFor(() => {
    expect(calls.some((call) => call.url === '/api/profile')).toBe(true)
  })
}

describe('the count prompt (design 12.4)', () => {
  test('is asked after f9.countPromptWeeks finished weeks with fewer sessions than planned, under the block', async () => {
    const view = viewFor(lowWeeks(LOW_WEEKS))
    expect(view).toMatchObject({ lowCountWeeks: LOW_WEEKS, countPrompt: true })
    openPage(view)
    await page()
    const group = await screen.findByRole('group', { name: QUESTION })
    expect(group).toHaveTextContent(QUESTION)
    expect(within(group).getByRole('button', { name: 'Plan 1 a week' })).toBeEnabled()
    expect(within(group).getByRole('button', { name: 'Not now' })).toBeEnabled()
    // it stands in the left column, after "This block" and before "Lifts"
    const block = screen.getByRole('region', { name: 'This block' })
    const lifts = screen.getByRole('region', { name: 'Lifts' })
    expect(block.parentElement).toBe(group.parentElement)
    expect(block.compareDocumentPosition(group)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(group.compareDocumentPosition(lifts)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expectCleanCopy(document.body)
  })

  test('is not asked one week short of the Param, or when a full week comes between', async () => {
    const short = viewFor(lowWeeks(LOW_WEEKS - 1))
    expect(short).toMatchObject({ lowCountWeeks: LOW_WEEKS - 1, countPrompt: false })
    openPage(short)
    await page()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    cleanup()

    const broken = viewFor([...full(0), ...one(1), ...full(2), ...one(3), ...one(4)])
    expect(broken.countPrompt).toBe(false)
    openPage(broken)
    await page()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  test('is not asked when the plan already asks for one a week', async () => {
    const view = viewFor(lowWeeks(LOW_WEEKS))
    const planned = { ...view, weeks: view.weeks.map((week) => ({ ...week, planned: 1 })) }
    const { calls } = openPage(planned)
    await page()
    await settled(calls)
    expect(prompt()).not.toBeInTheDocument()
  })

  test.each([0, 1])(
    'is not asked when the Profile already says %i strength sessions a week',
    async (strengthPreference) => {
      const { calls } = openPage(viewFor(lowWeeks(LOW_WEEKS)), {
        profile: { ...PROFILE, strengthPreference: strengthPreference as 0 | 1 },
      })
      await page()
      await settled(calls)
      expect(prompt()).not.toBeInTheDocument()
    },
  )

  test('"Plan 1 a week" saves the Profile choice and nothing else, and the line says when it takes effect', async () => {
    const user = userEvent.setup()
    const { calls } = openPage(viewFor(lowWeeks(LOW_WEEKS)))
    await page()
    const group = await screen.findByRole('group', { name: QUESTION })
    // nothing is written until the button
    expect(writes(calls)).toEqual([])

    await user.click(within(group).getByRole('button', { name: 'Plan 1 a week' }))

    const line = await screen.findByText(
      'From the next weekly update the plan asks for one strength session a week.',
    )
    expect(line).toHaveAttribute('role', 'status')
    expect(line).toHaveFocus()
    expect(prompt()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plan 1 a week' })).not.toBeInTheDocument()
    // one write, the whole Profile as read with the one choice changed; it does not touch the plan
    expect(writes(calls)).toEqual([
      { method: 'PUT', url: '/api/profile', body: { ...PROFILE, strengthPreference: 1 } },
    ])
    // and no answer is kept in the browser: the question is settled by the Profile now
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expectCleanCopy(document.body)
  })

  test('says so and keeps the question when the choice was not saved', async () => {
    const user = userEvent.setup()
    openPage(viewFor(lowWeeks(LOW_WEEKS)), {
      routes: {
        'PUT /api/profile': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'Down.' } },
        }),
      },
    })
    await page()
    const group = await screen.findByRole('group', { name: QUESTION })
    await user.click(within(group).getByRole('button', { name: 'Plan 1 a week' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The choice was not saved. Try again.',
    )
    expect(prompt()).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Plan 1 a week' })).toBeEnabled()
    expectCleanCopy(document.body)
  })

  test('"Not now" changes nothing, keeps the day in the browser and says how long it waits', async () => {
    const user = userEvent.setup()
    const { calls } = openPage(viewFor(lowWeeks(LOW_WEEKS)))
    await page()
    const group = await screen.findByRole('group', { name: QUESTION })

    await user.click(within(group).getByRole('button', { name: 'Not now' }))

    const line = await screen.findByText('Nothing changes. The question stays away for four weeks.')
    expect(line).toHaveAttribute('role', 'status')
    expect(line).toHaveFocus()
    expect(prompt()).not.toBeInTheDocument()
    expect(writes(calls)).toEqual([])
    // the server's day, not the phone's
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(TODAY)
    expect(readCountNotNow()).toBe(TODAY)
    expectCleanCopy(document.body)
  })

  test('stays quiet for 4 weeks after "Not now", and returns on the 28th day', async () => {
    window.localStorage.setItem(STORAGE_KEY, TODAY)
    const asOf = (days: number) => viewFor(lowWeeks(LOW_WEEKS), { asOf: addDays(TODAY, days) })

    for (const days of [0, 1, 27]) {
      const { calls } = openPage(asOf(days))
      await page()
      await settled(calls)
      expect(prompt(), `${String(days)} days after`).not.toBeInTheDocument()
      cleanup()
    }
    openPage(asOf(28))
    await page()
    expect(await screen.findByRole('group', { name: QUESTION })).toBeInTheDocument()
  })

  test('ignores a day in the future and a value that is not a day', async () => {
    window.localStorage.setItem(STORAGE_KEY, addDays(TODAY, 3))
    openPage(viewFor(lowWeeks(LOW_WEEKS)))
    await page()
    expect(await screen.findByRole('group', { name: QUESTION })).toBeInTheDocument()
    cleanup()

    window.localStorage.setItem(STORAGE_KEY, 'not a day')
    openPage(viewFor(lowWeeks(LOW_WEEKS)))
    await page()
    expect(await screen.findByRole('group', { name: QUESTION })).toBeInTheDocument()
  })

  test('works with the browser storage blocked: the question is asked, and "Not now" holds until the page reloads', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked.', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked.', 'SecurityError')
    })
    const user = userEvent.setup()
    openPage(viewFor(lowWeeks(LOW_WEEKS)))
    await page()
    const group = await screen.findByRole('group', { name: QUESTION })
    await user.click(within(group).getByRole('button', { name: 'Not now' }))
    expect(await screen.findByText(/^Nothing changes\./)).toBeInTheDocument()
    expect(prompt()).not.toBeInTheDocument()
  })

  test('is wiped with the drafts when a session ends', () => {
    window.localStorage.setItem(STORAGE_KEY, TODAY)
    window.localStorage.setItem('theme', 'dark')
    act(() => {
      purgeDrafts()
    })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem('theme')).toBe('dark')
  })
})

describe('the stylesheet of the prompt (design 11.7)', () => {
  const css = (file: string) =>
    readFileSync(join(process.cwd(), 'web/components/strength', file), 'utf8')

  test('the prompt wraps its line and its buttons at 360 px, and only a failed save is danger-coloured', () => {
    const prompt = css('CountPrompt.module.css')
    expect(prompt).toMatch(/\.prompt \{[^}]*min-width: 0;/s)
    expect(prompt).toMatch(/\.actions \{[^}]*flex-wrap: wrap;/s)
    // only a failed save is danger-coloured
    expect(prompt.match(/var\(--danger\)/g)).toHaveLength(1)
    expect(prompt).toMatch(/\.error \{[^}]*var\(--danger\)/s)
  })
})

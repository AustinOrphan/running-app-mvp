import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { crossTrainingLine } from '../../shared/copy/windowView.ts'
import type { DisruptionSlot as DisruptionSlotData, DisruptionView } from '../../shared/types.ts'
import { DisruptionBanners } from '../../web/components/disruption/DisruptionBanner.tsx'
import { DisruptionSlot } from '../../web/components/today/DisruptionSlot.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { WarningSignsPage } from '../../web/pages/WarningSignsPage.tsx'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { makePreview, makeV2Plan, makeWindow, settings } from './plan-fixtures.ts'
import { makeCoach, makeToday, TODAY } from './today-fixtures.ts'

// Wednesday 18 March 2026 is the server's day (the clock of `today-fixtures.ts`).
const REPEAT: DisruptionSlotData = {
  windows: [],
  offer: true,
  offerReason: 'pain-repeat',
  repeat: { area: 'left calf', reports: 3, days: 7, pain: 3 },
}
const ASK_REPEAT =
  'The same area was sore on 3 of the last 7 days. Set a rest window and a return plan?'
const CROSS = 'Easy cycling or pool work is an option while you are not running.'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

function viewWith(slot: DisruptionSlotData | null, bone = false) {
  const view = makeToday({
    coach: makeCoach({ slots: { ...makeCoach().slots, disruption: slot } }),
  })
  if (bone) {
    view.readiness.redFlags = [{ code: 'focal-bone-pain', message: 'Bone pain.', rules: ['n-1'] }]
  }
  return view
}

function routes(view: ReturnType<typeof viewWith>, extra: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/settings': () => settings,
    'GET /api/today': () => view,
    'GET /api/plan': () => makeV2Plan({}),
    'GET /api/plan/disruptions': () => [],
    ...extra,
  }
}

function renderSlot(slot: DisruptionSlotData | null, extra: MockRoutes = {}, bone = false) {
  const view = viewWith(slot, bone)
  const { calls } = mockApi(routes(view, extra))
  renderWithProviders(
    <ToastProvider>
      <main id="main" tabIndex={-1}>
        <DisruptionSlot view={view} units="km" />
      </main>
    </ToastProvider>,
  )
  return { calls }
}

describe('the repeat offer on Today', () => {
  test('words the question with its count and keeps the two answers', async () => {
    renderSlot(REPEAT)
    const offer = await screen.findByRole('region', { name: 'Rest window offer' })
    expect(within(offer).getByText(ASK_REPEAT)).toBeInTheDocument()
    expect(within(offer).getByRole('button', { name: 'Set one up' })).toBeInTheDocument()
    expect(within(offer).getByRole('button', { name: 'Not now' })).toBeInTheDocument()
    expect(document.querySelector('.visually-hidden[role="status"]')).toHaveTextContent(ASK_REPEAT)
    expectCleanCopy(offer)
  })

  test("an offer made for today's check-in keeps its question", async () => {
    renderSlot({ windows: [], offer: true, offerReason: 'check-in', repeat: null })
    const offer = await screen.findByRole('region', { name: 'Rest window offer' })
    expect(within(offer).getByText('Set a rest window and a return plan?')).toBeInTheDocument()
    expect(screen.queryByText(/The same area/)).not.toBeInTheDocument()
  })

  test('"Not now" ends it for the visit and stores nothing', async () => {
    const user = userEvent.setup()
    renderSlot(REPEAT)
    await user.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('region', { name: 'Rest window offer' })).not.toBeInTheDocument()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  test('"Set one up" opens the sheet on a niggle with the area and the pain filled in, and creates nothing', async () => {
    const user = userEvent.setup()
    const { calls } = renderSlot(REPEAT, {
      'POST /api/plan/preview': () =>
        makePreview({
          action: {
            type: 'disruption-create',
            reason: 'niggle',
            mode: 'rest',
            startDate: '2026-03-18',
            endDate: '2026-03-18',
          },
          hash: 'c'.repeat(64),
          today: TODAY,
        }),
    })
    await user.click(await screen.findByRole('button', { name: 'Set one up' }))
    const dialog = await screen.findByRole('dialog', { name: 'Not 100%' })
    expect(await within(dialog).findByRole('heading', { name: 'When' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Where is it?')).toHaveValue('left calf')
    expect(within(dialog).getByRole('button', { name: 'Pain (0 to 10) 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      within(dialog).getByText('Filled in from your check-ins. Change anything.'),
    ).toBeInTheDocument()
    // the sentence that points to the Warning signs page, with the page name as a link
    const note = within(dialog).getByText(/If the pain is in one small spot on a bone/)
    expect(note).toHaveTextContent(
      'If the pain is in one small spot on a bone, or starts when a run begins or is there the next day, see Warning signs.',
    )
    expect(within(note).getByRole('link', { name: 'Warning signs' })).toHaveAttribute(
      'href',
      '/warning-signs',
    )
    expectCleanCopy(dialog)

    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await within(dialog).findByRole('heading', { name: 'What would change' })
    // the runner's confirmation is the only write: a preview was asked for, nothing was created
    expect(
      calls.filter((c) => c.method === 'POST' && c.url === '/api/plan/disruptions'),
    ).toHaveLength(0)
    expect(calls.find((c) => c.url === '/api/plan/preview')?.body).toEqual({
      type: 'disruption-create',
      reason: 'niggle',
      mode: 'rest',
      startDate: '2026-03-18',
      endDate: '2026-03-18',
      area: 'left calf',
      pain: 3,
    })
  })

  test("the sheet opened for today's check-in has no hint and no pointer", async () => {
    const user = userEvent.setup()
    renderSlot({ windows: [], offer: true, offerReason: 'check-in', repeat: null })
    await user.click(await screen.findByRole('button', { name: 'Set one up' }))
    const dialog = await screen.findByRole('dialog', { name: 'Not 100%' })
    expect(
      await within(dialog).findByRole('heading', { name: 'What is going on' }),
    ).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent('Filled in from your check-ins')
  })
})

describe('the cross-training line in the preview', () => {
  async function previewFor(reason: 'niggle' | 'illness-above-neck' | 'travel', bone = false) {
    const user = userEvent.setup()
    renderSlot(
      reason === 'niggle'
        ? REPEAT
        : { windows: [], offer: true, offerReason: 'check-in', repeat: null },
      {
        'POST /api/plan/preview': () =>
          makePreview({
            action: {
              type: 'disruption-create',
              reason,
              mode: 'rest',
              startDate: TODAY,
              endDate: TODAY,
            },
            hash: 'd'.repeat(64),
            today: TODAY,
          }),
      },
      bone,
    )
    await user.click(await screen.findByRole('button', { name: 'Set one up' }))
    const dialog = await screen.findByRole('dialog', { name: 'Not 100%' })
    if (reason !== 'niggle') {
      await within(dialog).findByRole('radio', { name: /Ill, above the neck/ })
      const label = reason === 'travel' ? /Travelling/ : /Ill, above the neck/
      await user.click(within(dialog).getByRole('radio', { name: label }))
      await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    }
    await within(dialog).findByRole('heading', { name: 'When' })
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await within(dialog).findByRole('heading', { name: 'What would change' })
    return dialog
  }

  test('shows on a niggle window and says nothing about fitness or healing', async () => {
    const dialog = await previewFor('niggle')
    expect(dialog).toHaveTextContent(
      'Easy cycling or pool work is an option while you are not running. It does not count toward run load.',
    )
    expect(dialog.textContent).not.toMatch(/fitness|heal|recover/i)
  })

  test('is left out when the latest check-in reports pain on a bone', async () => {
    const dialog = await previewFor('niggle', true)
    expect(dialog).not.toHaveTextContent(CROSS)
  })

  test('is left out of an illness window', async () => {
    const dialog = await previewFor('illness-above-neck')
    expect(dialog).not.toHaveTextContent(CROSS)
  })

  test('is left out of a travel window', async () => {
    const dialog = await previewFor('travel')
    expect(dialog).not.toHaveTextContent(CROSS)
  })
})

describe('the cross-training line on the banner', () => {
  const niggle = (over: Partial<DisruptionView> = {}) =>
    makeWindow({
      id: 'w1',
      reason: 'niggle',
      startDate: '2026-03-16',
      endDate: '2026-03-20',
      runFrom: '2026-03-21',
      qualityFrom: '2026-03-24',
      crossTraining: true,
      ...over,
    })

  function renderBanner(window: DisruptionView, compact = false) {
    mockApi({ 'GET /api/settings': () => settings })
    renderWithProviders(
      <ToastProvider>
        <main id="main" tabIndex={-1}>
          <DisruptionBanners windows={[window]} today={TODAY} units="km" compact={compact} />
        </main>
      </ToastProvider>,
    )
  }

  test('shows under a niggle window the server marks, in rest and in limited mode', async () => {
    renderBanner(niggle())
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    expect(within(banner).getByText(crossTrainingLine('km'))).toBeInTheDocument()
    expectCleanCopy(banner)
  })

  test('shows in limited mode too', async () => {
    renderBanner(niggle({ mode: 'limited', maxRunMin: 30, phase: 'limited' }))
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    expect(within(banner).getByText(crossTrainingLine('km'))).toBeInTheDocument()
  })

  test('is absent when the server does not mark the window (bone sign, illness, travel, short on time)', async () => {
    renderBanner(niggle({ crossTraining: false }))
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    expect(banner).not.toHaveTextContent('cycling')
  })

  test("is absent from Today's compact band, which keeps to its two lines", async () => {
    renderBanner(niggle(), true)
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    expect(banner).not.toHaveTextContent('cycling')
  })

  test.each(['illness-above-neck', 'illness-below-neck', 'short-on-time', 'travel'] as const)(
    'an unmarked %s window has none',
    async (reason) => {
      renderBanner(makeWindow({ reason, crossTraining: false }))
      const banner = await screen.findByRole('region', { name: 'Rest window' })
      expect(banner).not.toHaveTextContent('cycling')
    },
  )
})

describe('the Warning signs page, background sentence', () => {
  test('says physiotherapists sometimes use a pain-monitoring model and that the app does not', async () => {
    mockApi({})
    renderWithProviders(
      <Routes>
        <Route path="/warning-signs" element={<WarningSignsPage />} />
      </Routes>,
      { route: '/warning-signs' },
    )
    const sentence =
      'Physiotherapists sometimes use a pain-monitoring model in tendon rehabilitation, with limits they set for each person; the app does not apply it.'
    expect(await screen.findByText(sentence)).toBeInTheDocument()
    // no figure, no settling time, nothing that reads as permission to run on pain
    const page = document.body.textContent ?? ''
    expect(page).not.toMatch(/5\s*\/\s*10|5 of 10|next morning/i)
    expect(page).not.toMatch(/run through|okay to run|safe to run|may run/i)
    // the signs themselves are unchanged
    expect(page).toContain('Pain in one spot on a bone')
    expect(page).toContain(
      'Pain that starts again each time a run begins, or is still there the next day.',
    )
  })
})

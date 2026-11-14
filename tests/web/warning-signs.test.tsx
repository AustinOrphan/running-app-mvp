import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import type { StandoutView } from '../../shared/copy/standoutRender.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { WARNING_SIGNS } from '../../shared/copy/warningSigns.ts'
import type { InputFact } from '../../shared/engine/types.ts'
import type { AthleteProfile, Availability, Weekday } from '../../shared/types.ts'
import { MorePage } from '../../web/pages/MorePage.tsx'
import { ProfilePage } from '../../web/pages/ProfilePage.tsx'
import { InputFacts } from '../../web/components/InputFacts.tsx'
import { StandoutCard } from '../../web/components/StandoutCard.tsx'
import { WarningSignsPage } from '../../web/pages/WarningSignsPage.tsx'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const availability = Object.fromEntries(
  DAYS.map((day) => [day, { available: true, maxMin: null }]),
) as Availability

const PROFILE: AthleteProfile = {
  birthYear: null,
  sex: null,
  heightCm: null,
  weightKg: null,
  hrMax: null,
  hrMaxSource: null,
  hrRest: null,
  lthr: null,
  thresholdPaceSecPerKm: null,
  runningSinceYear: null,
  injuries: [],
  availability,
  longRunDay: 'sat',
  terrain: { trail: false, hills: false, treadmill: false, track: false },
  strengthPreference: 2,
  timezone: 'Europe/London',
  homeLat: null,
  homeLng: null,
  useHomeWeather: true,
}

const PAIN: InputFact = {
  id: 'design-4.2.pain',
  template: 'standout.pain',
  slots: { pain: { kind: 'count', n: 6 } },
  rule: 'design-4.2',
  sources: [{ kind: 'activity', id: 'a1', date: '2026-10-20', label: 'Run' }],
  moreSources: 0,
  state: 'used',
}

function routed(element: ReactElement) {
  return (
    <Routes>
      <Route path="/" element={element} />
      <Route path="/warning-signs" element={<WarningSignsPage />} />
    </Routes>
  )
}

describe('Warning signs page', () => {
  test('lists every sign under the two levels, each with the papers it rests on', async () => {
    renderWithProviders(<WarningSignsPage />, { route: '/warning-signs' })
    expect(screen.getByRole('heading', { level: 1, name: 'Warning signs' })).toBeInTheDocument()
    for (const level of ['Stop and call emergency services', 'Stop and see a clinician']) {
      expect(screen.getByRole('heading', { level: 2, name: level })).toBeInTheDocument()
    }
    const emergency = screen.getByRole('region', { name: 'Stop and call emergency services' })
    const clinician = screen.getByRole('region', { name: 'Stop and see a clinician' })
    expect(within(emergency).getAllByRole('heading', { level: 3 })).toHaveLength(
      WARNING_SIGNS.filter((sign) => sign.level === 'emergency').length,
    )
    expect(within(clinician).getAllByRole('heading', { level: 3 })).toHaveLength(
      WARNING_SIGNS.filter((sign) => sign.level === 'clinician').length,
    )
    expect(
      within(emergency).getByRole('heading', { level: 3, name: 'Chest, breathing and heart' }),
    ).toBeInTheDocument()
    expect(
      within(clinician).getByRole('heading', { level: 3, name: 'Signs of under-fuelling' }),
    ).toBeInTheDocument()
    // the short citations arrive with the bundled research chunk
    expect(
      await within(emergency).findByText(/Marijon 2016/, {}, { timeout: 10_000 }),
    ).toBeInTheDocument()
    expectCleanCopy(document.body)
  })
})

describe('the link in a rendered pain sentence', () => {
  test('InputFacts renders the name as a link and calls the drawer handler when it is followed', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<InputFacts facts={[PAIN]} units="km" onNavigate={onNavigate} />)
    const link = screen.getByRole('link', { name: 'Warning signs' })
    expect(link).toHaveAttribute('href', '/warning-signs')
    await user.click(link)
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })
})

describe('reaching the Warning signs page', () => {
  test('from the pain sentence of a run, by its name', async () => {
    const view: StandoutView = { items: [PAIN], more: 0 }
    mockApi({
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
      'GET /api/activities/a1/standout': () => view,
    })
    const user = userEvent.setup()
    renderWithProviders(routed(<StandoutCard activityId="a1" units="km" />))
    await user.click(await screen.findByRole('link', { name: 'Warning signs' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Warning signs' })).toBeVisible()
  })

  test('from Profile, under the injury history', async () => {
    mockApi({
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
      'GET /api/zones': () => ({
        hrMax: null,
        hrRest: null,
        lt1Hr: null,
        lt2Hr: null,
        csMps: null,
        lt1PaceSecPerKm: null,
        thresholdPaceSecPerKm: null,
        hr: null,
        pace: null,
        rpe: { z1: [2, 3], z2: [4, 6], z3: [7, 9] },
      }),
      'GET /api/screenings': () => [],
      'GET /api/profile': () => PROFILE,
    })
    const user = userEvent.setup()
    renderWithProviders(routed(<ProfilePage />))
    const injury = await screen.findByRole('region', { name: 'Injury history' })
    await user.click(within(injury).getByRole('link', { name: 'Warning signs' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Warning signs' })).toBeVisible()
  })

  test('from the More page, in the You group', async () => {
    mockApi({ 'GET /api/race/plan': () => ({ plan: null }) })
    const user = userEvent.setup()
    renderWithProviders(routed(<MorePage />))
    const you = screen.getByRole('region', { name: render(TEMPLATES['nav.group.you'], {}, 'km') })
    await user.click(within(you).getByRole('link', { name: /Warning signs/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Warning signs' })).toBeVisible()
  })
})

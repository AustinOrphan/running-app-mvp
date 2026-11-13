import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { PARQ_PLUS_URL, PLAN_NOTICE_VERSION } from '../../shared/domain/planNotice.ts'
import type { Goal, PlanNoticeView, UserSettings } from '../../shared/types.ts'
import { PlanPage } from '../../web/pages/PlanPage.tsx'
import { makeProfile } from './plan-fixtures.ts'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

const settings: UserSettings = {
  email: 'runner@example.com',
  displayName: null,
  units: 'mi',
  weightUnit: 'lb',
  showBodyWeight: false,
  hideMapEnds: true,
}

const goal: Goal = {
  id: 'g1',
  userId: 'u1',
  name: 'Spring half',
  priority: 'A',
  status: 'target',
  targetDate: '2027-03-07',
  dateProvisional: false,
  distanceM: 21098,
  location: null,
  successCriteria: null,
  notes: null,
  url: null,
  isActive: true,
  gainM: null,
  lossM: null,
  surface: 'road',
  goalType: 'time',
  targetTimeSec: null,
  startTime: null,
  raceLat: null,
  raceLng: null,
  supportLevel: 'aided',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
}

const unconfirmed: PlanNoticeView = {
  version: PLAN_NOTICE_VERSION,
  confirmedVersion: null,
  confirmedAt: null,
  required: true,
  age: 'ask',
}

function planRoutes(notice: () => PlanNoticeView, extra: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/plan': () => null,
    'GET /api/goals': () => [goal],
    'GET /api/settings': () => settings,
    'GET /api/profile': () => makeProfile(),
    'GET /api/weeks': () => [],
    'GET /api/plan-notice': notice,
    ...extra,
  }
}

describe('the health notice on the Plan page', () => {
  test('replaces the generate form until it is confirmed, and links the official PAR-Q+', async () => {
    mockApi(planRoutes(() => unconfirmed))
    renderWithProviders(<PlanPage />)

    expect(await screen.findByRole('heading', { name: 'Before your first plan' })).toBeVisible()
    expect(screen.getByText(/not medical advice/)).toBeVisible()
    expect(screen.getByText(/PAR-Q\+ Collaboration/)).toBeVisible()
    expect(screen.getByText(/version 01-11-2024/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Generate plan' })).not.toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Open the official PAR-Q+ page' })
    expect(link).toHaveAttribute('href', PARQ_PLUS_URL)
    expect(link).toHaveAttribute('rel', 'noopener')
    expect(link).toHaveAttribute('target', '_blank')
    expectCleanCopy(document.body)
  })

  test('asks for "I am 18 or older" when the profile has no birth year, then stores the confirmation', async () => {
    const user = userEvent.setup()
    let notice = unconfirmed
    const { calls } = mockApi(
      planRoutes(() => notice, {
        'PUT /api/plan-notice': () => {
          notice = {
            ...unconfirmed,
            confirmedVersion: PLAN_NOTICE_VERSION,
            confirmedAt: '2026-11-13T12:00:00.000Z',
            required: false,
          }
          return notice
        },
      }),
    )
    renderWithProviders(<PlanPage />)

    const confirm = await screen.findByRole('button', { name: 'I have read this' })
    expect(confirm).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'I am 18 or older' }))
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(await screen.findByRole('button', { name: 'Generate plan' })).toBeVisible()
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/plan-notice')?.body).toEqual({
      version: PLAN_NOTICE_VERSION,
      ageConfirmed: true,
    })
  })

  test('has no age checkbox when the profile birth year settles the age', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      planRoutes(() => ({ ...unconfirmed, age: 'ok' }), {
        'PUT /api/plan-notice': () => ({ ...unconfirmed, required: false, age: 'ok' }),
      }),
    )
    renderWithProviders(<PlanPage />)

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'I have read this' }))
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ version: PLAN_NOTICE_VERSION })
    })
  })

  test('tells a runner under 18 by the profile that the plan is not for them', async () => {
    mockApi(planRoutes(() => ({ ...unconfirmed, age: 'under' })))
    renderWithProviders(<PlanPage />)

    expect(await screen.findByText(/younger than 18/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'I have read this' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate plan' })).not.toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('turns into the notice when plan generation answers that it is required', async () => {
    const user = userEvent.setup()
    let notice: PlanNoticeView = { ...unconfirmed, required: false }
    mockApi(
      planRoutes(() => notice, {
        'POST /api/plan/generate': () => {
          notice = unconfirmed
          return {
            status: 409,
            body: {
              error: {
                code: 'conflict',
                message: 'Read the health notice before the first plan.',
                details: { code: 'plan-notice-required' },
              },
            },
          }
        },
      }),
    )
    renderWithProviders(<PlanPage />)

    await user.click(await screen.findByRole('button', { name: 'Generate plan' }))
    expect(await screen.findByRole('heading', { name: 'Before your first plan' })).toBeVisible()
  })
})

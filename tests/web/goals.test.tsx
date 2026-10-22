import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { GoalsPage } from '../../web/pages/GoalsPage.tsx'
import type { Goal, UserSettings } from '../../shared/types.ts'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

const miUser: UserSettings = { email: 'runner@example.com', displayName: null, units: 'mi' }
const kmUser: UserSettings = { ...miUser, units: 'km' }

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    userId: 'u1',
    name: 'Spring half',
    priority: 'A',
    status: 'target',
    targetDate: '2027-05-09',
    dateProvisional: false,
    distanceM: 21098,
    location: null,
    successCriteria: null,
    notes: null,
    url: null,
    isActive: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  }
}

function routes(goals: Goal[], user: UserSettings, extra: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/goals': () => goals,
    'GET /api/settings': () => user,
    ...extra,
  }
}

type User = ReturnType<typeof userEvent.setup>

async function openAddSheet(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Add goal' }))
  return screen.findByRole('dialog', { name: 'Add goal' })
}

async function fillBasics(user: User, dialog: HTMLElement, name: string) {
  await user.type(within(dialog).getByLabelText('Name'), name)
  await user.type(within(dialog).getByLabelText('Race date'), '2027-10-17')
}

describe('Goals page', () => {
  test('empty state "No goals yet." with an Add goal action', async () => {
    mockApi(routes([], miUser))
    renderWithProviders(<GoalsPage />)

    expect(await screen.findByText('No goals yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Goals', level: 1 })).toBeInTheDocument()
    const add = screen.getAllByRole('button', { name: 'Add goal' })
    expect(add).toHaveLength(1)

    await userEvent.setup().click(add[0] as HTMLElement)
    expect(await screen.findByRole('dialog', { name: 'Add goal' })).toBeInTheDocument()
  })

  test('creating a goal posts metres: Marathon preset -> distanceM 42195; custom 10 mi -> 16093; km user custom 12 -> 12000; the date is not shifted by timezone', async () => {
    const user = userEvent.setup()
    const mi = mockApi(
      routes([], miUser, { 'POST /api/goals': () => ({ status: 201, body: makeGoal() }) }),
    )
    const first = renderWithProviders(<GoalsPage />)

    let dialog = await openAddSheet(user)
    await fillBasics(user, dialog, 'Autumn marathon')
    await user.click(within(dialog).getByRole('button', { name: 'Marathon' }))
    expect(within(dialog).getByRole('button', { name: 'Marathon' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))

    await waitFor(() => {
      expect(mi.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
    expect(mi.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      name: 'Autumn marathon',
      priority: 'A',
      status: 'target',
      targetDate: '2027-10-17',
      dateProvisional: false,
      distanceM: 42195,
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    dialog = await openAddSheet(user)
    await fillBasics(user, dialog, 'Hill 10')
    await user.type(within(dialog).getByLabelText('Distance (mi)'), '10')
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))
    await waitFor(() => {
      expect(mi.calls.filter((c) => c.method === 'POST')).toHaveLength(2)
    })
    expect(mi.calls.filter((c) => c.method === 'POST')[1]?.body).toMatchObject({
      distanceM: 16093,
    })
    first.unmount()

    const km = mockApi(
      routes([], kmUser, { 'POST /api/goals': () => ({ status: 201, body: makeGoal() }) }),
    )
    renderWithProviders(<GoalsPage />)
    dialog = await openAddSheet(user)
    await fillBasics(user, dialog, 'River 12')
    await user.type(within(dialog).getByLabelText('Distance (km)'), '12')
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))
    await waitFor(() => {
      expect(km.calls.some((c) => c.method === 'POST')).toBe(true)
    })
    expect(km.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      distanceM: 12000,
      targetDate: '2027-10-17',
    })
  })

  test('invalid link shows the server error under Link; Make active posts /activate and only one badge shows; delete asks for confirmation and surfaces a 409 message', async () => {
    const user = userEvent.setup()
    let goals = [
      makeGoal({ id: 'g1', name: 'Spring half', isActive: true }),
      makeGoal({ id: 'g2', name: 'Autumn marathon', priority: 'B', distanceM: 42195 }),
    ]
    const linkMessage = 'Enter a web address starting with http:// or https://'
    const { calls } = mockApi(
      routes([], miUser, {
        'GET /api/goals': () => goals,
        'PUT /api/goals/g1': () => ({
          status: 400,
          body: {
            error: {
              code: 'validation',
              message: 'Request body is invalid.',
              details: { issues: [{ path: 'url', message: linkMessage }] },
            },
          },
        }),
        'POST /api/goals/g2/activate': () => {
          goals = goals.map((g) => ({ ...g, isActive: g.id === 'g2' }))
          return goals[1]
        },
        'DELETE /api/goals/g2': () => ({
          status: 409,
          body: {
            error: {
              code: 'conflict',
              message: 'This goal has an active plan. Archive the plan first.',
            },
          },
        }),
      }),
    )
    renderWithProviders(<GoalsPage />)

    expect(await screen.findAllByText('Active goal')).toHaveLength(1)
    expect(
      within(screen.getByRole('article', { name: 'Spring half' })).getByText(/Sun 9 May 2027/),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Make active' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Edit Spring half' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' })
    await user.type(within(dialog).getByLabelText('Link'), 'javascript:alert(1)')
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))
    expect(await within(dialog).findByText(linkMessage)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Link')).toHaveAttribute('aria-invalid', 'true')
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    await user.click(screen.getByRole('button', { name: 'Make active' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/goals/g2/activate')).toBe(
        true,
      )
    })
    await waitFor(() => {
      expect(
        within(screen.getByRole('article', { name: 'Autumn marathon' })).getByText('Active goal'),
      ).toBeInTheDocument()
    })
    expect(screen.getAllByText('Active goal')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Delete Autumn marathon' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByText('Delete Autumn marathon?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete goal' }))
    expect(
      await screen.findByText('This goal has an active plan. Archive the plan first.'),
    ).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
  })
})

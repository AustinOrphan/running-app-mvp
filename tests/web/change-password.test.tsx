import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import { App } from '../../web/App.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { SettingsPage } from '../../web/pages/SettingsPage.tsx'
import { activityPage, expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'
import { makeToday } from './today-fixtures.ts'

const session = {
  id: 'u1',
  email: 'runner@example.com',
  displayName: null,
  units: 'mi' as const,
  weightUnit: 'lb' as const,
  showBodyWeight: false,
  hideMapEnds: true,
  mustChangePassword: false,
}
const settings = { ...session, id: undefined, mustChangePassword: undefined }

function validation(path: string, message: string) {
  return {
    status: 400,
    body: {
      error: {
        code: 'validation',
        message: 'Some fields need attention.',
        details: { issues: [{ path, message }] },
      },
    },
  }
}

async function fill(typist: ReturnType<typeof userEvent.setup>, current: string, next: string) {
  await typist.type(screen.getByLabelText('Current password'), current)
  await typist.type(screen.getByLabelText('New password'), next)
  await typist.type(screen.getByLabelText('Confirm new password'), next)
  await typist.click(screen.getByRole('button', { name: 'Change password' }))
}

describe('the Password block of Settings', () => {
  function renderSettings(onPut: (body: unknown) => unknown) {
    const mock = mockApi({
      'GET /api/settings': () => settings,
      'PUT /api/auth/password': ({ body }) => onPut(body),
    })
    const view = renderWithProviders(
      <ToastProvider>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </ToastProvider>,
      { route: '/settings' },
    )
    return { ...mock, ...view }
  }

  test('has the three fields, the rules and a show and hide toggle', async () => {
    const { container } = renderSettings(() => session)
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    expect(screen.getByRole('heading', { level: 2, name: 'Password' })).toBeInTheDocument()
    expect(screen.getByLabelText('Current password')).toHaveAttribute('type', 'password')
    const next = screen.getByLabelText('New password')
    expect(next).toHaveAccessibleDescription(/at least 12 characters \(72 bytes at most\)/)
    await typist.click(screen.getByRole('button', { name: 'Show passwords' }))
    expect(next).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('type', 'text')
    await typist.click(screen.getByRole('button', { name: 'Hide passwords' }))
    expect(next).toHaveAttribute('type', 'password')
    expectCleanCopy(container)
  })

  test('a confirmation that differs sends nothing', async () => {
    const { calls } = renderSettings(() => session)
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await typist.type(screen.getByLabelText('Current password'), 'the current one here')
    await typist.type(screen.getByLabelText('New password'), 'a brand new passphrase')
    await typist.type(screen.getByLabelText('Confirm new password'), 'something else entirely')
    await typist.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('The two new passwords do not match.')).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([])
  })

  test('success sends both passwords, clears the fields and says other devices are signed out', async () => {
    const { calls, container } = renderSettings(() => session)
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await fill(typist, 'the current one here', 'a brand new passphrase')

    expect(
      await screen.findByText('Password changed. Other devices are signed out.'),
    ).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
      { currentPassword: 'the current one here', newPassword: 'a brand new passphrase' },
    ])
    expect(screen.getByLabelText('Current password')).toHaveValue('')
    expect(screen.getByLabelText('New password')).toHaveValue('')
    expectCleanCopy(container)
  })

  test('the server message for the current password shows under that field', async () => {
    renderSettings(() => validation('currentPassword', 'That is not the current password.'))
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await fill(typist, 'wrong wrong wrong', 'a brand new passphrase')

    expect(await screen.findByText('That is not the current password.')).toBeInTheDocument()
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true')
  })

  test('a refusal from the limiter is worded as a wait', async () => {
    renderSettings(() => ({
      status: 429,
      body: { error: { code: 'unauthorized', message: 'Too many attempts.' } },
    }))
    const typist = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })

    await fill(typist, 'the current one here', 'a brand new passphrase')

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again')
  })
})

describe('the screen that follows a first sign-in', () => {
  function renderApp(mustChangePassword: boolean) {
    let flagged = mustChangePassword
    const mock = mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => ({ ...session, mustChangePassword: flagged }),
      'PUT /api/auth/password': () => {
        flagged = false
        return { ...session, mustChangePassword: false }
      },
      'GET /api/goals': () => [],
      'GET /api/plan': () => null,
      'GET /api/weeks': () => [],
      'GET /api/reviews': () => [],
      'GET /api/activities': () => activityPage([]),
      'GET /api/today': () => makeToday(),
      'GET /api/settings': () => settings,
    })
    return { ...mock, ...renderWithProviders(<App />) }
  }

  test('asks for a new password before anything else, then lets the app through', async () => {
    const { container } = renderApp(true)
    const typist = userEvent.setup()

    expect(await screen.findByRole('heading', { name: 'Choose your password' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument()
    expectCleanCopy(container)

    await fill(typist, 'the temporary one', 'a brand new passphrase')

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Choose your password' })).not.toBeInTheDocument()
  })

  test('is not shown to an account without the flag', async () => {
    renderApp(false)
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Choose your password' })).not.toBeInTheDocument()
  })
})

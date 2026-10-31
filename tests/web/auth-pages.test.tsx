import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { LoginPage } from '../../web/pages/LoginPage.tsx'
import { SettingsPage } from '../../web/pages/SettingsPage.tsx'
import { SetupPage } from '../../web/pages/SetupPage.tsx'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

const user = { id: 'u1', email: 'runner@example.com', displayName: null, units: 'mi' as const }

function Pages() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<p>Home page</p>} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </ToastProvider>
  )
}

describe('SetupPage', () => {
  test('setup: mismatched confirmation shows "Passwords do not match" and posts nothing', async () => {
    const { calls } = mockApi({ 'GET /api/setup': () => ({ needsSetup: true }) })
    const { container } = renderWithProviders(<Pages />, { route: '/setup' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Set up your training log' })
    await typist.type(screen.getByLabelText('Email'), 'runner@example.com')
    await typist.type(screen.getByLabelText('Password'), 'a-long-enough-pass')
    await typist.type(screen.getByLabelText('Confirm password'), 'a-different-pass')
    await typist.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expectCleanCopy(container)
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  test('setup: an 11-character password shows the server message under Password; success navigates to /', async () => {
    let attempts = 0
    const { calls } = mockApi({
      'GET /api/setup': () => ({ needsSetup: true }),
      'POST /api/setup': () => {
        attempts += 1
        if (attempts === 1) {
          return {
            status: 400,
            body: {
              error: {
                code: 'validation',
                message: 'Some fields need attention.',
                details: {
                  issues: [{ path: 'password', message: 'Use at least 12 characters.' }],
                },
              },
            },
          }
        }
        return { status: 201, body: user }
      },
    })
    renderWithProviders(<Pages />, { route: '/setup' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Set up your training log' })
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAccessibleDescription('At least 12 characters.')

    await typist.type(screen.getByLabelText('Email'), 'runner@example.com')
    await typist.type(screen.getByLabelText('Display name (optional)'), 'Sam')
    await typist.type(password, 'elevenchars')
    await typist.type(screen.getByLabelText('Confirm password'), 'elevenchars')
    await typist.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(password).toHaveAccessibleDescription('Use at least 12 characters.')
    })
    expect(screen.queryByText('At least 12 characters.')).not.toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      email: 'runner@example.com',
      password: 'elevenchars',
      displayName: 'Sam',
    })

    await typist.type(password, 'x')
    await typist.type(screen.getByLabelText('Confirm password'), 'x')
    await typist.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Home page')).toBeInTheDocument()
  })

  test('setup is not reachable once an account exists: needsSetup false redirects to /login', async () => {
    mockApi({ 'GET /api/setup': () => ({ needsSetup: false }) })
    renderWithProviders(<Pages />, { route: '/setup' })
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  test('the show/hide toggle reveals both password fields', async () => {
    mockApi({ 'GET /api/setup': () => ({ needsSetup: true }) })
    renderWithProviders(<Pages />, { route: '/setup' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Set up your training log' })
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    await typist.click(screen.getByRole('button', { name: 'Show passwords' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text')
    await typist.click(screen.getByRole('button', { name: 'Hide passwords' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })
})

describe('LoginPage', () => {
  function tooManyAttempts(retryAfterSec: number) {
    return {
      status: 429,
      body: {
        error: {
          code: 'unauthorized',
          message: 'Too many sign-in attempts. Try again later.',
          details: { retryAfterSec },
        },
      },
    }
  }

  test('login: 401 shows "Invalid email or password" without clearing the email; 429 shows "Too many attempts. Try again in 15 minutes." from details.retryAfterSec; success lands on /', async () => {
    let attempts = 0
    mockApi({
      'POST /api/auth/login': () => {
        attempts += 1
        if (attempts === 1) {
          return {
            status: 401,
            body: { error: { code: 'unauthorized', message: 'Invalid email or password' } },
          }
        }
        if (attempts === 2) return tooManyAttempts(900)
        return user
      },
    })
    renderWithProviders(<Pages />, { route: '/login' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Sign in' })
    await typist.type(screen.getByLabelText('Email'), 'runner@example.com')
    await typist.type(screen.getByLabelText('Password'), 'wrong-password-here')
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('runner@example.com')

    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(
      await screen.findByText('Too many attempts. Try again in 15 minutes.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Invalid email or password')).not.toBeInTheDocument()
    expectCleanCopy(document.body)

    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Home page')).toBeInTheDocument()
  })

  test('login: any other answer says the sign-in did not work, and the form reads cleanly', async () => {
    mockApi({
      'POST /api/auth/login': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Something went wrong.' } },
      }),
    })
    const { container } = renderWithProviders(<Pages />, { route: '/login' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Sign in' })
    expectCleanCopy(container)
    await typist.type(screen.getByLabelText('Email'), 'runner@example.com')
    await typist.type(screen.getByLabelText('Password'), 'wrong-password-here')
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in did not work. Check the details and try again.',
    )
    expectCleanCopy(container)
  })

  test('login: a retry time under a minute rounds up to one minute', async () => {
    mockApi({ 'POST /api/auth/login': () => tooManyAttempts(20) })
    renderWithProviders(<Pages />, { route: '/login' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Sign in' })
    await typist.type(screen.getByLabelText('Email'), 'runner@example.com')
    await typist.type(screen.getByLabelText('Password'), 'wrong-password-here')
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Too many attempts. Try again in 1 minute.')).toBeInTheDocument()
  })
})

describe('SettingsPage', () => {
  function settingsRoutes(onPut: (body: unknown) => unknown) {
    return {
      'GET /api/settings': () => ({ email: user.email, displayName: null, units: 'mi' }),
      'PUT /api/settings': ({ body }: { body: unknown }) => onPut(body),
      'GET /api/auth/me': () => user,
    }
  }

  test('settings: switching to Kilometres PUTs { units: "km" } and toasts "Settings saved"; display name over 80 characters shows the error', async () => {
    const { calls } = mockApi(
      settingsRoutes((body) => {
        const patch = body as { units?: string; displayName?: string }
        if (patch.displayName !== undefined && patch.displayName.length > 80) {
          return {
            status: 400,
            body: {
              error: {
                code: 'validation',
                message: 'Some fields need attention.',
                details: {
                  issues: [{ path: 'displayName', message: 'Use at most 80 characters.' }],
                },
              },
            },
          }
        }
        return { email: user.email, displayName: null, units: patch.units ?? 'mi' }
      }),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.getByRole('radiogroup', { name: 'Distance units' })).toBeInTheDocument()
    await typist.click(screen.getByRole('radio', { name: 'Kilometres' }))

    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([{ units: 'km' }])
    expect(screen.getByRole('radio', { name: 'Kilometres' })).toBeChecked()

    await typist.click(screen.getByLabelText('Display name'))
    await typist.paste('x'.repeat(81))
    await typist.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Use at most 80 characters.')).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toHaveValue('x'.repeat(81))
  })

  test('settings: a failed units change reverts the control and shows the error', async () => {
    mockApi(
      settingsRoutes(() => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Something went wrong.' } },
      })),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    await typist.click(screen.getByRole('radio', { name: 'Kilometres' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Settings not saved.')
    expect(screen.getByRole('radio', { name: 'Miles' })).toBeChecked()
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('settings: saving a display name sends only the changed field', async () => {
    const { calls } = mockApi(
      settingsRoutes((body) => ({ email: user.email, units: 'mi', ...(body as object) })),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    await typist.type(screen.getByLabelText('Display name'), '  Sam ')
    await typist.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
      { displayName: 'Sam' },
    ])
  })

  test('settings: Weight units sits beside Distance units, reads pounds by default, and saves the choice by itself', async () => {
    const { calls } = mockApi({
      ...settingsRoutes((body) => ({
        email: user.email,
        displayName: null,
        units: 'mi',
        weightUnit: 'lb',
        ...(body as object),
      })),
    })
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    // an answer kept from before the unit existed has none: it reads as pounds, the default
    expect(screen.getByRole('radiogroup', { name: 'Weight units' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Pounds' })).toBeChecked()
    expect(
      screen
        .getAllByRole('radiogroup')
        .slice(0, 2)
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Distance units', 'Weight units'])

    await typist.click(screen.getByRole('radio', { name: 'Kilograms' }))
    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
      { weightUnit: 'kg' },
    ])
    expect(screen.getByRole('radio', { name: 'Kilograms' })).toBeChecked()
    // the distance unit is the one the server had, untouched
    expect(screen.getByRole('radio', { name: 'Miles' })).toBeChecked()

    // choosing the unit that is already chosen sends nothing
    await typist.click(screen.getByRole('radio', { name: 'Kilograms' }))
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    expectCleanCopy(document.body)
  })

  test('settings: a runner who chose kilograms sees them chosen, and a failed change puts them back', async () => {
    mockApi({
      'GET /api/settings': () => ({
        email: user.email,
        displayName: null,
        units: 'km',
        weightUnit: 'kg',
      }),
      'PUT /api/settings': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Something went wrong.' } },
      }),
      'GET /api/auth/me': () => user,
    })
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.getByRole('radio', { name: 'Kilograms' })).toBeChecked()
    await typist.click(screen.getByRole('radio', { name: 'Pounds' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Settings not saved.')
    expect(screen.getByRole('radio', { name: 'Kilograms' })).toBeChecked()
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument()
  })

  test('settings: Sign out posts /api/auth/logout and returns to /login', async () => {
    const { calls } = mockApi({
      ...settingsRoutes(() => ({})),
      'POST /api/auth/logout': () => ({ status: 204, body: undefined }),
    })
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    await typist.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/auth/logout')).toBe(true)
  })

  test('settings with an empty display name renders without "null" or "undefined"', async () => {
    mockApi(settingsRoutes(() => ({})))
    const { container } = renderWithProviders(<Pages />, { route: '/settings' })

    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.getByLabelText('Display name')).toHaveValue('')
    expect(container.textContent).not.toMatch(/null|undefined/)
    expect(screen.getByRole('link', { name: 'Export activities' })).toHaveAttribute(
      'href',
      '/api/activities/export.csv',
    )
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    expectCleanCopy(container)
  })
})

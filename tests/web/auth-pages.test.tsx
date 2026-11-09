import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { getOutbox, resetOutboxForTests } from '../../web/pwa/outbox.ts'
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

    await screen.findByRole('heading', { name: 'Set up your log' })
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

    await screen.findByRole('heading', { name: 'Set up your log' })
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

    await screen.findByRole('heading', { name: 'Set up your log' })
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
    // the refusal is announced and sits under the password, so no field moves when it appears
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Invalid email or password')
    expect(
      screen.getByLabelText('Password').compareDocumentPosition(alert) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByText('Running log')).toBeInTheDocument()

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

  test('settings: switching to Kilometres PUTs { units: "km" } and shows "Saved"; display name over 80 characters shows the error and keeps the text', async () => {
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

    expect(await screen.findByText('Saved', { selector: 'span' })).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([{ units: 'km' }])
    expect(screen.getByRole('radio', { name: 'Kilometres' })).toBeChecked()

    await typist.click(screen.getByLabelText('Display name'))
    await typist.paste('x'.repeat(81))
    await typist.tab()
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

    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved.')
    expect(screen.getByRole('radio', { name: 'Miles' })).toBeChecked()
    expect(screen.queryByText('Saved', { selector: 'span' })).not.toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('settings: the Trends section has one switch, off by default, that saves by itself and says hiding deletes nothing', async () => {
    const { calls } = mockApi(
      settingsRoutes((body) => ({
        email: user.email,
        displayName: null,
        units: 'mi',
        weightUnit: 'lb',
        showBodyWeight: false,
        hideMapEnds: true,
        ...(body as object),
      })),
    )
    const { container } = renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.getByRole('heading', { level: 2, name: 'Trends' })).toBeInTheDocument()
    const box = screen.getByRole('checkbox', { name: 'Show body weight on Trends' })
    expect(box).not.toBeChecked()
    expect(box).toHaveAccessibleDescription(
      'Hiding the chart deletes nothing. Every weigh-in stays.',
    )

    await typist.click(box)
    expect(await screen.findByText('Saved', { selector: 'span' })).toBeInTheDocument()
    expect(box).toBeChecked()
    await typist.click(box)
    await waitFor(() => {
      expect(box).not.toBeChecked()
    })
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
      { showBodyWeight: true },
      { showBodyWeight: false },
    ])
    expectCleanCopy(container)
  })

  test('settings: the display name saves on leaving the field, sends only that field and has no Save button', async () => {
    const { calls } = mockApi(
      settingsRoutes((body) => ({ email: user.email, units: 'mi', ...(body as object) })),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    await typist.type(screen.getByLabelText('Display name'), '  Sam ')
    await typist.tab()

    expect(await screen.findByText('Saved', { selector: 'span' })).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
      { displayName: 'Sam' },
    ])
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument()
  })

  test('settings: the display name saves after a pause, and "Saved" is a polite status', async () => {
    const { calls } = mockApi(
      settingsRoutes((body) => ({ email: user.email, units: 'mi', ...(body as object) })),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    const status = screen.getByRole('status', { name: 'Save status' })
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toBeEmptyDOMElement()
    await typist.type(screen.getByLabelText('Display name'), 'Sam')
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
        { displayName: 'Sam' },
      ])
    })
    expect(await within(status).findByText('Saved')).toBeInTheDocument()
  })

  test('settings: changing the theme shows the same "Saved"', async () => {
    mockApi(settingsRoutes((body) => ({ email: user.email, units: 'mi', ...(body as object) })))
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    await typist.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(
      await within(screen.getByRole('status', { name: 'Save status' })).findByText('Saved'),
    ).toBeInTheDocument()
  })

  test('settings: Appearance offers no Illustrations switch', async () => {
    mockApi(settingsRoutes((body) => ({ email: user.email, units: 'mi', ...(body as object) })))
    renderWithProviders(<Pages />, { route: '/settings' })

    await screen.findByRole('heading', { name: 'Settings' })
    const appearance = within(screen.getByRole('region', { name: 'Appearance' }))
    expect(appearance.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    expect(appearance.queryByRole('checkbox', { name: 'Illustrations' })).toBeNull()
  })

  test('settings: Condensed figures sits under Appearance, is off by default and saves on this device only', async () => {
    localStorage.removeItem('rl_condensed_figures')
    const mock = mockApi(
      settingsRoutes((body) => ({ email: user.email, units: 'mi', ...(body as object) })),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    const appearance = within(screen.getByRole('region', { name: 'Appearance' }))
    const box = appearance.getByRole('checkbox', { name: 'Condensed figures' })
    expect(box).not.toBeChecked()
    expect(box).toHaveAccessibleDescription('Narrower, bolder numbers. This device only.')

    await typist.click(box)
    expect(box).toBeChecked()
    expect(localStorage.getItem('rl_condensed_figures')).toBe('on')
    expect(mock.calls.some((call) => call.method === 'PUT')).toBe(false)

    await typist.click(box)
    expect(localStorage.getItem('rl_condensed_figures')).toBe('off')
    localStorage.removeItem('rl_condensed_figures')
  })

  test('settings: a refused display name keeps what was typed and says so beside the field', async () => {
    mockApi(
      settingsRoutes(() => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Something went wrong.' } },
      })),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    await typist.type(screen.getByLabelText('Display name'), 'Sam')
    await typist.tab()
    expect(await screen.findByText(/^Not saved\. The name stays in the field/)).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toHaveValue('Sam')
    // the refusal is announced, not only drawn beside the field
    expect(await screen.findByRole('alert')).toHaveTextContent('Display name not saved.')
    expectCleanCopy(document.body)
  })

  test('settings: a refused name stays on screen while another setting saves', async () => {
    mockApi(
      settingsRoutes((body) => {
        if ((body as { displayName?: string }).displayName !== undefined) {
          return { status: 500, body: { error: { code: 'internal', message: 'Boom' } } }
        }
        return { email: user.email, displayName: null, units: 'km', ...(body as object) }
      }),
    )
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    await typist.type(screen.getByLabelText('Display name'), 'Sam')
    await typist.tab()
    expect(await screen.findByText(/^Not saved\. The name stays/)).toBeInTheDocument()
    await typist.click(screen.getByRole('radio', { name: 'Kilometres' }))
    expect(
      await within(screen.getByRole('status', { name: 'Save status' })).findByText('Saved'),
    ).toBeInTheDocument()
    // the units save is not the name's: its error is still there
    expect(screen.getAllByText(/^Not saved\. The name stays/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Display name')).toHaveValue('Sam')
  })

  test('settings: a save that fails after a newer one rolls back its own field and not the shared Saved', async () => {
    const { calls } = mockApi(
      settingsRoutes((body) => {
        const patch = body as { units?: string; displayName?: string }
        if (patch.units !== undefined) {
          return { status: 500, body: { error: { code: 'internal', message: 'Boom' } } }
        }
        return { email: user.email, displayName: patch.displayName ?? null, units: 'mi' }
      }),
    )
    // the units save (the first PUT) answers last
    const answer = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const slow =
        init?.method === 'PUT' && typeof init.body === 'string' && init.body.includes('"units"')
      const response = await answer(input, init)
      if (slow) await new Promise((resolve) => setTimeout(resolve, 250))
      return response
    })
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    await typist.click(screen.getByRole('radio', { name: 'Kilometres' }))
    await typist.type(screen.getByLabelText('Display name'), 'Sam')
    await typist.tab()
    expect(
      await within(screen.getByRole('status', { name: 'Save status' })).findByText('Saved'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2)
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    // the older save failed after the newer one succeeded: its own field is rolled back to what the
    // server holds, the name stays as saved, and Saved (the newer save's) is still showing
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Miles' })).toBeChecked()
    })
    expect(screen.getByRole('radio', { name: 'Kilometres' })).not.toBeChecked()
    expect(screen.getByLabelText('Display name')).toHaveValue('Sam')
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved.')
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved')
  })

  test('settings: leaving the page with a name not yet saved sends it', async () => {
    const { calls } = mockApi(
      settingsRoutes((body) => ({ email: user.email, units: 'mi', ...(body as object) })),
    )
    const view = renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    await typist.type(screen.getByLabelText('Display name'), 'Sam')
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
    view.unmount()
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
        { displayName: 'Sam' },
      ])
    })
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
        .map(
          (group) =>
            group.getAttribute('aria-label') ??
            document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent,
        ),
    ).toEqual(['Distance units', 'Weight units'])

    await typist.click(screen.getByRole('radio', { name: 'Kilograms' }))
    expect(await screen.findByText('Saved', { selector: 'span' })).toBeInTheDocument()
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

    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved.')
    expect(screen.getByRole('radio', { name: 'Kilograms' })).toBeChecked()
    expect(screen.queryByText('Saved', { selector: 'span' })).not.toBeInTheDocument()
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

  test('settings: Sign out with a run waiting names it first and can be cancelled', async () => {
    resetOutboxForTests()
    const { calls } = mockApi({
      ...settingsRoutes(() => ({})),
      'PUT /api/activities/done/0b6f3c1e-8d4a-4f6b-9a31-5c0e2d7b6a10': () => ({
        status: 503,
        body: { error: { code: 'internal', message: 'Offline.' } },
      }),
      'POST /api/auth/logout': () => ({ status: 204, body: undefined }),
    })
    await getOutbox().save('/api/activities/done/0b6f3c1e-8d4a-4f6b-9a31-5c0e2d7b6a10', {
      date: '2026-03-18',
      type: 'run',
      durationSec: 1800,
    })
    renderWithProviders(<Pages />, { route: '/settings' })
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    await typist.click(screen.getByRole('button', { name: 'Sign out' }))
    const warning = await screen.findByRole('alert')
    expect(warning).toHaveTextContent('Not yet sent from this phone: 1 run. Signing out clears it.')
    expect(warning).toHaveFocus()
    expect(calls.some((c) => c.url === '/api/auth/logout')).toBe(false)

    await typist.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveFocus()
    expect(getOutbox().getState().entries).toHaveLength(1)

    await typist.click(screen.getByRole('button', { name: 'Sign out' }))
    await typist.click(await screen.findByRole('button', { name: 'Sign out anyway' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(getOutbox().getState().entries).toEqual([])
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

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CalendarTokenIssued, IntegrationStatus, WristStatus } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { WristSettings } from '../../web/components/WristSettings.tsx'
import { IntegrationsPage } from '../../web/pages/IntegrationsPage.tsx'
import {
  delayResponses,
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import { makeStateView } from './state-fixtures.ts'
import { makeWristItem, makeWristStatus, refocus, sendingOn } from './wrist-fixtures.ts'

// The publishing settings on the intervals.icu card, its disconnect choice and the Calendar link
// section (design 6.7), against a status the test owns.

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

/**
 * Chromium moves focus to the page when the focused control becomes disabled, and jsdom does not.
 * This stands in for it, so a test fails when a control the runner is operating is disabled while
 * its request runs. (jsdom's `blur()` ignores a disabled element, so the attribute is lifted while
 * focus moves.)
 */
let stopDisabledBlur: (() => void) | null = null
function blurWhenDisabled(): void {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target
      if (
        target instanceof HTMLElement &&
        target.hasAttribute('disabled') &&
        document.activeElement === target
      ) {
        target.removeAttribute('disabled')
        target.blur()
        target.setAttribute('disabled', '')
      }
    }
  })
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled'],
  })
  stopDisabledBlur = () => {
    observer.disconnect()
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2027, 0, 13, 12, 0, 0))
  setOnline(true)
  window.localStorage.clear()
  window.sessionStorage.clear()
  blurWhenDisabled()
})

afterEach(() => {
  stopDisabledBlur?.()
  stopDisabledBlur = null
  vi.useRealTimers()
})

const SENT = [makeWristItem({ status: 'sent' })]
const LAST_RUN = new Date(2027, 0, 13, 11, 0).toISOString()

/** A status the PUT and POST routes below move, as the server's own answer would. */
function stateful(initial: WristStatus, extra: MockRoutes = {}) {
  let status = initial
  const api = mockApi({
    'GET /api/wrist/status': () => status,
    'PUT /api/wrist/intervals': (req) => {
      const body = req.body as { enabled: boolean; garminLinked: boolean }
      status = {
        ...status,
        settings: { ...status.settings, enabled: body.enabled, garminLinked: body.garminLinked },
      }
      return status.settings
    },
    'POST /api/wrist/publish': () => status.settings,
    ...extra,
  })
  return { ...api, get: () => status, set: (next: WristStatus) => (status = next) }
}

const REMOVE_FAILED = {
  status: 409,
  body: {
    error: {
      code: 'conflict',
      message:
        'The sessions already sent could not be removed from intervals.icu, so it stays connected. Try again, or disconnect without removing them.',
      details: { code: 'remove-failed' },
    },
  },
}

describe('the publishing settings', () => {
  test('start with both boxes off, the dependency named and the dormant-account note', async () => {
    stateful(makeWristStatus())
    renderWithProviders(<WristSettings />)
    const group = await screen.findByRole('group', { name: 'Send sessions to your watch' })
    expect(
      within(group).getByRole('checkbox', {
        name: 'Send my next 14 days of runs to intervals.icu',
      }),
    ).not.toBeChecked()
    const garmin = within(group).getByRole('checkbox', {
      name: 'intervals.icu uploads planned workouts to my Garmin Connect',
    })
    expect(garmin).not.toBeChecked()
    expect(garmin).toHaveAccessibleDescription(
      'In intervals.icu open Settings, Garmin Connect, and switch on uploading planned workouts. The app cannot check this.',
    )
    expect(
      within(group).getByText(
        'intervals.icu closes accounts that are not logged in to for a long time. Log in now and then so the plan keeps reaching your watch.',
      ),
    ).toBeInTheDocument()
    // nothing to send while sending is off
    expect(within(group).queryByRole('button', { name: 'Send now' })).not.toBeInTheDocument()
    expectCleanCopy(group)
  })

  test('turning sending on and ticking the Garmin upload each send both choices', async () => {
    const user = userEvent.setup()
    const { calls } = stateful(makeWristStatus())
    renderWithProviders(<WristSettings />)

    await user.click(
      await screen.findByRole('checkbox', {
        name: 'Send my next 14 days of runs to intervals.icu',
      }),
    )
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        enabled: true,
        garminLinked: false,
      })
    })
    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', { name: 'Send my next 14 days of runs to intervals.icu' }),
      ).toBeChecked()
    })

    await user.click(
      screen.getByRole('checkbox', {
        name: 'intervals.icu uploads planned workouts to my Garmin Connect',
      }),
    )
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({
        enabled: true,
        garminLinked: true,
      })
    })
  })

  test('say when the last send was, and offer Send now while sending is on', async () => {
    const user = userEvent.setup()
    const { calls } = stateful(
      sendingOn(SENT, {
        settings: { enabled: true, garminLinked: true, lastRunAt: LAST_RUN, running: false },
      }),
    )
    renderWithProviders(<WristSettings />)
    expect(
      await screen.findByText('Last send to intervals.icu: 13 Jan at 11:00.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send now' }))
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        url: '/api/wrist/publish',
        body: {},
      })
    })
  })

  test('say nothing was sent yet, and that a send is running, with Send now off meanwhile', async () => {
    const status = sendingOn([], {
      settings: { enabled: true, garminLinked: false, lastRunAt: null, running: false },
    })
    const view = stateful(status)
    renderWithProviders(<WristSettings />)
    expect(await screen.findByText('Nothing has been sent to intervals.icu yet.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send now' })).toBeEnabled()
    view.set({ ...status, settings: { ...status.settings, running: true } })
    // the status is read again when the window regains focus
    await refocus()
    expect(await screen.findByText('Sending to intervals.icu now.')).toBeVisible()
    // Busy, not disabled: a button that was just pressed keeps focus (see the focus tests below).
    const sendNow = screen.getByRole('button', { name: 'Send now' })
    expect(sendNow).toHaveAttribute('aria-disabled', 'true')
    await userEvent.setup().click(sendNow)
    expect(view.calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  describe('turning sending off', () => {
    const on = () => sendingOn(SENT)

    test('offers to remove what was sent, and leaves it in place unless asked', async () => {
      const user = userEvent.setup()
      const { calls } = stateful(on())
      renderWithProviders(<WristSettings />)
      await user.click(
        await screen.findByRole('checkbox', {
          name: 'Send my next 14 days of runs to intervals.icu',
        }),
      )
      // nothing is sent to the server until the runner decides
      expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
      const offer = screen.getByRole('group', {
        name: 'New sessions stop going out. Those already in intervals.icu stay there unless they are removed too.',
      })
      const remove = within(offer).getByRole('checkbox', {
        name: 'Also remove the sessions already sent',
      })
      expect(remove).not.toBeChecked()
      await user.click(within(offer).getByRole('button', { name: 'Turn off sending' }))
      await waitFor(() => {
        expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
          enabled: false,
          garminLinked: true,
          removeSent: false,
        })
      })
      await waitFor(() => {
        expect(screen.queryByRole('group', { name: /New sessions stop/ })).not.toBeInTheDocument()
      })
    })

    test('removes what was sent when the box is ticked', async () => {
      const user = userEvent.setup()
      const { calls } = stateful(on())
      renderWithProviders(<WristSettings />)
      await user.click(
        await screen.findByRole('checkbox', {
          name: 'Send my next 14 days of runs to intervals.icu',
        }),
      )
      await user.click(
        screen.getByRole('checkbox', { name: 'Also remove the sessions already sent' }),
      )
      await user.click(screen.getByRole('button', { name: 'Turn off sending' }))
      await waitFor(() => {
        expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
          enabled: false,
          garminLinked: true,
          removeSent: true,
        })
      })
    })

    test('keeps sending when the offer is declined', async () => {
      const user = userEvent.setup()
      const { calls } = stateful(on())
      renderWithProviders(<WristSettings />)
      await user.click(
        await screen.findByRole('checkbox', {
          name: 'Send my next 14 days of runs to intervals.icu',
        }),
      )
      await user.click(screen.getByRole('button', { name: 'Keep sending' }))
      expect(screen.queryByRole('button', { name: 'Turn off sending' })).not.toBeInTheDocument()
      expect(
        screen.getByRole('checkbox', { name: 'Send my next 14 days of runs to intervals.icu' }),
      ).toBeChecked()
      expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
    })

    test('turns off at once when intervals.icu holds nothing the app sent', async () => {
      const user = userEvent.setup()
      const { calls } = stateful(sendingOn([makeWristItem({ status: 'waiting' })]))
      renderWithProviders(<WristSettings />)
      await user.click(
        await screen.findByRole('checkbox', {
          name: 'Send my next 14 days of runs to intervals.icu',
        }),
      )
      await waitFor(() => {
        expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
          enabled: false,
          garminLinked: true,
        })
      })
      expect(screen.queryByRole('button', { name: 'Turn off sending' })).not.toBeInTheDocument()
    })

    test('says so when the removal failed, keeps sending on and keeps the offer open', async () => {
      const user = userEvent.setup()
      stateful(on(), { 'PUT /api/wrist/intervals': () => REMOVE_FAILED })
      renderWithProviders(<WristSettings />)
      await user.click(
        await screen.findByRole('checkbox', {
          name: 'Send my next 14 days of runs to intervals.icu',
        }),
      )
      await user.click(
        screen.getByRole('checkbox', { name: 'Also remove the sessions already sent' }),
      )
      await user.click(screen.getByRole('button', { name: 'Turn off sending' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The sessions already sent could not be removed from intervals.icu, so it stays connected.',
      )
      // untick the removal and try again
      expect(screen.getByRole('button', { name: 'Turn off sending' })).toBeEnabled()
      expect(
        screen.getByRole('checkbox', { name: 'Send my next 14 days of runs to intervals.icu' }),
      ).toBeChecked()
    })
  })

  describe('focus', () => {
    const SEND = 'Send my next 14 days of runs to intervals.icu'
    const GARMIN = 'intervals.icu uploads planned workouts to my Garmin Connect'

    test.each([
      ['the send box', SEND, { enabled: true, garminLinked: false }],
      ['the Garmin box', GARMIN, { enabled: false, garminLinked: true }],
    ])('%s keeps focus while it saves, and ignores a second press', async (_n, name, body) => {
      const user = userEvent.setup()
      const { calls } = stateful(makeWristStatus())
      delayResponses(60)
      renderWithProviders(<WristSettings />)
      const box = await screen.findByRole('checkbox', { name })
      await user.click(box)
      // saving: the box is marked, not disabled, so focus stays where the runner put it
      await waitFor(() => {
        expect(box).toHaveAttribute('aria-disabled', 'true')
      })
      expect(box).not.toBeDisabled()
      expect(box).toHaveFocus()
      await user.keyboard(' ')
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
      await waitFor(() => {
        expect(box).not.toHaveAttribute('aria-disabled')
      })
      expect(box).toHaveFocus()
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual(body)
      // the box shows what the server kept, not the second press
      expect(box).toBeChecked()
    })

    test('the offer opens on its own box, and Keep sending gives focus back to the send box', async () => {
      const user = userEvent.setup()
      stateful(sendingOn(SENT))
      renderWithProviders(<WristSettings />)
      const send = await screen.findByRole('checkbox', { name: SEND })
      await user.click(send)
      const offer = screen.getByRole('group', { name: /New sessions stop/ })
      expect(
        within(offer).getByRole('checkbox', { name: 'Also remove the sessions already sent' }),
      ).toHaveFocus()
      await user.click(within(offer).getByRole('button', { name: 'Keep sending' }))
      expect(screen.queryByRole('group', { name: /New sessions stop/ })).not.toBeInTheDocument()
      expect(send).toHaveFocus()
    })

    test('turning sending off keeps focus on the button, then gives it to the send box', async () => {
      const user = userEvent.setup()
      stateful(sendingOn(SENT))
      delayResponses(60)
      renderWithProviders(<WristSettings />)
      const send = await screen.findByRole('checkbox', { name: SEND })
      await user.click(send)
      const turnOff = screen.getByRole('button', { name: 'Turn off sending' })
      await user.click(turnOff)
      await waitFor(() => {
        expect(turnOff).toHaveAttribute('aria-disabled', 'true')
      })
      expect(turnOff).not.toBeDisabled()
      expect(turnOff).toHaveFocus()
      await waitFor(() => {
        expect(screen.queryByRole('group', { name: /New sessions stop/ })).not.toBeInTheDocument()
      })
      expect(send).not.toBeChecked()
      expect(send).toHaveFocus()
    })

    test('a refused removal leaves focus on the button that was pressed', async () => {
      const user = userEvent.setup()
      stateful(sendingOn(SENT), { 'PUT /api/wrist/intervals': () => REMOVE_FAILED })
      delayResponses(60)
      renderWithProviders(<WristSettings />)
      await user.click(await screen.findByRole('checkbox', { name: SEND }))
      const turnOff = screen.getByRole('button', { name: 'Turn off sending' })
      await user.click(turnOff)
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(turnOff).toBeEnabled()
      expect(turnOff).toHaveFocus()
    })

    test('Send now keeps focus while it sends and while the send runs', async () => {
      const user = userEvent.setup()
      const status = sendingOn(SENT)
      const view = stateful(status)
      delayResponses(60)
      renderWithProviders(<WristSettings />)
      const sendNow = await screen.findByRole('button', { name: 'Send now' })
      await user.click(sendNow)
      await waitFor(() => {
        expect(sendNow).toHaveAttribute('aria-disabled', 'true')
      })
      expect(sendNow).toHaveFocus()
      view.set({ ...status, settings: { ...status.settings, running: true } })
      await refocus()
      expect(await screen.findByText('Sending to intervals.icu now.')).toBeVisible()
      expect(sendNow).toHaveAttribute('aria-disabled', 'true')
      expect(sendNow).toHaveFocus()
    })
  })

  test('are left out offline, where the status cannot be checked', async () => {
    setOnline(false)
    const { calls } = stateful(sendingOn(SENT))
    const { container } = renderWithProviders(<WristSettings />)
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
    expect(calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// The intervals.icu card: Disconnect with its choice
// ---------------------------------------------------------------------------------------------

describe('Disconnect on the intervals.icu card', () => {
  const info = {
    key: 'intervals',
    label: 'intervals.icu',
    experimental: false,
    channels: ['pull', 'publish'] as Array<'pull' | 'publish'>,
    wellness: true,
    docsUrl: 'https://intervals.example.com/docs',
  }
  const connected: IntegrationStatus = {
    provider: 'intervals',
    info,
    status: 'connected',
    config: { athleteId: 'i1001' },
    pushEnabled: false,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastError: null,
  }

  function page(status: WristStatus, extra: MockRoutes = {}) {
    const view = stateful(status, {
      'GET /api/integrations': () => [connected],
      'GET /api/state': () => makeStateView(),
      'DELETE /api/integrations/intervals': () => ({ status: 204, body: undefined }),
      ...extra,
    })
    renderWithProviders(
      <ToastProvider>
        <IntegrationsPage />
      </ToastProvider>,
    )
    return view
  }
  const card = () => screen.findByRole('region', { name: 'intervals.icu' })
  const deletes = (calls: Array<{ method: string; url: string }>) =>
    calls.filter((c) => c.method === 'DELETE').map((c) => c.url)

  test('shows the publishing settings on the card of a provider with the publish channel', async () => {
    page(makeWristStatus())
    const intervals = await card()
    expect(
      await within(intervals).findByRole('checkbox', {
        name: 'Send my next 14 days of runs to intervals.icu',
      }),
    ).toBeInTheDocument()
  })

  test('disconnects at once while sending is off', async () => {
    const user = userEvent.setup()
    const { calls } = page(makeWristStatus())
    const intervals = await card()
    await within(intervals).findByRole('checkbox', {
      name: 'Send my next 14 days of runs to intervals.icu',
    })
    await user.click(within(intervals).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => {
      expect(deletes(calls)).toEqual(['/api/integrations/intervals'])
    })
    expect(await screen.findByText('intervals.icu disconnected')).toBeInTheDocument()
  })

  test('asks first while sending is on, and leaves the sent sessions unless the box is ticked', async () => {
    const user = userEvent.setup()
    const { calls } = page(sendingOn(SENT))
    const intervals = await card()
    await within(intervals).findByText('Send sessions to your watch')
    await user.click(within(intervals).getByRole('button', { name: 'Disconnect' }))
    // nothing is deleted yet
    expect(deletes(calls)).toEqual([])
    const choice = within(intervals).getByRole('group', {
      name: 'intervals.icu holds the sessions already sent. They stay there after disconnecting unless they are removed too.',
    })
    expect(
      within(choice).getByRole('checkbox', { name: 'Also remove the sessions already sent' }),
    ).not.toBeChecked()
    expectCleanCopy(choice)
    await user.click(within(choice).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => {
      expect(deletes(calls)).toEqual(['/api/integrations/intervals'])
    })
  })

  test('removes the sent sessions first when asked', async () => {
    const user = userEvent.setup()
    const { calls } = page(sendingOn(SENT))
    const intervals = await card()
    await within(intervals).findByText('Send sessions to your watch')
    await user.click(within(intervals).getByRole('button', { name: 'Disconnect' }))
    await user.click(
      within(intervals).getAllByRole('checkbox', {
        name: 'Also remove the sessions already sent',
      })[0]!,
    )
    await user.click(
      within(
        within(intervals).getByRole('group', { name: /holds the sessions already sent/ }),
      ).getByRole('button', { name: 'Disconnect' }),
    )
    await waitFor(() => {
      expect(deletes(calls)).toEqual(['/api/integrations/intervals?removeSent=true'])
    })
  })

  test('says the removal failed, keeps the connection and offers to disconnect without it', async () => {
    const user = userEvent.setup()
    let refuse = true
    const { calls } = page(sendingOn(SENT), {
      'DELETE /api/integrations/intervals': () =>
        refuse ? REMOVE_FAILED : { status: 204, body: undefined },
    })
    const intervals = await card()
    await within(intervals).findByText('Send sessions to your watch')
    await user.click(within(intervals).getByRole('button', { name: 'Disconnect' }))
    const choice = within(intervals).getByRole('group', { name: /holds the sessions already sent/ })
    await user.click(
      within(choice).getByRole('checkbox', { name: 'Also remove the sessions already sent' }),
    )
    await user.click(within(choice).getByRole('button', { name: 'Disconnect' }))

    const alert = await within(choice).findByRole('alert')
    expect(alert).toHaveTextContent('so it stays connected')
    expect(alert).toHaveTextContent('disconnect without removing them')
    expect(deletes(calls)).toEqual(['/api/integrations/intervals?removeSent=true'])
    expect(screen.queryByText('intervals.icu disconnected')).not.toBeInTheDocument()

    refuse = false
    await user.click(
      within(choice).getByRole('button', { name: 'Disconnect without removing them' }),
    )
    await waitFor(() => {
      expect(deletes(calls)).toEqual([
        '/api/integrations/intervals?removeSent=true',
        '/api/integrations/intervals',
      ])
    })
    expect(await screen.findByText('intervals.icu disconnected')).toBeInTheDocument()
  })

  test('asks first when the status cannot be read, since sent sessions may be there', async () => {
    const user = userEvent.setup()
    const { calls } = page(sendingOn(SENT), {
      'GET /api/wrist/status': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Down.' } },
      }),
    })
    const intervals = await card()
    await user.click(await within(intervals).findByRole('button', { name: 'Disconnect' }))
    expect(
      within(intervals).getByRole('group', { name: /holds the sessions already sent/ }),
    ).toBeInTheDocument()
    expect(deletes(calls)).toEqual([])
  })

  test('the choice opens on its first box, and declining it gives focus back to Disconnect', async () => {
    const user = userEvent.setup()
    page(sendingOn(SENT))
    const intervals = await card()
    await within(intervals).findByText('Send sessions to your watch')
    await user.click(within(intervals).getByRole('button', { name: 'Disconnect' }))
    const choice = within(intervals).getByRole('group', { name: /holds the sessions already sent/ })
    expect(
      within(choice).getByRole('checkbox', { name: 'Also remove the sessions already sent' }),
    ).toHaveFocus()
    await user.click(within(choice).getByRole('button', { name: 'Keep it connected' }))
    expect(within(intervals).getByRole('button', { name: 'Disconnect' })).toHaveFocus()
  })

  test('Disconnect keeps focus while it works, also after a refused removal', async () => {
    const user = userEvent.setup()
    const { calls } = page(sendingOn(SENT), {
      'DELETE /api/integrations/intervals': () => REMOVE_FAILED,
    })
    delayResponses(60)
    const intervals = await card()
    await within(intervals).findByText('Send sessions to your watch')
    await user.click(within(intervals).getByRole('button', { name: 'Disconnect' }))
    const choice = within(intervals).getByRole('group', { name: /holds the sessions already sent/ })
    await user.click(
      within(choice).getByRole('checkbox', { name: 'Also remove the sessions already sent' }),
    )
    const disconnect = within(choice).getByRole('button', { name: 'Disconnect' })
    await user.click(disconnect)
    await waitFor(() => {
      expect(disconnect).toHaveAttribute('aria-disabled', 'true')
    })
    expect(disconnect).not.toBeDisabled()
    expect(disconnect).toHaveFocus()
    await within(choice).findByRole('alert')
    expect(disconnect).toHaveFocus()
    expect(deletes(calls)).toEqual(['/api/integrations/intervals?removeSent=true'])

    const without = within(choice).getByRole('button', { name: 'Disconnect without removing them' })
    await user.click(without)
    await waitFor(() => {
      expect(without).toHaveAttribute('aria-disabled', 'true')
    })
    expect(without).toHaveFocus()
  })

  test('keeps the connection when the choice is declined', async () => {
    const user = userEvent.setup()
    const { calls } = page(sendingOn(SENT))
    const intervals = await card()
    await within(intervals).findByText('Send sessions to your watch')
    await user.click(within(intervals).getByRole('button', { name: 'Disconnect' }))
    await user.click(within(intervals).getByRole('button', { name: 'Keep it connected' }))
    expect(within(intervals).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
    expect(deletes(calls)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// The Calendar link section
// ---------------------------------------------------------------------------------------------

describe('the Calendar link section', () => {
  const TOKEN = 'T0kenForTestsOnly_ABCDEFGHIJKLMNOPQRSTUVWXYZ0'
  const issued: CalendarTokenIssued = {
    token: TOKEN,
    path: `/api/calendar/${TOKEN}/plan.ics`,
    createdAt: new Date(2027, 0, 13, 12, 0).toISOString(),
  }
  const addressOf = (path: string) => `${window.location.origin}${path}`
  /** Whether the token is anywhere a reader could find it: the page's text or a field's value. */
  const pageHoldsToken = (): boolean =>
    (document.body.textContent ?? '').includes(TOKEN) ||
    [...document.querySelectorAll('input')].some((input) => input.value.includes(TOKEN))

  /** The calendar routes over a status they move, as the server's would. */
  function calendar(initial: WristStatus = makeWristStatus(), extra: MockRoutes = {}) {
    let status = initial
    const api = mockApi({
      'GET /api/wrist/status': () => status,
      'POST /api/wrist/calendar/token': () => {
        status = { ...status, calendar: { enabled: true, tokenCreatedAt: issued.createdAt } }
        return issued
      },
      'DELETE /api/wrist/calendar/token': () => {
        status = { ...status, calendar: { enabled: false, tokenCreatedAt: null } }
        return { status: 204, body: undefined }
      },
      ...extra,
    })
    return api
  }

  function renderSection() {
    return renderWithProviders(
      <ToastProvider>
        <IntegrationsPage />
      </ToastProvider>,
    )
  }
  function page(initial?: WristStatus, extra: MockRoutes = {}) {
    const api = calendar(initial, {
      'GET /api/integrations': () => [],
      'GET /api/state': () => makeStateView(),
      ...extra,
    })
    renderSection()
    return api
  }
  const section = () => screen.findByRole('region', { name: 'Calendar link' })

  test('says the link is off, who can read it and how far ahead each side looks', async () => {
    page()
    const feed = await section()
    expect(within(feed).getByText('The calendar link is off.')).toBeInTheDocument()
    expect(
      within(feed).getByText(
        'Anyone with this link can read your session titles and durations. Titles name the kind of run only. The calendar shows the next 28 days; the watch gets the next 14.',
      ),
    ).toBeInTheDocument()
    expect(
      within(feed).getByText(/reverse proxy in front of this app may log the link/),
    ).toBeVisible()
    expect(within(feed).getByRole('button', { name: 'Create calendar link' })).toBeInTheDocument()
    expect(
      within(feed).queryByRole('button', { name: 'Turn off the link' }),
    ).not.toBeInTheDocument()
    expectCleanCopy(feed)
  })

  test('shows the new link once, in a dialog, to copy or open as webcal://', async () => {
    const user = userEvent.setup()
    const { calls } = page()
    const feed = await section()
    await user.click(within(feed).getByRole('button', { name: 'Create calendar link' }))

    const dialog = await screen.findByRole('dialog', { name: 'Your calendar link' })
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
      '/api/wrist/calendar/token',
    ])
    expect(within(dialog).getByText(/This link is shown once/)).toBeInTheDocument()
    const address = within(dialog).getByRole('textbox', { name: 'Calendar link address' })
    expect(address).toHaveValue(addressOf(issued.path))
    expect(address).toHaveAttribute('readonly')
    expect(within(dialog).getByRole('link', { name: 'Open in a calendar app' })).toHaveAttribute(
      'href',
      `webcal://${window.location.host}${issued.path}`,
    )

    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    expect(await navigator.clipboard.readText()).toBe(addressOf(issued.path))
    expect(await screen.findByText('Link copied')).toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test('says so when the link cannot be copied, and leaves it selectable', async () => {
    const user = userEvent.setup()
    page()
    const feed = await section()
    await user.click(within(feed).getByRole('button', { name: 'Create calendar link' }))
    const dialog = await screen.findByRole('dialog', { name: 'Your calendar link' })
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    expect(
      await screen.findByText('The link could not be copied. Select it and copy it by hand.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Calendar link address' })).toHaveValue(
      addressOf(issued.path),
    )
  })

  test('forgets the link when the dialog closes, and never writes it to storage', async () => {
    const user = userEvent.setup()
    page()
    const feed = await section()
    await user.click(within(feed).getByRole('button', { name: 'Create calendar link' }))
    const dialog = await screen.findByRole('dialog', { name: 'Your calendar link' })
    expect(pageHoldsToken()).toBe(true)
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain(
      TOKEN,
    )

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pageHoldsToken()).toBe(false)
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain(
      TOKEN,
    )

    // the section now says the link works since today, and cannot show it again
    const after = await section()
    expect(
      await within(after).findByText('The calendar link works. It was made on 13 Jan.'),
    ).toBeVisible()
    expect(within(after).getByText(/cannot be shown again/)).toBeVisible()
    expect(within(after).queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument()
  })

  test('replaces the link with a new one, and turns it off', async () => {
    const user = userEvent.setup()
    const { calls } = page(
      makeWristStatus({ calendar: { enabled: true, tokenCreatedAt: issued.createdAt } }),
    )
    const feed = await section()
    expect(
      await within(feed).findByText('The calendar link works. It was made on 13 Jan.'),
    ).toBeVisible()
    expect(
      within(feed).queryByRole('button', { name: 'Create calendar link' }),
    ).not.toBeInTheDocument()

    await user.click(within(feed).getByRole('button', { name: 'Create a new link' }))
    const dialog = await screen.findByRole('dialog', { name: 'Your calendar link' })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    await user.click(within(feed).getByRole('button', { name: 'Turn off the link' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
        '/api/wrist/calendar/token',
      ])
    })
    expect(await screen.findByText('Calendar link turned off')).toBeInTheDocument()
    expect(await within(feed).findByText('The calendar link is off.')).toBeVisible()
  })

  test('says so when the link was not made or not turned off', async () => {
    const user = userEvent.setup()
    page(makeWristStatus({ calendar: { enabled: true, tokenCreatedAt: issued.createdAt } }), {
      'POST /api/wrist/calendar/token': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Down.' } },
      }),
      'DELETE /api/wrist/calendar/token': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Down.' } },
      }),
    })
    const feed = await section()
    await user.click(await within(feed).findByRole('button', { name: 'Create a new link' }))
    expect(await within(feed).findByRole('alert')).toHaveTextContent(
      'The calendar link was not created. Try again.',
    )
    await user.click(within(feed).getByRole('button', { name: 'Turn off the link' }))
    await waitFor(() => {
      expect(within(feed).getByRole('alert')).toHaveTextContent(
        'The calendar link was not turned off. Try again.',
      )
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('keeps the token on screen when the status cannot be read after the link was made', async () => {
    const user = userEvent.setup()
    let created = false
    page(undefined, {
      'GET /api/wrist/status': () =>
        created
          ? { status: 500, body: { error: { code: 'internal', message: 'Down.' } } }
          : makeWristStatus(),
      'POST /api/wrist/calendar/token': () => {
        created = true
        return issued
      },
    })
    const feed = await section()
    await user.click(within(feed).getByRole('button', { name: 'Create calendar link' }))

    // the section waits for a status it can trust, but the one copy of the token is not lost
    const dialog = await screen.findByRole('dialog', { name: 'Your calendar link' })
    expect(within(dialog).getByRole('textbox', { name: 'Calendar link address' })).toHaveValue(
      addressOf(issued.path),
    )
    expect(screen.queryByRole('region', { name: 'Calendar link' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(pageHoldsToken()).toBe(false)
  })

  describe('focus', () => {
    test('stays on the Create button while the link is made, and returns there when the dialog closes', async () => {
      const user = userEvent.setup()
      const { calls } = page(undefined)
      delayResponses(60)
      const feed = await section()
      const create = within(feed).getByRole('button', { name: 'Create calendar link' })
      await user.click(create)
      await waitFor(() => {
        expect(create).toHaveAttribute('aria-disabled', 'true')
      })
      expect(create).not.toBeDisabled()
      expect(create).toHaveFocus()
      await user.click(create)
      const dialog = await screen.findByRole('dialog', { name: 'Your calendar link' })
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)

      await user.click(within(dialog).getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(create).toHaveFocus()
    })

    test('returns to the button after Escape too', async () => {
      const user = userEvent.setup()
      page(makeWristStatus({ calendar: { enabled: true, tokenCreatedAt: issued.createdAt } }))
      delayResponses(60)
      const feed = await section()
      const replace = await within(feed).findByRole('button', { name: 'Create a new link' })
      await user.click(replace)
      await screen.findByRole('dialog', { name: 'Your calendar link' })
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(replace).toHaveFocus()
    })

    test('turning the link off keeps focus on its button while it works, then moves it to the button that makes a link', async () => {
      const user = userEvent.setup()
      page(makeWristStatus({ calendar: { enabled: true, tokenCreatedAt: issued.createdAt } }))
      delayResponses(60)
      const feed = await section()
      const turnOff = await within(feed).findByRole('button', { name: 'Turn off the link' })
      await user.click(turnOff)
      await waitFor(() => {
        expect(turnOff).toHaveAttribute('aria-disabled', 'true')
      })
      expect(turnOff).toHaveFocus()
      expect(await screen.findByText('Calendar link turned off')).toBeInTheDocument()
      expect(within(feed).getByRole('button', { name: 'Create calendar link' })).toHaveFocus()
    })
  })

  test('is left out offline, where the link cannot be made or checked', async () => {
    setOnline(false)
    mockApi({
      'GET /api/integrations': () => [],
      'GET /api/state': () => makeStateView(),
    })
    renderSection()
    await screen.findByRole('heading', { name: 'Integrations' })
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Calendar link' })).not.toBeInTheDocument()
    })
  })
})

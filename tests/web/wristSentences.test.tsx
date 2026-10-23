import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PUBLISH_TEMPLATES } from '../../shared/copy/publish.ts'
import { render } from '../../shared/copy/template.ts'
import type { Goal, IntegrationStatus, WeekRow } from '../../shared/types.ts'
import { HealthNotes } from '../../web/components/today/HealthNotes.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { IntegrationsPage } from '../../web/pages/IntegrationsPage.tsx'
import { PlanPage } from '../../web/pages/PlanPage.tsx'
import { activityPage, mockApi, renderWithProviders } from './helpers.tsx'
import { makeRevision, makeSession, makeV2Plan, settings } from './plan-fixtures.ts'
import { makeStateView } from './state-fixtures.ts'
import {
  makeWorkoutView,
  makeWristItem,
  makeWristStatus,
  sendingOn,
  workoutRoutes,
} from './wrist-fixtures.ts'

// A sentence that sends the runner somewhere must name a control that is there. Every
// `publish.wrist.*` sentence (the answers of the wrist routes and the Today note about tomorrow) is
// listed with the words that send the runner on, the page they point to and the controls that page
// has to show; the others that point at the same places are listed beside them. A sentence added
// without a row fails the first test, and a control taken away fails the row that names it.

vi.mock('../../web/components/WhyDrawer.tsx', () => ({ WhyDrawer: () => null }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

interface Control {
  role: 'button' | 'link' | 'checkbox'
  name: string
}

interface Row {
  /** The words of the sentence that send the runner on. */
  says: string
  /** The page, rendered; resolves to the element the controls are looked up in. */
  show: () => Promise<HTMLElement>
  controls: Control[]
}

const sentence = (id: keyof typeof PUBLISH_TEMPLATES): string =>
  render(PUBLISH_TEMPLATES[id], {}, 'km')

function intervals(over: Partial<IntegrationStatus>): IntegrationStatus {
  return {
    provider: 'intervals',
    info: {
      key: 'intervals',
      label: 'intervals.icu',
      experimental: false,
      channels: ['pull', 'publish'],
      wellness: true,
      docsUrl: 'https://intervals.example.com/docs',
    },
    status: 'disconnected',
    config: {},
    pushEnabled: false,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastError: null,
    ...over,
  }
}

/** The Integrations page with the intervals.icu card in the given state; resolves to the card. */
function integrations(over: Partial<IntegrationStatus>): () => Promise<HTMLElement> {
  return async () => {
    mockApi({
      'GET /api/integrations': () => [intervals(over)],
      'GET /api/state': () => makeStateView(),
      'GET /api/wrist/status': () => makeWristStatus(),
    })
    renderWithProviders(<IntegrationsPage />)
    return screen.findByRole('region', { name: 'intervals.icu' })
  }
}

const goal = {
  id: 'g1',
  name: 'Spring marathon',
  status: 'target',
  isActive: true,
  targetDate: '2027-03-07',
  distanceM: 42195,
} as Goal

/** The Plan page with a run that has not reached the watch; resolves to its session sheet. */
function planSheet(options: { sending: boolean }): () => Promise<HTMLElement> {
  return async () => {
    const run = makeSession({
      id: 'c',
      weekStart: '2027-01-11',
      date: '2027-01-14',
      kind: 'easy',
      title: 'Hill strides',
    })
    const plan = makeV2Plan({ sessions: [run] })
    const status = options.sending
      ? sendingOn([makeWristItem({ sessionId: 'c', externalId: 'ext-c', status: 'waiting' })])
      : makeWristStatus()
    mockApi({
      'GET /api/plan': () => plan,
      'GET /api/goals': () => [goal],
      'GET /api/settings': () => settings,
      'GET /api/weeks': () => [] as WeekRow[],
      'GET /api/plan/revisions': () => [makeRevision()],
      'GET /api/activities': () => activityPage([]),
      'GET /api/wrist/status': () => status,
      ...workoutRoutes(plan.sessions),
      'GET /api/plan/sessions/c/workout': () => makeWorkoutView(run),
    })
    renderWithProviders(
      <ToastProvider>
        <PlanPage />
      </ToastProvider>,
    )
    await userEvent.setup().click(await screen.findByRole('button', { name: /Hill strides/ }))
    return screen.findByRole('dialog', { name: 'Hill strides' })
  }
}

const NO_CALL_TO_ACTION = /\b(connect|reconnect|turn|send|download|open|disconnect|try)\b/i

/** Every `publish.wrist.*` sentence, with where it points. `null`: it points nowhere. */
const WRIST: Record<string, Row | null> = {
  'publish.wrist.connect': {
    says: 'Connect intervals.icu',
    show: integrations({ status: 'disconnected' }),
    controls: [{ role: 'button', name: 'Connect' }],
  },
  'publish.wrist.reconnect': {
    says: 'Reconnect intervals.icu',
    show: integrations({ status: 'needs_auth' }),
    controls: [{ role: 'button', name: 'Reconnect' }],
  },
  'publish.wrist.off': {
    says: 'Turn it on under Integrations',
    show: integrations({ status: 'connected' }),
    controls: [{ role: 'checkbox', name: 'Send my next 14 days of runs to intervals.icu' }],
  },
  'publish.wrist.remove-failed': {
    says: 'disconnect without removing them',
    show: integrations({ status: 'connected' }),
    controls: [{ role: 'button', name: 'Disconnect' }],
  },
  'publish.wrist.note-tomorrow': {
    says: 'Open the plan to send it again or to download the workout file',
    show: planSheet({ sending: true }),
    controls: [
      { role: 'button', name: 'Send again' },
      { role: 'link', name: 'Download the workout file' },
    ],
  },
  // answers for a client that asked wrongly, not for a runner: no control to name
  'publish.wrist.range': null,
  'publish.wrist.not-found': null,
}

/** Sentences of the same family that send the runner to the same places. */
const ELSEWHERE: Record<string, Row> = {
  'publish.auth': {
    says: 'Reconnect it on the Integrations page',
    show: integrations({ status: 'needs_auth' }),
    controls: [{ role: 'button', name: 'Reconnect' }],
  },
  'publish.code.not-connected': {
    says: 'Connect it on the Integrations page',
    show: integrations({ status: 'disconnected' }),
    controls: [{ role: 'button', name: 'Connect' }],
  },
  'publish.status.not-delivered': {
    says: 'Send it again, or download the workout file',
    show: planSheet({ sending: true }),
    controls: [
      { role: 'button', name: 'Send again' },
      { role: 'link', name: 'Download the workout file' },
    ],
  },
  'publish.sheet.off': {
    says: 'Download the workout file, or turn it on under Integrations',
    show: planSheet({ sending: false }),
    controls: [
      { role: 'link', name: 'Download the workout file' },
      { role: 'link', name: 'Open Integrations' },
    ],
  },
}

describe('the sentences of the wrist routes', () => {
  test('are all listed here, so a new one has to say where it points', () => {
    const ids = Object.keys(PUBLISH_TEMPLATES).filter((id) => id.startsWith('publish.wrist.'))
    expect(ids.length).toBeGreaterThan(0)
    expect(Object.keys(WRIST).sort()).toEqual(ids.sort())
  })

  for (const [id, row] of Object.entries(WRIST)) {
    if (row === null) {
      test(`${id} points nowhere`, () => {
        expect(sentence(id as keyof typeof PUBLISH_TEMPLATES)).not.toMatch(NO_CALL_TO_ACTION)
      })
      continue
    }
    test(`${id} names controls that its page shows`, async () => {
      expect(sentence(id as keyof typeof PUBLISH_TEMPLATES)).toContain(row.says)
      const page = await row.show()
      for (const control of row.controls) {
        expect(
          await within(page).findByRole(control.role, { name: control.name }),
          `${control.role} "${control.name}"`,
        ).toBeVisible()
      }
    })
  }
})

describe('the other sentences that point at the same places', () => {
  for (const [id, row] of Object.entries(ELSEWHERE)) {
    test(`${id} names controls that its page shows`, async () => {
      expect(sentence(id as keyof typeof PUBLISH_TEMPLATES)).toContain(row.says)
      const page = await row.show()
      for (const control of row.controls) {
        expect(
          await within(page).findByRole(control.role, { name: control.name }),
          `${control.role} "${control.name}"`,
        ).toBeVisible()
      }
    })
  }
})

describe('the Today note about tomorrow', () => {
  test('is a link to the Plan page, where the controls it names are', () => {
    mockApi({})
    renderWithProviders(
      <HealthNotes
        flags={[]}
        units="km"
        notes={[
          {
            code: 'wrist-tomorrow',
            template: 'publish.wrist.note-tomorrow',
            slots: {},
            href: '/plan',
          },
        ]}
      />,
    )
    const link = screen.getByRole('link', { name: sentence('publish.wrist.note-tomorrow') })
    expect(link).toHaveAttribute('href', '/plan')
  })
})

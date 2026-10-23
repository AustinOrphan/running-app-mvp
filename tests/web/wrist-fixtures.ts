import { focusManager } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import { resolveTargets } from '../../shared/engine/targets.ts'
import type { PlanSession, SessionWorkoutView, WristItem, WristStatus } from '../../shared/types.ts'
import { publishable } from '../../shared/workouts/labels.ts'
import type { MockRoutes } from './helpers.tsx'

/** One session as `GET /api/wrist/status` lists it: sent, nothing wrong, planned as written. */
export function makeWristItem(over: Partial<WristItem> = {}): WristItem {
  return {
    externalId: 'ext-s1',
    sessionId: 's1',
    date: '2027-01-13',
    kind: 'threshold',
    title: 'Threshold run, 55 min',
    variant: 'planned',
    status: 'sent',
    failCode: null,
    failMessage: null,
    deviceMessage: null,
    warnings: [],
    retryAt: null,
    sentAt: '2027-01-13T08:00:00.000Z',
    ...over,
  }
}

/** The status of a runner who has not turned sending on: the default of a new account. */
export function makeWristStatus(over: Partial<WristStatus> = {}): WristStatus {
  return {
    from: '2027-01-13',
    to: '2027-01-26',
    connection: 'connected',
    settings: { enabled: false, garminLinked: false, lastRunAt: null, running: false },
    calendar: { enabled: false, tokenCreatedAt: null },
    items: [],
    ...over,
  }
}

/** The status with sending on, the Garmin upload ticked, and the given items. */
export function sendingOn(items: WristItem[], over: Partial<WristStatus> = {}): WristStatus {
  return makeWristStatus({
    settings: {
      enabled: true,
      garminLinked: true,
      lastRunAt: '2027-01-13T11:00:00.000Z',
      running: false,
    },
    items,
    ...over,
  })
}

/** `GET /api/wrist/status` for a page that is not about the watch: sending is off. */
export function wristRoutes(status: WristStatus = makeWristStatus()): MockRoutes {
  return { 'GET /api/wrist/status': () => status }
}

/**
 * What the server answers for the sheet of a session: the resolver's targets for the stored
 * session against no zone set (so the stored heart rate and pace stand), and the file offered
 * whenever the session is a run still to be done.
 */
export function makeWorkoutView(
  session: PlanSession,
  over: Partial<SessionWorkoutView> = {},
): SessionWorkoutView {
  const file: SessionWorkoutView['file'] = !publishable(session.kind)
    ? { available: false, reason: 'not-a-run' }
    : !isToRun(session.status)
      ? { available: false, reason: 'settled' }
      : { available: true }
  return {
    targets: resolveTargets(session, null, { hot: false }),
    eased: false,
    file,
    ...over,
  }
}

/** `GET /api/plan/sessions/:id/workout` for each session. */
export function workoutRoutes(sessions: readonly PlanSession[]): MockRoutes {
  return Object.fromEntries(
    sessions.map((session) => [
      `GET /api/plan/sessions/${session.id}/workout`,
      () => makeWorkoutView(session),
    ]),
  )
}

/** The two requests every opened session sheet makes, with sending off. */
export function sheetRoutes(sessions: readonly PlanSession[]): MockRoutes {
  return { ...wristRoutes(), ...workoutRoutes(sessions) }
}

/** The window comes back into focus: the status is read again, as it is when the runner returns. */
export async function refocus(): Promise<void> {
  await act(async () => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await Promise.resolve()
  })
}

import type {
  Plan,
  PlanRevision,
  PlanSession,
  PlanWeek,
  PlanWithSessions,
  PlanWithWeeks,
  UserSettings,
} from '../../shared/types.ts'

export const settings: UserSettings = {
  email: 'runner@example.com',
  displayName: null,
  units: 'km',
}

export function makeSession(over: Partial<PlanSession> = {}): PlanSession {
  return {
    id: 's1',
    externalId: `ext-${over.id ?? 's1'}`,
    planId: 'p2',
    weekStart: '2027-01-11',
    date: '2027-01-13',
    order: 0,
    kind: 'threshold',
    title: 'Threshold intervals',
    durationMin: 55,
    distanceM: 9000,
    gainM: 60,
    structure: [
      { kind: 'warmup', reps: 1, durationSec: 900, distanceM: null, zone: 'z1' },
      { kind: 'work', reps: 3, durationSec: 480, distanceM: null, zone: 'z3' },
      { kind: 'recover', reps: 3, durationSec: 120, distanceM: null, zone: 'z1' },
      { kind: 'cooldown', reps: 1, durationSec: 600, distanceM: null, zone: 'z1' },
    ],
    target: {
      zone: 'z3',
      rpe: [6, 7],
      hr: [158, 168],
      paceSecPerKm: [330, 310],
      heatNote: 'Warm afternoon: start the work reps by feel.',
    },
    purpose: 'Raise the pace you can hold for a long stretch without adding distance.',
    rules: ['e-2', 'f-1'],
    flags: ['heat'],
    status: 'planned',
    activityId: null,
    linkSource: null,
    execution: null,
    original: null,
    updatedAt: '2027-01-10T10:00:00.000Z',
    ...over,
  }
}

export function makeV2Week(index: number, over: Partial<PlanWeek> = {}): PlanWeek {
  const start = ['2027-01-04', '2027-01-11', '2027-01-18'][index] ?? '2027-01-25'
  return {
    id: `v2w${index}`,
    planId: 'p2',
    weekStart: start,
    index,
    phase: index === 0 ? 'base' : 'build',
    focus: `Week focus ${index}`,
    baselineRunMin: 300,
    targetRunMin: 300,
    targetSource: 'baseline',
    longRunMin: 90,
    day2Min: null,
    runDays: 4,
    strengthSessions: 1,
    overrideNote: null,
    tid: { z1: 80, z2: 10, z3: 10 },
    flags: [],
    gainTargetM: null,
    qualitySessions: 0,
    isRecovery: false,
    updatedAt: '2027-01-01T10:00:00.000Z',
    ...over,
  }
}

const basePlan: Plan = {
  id: 'p2',
  userId: 'u1',
  goalId: 'g1',
  name: 'Spring marathon plan',
  startDate: '2027-01-04',
  raceWeekStart: '2027-03-01',
  status: 'active',
  generatorVersion: 2,
  paramsVersion: '2026-10-22',
  createdAt: '2027-01-01T10:00:00.000Z',
  updatedAt: '2027-01-01T10:00:00.000Z',
}

/** A version-1 plan as the API returns it: weeks only, no sessions. */
export function makeV1Plan(): PlanWithWeeks {
  return {
    ...basePlan,
    generatorVersion: 1,
    paramsVersion: null,
    weeks: [makeV2Week(0), makeV2Week(1), makeV2Week(2)],
  }
}

export function makeV2Plan(over: Partial<PlanWithSessions> = {}): PlanWithSessions {
  return {
    ...basePlan,
    weeks: [makeV2Week(0), makeV2Week(1), makeV2Week(2)],
    sessions: [
      makeSession({ id: 'a', weekStart: '2027-01-04', date: '2027-01-05', title: 'Easy run' }),
      makeSession({
        id: 'b',
        weekStart: '2027-01-11',
        date: '2027-01-12',
        title: 'Steady long run',
      }),
      makeSession({ id: 'c', weekStart: '2027-01-11', date: '2027-01-14', title: 'Hill strides' }),
      makeSession({ id: 'd', weekStart: '2027-01-18', date: '2027-01-19', title: 'Recovery jog' }),
    ],
    feasibility: {
      label: 'tight',
      weeksNeeded: 14,
      weeksAvailable: 12,
      notes: [
        {
          code: 'short-runway',
          severity: 'info',
          message: 'Two fewer weeks than usual.',
          rules: ['d-1'],
        },
      ],
    },
    warnings: [
      {
        code: 'ramp-capped',
        severity: 'warn',
        message: 'Week of 18 Jan held at the weekly ramp limit.',
        rules: ['g-3'],
      },
    ],
    checklist: [
      {
        id: 'progression',
        ok: true,
        detail: 'Every week is within the ramp limit.',
        rules: ['g-3'],
      },
      { id: 'taper', ok: false, detail: 'Taper is one week long.', rules: ['k-1'] },
    ],
    zones: null,
    ...over,
  }
}

export function makeRevision(over: Partial<PlanRevision> = {}): PlanRevision {
  return {
    id: 'r1',
    planId: 'p2',
    createdAt: '2027-01-10T03:00:00.000Z',
    reason: 'weekly',
    summary: 'Held week 3 after an easier-than-expected long run.',
    changes: [
      { weekStart: '2027-01-18', field: 'targetRunMin', from: 330, to: 300, rules: ['j-5'] },
    ],
    ...over,
  }
}

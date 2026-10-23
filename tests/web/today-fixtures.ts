import type { PlanSession, TodayCoach, TodayHeat, TodayView } from '../../shared/types.ts'

export const TODAY = '2026-03-18'

export function makeSession(over: Partial<PlanSession> = {}): PlanSession {
  return {
    id: 's1',
    externalId: `ext-${over.id ?? 's1'}`,
    planId: 'p1',
    weekStart: '2026-03-16',
    date: TODAY,
    order: 0,
    kind: 'easy',
    title: 'Easy run',
    durationMin: 45,
    distanceM: 8047,
    gainM: 60,
    structure: [],
    target: {
      zone: 'z1',
      rpe: [3, 4],
      hr: [128, 142],
      paceSecPerKm: [390, 345],
      heatNote: null,
    },
    purpose: 'Aerobic base at an easy effort.',
    rules: ['f-1', 'g-1'],
    flags: [],
    status: 'planned',
    activityId: null,
    linkSource: null,
    execution: null,
    original: null,
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...over,
  }
}

/** A day with no heat read: no forecast, or a day inside the optimum band. */
export function makeHeat(over: Partial<TodayHeat> = {}): TodayHeat {
  return {
    wbgtC: null,
    note: null,
    coolerHour: null,
    peakHour: null,
    coolerValue: null,
    index: null,
    hotForSteering: false,
    ...over,
  }
}

/** The coach payload of a day with nothing planned, no signals yet and every slot empty. */
export function makeCoach(over: Partial<TodayCoach> = {}): TodayCoach {
  return {
    generatedAt: `${TODAY}T06:00:00.000Z`,
    preview: false,
    verdict: { code: 'no-signals', template: 'today.verdict.no-signals', slots: {} },
    signals: [],
    hero: null,
    next: null,
    weekStrip: null,
    race: null,
    change: null,
    health: { possibleDuplicates: 0, pastUnconfirmedWeeks: 0, lastWeekReady: false, notes: [] },
    slots: { disruption: null, fuel: null, watch: null, brief: null, fuelPrompt: null },
    ...over,
  }
}

/** Today's view with nothing prescribed and nothing flagged, as a version-1 plan returns it. */
export function makeToday(over: Partial<TodayView> = {}): TodayView {
  return {
    date: TODAY,
    tz: 'UTC',
    sessions: [],
    heat: makeHeat(),
    checkin: null,
    readiness: {
      date: TODAY,
      checkin: null,
      hrv: { readings: 0, latest: null, baselineMean: null, baselineSd: null, flag: false },
      restingHrFlag: false,
      sleepAvgH: null,
      sleepFlag: false,
      state: 'normal',
      redFlags: [],
    },
    unrated: [],
    coach: makeCoach(),
    ...over,
  }
}

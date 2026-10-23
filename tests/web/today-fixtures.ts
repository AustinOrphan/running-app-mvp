import { eahCard, fuelTargetFor, replayLadder } from '../../shared/engine/fuel.ts'
import { describeFuelTarget } from '../../shared/engine/fuelCopy.ts'
import type {
  FuelPrompt,
  PlanSession,
  TodayCoach,
  TodayFuel,
  TodayFuelPrompts,
  TodayHeat,
  TodayHero,
  TodayRace,
  TodayTarget,
  TodayView,
  WeekStrip,
  WeekStripDay,
} from '../../shared/types.ts'

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

/**
 * The `fuel` slot of a day with one long run, on the floor of the ladder: the target the engine
 * gives it and the words around it, so a page test never types a gram figure of its own.
 */
export function makeFuelSlot(over: Partial<TodayFuel> = {}): TodayFuel {
  const settings = { optIn90: false, optInAdvanced: false, giDisease: false }
  const session = makeSession({ id: 'long1', kind: 'long', title: 'Long run', durationMin: 150 })
  const ladder = replayLadder({ settings, runs: [], gutTrainingWeeks: [] })
  const target = fuelTargetFor({ settings, ladder, peaks: {} }, session)
  if (target === null) throw new Error('A 150-minute long run carries a fuel target.')
  const { id, date, kind, title, durationMin } = session
  return {
    targets: [
      { session: { id, date, kind, title, durationMin }, target, text: describeFuelTarget(target) },
    ],
    eah: eahCard({ eventHours: null, hot: false }),
    ...over,
  }
}

/** The `fuelPrompt` slot with one unlogged three-hour run. */
export function makeFuelPrompts(prompts: FuelPrompt[] = []): TodayFuelPrompts {
  return {
    prompts:
      prompts.length > 0
        ? prompts
        : [
            {
              activityId: 'run1',
              date: TODAY,
              startTime: null,
              durationSec: 3 * 3600,
              distanceM: 30_000,
              block: false,
            },
          ],
  }
}

/** The targets of the easy run above: a heart-rate ceiling, the pace as a guide, effort 3 to 4. */
export function makeTarget(over: Partial<TodayTarget> = {}): TodayTarget {
  return {
    zone: 'z1',
    mode: 'hr-ceiling',
    hrCeiling: 142,
    hrRange: null,
    paceSecPerKm: [390, 345],
    rpe: [3, 4],
    hot: false,
    hotNote: null,
    zonesNote: null,
    source: 'zones',
    climbNote: null,
    ...over,
  }
}

/** The hero of a day with one easy run, as planned. */
export function makeHero(over: Partial<TodayHero> = {}): TodayHero {
  return {
    session: makeSession(),
    advice: 'as-planned',
    reasons: [],
    eased: null,
    target: makeTarget(),
    linkedRun: null,
    others: [],
    ...over,
  }
}

const WEEK_DAYS = [
  '2026-03-16',
  '2026-03-17',
  '2026-03-18',
  '2026-03-19',
  '2026-03-20',
  '2026-03-21',
  '2026-03-22',
]

/** The week of the fixed clock (Monday 16 March) with every day free, today the Wednesday. */
export function makeStrip(
  over: Partial<WeekStrip> = {},
  days: Record<string, Partial<WeekStripDay>> = {},
): WeekStrip {
  return {
    weekStart: '2026-03-16',
    days: WEEK_DAYS.map((date) => ({
      date,
      mark: 'free',
      isToday: date === TODAY,
      runMin: 0,
      sessions: [],
      ...days[date],
    })),
    runMin: 0,
    targetRunMin: null,
    remaining: null,
    ...over,
  }
}

/** A race 87 days out, a half marathon with no prediction yet. */
export function makeRace(over: Partial<TodayRace> = {}): TodayRace {
  return {
    goalId: 'g1',
    name: 'Example Half',
    targetDate: '2026-06-13',
    dateProvisional: false,
    daysToRace: 87,
    distanceM: 21097,
    prediction: null,
    range: { wide: false, minHalfWidthPct: 5, rules: ['L2', 'L6'], grade: 'C' },
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
    disruptions: [],
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
      hrv: {
        readings: 0,
        baseline: 0,
        lookbackDays: 21,
        latest: null,
        baselineMean: null,
        baselineSd: null,
        flag: false,
      },
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

import { eahCard, fuelTargetFor, replayLadder } from '../../shared/engine/fuel.ts'
import { describeFuelTarget } from '../../shared/engine/fuelCopy.ts'
import type {
  FuelPrompt,
  PlanSession,
  TodayCoach,
  TodayFuel,
  TodayFuelPrompts,
  TodayHeat,
  TodayView,
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

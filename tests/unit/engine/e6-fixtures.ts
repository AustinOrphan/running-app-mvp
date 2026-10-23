// Synthetic fixtures for the engine unit tests of Task E6 (micro.test.ts, guards.test.ts): one
// profile, one athlete state, one zone set, a week draft, a session and a completed run. No
// personal data.
import type { Activity, AthleteProfile, Weekday } from '../../../shared/types.ts'
import type { AthleteState, SessionSpec, WeekDraft, ZoneSet } from '../../../shared/engine/types.ts'

export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

type Availability = AthleteProfile['availability']

export function availability(
  over: Partial<Record<Weekday, { available: boolean; maxMin: number | null }>> = {},
): Availability {
  const base = Object.fromEntries(
    WEEKDAYS.map((day) => [day, { available: true, maxMin: null }]),
  ) as Availability
  return { ...base, ...over }
}

export function profile(over: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    birthYear: 1990,
    sex: 'unspecified',
    heightCm: null,
    weightKg: null,
    hrMax: null,
    hrMaxSource: null,
    hrRest: null,
    lthr: null,
    thresholdPaceSecPerKm: null,
    runningSinceYear: 2015,
    injuries: [],
    availability: availability(),
    longRunDay: 'sat',
    terrain: { trail: false, hills: false, treadmill: false, track: false },
    strengthPreference: 2,
    timezone: 'UTC',
    homeLat: null,
    homeLng: null,
    useHomeWeather: false,
    ...over,
  }
}

export const ZONES: ZoneSet = {
  hrMax: null,
  hrRest: null,
  lt1Hr: null,
  lt2Hr: null,
  csMps: null,
  lt1PaceSecPerKm: null,
  thresholdPaceSecPerKm: null,
  hr: null,
  pace: null,
  rpe: { z1: [2, 3], z2: [4, 5], z3: [6, 8] },
}

export function state(over: Partial<AthleteState> = {}): AthleteState {
  return {
    asOf: '2026-11-01',
    age: 36,
    sex: 'unspecified',
    experience: 'recreational',
    yearsRunning: 8,
    load: { metric: 'minutes', acute: 0, chronic: 0, daily: [] },
    weeks: [],
    typicalWeekMin: 200,
    recentWeekMin: 0,
    longest30d: { distanceM: 0, durationSec: 0, gainM: 0, lossM: 0, twoDaySec: 0 },
    gaps16w: 0,
    layoffDays: 0,
    lastRunDate: null,
    fitness: {
      csMps: null,
      dPrimeM: null,
      csEfforts: 0,
      exponent: null,
      races: [],
      vo2maxTrend: null,
    },
    efficiency: { current: null, trendPct: null, samples: 0 },
    durability: { decouplingMedianPct: null, samples: 0 },
    risk: { recentInjury: false, priorBsi: false, bsiFactors: 0, redsFlags: 0, noviceFlags: [] },
    lowFrequency: false,
    heatAcclimation: 0,
    ...over,
  }
}

export function week(over: Partial<WeekDraft> = {}): WeekDraft {
  return {
    weekStart: '2026-11-02',
    index: 10,
    phase: 'build',
    focus: 'build',
    targetRunMin: 300,
    longRunMin: 100,
    longRunM: null,
    gainTargetM: null,
    runDays: 5,
    qualitySessions: 2,
    strengthSessions: 0,
    tid: { z1: 80, z2: 12, z3: 8 },
    flags: [],
    isRecovery: false,
    isTaper: false,
    ...over,
  }
}

/** A planned session; the guards and the placement read only a few fields. */
export function session(over: Partial<SessionSpec> = {}): SessionSpec {
  return {
    date: '2026-11-02',
    order: 0,
    kind: 'easy',
    title: 'Easy run',
    durationMin: 40,
    distanceM: null,
    gainM: null,
    structure: [],
    target: { zone: 'z1', rpe: [2, 3], hr: null, paceSecPerKm: null, heatNote: null },
    purpose: 'test',
    rules: [],
    flags: [],
    ...over,
  }
}

let counter = 0
/** A completed run in the history. */
export function run(
  date: string,
  durationMin: number,
  over: Partial<Activity> & { distanceKm?: number } = {},
): Activity {
  counter += 1
  const { distanceKm, ...rest } = over
  return {
    id: `a${counter}`,
    userId: 'u1',
    date,
    startTime: null,
    type: 'run',
    durationSec: durationMin * 60,
    distanceM: distanceKm === undefined ? null : distanceKm * 1000,
    rpe: null,
    avgHr: null,
    maxHr: null,
    elevationGainM: null,
    notes: null,
    source: 'manual',
    providerKey: null,
    importBatchId: null,
    duplicateOfId: null,
    duplicateStatus: 'none',
    subtype: null,
    startUtc: null,
    utcOffsetMin: null,
    movingSec: null,
    elevationLossM: null,
    avgCadence: null,
    avgPowerW: null,
    deviceName: null,
    startLat: null,
    startLng: null,
    tempC: null,
    dewPointC: null,
    windKph: null,
    humidityPct: null,
    weatherSource: null,
    hrHistogram: null,
    decouplingPct: null,
    gapDistanceM: null,
    feel: null,
    pain: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...rest,
  }
}

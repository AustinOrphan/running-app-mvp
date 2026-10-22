// Synthetic inputs for the readiness and adaptation tests.
import { addDays } from '../../../shared/dates.ts'
import type {
  Checkin,
  EngineInput,
  GoalModel,
  SessionKind,
  SessionSpec,
} from '../../../shared/engine/types.ts'
import type { Activity, AthleteProfile, WeeklyReview, WellnessDay } from '../../../shared/types.ts'

export const TODAY = '2026-10-21' // a Wednesday; the week starts 2026-10-19

export function profile(over: Partial<AthleteProfile> = {}): AthleteProfile {
  const day = { available: true, maxMin: null }
  return {
    birthYear: 1990,
    sex: 'male',
    heightCm: null,
    weightKg: null,
    hrMax: null,
    hrMaxSource: null,
    hrRest: null,
    lthr: null,
    thresholdPaceSecPerKm: 300,
    runningSinceYear: 2018,
    injuries: [],
    availability: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
    longRunDay: 'sun',
    terrain: { trail: false, hills: false, treadmill: false, track: false },
    strengthPreference: 0,
    timezone: 'UTC',
    homeLat: null,
    homeLng: null,
    useHomeWeather: false,
    ...over,
  }
}

export function goal(): GoalModel {
  return {
    goalId: 'g1',
    name: 'Synthetic half',
    date: '2027-03-14',
    distanceM: 21_097,
    gainM: 0,
    lossM: 0,
    surface: 'road',
    goalType: 'time',
    targetTimeSec: null,
    startTime: null,
    isUltra: false,
    distanceClass: 'half',
    expectedDurationSec: 7200,
    crossesDarkness: false,
    raceWbgtC: null,
  }
}

export function wellnessDay(
  date: string,
  over: Partial<WellnessDay & Checkin> = {},
): WellnessDay & Partial<Checkin> {
  return {
    id: `w-${date}`,
    date,
    restingHr: null,
    hrvRmssd: null,
    hrvSdnn: null,
    sleepSec: null,
    sleepScore: null,
    weightKg: null,
    vo2max: null,
    notes: null,
    source: 'manual',
    updatedAt: '2026-10-21T00:00:00Z',
    ...over,
  }
}

/** One reading per day for the days before `end` (not including `end`), oldest first. */
export function hrvSeries(end: string, values: number[]): Array<WellnessDay & Partial<Checkin>> {
  return values.map((hrvRmssd, i) => wellnessDay(addDays(end, -(values.length - i)), { hrvRmssd }))
}

/** Ten steady baseline readings around 60 ms with a small spread. */
export const STEADY_HRV = [59, 61, 60, 62, 58, 60, 61, 59, 60, 62]

export function activity(date: string, over: Partial<Activity> = {}): Activity {
  return {
    id: `a-${date}-${over.durationSec ?? 3600}`,
    userId: 'u1',
    date,
    startTime: null,
    type: 'run',
    durationSec: 3600,
    distanceM: 10_000,
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
    createdAt: '2026-10-21T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
    ...over,
  }
}

const QUALITY: SessionKind[] = ['threshold', 'intervals', 'hills', 'race-pace', 'long-fast-finish']

export function spec(
  date: string,
  kind: SessionKind,
  over: Partial<SessionSpec> = {},
): SessionSpec {
  const quality = QUALITY.includes(kind)
  return {
    date,
    order: 0,
    kind,
    title: kind,
    durationMin: 60,
    distanceM: null,
    gainM: null,
    structure: [],
    target: {
      zone: quality ? 'z3' : 'z1',
      rpe: quality ? [5, 6] : [2, 3],
      hr: null,
      paceSecPerKm: null,
      heatNote: null,
    },
    purpose: 'Synthetic session.',
    rules: [],
    flags: [],
    ...over,
  }
}

export type ExistingSession = SessionSpec & {
  id: string
  status: string
  activityId: string | null
}

export function planned(
  id: string,
  date: string,
  kind: SessionKind,
  over: Partial<ExistingSession> = {},
): ExistingSession {
  return { ...spec(date, kind), id, status: 'planned', activityId: null, ...over }
}

export function review(weekStart: string, over: Partial<WeeklyReview> = {}): WeeklyReview {
  return {
    id: `r-${weekStart}`,
    userId: 'u1',
    weekStart,
    dataStatus: 'complete',
    fatigue: null,
    symptoms: null,
    recoveryConstrained: false,
    suggestedAction: null,
    suggestedReason: null,
    suggestedNextMin: null,
    finalDecision: null,
    finalNextMin: null,
    notes: null,
    reviewedAt: null,
    createdAt: '2026-10-21T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
    ...over,
  }
}

export function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    today: TODAY,
    profile: profile(),
    activities: [],
    wellness: [],
    reviews: [],
    goal: goal(),
    forecast: null,
    existing: null,
    options: {},
    ...over,
  }
}

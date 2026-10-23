import { prescribe } from '../../../shared/engine/sessions.ts'
import type { SessionKind, SessionSpec, WeekDraft, ZoneSet } from '../../../shared/engine/types.ts'
import type { AthleteProfile } from '../../../shared/types.ts'

/** A synthetic runner for engine tests: no personal data. */
export const profileFixture: AthleteProfile = {
  birthYear: 1985,
  sex: 'male',
  heightCm: 175,
  weightKg: 70,
  hrMax: 190,
  hrMaxSource: 'measured',
  hrRest: 50,
  lthr: null,
  thresholdPaceSecPerKm: null,
  runningSinceYear: 2018,
  injuries: [],
  availability: {
    mon: { available: true, maxMin: null },
    tue: { available: true, maxMin: null },
    wed: { available: true, maxMin: null },
    thu: { available: true, maxMin: null },
    fri: { available: true, maxMin: null },
    sat: { available: true, maxMin: null },
    sun: { available: true, maxMin: null },
  },
  longRunDay: 'sat',
  terrain: { trail: false, hills: false, treadmill: false, track: false },
  strengthPreference: 0,
  timezone: 'UTC',
  homeLat: null,
  homeLng: null,
  useHomeWeather: false,
}

/** A heart-rate histogram with every second in one bin: a perfectly steady run. */
export function steadyHistogram(hr: number, sec: number) {
  const bins = new Array<number>(181).fill(0)
  bins[hr - 40] = sec
  return { start: 40, width: 1, sec: bins }
}

/** Every session kind the engine prescribes. */
export const SESSION_KINDS: readonly SessionKind[] = [
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'hike',
  'b2b',
  'strength',
  'mobility',
  'rest',
  'race',
  'cross',
]

/** A synthetic zone set: heart rate and pace for Z1 to Z3, a critical speed of 3.5 m/s. */
export function zoneSetFixture(over: Partial<ZoneSet> = {}): ZoneSet {
  return {
    hrMax: null,
    hrRest: null,
    lt1Hr: null,
    lt2Hr: null,
    csMps: { value: 3.5, band: [3.5, 3.5], source: 'cs', asOf: '2026-07-06' },
    lt1PaceSecPerKm: null,
    thresholdPaceSecPerKm: null,
    hr: { z1: [120, 140], z2: [140, 155], z3: [155, 170] },
    pace: { z1: [390, 340], z2: [340, 310], z3: [310, 285] },
    rpe: { z1: [1, 3], z2: [3, 5], z3: [5, 7] },
    ...over,
  }
}

/** A build week with a gain target, so run sessions carry a share of climbing. */
export function weekFixture(over: Partial<WeekDraft> = {}): WeekDraft {
  return {
    weekStart: '2026-07-06',
    index: 0,
    phase: 'build',
    focus: 'Build',
    targetRunMin: 300,
    longRunMin: 100,
    longRunM: null,
    gainTargetM: 1200,
    runDays: 5,
    qualitySessions: 2,
    strengthSessions: 2,
    tid: { z1: 80, z2: 12, z3: 8 },
    flags: [],
    isRecovery: false,
    isTaper: false,
    ...over,
  }
}

/** A dated session of the given kind, prescribed by the engine against `zones`. */
export function prescribed(
  kind: SessionKind,
  zones: ZoneSet = zoneSetFixture(),
  over: Partial<SessionSpec> = {},
): SessionSpec {
  return {
    ...prescribe(kind, 60, zones, weekFixture(), { goalPaceSecPerKm: 330 }),
    date: '2026-07-10',
    order: 1,
    ...over,
  }
}

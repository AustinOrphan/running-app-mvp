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

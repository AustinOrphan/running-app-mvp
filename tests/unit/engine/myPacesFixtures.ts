// Synthetic runners for the My paces tests (engine, API and page): nine steady flat runs on the
// line HR = 90 + 20 x speed, a state that supports whatever the test gives it, and the view the
// engine builds from them. No personal data.
import { fitHrModel } from '../../../shared/engine/execution.ts'
import { myPaces, type EventSpec } from '../../../shared/engine/myPaces.ts'
import type { AthleteState } from '../../../shared/engine/types.ts'
import { buildZones } from '../../../shared/engine/zones.ts'
import type { Activity } from '../../../shared/types.ts'
import { profileFixture } from './fixtures.ts'

export { profileFixture }

export const TODAY = '2026-06-30'

export function run(
  i: number,
  speedMps: number,
  over: Partial<Activity> = {},
  /** The run's average heart rate; by default on the line HR = 90 + 20 x speed. */
  hr: number = Math.round(90 + 20 * speedMps),
): Activity {
  const durationSec = 40 * 60
  const avgHr = hr
  return {
    id: `m${String(i)}`,
    userId: 'u1',
    date: `2026-06-${String(10 + i).padStart(2, '0')}`,
    startTime: null,
    type: 'run',
    durationSec,
    distanceM: speedMps * durationSec,
    rpe: null,
    avgHr,
    maxHr: null,
    elevationGainM: 20,
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
    hrHistogram: {
      start: 100,
      width: 5,
      sec: Array.from({ length: 20 }, (_, bin) =>
        bin === Math.floor((avgHr - 100) / 5) ? durationSec : 0,
      ),
    },
    terrainBins: null,
    surfaceBins: null,
    hrQuality: null,
    decouplingPct: null,
    gapDistanceM: speedMps * durationSec,
    feel: null,
    pain: null,
    createdAt: '2026-06-30T00:00:00Z',
    updatedAt: '2026-06-30T00:00:00Z',
    ...over,
  }
}

/** Nine steady flat runs on the line HR = 90 + 20 x speed, speeds 2.3 to 3.1 m/s. */
export const RUNS = Array.from({ length: 9 }, (_, i) => run(i, 2.3 + i * 0.1))

export function stateWith(
  fitness: Partial<AthleteState['fitness']> = {},
  layoffDays = 0,
): AthleteState {
  return {
    asOf: TODAY,
    age: 40,
    sex: 'unspecified',
    experience: 'recreational',
    yearsRunning: 6,
    load: { metric: 'minutes', acute: 0, chronic: 0, daily: [] },
    weeks: [],
    typicalWeekMin: 240,
    recentWeekMin: 0,
    longest30d: { distanceM: 0, durationSec: 0, gainM: 0, lossM: 0, twoDaySec: 0 },
    gaps16w: 0,
    layoffDays,
    lastRunDate: null,
    fitness: {
      csMps: null,
      dPrimeM: null,
      csEfforts: 0,
      exponent: null,
      races: [],
      vo2maxTrend: null,
      ...fitness,
    },
    efficiency: { current: null, trendPct: null, samples: 0 },
    durability: { decouplingMedianPct: null, samples: 0 },
    risk: { recentInjury: false, priorBsi: false, bsiFactors: 0, redsFlags: 0, noviceFlags: [] },
    lowFrequency: false,
    history: null,
    heatAcclimation: 0,
  }
}

export const EVENTS: EventSpec[] = [
  { key: 'five-k', distanceM: 5000, gainM: 0 },
  { key: 'ten-k', distanceM: 10000, gainM: 0 },
]

export function paces(over: {
  state?: AthleteState
  profile?: typeof profileFixture
  activities?: Activity[]
  events?: EventSpec[]
}) {
  const state = over.state ?? stateWith()
  const profile = over.profile ?? profileFixture
  const activities = over.activities ?? RUNS
  const zones = buildZones(profile, state, TODAY)
  return {
    zones,
    view: myPaces(
      { state, zones, hrModel: fitHrModel(activities, TODAY), activities, today: TODAY },
      over.events ?? EVENTS,
    ),
  }
}

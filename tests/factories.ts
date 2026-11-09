import { addDays } from '../shared/dates.ts'
import type { TrendRun } from '../shared/domain/trendsRuns.ts'
import type { Activity, ActivityCore, WeekRow } from '../shared/types.ts'

let nextId = 1

export function makeActivity(over: Partial<Activity> = {}): Activity {
  return {
    id: `a${nextId++}`,
    userId: 'u1',
    date: '2026-03-02',
    startTime: null,
    type: 'run',
    durationSec: 1800,
    distanceM: 5000,
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
    terrainBins: null,
    surfaceBins: null,
    hrQuality: null,
    decouplingPct: null,
    gapDistanceM: null,
    feel: null,
    pain: null,
    heatExposure: null,
    createdAt: '2026-03-02T12:00:00.000Z',
    updatedAt: '2026-03-02T12:00:00.000Z',
    ...over,
  }
}

/** The seven columns `loadActivityCores` returns, for code that reads no more than that. */
export function makeActivityCore(over: Partial<ActivityCore> = {}): ActivityCore {
  return {
    id: `c${nextId++}`,
    date: '2026-03-02',
    type: 'run',
    durationSec: 1800,
    distanceM: 5000,
    duplicateStatus: 'none',
    elevationGainM: null,
    ...over,
  }
}

export function makeWeekRow(over: Partial<WeekRow> = {}): WeekRow {
  return {
    weekStart: '2026-03-02',
    runMin: 0,
    runM: 0,
    runSessions: 0,
    runDays: 0,
    strengthSessions: 0,
    crossMin: 0,
    raceMin: 0,
    longestRunMin: 0,
    longRunShare: null,
    climbM: null,
    avg4wRunMin: 0,
    streak3Plus: 0,
    ...over,
  }
}

/** A run as the Trends loader returns it (`loadRunSeries`): the columns the two run panels read. */
export function trendRun(over: Partial<TrendRun> = {}): TrendRun {
  const { date, type, duplicateStatus, movingSec, gapDistanceM } = makeActivity()
  return {
    date,
    type,
    duplicateStatus,
    durationSec: 7200,
    distanceM: 20_000,
    movingSec,
    gapDistanceM,
    avgHr: null,
    elevationGainM: 40,
    hrHistogram: null,
    tempC: 14,
    humidityPct: null,
    windKph: null,
    decouplingPct: 4,
    terrainBins: null,
    hrQuality: null,
    ...over,
  }
}

/**
 * A steady flat run of 40 minutes on the line HR = 90 + 20 x speed, `daysAgo` days before `today`,
 * with a one-bin heart-rate histogram: the kind of run the heart-rate line is fitted from.
 */
export function steadyTrendRun(today: string, daysAgo: number, speedMps: number): TrendRun {
  const durationSec = 2400
  const avgHr = Math.round(90 + 20 * speedMps)
  return trendRun({
    date: addDays(today, -daysAgo),
    durationSec,
    distanceM: speedMps * durationSec,
    gapDistanceM: speedMps * durationSec,
    elevationGainM: 20,
    avgHr,
    decouplingPct: null,
    hrHistogram: {
      start: 100,
      width: 5,
      sec: Array.from({ length: 20 }, (_, bin) =>
        bin === Math.floor((avgHr - 100) / 5) ? durationSec : 0,
      ),
    },
  })
}

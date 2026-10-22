import type { Activity, WeekRow } from '../shared/types.ts'

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
    decouplingPct: null,
    gapDistanceM: null,
    feel: null,
    pain: null,
    createdAt: '2026-03-02T12:00:00.000Z',
    updatedAt: '2026-03-02T12:00:00.000Z',
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
    avg4wRunMin: 0,
    streak3Plus: 0,
    ...over,
  }
}

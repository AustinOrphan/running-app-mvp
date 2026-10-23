// Fixtures for the Goals page's track record: scored predictions, a recorded race and the record
// the server sends. The figures are synthetic; the default race is a 21.1 km goal that finished
// 4:10 slower than its last prediction, inside the range.
import type { RecordSummary, ScoredPrediction } from '../../shared/engine/backtest.ts'
import type { TrackRecordRace, TrackRecordView } from '../../shared/types.ts'

export function makeScored(over: Partial<ScoredPrediction> = {}): ScoredPrediction {
  return {
    weekStart: '2026-09-28',
    loggedOn: '2026-09-29',
    daysBefore: 12,
    weeksBefore: 1,
    predictedSec: 13_920,
    lowSec: 13_200,
    highSec: 14_640,
    errorSec: 250,
    errorPct: (250 / 13_920) * 100,
    inside: true,
    ...over,
  }
}

/** Three weekly predictions of one race: 3, 2 and 1 weeks before, the last 4:10 under the result. */
export function weeklyPoints(): ScoredPrediction[] {
  return [
    makeScored({
      weekStart: '2026-09-14',
      loggedOn: '2026-09-15',
      daysBefore: 26,
      weeksBefore: 3,
      predictedSec: 14_400,
      lowSec: 13_680,
      highSec: 15_120,
      errorSec: -230,
      errorPct: (-230 / 14_400) * 100,
    }),
    makeScored({
      weekStart: '2026-09-21',
      loggedOn: '2026-09-22',
      daysBefore: 19,
      weeksBefore: 2,
      predictedSec: 14_100,
      lowSec: 13_380,
      highSec: 14_820,
      errorSec: 70,
      errorPct: (70 / 14_100) * 100,
    }),
    makeScored(),
  ]
}

export function makeRace(over: Partial<TrackRecordRace> = {}): TrackRecordRace {
  const points = over.points ?? weeklyPoints()
  return {
    goalId: 'g1',
    goalName: 'Spring half',
    date: '2026-10-11',
    outcome: 'finished',
    resultSec: 14_170,
    points,
    headline: points.at(-1) ?? null,
    inside: true,
    unscoredCount: 0,
    distanceM: 21_098,
    gainM: null,
    activityId: null,
    note: null,
    ...over,
  }
}

export function makeSummary(over: Partial<RecordSummary> = {}): RecordSummary {
  return {
    raceCount: 0,
    insideCount: null,
    medianSignedPct: null,
    medianAbsPct: null,
    enough: false,
    needed: 3,
    ...over,
  }
}

export function makeRecord(
  races: TrackRecordRace[] = [],
  summary: Partial<RecordSummary> = {},
): TrackRecordView {
  return {
    races,
    summary: makeSummary({
      raceCount: races.length,
      needed: Math.max(0, 3 - races.length),
      ...summary,
    }),
  }
}

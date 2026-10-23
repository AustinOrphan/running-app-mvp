// The prediction track record (phase 3a design 11.4): every goal race with a recorded result, its
// weekly predictions scored against it, and the summary across races (rule L7).
//
// The weekly log keeps every row it ever wrote, and weeks from before the weekly log hold several.
// All of a goal's rows load first, each week collapses to its newest row (`newestPerWeek`), and only
// then does the scorer run, so a week counts once however many rows it has.
//
// The record is memoised by data version. `PredictionLog` is non-state, so a log write does not
// raise the version, yet the memo stays correct: it reads only goals that have a result, and a goal
// with a result takes no new log row (`recordPrediction` skips it). Saving, editing or removing a
// result, and renaming a goal, are state writes that rebuild it.
import { scoreRace, summariseRecord } from '../../shared/engine/backtest.ts'
import type { LoggedPrediction } from '../../shared/engine/backtest.ts'
import type { TrackRecordRace, TrackRecordView } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { PrismaClient } from '../db.ts'
import { toLoggedPrediction, toRaceResultInput } from '../serialize.ts'
import { memoByVersion } from './athleteState.ts'
import { newestPerWeek } from './predictionLog.ts'

/** The name of the memoised record; the key adds the user and the data version. */
export const TRACK_RECORD_MEMO = 'track-record'

/** Newest race day first; the same day orders by goal id so the order is stable. */
function newestRaceFirst(a: TrackRecordRace, b: TrackRecordRace): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  return a.goalId < b.goalId ? -1 : a.goalId > b.goalId ? 1 : 0
}

async function buildTrackRecord(
  prisma: Pick<PrismaClient, 'predictionLog' | 'raceResult'>,
  userId: string,
): Promise<TrackRecordView> {
  const results = await prisma.raceResult.findMany({
    where: { userId },
    include: { goal: { select: { name: true } } },
  })
  const rows =
    results.length === 0
      ? []
      : await prisma.predictionLog.findMany({
          where: { userId, goalId: { in: results.map((result) => result.goalId) } },
        })
  const byGoal = new Map<string, LoggedPrediction[]>()
  for (const row of newestPerWeek(rows)) {
    const held = byGoal.get(row.goalId) ?? []
    held.push(toLoggedPrediction(row))
    byGoal.set(row.goalId, held)
  }
  const races: TrackRecordRace[] = results
    .map((result) => ({
      ...scoreRace(byGoal.get(result.goalId) ?? [], toRaceResultInput(result)),
      goalId: result.goalId,
      goalName: result.goal.name,
      distanceM: result.distanceM,
      gainM: result.gainM,
      activityId: result.activityId,
      note: result.note,
    }))
    .sort(newestRaceFirst)
  return { races, summary: summariseRecord(races) }
}

/** `GET /api/predictions/record`: the races newest first, and the summary across them. */
export function loadTrackRecord(deps: Deps, userId: string): Promise<TrackRecordView> {
  return memoByVersion(deps, { userId, name: TRACK_RECORD_MEMO }, () =>
    buildTrackRecord(deps.prisma, userId),
  )
}

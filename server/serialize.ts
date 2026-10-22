import type {
  Activity as ActivityRow,
  Goal as GoalRow,
  ImportBatch as ImportBatchRow,
  Plan as PlanRow,
  PlanWeek as PlanWeekRow,
  PrismaClient,
  WeeklyReview as WeeklyReviewRow,
} from './db.ts'
import type {
  Activity,
  ActivitySource,
  ActivityType,
  DataStatus,
  DuplicateStatus,
  Goal,
  GoalPriority,
  GoalStatus,
  ImportBatch,
  ImportReportRow,
  Phase,
  Plan,
  PlanWeek,
  SuggestedAction,
  Symptoms,
  TargetSource,
  WeeklyReview,
} from '../shared/types.ts'

export function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    startTime: row.startTime,
    type: row.type as ActivityType,
    durationSec: row.durationSec,
    distanceM: row.distanceM,
    rpe: row.rpe,
    avgHr: row.avgHr,
    maxHr: row.maxHr,
    elevationGainM: row.elevationGainM,
    notes: row.notes,
    source: row.source as ActivitySource,
    providerKey: row.providerKey,
    importBatchId: row.importBatchId,
    duplicateOfId: row.duplicateOfId,
    duplicateStatus: row.duplicateStatus as DuplicateStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    priority: row.priority as GoalPriority,
    status: row.status as GoalStatus,
    targetDate: row.targetDate,
    dateProvisional: row.dateProvisional,
    distanceM: row.distanceM,
    location: row.location,
    successCriteria: row.successCriteria,
    notes: row.notes,
    url: row.url,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    userId: row.userId,
    goalId: row.goalId,
    name: row.name,
    startDate: row.startDate,
    raceWeekStart: row.raceWeekStart,
    status: row.status as Plan['status'],
    generatorVersion: row.generatorVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toPlanWeek(row: PlanWeekRow): PlanWeek {
  return {
    id: row.id,
    planId: row.planId,
    weekStart: row.weekStart,
    index: row.index,
    phase: row.phase as Phase,
    focus: row.focus,
    baselineRunMin: row.baselineRunMin,
    targetRunMin: row.targetRunMin,
    targetSource: row.targetSource as TargetSource,
    longRunMin: row.longRunMin,
    day2Min: row.day2Min,
    runDays: row.runDays,
    strengthSessions: row.strengthSessions,
    overrideNote: row.overrideNote,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toWeeklyReview(row: WeeklyReviewRow): WeeklyReview {
  return {
    id: row.id,
    userId: row.userId,
    weekStart: row.weekStart,
    dataStatus: row.dataStatus as DataStatus,
    fatigue: row.fatigue,
    symptoms: row.symptoms as Symptoms | null,
    recoveryConstrained: row.recoveryConstrained,
    suggestedAction: row.suggestedAction as SuggestedAction | null,
    suggestedReason: row.suggestedReason,
    suggestedNextMin: row.suggestedNextMin,
    finalDecision: row.finalDecision,
    finalNextMin: row.finalNextMin,
    notes: row.notes,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function parseReport(text: string): ImportReportRow[] {
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? (value as ImportReportRow[]) : []
  } catch {
    return []
  }
}

export function toImportBatch(row: ImportBatchRow): ImportBatch {
  return {
    id: row.id,
    userId: row.userId,
    source: row.source as ActivitySource,
    fileName: row.fileName,
    rowCount: row.rowCount,
    accepted: row.accepted,
    skippedDuplicate: row.skippedDuplicate,
    skippedInvalid: row.skippedInvalid,
    errors: parseReport(row.errors),
    createdAt: row.createdAt.toISOString(),
  }
}

/** A user's activities, newest first, with flagged duplicates included. Dates are inclusive. */
export async function loadActivities(
  prisma: PrismaClient,
  userId: string,
  opts: { from?: string; to?: string; type?: ActivityType } = {},
): Promise<Activity[]> {
  const rows = await prisma.activity.findMany({
    where: {
      userId,
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.from || opts.to
        ? {
            date: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { createdAt: 'desc' }],
  })
  return rows.map(toActivity)
}

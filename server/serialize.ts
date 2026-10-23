import type {
  Activity as ActivityRow,
  AthleteProfile as AthleteProfileRow,
  Goal as GoalRow,
  ImportBatch as ImportBatchRow,
  Integration as IntegrationRow,
  Plan as PlanRow,
  PlanRevision as PlanRevisionRow,
  PlanSession as PlanSessionRow,
  PlanWeek as PlanWeekRow,
  PredictionLog as PredictionLogRow,
  Screening as ScreeningRow,
  PrismaClient,
  WeeklyReview as WeeklyReviewRow,
  WellnessDay as WellnessDayRow,
} from './db.ts'
import type {
  ChecklistResult,
  EngineWarning,
  ExecutionAssessment,
  Feasibility,
  PlanChange,
  SessionFlag,
  SessionKind,
  SessionSpec,
  SessionTarget,
  Step,
} from '../shared/engine/types.ts'
import type {
  Activity,
  ActivityCore,
  ActivityType,
  Checkin,
  AthleteProfile,
  Availability,
  DataStatus,
  DuplicateStatus,
  Feel,
  Goal,
  GoalPriority,
  GoalStatus,
  GoalSurface,
  GoalType,
  HrHistogram,
  ImportBatch,
  ImportReportRow,
  Injury,
  IntegrationStatus,
  Plan,
  Phase,
  PlanRevision,
  PlanRevisionReason,
  PlanSession,
  PlanSessionStatus,
  PlanWeek,
  PredictionView,
  Screening,
  SupportLevel,
  ProviderInfo,
  SuggestedAction,
  Symptoms,
  TargetSource,
  Terrain,
  Weekday,
  WeeklyReview,
  WellnessDay,
} from '../shared/types.ts'

/** Parses stored JSON text; any failure gives `fallback`. */
function parseJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

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
    source: row.source,
    providerKey: row.providerKey,
    importBatchId: row.importBatchId,
    duplicateOfId: row.duplicateOfId,
    duplicateStatus: row.duplicateStatus as DuplicateStatus,
    subtype: row.subtype,
    startUtc: row.startUtc,
    utcOffsetMin: row.utcOffsetMin,
    movingSec: row.movingSec,
    elevationLossM: row.elevationLossM,
    avgCadence: row.avgCadence,
    avgPowerW: row.avgPowerW,
    deviceName: row.deviceName,
    startLat: row.startLat,
    startLng: row.startLng,
    tempC: row.tempC,
    dewPointC: row.dewPointC,
    windKph: row.windKph,
    humidityPct: row.humidityPct,
    weatherSource: row.weatherSource as Activity['weatherSource'],
    hrHistogram: parseJson<HrHistogram | null>(row.hrHistogram, null),
    decouplingPct: row.decouplingPct,
    gapDistanceM: row.gapDistanceM,
    feel: row.feel as Feel | null,
    pain: row.pain,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export function defaultAvailability(): Availability {
  return Object.fromEntries(
    WEEKDAYS.map((day) => [day, { available: true, maxMin: null }]),
  ) as Availability
}

export function defaultTerrain(): Terrain {
  return { trail: false, hills: false, treadmill: false, track: false }
}

/** The profile of a user who has not saved one. */
export function defaultProfile(): AthleteProfile {
  return {
    birthYear: null,
    sex: null,
    heightCm: null,
    weightKg: null,
    hrMax: null,
    hrMaxSource: null,
    hrRest: null,
    lthr: null,
    thresholdPaceSecPerKm: null,
    runningSinceYear: null,
    injuries: [],
    availability: defaultAvailability(),
    longRunDay: 'sat',
    terrain: defaultTerrain(),
    strengthPreference: 2,
    timezone: 'UTC',
    homeLat: null,
    homeLng: null,
    useHomeWeather: true,
  }
}

export function toProfile(row: AthleteProfileRow): AthleteProfile {
  const stored = parseJson<Partial<Availability>>(row.availability, {})
  const availability = defaultAvailability()
  for (const day of WEEKDAYS) {
    const entry = stored[day]
    if (entry) availability[day] = { available: entry.available, maxMin: entry.maxMin ?? null }
  }
  return {
    birthYear: row.birthYear,
    sex: row.sex as AthleteProfile['sex'],
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    hrMax: row.hrMax,
    hrMaxSource: row.hrMaxSource as AthleteProfile['hrMaxSource'],
    hrRest: row.hrRest,
    lthr: row.lthr,
    thresholdPaceSecPerKm: row.thresholdPaceSecPerKm,
    runningSinceYear: row.runningSinceYear,
    injuries: parseJson<Injury[]>(row.injuries, []),
    availability,
    longRunDay: row.longRunDay as Weekday,
    terrain: { ...defaultTerrain(), ...parseJson<Partial<Terrain>>(row.terrain, {}) },
    strengthPreference: row.strengthPreference as AthleteProfile['strengthPreference'],
    timezone: row.timezone,
    homeLat: row.homeLat,
    homeLng: row.homeLng,
    useHomeWeather: row.useHomeWeather,
  }
}

/** The saved profile, or the defaults when the user has none. */
export async function loadProfile(prisma: PrismaClient, userId: string): Promise<AthleteProfile> {
  const row = await prisma.athleteProfile.findUnique({ where: { userId } })
  return row ? toProfile(row) : defaultProfile()
}

export function toWellnessDay(row: WellnessDayRow): WellnessDay {
  return {
    id: row.id,
    date: row.date,
    restingHr: row.restingHr,
    hrvRmssd: row.hrvRmssd,
    hrvSdnn: row.hrvSdnn,
    sleepSec: row.sleepSec,
    sleepScore: row.sleepScore,
    weightKg: row.weightKg,
    vo2max: row.vo2max,
    notes: row.notes,
    source: row.source,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** `row` is null for a provider the user has not connected. Secrets never leave the server. */
export function toIntegrationStatus(
  row: IntegrationRow | null,
  info: ProviderInfo,
): IntegrationStatus {
  if (!row) {
    return {
      provider: info.key,
      info,
      status: 'disconnected',
      config: {},
      pushEnabled: false,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
    }
  }
  return {
    provider: info.key,
    info,
    status: row.status as IntegrationStatus['status'],
    config: parseJson<Record<string, unknown>>(row.config, {}),
    pushEnabled: row.ingestTokenHash !== null,
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    lastSyncStatus: row.lastSyncStatus,
    lastError: row.lastError,
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
    gainM: row.gainM,
    lossM: row.lossM,
    surface: row.surface as GoalSurface,
    goalType: row.goalType as GoalType,
    targetTimeSec: row.targetTimeSec,
    startTime: row.startTime,
    raceLat: row.raceLat,
    raceLng: row.raceLng,
    supportLevel: row.supportLevel as SupportLevel,
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
    paramsVersion: row.paramsVersion,
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
    tid: parseJson<PlanWeek['tid']>(row.tid, null),
    flags: parseJson<string[]>(row.flags, []),
    gainTargetM: row.gainTargetM,
    qualitySessions: row.qualitySessions,
    isRecovery: row.isRecovery,
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

/** The version-2 columns of a plan that `toPlan` leaves out. */
export function toPlanEngineFields(row: PlanRow): {
  feasibility: Feasibility | null
  warnings: EngineWarning[]
  checklist: ChecklistResult[]
  options: Record<string, unknown>
} {
  return {
    feasibility: parseJson<Feasibility | null>(row.feasibility, null),
    warnings: parseJson<EngineWarning[]>(row.warnings, []),
    checklist: parseJson<ChecklistResult[]>(row.checklist, []),
    options: parseJson<Record<string, unknown>>(row.options, {}),
  }
}

/** The rule id that marks a session the engine or an execution trim eased [design 4.3]. */
const TRIM_RULE = 'design-4.3'

/**
 * Whether a session's rule ids mark it as trimmed. The one derivation of `PlanSession.trimmed`: every
 * write of `rules` sets the column through this function, and nothing scans the stored JSON text.
 */
export function isTrimmed(rules: readonly string[]): boolean {
  return rules.includes(TRIM_RULE)
}

export function toPlanSession(row: PlanSessionRow): PlanSession {
  return {
    id: row.id,
    externalId: row.externalId,
    planId: row.planId,
    weekStart: row.weekStart,
    date: row.date,
    order: row.order,
    kind: row.kind as SessionKind,
    title: row.title,
    durationMin: row.durationMin,
    distanceM: row.distanceM,
    gainM: row.gainM,
    structure: parseJson<Step[]>(row.structure, []),
    target: parseJson<SessionTarget>(row.target, {
      zone: 'rest',
      rpe: [0, 0],
      hr: null,
      paceSecPerKm: null,
      heatNote: null,
    }),
    purpose: row.purpose,
    rules: parseJson<string[]>(row.rules, []),
    flags: parseJson<SessionFlag[]>(row.flags, []),
    status: row.status as PlanSessionStatus,
    activityId: row.activityId,
    linkSource: row.linkSource as PlanSession['linkSource'],
    execution: parseJson<ExecutionAssessment | null>(row.execution, null),
    original: parseJson<Partial<SessionSpec> | null>(row.original, null),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toPlanRevision(row: PlanRevisionRow): PlanRevision {
  return {
    id: row.id,
    planId: row.planId,
    createdAt: row.createdAt.toISOString(),
    reason: row.reason as PlanRevisionReason,
    summary: row.summary,
    changes: parseJson<PlanChange[]>(row.changes, []),
  }
}

/** The check-in fields of a wellness row; null when none of them was ever filled in. */
export function toCheckin(row: WellnessDayRow): Checkin | null {
  const filled =
    row.fatigue !== null ||
    row.soreness !== null ||
    row.sleepQuality !== null ||
    row.mood !== null ||
    row.stress !== null ||
    row.illness ||
    row.painScore !== null ||
    row.painArea !== null ||
    row.painFocalBone
  if (!filled) return null
  return {
    date: row.date,
    fatigue: row.fatigue,
    soreness: row.soreness,
    sleepQuality: row.sleepQuality,
    mood: row.mood,
    stress: row.stress,
    illness: row.illness,
    painScore: row.painScore,
    painArea: row.painArea,
    painFocalBone: row.painFocalBone,
  }
}

export function toScreening(row: ScreeningRow): Screening {
  return {
    id: row.id,
    date: row.date,
    kind: row.kind as Screening['kind'],
    answers: parseJson<Screening['answers']>(row.answers, {}),
    flags: row.flags,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toPredictionLogEntry(row: PredictionLogRow): PredictionView['log'][number] {
  return {
    id: row.id,
    goalId: row.goalId,
    createdAt: row.createdAt.toISOString(),
    method: row.method,
    predictedSec: row.predictedSec,
    lowSec: row.lowSec,
    highSec: row.highSec,
    actualSec: row.actualSec,
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
    source: row.source,
    fileName: row.fileName,
    rowCount: row.rowCount,
    accepted: row.accepted,
    skippedDuplicate: row.skippedDuplicate,
    skippedInvalid: row.skippedInvalid,
    errors: parseReport(row.errors),
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * A user's activities as the six columns the week rows and the statistics read, in no particular
 * order, with flagged duplicates included. Dates are inclusive.
 */
export async function loadActivityCores(
  prisma: Pick<PrismaClient, 'activity'>,
  userId: string,
  opts: { from?: string; to?: string } = {},
): Promise<ActivityCore[]> {
  const rows = await prisma.activity.findMany({
    where: {
      userId,
      ...(opts.from || opts.to
        ? {
            date: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      date: true,
      type: true,
      durationSec: true,
      distanceM: true,
      duplicateStatus: true,
    },
  })
  return rows.map((row) => ({
    ...row,
    type: row.type as ActivityType,
    duplicateStatus: row.duplicateStatus as DuplicateStatus,
  }))
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

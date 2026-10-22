import type {
  Activity as ActivityRow,
  AthleteProfile as AthleteProfileRow,
  Goal as GoalRow,
  ImportBatch as ImportBatchRow,
  Integration as IntegrationRow,
  Plan as PlanRow,
  PlanWeek as PlanWeekRow,
  PrismaClient,
  WeeklyReview as WeeklyReviewRow,
  WellnessDay as WellnessDayRow,
} from './db.ts'
import type {
  Activity,
  ActivityType,
  AthleteProfile,
  Availability,
  DataStatus,
  DuplicateStatus,
  Feel,
  Goal,
  GoalPriority,
  GoalStatus,
  HrHistogram,
  ImportBatch,
  ImportReportRow,
  Injury,
  IntegrationStatus,
  Phase,
  Plan,
  PlanWeek,
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

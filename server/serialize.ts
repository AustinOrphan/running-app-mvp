import type {
  Activity as ActivityRow,
  AthleteProfile as AthleteProfileRow,
  Disruption as DisruptionRow,
  FuelLog as FuelLogRow,
  FuelProduct as FuelProductRow,
  FuelSettings as FuelSettingsRow,
  Goal as GoalRow,
  ImportBatch as ImportBatchRow,
  Integration as IntegrationRow,
  Plan as PlanRow,
  PlanRevision as PlanRevisionRow,
  PlanSession as PlanSessionRow,
  PlanWeek as PlanWeekRow,
  PredictionLog as PredictionLogRow,
  RaceResult as RaceResultRow,
  Screening as ScreeningRow,
  PrismaClient,
  WeeklyReview as WeeklyReviewRow,
  WellnessDay as WellnessDayRow,
} from './db.ts'
import type {
  CourseSnapshot,
  LoggedPrediction,
  RaceOutcome,
  RaceResultInput,
} from '../shared/engine/backtest.ts'
import type {
  ChecklistResult,
  EngineWarning,
  ExecutionAssessment,
  Feasibility,
  LadderStep,
  PlanChange,
  SessionFlag,
  SessionKind,
  SessionSpec,
  SessionTarget,
  Step,
  WeeklyDecision,
} from '../shared/engine/types.ts'
import { undoReasonMessage } from '../shared/copy/revision.ts'
import { countsLine } from '../shared/engine/fuelCopy.ts'
import { P } from '../shared/engine/params/index.ts'
import { revisionUndoReason } from '../shared/engine/undoGuard.ts'
import type {
  Activity,
  ActivityCore,
  ActivityListItem,
  ActivityListPage,
  ActivityType,
  ChangeLine,
  Checkin,
  AthleteProfile,
  Availability,
  DataStatus,
  Disruption,
  DisruptionMode,
  DisruptionReason,
  DisruptionStatus,
  DuplicateStatus,
  Feel,
  FuelLogItem,
  FuelLogView,
  FuelProduct,
  FuelProductKind,
  FuelSettings,
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
  PlanDiff,
  PlanRevisionReason,
  PlanRevisionView,
  PlanSession,
  PlanSessionStatus,
  PlanWeek,
  PredictionView,
  RaceResultView,
  Screening,
  SupportLevel,
  ProviderInfo,
  SuggestedAction,
  Symptoms,
  TargetSource,
  Terrain,
  UndoState,
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

/** An activity row read without its heart-rate histogram (`ACTIVITY_LIST_OMIT`). */
export type ActivityListRow = Omit<ActivityRow, 'hrHistogram'>

export function toActivityListItem(row: ActivityListRow): ActivityListItem {
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
    decouplingPct: row.decouplingPct,
    gapDistanceM: row.gapDistanceM,
    feel: row.feel as Feel | null,
    pain: row.pain,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toActivity(row: ActivityRow): Activity {
  return {
    ...toActivityListItem(row),
    hrHistogram: parseJson<HrHistogram | null>(row.hrHistogram, null),
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

/**
 * Whether a revision can be undone, as far as the revision itself says: it has a payload, is not
 * undone, is not an undo and is younger than the undo window. The structural checks that read
 * other rows (`undoStates` in `services/revisions.ts`) refine it; a caller that holds no rows gets
 * this, so `available` then means only that none of those reasons applies.
 */
function ownUndoState(row: PlanRevisionRow, now: Date): UndoState {
  const days = P.revision.undoWindowDays.value
  const code = revisionUndoReason(
    {
      reason: row.reason,
      hasPayload: row.undo !== null,
      undone: row.undoneAt !== null,
      createdAtMs: row.createdAt.getTime(),
      planActive: true,
    },
    now.getTime(),
    days,
  )
  return {
    available: code === null,
    reasons: code === null ? [] : [{ code, message: undoReasonMessage(code, days) }],
    undoneAt: row.undoneAt?.toISOString() ?? null,
  }
}

/** A revision row without its undo payload, as a list reads it: the payload is not selected. */
export type PlanRevisionListRow = Omit<PlanRevisionRow, 'undo'>

/** A revision as the API serves it, with the undo state computed by the caller. */
export function revisionView(row: PlanRevisionListRow, undo: UndoState): PlanRevisionView {
  return {
    id: row.id,
    planId: row.planId,
    createdAt: row.createdAt.toISOString(),
    reason: row.reason as PlanRevisionReason,
    summary: row.summary,
    changes: parseJson<PlanChange[]>(row.changes, []),
    auto: row.auto,
    decision: parseJson<WeeklyDecision | null>(row.decision, null),
    diff: parseJson<PlanDiff | null>(row.diff, null),
    undo,
    seenAt: row.seenAt?.toISOString() ?? null,
    undoOf: row.undoOf,
    disruptionId: row.disruptionId,
  }
}

/**
 * A full revision row as the API serves it. The undo payload never leaves the server, and only the
 * revision's own reasons are known without the rows it touched: this is the view right after a
 * write, inside its transaction. `viewRevisions` in `services/revisions.ts` adds the structural
 * checks.
 */
export function toPlanRevision(row: PlanRevisionRow, now: Date = new Date()): PlanRevisionView {
  return revisionView(row, ownUndoState(row, now))
}

/** A stored rest or limited-running window as the API serves it. */
export function toDisruption(row: DisruptionRow): Disruption {
  return {
    id: row.id,
    reason: row.reason as DisruptionReason,
    mode: row.mode as DisruptionMode,
    startDate: row.startDate,
    endDate: row.endDate,
    maxRunMin: row.maxRunMin,
    area: row.area,
    pain: row.pain,
    gaitChange: row.gaitChange,
    note: row.note,
    status: row.status as DisruptionStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The three columns of a revision that the Today change line reads. */
export type ChangeLineRow = Pick<PlanRevisionRow, 'id' | 'createdAt' | 'reason' | 'summary'>

/** A revision as the Today change line shows it: its stored summary and nothing else. */
export function toChangeLine(row: ChangeLineRow): ChangeLine {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    reason: row.reason as PlanRevisionReason,
    summary: row.summary,
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

export function toFuelProduct(row: FuelProductRow): FuelProduct {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as FuelProductKind,
    servingLabel: row.servingLabel,
    carbsG: row.carbsG,
    sodiumMg: row.sodiumMg,
    kcal: row.kcal,
    multiCarb: row.multiCarb,
    archived: row.archived,
  }
}

/** The switches before the runner has saved any: no opt-in, no condition, the block on. */
export function defaultFuelSettings(): FuelSettings {
  return { optIn90: false, optInAdvanced: false, giDisease: false, gutBlock: true }
}

export function toFuelSettings(row: FuelSettingsRow | null): FuelSettings {
  if (row === null) return defaultFuelSettings()
  return {
    optIn90: row.optIn90,
    optInAdvanced: row.optInAdvanced,
    giDisease: row.giDisease,
    gutBlock: row.gutBlock,
  }
}

/** The items snapshot of a log row. */
export function parseFuelItems(text: string): FuelLogItem[] {
  return parseJson<FuelLogItem[]>(text, [])
}

/** A fuel log with the step the replay gave its run. */
export function toFuelLogView(row: FuelLogRow, step: LadderStep): FuelLogView {
  return {
    id: row.id,
    activityId: row.activityId,
    skipped: row.skipped,
    items: parseFuelItems(row.items),
    fluidMl: row.fluidMl,
    sodiumMg: row.sodiumMg,
    gut: row.gut,
    nausea: row.nausea,
    hot: row.hotOverride,
    notes: row.notes,
    step,
    counts: countsLine(step),
  }
}

export function toPredictionLogEntry(row: PredictionLogRow): PredictionView['log'][number] {
  return {
    id: row.id,
    goalId: row.goalId,
    createdAt: row.createdAt.toISOString(),
    weekStart: row.weekStart,
    loggedOn: row.loggedOn,
    method: row.method,
    predictedSec: row.predictedSec,
    lowSec: row.lowSec,
    highSec: row.highSec,
    actualSec: row.actualSec,
  }
}

/**
 * A log row as the back-test scorer reads it. `course` comes from the `inputs.course` snapshot and
 * is null for a row logged before snapshots existed, which the scorer takes as comparable; a figure
 * the snapshot lacks is null as well.
 */
export function toLoggedPrediction(row: PredictionLogRow): LoggedPrediction {
  const inputs = parseJson<{ course?: unknown }>(row.inputs, {})
  const stored = inputs.course
  const figure = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  const course: CourseSnapshot | null =
    typeof stored === 'object' && stored !== null
      ? {
          distanceM: figure((stored as Record<string, unknown>).distanceM),
          gainM: figure((stored as Record<string, unknown>).gainM),
        }
      : null
  return {
    weekStart: row.weekStart,
    loggedOn: row.loggedOn,
    predictedSec: row.predictedSec,
    lowSec: row.lowSec,
    highSec: row.highSec,
    course,
  }
}

/** A stored race result as the back-test scorer reads it. */
export function toRaceResultInput(row: RaceResultRow): RaceResultInput {
  return {
    date: row.date,
    outcome: row.outcome as RaceOutcome,
    timeSec: row.timeSec,
    distanceM: row.distanceM,
    gainM: row.gainM,
  }
}

/** A stored race result with what saving it did: the weeks compared and whether it retyped a run. */
export function toRaceResultView(
  row: RaceResultRow,
  saved: Pick<RaceResultView, 'scoredPredictions' | 'activityMarkedAsRace'>,
): RaceResultView {
  return {
    id: row.id,
    goalId: row.goalId,
    activityId: row.activityId,
    date: row.date,
    distanceM: row.distanceM,
    gainM: row.gainM,
    outcome: row.outcome as RaceOutcome,
    timeSec: row.timeSec,
    note: row.note,
    scoredPredictions: saved.scoredPredictions,
    activityMarkedAsRace: saved.activityMarkedAsRace,
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

/** The column a list never reads: the heart-rate histogram is the largest and only the detail needs it. */
const ACTIVITY_LIST_OMIT = { hrHistogram: true } as const

/** The `where` of a user's activities in an inclusive date range, optionally of one type. */
function activityWhere(userId: string, opts: { from?: string; to?: string; type?: ActivityType }) {
  return {
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
  }
}

/** A user's activities, newest first, with flagged duplicates included. Dates are inclusive. */
export async function loadActivities(
  prisma: PrismaClient,
  userId: string,
  opts: { from?: string; to?: string; type?: ActivityType } = {},
): Promise<Activity[]> {
  const rows = await prisma.activity.findMany({
    where: activityWhere(userId, opts),
    orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { createdAt: 'desc' }],
  })
  return rows.map(toActivity)
}

/**
 * One page of a user's activities, newest first, without the heart-rate histogram. The order is
 * total (date, start time, creation time, then `id`), so a row is never repeated or skipped
 * between two pages of an unchanged list. Offset paging, not a cursor: `startTime` is nullable.
 * The count and the page are two reads, not a transaction (a transaction ends with a data-version
 * bump), so a write between them can leave `total` one off until the next request. The count is
 * read after the page: a row inserted before the page read pushes the last row of the list onto
 * the following page, and a count taken afterwards includes the new row, so `next < total` still
 * offers that page. A count taken first would be one short and end the list a row early.
 */
export async function loadActivityPage(
  prisma: Pick<PrismaClient, 'activity'>,
  userId: string,
  opts: { from?: string; to?: string; type?: ActivityType; limit: number; offset: number },
): Promise<ActivityListPage> {
  const where = activityWhere(userId, opts)
  const rows = await prisma.activity.findMany({
    where,
    omit: ACTIVITY_LIST_OMIT,
    orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    skip: opts.offset,
    take: opts.limit,
  })
  const total = await prisma.activity.count({ where })
  const next = opts.offset + rows.length
  return {
    items: rows.map(toActivityListItem),
    total,
    limit: opts.limit,
    offset: opts.offset,
    nextOffset: rows.length > 0 && next < total ? next : null,
  }
}

import type { RaceOutcome, RaceScore, RecordSummary } from './engine/backtest.ts'
import type { FuelTargetText } from './engine/fuelCopy.ts'
import type {
  AthleteState,
  BriefDecision,
  BriefFacts,
  BriefReplanCode,
  Checkin,
  EahCard,
  EngineWarning,
  ChecklistResult,
  ExecutionAssessment,
  Feasibility,
  FuelItem,
  FuelTarget,
  Grade,
  InputFact,
  LadderResult,
  LadderStep,
  Param,
  PlanChange,
  Prediction,
  ReadinessSnapshot,
  ResolvedTargets,
  SessionBrief,
  SessionFlag,
  SessionKind,
  SessionSpec,
  SessionTarget,
  Step,
  WeeklyDecision,
  ZoneProposal,
  ZoneSet,
} from './engine/types.ts'

export type { Checkin }

export type ActivityType = 'run' | 'race' | 'strength' | 'cross'
/** `manual`, `smashrun`, `csv`, `file`, or a provider registry key such as `intervals`. */
export type ActivitySource = string
export type DuplicateStatus = 'none' | 'possible' | 'confirmed' | 'dismissed'
export interface Activity {
  id: string
  userId: string
  date: string
  startTime: string | null
  type: ActivityType
  durationSec: number
  distanceM: number | null
  rpe: number | null
  avgHr: number | null
  maxHr: number | null
  elevationGainM: number | null
  notes: string | null
  source: ActivitySource
  providerKey: string | null
  importBatchId: string | null
  duplicateOfId: string | null
  duplicateStatus: DuplicateStatus
  subtype: string | null
  startUtc: string | null
  utcOffsetMin: number | null
  movingSec: number | null
  elevationLossM: number | null
  avgCadence: number | null
  avgPowerW: number | null
  deviceName: string | null
  startLat: number | null
  startLng: number | null
  tempC: number | null
  dewPointC: number | null
  windKph: number | null
  humidityPct: number | null
  weatherSource: 'open-meteo' | 'provider' | 'manual' | null
  hrHistogram: HrHistogram | null
  decouplingPct: number | null
  gapDistanceM: number | null
  /** -2 much easier .. +2 much harder than expected. */
  feel: Feel | null
  /** 0-10. */
  pain: number | null
  createdAt: string
  updatedAt: string
}
/**
 * The six columns the week rows and the statistics read. The server loads these
 * (`loadActivityCores`) instead of whole activities, which also carry a heart-rate histogram.
 */
export type ActivityCore = Pick<
  Activity,
  'id' | 'date' | 'type' | 'durationSec' | 'distanceM' | 'duplicateStatus'
>
/**
 * An activity as the list shows it: every column but the heart-rate histogram, which is the
 * largest and is read only by the detail route (`GET /api/activities/:id`).
 */
export type ActivityListItem = Omit<Activity, 'hrHistogram'>
/**
 * `GET /api/activities`: one page of the list, newest first. `nextOffset` is the `offset` of the
 * next page, or null on the last one; `total` counts every row the filters match.
 */
export interface ActivityListPage {
  items: ActivityListItem[]
  total: number
  limit: number
  offset: number
  nextOffset: number | null
}
/** The fastest run for one standard distance. */
export interface FastestEffort {
  label: string
  targetM: number
  activityId: string
  date: string
  distanceM: number
  durationSec: number
  paceSecPerKm: number
}
/** Run totals for one month or one year. */
export interface PeriodTotal {
  runMin: number
  runM: number
  runs: number
  longestRunMin: number
}
/** `GET /api/stats`: the statistics of the whole history, computed on the server. */
export interface StatsView {
  monthly: Array<PeriodTotal & { month: string }>
  yearly: Array<PeriodTotal & { year: string }>
  efforts: FastestEffort[]
  /** The longest runs, longest first. */
  longest: ActivityCore[]
}
export type Feel = -2 | -1 | 0 | 1 | 2
/** Aligned arrays of equal length; `null` when the source had no such channel. */
export interface ActivityStreamData {
  t: number[]
  d: number[] | null
  hr: number[] | null
  alt: number[] | null
  cad: number[] | null
  pwr: number[] | null
}
export interface Lap {
  startSec: number
  durationSec: number
  distanceM: number | null
  avgHr: number | null
  maxHr: number | null
  avgCadence: number | null
}
/** Heart-rate bins of `width` bpm starting at `start`; `sec` holds the seconds in each bin. */
export interface HrHistogram {
  start: number
  width: number
  sec: number[]
}
export interface Injury {
  area: string
  side: 'left' | 'right' | 'both' | null
  year: number
  month: number | null
  kind: 'bone-stress' | 'tendon' | 'muscle' | 'joint' | 'other'
  notes: string | null
}
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type Availability = Record<Weekday, { available: boolean; maxMin: number | null }>
export interface Terrain {
  trail: boolean
  hills: boolean
  treadmill: boolean
  track: boolean
}
/** One activity as read from a file or a provider, before it is stored. */
export interface ParsedActivity {
  providerKey: string
  startUtc: string
  utcOffsetMin: number | null
  type: ActivityType
  subtype: string | null
  elapsedSec: number
  movingSec: number | null
  distanceM: number | null
  elevationGainM: number | null
  elevationLossM: number | null
  avgHr: number | null
  maxHr: number | null
  avgCadence: number | null
  avgPowerW: number | null
  deviceName: string | null
  startLat: number | null
  startLng: number | null
  /** Seconds from the start, as recorded. */
  samples: {
    t: number[]
    d: number[] | null
    hr: number[] | null
    alt: number[] | null
    cad: number[] | null
    pwr: number[] | null
  }
  laps: Lap[]
}
export interface AthleteProfile {
  birthYear: number | null
  sex: 'female' | 'male' | 'unspecified' | null
  heightCm: number | null
  weightKg: number | null
  hrMax: number | null
  hrMaxSource: 'measured' | 'estimated' | null
  hrRest: number | null
  lthr: number | null
  thresholdPaceSecPerKm: number | null
  runningSinceYear: number | null
  injuries: Injury[]
  availability: Availability
  longRunDay: Weekday
  terrain: Terrain
  strengthPreference: 0 | 1 | 2 | 3
  timezone: string
  homeLat: number | null
  homeLng: number | null
  useHomeWeather: boolean
}
export interface WellnessInput {
  date: string
  restingHr: number | null
  hrvRmssd: number | null
  hrvSdnn: number | null
  sleepSec: number | null
  sleepScore: number | null
  weightKg: number | null
  vo2max: number | null
}
export interface WellnessDay extends WellnessInput {
  id: string
  notes: string | null
  /** `manual` or a provider registry key. */
  source: string
  updatedAt: string
}
export interface ProviderInfo {
  key: string
  label: string
  experimental: boolean
  channels: Array<'pull' | 'push' | 'upload' | 'folder' | 'publish'>
  wellness: boolean
  docsUrl: string
}
export interface IntegrationStatus {
  provider: string
  info: ProviderInfo
  status: 'disconnected' | 'connected' | 'needs_auth' | 'error'
  config: Record<string, unknown>
  pushEnabled: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastError: string | null
}

// The sync and job log (spec 4.7): one finished run per row.
export type SyncChannel = 'pull' | 'push' | 'folder' | 'publish' | 'job'
export type SyncTrigger = 'schedule' | 'manual' | 'push' | 'catchup'
export type SyncStatus = 'ok' | 'partial' | 'paused' | 'error'
export type WellnessStatus = 'none' | 'read' | 'truncated' | 'waiting' | 'error'
/** An item a run could not import: what it was, and the service's own words for why. */
export interface SyncFailure {
  ref: string
  reason: string
}
export interface SyncRunView {
  id: string
  /** The provider key; for channel `job`, the job name. */
  provider: string
  channel: SyncChannel
  trigger: SyncTrigger
  startedAt: string
  finishedAt: string
  status: SyncStatus
  accepted: number
  duplicate: number
  failed: number
  wellnessStatus: WellnessStatus
  /** Days read; for `truncated`, the days read before the service's limit. Null when not tried. */
  wellnessDays: number | null
  /** Days the run meant to read; set only for `truncated`. */
  wellnessTotal: number | null
  /** What the service or the system said, scrubbed of secrets and cut at 300 characters. */
  message: string | null
  /** The first 10 items that could not be imported. */
  failures: SyncFailure[]
  importBatchId: string | null
}
/** Whether this week's automatic plan update has run, for Today's health note. */
export interface WeeklyUpdateStatus {
  due: boolean
  lastRevisionAt: string | null
}
/** `GET /api/jobs`: the latest run of each scheduled job. */
export interface JobsView {
  jobs: SyncRunView[]
  weeklyUpdate: WeeklyUpdateStatus
}

// Sessions on the wrist (phase 3a design 6.4): what the intervals.icu publisher holds per session.
/**
 * Where a session stands on the way to the watch. `not-sent`: publishing is on and the session has
 * no publication yet; `waiting`: the app will send (again) by itself, at `retryAt` when it is
 * known; `sent`: intervals.icu has it; `on-watch`: sent, the runner ticked the Garmin upload, no
 * device error and 15 minutes have passed; `not-delivered`: the runner has to act (reconnect,
 * change something, send again) or Garmin Connect reported a problem; `removed`: the runner deleted
 * the event in intervals.icu, so the app leaves it alone; `withdrawn`: the app took it off the
 * watch (a rest day, a skipped session).
 */
export type WristItemStatus =
  'not-sent' | 'waiting' | 'sent' | 'on-watch' | 'not-delivered' | 'removed' | 'withdrawn'
export interface WristItem {
  /** `PlanSession.externalId`: the join key with a session (publications hold no foreign key). */
  externalId: string
  /** The session's id in the active plan; null when the plan no longer holds the session. */
  sessionId: string | null
  /** The session's day when the plan still holds it, else the day the publication was made for. */
  date: string
  kind: string
  /** The allowlisted public title that went out ("Easy run, 45 min"). */
  title: string
  variant: 'planned' | 'eased'
  status: WristItemStatus
  /** Why the last send did not go through: `PublishFailCode`; null when it did. */
  failCode: string | null
  /** A sentence about that, sanitised and at most 200 characters. */
  failMessage: string | null
  /** What intervals.icu reports about the Garmin upload; null when it reports nothing. */
  deviceMessage: string | null
  /** Codes of what the text could not carry: `unparsed-steps`, `no-max-hr`, `no-threshold-pace`. */
  warnings: string[]
  /** When the app tries again by itself; null when it waits for new content or "Send again". */
  retryAt: string | null
  sentAt: string | null
}
/** The runner's choices for the intervals.icu publisher (`PUT /api/wrist/intervals`). */
export interface WristSettings {
  enabled: boolean
  /** The runner ticked that intervals.icu uploads planned workouts to Garmin Connect. */
  garminLinked: boolean
  lastRunAt: string | null
  /** A run for this runner is in progress. */
  running: boolean
}
/**
 * The private calendar link (`POST`/`DELETE /api/wrist/calendar/token`). The token is shown once,
 * when it is made, and never read back, so this holds only whether a link works and since when.
 */
export interface WristCalendar {
  enabled: boolean
  tokenCreatedAt: string | null
}
/** The answer to `POST /api/wrist/calendar/token`: the only time the token exists in the clear. */
export interface CalendarTokenIssued {
  token: string
  /** The feed's path on this server; the client adds its own origin. */
  path: string
  createdAt: string
}
/** `GET /api/wrist/status`: the publisher's settings and one item per session in the range. */
export interface WristStatus {
  from: string
  to: string
  /** The intervals.icu connection: `needs_auth` asks for a reconnect. */
  connection: 'disconnected' | 'connected' | 'needs_auth' | 'error'
  settings: WristSettings
  calendar: WristCalendar
  items: WristItem[]
}
/** Why a workout file is not made: the `details.reason` of a refused download. */
export type WorkoutFileRefusal = 'not-a-run' | 'settled' | 'rest-advice' | 'empty'
/**
 * `GET /api/plan/sessions/:id/workout`: what the session sheet shows of a session's workout. The
 * targets are the session as planned, resolved against the current zones and the day's heat (the
 * same resolver as Today, the file and the watch); `eased` says the watch and the file carry the
 * easy version today; `file` says whether the download is possible and, if not, why.
 */
export interface SessionWorkoutView {
  targets: ResolvedTargets
  eased: boolean
  file: { available: true } | { available: false; reason: Exclude<WorkoutFileRefusal, 'empty'> }
}

export interface ActivityDetail {
  activity: Activity
  stream: (ActivityStreamData & { sampleSec: number }) | null
  laps: Lap[] | null
  hasFile: boolean
}
export interface UploadedFile {
  name: string
  bytes: Uint8Array
}
export interface WeekRow {
  weekStart: string
  runMin: number
  runM: number
  runSessions: number
  runDays: number
  strengthSessions: number
  crossMin: number
  raceMin: number
  longestRunMin: number
  longRunShare: number | null
  avg4wRunMin: number
  /** Consecutive weeks ending here with 3 or more runs, counted up to 52 (`STREAK_LOOKBACK_WEEKS`). */
  streak3Plus: number
}
export type Phase =
  'restart' | 'base1' | 'base2' | 'endurance' | 'specific' | 'peak' | 'taper' | 'race'
/** Phases a stored plan week may carry: version-1 plans use `Phase`; version-2 plans add `base` and `build`. */
export type PlanPhase = Phase | 'base' | 'build'
export type DistanceClass = 'short' | 'half' | 'marathon' | 'ultra50' | 'ultra100'
export type TargetSource = 'baseline' | 'review' | 'override'
export interface PlanWeek {
  id: string
  planId: string
  weekStart: string
  index: number
  phase: PlanPhase
  focus: string | null
  baselineRunMin: number
  targetRunMin: number
  targetSource: TargetSource
  longRunMin: number
  day2Min: number | null
  runDays: number
  strengthSessions: number
  overrideNote: string | null
  /** Version-2 plans only: TID targets in percent of running time. */
  tid: { z1: number; z2: number; z3: number } | null
  /**
   * Version-2 plans only: recovery, taper, strength, gut-training, heat-acclimation, and the two a
   * rest window sets: `disrupted` (a window touches a day of the week) and `disruption-return` (the
   * week is held to the J7 restart fraction).
   */
  flags: string[]
  gainTargetM: number | null
  /** Version-2 plans only: the engine's count of quality sessions for the week. */
  qualitySessions: number
  /** Version-2 plans only: the engine's recovery-week flag (a post-race week has no 'recovery' flag). */
  isRecovery: boolean
  updatedAt: string
}
export type DataStatus = 'unconfirmed' | 'complete' | 'missing'
export type Symptoms = 'none' | 'mild' | 'persistent'
export type SuggestedAction =
  | 'upcoming'
  | 'in_progress'
  | 'await_data'
  | 'review_duplicates'
  | 'reduce'
  | 'repeat'
  | 'needs_recovery_review'
  | 'hold'
  | 'progress'
export interface WeeklyReview {
  id: string
  userId: string
  weekStart: string
  dataStatus: DataStatus
  fatigue: number | null
  symptoms: Symptoms | null
  recoveryConstrained: boolean
  suggestedAction: SuggestedAction | null
  suggestedReason: string | null
  suggestedNextMin: number | null
  finalDecision: string | null
  finalNextMin: number | null
  notes: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

/** The signals behind a version-2 weekly decision, each with the rules it rests on. */
export type ReviewSignals = WeeklyDecision['signals']

/**
 * A review as a version-2 plan returns it: the engine's weekly decision sits in the `suggested*`
 * fields and `signals` carries the signals behind it. Version-1 plans get a plain review.
 */
export type ReviewView = WeeklyReview & { signals?: ReviewSignals }

/** What saving returns: the review, plus for a version-2 plan the re-plan the review triggered. */
export type SavedReview = ReviewView & {
  /** The revision written by the re-plan; null when this save did not re-plan. */
  revision?: PlanRevisionView | null
  /** Why a re-plan that was due did not run; the review itself is saved. */
  replanError?: string
}

export type Units = 'mi' | 'km'
export interface UserSettings {
  email: string
  displayName: string | null
  units: Units
}
export interface SessionUser extends UserSettings {
  id: string
}
export type GoalPriority = 'A' | 'B' | 'C'
export type GoalStatus = 'target' | 'considering' | 'done' | 'dropped'
export type GoalSurface = 'road' | 'trail' | 'track' | 'mixed'
export type GoalType = 'finish' | 'time'
export type SupportLevel = 'aided' | 'self'
export interface Goal {
  id: string
  userId: string
  name: string
  priority: GoalPriority
  status: GoalStatus
  targetDate: string
  dateProvisional: boolean
  distanceM: number | null
  location: string | null
  successCriteria: string | null
  notes: string | null
  url: string | null
  isActive: boolean
  /** Course ascent and descent in metres. */
  gainM: number | null
  lossM: number | null
  surface: GoalSurface
  goalType: GoalType
  targetTimeSec: number | null
  /** HH:MM */
  startTime: string | null
  /** Rounded to 0.01 degrees. */
  raceLat: number | null
  raceLng: number | null
  supportLevel: SupportLevel
  createdAt: string
  updatedAt: string
}
export interface Plan {
  id: string
  userId: string
  goalId: string
  name: string
  startDate: string
  raceWeekStart: string
  status: 'active' | 'archived'
  /** 1 = shared/domain/plan.ts, 2 = shared/engine. */
  generatorVersion: number
  /** The parameter registry version a version-2 plan was generated with. */
  paramsVersion: string | null
  createdAt: string
  updatedAt: string
}
export interface PlanWithWeeks extends Plan {
  weeks: PlanWeek[]
}
export type PlanSessionStatus =
  'planned' | 'completed' | 'partial' | 'skipped' | 'downgraded' | 'moved' | 'adjusted'
/** One prescribed day-level session; JSON columns are parsed. */
export interface PlanSession {
  id: string
  /**
   * The identity of the session outside the database: a uuid, unique within the plan and kept by
   * every write that keeps the session. Opaque to the client.
   */
  externalId: string
  planId: string
  weekStart: string
  date: string
  order: number
  kind: SessionKind
  title: string
  durationMin: number
  distanceM: number | null
  gainM: number | null
  structure: Step[]
  target: SessionTarget
  purpose: string
  /** Rule ids such as `g-1`, resolved to parameters and papers by `explain`. */
  rules: string[]
  flags: SessionFlag[]
  status: PlanSessionStatus
  activityId: string | null
  linkSource: 'auto' | 'owner' | null
  execution: ExecutionAssessment | null
  /** The prescription before a downgrade or move. */
  original: Partial<SessionSpec> | null
  updatedAt: string
}
export type PlanRevisionReason =
  'generate' | 'weekly' | 'review' | 'owner' | 'break' | 'disruption' | 'undo' | 'goal-switch'
export interface PlanRevision {
  id: string
  planId: string
  createdAt: string
  reason: PlanRevisionReason
  summary: string
  changes: PlanChange[]
}

// The revision model (phase 3a design 4.2, ADR 0007). A revision stores what a re-plan, an owner
// edit or a rest window wrote to the plan as a `PlanDiff`, and the rows needed to reverse it as a
// server-only `UndoPayload` (`server/services/replan.ts`), which no route sends.

/** One session on either side of a revision, identified by its `externalId` (design 4.1). */
export interface SessionDiffLine {
  change: 'added' | 'removed' | 'changed'
  externalId: string
  /** Null for a session that is only previewed: its row does not exist yet. */
  sessionId: string | null
  date: string
  weekStart: string
  before: SessionBrief | null
  after: SessionBrief | null
  fields: Array<'date' | 'kind' | 'durationMin' | 'distanceM' | 'gainM' | 'structure' | 'status'>
  rules: string[]
}
export interface WeekDiffLine {
  weekStart: string
  runMinBefore: number
  runMinAfter: number
  flagsAdded: string[]
  flagsRemoved: string[]
}
export interface PlanDiff {
  v: 1
  sessions: SessionDiffLine[]
  weeks: WeekDiffLine[]
  holds: Array<{ from: string; to: string; label: string; disruptionId: string | null }>
  totals: {
    added: number
    removed: number
    changed: number
    weeksChanged: number
    runMinBefore: number
    runMinAfter: number
  }
  /** True when nothing was written: no session line, no week line and no hold. */
  empty: boolean
}
export type UndoReasonCode =
  | 'already-undone'
  | 'is-undo'
  | 'not-undoable'
  | 'window-passed'
  | 'plan-archived'
  | 'edited-since'
  | 'session-run'
  | 'safety-rule'
  | 'checklist'
export interface UndoReason {
  code: UndoReasonCode
  message: string
  sessionId?: string
  weekStart?: string
  disruptionId?: string
  rules?: string[]
  /** For `checklist`: the ids of the checks the restored plan does not pass, for tools and tests. */
  items?: string[]
}
export interface UndoState {
  available: boolean
  reasons: UndoReason[]
  undoneAt: string | null
}
/**
 * Why a line of a diff exists, in the words of the product (phase 3a design 8.5): the weekly
 * decision held or reduced the week, the runner made the change (an edit of one session, an undo),
 * the runner's own target for the week was kept, the plan
 * restarts after a break or follows the weeks after a race, a rest window holds the day, the next
 * quality session was shortened, the weekly build moved, the calendar moved the week to another
 * stage, or the figures the plan reads changed. Derived from the stored revision when it is served
 * (`attributeChange`, `shared/engine/revisionDiff.ts`); never stored.
 */
export type CauseCode =
  | 'owner-edit'
  | 'decision-hold'
  | 'decision-reduce'
  | 'owner-target-kept'
  | 'break-restart'
  | 'post-race'
  | 'disruption'
  | 'trim'
  | 'ramp'
  | 'phase-calendar'
  | 'state-update'
/**
 * The causes of every line of a revision's diff, most specific first and never empty: sessions by
 * their `externalId`, weeks by their Monday. A line is found by its key, not by its place in the
 * diff, so a surface that sorts or filters the lines keeps their causes.
 */
export interface RevisionCauses {
  sessions: Record<string, CauseCode[]>
  weeks: Record<string, CauseCode[]>
}
/** A revision as the API serves it: the stored row without its undo payload. */
export interface PlanRevisionView extends PlanRevision {
  /** Written by the scheduler, not by a request. */
  auto: boolean
  /** The weekly decision this revision acted on, when it acted on one. */
  decision: WeeklyDecision | null
  /** Null on revisions written before the revision model, and on those with nothing to show. */
  diff: PlanDiff | null
  /** The cause of each line of `diff`; null exactly when `diff` is null. */
  causes: RevisionCauses | null
  undo: UndoState
  seenAt: string | null
  /** On an 'undo' revision: the revision it reverted. */
  undoOf: string | null
  /** The rest window this revision created, changed or removed. */
  disruptionId: string | null
}
/**
 * `GET /api/brief` (phase 3a design 8.4): the Monday brief of one week. `facts` holds template ids
 * and slots, never prose (`shared/copy/briefRender.ts` writes the words). The brief has no seen
 * column: it is seen when the revision it describes is, or when it describes none.
 */
export interface BriefView {
  /** The Monday the brief opens. */
  weekStart: string
  /** The plan the brief was built from; null when it was built with none. */
  planId: string | null
  version: number
  /**
   * Built by a request before the weekly update ran, and reading today's plan. A provisional brief
   * of a week that is over reads as one whose update did not run (`facts.replan` is `not-run`).
   */
  provisional: boolean
  seen: boolean
  generatedAt: string
  facts: BriefFacts
  /** The revision the weekly update wrote, as the revision list serves it (undo state included). */
  revision: PlanRevisionView | null
  /** Later revisions of the plan within the brief's week, newest first; none for a provisional brief. */
  since: PlanRevisionView[]
  /** The Monday of the nearest earlier brief, or null. */
  prev: string | null
  /** The Monday of the nearest later brief, or null. */
  next: string | null
}
/** One brief in `GET /api/briefs`, enough for the history strip and Today's brief line. */
export interface BriefListItem {
  weekStart: string
  provisional: boolean
  seen: boolean
  generatedAt: string
  decision: BriefDecision['kind'] | null
  /** Set when the weekly update wrote no revision. */
  replan: BriefReplanCode | null
  /** The sessions the update changed. */
  changeCount: number
  /** The revision was undone. */
  undone: boolean
  nextKey: { date: string; kind: SessionKind } | null
}
/**
 * One owner edit of one session (phase 3a design 9.4, 9.5): the six things the session sheet can
 * ask for, each checked by the same guards (`adjustCheck`, `shared/engine/adjust.ts`).
 *
 * - `move`: to another day of its own week.
 * - `swap`: the two sessions trade days; both must be in the same week and still to run.
 * - `swap-kind`: the next session of that kind in the week takes this one's prescription and the
 *   other way round; the days keep their places (the older "change the kind" edit).
 * - `shorten`: to fewer minutes. Never longer, never under the run minimum, nothing added to
 *   another day.
 * - `skip` and `restore`: a skipped session is not made up (G-6) and can be put back.
 */
export type PlanAdjustment =
  | { type: 'move'; date: string }
  | { type: 'swap'; withSessionId: string }
  | { type: 'swap-kind'; kind: SessionKind }
  | { type: 'shorten'; durationMin: number }
  | { type: 'skip' }
  | { type: 'restore' }
/**
 * What `POST /api/plan/preview` takes and `computeAction` builds (design 4.2). A discriminated
 * union on `type`: phase 3a adds adjust (E5-6) and the rest-window actions (E5-5) to it, each with
 * its own commit route and the same preview.
 */
export type PlanAction =
  | { type: 'replan' }
  | { type: 'undo'; revisionId: string }
  | { type: 'adjust'; sessionId: string; adjustment: PlanAdjustment }
  | ({ type: 'disruption-create' } & DisruptionInput)
  | ({ type: 'disruption-update'; id: string } & DisruptionChange)
  | { type: 'disruption-remove'; id: string }
/**
 * Why an adjustment is refused or qualified. The first group holds when the session cannot be
 * changed at all (it is the race, in the past, linked, done or skipped, or not a run for a
 * shorten); the second names the limit a new arrangement breaks (availability, spacing, a rest
 * window, the session spike limit, the weekly target).
 */
export type AdjustGuardCode =
  | 'race-day'
  | 'past-session'
  | 'linked'
  | 'settled'
  | 'skipped'
  | 'not-shortenable'
  | 'other-week'
  | 'past-date'
  | 'no-partner'
  | 'partner-unavailable'
  | 'not-shorter'
  | 'below-minimum'
  | 'b2b-pair'
  | 'closed-day'
  | 'day-limit'
  | 'one-run-a-day'
  | 'hard-spacing'
  | 'long-run-between'
  | 'rest-window'
  | 'quiet-day'
  | 'day-cap'
  | 'spike'
  | 'weekly-cap'
/** An adjustment that would work where the one asked for does not, with the words for its button. */
export interface PlanSuggestion {
  label: string
  adjustment: PlanAdjustment
}
/**
 * A guard that refuses or qualifies an action (the move, swap and shorten guards of E5). `blocks`
 * refuses the commit; `warns` lets it through and says why it deserves a look. `message` is a fixed
 * template with its rule ids in `rules`; `suggest` is set where one alternative exists.
 */
export interface PlanGuardView {
  code: AdjustGuardCode
  message: string
  rules: string[]
  effect: 'blocks' | 'warns'
  suggest: PlanSuggestion | null
}
/** Minutes of running over a span of days, before a change and after it. */
export interface RunMinutes {
  before: number
  after: number
}
/**
 * What an action would do, from the same code that commits it (design 4.2). A refusal is
 * information, not an error: `blocked` says the commit would be refused and `reasons` says why.
 * `hash` covers `{ diff, headRevisionId, today }`; a commit that sends it back (`expectHash`) is
 * refused with `stale-preview` when any of the three has moved.
 */
export interface PlanPreview {
  action: PlanAction
  /** Empty when the action would change nothing, and when it is refused for a structural reason. */
  diff: PlanDiff
  /**
   * The minutes of runs still to come over the next 28 days, now and once the rows of `diff` are
   * written (`runMinutesAhead`). Null when no run is planned in those days before or after, and for
   * an owner edit of one session and an undo, which do not state it.
   */
  runMin: RunMinutes | null
  summary: string
  /** The engine's warnings for the plan the action leaves behind. */
  warnings: EngineWarning[]
  blocked: boolean
  /** Guards of an adjust action, the ones that refuse it first; empty for re-plan and undo. */
  guards: PlanGuardView[]
  /**
   * Why the commit would be refused: the structural undo reasons, or the checklist. An adjust
   * action is refused by its `guards` instead and leaves this empty.
   */
  reasons: UndoReason[]
  hash: string
  /** The local day the preview was built for. */
  today: string
}
/** The answer to an undo: the revision it wrote and the revision it reverted, as they now stand. */
export interface UndoResult {
  revision: PlanRevisionView
  target: PlanRevisionView
}
/**
 * The answer to `POST /api/plan/sessions/:id/adjust`. `allowed` is false when a guard blocks (a
 * dry run says so with 200; a commit answers 409 instead). `session` is the session as it stands
 * after a commit and as it would stand after a dry run; `revision` is null for a dry run and for an
 * adjustment that changes nothing. `hash` is the hash of the preview this answer was made from (a
 * dry run's is the one to send back as `expectHash` with the commit).
 */
export interface AdjustResult {
  allowed: boolean
  guards: PlanGuardView[]
  diff: PlanDiff
  session: PlanSession
  revision: PlanRevisionView | null
  hash: string
}
export interface PlanWithSessions extends PlanWithWeeks {
  sessions: PlanSession[]
  feasibility: Feasibility | null
  warnings: EngineWarning[]
  checklist: ChecklistResult[]
  zones: ZoneSet | null
}
/** The `details` of the 409 that `POST /api/goals/:id/activate` answers while a plan follows another goal. */
export interface ActivateRequiresPlan {
  requires: 'replacePlan'
  planGoalId: string
  planGoalName: string
}
/** One archived plan, for `GET /api/plan/archived`; `reason` says why it is not `restorable`. */
export interface ArchivedPlanView {
  id: string
  goalId: string
  goalName: string
  /** Monday of the race week, YYYY-MM-DD. */
  raceWeekStart: string
  /** When the plan was archived: an ISO 8601 instant. */
  archivedAt: string
  restorable: boolean
  reason: string | null
}
/**
 * What `POST /api/plan/archived/:id/restore` answers. The plan is restored either way; `replanned`
 * is false when the update that follows a restore was blocked, and `message` says why.
 */
export interface RestorePlanResult {
  planId: string
  goalId: string
  replanned: boolean
  message: string | null
}
/** Why a runner reports a window of rest or limited running [rule J9]. */
export type DisruptionReason =
  'illness-above-neck' | 'illness-below-neck' | 'niggle' | 'short-on-time' | 'travel'
/** `rest` holds running; `limited` caps the longest run of each day (`maxRunMin`). */
export type DisruptionMode = 'rest' | 'limited'
/**
 * Where a date lies against a window, computed by `windowPhase`: before it (`upcoming`), inside it
 * (`resting`, or `limited` when short runs are allowed), the symptom-free wait after an illness
 * (`rest-gate`), easy running only (`easy-only`), the weeks held to the restart fraction
 * (`returning`) and past all of it (`done`).
 */
export type DisruptionPhase =
  'upcoming' | 'resting' | 'rest-gate' | 'easy-only' | 'limited' | 'returning' | 'done'
/** `active` is in force; `undone` was withdrawn, by its removal or by the undo that created it. */
export type DisruptionStatus = 'active' | 'undone'
/**
 * What a runner reports to open a window (`POST /api/plan/disruptions`, and the preview action
 * `disruption-create`). The body rules are `validateDisruption`'s: illness is rest only, `limited`
 * needs `maxRunMin`, only a niggle takes area, pain and gait change.
 */
export interface DisruptionInput {
  reason: DisruptionReason
  mode: DisruptionMode
  startDate: string
  endDate: string
  maxRunMin?: number | null
  area?: string | null
  pain?: number | null
  gaitChange?: boolean
  /** The runner's own words; never read by the engine. */
  note?: string | null
}
/** What `PATCH /api/plan/disruptions/:id` changes: a window is extended, shortened or re-capped. */
export interface DisruptionChange {
  endDate?: string
  maxRunMin?: number | null
}
/** A stored window of rest or limited running (design 9.3). */
export interface Disruption {
  id: string
  reason: DisruptionReason
  mode: DisruptionMode
  startDate: string
  endDate: string
  maxRunMin: number | null
  area: string | null
  pain: number | null
  gaitChange: boolean
  note: string | null
  status: DisruptionStatus
  createdAt: string
  updatedAt: string
}
/**
 * A window as `GET /api/plan/disruptions`, `GET /api/today` and the commit routes serve it, with
 * what the engine says about it for the viewed date (`windowPhase`, `disruptionPlan`).
 */
export interface DisruptionView extends Disruption {
  /** Where the viewed date lies against the window. */
  phase: DisruptionPhase
  /** The first day running is allowed. */
  runFrom: string
  /** The first day hard sessions are allowed. */
  qualityFrom: string
  /**
   * The most minutes the return week may hold, from the J7 fraction of the week before the break;
   * null when the window holds running for under `j7.tier1Days` days or no week before is known.
   */
  returnWeekMin: number | null
}
export type TodayAdvice = 'as-planned' | 'downgrade-easy' | 'rest'
/**
 * The heat read of the day's main run. Every field is null (and `hotForSteering` false) when the
 * run has no forecast or the day stays inside the optimum band. `wbgtC` is the peak when it is a
 * WBGT reading; `index` says which index the peak is on, `coolerValue` is that index around the
 * cooler start.
 */
export interface TodayHeat {
  wbgtC: number | null
  note: string | null
  coolerHour: string | null
  /** Hour of day, 0-23, of the warmest hour inside the daylight window. */
  peakHour: number | null
  coolerValue: number | null
  index: 'wbgt' | 'air-temperature' | null
  /** The one test every surface steers by (`isHotForSteering`). */
  hotForSteering: boolean
}
export interface TodayView {
  /** The viewed day: today, or a day ahead for a preview (`coach.preview`). */
  date: string
  /** The server's IANA zone: "today" is its calendar day, whatever the device clock says. */
  tz: string
  sessions: Array<{ session: PlanSession; advice: TodayAdvice; reasons: string[] }>
  heat: TodayHeat
  checkin: Checkin | null
  readiness: ReadinessSnapshot
  unrated: Activity[]
  /** The coach view: readiness, hero, week, race, change line, health and slots. */
  coach: TodayCoach
  /**
   * Set by the service worker, never by the server: this answer is the phone's saved copy, served
   * because the network did not answer in time (ADR 0012). The page says so (`OfflineNote`).
   */
  servedFromCache?: true
}
// ---- Today as a coach (phase 3a, section 7) ----------------------------------------------------
// The pure pieces are `readinessSignals`, `readinessVerdict`, `rangeLabel`, `weekStrip` and
// `isoDateInZone`; the service composes them into `TodayCoach` (E2-4). Sentences are never kept in
// these types: a signal, a verdict and a health note hold a template id and its slots, and
// `renderFact` (`shared/copy/templates.ts`) writes the words in the runner's units.

/** The readings a readiness signal can come from, in the order the list leans on them. */
export type ReadinessSignalCode = 'illness' | 'pain' | 'hrv' | 'resting-hr' | 'sleep' | 'checkin'
/** One reading behind the verdict. `noted` is set for a reading the verdict leans on. */
export interface ReadinessSignal extends Pick<InputFact, 'template' | 'slots'> {
  code: ReadinessSignalCode
  noted: boolean
}
export type ReadinessVerdictCode =
  'ready' | 'low-stays' | 'low-plan-stays' | 'easy' | 'rest' | 'lighter-week' | 'no-signals'
/** The one line that says what readiness means for today. */
export interface ReadinessVerdict extends Pick<InputFact, 'template' | 'slots'> {
  code: ReadinessVerdictCode
}
/**
 * How wide a race prediction has to be (`rangeLabel`): the least half-width the interval may
 * have, the rules that set it and the evidence grade of that floor. `wide` marks the ultra floor
 * [L4], where the range is wide on purpose.
 */
export interface RangeLabel {
  wide: boolean
  /** Percent of the predicted time. */
  minHalfWidthPct: number
  rules: string[]
  grade: Grade
}
/** A session's targets plus the climbing line, as the hero shows them. */
export interface TodayTarget extends ResolvedTargets {
  climbNote: string | null
}
export interface TodayHero {
  /** The session as planned. */
  session: PlanSession
  advice: TodayAdvice
  reasons: string[]
  /** The J3 downgrade of `session`; set only for the advice `downgrade-easy`. */
  eased: PlanSession | null
  /** Targets of the session as it will be run (the eased one when there is one); null for rest. */
  target: TodayTarget | null
  /** The logged run linked to the session. */
  linkedRun: Activity | null
  /** The day's other sessions (strength, mobility). */
  others: PlanSession[]
}
/**
 * How a day of the week strip reads. A past day whose run is still to be done and has no logged
 * run is `unlogged` ("planned, no run logged"); the strip has no wording for a miss.
 */
export type WeekStripMark = 'done' | 'partial' | 'skipped' | 'planned' | 'unlogged' | 'free'
export interface WeekStripDay {
  date: string
  mark: WeekStripMark
  isToday: boolean
  /** Run minutes logged on the day. */
  runMin: number
  /** Every session of the day, in order; a tap on the day opens them. */
  sessions: PlanSession[]
}
export interface WeekStrip {
  /** Monday. */
  weekStart: string
  /** Seven days, Monday first. */
  days: WeekStripDay[]
  /** Run minutes logged this week. */
  runMin: number
  /** The plan week's target; null outside the plan. */
  targetRunMin: number | null
  /** The advisory split of what is left through Sunday; null without a target. */
  remaining: { remainingMin: number; remainingDays: number; perDayMin: number | null } | null
}
export interface TodayRace {
  goalId: string
  name: string
  targetDate: string
  dateProvisional: boolean
  daysToRace: number
  /** The race distance in metres; null when the goal has none. */
  distanceM: number | null
  /** Null when the athlete's state supports no source, or the goal has no distance. */
  prediction: Pick<Prediction, 'method' | 'predictedSec' | 'lowSec' | 'highSec'> | null
  /** How wide the range has to be; null when the goal has no distance. */
  range: RangeLabel | null
}
/** The newest weekly, break or review update of the last seven days, as the plan stored it. */
export interface ChangeLine {
  id: string
  createdAt: string
  reason: PlanRevisionReason
  summary: string
}
/** A note from a registered producer (sync paused, weekly update not run, ...). */
export interface HealthNote extends Pick<InputFact, 'template' | 'slots'> {
  code: string
  /** Where the note leads, or null. */
  href: string | null
}
export interface TodayHealth {
  possibleDuplicates: number
  pastUnconfirmedWeeks: number
  lastWeekReady: boolean
  notes: HealthNote[]
}
/** What the window routes answer: the window as it now stands and the revision that wrote it. */
export interface DisruptionResult {
  disruption: DisruptionView
  revision: PlanRevisionView
}
/**
 * The disruption slot (design 9.6): the window the banner is about, else an offer to set one. Null
 * when there is neither.
 */
export interface DisruptionSlot {
  /** The window in effect on the viewed day, else the next one ahead; null when there is none. */
  window: DisruptionView | null
  /**
   * True when no window is in effect and today's check-in reports illness or pain at or above
   * `pain.flagScore`: the page offers a rest window and creates nothing by itself.
   */
  offer: boolean
}
/**
 * The `watch` slot: the run sessions of the viewed day as `GET /api/wrist/status` lists them, so
 * the line on Today and the chip on Plan word a session the same way. The page picks the hero's
 * session by `sessionId`. The slot is null while sending is off and on a day with no run.
 */
export interface TodayWatch {
  items: WristItem[]
}
/**
 * What the named Today slots hold. Each owning epic gives its slot a type (disruption E5, fuel
 * and fuelPrompt E6, watch E1, brief E4); until then a slot is null and takes no height.
 */
export interface TodaySlots {
  disruption: DisruptionSlot | null
  /** The fuel targets of the viewed day and the day after (E6); null when no run carries one. */
  fuel: TodayFuel | null
  /** Where the viewed day's runs stand on their way to the watch (E1); null while sending is off. */
  watch: TodayWatch | null
  brief: null
  /** Recent runs that wait for a fuel log (E6); null when none does. */
  fuelPrompt: TodayFuelPrompts | null
}
export interface TodayCoach {
  /** ISO instant the payload was composed. */
  generatedAt: string
  /** True for a day after today: no verdict, no signals, nothing written. */
  preview: boolean
  verdict: ReadinessVerdict | null
  /** At most `SIGNAL_LIMIT`, noted readings first. */
  signals: ReadinessSignal[]
  /** Null when the day has no session. */
  hero: TodayHero | null
  /** The next session after the viewed day. */
  next: PlanSession | null
  weekStrip: WeekStrip | null
  race: TodayRace | null
  change: ChangeLine | null
  health: TodayHealth
  /** The runner's windows that are not over on the viewed date (a window tomorrow is `upcoming`). */
  disruptions: DisruptionView[]
  slots: TodaySlots
}
/** A proposed zone change that the owner accepts or declines; `id` is stable for one proposal. */
export type ZoneProposalView = ZoneProposal & { id: string }
export interface PredictionView {
  prediction: Prediction | null
  log: Array<{
    id: string
    goalId: string
    createdAt: string
    /** Monday of the local week the entry belongs to; the log holds one entry per week. */
    weekStart: string
    /** The local day the prediction was made. */
    loggedOn: string
    method: string
    predictedSec: number
    lowSec: number
    highSec: number
    actualSec: number | null
  }>
}
/** A recorded race result, with how many weekly predictions it was compared with (design 11.4). */
export interface RaceResultView {
  id: string
  goalId: string
  activityId: string | null
  date: string
  distanceM: number
  gainM: number | null
  outcome: RaceOutcome
  /** Official finish time; null for a did-not-finish. */
  timeSec: number | null
  note: string | null
  /** Weekly predictions scored against this result; 0 for a did-not-finish. */
  scoredPredictions: number
  /** This save retyped the linked activity from a run to a race; false when it was a race already. */
  activityMarkedAsRace: boolean
}
/**
 * One goal race in the track record: its result and the scored weekly predictions. The stored
 * fields of the result (`gainM`, `activityId`, `note`; the finish time is `resultSec`) are here so
 * a sheet that edits the result starts from them without a second request.
 */
export interface TrackRecordRace extends RaceScore {
  goalId: string
  goalName: string
  distanceM: number
  gainM: number | null
  /** The activity the result is linked to, or null when it is not linked. */
  activityId: string | null
  note: string | null
}
/** GET /api/predictions/record: races newest first, and the summary across them (design 11.4). */
export interface TrackRecordView {
  races: TrackRecordRace[]
  summary: RecordSummary
}

/**
 * What the training advice reads (`StateView.inputs`): the size of each window, how many rows fall
 * in it and the latest day among them. Activities count without flagged duplicates, which the
 * engine leaves out; `flaggedDuplicates` says how many it left out.
 */
export interface StateInputs {
  activities: {
    windowDays: number
    count: number
    latest: string | null
    flaggedDuplicates: number
  }
  wellness: { windowDays: number; count: number; latest: string | null }
  reviews: { windowWeeks: number; count: number }
}
/** GET /api/state: the cached picture of the athlete on the server's day (ADR 0009). */
export interface StateView {
  /** The data version the picture was built at: `<boot>.<writes>.<external>`. */
  version: string
  /** The server's local day the picture is for. */
  asOf: string
  /** When the picture was built, as an instant. */
  builtAt: string
  /** The parameter registry version the engine ran with. */
  paramsVersion: string
  state: AthleteState
  zones: ZoneSet
  readiness: ReadinessSnapshot
  /** The active plan's goal, else the active goal, else null (`currentGoalFor`). */
  goal: Goal | null
  /** The active version-2 plan, without its weeks and sessions. */
  plan: Plan | null
  /** The prediction for `goal` from the athlete's own data; null without a distance or a source. */
  prediction: Prediction | null
  inputs: StateInputs
}
/** One hour of the cached home forecast, in GMT. */
export interface ForecastHour {
  /** The hour, `YYYY-MM-DDTHH:00:00Z`. */
  time: string
  tempC: number | null
  dewPointC: number | null
  humidityPct: number | null
  windKph: number | null
  /** Shortwave radiation in W/m2; null for an hour the model sent none for (and for older cache rows). */
  shortwaveWm2: number | null
}
/** GET /api/weather/forecast: the cached seven-day forecast at home. */
export interface ForecastView {
  hours: ForecastHour[]
  /** When the hours were fetched, as an instant. */
  fetchedAt: string
  /** True once the hours are more than an hour old; a refresh is already on its way. */
  stale: boolean
}
/** GET /api/research/params: the parameter registry, for the why drawer. */
export interface ResearchParams {
  version: string
  params: Array<Param<unknown>>
}
// ---- Fuel lab (phase 3a, section 10; ADR 0011) ------------------------------------------------

export type FuelProductKind = 'gel' | 'drink' | 'chew' | 'bar' | 'food' | 'electrolyte' | 'other'

/** One product of the runner's own list, with the amounts in one serving. */
export interface FuelProduct {
  id: string
  name: string
  kind: FuelProductKind
  /** What one serving is, such as "1 gel" or "500 mL bottle". */
  servingLabel: string
  /** Grams of carbohydrate in one serving. */
  carbsG: number
  sodiumMg: number | null
  kcal: number | null
  /** More than one transportable carbohydrate, such as glucose and fructose. */
  multiCarb: boolean
  /** Archived products stay readable in old logs and leave the pick list. */
  archived: boolean
}

/** The fuel switches. A change reaches the plan at the next weekly re-plan. */
export interface FuelSettings {
  /** Opens the rungs from the first higher tier up to the second. */
  optIn90: boolean
  /** Opens the rungs above the second tier; needs `optIn90` and a tolerated run at the second tier. */
  optInAdvanced: boolean
  /** A diagnosed gut condition: the ladder stays at the floor and the gut-training block is removed. */
  giDisease: boolean
  /** The gut-training block before the taper. */
  gutBlock: boolean
}

/** One thing eaten on a run as the log kept it when saved; a later product edit leaves it alone. */
export interface FuelLogItem extends FuelItem {
  /** The product it was taken from; null for "something else". */
  productId: string | null
}

/** A fuel log as the API serves it. */
export interface FuelLogView {
  id: string
  activityId: string
  /** "Not this time": the run does not count toward the ladder. */
  skipped: boolean
  items: FuelLogItem[]
  fluidMl: number | null
  /** Sodium the runner reports taking, in milligrams, beyond what the products add up to. */
  sodiumMg: number | null
  /** 0 to 4; null only for a skipped log. */
  gut: number | null
  /** 0 to 4. */
  nausea: number | null
  /** The runner's own answer to "it was hot"; null means the run's weather decides on every replay. */
  hot: boolean | null
  notes: string | null
  /** What the replay made of this run, derived on every read and never stored. */
  step: LadderStep
  /** "Counted toward your ladder." or the reason this run did not count. */
  counts: string
}

/** The answer to a write on a fuel log: the log, the ladder replayed after it and the toast. */
export interface FuelLogResult {
  /** Null after a delete. */
  log: FuelLogView | null
  /** The replayed ladder; `steps` holds the latest few. */
  ladder: LadderResult
  /** What the run did to the ladder, such as "Tolerated at 60 g/h. Next long run: 70 g/h."; null after a delete. */
  message: string | null
}

/** The planned run a fuel target belongs to. */
export type FuelSessionRef = Pick<PlanSession, 'id' | 'date' | 'kind' | 'title' | 'durationMin'>

/** The fuel target of one planned run with the words around it (design 10.4, 10.6). */
export interface FuelTargetView {
  session: FuelSessionRef
  target: FuelTarget
  text: FuelTargetText
}

/** A recent run that has no fuel log yet and is long enough to count (design 10.4). */
export interface FuelPrompt {
  activityId: string
  date: string
  startTime: string | null
  durationSec: number
  distanceM: number | null
  /** Counted from the shorter length of a gut-training week. */
  block: boolean
}

/** `GET /api/today` slot `fuel`: the targets of the viewed day and the day after, in date order. */
export interface TodayFuel {
  targets: FuelTargetView[]
  /** The safety card about drinking too much, which goes wherever fuel does; stronger in heat. */
  eah: EahCard
}

/** `GET /api/today` slot `fuelPrompt`: unlogged runs of the last days, newest first, at most three. */
export interface TodayFuelPrompts {
  prompts: FuelPrompt[]
}

/**
 * The gut-training block as the plan stores it: `none` when the plan has no such weeks (a shorter
 * goal, or a switch not yet applied), `planned` when it has, `off` when the runner switched it off,
 * `locked` for a diagnosed gut condition. Switching it off or locking it removes the weeks at the
 * next re-plan; until then `removalPending` is true.
 */
export type FuelBlockState = 'none' | 'planned' | 'off' | 'locked'

export interface FuelBlockView {
  state: FuelBlockState
  /** Mondays of the weeks that carry the `gut-training` flag in the stored plan. */
  weeks: string[]
  /** First Monday and last Sunday of the block; null without weeks. */
  from: string | null
  to: string | null
  removalPending: boolean
  /** What may be said about gut training and what may not (rule H7). */
  lines: string[]
}

/** One row of the lab's history: a log with the sentence the replay gave its run. */
export interface FuelHistoryRow {
  log: FuelLogView
  /** What the run did to the ladder, or why it did not count. */
  note: string
}

/** `GET /api/fuel`: everything the Fuel lab shows; the stable surface for E11 and E12. */
export interface FuelLabView {
  settings: FuelSettings
  /** The replayed ladder; `steps` holds the latest few. */
  ladder: LadderResult
  /** The target of the next planned run that can carry one; null when no such run is planned. */
  next: FuelTargetView | null
  block: FuelBlockView
  /** Live products; archived ones come from `GET /api/fuel/products?archived=1`. */
  products: FuelProduct[]
  /** The latest logs of runs that count in the replay, newest first. */
  history: FuelHistoryRow[]
  prompts: FuelPrompt[]
  /** The safety card about drinking too much; the stronger variant for a long goal or in heat. */
  eah: EahCard
  disclaimers: {
    general: string
    /** The clinician line for a diagnosed gut condition; null without one. */
    gutCondition: string | null
  }
}
export interface Screening {
  id: string
  date: string
  kind: 'reds'
  answers: Record<string, boolean | string | number | null>
  flags: number
  createdAt: string
}
/** `line` is null for a skipped duplicate, because an ImportRow carries no line number. */
export interface ImportReportRow {
  line: number | null
  reason: string
}
export interface ImportBatch {
  id: string
  userId: string
  source: ActivitySource
  fileName: string | null
  rowCount: number
  accepted: number
  skippedDuplicate: number
  skippedInvalid: number
  errors: ImportReportRow[]
  createdAt: string
}
export type ApiErrorCode = 'validation' | 'unauthorized' | 'not_found' | 'conflict' | 'internal'
/** Validation details are `{ issues: ValidationIssue[] }`. */
export interface ValidationIssue {
  path: string
  message: string
}
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown }
}

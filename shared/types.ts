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
  channels: Array<'pull' | 'push' | 'upload' | 'folder'>
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
  streak3Plus: number
}
export type Phase =
  'restart' | 'base1' | 'base2' | 'endurance' | 'specific' | 'peak' | 'taper' | 'race'
export type DistanceClass = 'short' | 'half' | 'marathon' | 'ultra50' | 'ultra100'
export type TargetSource = 'baseline' | 'review' | 'override'
export interface PlanWeek {
  id: string
  planId: string
  weekStart: string
  index: number
  phase: Phase
  focus: string | null
  baselineRunMin: number
  targetRunMin: number
  targetSource: TargetSource
  longRunMin: number
  day2Min: number | null
  runDays: number
  strengthSessions: number
  overrideNote: string | null
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
  generatorVersion: number
  createdAt: string
  updatedAt: string
}
export interface PlanWithWeeks extends Plan {
  weeks: PlanWeek[]
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

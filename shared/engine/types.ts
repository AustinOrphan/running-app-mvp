// The contract between the engine modules, the server and the web app (training-engine plan,
// "Shared contract"). Frozen after Task E1: change it only with the plan.
import type { Activity, AthleteProfile, WeekRow, WeeklyReview, WellnessDay } from '../types.ts'

export type Grade = 'A' | 'B' | 'C' | 'D'
export interface Param<T = number> {
  id: string
  value: T
  range?: [T, T]
  unit?: string
  grade: Grade
  rule: string
  evidence: string[]
  note?: string
}
export interface EngineWarning {
  code: string
  severity: 'info' | 'warn' | 'hold'
  message: string
  rules: string[]
}
export type PhaseV2 = 'base' | 'build' | 'specific' | 'taper' | 'race'
export type SessionKind =
  | 'easy'
  | 'recovery'
  | 'long'
  | 'long-fast-finish'
  | 'threshold'
  | 'intervals'
  | 'race-pace'
  | 'strides'
  | 'hills'
  | 'hike'
  | 'b2b'
  | 'strength'
  | 'mobility'
  | 'rest'
  | 'race'
  | 'cross'
export interface Step {
  kind: 'warmup' | 'work' | 'recover' | 'cooldown' | 'steady'
  reps: number
  durationSec: number | null
  distanceM: number | null
  zone: ZoneKey
}
export type ZoneKey = 'z1' | 'z2' | 'z3' | 'race-pace' | 'strides' | 'strength' | 'rest'
export interface SessionTarget {
  zone: ZoneKey
  rpe: [number, number]
  hr: [number, number] | null
  paceSecPerKm: [number, number] | null
  heatNote: string | null
}
export type SessionFlag =
  | 'spike-warn'
  | 'override-required'
  | 'heat'
  | 'night'
  | 'fuel-practice'
  | 'b2b-day1'
  | 'b2b-day2'
  | 'downhill'
  | 'run-walk'
  | 'post-race'
  | 'injury-return'
export interface SessionSpec {
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
  rules: string[]
  flags: SessionFlag[]
}
/**
 * What a revision diff remembers of a session on either side of a change (phase 3a design 4.2):
 * enough to name it and say how long it is, without the steps or the targets. The one definition.
 */
export interface SessionBrief {
  date: string
  kind: SessionKind
  title: string
  durationMin: number
  distanceM: number | null
  gainM: number | null
}
/**
 * A session's targets as every surface shows them (`resolveTargets`, design 4.6): the figure the
 * day leads with, the secondary figures, and the notes that explain them.
 */
export interface ResolvedTargets {
  /** The zone the stored target names. */
  zone: ZoneKey
  /** What leads: a heart-rate ceiling or band, the stored work pace, or effort. */
  mode: 'hr-ceiling' | 'hr-band' | 'pace' | 'effort'
  /** Top of the current Z1, in bpm. */
  hrCeiling: number | null
  /** Current Z2 or Z3 band, in bpm. */
  hrRange: [number, number] | null
  /** Seconds per km, slow end first; a guide unless the mode is `pace`. */
  paceSecPerKm: [number, number] | null
  /** CR-10. */
  rpe: [number, number]
  /** Hot enough to steer by effort (`isHotForSteering`); never true for strength, mobility or rest. */
  hot: boolean
  hotNote: string | null
  /** Set when the figures use zones that changed after the session was planned. */
  zonesNote: string | null
  /** `zones` when a heart-rate or pace figure was read from the current zones. */
  source: 'zones' | 'plan'
}
export interface Boundary {
  value: number
  band: [number, number]
  source: 'tested' | 'cs' | 'dfa' | 'rpe' | 'hrmax-observed' | 'hrmax-age' | 'hrr' | 'profile'
  asOf: string
}
export interface ZoneSet {
  hrMax: Boundary | null
  hrRest: number | null
  lt1Hr: Boundary | null
  lt2Hr: Boundary | null
  csMps: Boundary | null
  lt1PaceSecPerKm: Boundary | null
  thresholdPaceSecPerKm: Boundary | null
  hr: Record<'z1' | 'z2' | 'z3', [number, number]> | null
  /** sec/km, slow..fast */
  pace: Record<'z1' | 'z2' | 'z3', [number, number]> | null
  /** CR-10 */
  rpe: Record<'z1' | 'z2' | 'z3', [number, number]>
}
export interface AthleteState {
  asOf: string
  age: number | null
  sex: 'female' | 'male' | 'unspecified' | null
  experience: 'novice' | 'returning' | 'recreational' | 'trained'
  yearsRunning: number | null
  load: {
    metric: 'srpe' | 'trimp' | 'minutes'
    acute: number
    chronic: number
    daily: Array<{ date: string; load: number }>
  }
  /** Last 16 Mondays, oldest first (shared/domain/weeks). */
  weeks: WeekRow[]
  /** Median run minutes of the last 4 weeks with a run. */
  typicalWeekMin: number
  longest30d: {
    distanceM: number
    durationSec: number
    gainM: number
    lossM: number
    twoDaySec: number
  }
  gaps16w: number
  layoffDays: number
  lastRunDate: string | null
  fitness: {
    csMps: number | null
    dPrimeM: number | null
    csEfforts: number
    exponent: number | null
    races: Array<{ date: string; distanceM: number; timeSec: number }>
    vo2maxTrend: number | null
  }
  efficiency: { current: number | null; trendPct: number | null; samples: number }
  durability: { decouplingMedianPct: number | null; samples: number }
  risk: {
    recentInjury: boolean
    priorBsi: boolean
    bsiFactors: number
    redsFlags: number
    /** The soft start flags of A9 (age, BMI, injury in the last 12 months, no running history). */
    noviceFlags: string[]
  }
  /**
   * Completed runs average under `a5.lowFrequencyRunsPerWeek` a week over the last
   * `a5.lowFrequencyWindowWeeks` weeks, for a runner above the start-path floor [rules A5].
   */
  lowFrequency: boolean
  /** 0..1 credit */
  heatAcclimation: number
}
export interface GoalModel {
  goalId: string
  name: string
  date: string
  distanceM: number
  gainM: number
  lossM: number
  surface: 'road' | 'trail' | 'track' | 'mixed'
  goalType: 'finish' | 'time'
  targetTimeSec: number | null
  startTime: string | null
  isUltra: boolean
  distanceClass:
    '5k' | '10k' | 'half' | 'marathon' | 'ultra50' | 'ultra100k' | 'ultra100mi' | 'beyond'
  expectedDurationSec: number
  crossesDarkness: boolean
  raceWbgtC: number | null
}
export interface Feasibility {
  label: 'comfortable' | 'tight' | 'not-reachable'
  weeksNeeded: number
  weeksAvailable: number
  notes: EngineWarning[]
}
export interface WeekDraft {
  weekStart: string
  index: number
  phase: PhaseV2
  focus: string
  targetRunMin: number
  longRunMin: number
  longRunM: number | null
  gainTargetM: number | null
  runDays: number
  qualitySessions: number
  strengthSessions: number
  tid: { z1: number; z2: number; z3: number }
  flags: string[]
  isRecovery: boolean
  isTaper: boolean
}
export interface ChecklistResult {
  id: string
  ok: boolean
  detail: string
  rules: string[]
}
export interface Prediction {
  method: string
  predictedSec: number
  lowSec: number
  highSec: number
  conditions: string[]
  rules: string[]
}
export interface PlanDraft {
  weeks: WeekDraft[]
  sessions: SessionSpec[]
  feasibility: Feasibility
  warnings: EngineWarning[]
  checklist: ChecklistResult[]
  prediction: Prediction | null
  zones: ZoneSet
  paramsVersion: string
}
export interface Checkin {
  date: string
  fatigue: number | null
  soreness: number | null
  sleepQuality: number | null
  mood: number | null
  stress: number | null
  illness: boolean
  painScore: number | null
  painArea: string | null
  painFocalBone: boolean
}
export interface ReadinessSnapshot {
  date: string
  checkin: Checkin | null
  hrv: {
    readings: number
    latest: number | null
    baselineMean: number | null
    baselineSd: number | null
    flag: boolean
  }
  restingHrFlag: boolean
  sleepAvgH: number | null
  sleepFlag: boolean
  state: 'normal' | 'possible-fatigue' | 'persistent-suppression'
  redFlags: Array<{ code: string; message: string; rules: string[] }>
}
export interface ExecutionAssessment {
  completion: 'completed' | 'partial' | 'extended' | 'modified'
  intensity: 'below' | 'on' | 'above' | 'unknown'
  effort: {
    score: -2 | -1 | 0 | 1 | 2 | null
    confidence: 'high' | 'moderate' | 'low'
    parts: {
      rpeDelta: number | null
      feel: number | null
      hrResidualZ: number | null
      paceResidualPct: number | null
    }
  }
  conditions: { wbgtC: number | null; heatAdjusted: boolean; gradeAdjusted: boolean }
  flags: Array<'pain' | 'focal-bone-pain' | 'heat' | 'hr-unqualified' | 'spike'>
  lines: string[]
}
export interface WeeklyDecision {
  decision: 'progress' | 'hold' | 'reduce'
  signals: Array<{ code: string; detail: string; rules: string[] }>
  nextWeekTargetMin: number
  /**
   * Set while the week lies inside a post-race window [rules H12]: the week reports its stage
   * instead of progress, hold or reduce (`decision` is 'hold' for callers that read only that).
   */
  postRace?: {
    /** 'After the race, step 2 of 3', or the rest line during the hold. */
    label: string
    phase: 'hold' | 'step'
    /** 1-based step; null during the hold. */
    step: number | null
    steps: number
    /** First day on which running is allowed. */
    holdUntil: string
    /** First day on which quality work is allowed. */
    quietUntil: string
    /** Days the check-in gate has moved the return past the default schedule. */
    extensionDays: number
  }
}
export interface ZoneProposal {
  boundary: 'cs' | 'lt1Pace' | 'thresholdPace' | 'lt1Hr' | 'hrMax'
  from: number
  to: number
  observations: number
  reason: string
  rules: string[]
}
export interface PlanChange {
  weekStart: string
  field: string
  from: unknown
  to: unknown
  rules: string[]
}
export interface EngineInput {
  today: string
  profile: AthleteProfile
  activities: Activity[]
  wellness: Array<WellnessDay & Partial<Checkin>>
  reviews: WeeklyReview[]
  goal: GoalModel
  forecast: Array<{
    time: string
    tempC: number
    dewPointC: number
    humidityPct: number
    windKph: number
    shortwaveWm2?: number
  }> | null
  existing: {
    weeks: WeekDraft[]
    sessions: Array<SessionSpec & { id: string; status: string; activityId: string | null }>
  } | null
  options: {
    recoveryCycle?: '3:1' | '2:1'
    strengthSessions?: 0 | 1 | 2
    tidModel?: 'pyramidal' | 'polarized'
  }
  /** Signs from the latest REDs screening [rules n-4]; absent means no screening. */
  screeningFlags?: number
  /**
   * Working minutes a week may not exceed, by week start: the owner's or review's lower target,
   * and the weekly decision's target after a reduce or hold [rules g-2, J5]. Sessions are placed
   * against the capped week.
   */
  weekCaps?: Record<string, number>
  /**
   * The day the owner last accepted a change of each zone boundary (supplied by the server).
   * Zone proposals ignore observations on or before it [rules C8]; absent means none accepted.
   */
  zoneChanges?: Partial<Record<ZoneProposal['boundary'], string>>
}

/**
 * A number the copy system prints in the runner's units (`formatQuantity` in `shared/copy`). It is
 * plain JSON, so a stored record keeps the quantity and not the sentence. Distances, climbs and
 * paces are in metric base units (ADR 0003); `units` only changes how they read.
 */
export type Quantity =
  | { kind: 'pace'; secPerKm: number }
  | { kind: 'speed'; kmh: number }
  | { kind: 'distance'; m: number }
  | { kind: 'climb'; m: number }
  | { kind: 'duration'; sec: number }
  | { kind: 'minutes'; min: number }
  | { kind: 'bpm'; bpm: number }
  /** A number that is already a percentage: 5.5 reads "5.5%". */
  | { kind: 'percent'; pct: number }
  /** A fraction of one: 0.2 reads "20%". */
  | { kind: 'share'; fraction: number }
  | { kind: 'count'; n: number }
  | { kind: 'temp'; c: number }
  /** "19 Oct" (short, the default), "Mon 19 Oct" (weekday) or "Mon 19 Oct 2026" (long). */
  | { kind: 'date'; iso: string; style?: 'short' | 'weekday' | 'long' }
  /** "Mon" (short, the default) or "Monday". */
  | { kind: 'weekday'; iso: string; style?: 'short' | 'long' }

/** Where a figure came from, so an explanation can link to it and show its date. */
export interface SourceRef {
  kind:
    | 'activity'
    | 'check-in'
    | 'wellness'
    | 'profile'
    | 'session'
    | 'review'
    | 'screening'
    | 'disruption'
  id: string
  /** `YYYY-MM-DD`, in the runner's local day. */
  date: string
  label: string
}

/**
 * One figure an explanation read, stored as data. `template` is a `TemplateId` of
 * `shared/copy/templates.ts` and `slots` its values; `renderFact` turns the pair into a sentence in
 * the runner's units at read time, so a copy fix reaches old records. `moreSources` counts the
 * sources beyond the ones listed.
 */
export interface InputFact {
  id: string
  template: string
  slots: Record<string, Quantity | string>
  /** The rule the figure feeds, such as `a-6`. */
  rule: string
  sources: SourceRef[]
  moreSources: number
  /** `insufficient`: the data the rule needs is missing, and the sentence says what it counts. */
  state: 'used' | 'insufficient'
  /** The dates the figure was read over, when it is a window. */
  window?: { from: string; to: string }
}

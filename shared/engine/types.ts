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
    noviceFlags: string[]
  }
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
}

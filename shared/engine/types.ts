// The contract between the engine modules, the server and the web app (training-engine plan,
// "Shared contract"). Frozen after Task E1: change it only with the plan.
import type {
  Activity,
  AthleteProfile,
  CauseCode,
  EquipmentConfig,
  EquipmentKind,
  PlanSessionStatus,
  DisruptionMode,
  DisruptionReason,
  StrengthTemplate,
  WeekRow,
  WeeklyReview,
  WeightUnit,
  WellnessDay,
} from '../types.ts'

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
/**
 * A distance derived from a session's minutes (`estimateDistance`): never stored, never a target.
 * The plan's currency stays minutes (ADR 0003); this is the figure beside them.
 */
export interface DistanceEstimate {
  /** Metres, whole. */
  distanceM: number
  /**
   * What the minutes were run at: `pace` is the session's own pace target (the work of a threshold
   * session, intervals or race-pace blocks); `easy` is the easy pace of the runner's zones, for a
   * run led by heart rate or effort; `recent` is the pace of the runner's recent logged runs, the
   * stand-in when the zones hold no pace.
   */
  basis: 'pace' | 'easy' | 'recent'
}
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
  | 'rest-window'
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
/**
 * The steadiest recent block of weeks [rules g-8]: four consecutive complete weeks of at least
 * `a5.lowFrequencyRunsPerWeek` runs each, scored by the mean of the three lowest, so one big week
 * cannot set it. Weeks count by their Monday, `weeksAgo` counting from the current week's Monday.
 */
export interface HistoryBlock {
  /** The score `H`: the mean run minutes of the block's lowest `blockWeeks - blockWeeksDropped` weeks. */
  blockMin: number
  /** Monday of the block's last week, `YYYY-MM-DD`. */
  endWeek: string
  /** Whole weeks from `endWeek` to the Monday of the current week; at least 1. */
  weeksAgo: number
  /**
   * 1 for a block that ended within `g8.creditWindowWeeks`; from there it falls in a straight line
   * to `g8.creditTaperFloor` at `g8.creditTaperEndWeeks`. With the window and the taper end equal
   * it is always 1.
   */
  taper: number
  /**
   * The best score among the blocks that ended within `g8.creditWindowWeeks`, 0 when none did.
   * The 3 x 30 start reads it (a block older than the window never lifts a start), so it differs
   * from `blockMin` only when an older block outranks every recent one after the taper.
   */
  fullCreditMin: number
}

/**
 * The positions of the load setting, in the order the form offers them [rules g-8]. The one list:
 * the request schema, the reader of a stored plan's options and the form's choices derive from it.
 */
export const LOAD_APPETITES = ['steady', 'standard', 'upper'] as const

/** The load setting of a plan [rules g-8]: steady is the engine without a history credit. */
export type LoadAppetite = (typeof LOAD_APPETITES)[number]

/** Whether a stored or received value is one of the positions. */
export const isLoadAppetite = (value: unknown): value is LoadAppetite =>
  typeof value === 'string' && (LOAD_APPETITES as readonly string[]).includes(value)

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
  /**
   * The lesser of the run minutes of the last two complete weeks, 0 unless both hold a run
   * [rules E6]. The current partial week never counts.
   */
  recentWeekMin: number
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
  /**
   * The steadiest recent block of weeks that counts toward a rebuild [rules g-8], or null when no
   * four consecutive weeks qualify. Computed from the weeks the state already holds (the snapshot's
   * activities, no query of its own).
   */
  history: HistoryBlock | null
  risk: {
    recentInjury: boolean
    /**
     * Set when a window's injury report is active or still ahead (`until` not yet past): a niggle
     * with pain at or above `pain.flagScore` or a gait change tightens the recent-injury profile
     * [rules J9, n-2]. Absent otherwise, so a state without windows is unchanged. Read it through
     * `injuryTight`, never alone.
     */
    injuryReport?: boolean
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
    /** Earlier readings plus today's own. */
    readings: number
    /** Earlier readings the range is built from: the count `j4.minReadings` is tested against. */
    baseline: number
    /** Days before the date the baseline is read from (longer for a female profile). */
    lookbackDays: number
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
/** What the engine found about one session: the part of an assessment that is not prose. */
export interface ExecutionFindings {
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
}

/**
 * One sentence about a session as data (ADR 0010): a template id of `shared/copy/execution.ts` and
 * its slots. `renderFact` writes the words.
 */
export type ExecutionLine = Pick<InputFact, 'template' | 'slots'>

/**
 * An assessment as the engine returns it and `PlanSession.execution` stores it: the findings and
 * the sentences about them as templates and slots, never as prose. A row stored before the
 * sentences became facts has `lines` in place of `facts`.
 */
export interface StoredAssessment extends ExecutionFindings {
  facts: ExecutionLine[]
}

/**
 * An assessment as the API serves it: the findings and their sentences, written from the stored
 * facts when the session is read (`executionOf` in `server/serialize.ts`).
 */
export interface ExecutionAssessment extends ExecutionFindings {
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
/**
 * A window of rest or limited running the runner reported [rule J9], as the disruption module
 * reads it. Only what the engine needs: the stored area and note are never read.
 */
export interface DisruptionWindow {
  /** The stored window's id; the engine only echoes it. */
  id: string
  reason: DisruptionReason
  /** Illness is always rest, whatever is stored. */
  mode: DisruptionMode
  /** `YYYY-MM-DD`, may lie in the past. */
  startDate: string
  /** `YYYY-MM-DD`, inclusive: the last day the reason affects training. */
  endDate: string
  /** The longest run of a day in minutes; set for `limited` only. */
  maxRunMin: number | null
  /** Niggle only, 0-10. */
  pain: number | null
  /** Niggle only: it changes how the runner walks or runs. */
  gaitChange: boolean
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
    sessions: Array<
      SessionSpec & {
        id: string
        status: string
        activityId: string | null
        /** The durable identity of the stored session (design 4.1); the server's snapshot sets it. */
        externalId?: string
      }
    >
  } | null
  options: {
    recoveryCycle?: '3:1' | '2:1'
    strengthSessions?: 0 | 1 | 2
    tidModel?: 'pyramidal' | 'polarized'
    /**
     * How fast the plan rebuilds toward a level the runner held recently [rules g-8]. Absent means
     * `steady`, today's engine. `standard` and `upper` allow the 3 x 30 start from a block of
     * weeks (E6) and are held to steady under the profiles `loadPosition` (loadSetting.ts) lists.
     */
    loadAppetite?: LoadAppetite
    /**
     * `false` leaves the gut-training block out of the plan: no `gut-training` week flag and no
     * `fuel-practice` session flag [rules H7]. Absent or `true` keeps the block. The server sets
     * `false` for a diagnosed gut condition or when the runner opts out; only flags differ.
     */
    gutTraining?: boolean
  }
  /**
   * The rest and limited-running windows the runner reported [rule J9], active ones only; absent or
   * empty means none, and the plan is the same as without the field. `illnessDays` merges the
   * illness ones with the check-ins.
   */
  disruptions?: DisruptionWindow[]
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
  /**
   * A strength load in grams, an integer (ADR 0003, ADR 0014); the runner's weight unit decides
   * how it reads ("115 lb" or "52.25 kg"), so a stored fact holds grams and no unit.
   */
  | { kind: 'load'; g: number }
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
  /** The distance of an `activity` source in metres (ADR 0003), so a page shows it in the runner's units. */
  distanceM?: number
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

// ---------------------------------------------------------------------------------------------
// The Monday brief (phase 3a design 8.3 and 8.5)
//
// Plain data throughout: what `buildBriefFacts` (`shared/engine/brief.ts`) returns and
// `WeeklyBrief.facts` stores. It holds codes, template ids and slot values, never a sentence; the
// words are written when the brief is read, in the runner's units (`shared/copy/briefRender.ts`).
// ---------------------------------------------------------------------------------------------

/** Why the weekly update wrote no revision, so the brief says so in place of "what changed". */
export type BriefReplanCode = 'goal-passed' | 'checklist' | 'no-plan' | 'not-run' | 'error'

/** The week that just ended. */
export interface BriefLastWeek {
  /** Its Monday. */
  weekStart: string
  /** Running minutes, the plain weekly total. */
  ranMin: number
  /** Minutes the plan asked for; null when no plan covered the week. */
  plannedMin: number | null
}

/** The weekly decision about last week, as the brief states it. */
export interface BriefDecision {
  /** `post-race`: the week falls in the return schedule after a race, which reports no progress, hold or reduce. */
  kind: 'progress' | 'hold' | 'reduce' | 'post-race'
  /** The running minutes the week after it is capped at. */
  nextWeekTargetMin: number
}

/** One change of the update, with the causes `attributeChange` found for it. */
export interface BriefChangeLine {
  /** What `presentDiff` makes of the change: a moved session is one line, not two. */
  type: 'week' | 'hold' | 'added' | 'removed' | 'changed' | 'moved' | 'replaced'
  date: string
  /** Never empty. */
  causes: CauseCode[]
}

/** What the update changed. The revision itself carries the lines; this is what the brief keeps. */
export interface BriefChanges {
  /** The session changes (every line that is not a week or a hold). */
  count: number
  lines: BriefChangeLine[]
  runMinBefore: number
  runMinAfter: number
}

/** The figures of `resolveTargets` that a surface shows, without its prose notes. */
export type BriefTarget = Pick<
  ResolvedTargets,
  'zone' | 'mode' | 'hrCeiling' | 'hrRange' | 'paceSecPerKm' | 'rpe' | 'hot'
>

/** The next key session: a long run, a hard workout or the race, still to be run. */
export interface BriefKeySession {
  sessionId: string
  externalId: string | null
  date: string
  kind: SessionKind
  durationMin: number
  distanceM: number | null
  gainM: number | null
  /**
   * The distance estimate beside the minutes, read from the zones the brief was built on. Absent
   * in a brief stored before the estimate existed.
   */
  distanceEstimate?: DistanceEstimate | null
  /** From `resolveTargets`, the figures the hero and the watch show. */
  target: BriefTarget
}

/** The goal race and how far off it is. */
export interface BriefCountdown {
  /** The name the runner gave the goal. */
  name: string
  date: string
  days: number
}

/** The finish estimate of this week and of the week before, rounded as Today shows an estimate. */
export interface BriefPrediction {
  nowSec: number
  priorSec: number
}

/** `WeeklyBrief.facts`. */
export interface BriefFacts {
  /** The Monday the brief opens. */
  weekStart: string
  /** The local day the figures were read on. */
  asOf: string
  lastWeek: BriefLastWeek | null
  decision: BriefDecision | null
  /** Set when the weekly update wrote no revision. */
  replan: BriefReplanCode | null
  /** Null when there is no revision to describe (a provisional brief, a replan note). */
  changes: BriefChanges | null
  /** At most `BRIEF_MAX_NOTICED`, safety first, each with the sources it rests on. */
  noticed: InputFact[]
  keySession: BriefKeySession | null
  countdown: BriefCountdown | null
  /** Set only when two weekly predictions a week apart exist. */
  prediction: BriefPrediction | null
}

// ---------------------------------------------------------------------------------------------
// The personal fuel ladder [rules H7, ADR 0011]
//
// Plain data throughout: the ladder is replayed from the runner's logs on every read and nothing
// below is stored. `shared/engine/fuel.ts` builds these; `shared/engine/fuelCopy.ts` words them.
// ---------------------------------------------------------------------------------------------

/** The switches of the fuel settings that bound the ladder. */
export interface FuelSettingsInput {
  /** Opens the rungs from the first higher tier up to the second (70 to 90 g/h by default). */
  optIn90: boolean
  /** Opens the rungs above the second tier; needs `optIn90`. */
  optInAdvanced: boolean
  /** A diagnosed gut condition: the ladder stays at the floor. */
  giDisease: boolean
}

/** One product eaten on a run, as a log's snapshot keeps it, with the servings taken. */
export interface FuelItem {
  name: string
  /** Carbohydrate in one serving, grams. */
  carbsG: number
  sodiumMg: number | null
  kcal: number | null
  /** More than one transportable carbohydrate. */
  multiCarb: boolean
  servings: number
}

/**
 * The weather a run had, as the activity stores it. WBGT needs temperature and humidity; wind and
 * solar radiation fall back to the assumptions of `execution` (no wind, shade), and a run without
 * humidity is judged on its air temperature.
 */
export interface RunWeather {
  tempC: number | null
  humidityPct: number | null
  windKph: number | null
  shortwaveWm2?: number | null
}

/** What the ladder reads from a fuel log. */
export interface FuelLogInput {
  skipped: boolean
  items: readonly FuelItem[]
  /** 0 to 4. */
  gut: number
  /** 0 to 4; null when not answered. */
  nausea: number | null
  /** The runner's own answer to "it was hot"; null means the weather decides, on every replay. */
  hotOverride: boolean | null
}

/** A logged run as the ladder replays it. */
export interface FuelRunInput {
  activityId: string
  /** The runner's local day, `YYYY-MM-DD`. */
  date: string
  /** Time of day, to order two runs on one day; null when unknown. */
  startTime: string | null
  /** Elapsed seconds, not moving seconds: eating happens at stops. */
  elapsedSec: number
  weather: RunWeather | null
  /** The flags of the plan session the run is linked to; null when the run is not linked. */
  sessionFlags: readonly SessionFlag[] | null
  log: FuelLogInput
}

/** The carbohydrate rate of a rung: one figure, and the range at the floor. */
export interface RungRate {
  /** Grams per hour; the low end at the floor. */
  gPerH: number
  /** The floor's range; null for every other rung. */
  range: [number, number] | null
}

export interface FuelRung extends RungRate {
  /** 0 is the floor. */
  index: number
  grade: Grade
  /** Every rung above the floor. */
  lowCertainty: boolean
  /** Above the first higher tier, a run counts only with enough multiple-source carbohydrate. */
  multiCarbRequired: boolean
  opens: 'always' | 'first-opt-in' | 'second-opt-in'
}

export type RungState =
  | 'tolerated'
  | 'next-up'
  | 'repeat'
  | 'later'
  | 'opt-in'
  | 'opens-after-second-tier'
  | 'gut-condition'

export interface FuelRungView extends FuelRung {
  state: RungState
}

/** Why a logged run did or did not count toward the ladder. */
export type CountReason =
  'counted' | 'skipped' | 'too-short' | 'below-target' | 'too-little-multi-carb'

export type StepOutcome =
  | 'step-up'
  | 'tolerated-top'
  | 'tolerated-more'
  | 'warm-tolerated'
  | 'hold'
  | 'fall-back'
  | 'not-counted'

/** What one logged run did to the ladder. */
export interface LadderStep {
  activityId: string
  date: string
  /** The rung being tried when the run happened. */
  rungIndex: number
  rung: RungRate
  /** The rung the target stands on after the run. */
  nextIndex: number
  next: RungRate
  /** Grams per hour of elapsed time; null when the run has no elapsed time. */
  rateGPerH: number | null
  multiCarbShare: number
  /** The higher of the gut and nausea scores. */
  score: number
  hot: boolean
  reason: CountReason
  outcome: StepOutcome
  /** The minutes a run needed to count (fewer in a gut-training week). */
  requiredMin: number
  /** For `tolerated-more`: tolerated runs still needed before the next step. */
  toleratedLeft: number | null
  /** Whether the current rung repeats after this run. */
  held: boolean
}

export type LadderBasis = 'start' | 'next-up' | 'repeat' | 'fell-back' | 'at-ceiling' | 'locked'

/** The replayed ladder. */
export interface LadderResult {
  rungs: FuelRungView[]
  /** The rung the next run tries. */
  currentIndex: number
  /** The last rung a run was tolerated on; -1 before any. */
  toleratedIndex: number
  /** The last counted run scored badly: the current rung repeats. */
  held: boolean
  locked: boolean
  /** The highest rung the settings open. */
  ceilingIndex: number
  basis: LadderBasis
  /** The nausea plan comes forward: the last counted run's nausea score reached the cut-off. */
  nauseaForward: boolean
  countedRuns: number
  /** Every logged run, oldest first. */
  steps: LadderStep[]
}

/** A plan session as the fuel target reads it (`PlanSession` fits). */
export interface FuelSessionInput {
  id: string
  date: string
  kind: SessionKind
  durationMin: number
  flags: readonly SessionFlag[]
  status: PlanSessionStatus
}

export type FuelBasis = LadderBasis | 'warm-held' | 'warm-repeat' | 'warm-steady'

/** The fuel target for one session. */
export interface FuelTarget {
  sessionId: string
  date: string
  rungIndex: number
  /** Grams per hour; the low end at the floor. */
  gPerH: number
  range: [number, number] | null
  lowCertainty: boolean
  multiCarbRequired: boolean
  basis: FuelBasis
  /** The last rung a run was tolerated on, when the basis names it. */
  lastTolerated: RungRate | null
  /** The rung a warm day held back, for the `warm-held` and `warm-repeat` bases. */
  heldBack: RungRate | null
  /** The day's forecast is hot for fuel. */
  hot: boolean
  /** The nausea plan comes forward: a hot day, or the last counted run's nausea score. */
  nauseaPlanForward: boolean
  locked: boolean
}

export interface EahCard {
  /** Events over `n7.eahStrongerAlertHours`, or heat. */
  stronger: boolean
  heading: string
  lines: string[]
}

/** What the Why drawer is opened on (phase 3a design 8.4). */
export type ExplainRequest =
  /** A planned session of the active plan, by id: a run's longest-run, volume and zone rules, then its own. */
  | { subject: 'session'; id: string }
  /** A planned week (a Monday): the ramp and volume rules that set it. */
  | { subject: 'week'; weekStart: string }
  /** The weekly decision about a finished or running week (a Monday). */
  | { subject: 'decision'; weekStart: string }
  /** Readiness as of today. */
  | { subject: 'readiness' }
  /** The zone anchors, or the anchor of one boundary. */
  | { subject: 'zone'; boundary?: ZoneProposal['boundary'] }
  /** The race prediction for one of the runner's goals. */
  | { subject: 'prediction'; goalId: string }
  /** Rule ids asked for directly, at most `EXPLAIN_MAX_RULES`. */
  | { subject: 'rules'; rules: string[] }
  /** A Monday brief: the figures stored with it. */
  | { subject: 'brief'; weekStart: string }
  /** A run: the figures stored with its insights. */
  | { subject: 'activity'; id: string }

export type ExplainSubject = ExplainRequest['subject']

/** The figures one rule read, in the order they are shown. */
export interface ExplainGroup {
  rule: string
  facts: InputFact[]
}

/**
 * The body of `GET /api/explain`. `groups` holds the rules that read the runner's numbers, each
 * with its facts (a fact is `used` or `insufficient`); `rest` lists the rules that rest on the
 * rule alone and use none of the runner's data. `frozen` is true for a brief or a run, whose
 * figures are the ones stored when it was written.
 */
export interface ExplainView {
  subject: ExplainSubject
  /** The local day the figures were read for. */
  asOf: string
  frozen: boolean
  /** The rule ids of the subject, in the order they are shown. */
  rules: string[]
  groups: ExplainGroup[]
  rest: string[]
}

// ---- Strength engine inputs (phase 3b, E14-4; ADR 0014) -----------------------------------------
//
// What `workoutFor`, `suggestLoad` and `summariseHistory` (`shared/engine/strength.ts`) read. The
// server builds one `StrengthContext` per read (`loadStrengthContext`, E14-6) from the saved
// setup, the anchors, the last 26 weeks of logs and the stored plan; the engine reads nothing else
// and no clock, so `today` and the viewed day's readiness arrive here. Every list is read as it
// comes (the engine sorts a copy), so the order of rows does not matter.

/** The runner's own account of their lifting history (design 6.2, part 3). */
export type LiftingLevel = 'new' | 'some' | 'experienced'

/**
 * How a session was run (design 9.3, 10.4). Only a `normal` session moves the working load of a
 * lift; the others are lighter than the rules asked for, or came after a gap, and neither raise
 * nor lower it.
 */
export type StrengthMode = 'normal' | 'lighter-day' | 'lighter-week' | 'taper' | 'return'

/** The saved setup (`StrengthSettings`). Until `saved`, every other field is read as its default. */
export interface StrengthSetup {
  /** False until the runner has saved the setup: the workout is then built for bodyweight only. */
  saved: boolean
  equipment: readonly EquipmentConfig[]
  level: LiftingLevel
  currentlyLifting: boolean
  /** Exercise ids the runner left out. */
  avoid: readonly string[]
  /** Slot (`knee`, `hip`, `calf`) to the exercise id the runner always uses there. */
  pinned: Readonly<Record<string, string>>
}

/** A starting point the runner entered for one exercise (`StrengthLift`, design 6.3). */
export interface StrengthAnchor {
  exerciseId: string
  /** `set` is a recent set; `max` is a maximum the runner already knows (one rep). */
  kind: 'set' | 'max'
  loadG: number
  reps: number
  /** Reps left, 0 to 5; null when the runner gave no count (read as 0). */
  rir: number | null
  /** YYYY-MM-DD. */
  asOf: string
}

/** One logged set (`StrengthSet`). */
export interface LoggedSet {
  exerciseId: string
  /** Order within the session. */
  position: number
  /** Grams; null for a movement with no added load. */
  loadG: number | null
  /** Reps, seconds or contacts, by the exercise's measure. */
  count: number
  /** Reps left, 0 to 5 (5 is five or more); null when not recorded. */
  rir: number | null
}

/**
 * What the sheet showed for one lift, from the log's snapshot (`prescribed`, design 9.3): the
 * implement the load was for and the working load the rules asked for before the mode changed it.
 */
export interface LoggedLift {
  exerciseId: string
  implement: EquipmentKind | null
  baseLoadG: number | null
}

/** One logged session (`StrengthLog` with its sets and snapshot). */
export interface StrengthLogEntry {
  id: string
  /** The activity the log stands on, so an explanation can name it as a source (no rule reads it). */
  activityId?: string
  /** YYYY-MM-DD. */
  date: string
  mode: StrengthMode
  /** The template the sheet showed; null when the snapshot has none. */
  template: StrengthTemplate | null
  sets: readonly LoggedSet[]
  lifts: readonly LoggedLift[]
}

/** One week of the stored plan, as the strength engine reads it. */
export interface StrengthWeek {
  weekStart: string
  /** The week's flags (`strength-block`, `recovery`, `taper`, `injury-return`, ...). */
  flags: string[]
  /** `taper` and `race` are read; any other phase is not. */
  phase: string
  isRecovery: boolean
  /** The run minutes the week was planned at (`plannedMinOf`), before any overshoot. */
  plannedRunMin: number
  /** The run minutes actually run; read for a finished week. */
  runMin: number
}

/** A planned strength session of the stored plan, for the A and B variants of its week. */
export interface StrengthPlannedSession {
  id: string
  date: string
  order: number
}

/** The strength session being read: a stored plan session, or the part of it the engine needs. */
export interface StrengthSessionRef {
  id: string
  date: string
  order: number
  /** The planned minutes, shown as the budget. */
  durationMin: number
  /** The session's own rule ids (`F-lib`, `F4`, `E5`, `F7`, and `H10` for an ultra goal). */
  rules: readonly string[]
}

/**
 * The viewed day's readiness, reduced to the tests rule J3 already applies to runs (design 10.4):
 * the readiness read's state, the worst pain score recently reported, and the illness phase. Null
 * in the context for a preview or a past day, which have no read and therefore no reduction.
 */
export interface StrengthReadiness {
  /** The day the read is for; it applies to a session on that day only. */
  date: string
  state: ReadinessSnapshot['state']
  /** The worst pain score of the last two days (`recentPain`); null when none. */
  pain: number | null
  illness: 'clear' | 'easy-only' | 'rest'
}

/** Everything the strength engine reads. */
export interface StrengthContext {
  /** The local day of the read. */
  today: string
  weightUnit: WeightUnit
  setup: StrengthSetup
  anchors: readonly StrengthAnchor[]
  /** Logged sessions, any order. */
  logs: readonly StrengthLogEntry[]
  /** The stored plan's weeks, any order. */
  weeks: readonly StrengthWeek[]
  /** The stored plan's strength sessions, any order. */
  sessions: readonly StrengthPlannedSession[]
  athlete: {
    /** Whole years; null when unknown. */
    age: number | null
    weightKg: number | null
    /** `state.risk.priorBsi` and `state.risk.recentInjury`. */
    risk: { priorBsi: boolean; recentInjury: boolean }
  }
  goal: {
    /** The goal's pace in km/h (distance over expected duration); null when unknown. */
    paceKmh: number | null
  }
  readiness: StrengthReadiness | null
}

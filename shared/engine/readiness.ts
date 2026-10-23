// Daily readiness: check-ins, HRV, resting HR, sleep, red flags and fatigue states
// [rules J2-J4, J6, J8, n]. Pure: the date is an argument, nothing reads a clock.
//
// Conventions fixed here:
// - A check-in item is worse when fatigue, soreness or stress is above 3, or when sleep quality
//   or mood is below 3 (design 3.2, params j2.*).
// - A "flagged day" is a poor subjective score, a low HRV or an elevated resting HR. A flag
//   counts when it persists (j3.persistenceDays) or when an objective flag comes with a poor
//   subjective score [J3]. Sleep is a weekly signal (J5) and never flags a single day.
// - HRV uses rMSSD only (hrvSdnn is Apple's measure and is never mixed in), on the ln scale.
import { SIGNAL_LIMIT } from '../copy/limits.ts'
import type { TemplateId } from '../copy/templates.ts'
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import type {
  PlanSession,
  ReadinessSignal,
  ReadinessSignalCode,
  ReadinessVerdict,
  TodayView,
} from '../types.ts'
import { illnessGate, type IllnessGate } from './disruption.ts'
import { P } from './params/index.ts'
import type {
  Checkin,
  EngineInput,
  Quantity,
  ReadinessSnapshot,
  SessionKind,
  SessionSpec,
  ZoneSet,
} from './types.ts'

type WellnessRow = EngineInput['wellness'][number]
type Advice = TodayView['sessions'][number]['advice']
type RedFlag = ReadinessSnapshot['redFlags'][number]

const QUALITY_KINDS: ReadonlySet<SessionKind> = new Set([
  'threshold',
  'intervals',
  'hills',
  'race-pace',
  'long-fast-finish',
])
const NOT_RUNNING: ReadonlySet<SessionKind> = new Set(['strength', 'mobility', 'rest', 'cross'])
const ADVICE_RANK: Record<Advice, number> = { 'as-planned': 0, 'downgrade-easy': 1, rest: 2 }

/** Hard sessions: the only ones a readiness flag can turn into an easy day [rules J3]. */
export function isQualityKind(kind: SessionKind): boolean {
  return QUALITY_KINDS.has(kind)
}

interface Ctx {
  input: EngineInput
  byDate: Map<string, WellnessRow>
}

function makeCtx(input: EngineInput): Ctx {
  return { input, byDate: new Map(input.wellness.map((row) => [row.date, row])) }
}

function validPositive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function sampleSd(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** The check-in recorded on a date, or null when the day has none of the check-in fields. */
export function checkinOn(input: EngineInput, date: string): Checkin | null {
  const row = input.wellness.find((w) => w.date === date)
  return row ? checkinOfRow(row) : null
}

/** Every check-in in the input, in the order of the wellness rows; rows with no check-in field are left out. */
export function checkinsOf(input: EngineInput): Checkin[] {
  return input.wellness.flatMap((row) => {
    const checkin = checkinOfRow(row)
    return checkin === null ? [] : [checkin]
  })
}

function checkinOfRow(row: WellnessRow): Checkin | null {
  const has =
    row.fatigue != null ||
    row.soreness != null ||
    row.sleepQuality != null ||
    row.mood != null ||
    row.stress != null ||
    row.illness === true ||
    row.painScore != null ||
    row.painFocalBone === true
  if (!has) return null
  return {
    date: row.date,
    fatigue: row.fatigue ?? null,
    soreness: row.soreness ?? null,
    sleepQuality: row.sleepQuality ?? null,
    mood: row.mood ?? null,
    stress: row.stress ?? null,
    illness: row.illness ?? false,
    painScore: row.painScore ?? null,
    painArea: row.painArea ?? null,
    painFocalBone: row.painFocalBone ?? false,
  }
}

/** Points away from normal in the worse direction, per check-in item (0 when missing). */
function itemBadness(checkin: Checkin): number[] {
  const normal = P.j2.normalScore.value
  const up = (v: number | null) => (v === null ? 0 : Math.max(0, v - normal))
  const down = (v: number | null) => (v === null ? 0 : Math.max(0, normal - v))
  return [
    up(checkin.fatigue),
    up(checkin.soreness),
    up(checkin.stress),
    down(checkin.sleepQuality),
    down(checkin.mood),
  ]
}

/** True when one item, or the items together, sit far enough from normal [rules J2]. */
export function poorSubjective(checkin: Checkin | null): boolean {
  if (!checkin) return false
  const items = itemBadness(checkin)
  return (
    Math.max(...items) >= P.j2.poorItemBadness.value ||
    items.reduce((sum, v) => sum + v, 0) >= P.j2.poorTotalBadness.value
  )
}

interface HrvEval {
  readings: number
  latest: number | null
  /** The reading itself in ms; `latest` is its natural log. */
  latestMs: number | null
  mean: number | null
  sd: number | null
  flag: boolean
}

/**
 * ln rMSSD against the rolling baseline [rules J4]: below mean minus one SD, or a decline over
 * `declineDays` consecutive days, and in both cases a fall larger than the device noise floor.
 * The device is unknown, so the larger noise floor applies; it is compared with the nightly
 * value, where the paper uses 7-night averages. Female profiles use the 35-day baseline and the
 * wider band as the proxy for a menstrual cycle, which the profile does not record.
 */
function hrvOn(ctx: Ctx, date: string): HrvEval {
  const cyclic = ctx.input.profile.sex === 'female'
  const lookback = cyclic ? P.j4.cycleBaselineDays.value : P.j4.lookbackDays.value
  const prior: number[] = []
  for (let k = 1; k <= lookback; k++) {
    const v = validPositive(ctx.byDate.get(addDays(date, -k))?.hrvRmssd)
    if (v !== null) prior.push(Math.log(v))
  }
  const base = cyclic ? prior : prior.slice(0, P.j4.windowDays.value)
  const latestMs = validPositive(ctx.byDate.get(date)?.hrvRmssd)
  const latest = latestMs === null ? null : Math.log(latestMs)
  const readings = base.length + (latestMs === null ? 0 : 1)
  if (base.length < P.j4.minReadings.value) {
    return { readings, latest, latestMs, mean: null, sd: null, flag: false }
  }
  const baseMean = mean(base)
  const baseSd = sampleSd(base)
  if (latestMs === null || latest === null) {
    return { readings, latest, latestMs, mean: baseMean, sd: baseSd, flag: false }
  }
  const floorPct =
    P.j4.noiseFloorGarminPolarWhoopPct.value + (cyclic ? P.j4.cycleBandWidenPp.value : 0)
  const dropPct = (1 - latestMs / Math.exp(baseMean)) * 100
  const belowBand = latest < baseMean - P.j4.sdBelowMean.value * baseSd && dropPct >= floorPct

  // A decline on each of the last `declineDays` days, from the reading before the run.
  const days = P.j4.declineDays.value
  const chain: number[] = [latestMs]
  for (let k = 1; k <= days; k++) {
    const v = validPositive(ctx.byDate.get(addDays(date, -k))?.hrvRmssd)
    if (v === null) break
    chain.push(v)
  }
  const falling =
    chain.length === days + 1 &&
    chain.every((v, i) => i === 0 || chain[i - 1]! < v) &&
    (1 - latestMs / chain[days]!) * 100 >= floorPct
  return { readings, latest, latestMs, mean: baseMean, sd: baseSd, flag: belowBand || falling }
}

interface RestingHrEval {
  /** The reading on the day, or null. */
  latest: number | null
  /** Mean of the rolling baseline; null with too few readings. */
  mean: number | null
  flag: boolean
}

/**
 * Resting HR against its rolling mean [rules J2, J4]. A reading this far above the mean
 * corroborates a flag and never acts alone.
 */
function restingHrEval(ctx: Ctx, date: string): RestingHrEval {
  const latest = validPositive(ctx.byDate.get(date)?.restingHr)
  if (latest === null) return { latest: null, mean: null, flag: false }
  const base: number[] = []
  for (let k = 1; k <= P.j4.lookbackDays.value && base.length < P.j4.windowDays.value; k++) {
    const v = validPositive(ctx.byDate.get(addDays(date, -k))?.restingHr)
    if (v !== null) base.push(v)
  }
  if (base.length < P.j4.minReadings.value) return { latest, mean: null, flag: false }
  const baseMean = mean(base)
  return { latest, mean: baseMean, flag: latest >= baseMean + P.j4.restingHrAboveBpm.value }
}

/** True when resting HR is flagged high on `date` [rules J2, J4]. */
function restingHrFlagOn(ctx: Ctx, date: string): boolean {
  return restingHrEval(ctx, date).flag
}

interface SleepEval {
  /** Mean of the recorded nights in hours; null with too few of them. */
  avgH: number | null
  /** Nights with a recording among the last `j5.sleepWarnNights`. */
  nights: number
}

/** Mean sleep of the last 7 nights in hours, or null with too few recorded nights [rules J5]. */
function sleepEval(ctx: Ctx, date: string): SleepEval {
  const hours: number[] = []
  for (let k = 0; k < P.j5.sleepWarnNights.value; k++) {
    const v = validPositive(ctx.byDate.get(addDays(date, -k))?.sleepSec)
    if (v !== null) hours.push(v / 3600)
  }
  return {
    avgH: hours.length >= P.j5.sleepMinNights.value ? mean(hours) : null,
    nights: hours.length,
  }
}

function sleepAvgOn(ctx: Ctx, date: string): number | null {
  return sleepEval(ctx, date).avgH
}

interface DayFlags {
  poor: boolean
  objective: boolean
  flagged: boolean
}

function dayFlags(ctx: Ctx, date: string): DayFlags {
  const row = ctx.byDate.get(date)
  const poor = row ? poorSubjective(checkinOfRow(row)) : false
  const objective = hrvOn(ctx, date).flag || restingHrFlagOn(ctx, date)
  return { poor, objective, flagged: poor || objective }
}

/** A readiness flag counts when it persists, or when an objective flag has a poor score [J3]. */
function flagCounts(ctx: Ctx, date: string): boolean {
  const persist = P.j3.persistenceDays.value
  let persisted = true
  for (let k = 0; k < persist; k++) {
    if (!dayFlags(ctx, addDays(date, -k)).flagged) persisted = false
  }
  if (persisted) return true
  const withPoor = P.j3.flaggedDaysWithPoorSubjective.value
  for (let k = 0; k < withPoor; k++) {
    if (!dayFlags(ctx, addDays(date, -k)).objective) return false
  }
  return dayFlags(ctx, date).poor
}

/**
 * Consecutive days of unexplained decline ending at `date` [rules J8]. A short gap without any
 * data is bridged (j8.maxDataGapDays); a longer gap, a day with data and no flag, or a day with
 * illness reported ends the run. A single old flagged day followed by silence is not a run.
 */
function declineStreakDays(ctx: Ctx, date: string): number {
  let streak = 0
  let gap = 0
  for (let k = 0; k < P.j8.medicalReviewDays.value; k++) {
    const d = addDays(date, -k)
    const row = ctx.byDate.get(d)
    if (row && row.illness === true) break
    const flags = dayFlags(ctx, d)
    if (flags.flagged) {
      streak = k + 1
      gap = 0
      continue
    }
    const hasData =
      row !== undefined &&
      (checkinOfRow(row) !== null || validPositive(row.hrvRmssd) !== null || row.restingHr != null)
    if (hasData) break
    gap += 1
    if (gap > P.j8.maxDataGapDays.value) break
  }
  return streak
}

export type { IllnessPhase } from './disruption.ts'

/**
 * Return-from-illness gate [rules n-3] from the check-ins: rest through the symptom-free day, easy
 * running for the next easy days, intensity after. A day without an illness report counts as
 * symptom-free; illness is never inferred from HRV or resting HR. The gate itself is
 * `illnessGate`, the only implementation of n-3, which rest windows share.
 */
export function illnessPhase(input: EngineInput, date: string): IllnessGate {
  const illnessDays = input.wellness.filter((row) => row.illness === true).map((row) => row.date)
  return illnessGate(illnessDays, date)
}

/**
 * True while the newest check-in on or before `date` reports focal bone pain [rules n-1]. It stays
 * active over days without a check-in and ends only with a later check-in that does not report it;
 * a day with sleep or heart rate data alone is not a check-in.
 */
export function focalBoneActive(input: EngineInput, date: string): boolean {
  let newest: WellnessRow | null = null
  for (const row of input.wellness) {
    if (row.date > date || checkinOfRow(row) === null) continue
    if (newest === null || row.date > newest.date) newest = row
  }
  return newest?.painFocalBone === true
}

function recentPain(input: EngineInput, date: string): number | null {
  let worst: number | null = null
  const consider = (v: number | null | undefined) => {
    if (typeof v === 'number' && (worst === null || v > worst)) worst = v
  }
  consider(checkinOn(input, date)?.painScore)
  consider(checkinOn(input, addDays(date, -1))?.painScore)
  for (const a of input.activities) {
    if (a.date === date || a.date === addDays(date, -1)) consider(a.pain)
  }
  return worst
}

/** The clinician checklist of the J8 deload suggestion; the post-race gate reuses it (H12). */
export const J8_CHECKLIST =
  'Worth checking with a clinician: energy intake, iron, illness and sleep.'

function redFlagsOn(ctx: Ctx, date: string, streak: number): RedFlag[] {
  const flags: RedFlag[] = []
  if (focalBoneActive(ctx.input, date)) {
    flags.push({
      code: 'focal-bone-pain',
      message:
        'Focal bone pain or point tenderness was reported. Progression stops here; please have it assessed by a clinician.',
      rules: ['n-1'],
    })
  }
  const pain = recentPain(ctx.input, date)
  if (pain !== null && pain >= P.pain.flagScore.value) {
    flags.push({
      code: 'pain',
      message: `Pain of ${pain} out of 10 was reported. Progression holds until it settles; see a clinician if it persists or changes how you move.`,
      rules: ['n-2', 'design-4.2'],
    })
  }
  const gate = illnessPhase(ctx.input, date)
  if (gate.phase !== 'clear') {
    flags.push({
      code: 'illness',
      message:
        gate.phase === 'rest'
          ? 'Illness was reported. Intensity is suspended; easy running resumes after a symptom-free day.'
          : 'Returning from illness. Keep to easy running for three days before any intensity.',
      rules: ['n-3'],
    })
  }
  if (streak >= P.j8.medicalReviewDays.value) {
    flags.push({
      code: 'suppression-medical-review',
      message: `Readiness has stayed lower than usual for ${streak} days with no clear explanation. A medical review is worth considering.`,
      rules: ['J8', 'n-6'],
    })
  } else if (streak >= P.j8.deloadSuggestDays.value) {
    flags.push({
      code: 'suppression-deload',
      message: `Readiness has stayed lower than usual for ${streak} days with no clear explanation. A lighter week may help. ${J8_CHECKLIST}`,
      rules: ['J8', 'n-6'],
    })
  }
  return flags
}

/** Check-in, HRV, resting HR, sleep, red flags and fatigue state for a date [rules J2-J4, J8, n]. */
export function readinessSnapshot(input: EngineInput, date: string): ReadinessSnapshot {
  const ctx = makeCtx(input)
  const hrv = hrvOn(ctx, date)
  const sleepAvgH = sleepAvgOn(ctx, date)
  const streak = declineStreakDays(ctx, date)
  const state: ReadinessSnapshot['state'] =
    streak >= P.j8.deloadSuggestDays.value
      ? 'persistent-suppression'
      : flagCounts(ctx, date)
        ? 'possible-fatigue'
        : 'normal'
  return {
    date,
    checkin: checkinOn(input, date),
    // latest, baselineMean and baselineSd are on the ln(rMSSD) scale.
    hrv: {
      readings: hrv.readings,
      latest: hrv.latest,
      baselineMean: hrv.mean,
      baselineSd: hrv.sd,
      flag: hrv.flag,
    },
    restingHrFlag: restingHrFlagOn(ctx, date),
    sleepAvgH,
    sleepFlag: sleepAvgH !== null && sleepAvgH < P.j5.sleepWarnHours.value,
    state,
    redFlags: redFlagsOn(ctx, date, streak),
  }
}

/** Masters gate [rules J6]: still worse than the own median two days after a hard session. */
function mastersGate(ctx: Ctx, date: string): boolean {
  const { input } = ctx
  if (input.profile.birthYear === null) return false
  const age = Number(date.slice(0, 4)) - input.profile.birthYear
  if (age < P.j6.mastersAgeYears.value) return false
  const waitDays = Math.ceil((P.j6.recoveryHours.value * P.j6.recoveryMultiplier.value) / 24)
  const hardDone = (input.existing?.sessions ?? []).some(
    (s) =>
      isQualityKind(s.kind) &&
      (s.status === 'completed' || s.status === 'partial') &&
      daysBetween(s.date, date) >= waitDays &&
      daysBetween(s.date, date) <= 7,
  )
  if (!hardDone) return false
  const today = checkinOn(input, date)
  if (!today) return false
  const history: Checkin[] = []
  for (let k = 1; k <= P.j6.medianDays.value; k++) {
    const row = ctx.byDate.get(addDays(date, -k))
    const c = row ? checkinOfRow(row) : null
    if (c) history.push(c)
  }
  if (history.length < P.j6.medianMinCheckins.value) return false
  const medianOf = (pick: (c: Checkin) => number | null): number | null => {
    const values = history.map(pick).filter((v): v is number => v !== null)
    return values.length >= P.j6.medianMinCheckins.value ? median(values) : null
  }
  const worse = (v: number | null, med: number | null, higherIsWorse: boolean): boolean =>
    v !== null && med !== null && (higherIsWorse ? v > med : v < med)
  return (
    worse(
      today.fatigue,
      medianOf((c) => c.fatigue),
      true,
    ) ||
    worse(
      today.soreness,
      medianOf((c) => c.soreness),
      true,
    ) ||
    worse(
      today.mood,
      medianOf((c) => c.mood),
      false,
    )
  )
}

/** Downgrade-only advice for today's sessions [rules J3]. */
export function todayAdvice(
  input: EngineInput,
  sessions: Array<SessionSpec & { id: string }>,
): TodayView['sessions'] {
  const ctx = makeCtx(input)
  const date = input.today
  const focalBone = focalBoneActive(input, date)
  const illness = illnessPhase(input, date)
  const counts = flagCounts(ctx, date)
  const masters = mastersGate(ctx, date)
  const pain = recentPain(input, date)
  const painFlag = pain !== null && pain >= P.pain.flagScore.value

  return sessions.map((s) => {
    let advice: Advice = 'as-planned'
    const reasons: string[] = []
    const raise = (to: Advice, reason: string) => {
      if (ADVICE_RANK[to] > ADVICE_RANK[advice]) advice = to
      reasons.push(reason)
    }
    if (s.kind !== 'rest') {
      const quality = isQualityKind(s.kind)
      if (illness.phase === 'rest') {
        raise('rest', 'Illness was reported: rest until a symptom-free day has passed.')
      } else if (illness.phase === 'easy-only' && quality) {
        raise('downgrade-easy', 'Returning from illness: easy running only for three days.')
      }
      if (focalBone && !NOT_RUNNING.has(s.kind)) {
        raise('rest', 'Focal bone pain was reported: no running until it has been assessed.')
      }
      if (quality && painFlag) {
        raise('downgrade-easy', 'Pain was reported: keep to easy effort today.')
      }
      if (quality && counts) {
        raise(
          'downgrade-easy',
          'Readiness signals have stayed lower than usual: an easy run keeps the day.',
        )
      }
      if (quality && masters) {
        raise(
          'downgrade-easy',
          'Soreness, fatigue or motivation is still worse than your usual two days after a hard session.',
        )
      }
    }
    return { session: toPlanSession(s), advice, reasons }
  })
}

/** Kinds the J3 downgrade leaves alone: already easy, not running, or the race itself. */
const KEEPS_AS_IS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'easy',
  'recovery',
  'strength',
  'mobility',
  'rest',
  'cross',
  'hike',
  'race',
])

/**
 * The J3 downgrade made concrete: the session as an easy run [rules J3]. Same day, order and
 * minutes (never longer), kind `easy`, title "Easy run", one steady Z1 step, no distance (time is
 * the unit), the Z1 targets of the current zones, the registry's easy RPE, the rules plus `J3`,
 * and no flags but `heat`. Everything else on the input is kept as it is, the id and the status
 * above all, so the cached hero, a watch event and an undo all point at one row.
 *
 * Easy, recovery and non-run sessions (and the race) come back unchanged. Only called for the
 * advice `downgrade-easy`; the advice `rest` withdraws the session instead. This is the only
 * definition of an eased session; every surface calls it.
 */
export function easedSession<S extends SessionSpec>(session: S, zones: ZoneSet | null): S {
  if (KEEPS_AS_IS.has(session.kind)) return session
  return {
    ...session,
    kind: 'easy',
    title: 'Easy run',
    distanceM: null,
    structure: [
      {
        kind: 'steady',
        reps: 1,
        durationSec: session.durationMin * 60,
        distanceM: null,
        zone: 'z1',
      },
    ],
    target: {
      zone: 'z1',
      rpe: [...P.expectedRpe.easy.value],
      hr: zones?.hr ? [...zones.hr.z1] : null,
      paceSecPerKm: zones?.pace ? [...zones.pace.z1] : null,
      heatNote: session.target.heatNote,
    },
    purpose: `Eased from ${session.title}: readiness signals have stayed lower than usual, so an easy run keeps the day.`,
    rules: [...new Set([...session.rules, 'J3'])],
    flags: session.flags.filter((flag) => flag === 'heat'),
  }
}

/** The prescription as a plan session; fields the engine does not know take neutral defaults. */
function toPlanSession(s: SessionSpec & { id: string }): PlanSession {
  return {
    externalId: '',
    planId: '',
    weekStart: mondayOf(s.date),
    status: 'planned',
    activityId: null,
    linkSource: null,
    execution: null,
    original: null,
    updatedAt: '',
    ...s,
  }
}

/** The 7-night sleep average ending on `date`, in hours; null with too few nights [rules J5]. */
export function sleepAverageH(input: EngineInput, date: string): number | null {
  return sleepAvgOn(makeCtx(input), date)
}

/** True when ln rMSSD is flagged low on `date` [rules J4]. */
export function hrvFlaggedOn(input: EngineInput, date: string): boolean {
  return hrvOn(makeCtx(input), date).flag
}

// ---------------------------------------------------------------------------------------------
// The readiness read on Today: a verdict and the few signals behind it [design 7.5]
// ---------------------------------------------------------------------------------------------
// Both return a template id and its slots, never prose: `renderFact` writes the sentence in the
// runner's units, and the copy-lint test renders every id (`shared/copy/today.ts`).

type Slots = ReadinessSignal['slots']

/** The templates this module builds, checked against the registry at compile time. */
const T = {
  illnessRest: 'today.signal.illness-rest',
  illnessEasy: 'today.signal.illness-easy',
  pain: 'today.signal.pain',
  painBone: 'today.signal.pain-bone',
  hrv: 'today.signal.hrv',
  hrvLow: 'today.signal.hrv-low',
  hrvBuilding: 'today.signal.hrv-building',
  restingHr: 'today.signal.resting-hr',
  restingHrHigh: 'today.signal.resting-hr-high',
  restingHrOnly: 'today.signal.resting-hr-only',
  sleep: 'today.signal.sleep',
  sleepLow: 'today.signal.sleep-low',
  checkinItems: 'today.signal.checkin-items',
  checkinItemsLow: 'today.signal.checkin-items-low',
} as const satisfies Record<string, TemplateId>

/** The fatigue row's answers, 1 (fresh) to 5 (drained). */
const FATIGUE_TEMPLATES = [
  'today.signal.checkin-fresh',
  'today.signal.checkin-good',
  'today.signal.checkin-normal',
  'today.signal.checkin-tired',
  'today.signal.checkin-drained',
] as const satisfies readonly TemplateId[]

const VERDICT_TEMPLATES = {
  ready: 'today.verdict.ready',
  'low-stays': 'today.verdict.low-stays',
  easy: 'today.verdict.easy',
  rest: 'today.verdict.rest',
  'lighter-week': 'today.verdict.lighter-week',
  'no-signals': 'today.verdict.no-signals',
} as const satisfies Record<ReadinessVerdict['code'], TemplateId>

const count = (n: number): Quantity => ({ kind: 'count', n: Math.round(n) })
const bpm = (value: number): Quantity => ({ kind: 'bpm', bpm: Math.round(value) })
const duration = (hours: number): Quantity => ({ kind: 'duration', sec: Math.round(hours * 3600) })

/**
 * The readings behind today's verdict, at most `SIGNAL_LIMIT` [rules J2-J5, n-1 to n-3]. Noted
 * readings (illness, pain at the red-flag score or focal bone pain, a low HRV, a high resting
 * heart rate, short sleep, a poor check-in) come first; within each group the order is illness,
 * pain, HRV, resting heart rate, sleep, check-in. A reading with no data gives no signal.
 *
 * HRV is shown in ms against the usual range, `exp(mean ± j4.sdBelowMean × sd)` of the ln
 * baseline; below `j4.minReadings` it says the range is still being built.
 */
export function readinessSignals(input: EngineInput, date: string): ReadinessSignal[] {
  const ctx = makeCtx(input)
  const found: ReadinessSignal[] = []
  const add = (
    code: ReadinessSignalCode,
    noted: boolean,
    template: TemplateId,
    slots: Slots = {},
  ) => {
    found.push({ code, noted, template, slots })
  }

  const gate = illnessPhase(input, date)
  if (gate.phase === 'rest') add('illness', true, T.illnessRest)
  if (gate.phase === 'easy-only') add('illness', true, T.illnessEasy)

  if (focalBoneActive(input, date)) {
    add('pain', true, T.painBone)
  } else {
    const pain = recentPain(input, date)
    if (pain !== null && pain > 0) {
      add('pain', pain >= P.pain.flagScore.value, T.pain, { score: count(pain) })
    }
  }

  const hrv = hrvOn(ctx, date)
  if (hrv.mean !== null && hrv.sd !== null) {
    if (hrv.latestMs !== null) {
      const band = P.j4.sdBelowMean.value * hrv.sd
      add('hrv', hrv.flag, hrv.flag ? T.hrvLow : T.hrv, {
        latest: count(hrv.latestMs),
        low: count(Math.exp(hrv.mean - band)),
        high: count(Math.exp(hrv.mean + band)),
      })
    }
  } else if (hrv.readings > 0) {
    add('hrv', false, T.hrvBuilding, {
      readings: count(hrv.readings),
      needed: count(P.j4.minReadings.value),
    })
  }

  const resting = restingHrEval(ctx, date)
  if (resting.latest !== null) {
    if (resting.mean === null) {
      add('resting-hr', false, T.restingHrOnly, { latest: bpm(resting.latest) })
    } else {
      // The difference is taken between the rounded figures so the sentence adds up.
      const latest = Math.round(resting.latest)
      const usual = Math.round(resting.mean)
      add('resting-hr', resting.flag, resting.flag ? T.restingHrHigh : T.restingHr, {
        latest: bpm(latest),
        usual: bpm(usual),
        ...(resting.flag ? { above: bpm(latest - usual) } : {}),
      })
    }
  }

  const sleep = sleepEval(ctx, date)
  if (sleep.avgH !== null) {
    const low = sleep.avgH < P.j5.sleepWarnHours.value
    add('sleep', low, low ? T.sleepLow : T.sleep, {
      hours: duration(sleep.avgH),
      nights: count(sleep.nights),
      ...(low ? { floor: duration(P.j5.sleepWarnHours.value) } : {}),
    })
  }

  const checkin = checkinOn(input, date)
  if (checkin !== null) {
    const noted = poorSubjective(checkin)
    if (checkin.fatigue !== null) {
      const index = Math.min(FATIGUE_TEMPLATES.length, Math.max(1, Math.round(checkin.fatigue))) - 1
      add('checkin', noted, FATIGUE_TEMPLATES[index]!)
    } else if (hasAnswers(checkin)) {
      add('checkin', noted, noted ? T.checkinItemsLow : T.checkinItems)
    }
  }

  return [...found.filter((s) => s.noted), ...found.filter((s) => !s.noted)].slice(0, SIGNAL_LIMIT)
}

/** True when a check-in answers one of the five scales; pain and illness alone do not. */
function hasAnswers(checkin: Checkin): boolean {
  return (
    checkin.fatigue !== null ||
    checkin.soreness !== null ||
    checkin.sleepQuality !== null ||
    checkin.mood !== null ||
    checkin.stress !== null
  )
}

/** The most severe of several advices: rest over an easy run over as planned. */
export function strongestAdvice(advices: readonly Advice[]): Advice {
  return advices.reduce<Advice>(
    (worst, advice) => (ADVICE_RANK[advice] > ADVICE_RANK[worst] ? advice : worst),
    'as-planned',
  )
}

/**
 * The one line on what readiness means for today [rules J3, J8]. `advice` is the strongest advice
 * across today's sessions (`strongestAdvice` over `todayAdvice`), `state` the snapshot's fatigue
 * state and `signalCount` the number of readings that exist (`readinessSignals(...).length`).
 * Readiness never adds load: every verdict is the plan as it is, an easier day or a rest day.
 */
export function readinessVerdict(input: {
  advice: Advice
  state: ReadinessSnapshot['state']
  signalCount: number
}): ReadinessVerdict {
  const code = verdictCode(input)
  return { code, template: VERDICT_TEMPLATES[code], slots: {} }
}

function verdictCode(input: {
  advice: Advice
  state: ReadinessSnapshot['state']
  signalCount: number
}): ReadinessVerdict['code'] {
  if (input.advice === 'rest') return 'rest'
  if (input.advice === 'downgrade-easy') return 'easy'
  if (input.state === 'persistent-suppression') return 'lighter-week'
  if (input.state === 'possible-fatigue') return 'low-stays'
  return input.signalCount === 0 ? 'no-signals' : 'ready'
}

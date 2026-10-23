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
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import type { PlanSession, TodayView } from '../types.ts'
import { P } from './params/index.ts'
import type { Checkin, EngineInput, ReadinessSnapshot, SessionKind, SessionSpec } from './types.ts'

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
    return { readings, latest, mean: null, sd: null, flag: false }
  }
  const baseMean = mean(base)
  const baseSd = sampleSd(base)
  if (latestMs === null || latest === null) {
    return { readings, latest, mean: baseMean, sd: baseSd, flag: false }
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
  return { readings, latest, mean: baseMean, sd: baseSd, flag: belowBand || falling }
}

/** Resting HR this far above its rolling mean corroborates, never acts alone [rules J2, J4]. */
function restingHrFlagOn(ctx: Ctx, date: string): boolean {
  const latest = validPositive(ctx.byDate.get(date)?.restingHr)
  if (latest === null) return false
  const base: number[] = []
  for (let k = 1; k <= P.j4.lookbackDays.value && base.length < P.j4.windowDays.value; k++) {
    const v = validPositive(ctx.byDate.get(addDays(date, -k))?.restingHr)
    if (v !== null) base.push(v)
  }
  if (base.length < P.j4.minReadings.value) return false
  return latest >= mean(base) + P.j4.restingHrAboveBpm.value
}

/** Mean sleep of the last 7 nights in hours, or null with too few recorded nights [rules J5]. */
function sleepAvgOn(ctx: Ctx, date: string): number | null {
  const hours: number[] = []
  for (let k = 0; k < P.j5.sleepWarnNights.value; k++) {
    const v = validPositive(ctx.byDate.get(addDays(date, -k))?.sleepSec)
    if (v !== null) hours.push(v / 3600)
  }
  return hours.length >= P.j5.sleepMinNights.value ? mean(hours) : null
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

export type IllnessPhase = 'clear' | 'rest' | 'easy-only'

/**
 * Return-from-illness gate [rules n-3]: rest through the symptom-free day, easy running for the
 * next easy days, intensity after. A day without an illness report counts as symptom-free;
 * illness is never inferred from HRV or resting HR.
 */
export function illnessPhase(
  input: EngineInput,
  date: string,
): { phase: IllnessPhase; since: number | null } {
  let last: string | null = null
  for (const row of input.wellness) {
    if (row.illness === true && row.date <= date && (last === null || row.date > last)) {
      last = row.date
    }
  }
  if (last === null) return { phase: 'clear', since: null }
  const since = daysBetween(last, date)
  const free = P.n3.illnessSymptomFreeDays.value
  const easy = P.n3.illnessEasyDaysBeforeIntensity.value
  if (since <= free) return { phase: 'rest', since }
  if (since <= free + easy) return { phase: 'easy-only', since }
  return { phase: 'clear', since }
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

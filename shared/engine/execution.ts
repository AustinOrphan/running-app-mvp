// Planned versus actual (design sections 4.1 and 4.2): which activity fulfils which session, and
// how the session went against expectation. Pure; every threshold is a parameter in
// params/m-execution.ts.
import { daysBetween } from '../dates.ts'
import { isToRun } from '../domain/sessionStatus.ts'
import type { Activity, Checkin, PlanSessionStatus } from '../types.ts'
import { liljegrenWbgt } from './heat.ts'
import { P } from './params/index.ts'
import type {
  AthleteState,
  ExecutionAssessment,
  SessionKind,
  SessionSpec,
  ZoneSet,
} from './types.ts'

const SEC_PER_MIN = 60
const M_PER_KM = 1000

/** The athlete's own HR-at-pace model from steady flat runs [rules A8]. */
export interface HrModel {
  /** Qualifying runs in the window. */
  runs: number
  interceptBpm: number
  slopeBpmPerMps: number
  /** HR added per degree of WBGT above the optimum band, after shrinkage towards the prior. */
  heatBpmPerC: number
  residualSdBpm: number
}

/** Context of an assessment. `hrModel` and `checkin` are optional: without them those parts drop out. */
export interface ExecutionContext {
  zones: ZoneSet
  state: AthleteState
  /** From `fitHrModel`; null or absent gives no HR residual. */
  hrModel?: HrModel | null
  /** The day's check-in pain fields, for the focal bone pain flag [rules section n]. */
  checkin?: Pick<Checkin, 'painScore' | 'painFocalBone'> | null
}

// ---------------------------------------------------------------------------------------------
// Compatibility and matching (design 4.1)
// ---------------------------------------------------------------------------------------------

const RUN_KINDS: ReadonlySet<SessionKind> = new Set([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'b2b',
  'race',
])

/** Kinds whose whole-run HR cannot be read against one zone (hills, intervals, off-road, non-running) [rules B2]. */
const HR_UNSUITED_KINDS: ReadonlySet<SessionKind> = new Set([
  'intervals',
  'hills',
  'strides',
  'hike',
  'strength',
  'mobility',
  'rest',
  'cross',
])

/**
 * Whether an activity counts: `possible` and `confirmed` duplicates do not, while `dismissed` rows
 * (owner said not a duplicate, `duplicateOfId` kept) do, as in shared/domain/stats.ts.
 */
function counts(activity: Activity): boolean {
  return activity.duplicateStatus === 'none' || activity.duplicateStatus === 'dismissed'
}

/** Whether an activity can fulfil a session of this kind. */
function compatible(kind: SessionKind, activity: Activity): boolean {
  const subtype = (activity.subtype ?? '').toLowerCase()
  if (RUN_KINDS.has(kind)) return activity.type === 'run' || activity.type === 'race'
  if (kind === 'hike') {
    return activity.type === 'cross' && (subtype === 'hike' || subtype === 'walk')
  }
  if (kind === 'strength') return activity.type === 'strength'
  if (kind === 'mobility' || kind === 'cross') return activity.type === 'cross'
  return false
}

type MatchSession = SessionSpec & {
  id: string
  activityId: string | null
  linkSource: string | null
  /** Present on stored sessions; an adjacent-day match needs one still to run (`isToRun`). */
  status?: string
}

function matchScore(plannedMin: number, activity: Activity, dayOffset: number): number {
  const actualMin = Math.max(activity.durationSec / SEC_PER_MIN, 1)
  const planned = Math.max(plannedMin, 1)
  const base = Math.abs(Math.log(actualMin / planned))
  return dayOffset === 0 ? base : base + P.matching.adjacentDayPenalty.value
}

/** Links unlinked activities to unlinked planned sessions; owner links are never touched. */
export function matchSessions(
  sessions: MatchSession[],
  activities: Activity[],
): Array<{ sessionId: string; activityId: string }> {
  const linkedActivities = new Set(
    sessions.map((s) => s.activityId).filter((id): id is string => id !== null),
  )
  const freeSessions = sessions.filter(
    (s) => s.activityId === null && s.linkSource !== 'owner' && s.kind !== 'rest',
  )
  const freeActivities = activities.filter((a) => !linkedActivities.has(a.id) && counts(a))

  const takenSessions = new Set<string>()
  const takenActivities = new Set<string>()
  const out: Array<{ sessionId: string; activityId: string; date: string; order: number }> = []

  /** One greedy pass over day offsets `minOffset..maxOffset`, lowest score first. */
  const pass = (minOffset: number, maxOffset: number) => {
    const pairs: Array<{ session: MatchSession; activity: Activity; score: number }> = []
    for (const session of freeSessions) {
      if (takenSessions.has(session.id)) continue
      for (const activity of freeActivities) {
        if (takenActivities.has(activity.id) || !compatible(session.kind, activity)) continue
        const offset = Math.abs(daysBetween(session.date, activity.date))
        if (offset < minOffset || offset > maxOffset) continue
        if (
          offset > 0 &&
          session.status !== undefined &&
          !isToRun(session.status as PlanSessionStatus)
        )
          continue
        pairs.push({ session, activity, score: matchScore(session.durationMin, activity, offset) })
      }
    }
    pairs.sort(
      (x, y) =>
        x.score - y.score ||
        x.session.order - y.session.order ||
        x.session.date.localeCompare(y.session.date) ||
        x.session.id.localeCompare(y.session.id) ||
        x.activity.id.localeCompare(y.activity.id),
    )
    for (const { session, activity } of pairs) {
      if (takenSessions.has(session.id) || takenActivities.has(activity.id)) continue
      takenSessions.add(session.id)
      takenActivities.add(activity.id)
      out.push({
        sessionId: session.id,
        activityId: activity.id,
        date: session.date,
        order: session.order,
      })
    }
  }

  pass(0, 0)
  pass(1, P.matching.maxDayOffset.value)

  return out
    .sort((x, y) => x.date.localeCompare(y.date) || x.order - y.order)
    .map(({ sessionId, activityId }) => ({ sessionId, activityId }))
}

// ---------------------------------------------------------------------------------------------
// Conditions and HR qualification
// ---------------------------------------------------------------------------------------------

/** The WBGT of the weather an activity recorded, from the Liljegren model; null without temperature and humidity. */
export function wbgtOf(activity: Activity): number | null {
  if (activity.tempC === null || activity.humidityPct === null) return null
  return liljegrenWbgt({
    tempC: activity.tempC,
    humidityPct: activity.humidityPct,
    windKph: activity.windKph ?? 0,
    shortwaveWm2: P.conditions.assumedShortwaveWm2.value,
  })
}

/** Degrees of WBGT above the heat-adjustment threshold, 0 below it or without a reading. */
export function heatExcessC(wbgtC: number | null): number {
  return wbgtC === null ? 0 : Math.max(0, wbgtC - P.conditions.heatAdjustAboveWbgtC.value)
}

/** Grade-adjusted speed in m/s, falling back to plain distance; null when not computable. */
function speedMps(activity: Activity): number | null {
  const distance = activity.gapDistanceM ?? activity.distanceM
  const seconds = activity.movingSec ?? activity.durationSec
  if (distance === null || distance <= 0 || seconds <= 0) return null
  return distance / seconds
}

function histogramTotalSec(activity: Activity): number {
  return activity.hrHistogram?.sec.reduce((sum, s) => sum + s, 0) ?? 0
}

/** Flat, with a sampled histogram: the checks every HR use needs [rules B2]. */
function hrDataUsable(activity: Activity): boolean {
  if (activity.avgHr === null || activity.hrHistogram === null) return false
  if (activity.durationSec <= 0) return false
  if (histogramTotalSec(activity) / activity.durationSec < P.hrModel.minHistogramCoverage.value) {
    return false
  }
  if (activity.elevationGainM !== null && activity.distanceM !== null && activity.distanceM > 0) {
    const gainPerKm = activity.elevationGainM / (activity.distanceM / M_PER_KM)
    if (gainPerKm > P.hrModel.maxGainPerKm.value) return false
  }
  return true
}

function hasWorkSteps(session: SessionSpec): boolean {
  return session.structure.some((step) => step.kind === 'work')
}

function hrQualifiesForSession(session: SessionSpec, activity: Activity): boolean {
  if (HR_UNSUITED_KINDS.has(session.kind) || hasWorkSteps(session)) return false
  return hrDataUsable(activity)
}

/** Seconds below, within and above a band; bins are split in proportion to their overlap. */
function timeInBand(
  hist: NonNullable<Activity['hrHistogram']>,
  lo: number,
  hi: number,
): { below: number; within: number; above: number } {
  let below = 0
  let within = 0
  let above = 0
  hist.sec.forEach((sec, i) => {
    const binLo = hist.start + i * hist.width
    const binHi = binLo + hist.width
    const inside = Math.max(0, Math.min(binHi, hi) - Math.max(binLo, lo))
    const under = Math.max(0, Math.min(binHi, lo) - binLo)
    const over = Math.max(0, binHi - Math.max(binLo, hi))
    const share = (part: number) => (sec * part) / hist.width
    within += share(inside)
    below += share(under)
    above += share(over)
  })
  return { below, within, above }
}

/** Share of the time spent within the steady band around the average HR. */
function steadyShare(activity: Activity): number {
  const hist = activity.hrHistogram
  const total = histogramTotalSec(activity)
  if (hist === null || activity.avgHr === null || total <= 0) return 0
  const lo = activity.avgHr - P.hrModel.steadyBandBpm.value
  const hi = activity.avgHr + P.hrModel.steadyBandBpm.value
  return timeInBand(hist, lo, hi).within / total
}

// ---------------------------------------------------------------------------------------------
// HR-at-pace model (design 4.2, rules A8, G3)
// ---------------------------------------------------------------------------------------------

/** Solves the square system `a x = b` by Gaussian elimination; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i] as number])
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r
    }
    if (Math.abs(m[pivot]![col]!) < Number.EPSILON) return null
    ;[m[col], m[pivot]] = [m[pivot]!, m[col]!]
    for (let r = col + 1; r < n; r += 1) {
      const factor = m[r]![col]! / m[col]![col]!
      for (let c = col; c <= n; c += 1) m[r]![c] = m[r]![c]! - factor * m[col]![c]!
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = m[r]![n]!
    for (let c = r + 1; c < n; c += 1) sum -= m[r]![c]! * x[c]!
    x[r] = sum / m[r]![r]!
  }
  return x
}

/** Least squares for y = beta . x over rows of regressors (the intercept column is the caller's). */
function leastSquares(rows: number[][], y: number[]): number[] | null {
  const k = rows[0]?.length ?? 0
  const xtx = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  const xty = new Array<number>(k).fill(0)
  rows.forEach((row, i) => {
    for (let a = 0; a < k; a += 1) {
      xty[a] = xty[a]! + row[a]! * y[i]!
      for (let b = 0; b < k; b += 1) xtx[a]![b] = xtx[a]![b]! + row[a]! * row[b]!
    }
  })
  const beta = solve(xtx, xty)
  return beta !== null && beta.every(Number.isFinite) ? beta : null
}

/**
 * Fits HR against grade-adjusted speed on the steady flat runs of the last
 * `hrModel.windowWeeks` weeks, with a heat term that starts at the prior and moves towards the
 * athlete's own hot runs by shrinkage. Null with fewer than `hrModel.minQualifyingRuns` runs:
 * never a guess.
 */
export function fitHrModel(activities: Activity[], today: string): HrModel | null {
  const windowDays = P.hrModel.windowWeeks.value * 7
  const points: Array<{ v: number; h: number; hr: number }> = []
  for (const a of activities) {
    if (a.type !== 'run' || !counts(a) || a.avgHr === null) continue
    const age = daysBetween(a.date, today)
    if (age < 0 || age >= windowDays) continue
    if (a.durationSec < P.hrModel.minDurationMin.value * SEC_PER_MIN) continue
    if (!hrDataUsable(a) || steadyShare(a) < P.hrModel.steadyMinShare.value) continue
    const v = speedMps(a)
    if (v === null) continue
    points.push({ v, h: heatExcessC(wbgtOf(a)), hr: a.avgHr })
  }
  const n = points.length
  if (n < P.hrModel.minQualifyingRuns.value) return null

  const meanHr = points.reduce((s, p) => s + p.hr, 0) / n
  const priorBpmPerC = (P.hrModel.heatPriorPctPerC.value / 100) * meanHr

  // Personal heat slope from all runs jointly, shrunk towards the prior by the hot-run count.
  const hotRuns = points.filter((p) => p.h > 0).length
  let personal = priorBpmPerC
  if (hotRuns >= 2) {
    const joint = leastSquares(
      points.map((p) => [1, p.v, p.h]),
      points.map((p) => p.hr),
    )
    if (joint !== null) personal = joint[2]!
  }
  const prior = P.hrModel.shrinkagePriorRuns.value
  const heat = Math.max(0, (hotRuns * personal + prior * priorBpmPerC) / (hotRuns + prior))

  const adjusted = points.map((p) => p.hr - heat * p.h)
  const line = leastSquares(
    points.map((p) => [1, p.v]),
    adjusted,
  )
  const meanAdjusted = adjusted.reduce((s, x) => s + x, 0) / n
  const intercept = line?.[0] ?? meanAdjusted
  const slope = line?.[1] ?? 0
  const sumSq = points.reduce((s, p, i) => {
    const resid = adjusted[i]! - (intercept + slope * p.v)
    return s + resid * resid
  }, 0)
  const fittedParams = line === null ? 1 : 2
  const sd = Math.sqrt(sumSq / Math.max(n - fittedParams, 1))
  return {
    runs: n,
    interceptBpm: intercept,
    slopeBpmPerMps: slope,
    heatBpmPerC: heat,
    residualSdBpm: Math.max(sd, P.hrModel.minResidualSdBpm.value),
  }
}

// ---------------------------------------------------------------------------------------------
// Assessment (design 4.2)
// ---------------------------------------------------------------------------------------------

function midpoint(range: [number, number]): number {
  return (range[0] + range[1]) / 2
}

function completionOf(
  session: SessionSpec,
  activity: Activity,
): { completion: ExecutionAssessment['completion']; ratio: number | null } {
  if (!compatible(session.kind, activity)) return { completion: 'modified', ratio: null }
  if (session.durationMin <= 0) return { completion: 'completed', ratio: null }
  const ratio = activity.durationSec / SEC_PER_MIN / session.durationMin
  if (ratio < P.completion.partialBelow.value) return { completion: 'partial', ratio }
  if (ratio > P.completion.extendedAbove.value) return { completion: 'extended', ratio }
  return { completion: 'completed', ratio }
}

/** The target band of a session for one channel, from the session or else the zone set. */
function bandZone(session: SessionSpec): 'z1' | 'z2' | 'z3' | null {
  const zone = session.target.zone
  return zone === 'z1' || zone === 'z2' || zone === 'z3' ? zone : null
}

function paceBandOf(session: SessionSpec, ctx: ExecutionContext): [number, number] | null {
  const zone = bandZone(session)
  return session.target.paceSecPerKm ?? (zone ? (ctx.zones.pace?.[zone] ?? null) : null)
}

function intensityOf(
  session: SessionSpec,
  activity: Activity,
  ctx: ExecutionContext,
  hrQualified: boolean,
  wbgtC: number | null,
): ExecutionAssessment['intensity'] {
  if (hasWorkSteps(session)) return 'unknown'
  const zone = bandZone(session)
  const hrBand = session.target.hr ?? (zone ? (ctx.zones.hr?.[zone] ?? null) : null)
  const heatC = heatExcessC(wbgtC)

  if (hrQualified && hrBand !== null && activity.hrHistogram !== null) {
    const shiftBpm = ctx.hrModel
      ? ctx.hrModel.heatBpmPerC * heatC
      : (P.hrModel.heatPriorPctPerC.value / 100) * midpoint(hrBand) * heatC
    const t = timeInBand(activity.hrHistogram, hrBand[0] + shiftBpm, hrBand[1] + shiftBpm)
    const total = t.below + t.within + t.above
    if (total > 0) {
      if (t.within / total >= P.intensity.onTargetMinShare.value) return 'on'
      return t.above > t.below ? 'above' : 'below'
    }
  }

  const paceBand = paceBandOf(session, ctx)
  const speed = speedMps(activity)
  if (paceBand === null || speed === null) return 'unknown'
  const pace = M_PER_KM / speed
  const tolerance = P.intensity.paceBandTolerancePct.value / 100
  const slowLimit = Math.max(...paceBand) * (1 + tolerance)
  const fastLimit = Math.min(...paceBand) * (1 - tolerance)
  if (pace < fastLimit) return 'above'
  // A slower pace in the heat cannot be told apart from heat.
  if (pace > slowLimit) return heatC > 0 ? 'unknown' : 'below'
  return 'on'
}

/** G-1 against the 30-day longest completed run; gain and descent with the H4 minimum step. */
function spikeOf(activity: Activity, state: AthleteState): boolean {
  if (activity.type !== 'run' && activity.type !== 'race') return false
  const longest = state.longest30d
  const ratio = P.g1.spikeRatioWarn.value
  const climbLimit = (max: number) => Math.max(max * ratio, max + P.h4.minStepGainM.value)
  if (longest.distanceM > 0 && activity.distanceM !== null) {
    const limit = Math.max(
      longest.distanceM * ratio,
      longest.distanceM + P.g1.minStepDistanceM.value,
    )
    if (activity.distanceM > limit) return true
  }
  if (longest.durationSec > 0 && activity.durationSec > longest.durationSec * ratio) return true
  if ((activity.elevationGainM ?? 0) > climbLimit(longest.gainM)) return true
  if ((activity.elevationLossM ?? 0) > climbLimit(longest.lossM)) return true
  return false
}

/**
 * True when the owner's own rating (RPE or the feel) is among the parts. Heart rate and pace alone
 * are inferences about effort, so a score built from them is a guess [rules J2].
 */
export function hasSubjectivePart(parts: ExecutionAssessment['effort']['parts']): boolean {
  return parts.rpeDelta !== null || parts.feel !== null
}

function effortScore(
  parts: ExecutionAssessment['effort']['parts'],
): Pick<ExecutionAssessment['effort'], 'score' | 'confidence'> {
  const E = P.effort
  const terms: Array<{ weight: number; units: number }> = []
  if (parts.rpeDelta !== null) {
    terms.push({ weight: E.weightRpe.value, units: parts.rpeDelta / E.rpePointsPerUnit.value })
  }
  if (parts.feel !== null) terms.push({ weight: E.weightFeel.value, units: parts.feel })
  if (parts.hrResidualZ !== null) {
    terms.push({ weight: E.weightHr.value, units: parts.hrResidualZ / E.hrResidualZPerUnit.value })
  }
  if (parts.paceResidualPct !== null) {
    terms.push({
      weight: E.weightPace.value,
      units: parts.paceResidualPct / E.paceResidualPctPerUnit.value,
    })
  }
  const subjective = hasSubjectivePart(parts)
  // With no rating from the owner the score is a guess from heart rate or pace: at most one step
  // either way, and low confidence, whatever the number of parts.
  const confidence = !subjective
    ? 'low'
    : terms.length >= E.confidenceHighMinParts.value
      ? 'high'
      : terms.length >= E.confidenceModerateMinParts.value
        ? 'moderate'
        : 'low'
  const totalWeight = terms.reduce((s, t) => s + t.weight, 0)
  if (terms.length === 0 || totalWeight <= 0) return { score: null, confidence }
  const weighted = terms.reduce((s, t) => s + t.weight * t.units, 0) / totalWeight
  const size = Math.abs(weighted)
  const sign = weighted < 0 ? -1 : 1
  if (size < E.neutralHalfWidth.value) return { score: 0, confidence }
  if (size < E.strongFrom.value) return { score: (sign * 1) as 1 | -1, confidence }
  if (!subjective) return { score: (sign * 1) as 1 | -1, confidence }
  return { score: (sign * 2) as 2 | -2, confidence }
}

function round1(x: number): number {
  return Math.round(x * 10) / 10
}

/** Completion, intensity and effort of an activity against the session it fulfils. */
export function assessExecution(
  session: SessionSpec,
  activity: Activity,
  ctx: ExecutionContext,
): ExecutionAssessment {
  const { completion, ratio } = completionOf(session, activity)
  const modified = completion === 'modified'
  const wbgtC = wbgtOf(activity)
  const heatAdjusted = wbgtC !== null && wbgtC > P.conditions.heatAdjustAboveWbgtC.value
  const heatC = heatExcessC(wbgtC)
  const hrPresent = activity.avgHr !== null || activity.hrHistogram !== null
  const hrQualified = !modified && hrQualifiesForSession(session, activity)
  const speed = speedMps(activity)

  const intensity = modified ? 'unknown' : intensityOf(session, activity, ctx, hrQualified, wbgtC)

  // Effort parts, positive meaning harder than expected. A different kind of activity has no
  // expectation to compare with, so only the feel rating counts.
  const expected = P.expectedRpe[session.kind].value
  const rpeDelta =
    !modified && activity.rpe !== null ? round1(activity.rpe - midpoint(expected)) : null
  const feel = activity.feel

  let hrResidualZ: number | null = null
  if (hrQualified && ctx.hrModel && speed !== null && activity.avgHr !== null) {
    const m = ctx.hrModel
    const expectedHr = m.interceptBpm + m.slopeBpmPerMps * speed + m.heatBpmPerC * heatC
    hrResidualZ = round1((activity.avgHr - expectedHr) / m.residualSdBpm)
  }

  // A slower pace in the heat is not an easier effort, so the pace part is left out there.
  const paceBand = paceBandOf(session, ctx)
  let paceResidualPct: number | null = null
  if (!modified && !heatAdjusted && !hasWorkSteps(session) && paceBand !== null && speed !== null) {
    const targetPace = midpoint(paceBand)
    paceResidualPct = round1(((targetPace - M_PER_KM / speed) / targetPace) * 100)
  }

  const parts = { rpeDelta, feel, hrResidualZ, paceResidualPct }
  const { score, confidence } = effortScore(parts)

  const pain = Math.max(activity.pain ?? 0, ctx.checkin?.painScore ?? 0)
  const focalBone = ctx.checkin?.painFocalBone === true
  const flags: ExecutionAssessment['flags'] = []
  if (pain >= P.pain.flagScore.value) flags.push('pain')
  if (focalBone) flags.push('focal-bone-pain')
  if (heatAdjusted) flags.push('heat')
  if (hrPresent && !hrQualified) flags.push('hr-unqualified')
  if (spikeOf(activity, ctx.state)) flags.push('spike')

  const lines: string[] = []
  const actualMin = Math.round(activity.durationSec / SEC_PER_MIN)
  if (modified) {
    lines.push(`A different kind of activity than the planned ${session.kind} session.`)
  } else if (ratio !== null) {
    lines.push(
      `${actualMin} min against ${session.durationMin} planned (${Math.round(ratio * 100)}%).`,
    )
  } else {
    lines.push(`${actualMin} min done.`)
  }
  if (intensity === 'on') lines.push('Intensity stayed in the target range.')
  else if (intensity === 'above') lines.push('Intensity ran above the target range.')
  else if (intensity === 'below') lines.push('Intensity stayed below the target range.')
  if (score !== null && score >= 1) {
    const detail =
      rpeDelta !== null
        ? ` RPE ${activity.rpe} against ${expected[0]}-${expected[1]} expected for this kind.`
        : ''
    lines.push(`Effort felt ${score === 2 ? 'much ' : ''}harder than expected.${detail}`)
  } else if (score !== null && score <= -1) {
    lines.push(`Effort felt ${score === -2 ? 'much ' : ''}easier than expected.`)
  } else if (score === 0) {
    lines.push('Effort matched expectation.')
  }
  if (heatAdjusted && wbgtC !== null) {
    lines.push(
      `Warm conditions (WBGT about ${Math.round(wbgtC)} C): the heart-rate expectation was raised and pace was not judged.`,
    )
  }
  if (flags.includes('hr-unqualified')) {
    lines.push('Heart rate was not used: it does not qualify for this kind of run.')
  }
  if (flags.includes('focal-bone-pain')) {
    lines.push('Focal bone pain reported. Rest and see the guidance on warning signs.')
  } else if (flags.includes('pain')) {
    lines.push(
      `Pain ${pain} of 10 reported. See the guidance on warning signs before the next run.`,
    )
  }
  if (flags.includes('spike')) {
    lines.push(
      'Longer or steeper than the longest run of the last 30 days by more than the usual step.',
    )
  }

  return {
    completion,
    intensity,
    effort: { score, confidence, parts },
    conditions: { wbgtC, heatAdjusted, gradeAdjusted: activity.gapDistanceM !== null },
    flags,
    lines,
  }
}

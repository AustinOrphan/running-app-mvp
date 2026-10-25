// Weekly adaptation: progress, hold or reduce; zone proposals; break restarts; quality trims
// [rules J5, J7, G-6, C8; design 4.3]. Pure: `today` comes from the input.
//
// Convention: an efficiency-index trend below zero is a decline (the index rises when pace at a
// fixed HR improves).
import { addDays } from '../dates.ts'
import { isTrimmed, TRIM_RULE } from '../domain/sessionStatus.ts'
import { aggregateWeeks } from '../domain/weeks.ts'
import type { Activity } from '../types.ts'
import { efficiencyIndex } from './athlete.ts'
import { dayRulesIn, disruptionPlan, heldDates, restartFraction } from './disruption.ts'
import { hasSubjectivePart } from './execution.ts'
import { nextWeekCap } from './guards.ts'
import { plannedMinOf, wholeMinutes, type RebuildZone } from './limits.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'
import { lastWindowDay, postRaceWindows, stageLabel, windowDay } from './postRace.ts'
import {
  checkinOn,
  hrvFlaggedOn,
  isQualityKind,
  poorSubjective,
  readinessSnapshot,
  sleepAverageH,
} from './readiness.ts'
import { isProgrammeWeek } from './startWeeks.ts'
import type {
  AthleteState,
  EngineInput,
  ExecutionFindings,
  SessionKind,
  SessionSpec,
  WeeklyDecision,
  ZoneProposal,
} from './types.ts'

/** An execution assessment with the date and kind of the session it belongs to. */
export interface ExecutionRecord {
  date: string
  kind: SessionKind
  assessment: ExecutionFindings
}

/** What the engine state adds to the weekly decision; every field is optional. */
export interface WeeklyContext {
  /** Defaults to the index computed from the input activities. */
  efficiency?: AthleteState['efficiency']
  /** Assessments of the week's sessions; without them, effort comes from RPE and feel. */
  executions?: ExecutionRecord[]
  /** REDs screen flags [rules n-4]. */
  redsFlags?: number
  /** The first hot days of a season [rules I9]. */
  heatFirstDays?: boolean
  /** Drop in sleep efficiency over the week, in percentage points. */
  sleepEfficiencyDropPp?: number | null
  /** Weekly ramp; defaults to the soft ramp, and the caller passes a tightened one by profile. */
  ramp?: number
  /**
   * The rebuild zone of the plan [rules g-8] (`rebuildZone`, loadSetting.ts): below its ceiling the
   * cap on the next week grows by the zone's step, as the plan does, so the cap and the plan agree.
   * Absent at steady.
   */
  rebuild?: RebuildZone | null
}

type Signal = WeeklyDecision['signals'][number]

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
const POOR_EFFORT_FLAGS: ReadonlySet<ExecutionFindings['flags'][number]> = new Set([
  'pain',
  'focal-bone-pain',
  'heat',
  'spike',
])

interface Observation {
  date: string
  kind: SessionKind
  score: number | null
  /** The score rests on the runner's own rating (RPE or feel), not on heart rate or pace alone. */
  subjective: boolean
  /** Heat, pain or a spike: such a session does not move a boundary [rules C8]. */
  excluded: boolean
}

/** Effort score from RPE against the expected range and the feel rating (design 4.2 weights). */
function feedbackScore(kind: SessionKind, activity: Activity): number | null {
  const [lo, hi] = P.expectedRpe[kind].value
  const parts: Array<{ weight: number; units: number }> = []
  if (activity.rpe !== null) {
    parts.push({
      weight: P.effort.weightRpe.value,
      units: (activity.rpe - (lo + hi) / 2) / P.effort.rpePointsPerUnit.value,
    })
  }
  if (activity.feel !== null)
    parts.push({ weight: P.effort.weightFeel.value, units: activity.feel })
  if (parts.length === 0) return null
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0)
  const weighted = parts.reduce((sum, p) => sum + p.weight * p.units, 0) / totalWeight
  const size = Math.abs(weighted)
  if (size < P.effort.neutralHalfWidth.value) return 0
  return Math.sign(weighted) * (size >= P.effort.strongFrom.value ? 2 : 1)
}

/** Observations from assessments when given, else from linked sessions and their feedback. */
function observations(
  input: EngineInput,
  executions: ExecutionRecord[] | undefined,
): Observation[] {
  if (executions) {
    return executions.map((e) => ({
      date: e.date,
      kind: e.kind,
      score: e.assessment.effort.score,
      subjective: hasSubjectivePart(e.assessment.effort.parts),
      excluded: e.assessment.flags.some((f) => POOR_EFFORT_FLAGS.has(f)),
    }))
  }
  const byId = new Map(input.activities.map((a) => [a.id, a]))
  const out: Observation[] = []
  for (const s of input.existing?.sessions ?? []) {
    const activity = s.activityId ? byId.get(s.activityId) : undefined
    if (!activity) continue
    const pain = activity.pain !== null && activity.pain >= P.pain.flagScore.value
    out.push({
      date: s.date,
      kind: s.kind,
      score: feedbackScore(s.kind, activity),
      // Built from RPE and feel only.
      subjective: true,
      excluded: pain || s.flags.includes('heat'),
    })
  }
  return out
}

function minutes(sessions: Array<{ durationMin: number }>): number {
  return sessions.reduce((sum, s) => sum + s.durationMin, 0)
}

function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * A week inside a post-race window reports its stage instead of progress, hold or reduce
 * [rules H12]: the plan follows the window, and a rating can only delay it. `decision` is 'hold'
 * for callers that read only that, and the next week keeps the minutes the plan holds for it.
 */
function postRaceDecision(
  input: EngineInput,
  weekStart: string,
  asOf: string,
  ramp: number,
): WeeklyDecision | null {
  const weekEnd = addDays(weekStart, 6)
  const { own, past } = postRaceWindows(input)
  // the goal race's window counts for the weeks the plan marks as post-race; a past race's window
  // for any week it covers, since the plan was built inside it
  const planned = input.existing?.weeks.some(
    (w) => w.weekStart === weekStart && w.flags.includes('post-race'),
  )
  const window = [past, planned === true ? own : null].find(
    (w) => w !== null && w.race.date <= asOf && w.race.date <= weekEnd && w.quietUntil > weekStart,
  )
  if (window === null || window === undefined) return null
  // the stage on the last day of the week that is not ahead of today, kept inside the window
  const day = [asOf, weekEnd, lastWindowDay(window)].reduce((a, b) => (a < b ? a : b))
  const at = day < window.race.date ? window.race.date : day
  const info = windowDay(window, at)
  const label = stageLabel(window, at)
  const next = input.existing?.weeks.find((w) => w.weekStart === addDays(weekStart, 7))
  const signals: WeeklyDecision['signals'] = [
    { code: 'post-race-stage', detail: label, rules: ['H12'] },
  ]
  if (window.extensionDays > 0) {
    signals.push({
      code: 'post-race-delayed',
      detail: `A sore, tired, painful or ill day keeps you at your current step: the return is ${window.extensionDays} day${window.extensionDays === 1 ? '' : 's'} later than the default schedule, and a good day does not speed it up.`,
      rules: ['H12', 'J3'],
    })
  }
  // The last post-race week of a plan has no next week: the minutes then follow the rule of a
  // held week, never a suggestion of 0 minutes [rules G-6, J5].
  const actual = aggregateWeeks(input.activities, [weekStart])[0]!.runMin
  const plannedThis = plannedWeekMin(input, weekStart) ?? actual
  return {
    decision: 'hold',
    signals,
    nextWeekTargetMin: next?.targetRunMin ?? wholeMinutes(nextWeekCap(plannedThis, actual, ramp)),
    postRace: {
      label,
      phase: info?.kind === 'step' ? 'step' : 'hold',
      step: info?.kind === 'step' ? info.stage.step : null,
      steps: window.stages.length,
      holdUntil: window.holdUntil,
      quietUntil: window.quietUntil,
      extensionDays: window.extensionDays,
    },
  }
}

const NO_DATES: ReadonlySet<string> = new Set()

/**
 * The days of a week a rest window holds [rule J9]: no run is asked of them, so completion does not
 * count them. Empty without windows.
 */
function coveredDates(input: EngineInput, weekStart: string): ReadonlySet<string> {
  if (input.disruptions === undefined || input.disruptions.length === 0) return NO_DATES
  const range = { from: weekStart, to: addDays(weekStart, 6) }
  return new Set(heldDates(disruptionPlan(input.disruptions), range))
}

/**
 * Planned running minutes of a week: its planned sessions, else its target; null when unknown. A
 * session on a day a rest window holds is not asked for [rule J9].
 */
function plannedWeekMin(input: EngineInput, weekStart: string): number | null {
  const weekEnd = addDays(weekStart, 6)
  const covered = coveredDates(input, weekStart)
  const sessions = (input.existing?.sessions ?? []).filter(
    (s) => s.date >= weekStart && s.date <= weekEnd && RUN_KINDS.has(s.kind),
  )
  if (sessions.length > 0) return minutes(sessions.filter((s) => !covered.has(s.date)))
  return input.existing?.weeks.find((w) => w.weekStart === weekStart)?.targetRunMin ?? null
}

/**
 * A week a rest window touches is a hold with a `disruption` signal [rules J9, J5, G-6]: the window
 * already took its days out of the week, and the return is sized from the days lost, so a rating
 * or a check-in in the week never cuts the volume a second time. The next week keeps the minutes
 * the plan holds for it. Null for a week no window touches.
 */
function disruptionDecision(
  input: EngineInput,
  weekStart: string,
  ramp: number,
): WeeklyDecision | null {
  if (input.disruptions === undefined || input.disruptions.length === 0) return null
  const plan = disruptionPlan(input.disruptions)
  if (dayRulesIn(plan, { from: weekStart, to: addDays(weekStart, 6) }).length === 0) return null
  const next = input.existing?.weeks.find((w) => w.weekStart === addDays(weekStart, 7))
  const actual = aggregateWeeks(input.activities, [weekStart])[0]!.runMin
  const plannedThis = plannedWeekMin(input, weekStart) ?? actual
  return {
    decision: 'hold',
    signals: [
      {
        code: 'disruption',
        detail:
          'A rest or limited-running window touches this week. The days it covers are not asked of you, the minutes of those days are not added back, and the way back is sized from the days lost.',
        rules: ['J9', 'J5', 'G-6'],
      },
    ],
    nextWeekTargetMin:
      next?.targetRunMin ?? Math.floor(nextWeekCap(plannedThis, actual, ramp) + 1e-9),
  }
}

/**
 * The worst pain reported in a week up to `asOf`, on a check-in or an activity. Focal bone pain
 * counts as the flag score [rules n-1, n-2].
 */
function worstPainIn(input: EngineInput, weekStart: string, asOf: string): number {
  const weekEnd = addDays(weekStart, 6)
  let worst = 0
  for (let k = 0; k < 7; k++) {
    const date = addDays(weekStart, k)
    if (date > asOf) break
    const checkin = checkinOn(input, date)
    if (checkin?.painScore != null) worst = Math.max(worst, checkin.painScore)
    if (checkin?.painFocalBone) worst = Math.max(worst, P.pain.flagScore.value)
  }
  for (const a of input.activities) {
    if (a.date >= weekStart && a.date <= weekEnd && a.pain !== null) worst = Math.max(worst, a.pain)
  }
  return worst
}

/** What a finished week shows to the start paths [rules E6, G-3]: completion, pain and effort. */
export interface WeekEvidence {
  plannedMin: number | null
  actualMin: number
  /** Minutes run over minutes planned; null when nothing was planned. */
  share: number | null
  worstPain: number
  /** Mean RPE of the week's runs that carry one; null without ratings. */
  meanRpe: number | null
  runs: number
}

/**
 * The running minutes of a week as the start paths count them. A ladder or injury-return week
 * credits an activity linked to a planned session with at most that session's minutes, so a
 * recording that carries the 5-minute walks around a ladder session does not stand for more than
 * the session was planned at; a run that is not linked counts whole. Any other week is the plain
 * weekly total.
 */
function creditedMin(input: EngineInput, weekStart: string): number {
  const weekEnd = addDays(weekStart, 6)
  const week = input.existing?.weeks.find((w) => w.weekStart === weekStart)
  if (week === undefined || !isProgrammeWeek(week.flags)) {
    return aggregateWeeks(input.activities, [weekStart])[0]!.runMin
  }
  const plannedFor = new Map<string, number>()
  for (const s of input.existing?.sessions ?? []) {
    if (
      s.activityId !== null &&
      s.date >= weekStart &&
      s.date <= weekEnd &&
      RUN_KINDS.has(s.kind)
    ) {
      plannedFor.set(s.activityId, s.durationMin)
    }
  }
  let seconds = 0
  for (const a of input.activities) {
    if (a.type !== 'run' || isDuplicate(a) || a.date < weekStart || a.date > weekEnd) continue
    const planned = plannedFor.get(a.id)
    seconds += planned === undefined ? a.durationSec : Math.min(a.durationSec, planned * 60)
  }
  return Math.round(seconds / 60)
}

/**
 * How many runs of the week reached `minutes`, within a minute for rounding: an injury-return
 * level advances only when both of its runs were run at the level's own length [rules G-3].
 */
export function runsReaching(input: EngineInput, weekStart: string, minutes: number): number {
  const weekEnd = addDays(weekStart, 6)
  return input.activities.filter(
    (a) =>
      (a.type === 'run' || a.type === 'race') &&
      !isDuplicate(a) &&
      a.date >= weekStart &&
      a.date <= weekEnd &&
      a.durationSec / 60 >= minutes - 1,
  ).length
}

export function weekEvidence(input: EngineInput, weekStart: string): WeekEvidence {
  const weekEnd = addDays(weekStart, 6)
  const actualMin = creditedMin(input, weekStart)
  const plannedMin = plannedWeekMin(input, weekStart)
  const runs = input.activities.filter(
    (a) =>
      (a.type === 'run' || a.type === 'race') &&
      !isDuplicate(a) &&
      a.date >= weekStart &&
      a.date <= weekEnd,
  )
  const rated = runs.filter((a) => a.rpe !== null)
  return {
    plannedMin,
    actualMin,
    share: plannedMin !== null && plannedMin > 0 ? actualMin / plannedMin : null,
    worstPain: worstPainIn(input, weekStart, weekEnd),
    meanRpe: rated.length === 0 ? null : rated.reduce((sum, a) => sum + a.rpe!, 0) / rated.length,
    runs: runs.length,
  }
}

/** Progress, hold or reduce from execution, check-ins, efficiency, sleep and HRV [rules J5, G-6]. */
export function weeklyDecision(
  input: EngineInput,
  weekStart: string,
  ctx: WeeklyContext = {},
): WeeklyDecision {
  const weekEnd = addDays(weekStart, 6)
  const ramp = ctx.ramp ?? P.g2.rampSoft.value
  const rebuild = ctx.rebuild ?? null
  const finished = input.today > weekEnd
  const asOf = finished ? weekEnd : input.today
  const inWindow = postRaceDecision(input, weekStart, asOf, ramp)
  if (inWindow !== null) return inWindow
  const inDisruption = disruptionDecision(input, weekStart, ramp)
  if (inDisruption !== null) return inDisruption
  const actual = aggregateWeeks(input.activities, [weekStart])[0]!.runMin

  // Completion: a week still in progress is judged on the sessions already due, never on the rest.
  const draft = input.existing?.weeks.find((w) => w.weekStart === weekStart)
  const covered = coveredDates(input, weekStart)
  const weekSessions = (input.existing?.sessions ?? []).filter(
    (s) =>
      s.date >= weekStart && s.date <= weekEnd && RUN_KINDS.has(s.kind) && !covered.has(s.date),
  )
  const plannedFull = plannedWeekMin(input, weekStart)
  const plannedDue =
    weekSessions.length > 0
      ? minutes(weekSessions.filter((s) => s.date < input.today))
      : finished
        ? (draft?.targetRunMin ?? null)
        : null

  const holds: Signal[] = []
  const independent: Signal[] = []
  const direct: Signal[] = []

  if (plannedDue !== null && plannedDue > 0) {
    const share = actual / plannedDue
    if (share < P.j5.completionHoldShare.value) {
      holds.push({
        code: 'completion-low',
        detail: `${actual} of ${plannedDue} planned minutes were run (${Math.round(share * 100)}%). Volume holds and the remaining minutes are not added later.`,
        rules: ['J5', 'G-6'],
      })
    }
  }

  const sleepH = sleepAverageH(input, asOf)
  if (sleepH !== null && sleepH < P.j5.sleepWarnHours.value) {
    holds.push({
      code: 'sleep-warning',
      detail: `Sleep averaged ${sleepH.toFixed(1)} h over the last ${P.j5.sleepWarnNights.value} nights, under ${P.j5.sleepWarnHours.value} h.`,
      rules: ['J5'],
    })
  }
  if ((ctx.redsFlags ?? 0) >= P.j5.redsHoldFlags.value) {
    holds.push({
      code: 'reds',
      detail: `${ctx.redsFlags} signs from the energy-availability screen. Progression holds; a clinician can help.`,
      rules: ['J5', 'n-4'],
    })
  }
  if (ctx.heatFirstDays) {
    holds.push({
      code: 'heat',
      detail: 'The first hot days of the season: volume holds while adapting to heat.',
      rules: ['J5', 'I9'],
    })
  }

  // Subjective decline: poor check-in days, harder-than-expected effort, or the weekly review.
  let poorDays = 0
  let hrvDays = 0
  let illnessDay: string | null = null
  for (let k = 0; k < 7; k++) {
    const date = addDays(weekStart, k)
    if (date > asOf) break
    const checkin = checkinOn(input, date)
    if (poorSubjective(checkin)) poorDays += 1
    if (checkin?.illness && illnessDay === null) illnessDay = date
    if (hrvFlaggedOn(input, date)) hrvDays += 1
  }
  const worstPain = worstPainIn(input, weekStart, asOf)
  const weekObs = observations(input, ctx.executions).filter(
    (o) => o.date >= weekStart && o.date <= weekEnd,
  )
  // Only verdicts that rest on the runner's own rating count: a guess from heart rate or pace
  // alone never moves the plan [design 7].
  const harder = weekObs.filter(
    (o) => o.subjective && (o.score ?? 0) >= P.j5.harderEffortScore.value,
  ).length
  const weekReview = input.reviews.find((r) => r.weekStart === weekStart)
  const reviewFatigue =
    weekReview !== undefined &&
    ((weekReview.fatigue !== null && weekReview.fatigue >= P.j5.reviewFatigueDecline.value) ||
      weekReview.symptoms === 'persistent')

  const why: string[] = []
  if (poorDays >= P.j5.subjectivePoorDays.value)
    why.push(`${poorDays} days with a lower check-in score`)
  if (harder >= P.j5.harderEffortSessions.value)
    why.push(`${harder} sessions felt harder than expected`)
  if (reviewFatigue) why.push('fatigue or symptoms in the weekly review')
  if (why.length > 0) {
    independent.push({
      code: 'subjective-decline',
      detail: `${why.join('; ')}.`,
      rules: ['J2', 'J5'],
    })
  }

  const efficiency = ctx.efficiency ?? efficiencyIndex(input.activities)
  if (efficiency.trendPct !== null && efficiency.trendPct <= -P.j5.efficiencyDeclinePct.value) {
    independent.push({
      code: 'efficiency-decline',
      detail: `Pace at a given heart rate has slipped ${Math.abs(efficiency.trendPct).toFixed(1)}%.`,
      rules: ['A8', 'J5'],
    })
  }
  if (
    ctx.sleepEfficiencyDropPp != null &&
    ctx.sleepEfficiencyDropPp >= P.j5.sleepEfficiencyDropPp.value
  ) {
    independent.push({
      code: 'sleep-efficiency-drop',
      detail: `Sleep efficiency dropped about ${ctx.sleepEfficiencyDropPp.toFixed(1)} percentage points.`,
      rules: ['J5'],
    })
  }

  if (illnessDay !== null) {
    direct.push({
      code: 'illness',
      detail: `Illness was reported on ${illnessDay}. A lighter week follows.`,
      rules: ['n-3', 'J5'],
    })
  }
  if (worstPain >= P.pain.flagScore.value) {
    direct.push({
      code: 'pain',
      detail: `Pain of ${worstPain} out of 10 was reported. A lighter week follows; see a clinician if it persists.`,
      rules: ['n-2', 'J5'],
    })
  }
  if (worstPain > 0 && worstPain < P.pain.flagScore.value) {
    holds.push({
      code: 'pain-mild',
      detail: `Pain of ${worstPain} out of 10 was reported. Volume holds until it settles.`,
      rules: ['J5'],
    })
  }

  // HRV and resting HR only corroborate [J2, J4]: a readiness state counts toward the weekly
  // decision only when the check-ins also show a poor subjective score.
  const snapshot = readinessSnapshot(input, asOf)
  const recentPoor = Array.from({ length: P.j3.persistenceDays.value }, (_, k) =>
    poorSubjective(checkinOn(input, addDays(asOf, -k))),
  ).some(Boolean)
  if (snapshot.state === 'persistent-suppression' && poorDays > 0) {
    direct.push({
      code: 'persistent-suppression',
      detail: `Readiness has stayed lower than usual for ${P.j8.deloadSuggestDays.value} days or more with no clear cause. A lighter week is suggested.`,
      rules: ['J8'],
    })
  } else if (snapshot.state !== 'normal' && recentPoor) {
    holds.push({
      code: 'readiness-flag',
      detail: 'A readiness flag is still active at the end of the week. Volume holds.',
      rules: ['J3', 'J5'],
    })
  }

  // HRV only corroborates a subjective decline; alone it never changes the decision [J4].
  const corroboration: Signal[] =
    independent.some((s) => s.code === 'subjective-decline') && hrvDays >= 2
      ? [
          {
            code: 'hrv-suppressed',
            detail: `HRV was lower than usual on ${hrvDays} days; it supports the check-in picture but does not decide.`,
            rules: ['J4'],
          },
        ]
      : []

  const reduce = direct.length > 0 || independent.length >= P.j5.reduceSignals.value
  const hold = holds.length > 0 || independent.length > 0
  const decision: WeeklyDecision['decision'] = reduce ? 'reduce' : hold ? 'hold' : 'progress'

  // G-6: the target never exceeds last week's actual x (1 + ramp); missed minutes are not repeated.
  const plannedThis = plannedFull ?? actual
  const nextWeek = input.existing?.weeks.find((w) => w.weekStart === addDays(weekStart, 7))
  const nextPlanned =
    nextWeek === undefined ? Math.round(plannedThis * (1 + ramp)) : plannedMinOf(nextWeek)
  let nextWeekTargetMin: number
  if (decision === 'progress') {
    // A ladder or injury-return week is a step of a fixed programme, exempt from the soft ramp:
    // the suggestion is the minutes the step is planned at, inside the 2-week ceiling [rules E6, G-3]
    nextWeekTargetMin =
      nextWeek !== undefined && isProgrammeWeek(nextWeek.flags)
        ? wholeMinutes(nextWeekCap(nextPlanned, actual, P.g2.rampCeilingTwoWeeks.value))
        : wholeMinutes(nextWeekCap(nextPlanned, actual, ramp, rebuild))
  } else if (decision === 'hold')
    nextWeekTargetMin = wholeMinutes(nextWeekCap(plannedThis, actual, ramp, rebuild))
  else {
    nextWeekTargetMin = Math.round(
      nextWeekCap(plannedThis, actual, ramp, rebuild) * (1 - P.e3.recoveryWeekCutPct.value / 100),
    )
  }
  return {
    decision,
    signals: [...holds, ...independent, ...direct, ...corroboration],
    nextWeekTargetMin,
  }
}

/**
 * Proposed zone updates after three concordant observations [rules C8, design 4.3]. Pass the
 * execution assessments when available; without them, effort comes from RPE and the feel
 * rating. Only sessions the runner rated count (heart rate or pace alone is a guess), and, per
 * boundary, only sessions after the last accepted change of it (`input.zoneChanges`), so one run of
 * observations never moves a boundary twice. A proposal never applies itself: the owner confirms it
 * on the review page.
 */
export function zoneProposals(input: EngineInput, executions?: ExecutionRecord[]): ZoneProposal[] {
  const from = input.profile.thresholdPaceSecPerKm
  if (from === null) return []
  const windowStart = addDays(input.today, -P.zoneProposal.windowDays.value)
  const needed = P.c8.minObservations.value
  const changedOn = input.zoneChanges?.thresholdPace ?? null
  const recent = observations(input, executions)
    .filter(
      (o) =>
        (o.kind === 'threshold' || o.kind === 'intervals') &&
        o.date >= windowStart &&
        o.date <= input.today &&
        (changedOn === null || o.date > changedOn) &&
        !o.excluded &&
        o.subjective &&
        o.score !== null,
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-needed)
  if (recent.length < needed) return []
  const directions = recent.map((o) => Math.sign(o.score!))
  const first = directions[0]!
  if (first === 0 || directions.some((d) => d !== first)) return []

  const stepPct = P.zoneProposal.paceStepPct.value
  const to = Math.round(from * (1 + (first < 0 ? -stepPct : stepPct) / 100))
  const felt = first < 0 ? 'easier' : 'harder'
  return [
    {
      boundary: 'thresholdPace',
      from,
      to,
      observations: recent.length,
      reason: `The last ${recent.length} threshold and interval sessions felt ${felt} than expected. Moving the threshold pace from ${formatPace(from)} to ${formatPace(to)} per km would match them; confirm or decline.`,
      rules: ['C8', TRIM_RULE],
    },
  ]
}

/** Restart volume after a break of 7 days or more [rules J7]; E6 sets the first week when it is small. */
export function breakRestart(
  layoffDays: number,
  preBreakWeekMin: number,
): { restartMin: number; fraction: number } {
  const fraction = restartFraction(layoffDays)
  return { restartMin: Math.round(preBreakWeekMin * fraction), fraction }
}

/**
 * A break of 7 days or more restarts below the volume before it [rules J7]: the typical week the
 * macrocycle grows from is the restart volume, not the pre-break one, and the recent level of E6
 * does not lift the start above it.
 */
export function afterBreak(state: AthleteState): AthleteState {
  if (state.layoffDays < P.j7.tier1Days.value || state.typicalWeekMin <= 0) return state
  const restart = breakRestart(state.layoffDays, state.typicalWeekMin)
  return {
    ...state,
    typicalWeekMin: Math.min(state.typicalWeekMin, restart.restartMin),
    recentWeekMin: Math.min(state.recentWeekMin, restart.restartMin),
  }
}

/**
 * True when the next quality session is trimmed: the latest quality session scored +2, or the
 * latest consecutive ones scored +1 each [design 4.3]. `scores` runs oldest first and holds only
 * sessions without pain; `trimsThisWeek` enforces the weekly maximum.
 */
export function shouldTrimQuality(scores: number[], trimsThisWeek = 0): boolean {
  if (trimsThisWeek >= P.trim.maxPerWeek.value) return false
  const last = scores[scores.length - 1]
  if (last === undefined) return false
  if (last >= P.trim.triggerScore.value) return true
  const n = P.trim.repeatedCount.value
  return scores.length >= n && scores.slice(-n).every((s) => s >= P.trim.repeatedScore.value)
}

/** Fewer reps or a shorter session after a harder-than-expected quality session [design 4.3]. */
export function trimQuality(session: SessionSpec, reason: string): SessionSpec {
  if (!isQualityKind(session.kind)) return session
  const f = P.trim.volumeFactor.value
  let removedSec = 0
  const structure = session.structure.map((step) => {
    if (step.kind !== 'work' && step.kind !== 'recover') return { ...step }
    if (step.reps > 1) {
      const reps = Math.max(1, Math.floor(step.reps * f))
      const lost = step.reps - reps
      if (step.durationSec !== null) removedSec += lost * step.durationSec
      else if (step.distanceM !== null && session.distanceM) {
        removedSec += (lost * step.distanceM * session.durationMin * 60) / session.distanceM
      }
      return { ...step, reps }
    }
    if (step.kind === 'recover') return { ...step }
    const durationSec = step.durationSec === null ? null : Math.round(step.durationSec * f)
    const distanceM = step.distanceM === null ? null : Math.round(step.distanceM * f)
    if (step.durationSec !== null && durationSec !== null)
      removedSec += step.durationSec - durationSec
    return { ...step, durationSec, distanceM }
  })
  const changed = structure.some(
    (s, i) =>
      s.reps !== session.structure[i]!.reps || s.durationSec !== session.structure[i]!.durationSec,
  )
  const durationMin = changed
    ? Math.max(1, Math.round(session.durationMin - removedSec / 60))
    : Math.max(1, Math.round(session.durationMin * f))
  const ratio = durationMin / session.durationMin
  return {
    ...session,
    structure,
    durationMin,
    distanceM: session.distanceM === null ? null : Math.round(session.distanceM * ratio),
    gainM: session.gainM === null ? null : Math.round(session.gainM * ratio),
    purpose: `${session.purpose} Trimmed: ${reason}`,
    rules: isTrimmed(session.rules) ? session.rules : [...session.rules, TRIM_RULE],
  }
}

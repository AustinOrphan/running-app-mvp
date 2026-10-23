// What stood out on a run (phase 3a design 8.3 to 8.6): up to three neutral facts about one run,
// each a number of the runner's own set against the runner's own history or plan. Pure and
// deterministic: the same input gives the same facts, nothing is mutated, and nothing reads a
// clock, the network or the database. The server hands over the run, the history the snapshot
// holds, the heart-rate model and the stored assessment of the session the run fulfils.
//
// A fact is data (a template id, its slots, dated sources); `shared/copy/standoutRender.ts` turns
// it into a sentence in the runner's units when it is read, so a stored insight never holds prose.
// No model chooses or words a finding (ADR 0005, ADR 0010).
//
// The eleven findings, in the order a run shows them (`STANDOUT_KINDS`):
//   1 pain            reported pain at or above the warning score, or focal bone pain
//   2 effort-harder   the runner's own rating puts the run above what the plan expects
//   3 effort-easier   the same, below. Never from heart rate or pace alone [rules J2]
//   4 hr-higher       average heart rate above the runner's own model at this pace
//   5 hr-lower        the same, below. Stated only above wrist-sensor error
//   6 drift-more      a long, cool run drifted more than similar long runs [rules A7]
//   7 drift-less      the same, less
//   8 grade           a steep average climb, which slows pace at the same effort
//   9 efficiency      distance per heartbeat against recent steady runs [rules A8]
//  10 longest         the longest run of the look-back
//  11 completion      much less or much more time than the session planned
import { STANDOUT_MAX_CARDS } from '../copy/limits.ts'
import { STANDOUT_KINDS, type StandoutKind } from '../copy/standoutTemplates.ts'
import { STANDOUT_RULE, standoutKindOf, type StandoutView } from '../copy/standoutRender.ts'
import { addDays, daysBetween } from '../dates.ts'
import type { Activity, Checkin } from '../types.ts'
import { comparableLongRuns, efficiencySamples, isDurabilityCandidate } from './athlete.ts'
import { median } from './backtest.ts'
import { hasSubjectivePart, hrAgainstModel, type HrModel } from './execution.ts'
import {
  activitySource,
  bpm,
  climb,
  count,
  distance,
  duration,
  exact,
  make,
  minutes,
  percent,
} from './explainInputs.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'
import type { ExecutionAssessment, InputFact, SessionKind, SourceRef } from './types.ts'

/**
 * The version of the findings: the selections, their thresholds' wiring and their templates. A
 * stored insight of another version is computed again on the next read. Raise it with any change
 * to which findings a run gets.
 */
export const STANDOUT_VERSION = 1

/** The planned session a run fulfils, with the assessment stored for it. */
export interface StandoutSession {
  id: string
  date: string
  kind: SessionKind
  durationMin: number
  assessment: ExecutionAssessment
}

export interface StandoutInput {
  /** The run described. */
  activity: Activity
  /** The runner's other activities in any order; the run itself is ignored when present. */
  history: readonly Activity[]
  /** The local day the figures are read on. */
  asOf: string
  /**
   * The first day of the loaded history. A comparison whose look-back reaches before it is left
   * out, so a run near the edge is never called the longest of weeks it cannot see.
   */
  historyFrom: string
  /** From `fitHrModel`; null gives no heart-rate finding. */
  hrModel: HrModel | null
  /** The session the run fulfils and its stored assessment; null for a run that fulfils none. */
  session: StandoutSession | null
  /** The check-in pain fields of the run's day. */
  checkin: Pick<Checkin, 'painScore' | 'painFocalBone'> | null
}

const round1 = (x: number): number => Math.round(x * 10) / 10

const RULE_EXECUTION = 'design-4.2'
const RULE_THRESHOLDS = STANDOUT_RULE

function checkinSource(date: string): SourceRef {
  return { kind: 'check-in', id: date, date, label: 'Check-in' }
}

function sessionSource(session: StandoutSession): SourceRef {
  return { kind: 'session', id: session.id, date: session.date, label: 'Session' }
}

/** What every finding reads: the run, and the other counted runs on or before its day. */
interface Prepared {
  input: StandoutInput
  activity: Activity
  /** Counted activities other than the run, dated on or before it. */
  before: Activity[]
}

// ---------------------------------------------------------------------------------------------
// The findings
// ---------------------------------------------------------------------------------------------

/** 1: pain at or above the warning score, or focal bone pain, from the run's rating or the check-in. */
function painFact({ input, activity }: Prepared): InputFact | null {
  const { checkin } = input
  const pain = Math.max(activity.pain ?? 0, checkin?.painScore ?? 0)
  const bone = checkin?.painFocalBone === true
  if (!bone && pain < P.pain.flagScore.value) return null
  const sources = [
    activitySource(activity),
    ...(checkin !== null && (bone || (checkin.painScore ?? 0) > 0)
      ? [checkinSource(activity.date)]
      : []),
  ]
  return bone
    ? make(RULE_EXECUTION, 'pain', 'standout.pain-bone', {}, { sources })
    : make(RULE_EXECUTION, 'pain', 'standout.pain', { pain: count(pain) }, { sources })
}

/**
 * 2 and 3: the verdict on effort, only with the runner's own rating behind it. The assessment must
 * lean on a rating, and the rating itself must lie beyond the range the plan expects for the kind
 * of session (the RPE) or on the same side (the feel), so a verdict that heart rate or pace
 * inferred is never printed as the runner's own.
 */
function effortFact({ input, activity }: Prepared): InputFact | null {
  const { session } = input
  if (session === null) return null
  const { score, parts } = session.assessment.effort
  if (score === null || score === 0 || !hasSubjectivePart(parts)) return null
  const [low, high] = P.expectedRpe[session.kind].value
  const harder = score > 0
  const sources = [activitySource(activity), sessionSource(session)]
  const rpe = activity.rpe
  const name = harder ? 'effort-harder' : 'effort-easier'
  if (rpe !== null && (harder ? rpe > high : rpe < low)) {
    return make(
      RULE_EXECUTION,
      name,
      harder ? 'standout.effort-harder-rpe' : 'standout.effort-easier-rpe',
      { rpe: count(rpe), low: count(low), high: count(high) },
      { sources },
    )
  }
  if (activity.feel !== null && (harder ? activity.feel > 0 : activity.feel < 0)) {
    return make(
      RULE_EXECUTION,
      name,
      harder ? 'standout.effort-harder-feel' : 'standout.effort-easier-feel',
      {},
      { sources },
    )
  }
  return null
}

/**
 * 4 and 5: average heart rate against the runner's own model at this pace and weather. Stated only
 * when the gap is more than `standout.hrDeltaMinBpm` (wrist sensors err by more than a few beats)
 * and more than the scatter of the runner's own runs around the model, while the run lies inside
 * the window the model was fitted on, and not when the assessment found the run's heart rate
 * unusable for its kind of session.
 */
function heartRateFact({ input, activity }: Prepared): InputFact | null {
  const { hrModel, session, asOf } = input
  if (hrModel === null || session?.assessment.flags.includes('hr-unqualified') === true) {
    return null
  }
  const weeks = P.hrModel.windowWeeks.value
  const age = daysBetween(activity.date, asOf)
  if (age < 0 || age >= weeks * 7) return null
  const against = hrAgainstModel(hrModel, activity)
  if (against === null) return null
  const gap = against.actualBpm - against.expectedBpm
  const size = Math.abs(gap)
  if (size <= P.standout.hrDeltaMinBpm.value || size < hrModel.residualSdBpm) return null
  const higher = gap > 0
  const hot = against.heatExcessC > 0
  const template = higher
    ? hot
      ? 'standout.hr-higher-heat'
      : 'standout.hr-higher'
    : hot
      ? 'standout.hr-lower-heat'
      : 'standout.hr-lower'
  return make(
    'A8',
    higher ? 'hr-higher' : 'hr-lower',
    template,
    { bpm: bpm(size) },
    {
      sources: [activitySource(activity)],
      window: { from: addDays(asOf, -(weeks * 7 - 1)), to: asOf },
    },
  )
}

/**
 * 6 and 7: drift on a long, cool run (from `a7.thresholdDropAfterMin`, below `a7.heatExcludeC`)
 * against the median of the runner's comparable long runs, when it differs by at least
 * `standout.driftDeltaPp` percentage points. The comparison needs `a7.minComparableRuns` other
 * comparable runs.
 */
function driftFact({ activity, before }: Prepared): InputFact | null {
  if (!isDurabilityCandidate(activity) || activity.decouplingPct === null) return null
  const comparable = before.filter(
    (other) => isDurabilityCandidate(other) && comparableLongRuns(activity, other),
  )
  if (comparable.length < P.a7.minComparableRuns.value) return null
  const typical = median(comparable.map((other) => other.decouplingPct as number))
  if (typical === null) return null
  const gap = activity.decouplingPct - typical
  if (Math.abs(gap) < P.standout.driftDeltaPp.value) return null
  return make(
    'A7',
    gap > 0 ? 'drift-more' : 'drift-less',
    gap > 0 ? 'standout.drift-more' : 'standout.drift-less',
    { delta: exact(round1(Math.abs(gap))), n: count(comparable.length) },
    { sources: [activitySource(activity), ...comparable.map(activitySource)] },
  )
}

/** 8: an average climbing grade of at least `standout.gradeNoteMinPct`. */
function gradeFact({ activity }: Prepared): InputFact | null {
  const { elevationGainM: gain, distanceM: length } = activity
  if (gain === null || length === null || length <= 0) return null
  const grade = (gain / length) * 100
  if (grade < P.standout.gradeNoteMinPct.value) return null
  return make(
    RULE_THRESHOLDS,
    'grade',
    'standout.grade',
    { gain: climb(gain), distance: distance(length), grade: percent(round1(grade)) },
    { sources: [activitySource(activity)] },
  )
}

/**
 * 9: distance per heartbeat on a steady flat run (one the efficiency index reads) against the
 * recent steady runs before it. Distance per heartbeat rises with speed even at constant fitness,
 * so the run is set against the `a8.minRunsPerWindow` recent runs closest to it in speed, not
 * against all of them. A gap counts when it exceeds, as a share of the run's heart rate, the
 * `standout.hrDeltaMinBpm` that a heart-rate gap needs: at one pace, heart rates that many beats
 * apart are that many percent apart in distance per beat.
 */
function efficiencyFact({ input, activity, before }: Prepared): InputFact | null {
  const recentWeeks = P.a8.recentWeeks.value
  if (addDays(activity.date, -(recentWeeks * 7)) < input.historyFrom) return null
  if (activity.avgHr === null || activity.avgHr <= 0) return null
  const { recent } = efficiencySamples([...before, activity], activity.date)
  const own = recent.find((sample) => sample.activity.id === activity.id)
  const others = recent.filter((sample) => sample.activity.id !== activity.id)
  if (own === undefined || others.length < P.a8.minRunsPerWindow.value) return null
  // A sample's value is metres per beat, which is speed (m/min) over heart rate.
  const speedOf = (sample: { value: number; activity: Activity }) =>
    (sample.value * (sample.activity.avgHr ?? 0)) / 60
  const mine = speedOf(own)
  const nearest = [...others]
    .sort(
      (a, b) =>
        Math.abs(speedOf(a) - mine) - Math.abs(speedOf(b) - mine) ||
        b.activity.date.localeCompare(a.activity.date) ||
        a.activity.id.localeCompare(b.activity.id),
    )
    .slice(0, P.a8.minRunsPerWindow.value)
  const baseline = median(nearest.map((sample) => sample.value))
  if (baseline === null || baseline <= 0) return null
  const gap = (own.value / baseline - 1) * 100
  const needed = (P.standout.hrDeltaMinBpm.value / activity.avgHr) * 100
  if (Math.abs(gap) < needed) return null
  return make(
    'A8',
    'efficiency',
    gap > 0 ? 'standout.efficiency-up' : 'standout.efficiency-down',
    { pct: percent(round1(Math.abs(gap))) },
    {
      sources: [
        activitySource(activity),
        ...nearest.map((sample) => activitySource(sample.activity)),
      ],
    },
  )
}

/**
 * 10: the longest run of the last `standout.longestLookbackWeeks` weeks, by distance, else by time.
 * It beats every other run of the look-back, there is at least one to beat, and the whole
 * look-back lies inside the loaded history.
 */
function longestFact({ input, activity, before }: Prepared): InputFact | null {
  const weeks = P.standout.longestLookbackWeeks.value
  const from = addDays(activity.date, -(weeks * 7))
  if (from < input.historyFrom) return null
  const runs = before.filter(
    (other) => (other.type === 'run' || other.type === 'race') && other.date >= from,
  )
  if (runs.length === 0) return null
  const sources = (rival: Activity) => [activitySource(activity), activitySource(rival)]
  if (activity.distanceM !== null && activity.distanceM > 0) {
    const farthest = runs
      .filter((other) => other.distanceM !== null)
      .reduce<Activity | null>(
        (best, other) => (best === null || other.distanceM! > best.distanceM! ? other : best),
        null,
      )
    if (farthest !== null && activity.distanceM > farthest.distanceM!) {
      return make(
        RULE_THRESHOLDS,
        'longest',
        'standout.longest-distance',
        { distance: distance(activity.distanceM), weeks: count(weeks) },
        { sources: sources(farthest), window: { from, to: activity.date } },
      )
    }
  }
  const longest = runs.reduce((best, other) =>
    other.durationSec > best.durationSec ? other : best,
  )
  if (activity.durationSec > longest.durationSec) {
    return make(
      RULE_THRESHOLDS,
      'longest',
      'standout.longest-duration',
      { duration: duration(activity.durationSec), weeks: count(weeks) },
      { sources: sources(longest), window: { from, to: activity.date } },
    )
  }
  return null
}

/** 11: much less (`partial`) or much more (`extended`) time than the session planned. */
function completionFact({ input, activity }: Prepared): InputFact | null {
  const { session } = input
  if (session === null) return null
  const { completion } = session.assessment
  if (completion !== 'partial' && completion !== 'extended') return null
  return make(
    RULE_EXECUTION,
    'completion',
    completion === 'partial' ? 'standout.ran-less' : 'standout.ran-more',
    { actual: minutes(activity.durationSec / 60), planned: minutes(session.durationMin) },
    { sources: [activitySource(activity), sessionSource(session)] },
  )
}

// ---------------------------------------------------------------------------------------------
// Selection and ranking
// ---------------------------------------------------------------------------------------------

/**
 * Every finding that applies to a run, in rank order. A strength or cross activity and a duplicate
 * have none. A heart-rate finding already says how the run's pace and heart rate compare with the
 * runner's usual, so the efficiency finding (the same comparison against recent runs) is left out
 * beside it.
 */
export function standoutFacts(input: StandoutInput): InputFact[] {
  const { activity } = input
  if ((activity.type !== 'run' && activity.type !== 'race') || isDuplicate(activity)) return []
  const before = input.history.filter(
    (other) => other.id !== activity.id && !isDuplicate(other) && other.date <= activity.date,
  )
  const prepared: Prepared = { input, activity, before }
  const heartRate = heartRateFact(prepared)
  const facts = [
    painFact(prepared),
    effortFact(prepared),
    heartRate,
    driftFact(prepared),
    gradeFact(prepared),
    heartRate === null ? efficiencyFact(prepared) : null,
    longestFact(prepared),
    completionFact(prepared),
  ]
  return orderStandouts(facts.filter((fact): fact is InputFact => fact !== null))
}

const RANK: ReadonlyMap<string, number> = new Map(STANDOUT_KINDS.map((kind, i) => [kind, i]))

function rankOf(fact: InputFact): number {
  const kind: StandoutKind | null = standoutKindOf(fact)
  return kind === null ? STANDOUT_KINDS.length : (RANK.get(kind) ?? STANDOUT_KINDS.length)
}

/** The facts in the order a run shows them: pain first, then the order of `STANDOUT_KINDS`. */
export function orderStandouts(facts: readonly InputFact[]): InputFact[] {
  return facts
    .map((fact, index) => ({ fact, index }))
    .sort((a, b) => rankOf(a.fact) - rankOf(b.fact) || a.index - b.index)
    .map(({ fact }) => fact)
}

/** The first `STANDOUT_MAX_CARDS` facts and how many more were left out. */
export function rankStandouts(facts: readonly InputFact[]): StandoutView {
  const ordered = orderStandouts(facts)
  return {
    items: ordered.slice(0, STANDOUT_MAX_CARDS),
    more: Math.max(0, ordered.length - STANDOUT_MAX_CARDS),
  }
}

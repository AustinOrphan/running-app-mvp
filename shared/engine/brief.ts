// The Monday brief (phase 3a design 8.3 and 8.5): what the last week was, what the weekly update
// did and why, what the plan noticed, the next key session and the countdown, as data. Pure and
// deterministic: the same arguments give the same facts, nothing is mutated, and nothing reads a
// clock, the network or the database. The server hands over the athlete snapshot, the weekly
// decision, the revision the update wrote and the two weekly predictions it has already read.
//
// The facts hold template ids, codes and slot values and never a sentence (ADR 0010):
// `shared/copy/briefRender.ts` writes the words when the brief is read, in the runner's units. No
// language model chooses or words anything here (ADR 0005). A fact is made from the runner's own
// numbers and from thresholds the engine already has; the brief adds no Param.
//
// What the plan noticed, in the order a brief shows it when more than `BRIEF_MAX_NOTICED` apply:
// safety first (pain, illness, the energy-availability screen, readiness that stayed low), then
// what the weekly decision acted on (sleep, check-ins and ratings), then what the data shows
// (efficiency, the longest run), then where the plan stands in its calendar (race week, the
// taper, a recovery week).
import { BRIEF_MAX_NOTICED, KEY_LOOKAHEAD_DAYS } from '../copy/limits.ts'
import { addDays, daysBetween } from '../dates.ts'
import { isToRun } from '../domain/sessionStatus.ts'
import { aggregateWeeks } from '../domain/weeks.ts'
import type { Activity, CauseCode, PlanDiff, PlanSessionStatus, RevisionCauses } from '../types.ts'
import { roundEstimateSec } from '../units.ts'
import { weekEvidence } from './adapt.ts'
import { efficiencySamples } from './athlete.ts'
import {
  activitySource,
  checkinSource,
  count,
  day,
  distance,
  duration,
  make,
  minutes,
  percent,
} from './explainInputs.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'
import { checkinOn, checkinsOf, poorSubjective, sleepAverageH } from './readiness.ts'
import { entryCauses, presentDiff } from './revisionDiff.ts'
import { resolveTargets } from './targets.ts'
import type {
  AthleteState,
  BriefChangeLine,
  BriefChanges,
  BriefCountdown,
  BriefDecision,
  BriefFacts,
  BriefKeySession,
  BriefLastWeek,
  BriefPrediction,
  BriefReplanCode,
  EngineInput,
  InputFact,
  SessionKind,
  SourceRef,
  WeeklyDecision,
  ZoneSet,
} from './types.ts'

/**
 * The version of the facts: their shape, the selections of what the plan noticed and the templates
 * they name. A brief of another version is shown as it was stored. Raise it with any change to the
 * shape of `BriefFacts` or to which facts a week gets.
 */
export const BRIEF_VERSION = 1

type SessionRow = NonNullable<EngineInput['existing']>['sessions'][number]

/** The part of a revision the brief keeps: its diff and the cause of each line of it. */
export interface BriefRevision {
  diff: PlanDiff | null
  causes: RevisionCauses | null
}

/** A weekly prediction of the goal, one per local week. */
export interface BriefPredictionRow {
  /** Monday of the local week the prediction belongs to. */
  weekStart: string
  predictedSec: number
}

export interface BriefArgs {
  /** The Monday the brief opens. */
  weekStart: string
  /** The local day the figures are read on: the Monday itself, or a later day of that week. */
  asOf: string
  /** The athlete's data and the stored plan, as the engine reads them (`existing` loaded). */
  input: EngineInput
  state: AthleteState
  zones: ZoneSet
  /** The weekly decision about the week before `weekStart`, or null when no plan covered it. */
  decision: WeeklyDecision | null
  /** The weekly revision the brief describes, or null when the update wrote none. */
  revision: BriefRevision | null
  /** Why the update wrote none. */
  replan: BriefReplanCode | null
  /** The goal the plan works toward. */
  goal: { name: string; date: string } | null
  /** The goal's weekly predictions for `weekStart` and the week before it. */
  predictions: readonly BriefPredictionRow[]
  /** Whether heat steers this session by effort (`isHotForSteering` on the cached forecast). */
  isHot: (session: SessionRow) => boolean
}

// ---------------------------------------------------------------------------------------------
// The key session
// ---------------------------------------------------------------------------------------------

/**
 * Which kinds of session are key: the long runs, the hard workouts and the race. Exhaustive, so a
 * kind the engine adds is a compile error here until it is classified.
 */
const KEY_KINDS: Readonly<Record<SessionKind, boolean>> = {
  easy: false,
  recovery: false,
  long: true,
  'long-fast-finish': true,
  threshold: true,
  intervals: true,
  'race-pace': true,
  strides: false,
  hills: true,
  hike: false,
  b2b: true,
  strength: false,
  mobility: false,
  rest: false,
  race: true,
  cross: false,
}

export function isKeyKind(kind: SessionKind): boolean {
  return KEY_KINDS[kind]
}

/**
 * The next key session from `from`: the first session still to be run (`isToRun`, the predicate
 * every surface asks) of a key kind within `days` days, today included. Ties on a day go by the
 * plan's order. Null when the week is easy running.
 */
export function pickKeySession<S extends SessionRow>(
  sessions: readonly S[],
  from: string,
  days: number = KEY_LOOKAHEAD_DAYS,
): S | null {
  const to = addDays(from, days - 1)
  const key = sessions.filter(
    (s) =>
      s.date >= from && s.date <= to && isKeyKind(s.kind) && isToRun(s.status as PlanSessionStatus),
  )
  key.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id))
  return key[0] ?? null
}

/**
 * A session as the brief states it, with its targets from `resolveTargets`: the one resolver every
 * surface reads (design 4.6), so the brief shows what the hero and the watch show. The cross-surface
 * test registers this function as the brief's adapter. The prose notes of the resolver are left
 * out; they are worded when the brief is read.
 */
export function keySessionFacts(
  session: SessionRow,
  zones: ZoneSet | null,
  hot: boolean,
): BriefKeySession {
  const t = resolveTargets(session, zones, { hot })
  return {
    sessionId: session.id,
    externalId: session.externalId ?? null,
    date: session.date,
    kind: session.kind,
    durationMin: session.durationMin,
    distanceM: session.distanceM,
    gainM: session.gainM,
    target: {
      zone: t.zone,
      mode: t.mode,
      hrCeiling: t.hrCeiling,
      hrRange: t.hrRange === null ? null : [t.hrRange[0], t.hrRange[1]],
      paceSecPerKm: t.paceSecPerKm === null ? null : [t.paceSecPerKm[0], t.paceSecPerKm[1]],
      rpe: [t.rpe[0], t.rpe[1]],
      hot: t.hot,
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Last week, the decision, the changes, the countdown and the prediction
// ---------------------------------------------------------------------------------------------

function lastWeekOf(input: EngineInput, last: string): BriefLastWeek | null {
  const ranMin = Math.round(aggregateWeeks(input.activities, [last])[0]!.runMin)
  const plannedMin = weekEvidence(input, last).plannedMin
  if (ranMin === 0 && plannedMin === null) return null
  return {
    weekStart: last,
    ranMin,
    plannedMin: plannedMin === null ? null : Math.round(plannedMin),
  }
}

function decisionOf(decision: WeeklyDecision | null): BriefDecision | null {
  if (decision === null) return null
  return {
    kind: decision.postRace === undefined ? decision.decision : 'post-race',
    nextWeekTargetMin: Math.round(decision.nextWeekTargetMin),
  }
}

/**
 * The lines of the update as the page presents them (a moved session is one line), each with the
 * causes `attributeChange` found. A line the revision gave no cause is the plan reading new figures
 * (`state-update`), so no change is left unexplained.
 */
function changesOf(revision: BriefRevision | null): BriefChanges | null {
  if (revision === null) return null
  const { diff } = revision
  if (diff === null || diff.empty) {
    return { count: 0, lines: [], runMinBefore: 0, runMinAfter: 0 }
  }
  const lines = presentDiff(diff).map((entry): BriefChangeLine => {
    const found: CauseCode[] =
      entry.type === 'hold' ? ['disruption'] : entryCauses(entry, revision.causes)
    return {
      type: entry.type,
      date: entry.date,
      causes: found.length > 0 ? found : ['state-update'],
    }
  })
  return {
    count: lines.filter((line) => line.type !== 'week' && line.type !== 'hold').length,
    lines,
    runMinBefore: Math.round(diff.totals.runMinBefore),
    runMinAfter: Math.round(diff.totals.runMinAfter),
  }
}

function countdownOf(goal: BriefArgs['goal'], asOf: string): BriefCountdown | null {
  if (goal === null) return null
  const days = daysBetween(asOf, goal.date)
  return days < 0 ? null : { name: goal.name, date: goal.date, days }
}

/** The line waits for two weekly estimates exactly a week apart, this week's and last week's. */
function predictionOf(args: BriefArgs): BriefPrediction | null {
  const now = args.predictions.find((row) => row.weekStart === args.weekStart)
  const prior = args.predictions.find((row) => row.weekStart === addDays(args.weekStart, -7))
  if (now === undefined || prior === undefined) return null
  const nowSec = roundEstimateSec(now.predictedSec)
  const priorSec = roundEstimateSec(prior.predictedSec)
  return Number.isNaN(nowSec) || Number.isNaN(priorSec) ? null : { nowSec, priorSec }
}

// ---------------------------------------------------------------------------------------------
// What the plan noticed
// ---------------------------------------------------------------------------------------------

/** What every selection reads. */
interface Week {
  args: BriefArgs
  /** Monday and Sunday of the week that just ended. */
  last: string
  lastEnd: string
  window: { from: string; to: string }
}

type Selection = (week: Week) => InputFact | null

const round1 = (x: number): number => Math.round(x * 10) / 10

const hasSignal = (week: Week, code: string): boolean =>
  week.args.decision?.signals.some((signal) => signal.code === code) ?? false

interface PainHit {
  date: string
  pain: number
  source: SourceRef
}

/** Pain and focal bone pain reported last week, on a check-in or on a run [rules n-1, n-2]. */
function painFact({ args, last, lastEnd, window }: Week): InputFact | null {
  const { input } = args
  let bone: string | null = null
  const hits: PainHit[] = []
  for (let k = 0; k < 7; k++) {
    const date = addDays(last, k)
    const checkin = checkinOn(input, date)
    if (checkin?.painFocalBone === true && bone === null) bone = date
    if (checkin?.painScore != null && checkin.painScore > 0) {
      hits.push({ date, pain: checkin.painScore, source: checkinSource(date) })
    }
  }
  for (const activity of input.activities) {
    if (activity.date < last || activity.date > lastEnd || isDuplicate(activity)) continue
    if (activity.pain !== null && activity.pain > 0) {
      hits.push({ date: activity.date, pain: activity.pain, source: activitySource(activity) })
    }
  }
  if (bone !== null) {
    return make(
      'n-1',
      'pain-bone',
      'brief.noticed-pain-bone',
      { date: day(bone) },
      { sources: [checkinSource(bone)], window },
    )
  }
  if (hits.length === 0) return null
  const worst = Math.max(...hits.map((hit) => hit.pain))
  const worstHits = hits.filter((hit) => hit.pain === worst)
  const first = worstHits.reduce((a, b) => (b.date < a.date ? b : a))
  const slots = { pain: count(worst), date: day(first.date) }
  const extras = { sources: worstHits.map((hit) => hit.source), window }
  return worst >= P.pain.flagScore.value
    ? make('n-2', 'pain', 'brief.noticed-pain', slots, extras)
    : make('n-2', 'pain-mild', 'brief.noticed-pain-mild', slots, extras)
}

/** Illness reported on a check-in last week [rule n-3]. */
function illnessFact({ args, last, window }: Week): InputFact | null {
  for (let k = 0; k < 7; k++) {
    const date = addDays(last, k)
    if (checkinOn(args.input, date)?.illness === true) {
      return make(
        'n-3',
        'illness',
        'brief.noticed-illness',
        { date: day(date) },
        { sources: [checkinSource(date)], window },
      )
    }
  }
  return null
}

/** The energy-availability screen at or above the count that holds progression [rules n-4, J5]. */
function redsFact({ args, window }: Week): InputFact | null {
  const flags = args.input.screeningFlags ?? 0
  if (flags < P.j5.redsHoldFlags.value) return null
  return make('n-4', 'reds', 'brief.noticed-reds', { n: count(flags) }, { window })
}

/** Readiness that stayed low for the days the plan suggests a lighter week after [rule J8]. */
function readinessLowFact(week: Week): InputFact | null {
  if (!hasSignal(week, 'persistent-suppression')) return null
  return make(
    'J8',
    'readiness-low',
    'brief.noticed-readiness-low',
    { days: count(P.j8.deloadSuggestDays.value) },
    { window: week.window },
  )
}

/** A readiness flag still active at the end of the week, which the decision held volume for [J3]. */
function readinessFlagFact(week: Week): InputFact | null {
  if (!hasSignal(week, 'readiness-flag')) return null
  return make('J3', 'readiness-flag', 'brief.noticed-readiness-flag', {}, { window: week.window })
}

/** Short sleep, which the weekly decision held volume for [rule J5]. */
function sleepFact(week: Week): InputFact | null {
  if (!hasSignal(week, 'sleep-warning')) return null
  const hours = sleepAverageH(week.args.input, week.lastEnd)
  if (hours === null) return null
  return make(
    'J5',
    'sleep',
    'brief.noticed-sleep',
    {
      hours: duration(hours * 3600),
      nights: count(P.j5.sleepWarnNights.value),
      floor: duration(P.j5.sleepWarnHours.value * 3600),
    },
    { window: week.window },
  )
}

/** Check-ins on the low side or sessions that felt harder than planned [rules J2, J5]. */
function subjectiveFact(week: Week): InputFact | null {
  if (!hasSignal(week, 'subjective-decline')) return null
  const low = checkinsOf(week.args.input).filter(
    (checkin) =>
      checkin.date >= week.last && checkin.date <= week.lastEnd && poorSubjective(checkin),
  )
  return make(
    'J2',
    'subjective',
    'brief.noticed-subjective',
    {},
    { sources: low.map((checkin) => checkinSource(checkin.date)), window: week.window },
  )
}

/**
 * Efficiency on steady runs up or down by at least the size the weekly decision acts on when it
 * falls [rules A8, J5]; the same size marks a rise, so the brief adds no threshold of its own.
 */
function efficiencyFact({ args }: Week): InputFact | null {
  const trend = args.state.efficiency.trendPct
  if (trend === null) return null
  const size = P.j5.efficiencyDeclinePct.value
  if (Math.abs(trend) < size) return null
  const { recent } = efficiencySamples(args.input.activities, args.asOf)
  const days = (P.a8.recentWeeks.value + P.a8.priorWeeks.value) * 7
  const extras = {
    sources: recent.map((sample) => activitySource(sample.activity)),
    window: { from: addDays(args.asOf, -(days - 1)), to: args.asOf },
  }
  const slots = { pct: percent(round1(Math.abs(trend))) }
  return trend < 0
    ? make('A8', 'efficiency', 'brief.noticed-efficiency-down', slots, extras)
    : make('A8', 'efficiency', 'brief.noticed-efficiency-up', slots, extras)
}

const isRun = (activity: Activity): boolean => activity.type === 'run' || activity.type === 'race'

/**
 * The longest run of the look-back (`standout.longestLookbackWeeks`) was run last week, by distance,
 * else by time [rule A3]. Left out when the look-back reaches before the loaded history, so a run
 * near the edge is never called the longest of weeks it cannot see.
 */
function longestFact({ args, last, lastEnd }: Week): InputFact | null {
  const weeks = P.standout.longestLookbackWeeks.value
  const from = addDays(lastEnd, -(weeks * 7))
  if (from < addDays(args.asOf, -P.a5.historyWindowDays.value)) return null
  const runs = args.input.activities.filter(
    (activity) =>
      isRun(activity) &&
      !isDuplicate(activity) &&
      activity.date >= from &&
      activity.date <= lastEnd,
  )
  const thisWeek = runs.filter((activity) => activity.date >= last)
  const before = runs.filter((activity) => activity.date < last)
  if (thisWeek.length === 0 || before.length === 0) return null
  const window = { from, to: lastEnd }
  const pick = (list: Activity[], key: (a: Activity) => number): Activity =>
    list.reduce((best, a) =>
      key(a) > key(best) || (key(a) === key(best) && a.date < best.date) ? a : best,
    )

  const withDistance = (list: Activity[]) => list.filter((a) => (a.distanceM ?? 0) > 0)
  const farLast = withDistance(thisWeek)
  const farBefore = withDistance(before)
  if (farLast.length > 0 && farBefore.length > 0) {
    const run = pick(farLast, (a) => a.distanceM!)
    const rival = pick(farBefore, (a) => a.distanceM!)
    if (run.distanceM! > rival.distanceM!) {
      return make(
        'A3',
        'longest',
        'brief.noticed-longest-distance',
        { distance: distance(run.distanceM!), date: day(run.date), weeks: count(weeks) },
        { sources: [activitySource(run), activitySource(rival)], window },
      )
    }
  }
  const run = pick(thisWeek, (a) => a.durationSec)
  const rival = pick(before, (a) => a.durationSec)
  if (run.durationSec > rival.durationSec) {
    return make(
      'A3',
      'longest',
      'brief.noticed-longest-duration',
      { duration: duration(run.durationSec), date: day(run.date), weeks: count(weeks) },
      { sources: [activitySource(run), activitySource(rival)], window },
    )
  }
  return null
}

/** Where the plan stands in its calendar this week: race week, the first week of the taper, a recovery week. */
function calendarFact(rule: 'K6' | 'K1' | 'E3'): Selection {
  return ({ args }) => {
    const weeks = args.input.existing?.weeks ?? []
    const week = weeks.find((w) => w.weekStart === args.weekStart)
    if (week === undefined || week.flags.includes('post-race')) return null
    const window = { from: week.weekStart, to: addDays(week.weekStart, 6) }
    if (rule === 'K6') {
      if (!week.flags.includes('race-week') || args.goal === null) return null
      return make(
        'K6',
        'race-week',
        'brief.noticed-race-week',
        { date: day(args.goal.date) },
        { window },
      )
    }
    if (rule === 'K1') {
      const before = weeks.find((w) => w.weekStart === addDays(week.weekStart, -7))
      if (!week.isTaper || before?.isTaper === true) return null
      return make(
        'K1',
        'taper',
        'brief.noticed-taper',
        { minutes: minutes(week.targetRunMin) },
        { window },
      )
    }
    if (!week.isRecovery) return null
    return make(
      'E3',
      'recovery-week',
      'brief.noticed-recovery-week',
      { minutes: minutes(week.targetRunMin) },
      { window },
    )
  }
}

/** The selections in the order a brief shows them. */
const NOTICED: readonly Selection[] = [
  painFact,
  illnessFact,
  redsFact,
  readinessLowFact,
  readinessFlagFact,
  sleepFact,
  subjectiveFact,
  efficiencyFact,
  longestFact,
  calendarFact('K6'),
  calendarFact('K1'),
  calendarFact('E3'),
]

/** At most `BRIEF_MAX_NOTICED` facts, in order. */
function noticedFacts(args: BriefArgs): InputFact[] {
  const last = addDays(args.weekStart, -7)
  const week: Week = {
    args,
    last,
    lastEnd: addDays(args.weekStart, -1),
    window: { from: last, to: addDays(args.weekStart, -1) },
  }
  const facts: InputFact[] = []
  for (const select of NOTICED) {
    const fact = select(week)
    if (fact !== null) facts.push(fact)
    if (facts.length === BRIEF_MAX_NOTICED) break
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------------------------

/** The facts of the brief that opens the week of `args.weekStart`. */
export function buildBriefFacts(args: BriefArgs): BriefFacts {
  const last = addDays(args.weekStart, -7)
  const session = pickKeySession(args.input.existing?.sessions ?? [], args.asOf)
  return {
    weekStart: args.weekStart,
    asOf: args.asOf,
    lastWeek: lastWeekOf(args.input, last),
    // A decision is stated only for an update that ran: after a note that says why none did, it
    // would describe a change that was not made. The decision still feeds what the plan noticed.
    decision: args.replan === null ? decisionOf(args.decision) : null,
    replan: args.replan,
    changes: changesOf(args.revision),
    noticed: noticedFacts(args),
    keySession: session === null ? null : keySessionFacts(session, args.zones, args.isHot(session)),
    countdown: countdownOf(args.goal, args.asOf),
    prediction: predictionOf(args),
  }
}

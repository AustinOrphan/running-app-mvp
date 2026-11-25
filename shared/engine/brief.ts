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
// taper, a recovery week), then the plan's first back-to-back, night run or downhill session when
// the coming week holds it.
import { BRIEF_MAX_NOTICED, KEY_LOOKAHEAD_DAYS } from '../copy/limits.ts'
import { addDays, daysBetween } from '../dates.ts'
import { isToRun } from '../domain/sessionStatus.ts'
import { aggregateWeeks } from '../domain/weeks.ts'
import type { Activity, CauseCode, PlanDiff, PlanSessionStatus, RevisionCauses } from '../types.ts'
import { roundEstimateSec } from '../units.ts'
import { weekEvidence } from './adapt.ts'
import { estimateDistance, recentPaceSecPerKm } from './distanceEstimate.ts'
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
import { DOWNHILL_FLAGS, pausedOnRead } from './downhill.ts'
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
export const BRIEF_VERSION = 2

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
 * The key sessions from `from`: every session still to be run (`isToRun`, the predicate every
 * surface asks) of a key kind within `days` days, today included, in date order. Ties on a day go by
 * the plan's order. Empty when the week is easy running.
 */
export function pickKeySessions<S extends SessionRow>(
  sessions: readonly S[],
  from: string,
  days: number = KEY_LOOKAHEAD_DAYS,
): S[] {
  const to = addDays(from, days - 1)
  const key = sessions.filter(
    (s) =>
      s.date >= from && s.date <= to && isKeyKind(s.kind) && isToRun(s.status as PlanSessionStatus),
  )
  key.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id))
  return key
}

/** The next key session from `from`: the first of `pickKeySessions`, null when there is none. */
export function pickKeySession<S extends SessionRow>(
  sessions: readonly S[],
  from: string,
  days: number = KEY_LOOKAHEAD_DAYS,
): S | null {
  return pickKeySessions(sessions, from, days)[0] ?? null
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
  recentPace: number | null,
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
    distanceEstimate: estimateDistance(session, { zones, recentPaceSecPerKm: recentPace }),
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
  const planned = weekEvidence(input, last).plannedMin
  // A week planned at zero minutes (the rest after a race, every run day held by a window) was
  // not planned to run: "ran 25 of 0 planned minutes" is no sentence, so it reads as no plan.
  const plannedMin = planned === null || Math.round(planned) <= 0 ? null : Math.round(planned)
  if (ranMin === 0 && plannedMin === null) return null
  return { weekStart: last, ranMin, plannedMin }
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

type Selection = (week: Week) => InputFact | InputFact[] | null

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

/** The kinds of session whose first the brief names, in the order that breaks a tie of dates. */
const FIRST_KINDS = [
  { kind: 'b2b', rule: 'H3', has: (s: SessionRow) => s.flags.includes('b2b-day1') },
  { kind: 'night', rule: 'H6', has: (s: SessionRow) => s.flags.includes('night') },
  {
    kind: 'downhill',
    rule: 'H5',
    has: (s: SessionRow) => DOWNHILL_FLAGS.some((flag) => s.flags.includes(flag)),
  },
] as const

const FIRST_TEMPLATES = {
  b2b: 'brief.noticed-first-b2b',
  night: 'brief.noticed-first-night',
  downhill: 'brief.noticed-first-downhill',
} as const

/** A kind of session the plan holds for the first time in a week. */
export interface FirstSession {
  kind: 'b2b' | 'night' | 'downhill'
  rule: string
  date: string
}

/**
 * The firsts of the week `from` to `to`: for the first back-to-back (the day-1 session of a pair),
 * the first night-flagged session and the first downhill-flagged session, the date it falls on when
 * no stored session of that kind is dated before `from`. Every stored session counts, whatever its
 * status, so a first that is already past stays the first when the plan is drawn again. Ordered by
 * date, then back-to-back, night, downhill.
 */
export function firstSessionsIn(
  sessions: readonly SessionRow[],
  window: { from: string; to: string },
): FirstSession[] {
  const out: FirstSession[] = []
  for (const kind of FIRST_KINDS) {
    const dates = sessions.filter(kind.has).map((s) => s.date)
    if (dates.length === 0) continue
    const first = dates.reduce((a, b) => (b < a ? b : a))
    if (first >= window.from && first <= window.to) {
      out.push({ kind: kind.kind, rule: kind.rule, date: first })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * One fact for each first back-to-back, night run or downhill session the coming week holds, by date.
 *
 * The sessions are read as the pages show them (`pausedOnRead`, the same check-ins and as-of day):
 * a quad report hides the downhill flags of the days still ahead until the pause ends, and a
 * session the page shows without the flag is not named. The choice for a paused first: it is not
 * named this week, and the brief does not hold the name back for later. Once the pause ends or the
 * day has passed, the stored session counts as an earlier one, so no later brief names a first
 * downhill session; the plan the runner sees is the record.
 *
 * "First" is per plan: it resets when a plan is regenerated, because the stored sessions of the
 * old plan are gone.
 */
function firstSessionFacts({ args }: Week): InputFact[] {
  const sessions = pausedOnRead(args.input.existing?.sessions ?? [], args.input.wellness, args.asOf)
  const window = { from: args.weekStart, to: addDays(args.weekStart, 6) }
  return firstSessionsIn(sessions, window).map((first) =>
    make(
      first.rule,
      `first-${first.kind}`,
      FIRST_TEMPLATES[first.kind],
      { day: day(first.date) },
      { window },
    ),
  )
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
  firstSessionFacts,
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
    const made = select(week)
    if (made !== null) facts.push(...(Array.isArray(made) ? made : [made]))
    if (facts.length >= BRIEF_MAX_NOTICED) break
  }
  return facts.slice(0, BRIEF_MAX_NOTICED)
}

// ---------------------------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------------------------

/** The facts of the brief that opens the week of `args.weekStart`. */
export function buildBriefFacts(args: BriefArgs): BriefFacts {
  const last = addDays(args.weekStart, -7)
  const [session, ...later] = pickKeySessions(args.input.existing?.sessions ?? [], args.asOf)
  const recentPace = recentPaceSecPerKm({
    activities: args.input.activities,
    state: args.state,
    zones: args.zones,
  })
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
    keySession:
      session === undefined
        ? null
        : keySessionFacts(session, args.zones, args.isHot(session), recentPace),
    // What a later day of the week names once the first has passed: the date, kind and estimate.
    laterKeySessions: later.map((s) => ({
      date: s.date,
      kind: s.kind,
      distanceEstimate: estimateDistance(s, {
        zones: args.zones,
        recentPaceSecPerKm: recentPace,
      }),
    })),
    countdown: countdownOf(args.goal, args.asOf),
    prediction: predictionOf(args),
  }
}

// "From your numbers" (phase 3a design 8.4): the figures the engine read for a rule, as data. A
// builder turns the athlete snapshot into `InputFact`s (a template id, its slots, dated sources and
// a state: `used`, or `insufficient` with a sentence that says what the rule needs and what was
// found). Nothing here writes a sentence: `renderFact` does, in the runner's units, when the fact
// is read. Pure and deterministic: the same context gives the same facts, nothing is mutated, and
// nothing reads a clock, the network or the database. The server hands over the snapshot, the
// heart-rate model, the weekly decision and the prediction it has already computed.
import { EXPLAIN_CHECKIN_DAYS, EXPLAIN_MAX_SOURCES } from '../copy/limits.ts'
import type { SlotValues } from '../copy/template.ts'
import type { TEMPLATES, TemplateId } from '../copy/templates.ts'
import { addDays, isIsoDate, mondayOf } from '../dates.ts'
import { aggregateWeeks } from '../domain/weeks.ts'
import type { Activity, Goal } from '../types.ts'
import { breakRestart, weekEvidence } from './adapt.ts'
import { csEffortsOf, durabilityRuns, efficiencySamples } from './athlete.ts'
import type { HrModel } from './execution.ts'
import { nextWeekCap } from './guards.ts'
import {
  countsTowardReference,
  spikeOverrideLimit,
  spikeWarnLimit,
  VOLUME_KINDS,
  weeklyRamp,
  wholeMinutes,
} from './limits.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'
import { rangeLabel } from './predict.ts'
import { checkinsOf, poorSubjective, sleepAverageH } from './readiness.ts'
import { resolveTargets } from './targets.ts'
import type {
  AthleteState,
  Boundary,
  EngineInput,
  ExplainGroup,
  ExplainRequest,
  ExplainView,
  InputFact,
  Prediction,
  Quantity,
  ReadinessSnapshot,
  SourceRef,
  WeeklyDecision,
  ZoneSet,
} from './types.ts'

// ---------------------------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------------------------

type SessionRow = NonNullable<EngineInput['existing']>['sessions'][number]

/**
 * Everything the builders read. The server fills it from the athlete snapshot (`input` is the
 * snapshot as the engine reads it) and adds the values that need more than the snapshot: the
 * heart-rate model, the weekly decision for `explainWeeks(...).last` and the prediction for
 * `goal`. A field the request does not need may be null (`explainNeeds`).
 */
export interface ExplainContext {
  /** The local day the figures are read for. */
  asOf: string
  input: EngineInput
  state: AthleteState
  zones: ZoneSet
  readiness: ReadinessSnapshot
  /** The goal the prediction rules are about, or null without one. */
  goal: Pick<Goal, 'id' | 'distanceM' | 'gainM' | 'surface'> | null
  prediction: Prediction | null
  hrModel: HrModel | null
  /** The weekly decision about `explainWeeks(...).last`, or null when no plan covers that week. */
  decision: WeeklyDecision | null
}

/** What a builder reads besides the context. */
interface Scope {
  readonly ctx: ExplainContext
  /** The session being explained, for a session request. */
  readonly session: SessionRow | null
  /** The week the ramp starts from and the weekly decision is about (a Monday). */
  readonly last: string
  /** The week they lead to (a Monday). */
  readonly next: string
}

type Builder = (scope: Scope) => InputFact[]

// ---------------------------------------------------------------------------------------------
// Fact construction
// ---------------------------------------------------------------------------------------------

type SlotsOf<K extends TemplateId> = SlotValues<(typeof TEMPLATES)[K]['slots']>

interface FactExtras {
  sources?: readonly SourceRef[]
  window?: { from: string; to: string }
  /** A gap sentence: the rule lacks the data it needs. */
  insufficient?: boolean
}

type Q<K extends Quantity['kind']> = Extract<Quantity, { kind: K }>

const count = (n: number): Q<'count'> => ({ kind: 'count', n: Math.round(n) })
/** A count that keeps its decimals (a ratio). */
const exact = (n: number): Q<'count'> => ({ kind: 'count', n })
const minutes = (min: number): Q<'minutes'> => ({ kind: 'minutes', min: Math.round(min) })
const bpm = (value: number): Q<'bpm'> => ({ kind: 'bpm', bpm: Math.round(value) })
const percent = (pct: number): Q<'percent'> => ({ kind: 'percent', pct })
const share = (fraction: number): Q<'share'> => ({ kind: 'share', fraction })
const distance = (m: number): Q<'distance'> => ({ kind: 'distance', m })
const climb = (m: number): Q<'climb'> => ({ kind: 'climb', m })
const duration = (sec: number): Q<'duration'> => ({ kind: 'duration', sec: Math.round(sec) })
const pace = (secPerKm: number): Q<'pace'> => ({ kind: 'pace', secPerKm })
const speed = (kmh: number): Q<'speed'> => ({ kind: 'speed', kmh })
const temp = (c: number): Q<'temp'> => ({ kind: 'temp', c })
const day = (iso: string): Q<'date'> => ({ kind: 'date', iso, style: 'weekday' })
const weekOf = (iso: string): Q<'date'> => ({ kind: 'date', iso, style: 'short' })

const newestFirst = (a: SourceRef, b: SourceRef) =>
  b.date.localeCompare(a.date) || a.id.localeCompare(b.id)

/** The sources a fact lists (newest first, at most `EXPLAIN_MAX_SOURCES`) and how many were left out. */
function listed(sources: readonly SourceRef[]): { sources: SourceRef[]; moreSources: number } {
  const unique = new Map<string, SourceRef>()
  for (const source of sources) unique.set(`${source.kind}:${source.id}`, source)
  const sorted = [...unique.values()].sort(newestFirst)
  return {
    sources: sorted.slice(0, EXPLAIN_MAX_SOURCES),
    moreSources: Math.max(0, sorted.length - EXPLAIN_MAX_SOURCES),
  }
}

/** One fact. `name` makes the id unique within the rule; `slots` are checked against the template. */
function make<K extends TemplateId>(
  rule: string,
  name: string,
  template: K,
  slots: SlotsOf<K>,
  extras: FactExtras = {},
): InputFact {
  const fact: InputFact = {
    id: `${rule.toLowerCase()}.${name}`,
    template,
    slots: { ...(slots as Record<string, Quantity | string>) },
    rule,
    ...listed(extras.sources ?? []),
    state: extras.insufficient === true ? 'insufficient' : 'used',
  }
  if (extras.window !== undefined) fact.window = { ...extras.window }
  return fact
}

/** A gap sentence for `rule`: the data it needs is missing. */
function gap<K extends TemplateId>(
  rule: string,
  template: K,
  slots: SlotsOf<K>,
  extras: Omit<FactExtras, 'insufficient'> = {},
): InputFact {
  return make(rule, 'gap', template, slots, { ...extras, insufficient: true })
}

const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function activitySource(a: Activity): SourceRef {
  return {
    kind: 'activity',
    id: a.id,
    date: a.date,
    label: titleCase(a.type),
    ...(a.distanceM !== null ? { distanceM: a.distanceM } : {}),
  }
}

// The fact constructor and the quantity helpers, shared with the run insights (`standout.ts`).
export { activitySource, bpm, climb, count, distance, duration, exact, make, minutes, percent }

const profileSource = (ctx: ExplainContext): SourceRef => ({
  kind: 'profile',
  id: 'profile',
  date: ctx.asOf,
  label: 'Profile',
})

const checkinSource = (date: string): SourceRef => ({
  kind: 'check-in',
  id: date,
  date,
  label: 'Check-in',
})

const wellnessSource = (date: string): SourceRef => ({
  kind: 'wellness',
  id: date,
  date,
  label: 'Wellness',
})

/** The window of the last `days` days, today included. */
const lastDays = (ctx: ExplainContext, days: number) => ({
  from: addDays(ctx.asOf, -(days - 1)),
  to: ctx.asOf,
})

/** The counted activities up to the day, as `estimateState` reads them. */
function countedUpTo(ctx: ExplainContext): Activity[] {
  return ctx.input.activities.filter((a) => !isDuplicate(a) && a.date <= ctx.asOf)
}

const countedRuns = (ctx: ExplainContext): Activity[] =>
  countedUpTo(ctx).filter((a) => a.type === 'run' || a.type === 'race')

// ---------------------------------------------------------------------------------------------
// A3 and g-1: the longest recent run
// ---------------------------------------------------------------------------------------------

/** The run in `runs` with this value of `pick`, the latest when several share it. */
function runWith(runs: Activity[], pick: (a: Activity) => number | null, value: number) {
  return runs
    .filter((a) => pick(a) === value)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))[0]
}

function longestRunFacts(rule: string, scope: Scope): InputFact[] {
  const { ctx, session } = scope
  const days = P.a3.longestRunWindowDays.value
  const window = lastDays(ctx, days)
  const longest = ctx.state.longest30d
  if (longest.distanceM <= 0 && longest.durationSec <= 0) {
    return [gap(rule, 'explain.longest-gap', { days: count(days) }, { window })]
  }
  const runs = countedRuns(ctx).filter((a) => a.date >= window.from && countsTowardReference(a))
  const facts: InputFact[] = []
  if (longest.distanceM > 0) {
    const run = runWith(runs, (a) => a.distanceM, longest.distanceM)
    facts.push(
      make(
        rule,
        'longest-distance',
        'explain.longest-distance',
        {
          days: count(days),
          distance: distance(longest.distanceM),
          date: day(run?.date ?? ctx.asOf),
        },
        { sources: run ? [activitySource(run)] : [], window },
      ),
    )
  }
  if (longest.durationSec > 0) {
    const run = runWith(runs, (a) => a.durationSec, longest.durationSec)
    facts.push(
      make(
        rule,
        'longest-duration',
        'explain.longest-duration',
        {
          days: count(days),
          duration: duration(longest.durationSec),
          date: day(run?.date ?? ctx.asOf),
        },
        { sources: run ? [activitySource(run)] : [], window },
      ),
    )
  }
  if (rule === 'g-1' && longest.distanceM > 0) {
    const warn = spikeWarnLimit(longest.distanceM, P.g1.minStepDistanceM.value)
    const override = spikeOverrideLimit(longest.distanceM, P.g1.minStepDistanceM.value)
    facts.push(
      make(rule, 'warn', 'explain.g1-warn', { limit: distance(warn) }),
      make(rule, 'override', 'explain.g1-override', { limit: distance(override) }),
    )
    if (session?.distanceM != null && session.distanceM > 0) {
      facts.push(
        make(
          rule,
          'session',
          'explain.g1-session',
          { share: share(Math.round((session.distanceM / longest.distanceM) * 100) / 100) },
          { sources: [{ kind: 'session', id: session.id, date: session.date, label: 'Session' }] },
        ),
      )
    }
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// g-2 and g-6: the weekly ramp, and lost volume is not made up
// ---------------------------------------------------------------------------------------------

function weekRuns(ctx: ExplainContext, weekStart: string): Activity[] {
  const end = addDays(weekStart, 6)
  return countedRuns(ctx).filter((a) => a.date >= weekStart && a.date <= end)
}

const weekWindow = (weekStart: string) => ({ from: weekStart, to: addDays(weekStart, 6) })

function plannedWeek(ctx: ExplainContext, weekStart: string) {
  return ctx.input.existing?.weeks.find((w) => w.weekStart === weekStart) ?? null
}

/**
 * The running minutes of a week as the weekly decision counts them: the plain weekly total. A
 * ladder or injury-return week credits less in `weekEvidence`, which the start paths read, so
 * that figure would not be the one the decision's completion share and cap came from.
 */
function decisionRunMin(ctx: ExplainContext, weekStart: string): number {
  return aggregateWeeks(ctx.input.activities, [weekStart])[0]!.runMin
}

function weeklyRampFacts(scope: Scope): InputFact[] {
  const { ctx, last, next } = scope
  if (!ctx.state.weeks.some((w) => w.runMin > 0 || w.raceMin > 0)) {
    return [gap('g-2', 'explain.g2-gap', { weeks: count(ctx.state.weeks.length) })]
  }
  const ran = aggregateWeeks(
    ctx.input.activities.filter((a) => !isDuplicate(a)),
    [last],
  )[0]!
  const facts = [
    make(
      'g-2',
      'last-week',
      'explain.g2-last-week',
      { week: weekOf(last), minutes: minutes(ran.runMin) },
      { sources: weekRuns(ctx, last).map(activitySource), window: weekWindow(last) },
    ),
    make('g-2', 'ramp', 'explain.g2-ramp', { pct: percent(weeklyRamp(ctx.state) * 100) }),
  ]
  const planned = plannedWeek(ctx, next)
  if (planned !== null) {
    facts.push(
      make(
        'g-2',
        'plan-week',
        'explain.g2-plan-week',
        { week: weekOf(next), minutes: minutes(planned.targetRunMin) },
        { window: weekWindow(next) },
      ),
    )
  }
  return facts
}

function lostVolumeFacts(scope: Scope): InputFact[] {
  const { ctx, last, next } = scope
  const evidence = weekEvidence(ctx.input, last)
  if (evidence.plannedMin === null) {
    return [gap('g-6', 'explain.g6-gap', { week: weekOf(last) }, { window: weekWindow(last) })]
  }
  const actual = decisionRunMin(ctx, last)
  const facts = [
    make(
      'g-6',
      'completion',
      'explain.g6-completion',
      {
        week: weekOf(last),
        actual: minutes(actual),
        planned: minutes(evidence.plannedMin),
      },
      { sources: weekRuns(ctx, last).map(activitySource), window: weekWindow(last) },
    ),
  ]
  const target = plannedWeek(ctx, next)?.targetRunMin
  if (target !== undefined) {
    const ramp = weeklyRamp(ctx.state)
    facts.push(
      make(
        'g-6',
        'cap',
        'explain.g6-cap',
        {
          week: weekOf(next),
          minutes: minutes(wholeMinutes(nextWeekCap(target, actual, ramp))),
          pct: percent(ramp * 100),
        },
        { window: weekWindow(next) },
      ),
    )
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// A2, A5, A6, A7, A8: the athlete state
// ---------------------------------------------------------------------------------------------

export const LOAD_METRIC_WORDS: Record<AthleteState['load']['metric'], string> = {
  srpe: 'session effort',
  trimp: 'heart-rate load',
  minutes: 'minutes of running',
}

function loadFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const chronicDays = P.a2.chronicDays.value
  const window = lastDays(ctx, chronicDays)
  const inWindow = countedUpTo(ctx).filter((a) => a.date >= window.from)
  if (inWindow.length === 0) {
    return [gap('A2', 'explain.a2-gap', { days: count(chronicDays) }, { window })]
  }
  const { acute, chronic, metric } = ctx.state.load
  return [
    make(
      'A2',
      'load',
      'explain.a2-load',
      {
        acuteDays: count(P.a2.acuteDays.value),
        acute: count(acute),
        chronicDays: count(chronicDays),
        chronic: count(chronic),
        metric: LOAD_METRIC_WORDS[metric],
      },
      { sources: inWindow.map(activitySource), window },
    ),
  ]
}

function lastRunFact(rule: string, ctx: ExplainContext): InputFact | null {
  const { lastRunDate, layoffDays } = ctx.state
  if (lastRunDate === null) return null
  const run = countedRuns(ctx)
    .filter((a) => a.date === lastRunDate)
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  return make(
    rule,
    'last-run',
    'explain.last-run',
    { date: day(lastRunDate), days: count(layoffDays) },
    { sources: run ? [activitySource(run)] : [] },
  )
}

function experienceFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { state, input } = scope.ctx
  const facts = [
    make(
      'A5',
      'class',
      'explain.a5-class',
      { experience: state.experience },
      {
        sources: [profileSource(ctx)],
      },
    ),
  ]
  const lastRun = lastRunFact('A5', ctx)
  if (lastRun !== null) facts.push(lastRun)
  if (state.weeks.length > 0) {
    facts.push(
      make('A5', 'weeks', 'explain.a5-weeks', {
        n: count(state.weeks.filter((w) => w.runMin > 0 || w.raceMin > 0).length),
        weeks: count(state.weeks.length),
      }),
    )
  }
  if (input.profile.runningSinceYear !== null) {
    facts.push(
      make(
        'A5',
        'years',
        'explain.a5-years',
        { year: String(input.profile.runningSinceYear) },
        { sources: [profileSource(ctx)] },
      ),
    )
  }
  if (state.lastRunDate === null && state.yearsRunning === null) {
    facts.push(gap('A5', 'explain.a5-gap', { days: count(P.a5.historyWindowDays.value) }))
  }
  return facts
}

/** Why critical speed is missing, as a gap sentence for `rule`. */
function csGap(rule: string, ctx: ExplainContext, efforts: ReturnType<typeof csEffortsOf>) {
  const sources = efforts.map((e) => activitySource(e.activity))
  const window = lastDays(ctx, P.a6.csWindowDays.value)
  if (efforts.length >= P.a6.csMinEfforts.value) {
    return gap(
      rule,
      'explain.cs-spread-gap',
      { found: count(efforts.length), ratio: exact(P.a6.csMinTimeSpreadRatio.value) },
      { sources, window },
    )
  }
  return gap(
    rule,
    'explain.cs-gap',
    {
      need: count(P.a6.csMinEfforts.value),
      from: distance(P.a6.csMinDistanceM.value),
      to: distance(P.a6.csMaxDistanceM.value),
      days: count(P.a6.csWindowDays.value),
      found: count(efforts.length),
    },
    { sources, window },
  )
}

function fitnessFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const efforts = csEffortsOf(countedRuns(ctx), ctx.asOf)
  const cs = ctx.state.fitness.csMps
  if (cs === null) return [csGap('A6', ctx, efforts)]
  return [
    make(
      'A6',
      'cs',
      'explain.a6-cs',
      {
        speed: speed(cs * 3.6),
        pace: pace(1000 / cs),
        n: count(efforts.length),
        days: count(P.a6.csWindowDays.value),
      },
      {
        sources: efforts.map((e) => activitySource(e.activity)),
        window: lastDays(ctx, P.a6.csWindowDays.value),
      },
    ),
  ]
}

function durabilityFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const group = durabilityRuns(countedRuns(ctx))
  const sources = group.map(activitySource)
  const median = ctx.state.durability.decouplingMedianPct
  if (median === null) {
    return [
      gap(
        'A7',
        'explain.a7-gap',
        {
          need: count(P.a7.minComparableRuns.value),
          temp: temp(P.a7.heatExcludeC.value),
          found: count(group.length),
        },
        { sources },
      ),
    ]
  }
  return [
    make(
      'A7',
      'drift',
      'explain.a7-drift',
      { n: count(group.length), pct: percent(median) },
      {
        sources,
      },
    ),
  ]
}

function efficiencyFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { recent, prior } = efficiencySamples(countedUpTo(ctx), ctx.asOf)
  const sources = recent.map((s) => activitySource(s.activity))
  const days = (P.a8.recentWeeks.value + P.a8.priorWeeks.value) * 7
  const window = lastDays(ctx, days)
  const trend = ctx.state.efficiency.trendPct
  const facts: InputFact[] = []
  if (trend === null) {
    facts.push(
      gap(
        'A8',
        'explain.a8-gap',
        {
          need: count(P.a8.minRunsPerWindow.value),
          from: minutes(P.a8.minDurationMin.value),
          to: minutes(P.a8.maxDurationMin.value),
          recent: count(recent.length),
          prior: count(prior.length),
        },
        { sources, window },
      ),
    )
  } else {
    facts.push(
      make(
        'A8',
        'trend',
        trend >= 0 ? 'explain.a8-up' : 'explain.a8-down',
        { pct: percent(Math.abs(trend)) },
        { sources, window },
      ),
    )
  }
  const model = ctx.hrModel
  const easyPace = ctx.zones.lt1PaceSecPerKm
  if (model !== null && easyPace !== null) {
    const mps = 1000 / easyPace.value
    facts.push(
      make(
        'A8',
        'hr-model',
        'explain.a8-hr-model',
        {
          pace: pace(easyPace.value),
          bpm: bpm(model.interceptBpm + model.slopeBpmPerMps * mps),
          n: count(model.runs),
        },
        { window: lastDays(ctx, P.hrModel.windowWeeks.value * 7) },
      ),
    )
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// C1 to C5: zones and thresholds
// ---------------------------------------------------------------------------------------------

const ZONE_NUMBER = { z1: 1, z2: 2, z3: 3 } as const
const NO_TARGET_KINDS: ReadonlySet<string> = new Set(['strength', 'mobility', 'rest'])

/** The session's targets, from the same resolver every surface reads (`resolveTargets`). */
function targetFacts(rule: string, session: SessionRow, zones: ZoneSet): InputFact[] {
  if (NO_TARGET_KINDS.has(session.kind)) return []
  const t = resolveTargets(session, zones, { hot: false })
  const facts: InputFact[] = []
  const sources: SourceRef[] = [
    { kind: 'session', id: session.id, date: session.date, label: 'Session' },
  ]
  if (t.mode === 'hr-ceiling' && t.hrCeiling !== null) {
    facts.push(
      make(rule, 'target', 'explain.c1-target-ceiling', { bpm: bpm(t.hrCeiling) }, { sources }),
    )
  } else if (t.mode === 'hr-band' && t.hrRange !== null && t.zone in ZONE_NUMBER) {
    facts.push(
      make(
        rule,
        'target',
        'explain.c1-target-band',
        {
          low: bpm(t.hrRange[0]),
          high: bpm(t.hrRange[1]),
          zone: count(ZONE_NUMBER[t.zone as keyof typeof ZONE_NUMBER]),
        },
        { sources },
      ),
    )
  } else if (t.mode === 'pace' && t.paceSecPerKm !== null) {
    facts.push(
      make(
        rule,
        'target',
        'explain.c1-target-pace',
        { slow: pace(t.paceSecPerKm[0]), fast: pace(t.paceSecPerKm[1]) },
        { sources },
      ),
    )
  } else {
    facts.push(
      make(
        rule,
        'target',
        'explain.c1-target-effort',
        { low: count(t.rpe[0]), high: count(t.rpe[1]) },
        { sources },
      ),
    )
  }
  if (t.mode !== 'effort') {
    facts.push(
      make(rule, 'rpe', 'explain.c1-target-rpe', { low: count(t.rpe[0]), high: count(t.rpe[1]) }),
    )
    if (t.mode !== 'pace' && t.paceSecPerKm !== null) {
      facts.push(
        make(rule, 'pace-guide', 'explain.c1-pace-guide', {
          slow: pace(t.paceSecPerKm[0]),
          fast: pace(t.paceSecPerKm[1]),
        }),
      )
    }
  }
  return facts
}

function zoneFacts(scope: Scope): InputFact[] {
  const { ctx, session } = scope
  const facts = session === null ? [] : targetFacts('C1', session, ctx.zones)
  const hr = ctx.zones.hr
  if (hr === null) return [...facts, gap('C1', 'explain.c1-gap', {})]
  facts.push(
    make(
      'C1',
      'zones-hr',
      'explain.c1-zones-hr',
      { z1: bpm(hr.z1[1]), z2: bpm(hr.z2[1]), z3: bpm(hr.z3[1]) },
      { sources: [profileSource(ctx)] },
    ),
  )
  return facts
}

export const ANCHOR_WORDS: Record<Boundary['source'], string> = {
  tested: 'a test',
  cs: 'your critical speed',
  dfa: 'a heart-rate-variability reading',
  rpe: 'your effort ratings',
  'hrmax-observed': 'a measured maximum heart rate',
  'hrmax-age': 'your age',
  hrr: 'your heart-rate reserve',
  profile: 'your profile',
}

function anchorFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { zones } = ctx
  const efforts = csEffortsOf(countedRuns(ctx), ctx.asOf).map((e) => activitySource(e.activity))
  const anchors: Array<[string, string, Boundary | null]> = [
    ['hrmax', 'maximum heart rate', zones.hrMax],
    ['lt1-hr', 'heart rate at the line between zones 1 and 2', zones.lt1Hr],
    ['lt1-pace', 'pace at the line between zones 1 and 2', zones.lt1PaceSecPerKm],
    ['threshold-pace', 'threshold pace', zones.thresholdPaceSecPerKm],
    ['cs', 'critical speed', zones.csMps],
  ]
  const facts = anchors.flatMap(([name, anchor, boundary]) => {
    if (boundary === null) return []
    const date = day(isIsoDate(boundary.asOf) ? boundary.asOf : ctx.asOf)
    // Critical speed is the fit itself: "comes from your critical speed" would explain it by itself.
    if (name === 'cs') return [make('C2', name, 'explain.c2-cs', { date }, { sources: efforts })]
    return [
      make(
        'C2',
        name,
        'explain.c2-anchor',
        { anchor, source: ANCHOR_WORDS[boundary.source], date },
        { sources: boundary.source === 'cs' ? efforts : [profileSource(ctx)] },
      ),
    ]
  })
  return facts.length > 0 ? facts : [gap('C2', 'explain.c2-gap', {})]
}

function maxHeartRateFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const hrMax = ctx.zones.hrMax
  if (hrMax === null) return [gap('C3', 'explain.c3-gap', {})]
  const sources = [profileSource(ctx)]
  const value = { bpm: bpm(hrMax.value) }
  if (hrMax.source === 'hrmax-observed') {
    return [make('C3', 'hrmax', 'explain.c3-measured', value, { sources })]
  }
  if (hrMax.source === 'profile') {
    return [make('C3', 'hrmax', 'explain.c3-profile', value, { sources })]
  }
  return [
    make(
      'C3',
      'hrmax',
      'explain.c3-age',
      { ...value, band: bpm(P.c3.priorBandBpm.value) },
      { sources },
    ),
  ]
}

/** The gap for a pace anchor that is missing: a break cleared it, or critical speed lacks efforts. */
function paceAnchorGap(rule: string, ctx: ExplainContext): InputFact {
  const afterBreak = ctx.state.layoffDays >= P.c8.breakDays.value
  const hadAnchor =
    ctx.state.fitness.csMps !== null || ctx.input.profile.thresholdPaceSecPerKm !== null
  if (afterBreak && hadAnchor) {
    return gap(rule, 'explain.c-break-gap', { days: count(P.c8.breakDays.value) })
  }
  return csGap(rule, ctx, csEffortsOf(countedRuns(ctx), ctx.asOf))
}

function lineBetweenZonesFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { zones } = ctx
  const facts: InputFact[] = []
  const lt1 = zones.lt1PaceSecPerKm
  if (lt1 === null) {
    facts.push(paceAnchorGap('C4', ctx))
  } else if (lt1.source === 'cs') {
    facts.push(
      make(
        'C4',
        'pace',
        'explain.c4-cs',
        { share: share(P.c4.lt1CsFraction.value), pace: pace(lt1.value) },
        {
          sources: csEffortsOf(countedRuns(ctx), ctx.asOf).map((e) => activitySource(e.activity)),
          window: lastDays(ctx, P.a6.csWindowDays.value),
        },
      ),
    )
  } else {
    facts.push(
      make(
        'C4',
        'pace',
        'explain.c4-profile',
        { pace: pace(lt1.value) },
        {
          sources: [profileSource(ctx)],
        },
      ),
    )
  }
  if (zones.lt1Hr !== null) {
    facts.push(
      make(
        'C4',
        'hr',
        'explain.c4-hr',
        { bpm: bpm(zones.lt1Hr.value) },
        {
          sources: [profileSource(ctx)],
        },
      ),
    )
  }
  return facts
}

function thresholdFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const threshold = ctx.zones.thresholdPaceSecPerKm
  if (threshold === null) return [paceAnchorGap('C5', ctx)]
  if (threshold.source === 'profile') {
    return [
      make(
        'C5',
        'threshold',
        'explain.c5-profile',
        { pace: pace(threshold.value) },
        {
          sources: [profileSource(ctx)],
        },
      ),
    ]
  }
  const margin =
    ctx.state.experience === 'trained'
      ? P.c5.thresholdMarginWellTrainedKmh.value
      : P.c5.thresholdMarginOtherKmh.value
  return [
    make(
      'C5',
      'threshold',
      'explain.c5-cs',
      { pace: pace(threshold.value), margin: speed(margin) },
      {
        sources: csEffortsOf(countedRuns(ctx), ctx.asOf).map((e) => activitySource(e.activity)),
        window: lastDays(ctx, P.a6.csWindowDays.value),
      },
    ),
  ]
}

// ---------------------------------------------------------------------------------------------
// J2 to J5, J7: readiness, the weekly decision and breaks
// ---------------------------------------------------------------------------------------------

function checkinFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const window = lastDays(ctx, EXPLAIN_CHECKIN_DAYS)
  const recent = checkinsOf(ctx.input).filter((c) => c.date >= window.from && c.date <= ctx.asOf)
  if (recent.length === 0) {
    return [gap('J2', 'explain.j2-gap', { days: count(EXPLAIN_CHECKIN_DAYS) }, { window })]
  }
  const sources = recent.map((c) => checkinSource(c.date))
  const facts = [
    make(
      'J2',
      'checkins',
      'explain.j2-checkins',
      { n: count(recent.length), days: count(EXPLAIN_CHECKIN_DAYS) },
      { sources, window },
    ),
  ]
  const low = recent.filter(poorSubjective)
  if (low.length > 0) {
    facts.push(
      make(
        'J2',
        'low',
        'explain.j2-low',
        { n: count(low.length) },
        { sources: low.map((c) => checkinSource(c.date)), window },
      ),
    )
  }
  return facts
}

function downgradeFacts(scope: Scope): InputFact[] {
  const { readiness } = scope.ctx
  const date = day(readiness.date)
  if (readiness.checkin === null && readiness.hrv.readings === 0 && readiness.sleepAvgH === null) {
    return [gap('J3', 'explain.j3-gap', { date })]
  }
  const sources = readiness.checkin === null ? [] : [checkinSource(readiness.date)]
  switch (readiness.state) {
    case 'normal':
      return [make('J3', 'state', 'explain.j3-normal', { date }, { sources })]
    case 'possible-fatigue':
      return [make('J3', 'state', 'explain.j3-fatigue', { date }, { sources })]
    case 'persistent-suppression':
      return [
        make(
          'J3',
          'state',
          'explain.j3-suppression',
          { days: count(P.j8.deloadSuggestDays.value), date },
          { sources },
        ),
      ]
  }
}

function hrvFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { hrv, date } = ctx.readiness
  const window = lastDays(ctx, hrv.lookbackDays)
  if (hrv.baselineMean === null || hrv.baselineSd === null) {
    // The engine tests the earlier readings, not today's own, against the minimum, and reads
    // them over the lookback of the profile (longer for a female profile).
    return [
      gap(
        'J4',
        'explain.j4-gap',
        {
          need: count(P.j4.minReadings.value),
          days: count(hrv.lookbackDays),
          found: count(hrv.baseline),
        },
        { window },
      ),
    ]
  }
  if (hrv.latest === null)
    return [gap('J4', 'explain.j4-today-gap', { date: day(date) }, { window })]
  // The readiness read stores ln rMSSD; the sentence is in milliseconds, as on Today.
  const band = P.j4.sdBelowMean.value * hrv.baselineSd
  return [
    make(
      'J4',
      'reading',
      hrv.flag ? 'today.signal.hrv-low' : 'today.signal.hrv',
      {
        latest: count(Math.exp(hrv.latest)),
        low: count(Math.exp(hrv.baselineMean - band)),
        high: count(Math.exp(hrv.baselineMean + band)),
      },
      { sources: [wellnessSource(date)], window },
    ),
  ]
}

/** The decision's signals that name a state of the runner without a figure to restate. */
export const SIGNAL_WORDS: Readonly<Record<string, string>> = {
  'subjective-decline': 'lower check-in scores or sessions that felt harder than expected',
  'efficiency-decline': 'a fall in efficiency on steady runs',
  'sleep-efficiency-drop': 'a drop in sleep efficiency',
  illness: 'a day of illness',
  pain: 'pain at the level the plan stops for',
  'pain-mild': 'mild pain',
  'persistent-suppression': 'readiness signals that stayed low for a long time',
  'readiness-flag': 'readiness flags on several days',
  'hrv-suppressed': 'HRV that stayed below your usual range',
  heat: 'the first hot days of the season',
  'completion-low': 'less running than planned so far',
  'sleep-warning': 'short sleep',
  disruption: 'days covered by a rest window',
}
const SIGNAL_FALLBACK_WORDS = 'a sign the plan watches'
const POST_RACE_SIGNALS: ReadonlySet<string> = new Set(['post-race-stage', 'post-race-delayed'])

function decisionFacts(scope: Scope): InputFact[] {
  const { ctx, last } = scope
  const decision = ctx.decision
  const window = weekWindow(last)
  if (decision === null) {
    return [gap('J5', 'explain.j5-gap', { week: weekOf(last) }, { window })]
  }
  const weekEnd = addDays(last, 6)
  const finished = ctx.asOf > weekEnd
  const readAt = finished ? weekEnd : ctx.asOf
  const facts: InputFact[] = []
  if (decision.postRace !== undefined) {
    facts.push(make('J5', 'post-race', 'explain.j5-post-race', { week: weekOf(last) }, { window }))
  } else {
    const slots = { week: weekOf(last), minutes: minutes(decision.nextWeekTargetMin) }
    const template = {
      progress: 'explain.j5-progress',
      hold: 'explain.j5-hold',
      reduce: 'explain.j5-reduce',
    } as const
    facts.push(make('J5', 'decision', template[decision.decision], slots, { window }))
  }
  const evidence = weekEvidence(ctx.input, last)
  const sleep = sleepAverageH(ctx.input, readAt)
  for (const signal of decision.signals) {
    if (POST_RACE_SIGNALS.has(signal.code)) continue
    const name = `signal-${signal.code}`
    if (
      signal.code === 'completion-low' &&
      finished &&
      evidence.plannedMin !== null &&
      evidence.plannedMin > 0
    ) {
      facts.push(
        make(
          'J5',
          name,
          'explain.j5-completion',
          {
            actual: minutes(decisionRunMin(ctx, last)),
            planned: minutes(evidence.plannedMin),
            share: share(P.j5.completionHoldShare.value),
          },
          { sources: weekRuns(ctx, last).map(activitySource), window },
        ),
      )
      continue
    }
    if (signal.code === 'sleep-warning' && sleep !== null) {
      facts.push(
        make(
          'J5',
          name,
          'today.signal.sleep-low',
          {
            hours: duration(sleep * 3600),
            nights: count(P.j5.sleepWarnNights.value),
            floor: duration(P.j5.sleepWarnHours.value * 3600),
          },
          { window },
        ),
      )
      continue
    }
    if (signal.code === 'reds') {
      facts.push(
        make(
          'J5',
          name,
          'explain.j5-reds',
          { n: count(ctx.input.screeningFlags ?? 0) },
          { window },
        ),
      )
      continue
    }
    facts.push(
      make(
        'J5',
        name,
        'explain.j5-signal',
        { sign: SIGNAL_WORDS[signal.code] ?? SIGNAL_FALLBACK_WORDS },
        { window },
      ),
    )
  }
  return facts
}

function breakFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const lastRun = lastRunFact('J7', ctx)
  if (lastRun === null) return [gap('J7', 'explain.j7-gap', {})]
  const facts = [lastRun]
  if (ctx.state.layoffDays >= P.j7.tier1Days.value) {
    facts.push(
      make('J7', 'restart', 'explain.j7-restart', {
        share: share(breakRestart(ctx.state.layoffDays, 0).fraction),
      }),
    )
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// L1 to L6: the prediction
// ---------------------------------------------------------------------------------------------

export const METHOD_WORDS: Readonly<Record<string, string>> = {
  'personal-exponent': 'a personal exponent fitted to your race times',
  riegel: 'a recent race scaled to this distance',
  'same-distance': 'a race at about this distance',
  'single-anchor': 'one shorter race',
  'critical-speed': 'your critical speed',
  'cs-durability': 'your critical speed, adjusted for how well you hold pace',
  'cs-fraction': 'a share of your critical speed for long events',
}

/** "a", "a and b", "a, b and c". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}`
}

function methodsOf(prediction: Prediction): string[] {
  return prediction.method.split('+')
}

/** The methods that scale a race result: only these read the closest race to the goal. */
const RACE_METHODS: ReadonlySet<string> = new Set([
  'personal-exponent',
  'riegel',
  'same-distance',
  'single-anchor',
])

function effectiveDistanceM(goal: NonNullable<ExplainContext['goal']>): number {
  return (goal.distanceM ?? 0) + Math.max(0, goal.gainM ?? 0) * P.l5.gainEquivalentM.value
}

/** The race closest to the target distance on a log scale; a tie goes to the later date. */
function closestRace(ctx: ExplainContext, goal: NonNullable<ExplainContext['goal']>) {
  const target = effectiveDistanceM(goal)
  let best: AthleteState['fitness']['races'][number] | null = null
  let bestGap = Infinity
  for (const race of ctx.state.fitness.races) {
    if (!(race.distanceM > 0) || !(race.timeSec > 0)) continue
    const away = Math.abs(Math.log(race.distanceM / target))
    const tie = Math.abs(away - bestGap) <= 1e-12
    if (away < bestGap - 1e-12 || (tie && best !== null && race.date > best.date)) {
      best = race
      bestGap = away
    }
  }
  return best
}

function modelFacts(scope: Scope): InputFact[] {
  const { ctx } = scope
  const { goal, prediction } = ctx
  if (prediction === null) {
    return [gap('L1', 'explain.l-gap', { need: count(P.a6.csMinEfforts.value) })]
  }
  const basis = joinWords(methodsOf(prediction).map((method) => METHOD_WORDS[method] ?? method))
  const facts = [make('L1', 'basis', 'explain.l1-basis', { basis })]
  // A prediction from critical speed alone (an ultra with no race near its distance) read no race.
  const usesRace = methodsOf(prediction).some((method) => RACE_METHODS.has(method))
  const race = !usesRace || goal === null || goal.distanceM === null ? null : closestRace(ctx, goal)
  if (race !== null) {
    const activity = countedRuns(ctx).find(
      (a) =>
        a.type === 'race' &&
        a.date === race.date &&
        a.distanceM === race.distanceM &&
        a.durationSec === race.timeSec,
    )
    facts.push(
      make(
        'L1',
        'anchor',
        'explain.l1-anchor',
        {
          distance: distance(race.distanceM),
          duration: duration(race.timeSec),
          date: day(race.date),
        },
        { sources: activity ? [activitySource(activity)] : [] },
      ),
    )
  }
  return facts
}

function marathonFacts(scope: Scope): InputFact[] {
  const { goal, prediction, state } = scope.ctx
  const marathonRange =
    goal !== null &&
    goal.distanceM !== null &&
    goal.distanceM > P.d1Class.halfUpperM.value &&
    goal.distanceM <= P.d1.ultraAboveM.value
  if (!marathonRange) return []
  if (prediction === null) return [gap('L2', 'explain.l2-gap', {})]
  const methods = methodsOf(prediction)
  const facts: InputFact[] = []
  if (methods.includes('single-anchor')) {
    facts.push(
      make('L2', 'single', 'explain.l2-single', {
        distance: distance(P.l2.singleAnchorMaxM.value),
        pct: percent(P.l2.singleAnchorSlowdownPct.value),
      }),
    )
  }
  if (methods.includes('cs-durability') && state.durability.decouplingMedianPct !== null) {
    facts.push(
      make('L2', 'drift', 'explain.l2-drift', {
        pct: percent(state.durability.decouplingMedianPct),
      }),
    )
  }
  return facts
}

function covariateFacts(scope: Scope): InputFact[] {
  const { prediction } = scope.ctx
  if (prediction === null) {
    return [gap('L3', 'explain.l3-gap', { min: count(P.l3.minSources.value) })]
  }
  const n = methodsOf(prediction).length
  const facts = [
    make('L3', 'sources', 'explain.l3-sources', {
      n: count(n),
      min: count(P.l3.minSources.value),
    }),
  ]
  if (n < P.l3.minSources.value) {
    facts.push(
      make('L3', 'widened', 'explain.l3-widened', {
        pct: percent(P.l3.singleSourceWideningPct.value),
      }),
    )
  }
  return facts
}

function ultraFacts(scope: Scope): InputFact[] {
  const { goal, prediction } = scope.ctx
  const ultra = goal !== null && goal.distanceM !== null && goal.distanceM > P.d1.ultraAboveM.value
  if (!ultra) return []
  if (prediction === null) return [gap('L4', 'explain.l4-gap', {})]
  return [make('L4', 'band', 'explain.l4-band', { pct: percent(P.l4.ultraMinHalfWidthPct.value) })]
}

function trailFacts(scope: Scope): InputFact[] {
  const { goal, prediction } = scope.ctx
  if (goal === null || goal.distanceM === null) return []
  const gain = Math.max(0, goal.gainM ?? 0)
  const trail = goal.surface === 'trail' || goal.surface === 'mixed'
  if (!trail && gain <= 0) return []
  if (prediction === null) return [gap('L5', 'explain.l5-gap', {})]
  const facts: InputFact[] = []
  if (gain > 0) {
    facts.push(
      make('L5', 'climb', 'explain.l5-climb', {
        gain: climb(gain),
        distance: distance(gain * P.l5.gainEquivalentM.value),
      }),
    )
  }
  if (trail) {
    const gainPerKm = (gain / goal.distanceM) * 1000
    const widening =
      P.l5.trailIntervalWideningPct.value + P.l5.gainWideningPctPerMPerKm.value * gainPerKm
    facts.push(make('L5', 'trail', 'explain.l5-trail', { pct: percent(Math.round(widening)) }))
  }
  return facts
}

function bandFacts(scope: Scope): InputFact[] {
  const { goal, prediction } = scope.ctx
  if (prediction === null) return [gap('L6', 'explain.l6-gap', {})]
  const facts = [
    make('L6', 'range', 'explain.l6-range', {
      predicted: duration(prediction.predictedSec),
      low: duration(prediction.lowSec),
      high: duration(prediction.highSec),
    }),
  ]
  if (goal !== null && goal.distanceM !== null) {
    facts.push(
      make('L6', 'floor', 'explain.l6-floor', {
        pct: percent(rangeLabel({ distanceM: goal.distanceM }).minHalfWidthPct),
      }),
    )
  }
  return facts
}

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

/**
 * The builders, by rule id as `RULE_TITLES` spells it. A rule is looked up without regard to case
 * but not to hyphens (`g-1` is the spike guard, `G1` a global principle).
 */
export const INPUT_BUILDERS: Readonly<Record<string, Builder>> = {
  'g-1': (scope) => longestRunFacts('g-1', scope),
  'g-2': weeklyRampFacts,
  'g-6': lostVolumeFacts,
  A2: loadFacts,
  A3: (scope) => longestRunFacts('A3', scope),
  A5: experienceFacts,
  A6: fitnessFacts,
  A7: durabilityFacts,
  A8: efficiencyFacts,
  C1: zoneFacts,
  C2: anchorFacts,
  C3: maxHeartRateFacts,
  C4: lineBetweenZonesFacts,
  C5: thresholdFacts,
  J2: checkinFacts,
  J3: downgradeFacts,
  J4: hrvFacts,
  J5: decisionFacts,
  J7: breakFacts,
  L1: modelFacts,
  L2: marathonFacts,
  L3: covariateFacts,
  L4: ultraFacts,
  L5: trailFacts,
  L6: bandFacts,
}

/**
 * Rules that use none of the runner's numbers: a principle, a fixed design choice or a rule the
 * app does not run on the runner. Their Explain says so ("This rests on the rule alone").
 */
export const POLICY_ONLY_RULES: ReadonlySet<string> = new Set([
  // global principles
  'G1',
  'G2',
  'G3',
  'G4',
  'G5',
  'G6',
  // athlete state and load: structure, not figures
  'A1',
  'A10',
  'B4',
  'B8',
  // plan structure and session library
  'E1',
  'E5',
  'F1',
  'F2',
  'F3',
  'F4',
  'F6',
  'F-lib',
  // limits that restate a principle
  'g-4',
  'g-5',
  'g-7',
  // adaptation inputs
  'J1',
  // design choices without a runner figure
  'design-macro',
  'design-sessions',
  'design-explain',
])

const lower = (rule: string) => rule.toLowerCase()
const builders = new Map(
  Object.entries(INPUT_BUILDERS).map(([rule, build]) => [lower(rule), build]),
)
const policyOnly = new Set([...POLICY_ONLY_RULES].map(lower))

/** The builder of a rule id, matched without regard to case. */
export function builderFor(rule: string): Builder | undefined {
  return builders.get(lower(rule))
}

/** True when the rule uses none of the runner's numbers. */
export function isPolicyOnly(rule: string): boolean {
  return policyOnly.has(lower(rule))
}

// ---------------------------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------------------------

/** Ids one request may carry, as `RULE_TITLES` spells them. */
export const EXPLAIN_RULES = {
  /** Every run is read against the longest recent run, the week's volume and the zones. */
  run: ['g-1', 'g-2', 'C1', 'C2'],
  week: ['g-2', 'g-6', 'J5'],
  decision: ['J5', 'g-6'],
  readiness: ['J2', 'J3', 'J4'],
  zones: ['C1', 'C2', 'C3', 'C4', 'C5', 'A6'],
  prediction: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
} as const

/** The rules of a zone boundary: its anchor, then the rule that sets it. */
const BOUNDARY_RULES = {
  cs: ['A6', 'C2'],
  lt1Pace: ['C2', 'C4'],
  thresholdPace: ['C2', 'C5'],
  lt1Hr: ['C2', 'C4'],
  hrMax: ['C2', 'C3'],
} as const

function dedupe(rules: readonly string[]): string[] {
  const seen = new Set<string>()
  return rules.filter((rule) => {
    const key = lower(rule)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sessionOf(ctx: ExplainContext, id: string): SessionRow | null {
  return ctx.input.existing?.sessions.find((s) => s.id === id) ?? null
}

function plannedWeekStart(ctx: ExplainContext, weekStart: string): boolean {
  return ctx.input.existing?.weeks.some((w) => w.weekStart === weekStart) ?? false
}

/**
 * The rule ids a request is about, in the order they are shown, or null when the request names a
 * record the context does not hold (an unknown session or week) or a subject whose figures are
 * stored with it (a brief, a run).
 */
export function explainRules(req: ExplainRequest, ctx: ExplainContext): string[] | null {
  switch (req.subject) {
    case 'session': {
      const session = sessionOf(ctx, req.id)
      if (session === null) return null
      const run = VOLUME_KINDS.has(session.kind)
      return dedupe([...(run ? EXPLAIN_RULES.run : []), ...session.rules])
    }
    case 'week':
      return plannedWeekStart(ctx, req.weekStart) ? [...EXPLAIN_RULES.week] : null
    case 'decision':
      return plannedWeekStart(ctx, req.weekStart) ? [...EXPLAIN_RULES.decision] : null
    case 'readiness':
      return [...EXPLAIN_RULES.readiness]
    case 'zone':
      return req.boundary === undefined
        ? [...EXPLAIN_RULES.zones]
        : [...BOUNDARY_RULES[req.boundary]]
    case 'prediction':
      return [...EXPLAIN_RULES.prediction]
    case 'rules':
      return dedupe(req.rules)
    case 'brief':
    case 'activity':
      return null
  }
}

/**
 * The weeks a request reads: `last` is the week the ramp starts from and the weekly decision is
 * about, `next` the week they lead to. A decision request names the week decided; every other
 * request names the week that is planned (a session's week, the requested week, the current one).
 */
export function explainWeeks(
  req: ExplainRequest,
  ctx: Pick<ExplainContext, 'asOf' | 'input'>,
): { last: string; next: string } {
  let next: string
  if (req.subject === 'decision') return { last: req.weekStart, next: addDays(req.weekStart, 7) }
  if (req.subject === 'week' || req.subject === 'brief') next = req.weekStart
  else if (req.subject === 'session') {
    const session = ctx.input.existing?.sessions.find((s) => s.id === req.id)
    next = mondayOf(session?.date ?? ctx.asOf)
  } else next = mondayOf(ctx.asOf)
  return { last: addDays(next, -7), next }
}

/** Which values beyond the snapshot a set of rules reads, so the server computes only those. */
export function explainNeeds(rules: readonly string[]): {
  hrModel: boolean
  decision: boolean
  prediction: boolean
} {
  const keys = new Set(rules.map(lower))
  return {
    hrModel: keys.has('a8'),
    decision: keys.has('j5'),
    prediction: EXPLAIN_RULES.prediction.some((rule) => keys.has(lower(rule))),
  }
}

/**
 * The figures behind a request, rule by rule. A rule with figures to show becomes a group; a
 * rule with no builder, a policy-only rule and a rule whose builder has nothing to say for this
 * request are listed in `rest`. Unknown records give an empty view, and the server answers 404
 * before it gets here (`explainRules` is null).
 */
export function explainInputs(req: ExplainRequest, ctx: ExplainContext): ExplainView {
  const rules = explainRules(req, ctx) ?? []
  const session = req.subject === 'session' ? sessionOf(ctx, req.id) : null
  const scope: Scope = { ctx, session, ...explainWeeks(req, ctx) }
  const groups: ExplainGroup[] = []
  const rest: string[] = []
  for (const rule of rules) {
    const facts = builderFor(rule)?.(scope) ?? []
    if (facts.length > 0) groups.push({ rule, facts })
    else rest.push(rule)
  }
  return { subject: req.subject, asOf: ctx.asOf, frozen: false, rules, groups, rest }
}

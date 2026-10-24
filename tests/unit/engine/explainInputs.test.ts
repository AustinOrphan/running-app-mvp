// The input builders of "From your numbers" (phase 3a design 8.4, 8.8): dated sources, gap
// sentences, figures that agree with the engine and its Params, determinism, no mutation, and the
// coverage of every rule title.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { COPY_MAX_CHARS, EXPLAIN_MAX_SOURCES } from '../../../shared/copy/limits.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import { TEMPLATES, renderFact } from '../../../shared/copy/templates.ts'
import { addDays, isIsoDate, mondayOf } from '../../../shared/dates.ts'
import {
  afterBreak,
  breakRestart,
  weekEvidence,
  weeklyDecision,
} from '../../../shared/engine/adapt.ts'
import {
  csEffortsOf,
  durabilityRuns,
  efficiencyIndex,
  efficiencySamples,
  estimateState,
} from '../../../shared/engine/athlete.ts'
import { fitHrModel } from '../../../shared/engine/execution.ts'
import {
  ANCHOR_WORDS,
  builderFor,
  checkinSource,
  explainInputs,
  explainNeeds,
  explainRules,
  explainWeeks,
  INPUT_BUILDERS,
  isPolicyOnly,
  LOAD_METRIC_WORDS,
  METHOD_WORDS,
  POLICY_ONLY_RULES,
  SIGNAL_WORDS,
  type ExplainContext,
} from '../../../shared/engine/explainInputs.ts'
import { feasibility, peakLongRunMin, trainingPace } from '../../../shared/engine/goal.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import {
  spikeOverrideLimit,
  spikeWarnLimit,
  ultraRunCapMin,
  VOLUME_KINDS,
  weeklyRamp,
} from '../../../shared/engine/limits.ts'
import { criticalSpeed } from '../../../shared/engine/load.ts'
import { startPath, taperDays } from '../../../shared/engine/macro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { postRaceWindows } from '../../../shared/engine/postRace.ts'
import { predictFromState } from '../../../shared/engine/predict.ts'
import { readinessSnapshot } from '../../../shared/engine/readiness.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type {
  Checkin,
  EngineInput,
  ExplainRequest,
  ExplainView,
  InputFact,
  Quantity,
  WeekDraft,
} from '../../../shared/engine/types.ts'
import { buildZones } from '../../../shared/engine/zones.ts'
import type { Activity, AthleteProfile, Units, WellnessDay } from '../../../shared/types.ts'
import { RULE_TITLES } from '../../../web/components/ruleTitles.ts'
import {
  activity,
  hrvSeries,
  planned,
  profile as profileOf,
  STEADY_HRV,
  wellnessDay,
} from './e8-fixtures.ts'
import { steadyHistogram } from './fixtures.ts'
import { athletes, TODAY } from './matrix-fixtures.ts'

const MONDAY = '2026-10-19'
const UNITS: readonly Units[] = ['km', 'mi']

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

type Existing = NonNullable<EngineInput['existing']>

/** The context the server would build for `input` (the pieces `explainInputs` reads). */
function contextOf(input: EngineInput, over: Partial<ExplainContext> = {}): ExplainContext {
  const state = estimateState(input)
  const g = input.goal
  return {
    asOf: input.today,
    input,
    state,
    zones: buildZones(input.profile, state, input.today),
    readiness: readinessSnapshot(input, input.today),
    goal: { id: g.goalId, distanceM: g.distanceM, gainM: g.gainM, surface: g.surface },
    prediction: predictFromState(state, {
      distanceM: g.distanceM,
      gainM: g.gainM,
      surface: g.surface,
      wbgtC: g.raceWbgtC,
    }),
    hrModel: fitHrModel(input.activities, input.today),
    decision: null,
    race: g,
    ...over,
  }
}

/** The plan the engine builds for `input`, in the shape of the stored plan. */
function withPlan(input: EngineInput): EngineInput {
  const draft = buildPlan(input)
  const existing: Existing = {
    weeks: draft.weeks,
    sessions: draft.sessions.map((s, i) => ({
      ...s,
      id: `s${String(i)}`,
      status: 'planned',
      activityId: null,
    })),
  }
  return { ...input, existing }
}

const marathon = athletes().find((a) => a.id === 'marathon')!

/** A runner with every kind of data the builders read, on top of the marathon fixture. */
function richInput(): EngineInput {
  const days = (n: number) => addDays(TODAY, -n)
  const steady = (n: number, speedMps: number, hr: number): Activity =>
    activity(days(n), {
      id: `steady-${String(n)}`,
      durationSec: 3000,
      movingSec: 3000,
      distanceM: speedMps * 3000,
      gapDistanceM: speedMps * 3000,
      elevationGainM: 20,
      avgHr: hr,
      hrHistogram: steadyHistogram(hr, 3000),
    })
  // Ten steady runs in the last eight weeks: four in the latest four weeks, six before.
  const recent = [2, 6, 10, 14].map((n, i) => steady(n, 2.8 + i * 0.02, 140 + (i % 2)))
  const before = [33, 36, 40, 44, 48, 52].map((n, i) => steady(n, 2.6 + i * 0.02, 140 + (i % 2)))
  // Efforts of four lengths inside 90 days: critical speed 3.5 m/s with D' of 200 m.
  const effort = (n: number, distanceM: number) =>
    activity(days(n), {
      id: `effort-${String(distanceM)}`,
      distanceM,
      durationSec: Math.round((distanceM - 200) / 3.5),
      movingSec: Math.round((distanceM - 200) / 3.5),
      elevationGainM: 0,
    })
  const efforts = [effort(20, 800), effort(22, 1500), effort(24, 3000), effort(26, 5000)]
  // Three comparable cool long runs.
  const longRun = (n: number, durationSec: number, decouplingPct: number) =>
    activity(days(n), {
      id: `long-${String(n)}`,
      durationSec,
      movingSec: durationSec,
      distanceM: 16_000,
      tempC: 14,
      decouplingPct,
    })
  const longs = [longRun(9, 6000, 4), longRun(16, 6100, 5), longRun(23, 5900, 7)]
  const activities = [
    ...marathon.input.activities,
    ...recent,
    ...before,
    ...efforts,
    ...longs,
  ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  // Five check-ins, one of them poor, each with an HRV reading, and twelve earlier readings.
  const checkins = [0, 1, 2, 3, 4].map((n) =>
    wellnessDay(days(n), {
      fatigue: n === 1 ? 5 : 3,
      soreness: 3,
      mood: 3,
      stress: 3,
      sleepQuality: 3,
      hrvRmssd: 60 + (n % 2),
    }),
  )
  const hrv = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((n, i) =>
    wellnessDay(days(n), { hrvRmssd: 58 + (i % 4) }),
  )
  const wellness: Array<WellnessDay & Partial<Checkin>> = [...hrv, ...checkins].sort((a, b) =>
    a.date.localeCompare(b.date),
  )
  const profile = {
    ...marathon.input.profile,
    hrMax: 188,
    hrMaxSource: 'measured' as const,
    thresholdPaceSecPerKm: null,
  }
  return withPlan({ ...marathon.input, profile, activities, wellness })
}

const rich = richInput()
const richCtx = contextOf(rich)

/** A runner with no data at all, and the goal a rule needs. */
function emptyInput(goal: Partial<EngineInput['goal']> = {}): EngineInput {
  return {
    today: TODAY,
    profile: profileOf({
      birthYear: null,
      runningSinceYear: null,
      hrMax: null,
      hrMaxSource: null,
      thresholdPaceSecPerKm: null,
    }),
    activities: [],
    wellness: [],
    reviews: [],
    goal: { ...marathon.input.goal, ...goal },
    forecast: null,
    existing: null,
    options: {},
  }
}

function view(req: ExplainRequest, ctx: ExplainContext): ExplainView {
  return explainInputs(req, ctx)
}

function factsOf(rule: string, ctx: ExplainContext = richCtx): InputFact[] {
  const out = view({ subject: 'rules', rules: [rule] }, ctx)
  return out.groups.find((g) => g.rule === rule)?.facts ?? []
}

const text = (fact: InputFact, units: Units = 'km') => renderFact(fact, units)
const slot = <K extends Quantity['kind']>(fact: InputFact, name: string, kind: K) => {
  const value = fact.slots[name] as Quantity
  expect(value.kind).toBe(kind)
  return value as Extract<Quantity, { kind: K }>
}

// ---------------------------------------------------------------------------------------------
// Exports from the engine
// ---------------------------------------------------------------------------------------------

describe('the extracted athlete-state functions', () => {
  const inputs = [...athletes().map((a) => a.input), rich]

  test('csEffortsOf equals what fitnessOf fits critical speed from', () => {
    for (const input of inputs) {
      const state = estimateState(input)
      const runs = input.activities.filter(
        (a) => a.duplicateStatus !== 'possible' && a.duplicateStatus !== 'confirmed',
      )
      const efforts = csEffortsOf(
        runs.filter((a) => (a.type === 'run' || a.type === 'race') && a.date <= input.today),
        input.today,
      )
      expect(efforts).toHaveLength(state.fitness.csEfforts)
      const fit = criticalSpeed(efforts)
      expect(fit?.csMps ?? null).toBe(state.fitness.csMps)
      expect(fit?.dPrimeM ?? null).toBe(state.fitness.dPrimeM)
    }
    expect(estimateState(rich).fitness.csEfforts).toBe(4)
    expect(estimateState(rich).fitness.csMps!).toBeCloseTo(3.5, 1)
  })

  test('efficiencySamples are the runs the index takes its medians from', () => {
    const { recent, prior } = efficiencySamples(rich.activities, TODAY)
    expect(recent).toHaveLength(4)
    expect(prior).toHaveLength(6)
    const index = efficiencyIndex(rich.activities, TODAY)
    expect(index.samples).toBe(recent.length + prior.length)
    expect(index.current).not.toBeNull()
    expect(index.trendPct).not.toBeNull()
    // the samples carry the run they came from
    for (const sample of recent) expect(sample.activity.id).toMatch(/^steady-/)
    expect(efficiencySamples([], TODAY)).toEqual({ recent: [], prior: [] })
    expect(efficiencyIndex([], TODAY)).toEqual({ current: null, trendPct: null, samples: 0 })
  })

  test('durabilityRuns is the group the durability median is taken from', () => {
    const state = estimateState(rich)
    const group = durabilityRuns(rich.activities.filter((a) => a.type === 'run'))
    expect(group.map((a) => a.id).sort()).toEqual(['long-16', 'long-23', 'long-9'])
    expect(state.durability).toEqual({ decouplingMedianPct: 5, samples: 3 })
  })
})

// ---------------------------------------------------------------------------------------------
// Every fact
// ---------------------------------------------------------------------------------------------

/** Every view the tests below build: the facts must all be well formed. */
function allViews(): ExplainView[] {
  const everyRule = Object.keys(INPUT_BUILDERS)
  const session = rich.existing!.sessions.find((s) => s.kind === 'long')!
  const decision = weeklyDecision(rich, MONDAY, {
    redsFlags: 0,
    ramp: weeklyRamp(estimateState(rich)),
  })
  const ctx = { ...richCtx, decision }
  return [
    view({ subject: 'rules', rules: everyRule }, ctx),
    view({ subject: 'session', id: session.id }, ctx),
    view({ subject: 'week', weekStart: addDays(MONDAY, 7) }, ctx),
    view({ subject: 'decision', weekStart: MONDAY }, ctx),
    view({ subject: 'readiness' }, ctx),
    view({ subject: 'zone' }, ctx),
    view({ subject: 'prediction', goalId: 'x' }, ctx),
    // and a runner with no data: every builder says what it lacks
    view({ subject: 'rules', rules: everyRule }, contextOf(emptyInput())),
  ]
}

describe('facts', () => {
  const views = allViews()
  const facts = views.flatMap((v) => v.groups.flatMap((g) => g.facts))

  test('there are facts to check, used and insufficient', () => {
    expect(facts.length).toBeGreaterThan(80)
    expect(facts.some((f) => f.state === 'used')).toBe(true)
    expect(facts.some((f) => f.state === 'insufficient')).toBe(true)
  })

  test('every fact is data: a registered template, typed slots, no prose', () => {
    for (const fact of facts) {
      expect(Object.hasOwn(TEMPLATES, fact.template), fact.id).toBe(true)
      for (const value of Object.values(fact.slots)) {
        expect(typeof value === 'string' || typeof value === 'object', fact.id).toBe(true)
      }
      expect(['used', 'insufficient']).toContain(fact.state)
      expect(fact.id.length).toBeGreaterThan(2)
    }
  })

  test('every fact renders in both unit systems: clean, short, finished, no raw date', () => {
    for (const fact of facts) {
      for (const units of UNITS) {
        const sentence = text(fact, units)
        expect(lintText(sentence), `${fact.id}: ${sentence}`).toEqual([])
        expect(sentence.length, `${fact.id}: ${sentence}`).toBeLessThanOrEqual(COPY_MAX_CHARS)
        expect(sentence, fact.id).toMatch(/[.?]$/)
        expect(sentence, fact.id).not.toMatch(/\d{4}-\d{2}-\d{2}|NaN|undefined|null|\{|\}/)
      }
    }
  })

  test('every phrase of the word tables reads clean inside its sentence', () => {
    const sentences: Array<[string, string]> = []
    const add = (template: string, slots: InputFact['slots']) => {
      for (const units of UNITS) sentences.push([template, renderFact({ template, slots }, units)])
    }
    for (const sign of Object.values(SIGNAL_WORDS)) add('explain.j5-signal', { sign })
    for (const basis of Object.values(METHOD_WORDS)) add('explain.l1-basis', { basis })
    for (const metric of Object.values(LOAD_METRIC_WORDS)) {
      add('explain.a2-load', {
        acuteDays: { kind: 'count', n: 7 },
        acute: { kind: 'count', n: 120 },
        chronicDays: { kind: 'count', n: 42 },
        chronic: { kind: 'count', n: 100 },
        metric,
      })
    }
    for (const source of Object.values(ANCHOR_WORDS)) {
      add('explain.c2-anchor', {
        anchor: 'heart rate at the line between zones 1 and 2',
        source,
        date: { kind: 'date', iso: TODAY, style: 'weekday' },
      })
    }
    for (const experience of ['novice', 'returning', 'recreational', 'trained']) {
      add('explain.a5-class', { experience })
    }
    expect(sentences.length).toBeGreaterThan(40)
    for (const [template, sentence] of sentences) {
      expect(lintText(sentence), `${template}: ${sentence}`).toEqual([])
      expect(sentence.length, sentence).toBeLessThanOrEqual(COPY_MAX_CHARS)
    }
    // every signal code the weekly decision can emit has a phrase or is handled on its own
    const handled = new Set(['post-race-stage', 'post-race-delayed', 'reds'])
    const adapt = readFileSync(join(process.cwd(), 'shared/engine/adapt.ts'), 'utf8')
    const codes = [...adapt.matchAll(/code: '([a-z-]+)'/g)].map((m) => m[1]!)
    expect(codes.length).toBeGreaterThan(10)
    const unmapped = codes.filter((c) => !handled.has(c) && !Object.hasOwn(SIGNAL_WORDS, c))
    expect(unmapped).toEqual([])
  })

  test('sources are dated, linked by id, newest first and capped, with the rest counted', () => {
    for (const fact of facts) {
      expect(fact.sources.length, fact.id).toBeLessThanOrEqual(EXPLAIN_MAX_SOURCES)
      expect(fact.moreSources, fact.id).toBeGreaterThanOrEqual(0)
      for (const source of fact.sources) {
        expect(isIsoDate(source.date), `${fact.id} ${source.id}`).toBe(true)
        expect(source.id.length, fact.id).toBeGreaterThan(0)
        expect(source.label.length, fact.id).toBeGreaterThan(0)
        if (source.kind === 'activity') expect(source.distanceM).toBeGreaterThan(0)
      }
      const dates = fact.sources.map((s) => s.date)
      expect(dates, fact.id).toEqual([...dates].sort().reverse())
      if (fact.window) {
        expect(isIsoDate(fact.window.from), fact.id).toBe(true)
        expect(isIsoDate(fact.window.to), fact.id).toBe(true)
        expect(fact.window.from <= fact.window.to, fact.id).toBe(true)
      }
    }
  })

  test('fact ids are unique inside a group and name their rule', () => {
    for (const v of views) {
      for (const group of v.groups) {
        const ids = group.facts.map((f) => f.id)
        expect(new Set(ids).size, group.rule).toBe(ids.length)
        for (const fact of group.facts) {
          expect(fact.id.startsWith(`${fact.rule.toLowerCase()}.`), fact.id).toBe(true)
          expect(fact.rule.toLowerCase(), fact.id).toBe(group.rule.toLowerCase())
        }
      }
    }
  })

  test('a window cap shows the newest sources and counts the rest', () => {
    const [load] = factsOf('A2')
    expect(load!.sources).toHaveLength(EXPLAIN_MAX_SOURCES)
    expect(load!.moreSources).toBeGreaterThan(0)
    const newest = [...rich.activities]
      .filter((a) => a.date >= addDays(TODAY, -(P.a2.chronicDays.value - 1)))
      .sort((a, b) => b.date.localeCompare(a.date))[0]!
    expect(load!.sources[0]!.date).toBe(newest.date)
  })
})

describe('determinism', () => {
  test('the same context gives the same facts', () => {
    const rules = Object.keys(INPUT_BUILDERS)
    const a = view({ subject: 'rules', rules }, richCtx)
    const b = view({ subject: 'rules', rules }, richCtx)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test('a frozen context is read without being changed', () => {
    const frozen = deepFreeze(structuredClone(richCtx))
    const rules = Object.keys(INPUT_BUILDERS)
    expect(() => view({ subject: 'rules', rules }, frozen)).not.toThrow()
    const session = frozen.input.existing!.sessions.find((s) => s.kind === 'long')!
    expect(() => view({ subject: 'session', id: session.id }, frozen)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------------------------
// The figures, rule by rule
// ---------------------------------------------------------------------------------------------

describe('A3 and g-1: the longest recent run', () => {
  test('names the longest run of the last 30 days with its date, link and distance', () => {
    const state = estimateState(rich)
    const [distance, duration] = factsOf('A3')
    expect(distance!.template).toBe('explain.longest-distance')
    expect(slot(distance!, 'distance', 'distance').m).toBe(state.longest30d.distanceM)
    expect(slot(distance!, 'days', 'count').n).toBe(P.a3.longestRunWindowDays.value)
    const run = rich.activities.find((a) => a.id === distance!.sources[0]!.id)!
    expect(run.distanceM).toBe(state.longest30d.distanceM)
    expect(slot(distance!, 'date', 'date').iso).toBe(run.date)
    expect(distance!.sources).toEqual([
      { kind: 'activity', id: run.id, date: run.date, label: 'Run', distanceM: run.distanceM },
    ])
    expect(duration!.template).toBe('explain.longest-duration')
    expect(slot(duration!, 'duration', 'duration').sec).toBe(state.longest30d.durationSec)
    expect(distance!.window).toEqual({ from: addDays(TODAY, -29), to: TODAY })
  })

  test('g-1 adds the limits from the guard and the session against the longest run', () => {
    const longest = estimateState(rich).longest30d.distanceM
    const session = rich.existing!.sessions.find((s) => s.kind === 'long')!
    const group = view({ subject: 'session', id: session.id }, richCtx).groups.find(
      (g) => g.rule === 'g-1',
    )!
    const byName = (name: string): InputFact => group.facts.find((f) => f.id === `g-1.${name}`)!
    expect(slot(byName('warn'), 'limit', 'distance').m).toBe(
      spikeWarnLimit(longest, P.g1.minStepDistanceM.value),
    )
    expect(slot(byName('override'), 'limit', 'distance').m).toBe(
      spikeOverrideLimit(longest, P.g1.minStepDistanceM.value),
    )
    // the limits restate P.g1: 10% above the longest run, or the minimum step on a short run
    expect(slot(byName('warn'), 'limit', 'distance').m).toBeCloseTo(
      longest + Math.max(longest * (P.g1.spikeRatioWarn.value - 1), P.g1.minStepDistanceM.value),
      6,
    )
    expect(slot(byName('override'), 'limit', 'distance').m).toBeCloseTo(
      Math.max(longest * P.g1.spikeRatioOverride.value, spikeWarnLimit(longest, 500)),
      6,
    )
    const ratio = slot(byName('session'), 'share', 'share').fraction
    expect(ratio).toBeCloseTo(session.distanceM! / longest, 2)
    expect(byName('session').sources[0]).toMatchObject({ kind: 'session', id: session.id })
  })

  test('says what it needs when no run was completed in the window', () => {
    const [fact] = factsOf('g-1', contextOf(emptyInput()))
    expect(fact).toMatchObject({ state: 'insufficient', template: 'explain.longest-gap' })
    expect(text(fact!)).toBe(
      `No completed run in the last ${String(P.a3.longestRunWindowDays.value)} days, so there is no longest run to compare a new run with.`,
    )
  })
})

describe('g-2 and g-6: the ramp and lost volume', () => {
  const week = (weekStart: string, targetRunMin: number, flags: string[] = []) => ({
    weekStart,
    index: 0,
    phase: 'build' as const,
    focus: 'Build',
    targetRunMin,
    longRunMin: 90,
    longRunM: null,
    gainTargetM: null,
    runDays: 3,
    qualitySessions: 0,
    strengthSessions: 0,
    tid: { z1: 80, z2: 10, z3: 10 },
    flags,
    isRecovery: false,
    isTaper: false,
  })

  /**
   * A week of 240 planned minutes of which 212 were run, and the week after it. `ranMin` and
   * `plannedMin` give the minutes of the three runs and of the three sessions planned for them.
   */
  function lostWeekCtx(
    overProfile: Partial<AthleteProfile> = {},
    ranMin: [number, number, number] = [70, 62, 80],
    plannedMin: [number, number, number] = [80, 80, 80],
  ): ExplainContext {
    const input: EngineInput = {
      ...emptyInput(),
      profile: profileOf(overProfile),
      activities: [
        activity('2026-10-13', { id: 'a1', durationSec: ranMin[0] * 60, distanceM: 10_000 }),
        activity('2026-10-15', { id: 'a2', durationSec: ranMin[1] * 60, distanceM: 9000 }),
        activity('2026-10-17', { id: 'a3', durationSec: ranMin[2] * 60, distanceM: 12_000 }),
      ],
      existing: {
        weeks: [
          week('2026-10-12', plannedMin[0] + plannedMin[1] + plannedMin[2]),
          week(MONDAY, 250),
        ],
        sessions: [
          planned('p1', '2026-10-13', 'easy', { durationMin: plannedMin[0] }),
          planned('p2', '2026-10-15', 'easy', { durationMin: plannedMin[1] }),
          planned('p3', '2026-10-17', 'long', { durationMin: plannedMin[2] }),
        ],
      },
    }
    return contextOf(input)
  }

  /** The J5 and g-6 facts for the week of 12 Oct, with the decision the engine makes about it. */
  function decisionView(ctx: ExplainContext) {
    const decision = weeklyDecision(ctx.input, '2026-10-12', {
      redsFlags: 0,
      ramp: weeklyRamp(ctx.state),
    })
    const groups = view(
      { subject: 'decision', weekStart: '2026-10-12' },
      { ...ctx, decision },
    ).groups
    const factsOfRule = (rule: string) => groups.find((g) => g.rule === rule)!.facts
    return { decision, j5: factsOfRule('J5'), g6: factsOfRule('g-6') }
  }

  test('g-2 gives last week, the ramp and the plan for the week it leads to', () => {
    const ctx = lostWeekCtx()
    const facts = factsOf('g-2', ctx)
    expect(facts.map((f) => f.template)).toEqual([
      'explain.g2-last-week',
      'explain.g2-ramp',
      'explain.g2-plan-week',
    ])
    expect(text(facts[0]!)).toBe('Running time in the week of 12 Oct was 212 min.')
    expect(facts[0]!.sources.map((s) => s.id).sort()).toEqual(['a1', 'a2', 'a3'])
    expect(facts[0]!.window).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(text(facts[1]!)).toBe(
      `The plan adds at most ${String(P.g2.rampSoft.value * 100)}% to a week of running.`,
    )
    expect(text(facts[2]!)).toBe('The plan sets the week of 19 Oct at up to 250 min.')
  })

  test('the ramp is the tightened one of an injury profile', () => {
    const ctx = lostWeekCtx({ injuries: [{ kind: 'bone-stress', year: 2026, month: 8 } as never] })
    const [, ramp] = factsOf('g-2', ctx)
    expect(slot(ramp!, 'pct', 'percent').pct).toBeCloseTo(weeklyRamp(ctx.state) * 100, 9)
    expect(slot(ramp!, 'pct', 'percent').pct).toBeLessThan(P.g2.rampSoft.value * 100)
  })

  test('g-6 compares last week with its plan and caps the next week', () => {
    const ctx = lostWeekCtx()
    const [completion, cap] = factsOf('g-6', ctx)
    expect(text(completion!)).toBe('In the week of 12 Oct you ran 212 min of 240 min planned.')
    // min(250 planned, 212 run x 1.10) = 233
    expect(text(cap!)).toBe(
      `The week of 19 Oct is capped at 233 min: the lower of the plan and the week before plus ${String(P.g2.rampSoft.value * 100)}%.`,
    )
  })

  test('g-6 and J5 give the next week as the same whole minutes the decision gives', () => {
    // 175 min run x 1.10 is 192.5 (192.50000000000003 in floating point). The decision rounds
    // down so the number never passes the cap, and the stored 250 is above that ceiling.
    const ctx = lostWeekCtx({}, [70, 45, 60], [70, 70, 60])
    const { decision, j5, g6 } = decisionView(ctx)
    expect(decision.decision).toBe('progress')
    expect(decision.nextWeekTargetMin).toBe(192)
    expect(slot(j5[0]!, 'minutes', 'minutes').min).toBe(192)
    const cap = g6.find((f) => f.id === 'g-6.cap')!
    expect(slot(cap, 'minutes', 'minutes').min).toBe(192)
    expect(text(cap)).toContain('capped at 192 min')
    expect(text(j5[0]!)).toContain('up to 192 min')
  })

  test('g-6 and J5 cap a week run past its target from the minutes it was planned at', () => {
    // The week of 19 Oct was planned at 200 min and stored at the 250 min already run in it
    // (flags overshoot and planned-200). The decision draws the next week from the plan, so the
    // overshoot lifts nothing: min(200 planned, 212 run x 1.10 = 233) is 200, not 233.
    const base = lostWeekCtx()
    const input: EngineInput = {
      ...base.input,
      existing: {
        ...base.input.existing!,
        weeks: [base.input.existing!.weeks[0]!, week(MONDAY, 250, ['overshoot', 'planned-200'])],
      },
    }
    const { decision, j5, g6 } = decisionView(contextOf(input))
    expect(decision.decision).toBe('progress')
    expect(decision.nextWeekTargetMin).toBe(200)
    expect(slot(j5[0]!, 'minutes', 'minutes').min).toBe(200)
    const cap = g6.find((f) => f.id === 'g-6.cap')!
    expect(slot(cap, 'minutes', 'minutes').min).toBe(200)
  })

  test('g-6 and J5 count the run minutes the decision counted, not the credited ones', () => {
    // A ladder week of three 21-minute sessions; one was run, and the recording carries the two
    // 5-minute walks, so 31 min were run. The start paths credit 21 min of it, the decision 31.
    const base = emptyInput()
    const ladderWeek = week('2026-10-12', 63, ['ladder-1'])
    const input: EngineInput = {
      ...base,
      profile: profileOf({}),
      activities: [
        activity('2026-10-13', { id: 'walks', durationSec: 31 * 60, distanceM: 4800, pain: 0 }),
      ],
      existing: {
        weeks: [ladderWeek, week(MONDAY, 70)],
        sessions: [
          planned('l1', '2026-10-13', 'easy', {
            durationMin: 21,
            activityId: 'walks',
            status: 'completed',
          }),
          planned('l2', '2026-10-15', 'easy', { durationMin: 21 }),
          planned('l3', '2026-10-17', 'easy', { durationMin: 21 }),
        ],
      },
    }
    expect(weekEvidence(input, '2026-10-12').actualMin).toBe(21)
    const { decision, j5, g6 } = decisionView(contextOf(input))
    const signal = decision.signals.find((s) => s.code === 'completion-low')!
    expect(signal.detail).toContain('31 of 63 planned minutes were run')
    const completion = g6.find((f) => f.id === 'g-6.completion')!
    expect(text(completion)).toBe('In the week of 12 Oct you ran 31 min of 63 min planned.')
    const shortfall = j5.find((f) => f.template === 'explain.j5-completion')!
    expect(slot(shortfall, 'actual', 'minutes').min).toBe(31)
    expect(slot(shortfall, 'planned', 'minutes').min).toBe(63)
  })

  test('both say what they need when there is nothing to build from', () => {
    const empty = contextOf(emptyInput())
    const [ramp] = factsOf('g-2', empty)
    expect(ramp).toMatchObject({ state: 'insufficient', template: 'explain.g2-gap' })
    const [lost] = factsOf('g-6', empty)
    expect(lost).toMatchObject({ state: 'insufficient', template: 'explain.g6-gap' })
  })
})

describe('A2, A5, A6, A7, A8: the athlete state', () => {
  test('A2 reports the load the state holds, in its own metric', () => {
    const [fact] = factsOf('A2')
    const state = estimateState(rich)
    expect(slot(fact!, 'acute', 'count').n).toBe(Math.round(state.load.acute))
    expect(slot(fact!, 'chronic', 'count').n).toBe(Math.round(state.load.chronic))
    expect(slot(fact!, 'acuteDays', 'count').n).toBe(P.a2.acuteDays.value)
    expect(slot(fact!, 'chronicDays', 'count').n).toBe(P.a2.chronicDays.value)
    expect(fact!.slots['metric']).toEqual(expect.any(String))
  })

  test('A5 names the class and what it rests on', () => {
    const facts = factsOf('A5')
    expect(facts[0]).toMatchObject({ template: 'explain.a5-class' })
    expect(facts[0]!.slots['experience']).toBe(estimateState(rich).experience)
    expect(facts.map((f) => f.template)).toEqual([
      'explain.a5-class',
      'explain.last-run',
      'explain.a5-weeks',
      'explain.a5-years',
    ])
    expect(facts.every((f) => f.state === 'used')).toBe(true)
  })

  test('A6 gives critical speed with the efforts it was fitted from', () => {
    const [fact] = factsOf('A6')
    expect(fact!.template).toBe('explain.a6-cs')
    const cs = estimateState(rich).fitness.csMps!
    expect(slot(fact!, 'speed', 'speed').kmh).toBeCloseTo(cs * 3.6, 9)
    expect(slot(fact!, 'pace', 'pace').secPerKm).toBeCloseTo(1000 / cs, 9)
    expect(slot(fact!, 'n', 'count').n).toBe(4)
    expect(fact!.sources.map((s) => s.id).sort()).toEqual([
      'effort-1500',
      'effort-3000',
      'effort-5000',
      'effort-800',
    ])
    expect(text(fact!, 'km')).toMatch(/12\.\d km\/h/)
    expect(text(fact!, 'mi')).toContain('mph')
  })

  test('A6 says what it needs and what it found, in the runner’s words', () => {
    const two = {
      ...rich,
      activities: rich.activities.filter((a) => a.id !== 'effort-3000' && a.id !== 'effort-5000'),
    }
    const [fact] = factsOf('A6', contextOf(two))
    expect(fact).toMatchObject({ state: 'insufficient', template: 'explain.cs-gap' })
    expect(text(fact!, 'km')).toBe(
      'Critical speed needs 3 efforts between 400 m and 5 km in the last 90 days; 2 found. Zones use heart rate and effort until then.',
    )
    expect(text(fact!, 'mi')).toContain('between 0.25 mi and 3.1 mi')
    expect(fact!.sources).toHaveLength(2)
  })

  test('A6 tells efforts that are too close in length from too few efforts', () => {
    const effort = (id: string, distanceM: number, timeSec: number, ago: number) =>
      activity(addDays(TODAY, -ago), {
        id,
        distanceM,
        durationSec: timeSec,
        movingSec: timeSec,
        elevationGainM: 0,
      })
    // three efforts in one distance band count as one effort
    const sameBand = [
      effort('b1', 3000, 800, 20),
      effort('b2', 3050, 805, 21),
      effort('b3', 3100, 810, 22),
    ]
    const [few] = factsOf('A6', contextOf({ ...emptyInput(), activities: sameBand }))
    expect(few!.template).toBe('explain.cs-gap')
    expect(slot(few!, 'found', 'count').n).toBe(1)
    // three bands, but the times differ by less than the factor the fit needs
    const close = [
      effort('c1', 900, 300, 20),
      effort('c2', 1900, 330, 21),
      effort('c3', 2900, 360, 22),
    ]
    const [spread] = factsOf('A6', contextOf({ ...emptyInput(), activities: close }))
    expect(spread).toMatchObject({ state: 'insufficient', template: 'explain.cs-spread-gap' })
    expect(slot(spread!, 'found', 'count').n).toBe(3)
    expect(slot(spread!, 'ratio', 'count').n).toBe(P.a6.csMinTimeSpreadRatio.value)
    expect(text(spread!)).toBe(
      'The 3 efforts found are too close in length to fit critical speed; they need to differ by a factor of 2.',
    )
  })

  test('A7 gives the median drift of the comparable long runs, with the runs', () => {
    const [fact] = factsOf('A7')
    expect(fact!.template).toBe('explain.a7-drift')
    expect(slot(fact!, 'pct', 'percent').pct).toBe(5)
    expect(slot(fact!, 'n', 'count').n).toBe(3)
    expect(fact!.sources.map((s) => s.id).sort()).toEqual(['long-16', 'long-23', 'long-9'])
  })

  test('A7 counts what it found against what it needs', () => {
    const one = {
      ...rich,
      activities: rich.activities.filter((a) => a.id !== 'long-16' && a.id !== 'long-23'),
    }
    const [fact] = factsOf('A7', contextOf(one))
    expect(fact).toMatchObject({ state: 'insufficient', template: 'explain.a7-gap' })
    expect(slot(fact!, 'need', 'count').n).toBe(P.a7.minComparableRuns.value)
    expect(slot(fact!, 'found', 'count').n).toBe(1)
    expect(slot(fact!, 'temp', 'temp').c).toBe(P.a7.heatExcludeC.value)
  })

  test('A8 gives the change in efficiency, the runs and the heart rate at easy pace', () => {
    const facts = factsOf('A8')
    expect(facts.map((f) => f.template)).toEqual(['explain.a8-up', 'explain.a8-hr-model'])
    const state = estimateState(rich)
    expect(slot(facts[0]!, 'pct', 'percent').pct).toBeCloseTo(state.efficiency.trendPct!, 9)
    expect(facts[0]!.sources).toHaveLength(4)
    const model = richCtx.hrModel!
    expect(slot(facts[1]!, 'n', 'count').n).toBe(model.runs)
    const mps = 1000 / richCtx.zones.lt1PaceSecPerKm!.value
    expect(slot(facts[1]!, 'bpm', 'bpm').bpm).toBe(
      Math.round(model.interceptBpm + model.slopeBpmPerMps * mps),
    )
  })

  test('A8 turns to "less ground per heartbeat" when efficiency falls', () => {
    const slower = {
      ...rich,
      activities: rich.activities.map((a) =>
        a.id.startsWith('steady-') && a.date >= addDays(TODAY, -28)
          ? { ...a, distanceM: a.distanceM! * 0.8, gapDistanceM: a.gapDistanceM! * 0.8 }
          : a,
      ),
    }
    const [fact] = factsOf('A8', contextOf(slower))
    expect(fact!.template).toBe('explain.a8-down')
    expect(slot(fact!, 'pct', 'percent').pct).toBeGreaterThan(0)
  })

  test('A8 counts the runs of each window against what it needs', () => {
    const [fact] = factsOf('A8', contextOf(emptyInput()))
    expect(fact).toMatchObject({ state: 'insufficient', template: 'explain.a8-gap' })
    expect(slot(fact!, 'need', 'count').n).toBe(P.a8.minRunsPerWindow.value)
    expect(slot(fact!, 'recent', 'count').n).toBe(0)
  })
})

describe('C1 to C5: zones', () => {
  test('C1 session targets are the ones resolveTargets gives, for every mode a plan has', () => {
    // The fitted pace gives every threshold session a pace; a threshold session stored without
    // one (a runner with no pace anchor yet) is read by its heart-rate band.
    const threshold = rich.existing!.sessions.find((s) => s.kind === 'threshold')!
    const bandSession = {
      ...threshold,
      id: 'band',
      target: { ...threshold.target, paceSecPerKm: null },
    }
    const sessions = [...rich.existing!.sessions, bandSession]
    const ctx = contextOf({ ...rich, existing: { ...rich.existing!, sessions } })
    const modes = new Set<string>()
    for (const session of sessions) {
      const group = view({ subject: 'session', id: session.id }, ctx).groups.find(
        (g) => g.rule === 'C1',
      )
      const t = resolveTargets(session, ctx.zones, { hot: false })
      if (group === undefined) {
        // only the kinds that count toward weekly running are read against the zones
        expect(VOLUME_KINDS.has(session.kind), session.kind).toBe(false)
        continue
      }
      modes.add(t.mode)
      const target = group.facts.find((f) => f.id === 'c1.target')!
      switch (t.mode) {
        case 'hr-ceiling':
          expect(target.template).toBe('explain.c1-target-ceiling')
          expect(slot(target, 'bpm', 'bpm').bpm).toBe(Math.round(t.hrCeiling!))
          break
        case 'hr-band':
          expect(target.template).toBe('explain.c1-target-band')
          expect(slot(target, 'low', 'bpm').bpm).toBe(Math.round(t.hrRange![0]))
          expect(slot(target, 'high', 'bpm').bpm).toBe(Math.round(t.hrRange![1]))
          expect(slot(target, 'zone', 'count').n).toBe(2)
          expect(text(target)).toBe(
            `This session targets a heart rate of ${String(Math.round(t.hrRange![0]))} bpm to ${String(Math.round(t.hrRange![1]))} bpm, your zone 2.`,
          )
          break
        case 'pace':
          expect(target.template).toBe('explain.c1-target-pace')
          expect(slot(target, 'slow', 'pace').secPerKm).toBe(t.paceSecPerKm![0])
          expect(slot(target, 'fast', 'pace').secPerKm).toBe(t.paceSecPerKm![1])
          break
        case 'effort':
          expect(target.template).toBe('explain.c1-target-effort')
          expect(slot(target, 'low', 'count').n).toBe(t.rpe[0])
          expect(slot(target, 'high', 'count').n).toBe(t.rpe[1])
          break
      }
      if (t.mode !== 'effort') {
        const rpe = group.facts.find((f) => f.id === 'c1.rpe')!
        expect(slot(rpe, 'low', 'count').n).toBe(t.rpe[0])
      }
      if (t.mode !== 'effort' && t.mode !== 'pace' && t.paceSecPerKm !== null) {
        const guide = group.facts.find((f) => f.id === 'c1.pace-guide')!
        expect(slot(guide, 'slow', 'pace').secPerKm).toBe(t.paceSecPerKm[0])
        expect(slot(guide, 'fast', 'pace').secPerKm).toBe(t.paceSecPerKm[1])
      }
    }
    // every mode the target builder has a branch for occurs in the fixtures, so none goes unchecked
    expect([...modes].sort()).toEqual(['effort', 'hr-band', 'hr-ceiling', 'pace'])
    expect(resolveTargets(bandSession, ctx.zones, { hot: false }).mode).toBe('hr-band')
  })

  test('C1 uses the current zones when they changed after the session was planned', () => {
    const session = { ...rich.existing!.sessions.find((s) => s.kind === 'easy')!, id: 'old' }
    session.target = { ...session.target, hr: [100, 110] }
    const input = { ...rich, existing: { ...rich.existing!, sessions: [session] } }
    const ctx = contextOf(input)
    const group = view({ subject: 'session', id: 'old' }, ctx).groups.find((g) => g.rule === 'C1')!
    const target = group.facts.find((f) => f.id === 'c1.target')!
    expect(slot(target, 'bpm', 'bpm').bpm).toBe(ctx.zones.hr!.z1[1])
  })

  test('C1 gives the tops of the three zones and says what it lacks without a maximum', () => {
    const [zones] = factsOf('C1').filter((f) => f.id === 'c1.zones-hr')
    const hr = richCtx.zones.hr!
    expect(slot(zones!, 'z1', 'bpm').bpm).toBe(hr.z1[1])
    expect(slot(zones!, 'z2', 'bpm').bpm).toBe(hr.z2[1])
    expect(slot(zones!, 'z3', 'bpm').bpm).toBe(hr.z3[1])
    const [gap] = factsOf('C1', contextOf(emptyInput()))
    expect(gap).toMatchObject({ state: 'insufficient', template: 'explain.c1-gap' })
  })

  test('C2 gives the source of each anchor with its date and link', () => {
    const facts = factsOf('C2')
    expect(facts.map((f) => f.id)).toEqual([
      'c2.hrmax',
      'c2.lt1-hr',
      'c2.lt1-pace',
      'c2.threshold-pace',
      'c2.cs',
    ])
    expect(facts[0]!.slots).toMatchObject({
      anchor: 'maximum heart rate',
      source: 'a measured maximum heart rate',
    })
    expect(facts[0]!.sources[0]).toMatchObject({ kind: 'profile' })
    const cs = facts.find((f) => f.id === 'c2.cs')!
    expect(cs.sources.every((s) => s.kind === 'activity')).toBe(true)
    expect(cs.sources).toHaveLength(4)
    const [gap] = factsOf('C2', contextOf(emptyInput()))
    expect(gap).toMatchObject({ state: 'insufficient', template: 'explain.c2-gap' })
  })

  test('C2 never explains an anchor by itself, for the anchors and sources that can occur', () => {
    // maximum heart rate measured, entered, from age and a lactate-threshold heart rate; threshold
    // pace from the profile or from critical speed; each with and without critical speed fitted
    const profiles: Array<Partial<AthleteProfile>> = [
      {},
      { hrMaxSource: 'estimated' },
      { hrMax: null, hrMaxSource: null },
      { lthr: 165 },
      { thresholdPaceSecPerKm: 270 },
    ]
    const sourcesSeen = new Set<string>()
    for (const base of [rich, marathon.input]) {
      for (const over of profiles) {
        const ctx = contextOf({ ...base, profile: { ...base.profile, ...over } })
        for (const fact of factsOf('C2', ctx)) {
          if (typeof fact.slots['source'] === 'string') sourcesSeen.add(fact.slots['source'])
          for (const units of UNITS) {
            const sentence = text(fact, units)
            expect(lintText(sentence), `${fact.id}: ${sentence}`).toEqual([])
            // "Your X comes from X": the source word must say something the anchor does not
            expect(sentence, fact.id).not.toMatch(/^Your (.+) comes from (?:your |an? )?\1\b/)
          }
        }
      }
    }
    // the pairs that were rendered cover every source a boundary can carry
    expect([...sourcesSeen].sort()).toEqual(
      [
        ANCHOR_WORDS['hrmax-observed'],
        ANCHOR_WORDS['hrmax-age'],
        ANCHOR_WORDS.profile,
        ANCHOR_WORDS.cs,
      ].sort(),
    )
    // critical speed itself is fitted from efforts: it has its own sentence, with the efforts linked
    const cs = factsOf('C2').find((f) => f.id === 'c2.cs')!
    expect(cs.template).toBe('explain.c2-cs')
    expect(text(cs)).toBe(
      `Your critical speed is fitted from your recent efforts, as of Wed 21 Oct.`,
    )
    expect(cs.sources.every((source) => source.kind === 'activity')).toBe(true)
  })

  test('C3 tells a measured maximum from the age estimate and gives the band from P', () => {
    const [measured] = factsOf('C3')
    expect(measured!.template).toBe('explain.c3-measured')
    expect(slot(measured!, 'bpm', 'bpm').bpm).toBe(richCtx.zones.hrMax!.value)
    const byAge = contextOf({
      ...rich,
      profile: { ...rich.profile, hrMax: null, hrMaxSource: null },
    })
    const [estimate] = factsOf('C3', byAge)
    expect(estimate!.template).toBe('explain.c3-age')
    expect(slot(estimate!, 'band', 'bpm').bpm).toBe(Math.round(P.c3.priorBandBpm.value))
    expect(text(estimate!)).toContain('give or take 11 bpm')
    const entered = contextOf({ ...rich, profile: { ...rich.profile, hrMaxSource: 'estimated' } })
    expect(factsOf('C3', entered)[0]!.template).toBe('explain.c3-profile')
    const [gap] = factsOf('C3', contextOf(emptyInput()))
    expect(gap).toMatchObject({ state: 'insufficient', template: 'explain.c3-gap' })
  })

  test('C4 gives the pace line at the share of critical speed from P, and the heart rate', () => {
    const facts = factsOf('C4')
    expect(facts.map((f) => f.template)).toEqual(['explain.c4-cs', 'explain.c4-hr'])
    expect(slot(facts[0]!, 'share', 'share').fraction).toBe(P.c4.lt1CsFraction.value)
    expect(text(facts[0]!)).toContain('82.3% of your critical speed')
    expect(slot(facts[0]!, 'pace', 'pace').secPerKm).toBe(richCtx.zones.lt1PaceSecPerKm!.value)
    expect(slot(facts[1]!, 'bpm', 'bpm').bpm).toBe(richCtx.zones.lt1Hr!.value)
  })

  test('C4 and C5 say what critical speed needs, or that a break cleared the anchors', () => {
    const noCs = { ...rich, activities: rich.activities.filter((a) => !a.id.startsWith('effort-')) }
    const noProfileThreshold = {
      ...noCs,
      profile: { ...noCs.profile, thresholdPaceSecPerKm: null },
    }
    const ctx = contextOf(noProfileThreshold)
    for (const rule of ['C4', 'C5']) {
      const [fact] = factsOf(rule, ctx)
      expect(fact, rule).toMatchObject({ state: 'insufficient', template: 'explain.cs-gap' })
    }
    // the same runner after a break of two weeks: the anchors are cleared, not missing
    const broke = {
      ...rich,
      activities: rich.activities.filter(
        (a) => a.date <= addDays(TODAY, -P.c8.breakDays.value - 1),
      ),
    }
    for (const rule of ['C4', 'C5']) {
      const [fact] = factsOf(rule, contextOf(broke))
      expect(fact!.template, rule).toBe('explain.c-break-gap')
      expect(slot(fact!, 'days', 'count').n).toBe(P.c8.breakDays.value)
    }
  })

  test('C5 gives threshold pace and the margin under critical speed from P', () => {
    const noProfile = contextOf({
      ...rich,
      profile: { ...rich.profile, thresholdPaceSecPerKm: null },
    })
    const [fact] = factsOf('C5', noProfile)
    expect(fact!.template).toBe('explain.c5-cs')
    expect(slot(fact!, 'pace', 'pace').secPerKm).toBe(noProfile.zones.thresholdPaceSecPerKm!.value)
    const margin =
      noProfile.state.experience === 'trained'
        ? P.c5.thresholdMarginWellTrainedKmh.value
        : P.c5.thresholdMarginOtherKmh.value
    expect(slot(fact!, 'margin', 'speed').kmh).toBe(margin)
    const withProfile = contextOf({
      ...rich,
      profile: { ...rich.profile, thresholdPaceSecPerKm: 300 },
    })
    expect(factsOf('C5', withProfile)[0]!.template).toBe('explain.c5-profile')
  })
})

describe('J2 to J5 and J7: readiness, the decision and breaks', () => {
  test('J2 counts the check-ins of the last 7 days and the low ones, with the days', () => {
    const [count, low] = factsOf('J2')
    expect(slot(count!, 'n', 'count').n).toBe(5)
    expect(slot(count!, 'days', 'count').n).toBe(7)
    expect(count!.sources.map((s) => s.kind)).toEqual(Array(5).fill('check-in'))
    expect(count!.sources.map((s) => s.date)).toEqual(
      [0, 1, 2, 3, 4].map((n) => addDays(TODAY, -n)),
    )
    expect(low).toMatchObject({ template: 'explain.j2-low' })
    expect(slot(low!, 'n', 'count').n).toBe(1)
    const [gap] = factsOf('J2', contextOf(emptyInput()))
    expect(text(gap!)).toBe(
      'No check-in in the last 7 days. Readiness leans on other signals until one is added.',
    )
  })

  test('J3 gives the state of readiness, and the days from P for a long low spell', () => {
    const [normal] = factsOf('J3')
    expect(richCtx.readiness.state).toBe('normal')
    expect(normal!.template).toBe('explain.j3-normal')
    expect(normal!.sources).toEqual([
      { kind: 'check-in', id: TODAY, date: TODAY, label: 'Check-in' },
    ])
    const suppressed = contextOf(rich, {
      readiness: { ...richCtx.readiness, state: 'persistent-suppression' },
    })
    const [fact] = factsOf('J3', suppressed)
    expect(fact!.template).toBe('explain.j3-suppression')
    expect(slot(fact!, 'days', 'count').n).toBe(P.j8.deloadSuggestDays.value)
    const fatigued = contextOf(rich, {
      readiness: { ...richCtx.readiness, state: 'possible-fatigue' },
    })
    expect(factsOf('J3', fatigued)[0]!.template).toBe('explain.j3-fatigue')
    expect(text(factsOf('J3', fatigued)[0]!)).toContain('never harder')
    const [gap] = factsOf('J3', contextOf(emptyInput()))
    expect(gap).toMatchObject({ state: 'insufficient', template: 'explain.j3-gap' })
  })

  test('J4 shows the HRV reading in milliseconds against the usual range, as Today does', () => {
    const [fact] = factsOf('J4')
    const hrv = richCtx.readiness.hrv
    expect(hrv.flag).toBe(false)
    expect(fact!.template).toBe('today.signal.hrv')
    expect(slot(fact!, 'latest', 'count').n).toBe(Math.round(Math.exp(hrv.latest!)))
    expect(fact!.sources[0]).toMatchObject({ kind: 'wellness', date: TODAY })
  })

  test('J4 reads a low HRV with the sentence Today uses for it', () => {
    const low = contextOf(rich, {
      readiness: {
        ...richCtx.readiness,
        hrv: { ...richCtx.readiness.hrv, flag: true },
      },
    })
    const [fact] = factsOf('J4', low)
    expect(fact!.template).toBe('today.signal.hrv-low')
    expect(text(fact!)).toMatch(/^HRV has dropped to \d+ ms\. Your usual range is \d+ to \d+ ms\.$/)
  })

  test('J4 counts readings against what it needs, and notes a missing reading today', () => {
    const [gap] = factsOf('J4', contextOf(emptyInput()))
    expect(gap).toMatchObject({ state: 'insufficient', template: 'explain.j4-gap' })
    expect(slot(gap!, 'need', 'count').n).toBe(P.j4.minReadings.value)
    expect(slot(gap!, 'found', 'count').n).toBe(0)
    const noToday = contextOf({
      ...rich,
      wellness: rich.wellness.filter((w) => w.date !== TODAY),
    })
    const withBaseline = factsOf('J4', noToday)
    expect(withBaseline[0]!.template).toBe('explain.j4-today-gap')
  })

  test('J4 counts the earlier readings the engine tests, never the one taken today', () => {
    const need = P.j4.minReadings.value
    const days = P.j4.lookbackDays.value
    const readingsInput = (priorCount: number, over: Partial<AthleteProfile> = {}) => {
      const base = emptyInput()
      const wellness = [
        ...hrvSeries(TODAY, STEADY_HRV.slice(0, priorCount)),
        wellnessDay(TODAY, { hrvRmssd: 60 }),
      ]
      return { ...base, profile: { ...base.profile, ...over }, wellness }
    }
    for (const priorCount of [0, 5, need - 1]) {
      const ctx = contextOf(readingsInput(priorCount))
      // today's reading is in the snapshot's own count but not in the figure the sentence gives
      expect(ctx.readiness.hrv.readings).toBe(priorCount + 1)
      const [gap] = factsOf('J4', ctx)
      expect(gap).toMatchObject({ state: 'insufficient', template: 'explain.j4-gap' })
      expect(slot(gap!, 'need', 'count').n).toBe(need)
      expect(slot(gap!, 'days', 'count').n).toBe(days)
      expect(slot(gap!, 'found', 'count').n).toBe(priorCount)
      expect(text(gap!)).toContain(
        `HRV needs ${String(need)} readings in the last ${String(days)} days; ${String(priorCount)} found.`,
      )
    }
    // one more earlier reading and the range exists: no gap, even with today's reading counted once
    const enough = factsOf('J4', contextOf(readingsInput(need)))
    expect(enough[0]!.template).toBe('today.signal.hrv')
  })

  test('J4 reads a female profile over the cycle-aware lookback', () => {
    const need = P.j4.minReadings.value
    const cycleDays = P.j4.cycleBaselineDays.value
    expect(cycleDays).toBeGreaterThan(P.j4.lookbackDays.value)
    const base = emptyInput()
    // ten readings from 25 to 34 days back: outside the 21-day lookback, inside the cycle one
    const older = STEADY_HRV.map((hrvRmssd, i) =>
      wellnessDay(addDays(TODAY, -(25 + i)), { hrvRmssd }),
    )
    const wellness = [...older, wellnessDay(TODAY, { hrvRmssd: 60 })]
    const withSex = (sex: AthleteProfile['sex']) =>
      contextOf({ ...base, profile: { ...base.profile, sex }, wellness })

    const [female] = factsOf('J4', withSex('female'))
    expect(female!.template).toBe('today.signal.hrv')

    const [male] = factsOf('J4', withSex('male'))
    expect(male).toMatchObject({ state: 'insufficient', template: 'explain.j4-gap' })
    expect(slot(male!, 'days', 'count').n).toBe(P.j4.lookbackDays.value)
    expect(slot(male!, 'found', 'count').n).toBe(0)

    // nine of them for a female profile: the sentence names the 35 days it read
    const nine = withSex('female')
    const short = contextOf({
      ...nine.input,
      wellness: wellness.filter((w) => w.date !== older[0]!.date),
    })
    const [gap] = factsOf('J4', short)
    expect(gap).toMatchObject({ state: 'insufficient', template: 'explain.j4-gap' })
    expect(slot(gap!, 'days', 'count').n).toBe(cycleDays)
    expect(slot(gap!, 'found', 'count').n).toBe(need - 1)
    expect(gap!.window).toEqual({ from: addDays(TODAY, -(cycleDays - 1)), to: TODAY })
  })

  test('J5 gives the decision, the next week and the signals behind it', () => {
    const input: EngineInput = { ...rich, today: addDays(MONDAY, 9), screeningFlags: 3 }
    const decision = weeklyDecision(input, MONDAY, { redsFlags: 3, ramp: 0.1 })
    const ctx = contextOf(input, { decision })
    const facts = view({ subject: 'decision', weekStart: MONDAY }, ctx).groups.find(
      (g) => g.rule === 'J5',
    )!.facts
    expect(facts[0]!.template).toBe(`explain.j5-${decision.decision}`)
    expect(slot(facts[0]!, 'minutes', 'minutes').min).toBe(Math.round(decision.nextWeekTargetMin))
    expect(slot(facts[0]!, 'week', 'date').iso).toBe(MONDAY)
    const reds = facts.find((f) => f.template === 'explain.j5-reds')
    expect(reds && slot(reds, 'n', 'count').n).toBe(3)
    // a signal with no figure to restate says what it is, from a fixed list of words
    for (const fact of facts.filter((f) => f.template === 'explain.j5-signal')) {
      expect(fact.slots['sign']).toEqual(expect.any(String))
    }
    expect(facts.every((f) => f.state === 'used')).toBe(true)
  })

  test('J5 says that no plan covers a week, and uses the decision of last week for a week', () => {
    const [gap] = factsOf('J5', contextOf(emptyInput()))
    expect(gap).toMatchObject({ state: 'insufficient', template: 'explain.j5-gap' })
    expect(explainWeeks({ subject: 'week', weekStart: '2026-10-26' }, richCtx)).toEqual({
      last: MONDAY,
      next: '2026-10-26',
    })
    expect(explainWeeks({ subject: 'decision', weekStart: MONDAY }, richCtx)).toEqual({
      last: MONDAY,
      next: '2026-10-26',
    })
    expect(explainWeeks({ subject: 'readiness' }, richCtx)).toEqual({
      last: '2026-10-12',
      next: MONDAY,
    })
  })

  test('J5 reads a completion shortfall as minutes against the plan for a finished week', () => {
    const base = emptyInput()
    const input: EngineInput = {
      ...base,
      today: '2026-10-28',
      activities: [activity('2026-10-20', { id: 'x', durationSec: 60 * 60 })],
      existing: {
        weeks: [
          {
            weekStart: MONDAY,
            index: 0,
            phase: 'build',
            focus: 'Build',
            targetRunMin: 200,
            longRunMin: 80,
            longRunM: null,
            gainTargetM: null,
            runDays: 3,
            qualitySessions: 0,
            strengthSessions: 0,
            tid: { z1: 80, z2: 10, z3: 10 },
            flags: [],
            isRecovery: false,
            isTaper: false,
          },
        ],
        sessions: [
          planned('q1', '2026-10-20', 'easy', { durationMin: 100 }),
          planned('q2', '2026-10-22', 'easy', { durationMin: 100 }),
        ],
      },
    }
    const decision = weeklyDecision(input, MONDAY, { redsFlags: 0, ramp: 0.1 })
    expect(decision.signals.map((s) => s.code)).toContain('completion-low')
    const ctx = contextOf(input, { decision })
    const facts = view({ subject: 'decision', weekStart: MONDAY }, ctx).groups.find(
      (g) => g.rule === 'J5',
    )!.facts
    const completion = facts.find((f) => f.template === 'explain.j5-completion')!
    expect(text(completion)).toBe(
      `60 min of 200 min planned were run, under the ${String(P.j5.completionHoldShare.value * 100)}% the plan looks for.`,
    )
  })

  test('J7 gives the break so far and the restart share of its tier from P', () => {
    const cases: Array<[number, number]> = [
      [10, P.j7.restart7to14.value],
      [20, P.j7.restart15to28.value],
      [40, P.j7.restartOver28.value],
    ]
    for (const [off, share] of cases) {
      const cut = addDays(TODAY, -off)
      const input = { ...rich, activities: rich.activities.filter((a) => a.date <= cut) }
      const ctx = contextOf(input)
      const facts = factsOf('J7', ctx)
      expect(slot(facts[0]!, 'days', 'count').n, String(off)).toBe(ctx.state.layoffDays)
      expect(slot(facts[1]!, 'share', 'share').fraction, String(off)).toBe(share)
      expect(slot(facts[1]!, 'share', 'share').fraction).toBe(
        breakRestart(ctx.state.layoffDays, 0).fraction,
      )
    }
    // a short gap is no break: only the last run is given
    expect(factsOf('J7')).toHaveLength(1)
    const [gap] = factsOf('J7', contextOf(emptyInput()))
    expect(gap).toMatchObject({ state: 'insufficient', template: 'explain.j7-gap' })
  })
})

describe('L1 to L6: the prediction', () => {
  /** Four efforts of different lengths: critical speed 3.5 m/s, so a prediction exists. */
  function withEfforts(input: EngineInput): EngineInput {
    const efforts = [800, 1500, 3000, 5000].map((m, i) =>
      activity(addDays(TODAY, -20 - i), {
        id: `e-${String(m)}`,
        distanceM: m,
        durationSec: Math.round((m - 200) / 3.5),
        movingSec: Math.round((m - 200) / 3.5),
        elevationGainM: 0,
      }),
    )
    return { ...input, activities: [...input.activities, ...efforts] }
  }
  const half = athletes().find((a) => a.id === 'half')!
  const trail = athletes().find((a) => a.id === 'trail-50k')!
  const hundred = athletes().find((a) => a.id === 'first-100-mile')!
  /** One shorter race and nothing else: a single source. */
  const single = contextOf(marathon.input)

  test('L1 names the basis and the closest race, linked', () => {
    const facts = factsOf('L1', single)
    expect(facts.map((f) => f.template)).toEqual(['explain.l1-basis', 'explain.l1-anchor'])
    expect(facts[0]!.slots['basis']).toBe('one shorter race')
    const anchor = facts[1]!
    expect(slot(anchor, 'date', 'date').iso).toBe('2026-09-12')
    expect(slot(anchor, 'distance', 'distance').m).toBe(10_000)
    expect(anchor.sources[0]).toMatchObject({ kind: 'activity', date: '2026-09-12' })
    // the prediction's own conditions name the same race
    expect(single.prediction!.conditions.join(' ')).toContain('2026-09-12')
    // with critical speed as well, the basis names both
    const both = factsOf('L1')[0]!.slots['basis'] as string
    expect(both).toBe(
      'one shorter race and your critical speed, adjusted for how well you hold pace',
    )
    const [gap] = factsOf('L1', contextOf(emptyInput()))
    expect(gap).toMatchObject({ state: 'insufficient', template: 'explain.l-gap' })
  })

  test('L1 lists the closest race only when the prediction rests on a race', () => {
    const raceMethods = ['personal-exponent', 'riegel', 'same-distance', 'single-anchor']
    const restsOnRace = (ctx: ExplainContext) =>
      ctx.prediction!.method.split('+').some((method) => raceMethods.includes(method))
    // a 100-mile goal with a shorter race and critical speed: no race method reaches that far, so
    // the race was not read and is not listed as the anchor
    const race = activity(addDays(TODAY, -40), {
      id: 'race-10k',
      type: 'race',
      distanceM: 10_000,
      durationSec: 3000,
      movingSec: 3000,
    })
    const noRace = contextOf(withEfforts({ ...hundred.input, activities: [race] }))
    expect(noRace.state.fitness.races).toHaveLength(1)
    expect(restsOnRace(noRace)).toBe(false)
    expect(factsOf('L1', noRace).map((f) => f.template)).toEqual(['explain.l1-basis'])
    // with a race method in the prediction the anchor is listed
    for (const ctx of [single, richCtx]) {
      expect(restsOnRace(ctx)).toBe(true)
      expect(factsOf('L1', ctx).map((f) => f.template)).toEqual([
        'explain.l1-basis',
        'explain.l1-anchor',
      ])
    }
  })

  test('L2 gives the single-race slowdown and the drift behind the durability share', () => {
    const [slowdown] = factsOf('L2', single)
    expect(slowdown!.template).toBe('explain.l2-single')
    expect(slot(slowdown!, 'pct', 'percent').pct).toBe(P.l2.singleAnchorSlowdownPct.value)
    expect(slot(slowdown!, 'distance', 'distance').m).toBe(P.l2.singleAnchorMaxM.value)
    const facts = factsOf('L2')
    expect(facts.map((f) => f.template)).toEqual(['explain.l2-single', 'explain.l2-drift'])
    expect(slot(facts[1]!, 'pct', 'percent').pct).toBe(5)
    // a half marathon is outside the rule
    expect(factsOf('L2', contextOf(half.input))).toEqual([])
  })

  test('L3 counts the sources against the rule and the widening from P', () => {
    const [sources, widened] = factsOf('L3', single)
    expect(slot(sources!, 'n', 'count').n).toBe(1)
    expect(slot(sources!, 'min', 'count').n).toBe(P.l3.minSources.value)
    expect(slot(widened!, 'pct', 'percent').pct).toBe(P.l3.singleSourceWideningPct.value)
    const widening = 'widened by ' + String(P.l3.singleSourceWideningPct.value) + '%'
    expect(single.prediction!.conditions.join(' ')).toContain(widening)
    // two sources meet the rule: no widening
    const facts = factsOf('L3')
    expect(facts).toHaveLength(1)
    expect(slot(facts[0]!, 'n', 'count').n).toBe(richCtx.prediction!.method.split('+').length)
  })

  test('L4 gives the least range for an ultra and nothing for a road marathon', () => {
    const ctx = contextOf(withEfforts(hundred.input))
    expect(ctx.prediction).not.toBeNull()
    const [fact] = factsOf('L4', ctx)
    expect(slot(fact!, 'pct', 'percent').pct).toBe(P.l4.ultraMinHalfWidthPct.value)
    expect(factsOf('L4')).toEqual([])
  })

  test('L5 gives the climb as flat distance and the widening the prediction states', () => {
    const ctx = contextOf(withEfforts(trail.input))
    expect(ctx.prediction).not.toBeNull()
    const facts = factsOf('L5', ctx)
    const climb = facts.find((f) => f.id === 'l5.climb')!
    expect(slot(climb, 'gain', 'climb').m).toBe(trail.input.goal.gainM)
    expect(slot(climb, 'distance', 'distance').m).toBe(
      trail.input.goal.gainM * P.l5.gainEquivalentM.value,
    )
    const widening = facts.find((f) => f.id === 'l5.trail')!
    const stated = 'widened by ' + String(slot(widening, 'pct', 'percent').pct) + '%'
    expect(ctx.prediction!.conditions.join(' ')).toContain(stated)
    expect(factsOf('L5')).toEqual([])
  })

  test('L6 gives the predicted time and range and the least range for the distance', () => {
    const [range, floor] = factsOf('L6')
    const p = richCtx.prediction!
    expect(slot(range!, 'predicted', 'duration').sec).toBe(p.predictedSec)
    expect(slot(range!, 'low', 'duration').sec).toBe(p.lowSec)
    expect(slot(range!, 'high', 'duration').sec).toBe(p.highSec)
    expect(slot(floor!, 'pct', 'percent').pct).toBe(P.l2.marathonMinHalfWidthPct.value)
    const race = activity('2026-09-12', {
      id: 'r10',
      type: 'race',
      distanceM: 10_000,
      durationSec: 3000,
      movingSec: 3000,
    })
    const halfCtx = contextOf({ ...half.input, activities: [...half.input.activities, race] })
    const halfFacts = factsOf('L6', halfCtx)
    expect(slot(halfFacts[1]!, 'pct', 'percent').pct).toBe(P.l6.minBandPct.value)
  })

  test('each rule says what it lacks when there is no prediction', () => {
    const goals: Record<string, Partial<EngineInput['goal']>> = {
      L1: {},
      L2: { distanceM: 42_195 },
      L3: {},
      L4: { distanceM: 160_934 },
      L5: { surface: 'trail', gainM: 2000 },
      L6: {},
    }
    for (const [rule, goal] of Object.entries(goals)) {
      const [fact] = factsOf(rule, contextOf(emptyInput(goal)))
      expect(fact, rule).toMatchObject({ state: 'insufficient' })
      expect(fact!.template, rule).toMatch(/^explain\.l\d?-gap$/)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Insufficient states, subjects and coverage
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// The remaining rules (E4-8): history and profile, signs, the goal, the plan, heat
// ---------------------------------------------------------------------------------------------

const matrix = (id: string) => athletes().find((a) => a.id === id)!
/** The context of a matrix athlete with the plan the engine makes for them stored. */
const ctxOf = (id: string, over: Partial<EngineInput> = {}) =>
  contextOf(withPlan({ ...matrix(id).input, ...over }))
const idOf = (facts: InputFact[], name: string) => facts.find((f) => f.id.endsWith(`.${name}`))!
const sentences = (facts: InputFact[], units: Units = 'mi') => facts.map((f) => text(f, units))

/** A day's check-in over the wellness rows. */
const checkinRow = (date: string, over: Partial<Checkin> = {}) =>
  wellnessDay(date, { fatigue: 3, soreness: 3, mood: 3, stress: 3, sleepQuality: 3, ...over })

describe('A4, A9, B1 to B3, m-age and m-sex: history and profile', () => {
  test('A4 counts the stretches without a run the state counts, with the runs it rests on', () => {
    const ctx = ctxOf('sparse-100-mile')
    const facts = factsOf('A4', ctx)
    const gaps = idOf(facts, 'gaps')
    expect(slot(gaps, 'n', 'count').n).toBe(ctx.state.gaps16w)
    expect(ctx.state.gaps16w).toBeGreaterThan(0)
    expect(slot(gaps, 'days', 'count').n).toBe(P.a4.gapMinDays.value)
    expect(slot(gaps, 'weeks', 'count').n).toBe(P.a4.gapWindowWeeks.value)
    expect(gaps.window).toEqual({ from: addDays(TODAY, -(16 * 7 - 1)), to: TODAY })
    expect(gaps.sources.length).toBeGreaterThan(0)
    expect(text(idOf(facts, 'years'))).toMatch(/^Your profile says you have been running since 20/)
    expect(factsOf('A4', contextOf(emptyInput()))[0]).toMatchObject({
      template: 'explain.a4-gap',
      state: 'insufficient',
    })
  })

  test('A9 names what makes the start gentler, and says when age or body mass is missing', () => {
    const bsi = factsOf('A9', ctxOf('prior-bsi'))
    expect(sentences(bsi)[0]).toBe(
      'These details make the start gentler: an injury in your profile in the last 12 months and an earlier bone stress injury.',
    )
    expect(bsi.every((f) => f.state === 'used')).toBe(true)
    expect(text(factsOf('A9', ctxOf('masters'))[0]!)).toBe(
      'These details make the start gentler: your age.',
    )
    const complete = { heightCm: 180, weightKg: 70, injuries: [], birthYear: 1990 }
    const clean = contextOf({
      ...matrix('half').input,
      profile: profileOf(complete),
    })
    expect(factsOf('A9', clean).map((f) => f.template)).toEqual(['explain.a9-none'])
    const noHeight = contextOf({ ...matrix('half').input, profile: profileOf({ birthYear: 1990 }) })
    expect(factsOf('A9', noHeight).map((f) => f.template)).toEqual(['explain.a9-gap'])
  })

  test('B1 counts the rated runs of the window the load metric is chosen from', () => {
    const ctx = ctxOf('marathon')
    const [rated] = factsOf('B1', ctx)
    const runs = ctx.input.activities.filter(
      (a) => a.type !== 'strength' && a.date >= addDays(TODAY, -41),
    )
    expect(slot(rated!, 'total', 'count').n).toBe(runs.length)
    expect(slot(rated!, 'n', 'count').n).toBe(runs.filter((a) => a.rpe !== null).length)
    expect(slot(rated!, 'share', 'share').fraction).toBe(P.b4.metricMinCoverage.value)
    expect(ctx.state.load.metric).toBe('srpe')
    // unrated runs: the share falls under the coverage and the state counts minutes
    const bare = contextOf({
      ...matrix('marathon').input,
      activities: matrix('marathon').input.activities.map((a) => ({ ...a, rpe: null })),
    })
    expect(slot(factsOf('B1', bare)[0]!, 'n', 'count').n).toBe(0)
    expect(bare.state.load.metric).toBe('minutes')
    expect(factsOf('B1', contextOf(emptyInput()))[0]).toMatchObject({
      template: 'explain.b1-gap',
      state: 'insufficient',
    })
  })

  /** Runs on a chest strap with heart rate and no rating: the state counts heart-rate load. */
  function strapInput(sex: 'female' | 'male' | null, hrMax: number | null = 190): EngineInput {
    const strap = (n: number) =>
      activity(addDays(TODAY, -n), {
        id: `strap-${String(n)}`,
        durationSec: 3000,
        distanceM: 8000,
        avgHr: 140,
        deviceName: 'Polar H10 chest strap',
      })
    return {
      ...emptyInput(),
      profile: profileOf({ sex, hrMax, hrMaxSource: 'measured', hrRest: 50, birthYear: 1990 }),
      activities: [2, 5, 9, 12, 16].map(strap),
    }
  }

  test('B2 counts the runs whose heart rate passes the sample checks, and names the metric', () => {
    const ctx = contextOf(strapInput('male'))
    expect(ctx.state.load.metric).toBe('trimp')
    const facts = factsOf('B2', ctx)
    expect(text(idOf(facts, 'hr'))).toBe(
      '5 of the 5 runs in the last 42 days have heart-rate data that passes the sample checks.',
    )
    expect(text(idOf(facts, 'metric'))).toBe(
      'Load is counted in heart-rate load, one measure for the whole series.',
    )
    expect(factsOf('B2', contextOf(emptyInput()))[0]).toMatchObject({ state: 'insufficient' })
  })

  test('B3 states the weights of the profile sex when heart-rate load is the metric', () => {
    expect(text(factsOf('B3', contextOf(strapInput('female')))[0]!)).toBe(
      'Heart-rate load uses the weights for female runners, from your profile.',
    )
    expect(text(factsOf('B3', contextOf(strapInput(null)))[0]!)).toBe(
      'Your profile gives no sex, so heart-rate load uses the default weights.',
    )
    // session effort is the metric: the weights are not used
    expect(
      text(factsOf('B3', ctxOf('half', { profile: profileOf({ hrMax: 188, hrRest: 50 }) }))[0]!),
    ).toMatch(/^Load is counted in session effort, so the heart-rate weights are not used/)
    // without a maximum heart rate or an age to estimate it from, there is no heart-rate load
    const unanchored = strapInput('male', null)
    const noAnchor = contextOf({
      ...unanchored,
      profile: { ...unanchored.profile, birthYear: null },
    })
    expect(factsOf('B3', noAnchor)[0]).toMatchObject({
      template: 'explain.b3-gap',
      state: 'insufficient',
    })
  })

  test('m-age reads the age of the state and the masters age; m-sex the profile sex', () => {
    const [age] = factsOf('m-age', ctxOf('masters'))
    expect(slot(age!, 'age', 'count').n).toBe(ctxOf('masters').state.age)
    expect(slot(age!, 'masters', 'count').n).toBe(P.f5.mastersMinAge.value)
    expect(factsOf('m-age', contextOf(emptyInput()))[0]!.template).toBe('explain.mage-gap')
    expect(text(factsOf('m-sex', ctxOf('masters'))[0]!)).toMatch(/gives your sex as female/)
    expect(text(factsOf('m-sex', ctxOf('masters'))[0]!)).toMatch(/not your volume\.$/)
    const unset = contextOf({ ...matrix('half').input, profile: profileOf({ sex: null }) })
    expect(factsOf('m-sex', unset)[0]).toMatchObject({
      template: 'explain.msex-gap',
      state: 'insufficient',
    })
  })
})

describe('C6 to C8: intervals, ranges and updates', () => {
  test('C6 gives the distance above critical speed and the share of the time a rep may take', () => {
    const [budget] = factsOf('C6')
    expect(slot(budget!, 'distance', 'distance').m).toBe(richCtx.state.fitness.dPrimeM)
    expect(slot(budget!, 'share', 'share').fraction).toBe(P.c6.repFractionOfTte.value)
    expect(budget!.sources.length).toBeGreaterThan(0)
    const [gapFact] = factsOf('C6', contextOf(emptyInput()))
    expect(gapFact).toMatchObject({ template: 'explain.cs-gap', state: 'insufficient' })
  })

  test('C7 gives the band of every boundary the zones hold, faster end first for a pace', () => {
    const facts = factsOf('C7')
    const { zones } = richCtx
    const hr = idOf(facts, 'hrmax')
    expect(slot(hr, 'low', 'bpm').bpm).toBe(zones.hrMax!.band[0])
    expect(slot(hr, 'high', 'bpm').bpm).toBe(zones.hrMax!.band[1])
    const lt1 = zones.lt1PaceSecPerKm
    if (lt1 !== null) {
      const pace = idOf(facts, 'lt1-pace')
      expect(slot(pace, 'fast', 'pace').secPerKm).toBe(lt1.band[0])
      expect(slot(pace, 'slow', 'pace').secPerKm).toBe(lt1.band[1])
    }
    expect(factsOf('C7', contextOf(emptyInput()))[0]).toMatchObject({
      template: 'explain.c7-gap',
      state: 'insufficient',
    })
  })

  test('C8 gives the break that clears paces, the changes the runner accepted and the rule', () => {
    const ctx = ctxOf('returning', {
      zoneChanges: { thresholdPace: '2026-09-30', hrMax: '2026-10-05' },
    })
    const facts = factsOf('C8', ctx)
    expect(facts.map((f) => f.id)).toEqual([
      'c8.break',
      'c8.change-hrMax',
      'c8.change-thresholdPace',
      'c8.rule',
    ])
    expect(text(facts[1]!)).toBe(
      'The last change you accepted to maximum heart rate was on Mon 5 Oct. Only efforts after it count toward the next one.',
    )
    expect(slot(facts[3]!, 'n', 'count').n).toBe(P.c8.minObservations.value)
    // a break of the length that clears the paces
    const away = contextOf({
      ...matrix('half').input,
      activities: matrix('half').input.activities.filter((a) => a.date <= addDays(TODAY, -20)),
    })
    const [brk] = factsOf('C8', away)
    expect(brk).toMatchObject({ id: 'c8.break' })
    expect(slot(brk!, 'days', 'count').n).toBe(away.state.layoffDays)
    expect(slot(brk!, 'limit', 'count').n).toBe(P.c8.breakDays.value)
    expect(brk!.sources).toHaveLength(1)
    expect(factsOf('C8', contextOf(emptyInput()))[0]!.template).toBe('explain.c8-gap')
  })
})

describe('F5, g-3, J6 and J8: run days, tightened profiles, the masters check, fatigue', () => {
  test('F5 gives the days the plan sets, the days available and the caps that apply', () => {
    const ctx = ctxOf('masters')
    const facts = factsOf('F5', ctx)
    const week = ctx.input.existing!.weeks.find((w) => w.weekStart === MONDAY)!
    expect(slot(idOf(facts, 'plan'), 'n', 'count').n).toBe(week.runDays)
    expect(slot(idOf(facts, 'available'), 'n', 'count').n).toBe(5)
    expect(text(idOf(facts, 'masters'))).toBe(
      'From age 58 the plan keeps run days to 6 a week or fewer.',
    )
    expect(facts.some((f) => f.state === 'insufficient')).toBe(false)
    const novice = factsOf('F5', ctxOf('novice-5k'))
    expect(text(idOf(novice, 'novice'))).toBe(
      'A new runner keeps to 3 run days a week or fewer, not on consecutive days.',
    )
    // no plan: the days available are still stated, with the missing plan
    const noPlan = factsOf('F5', contextOf(matrix('half').input))
    expect(noPlan.map((f) => f.id)).toEqual(['f5.available', 'f5.gap'])
  })

  test('g-3 gives the ramp of the tightened profile and what tightens it', () => {
    const ctx = ctxOf('prior-bsi')
    const [ramp] = factsOf('g-3', ctx)
    expect(slot(ramp!, 'pct', 'percent').pct).toBeCloseTo(weeklyRamp(ctx.state) * 100, 9)
    expect(slot(ramp!, 'soft', 'percent').pct).toBeCloseTo(P.g2.rampSoft.value * 100, 9)
    expect(text(ramp!)).toContain('an earlier bone stress injury')
    expect(text(ramp!)).toContain('two or more bone-stress factors')
    // a niggle the runner reported
    const reported = {
      ...ctxOf('half'),
      state: {
        ...ctxOf('half').state,
        risk: { ...ctxOf('half').state.risk, injuryReport: true },
      },
    }
    expect(text(factsOf('g-3', reported)[0]!)).toContain('a niggle you reported')
    // the default profile, and a low run frequency
    expect(factsOf('g-3', ctxOf('half')).map((f) => f.template)).toEqual(['explain.g3-none'])
    expect(factsOf('g-3', ctxOf('returning')).map((f) => f.template)).toEqual([
      'explain.g3-none',
      'explain.g3-low',
    ])
    expect(factsOf('g-3', contextOf(emptyInput())).at(-1)).toMatchObject({
      template: 'explain.g3-gap',
      state: 'insufficient',
    })
  })

  test('J6 states the masters check, the check-ins it needs and who it does not apply to', () => {
    expect(factsOf('J6', ctxOf('half'))[0]).toMatchObject({ template: 'explain.j6-under' })
    expect(factsOf('J6', contextOf(emptyInput()))[0]).toMatchObject({
      template: 'explain.j6-gap',
      state: 'insufficient',
    })
    const days = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => checkinRow(addDays(TODAY, -(from + i))))
    const withCheckins = (rows: ReturnType<typeof days>) =>
      contextOf({ ...matrix('masters').input, wellness: rows })
    const enough = factsOf('J6', withCheckins(days(1, 10)))
    expect(enough.map((f) => [f.id, f.state])).toEqual([
      ['j6.on', 'used'],
      ['j6.checkins', 'used'],
    ])
    expect(text(enough[0]!)).toBe(
      'At age 58 the plan compares your fatigue, soreness and mood 48 hours after a hard session with your own median of the last 28 days.',
    )
    expect(slot(enough[1]!, 'found', 'count').n).toBe(10)
    const few = factsOf('J6', withCheckins(days(1, 3)))
    expect(few[1]).toMatchObject({ id: 'j6.gap', state: 'insufficient' })
    expect(slot(few[1]!, 'found', 'count').n).toBe(3)
  })

  test('J8 and n-6 read the fatigue state of the readiness snapshot, with its two escalations', () => {
    const base = ctxOf('half', { wellness: [checkinRow(TODAY)] })
    const flag = (code: string) => ({ code, message: 'x', rules: ['J8'] })
    const state = (readiness: Partial<ExplainContext['readiness']>): [InputFact[], InputFact[]] => {
      const ctx = { ...base, readiness: { ...base.readiness, ...readiness } }
      return [factsOf('J8', ctx), factsOf('n-6', ctx)]
    }
    const normal = state({})
    expect(normal[0][0]!.template).toBe('explain.j8-normal')
    expect(normal[0][0]!.sources).toEqual([checkinSource(TODAY)])
    expect(state({ state: 'possible-fatigue' })[0][0]!.template).toBe('explain.j8-watch')
    const deload = state({
      state: 'persistent-suppression',
      redFlags: [flag('suppression-deload')],
    })
    expect(deload[0][0]!.template).toBe('explain.j3-suppression')
    expect(slot(deload[0][0]!, 'days', 'count').n).toBe(P.j8.deloadSuggestDays.value)
    const review = state({
      state: 'persistent-suppression',
      redFlags: [flag('suppression-medical-review')],
    })
    expect(text(review[0][0]!)).toBe(
      'Readiness has stayed lower than usual for 28 days or more as of Wed 21 Oct. A medical review is worth considering.',
    )
    // n-6 is the same state under its own rule
    for (const [j8, n6] of [normal, deload, review]) {
      expect(text(n6[0]!)).toBe(text(j8[0]!))
      expect(n6[0]!.id.startsWith('n-6.')).toBe(true)
    }
    expect(factsOf('J8', contextOf(emptyInput()))[0]).toMatchObject({
      template: 'explain.j8-gap',
      state: 'insufficient',
    })
  })
})

describe('n-1 to n-4, n-7 and J9: signs, the fluid-safety card and rest windows', () => {
  const withRows = (rows: Array<WellnessDay & Partial<Checkin>>, over: Partial<EngineInput> = {}) =>
    contextOf({ ...matrix('half').input, wellness: rows, ...over })

  test('n-1 follows the newest check-in: active until a later one does not report it', () => {
    const bone = checkinRow(addDays(TODAY, -3), { painFocalBone: true, painScore: 4 })
    const active = factsOf('n-1', withRows([bone, checkinRow(addDays(TODAY, -5))]))
    expect(active.map((f) => [f.id, f.sources[0]?.date])).toEqual([
      ['n-1.active', addDays(TODAY, -3)],
    ])
    const cleared = factsOf('n-1', withRows([bone, checkinRow(addDays(TODAY, -1))]))
    expect(text(cleared[0]!)).toBe(
      'No focal bone pain is reported in your latest check-in, of Tue 20 Oct.',
    )
    expect(factsOf('n-1', contextOf(emptyInput()))[0]).toMatchObject({
      template: 'explain.n1-gap',
      state: 'insufficient',
    })
  })

  test('n-2 gives the worst pain of the last two days against the score that holds progression', () => {
    const score = P.pain.flagScore.value
    const pain = (n: number) =>
      factsOf('n-2', withRows([checkinRow(addDays(TODAY, -1), { painScore: n })]))
    expect(pain(score)[0]).toMatchObject({ template: 'explain.n2-pain' })
    expect(pain(score - 1)[0]).toMatchObject({ template: 'explain.n2-below' })
    expect(slot(pain(score)[0]!, 'score', 'count').n).toBe(score)
    expect(pain(0)[0]).toMatchObject({ template: 'explain.n2-none' })
    expect(pain(score)[0]!.sources).toEqual([checkinSource(addDays(TODAY, -1))])
    // a rating on a run counts too
    const run = activity(TODAY, { id: 'sore-run', pain: score + 1 })
    const ofRun = factsOf('n-2', withRows([], { activities: [run] }))
    expect(slot(ofRun[0]!, 'pain', 'count').n).toBe(score + 1)
    expect(ofRun[0]!.sources.map((s) => s.id)).toEqual(['sore-run'])
    expect(factsOf('n-2', contextOf(emptyInput()))[0]!.state).toBe('insufficient')
  })

  test('n-3 follows the return gate: rest, then easy running, then clear', () => {
    const ill = (ago: number) => checkinRow(addDays(TODAY, -ago), { illness: true })
    expect(factsOf('n-3', withRows([ill(0)]))[0]).toMatchObject({ template: 'explain.n3-rest' })
    const easy = factsOf('n-3', withRows([ill(3)]))[0]!
    expect(easy.template).toBe('explain.n3-easy')
    expect(slot(easy, 'days', 'count').n).toBe(P.n3.illnessEasyDaysBeforeIntensity.value)
    expect(easy.sources).toEqual([checkinSource(addDays(TODAY, -3))])
    expect(factsOf('n-3', withRows([ill(30)]))[0]).toMatchObject({ template: 'explain.n3-clear' })
    expect(factsOf('n-3', contextOf(emptyInput()))[0]).toMatchObject({
      template: 'explain.n3-gap',
      state: 'insufficient',
    })
    // a window counts as the report, and is the source
    const window = {
      id: 'w1',
      reason: 'illness-below-neck' as const,
      mode: 'rest' as const,
      startDate: addDays(TODAY, -2),
      endDate: addDays(TODAY, 1),
      maxRunMin: null,
      pain: null,
      gaitChange: false,
    }
    const covered = factsOf('n-3', withRows([], { disruptions: [window] }))[0]!
    expect(covered.template).toBe('explain.n3-rest')
    expect(covered.sources).toEqual([
      { kind: 'disruption', id: 'w1', date: window.startDate, label: 'Rest window' },
    ])
  })

  test('n-4 gives the signs of the screen and the count that holds progression', () => {
    const signs = (screeningFlags?: number) =>
      factsOf('n-4', contextOf({ ...matrix('half').input, screeningFlags }))[0]!
    expect(text(signs(2))).toBe(
      'Signs on the latest energy-availability screen: 2. Progression holds at 2 or more.',
    )
    expect(slot(signs(1), 'hold', 'count').n).toBe(P.j5.redsHoldFlags.value)
    expect(signs(0).template).toBe('explain.n4-none')
    expect(signs(undefined)).toMatchObject({ template: 'explain.n4-gap', state: 'insufficient' })
  })

  test('n-7 sizes the card for the goal time, else the prediction, as the fluid card does', () => {
    const [event] = factsOf('n-7', ctxOf('marathon'))
    expect(slot(event!, 'duration', 'duration').sec).toBe(
      matrix('marathon').input.goal.targetTimeSec,
    )
    expect(slot(event!, 'hours', 'count').n).toBe(P.n7.eahStrongerAlertHours.value)
    const noTarget = contextOf(matrix('marathon').input, {
      race: { ...matrix('marathon').input.goal, targetTimeSec: null },
    })
    expect(slot(factsOf('n-7', noTarget)[0]!, 'duration', 'duration').sec).toBe(
      noTarget.prediction!.predictedSec,
    )
    expect(factsOf('n-7', contextOf(emptyInput(), { race: null }))[0]).toMatchObject({
      template: 'explain.n7-gap',
      state: 'insufficient',
    })
  })

  test('J9 lists the windows, newest first, with the cap of a limited one', () => {
    const window = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      reason: 'niggle' as const,
      mode: 'rest' as const,
      startDate: addDays(TODAY, -5),
      endDate: addDays(TODAY, 2),
      maxRunMin: null,
      pain: 3,
      gaitChange: false,
      ...over,
    })
    const ctx = withRows([], {
      disruptions: [
        window('old'),
        window('new', { reason: 'travel', mode: 'limited', maxRunMin: 30, startDate: TODAY }),
      ],
    })
    const facts = factsOf('J9', ctx)
    expect(facts.map((f) => f.id)).toEqual(['j9.window-0', 'j9.window-1'])
    expect(text(facts[0]!)).toBe(
      'Travel: from Wed 21 Oct to Fri 23 Oct, with runs of 30 min or less. The minutes of those days are not added back.',
    )
    expect(text(facts[1]!)).toMatch(/^A niggle: from Fri 16 Oct to Fri 23 Oct\./)
    expect(facts[0]!.sources).toEqual([
      { kind: 'disruption', id: 'new', date: TODAY, label: 'Rest window' },
    ])
    expect(factsOf('J9', contextOf(matrix('half').input))[0]).toMatchObject({
      template: 'explain.j9-gap',
      state: 'insufficient',
    })
  })
})

describe('D1 to D7: the goal', () => {
  test('D1 gives the distance, the course, the climb and the date, and whether the ultra rules apply', () => {
    const trail = factsOf('D1', ctxOf('trail-50k'))
    expect(text(trail[0]!, 'mi')).toBe(
      'Your goal is 31.1 mi on a trail course, with 7218 ft of climb, on Sat 6 Mar.',
    )
    expect(text(trail[1]!, 'mi')).toBe(
      'At more than 26.2 mi this counts as an ultra, so the ultra rules apply.',
    )
    const road = factsOf('D1', ctxOf('half'))
    expect(text(road[0]!, 'km')).toBe('Your goal is 21.1 km on a road course, on Sun 28 Feb.')
    expect(road[1]!.template).toBe('explain.d1-not-ultra')
    expect(sentences(factsOf('D1', ctxOf('trail-50k')), 'km')[0]).toContain('2200 m of climb')
  })

  test('D2 gives the goal type: a time, a time not yet set, or to finish', () => {
    expect(text(factsOf('D2', ctxOf('marathon'))[0]!)).toBe(
      'Your goal is a time goal of 3 h 30 min.',
    )
    expect(factsOf('D2', ctxOf('trail-50k'))[0]!.template).toBe('explain.d2-finish')
    expect(factsOf('D2', ctxOf('first-100-mile'))[0]!.template).toBe('explain.d2-finish-long')
    const open = ctxOf('marathon', {
      goal: { ...matrix('marathon').input.goal, targetTimeSec: null },
    })
    expect(factsOf('D2', open)[0]!.template).toBe('explain.d2-time-open')
  })

  test('D3 sets the floors of a time goal against the last weeks of running', () => {
    const ctx = ctxOf('marathon')
    const [floors, now] = factsOf('D3', ctx)
    expect(slot(floors!, 'weekly', 'distance').m).toBe(P.d3.marathonMinWeeklyKm.value * 1000)
    expect(slot(floors!, 'long', 'distance').m).toBe(P.d3.marathonMinLongRunKm.value * 1000)
    expect(slot(now!, 'long', 'distance').m).toBe(ctx.state.longest30d.distanceM)
    expect(slot(now!, 'weeks', 'count').n).toBe(4)
    const half = factsOf('D3', ctxOf('half'))
    expect(slot(half[0]!, 'weekly', 'distance').m).toBe(P.d3.halfMinWeeklyKm.value * 1000)
    // a finish goal, a 5 km goal and an ultra have no floor
    expect(factsOf('D3', ctxOf('trail-50k'))).toEqual([])
    expect(factsOf('D3', ctxOf('novice-5k'))).toEqual([])
    expect(factsOf('D3', contextOf(emptyInput()))[0]).toMatchObject({
      template: 'explain.d3-gap',
      state: 'insufficient',
    })
  })

  test('D4 gives the label and the weeks of the plan own outlook', () => {
    for (const id of ['marathon', 'trail-50k', 'novice-5k', 'sparse-100-mile']) {
      const ctx = ctxOf(id)
      const plan = buildPlan(matrix(id).input)
      const [outlook] = factsOf('D4', ctx)
      expect(slot(outlook!, 'needed', 'count').n, id).toBe(plan.feasibility.weeksNeeded)
      expect(slot(outlook!, 'available', 'count').n, id).toBe(plan.feasibility.weeksAvailable)
      expect(text(outlook!), id).toContain(
        `reads ${{ comfortable: 'comfortable', tight: 'tight', 'not-reachable': 'not reachable within the default limits' }[plan.feasibility.label]}:`,
      )
    }
  })

  test('D5 gives the weekly average and the years of running, for an ultra only', () => {
    const ctx = ctxOf('trail-50k')
    const [weekly, years] = factsOf('D5', ctx)
    expect(slot(weekly!, 'weeks', 'count').n).toBe(P.d5.lowWeeklyWindowWeeks.value)
    expect(slot(weekly!, 'low', 'distance').m).toBe(P.d5.lowWeeklyKm.value * 1000)
    expect(slot(years!, 'years', 'count').n).toBe(ctx.state.yearsRunning)
    expect(slot(years!, 'min', 'count').n).toBe(P.d5.minYearsRunning.value)
    expect(factsOf('D5', ctxOf('marathon'))).toEqual([])
    const ultraNoRuns = contextOf(emptyInput({ distanceM: 160_934, isUltra: true }))
    expect(factsOf('D5', ultraNoRuns)[0]).toMatchObject({
      template: 'explain.d5-gap',
      state: 'insufficient',
    })
  })

  test('D7 gives the typical week and the cap it sets for a 5 km or 10 km goal', () => {
    const ctx = ctxOf('prior-bsi')
    const [tier] = factsOf('D7', ctx)
    expect(slot(tier!, 'typical', 'minutes').min).toBe(ctx.state.typicalWeekMin)
    // the cap is the one the plan holds its longest run to
    const longest = Math.max(...ctx.input.existing!.weeks.map((w) => w.longRunMin))
    expect(longest).toBeLessThanOrEqual(slot(tier!, 'cap', 'minutes').min)
    expect(factsOf('D7', ctxOf('marathon'))).toEqual([])
    expect(
      factsOf('D7', contextOf(emptyInput({ distanceClass: '5k', distanceM: 5000 })))[0],
    ).toMatchObject({
      template: 'explain.d7-gap',
      state: 'insufficient',
    })
  })

  test('every goal rule says there is no goal when the runner has none', () => {
    const none = contextOf(emptyInput(), { goal: null, race: null })
    for (const rule of ['D1', 'D2', 'D3', 'D4', 'D5', 'D7', 'H2', 'H4', 'H5', 'H6', 'H12', 'K1']) {
      expect(factsOf(rule, none)[0], rule).toMatchObject({
        template: 'explain.goal-gap',
        state: 'insufficient',
      })
    }
  })
})

describe('after a break: E6, D4, D7 and K1 read the state the plan was drawn from [rules J7]', () => {
  type Pattern = ReadonlyArray<readonly [number, number]>
  /** Tuesday and Thursday runs: a typical week of 75 min. */
  const WEEK_75: Pattern = [
    [1, 37],
    [3, 38],
  ]

  /**
   * A matrix athlete whose weeks hold `pattern` (weekday from Monday = 0, minutes), the last run
   * `layoffDays` ago, with the plan the engine makes for them stored, as the server holds it.
   */
  function afterLayoff(
    id: string,
    pattern: Pattern,
    layoffDays: number,
    goal: Partial<EngineInput['goal']> = {},
  ): ExplainContext {
    const base = matrix(id).input
    const last = addDays(TODAY, -layoffDays)
    const activities: Activity[] = []
    for (let week = 1; week <= 12; week += 1) {
      for (const [dow, min] of pattern) {
        const date = addDays(mondayOf(TODAY), -7 * week + dow)
        if (date > last) continue
        activities.push(
          activity(date, {
            id: `run-${date}`,
            durationSec: min * 60,
            movingSec: min * 60,
            distanceM: min * 180,
            rpe: 3,
          }),
        )
      }
    }
    return contextOf(withPlan({ ...base, goal: { ...base.goal, ...goal }, activities }))
  }

  /** The first run the stored plan holds from today on. */
  const firstRun = (ctx: ExplainContext) =>
    ctx.input
      .existing!.sessions.filter((s) => s.date >= TODAY)
      .sort((a, b) => a.date.localeCompare(b.date))[0]!

  test('E6 names the floor start of a plan that restarted at 56 min, not "enough to skip"', () => {
    const ctx = afterLayoff('half', WEEK_75, 20)
    // the snapshot keeps the runner's own week; the plan restarted at round(75 x 0.75) = 56 min
    expect(ctx.state.typicalWeekMin).toBe(75)
    expect(ctx.state.layoffDays).toBeGreaterThanOrEqual(15)
    expect(ctx.input.existing!.weeks[0]!.flags).toContain('restart-floor')
    const facts = factsOf('E6', ctx)
    expect(facts.map((f) => f.template)).toEqual(['explain.e6-floor'])
    expect(text(facts[0]!)).toBe('You start with 3 runs of 30 min a week, then build from there.')
    expect(slot(facts[0]!, 'session', 'minutes').min).toBe(firstRun(ctx).durationMin)
  })

  test('E6 names the rung of a plan that restarted on the ladder', () => {
    const ctx = afterLayoff('half', WEEK_75, 36)
    const flag = ctx.input.existing!.weeks[0]!.flags.find((f) => f.startsWith('ladder-'))!
    const facts = factsOf('E6', ctx)
    expect(facts.map((f) => f.template)).toEqual(['explain.e6-ladder'])
    expect(slot(facts[0]!, 'rung', 'count').n).toBe(Number(flag.slice('ladder-'.length)))
  })

  test('E6 keeps "enough to skip" for a break under 7 days', () => {
    const ctx = afterLayoff('half', WEEK_75, 5)
    expect(ctx.state.layoffDays).toBeLessThan(P.j7.tier1Days.value)
    const facts = factsOf('E6', ctx)
    expect(facts.map((f) => f.template)).toEqual(['explain.e6-none'])
    expect(slot(facts[0]!, 'level', 'minutes').min).toBe(75)
  })

  test('D4 gives the weeks the plan needed from the restart volume', () => {
    const ctx = afterLayoff('half', WEEK_75, 36)
    const plan = buildPlan(ctx.input)
    const raw = feasibility(
      ctx.race!,
      ctx.state,
      TODAY,
      startPath({ ...ctx.input, today: TODAY }, ctx.state),
    )
    // the raw state would say 21 weeks; the plan restarted lower and needs more
    expect(raw.weeksNeeded).not.toBe(plan.feasibility.weeksNeeded)
    const [outlook] = factsOf('D4', ctx)
    expect(slot(outlook!, 'needed', 'count').n).toBe(plan.feasibility.weeksNeeded)
    expect(slot(outlook!, 'available', 'count').n).toBe(plan.feasibility.weeksAvailable)
  })

  test('D7 gives the typical week the long-run cap was drawn from', () => {
    const week: Pattern = [
      [1, 60],
      [3, 70],
      [5, 70],
    ]
    const ctx = afterLayoff('half', week, 20, { distanceClass: '10k', distanceM: 10_000 })
    expect(ctx.state.typicalWeekMin).toBe(200)
    const [tier] = factsOf('D7', ctx)
    // round(200 x 0.75): the tier below 180 min, as the plan used it
    expect(tier!.template).toBe('explain.d7-tier-break')
    expect(slot(tier!, 'typical', 'minutes').min).toBe(150)
    expect(text(tier!)).toMatch(
      /^After your break the plan restarts from a typical week of 150 min/,
    )
    // the cap the plan held its longest run to, not the one the unadjusted week would give
    const capFor = (state: ExplainContext['state']) => {
      const pace = trainingPace(state, ctx.race!)
      const z1 = ctx.zones.pace?.z1 ?? null
      return peakLongRunMin(ctx.race!, pace, state, z1 === null ? pace : (z1[0] + z1[1]) / 2)
    }
    const cap = slot(tier!, 'cap', 'minutes').min
    expect(cap).toBe(capFor(afterBreak(ctx.state)))
    expect(cap).not.toBe(capFor(ctx.state))
    const longest = Math.max(...ctx.input.existing!.weeks.map((w) => w.longRunMin))
    expect(longest).toBeLessThanOrEqual(cap)
    // without a break the sentence is the plain one, with the runner's own week
    const rested = afterLayoff('half', week, 3, { distanceClass: '10k', distanceM: 10_000 })
    expect(factsOf('D7', rested)[0]!.template).toBe('explain.d7-tier')
  })

  test('K1 gives the taper length of the plan, from the restart volume', () => {
    const week: Pattern = [
      [0, 45],
      [1, 60],
      [3, 60],
      [4, 40],
      [5, 120],
    ]
    const ctx = afterLayoff('marathon', week, 36)
    // 325 min a week is not low volume; the restart at 163 min is
    expect(taperDays(ctx.race!, ctx.state)).toBe(P.k1.marathonDays.value)
    const [k1] = factsOf('K1', ctx)
    expect(slot(k1!, 'days', 'count').n).toBe(P.k1.marathonLowVolumeDays.value)
    const taper = ctx.input.existing!.weeks.filter((w) => w.isTaper)
    expect(taper.length * 7).toBe(P.k1.marathonLowVolumeDays.value)
    expect(slot(k1!, 'week', 'date').iso).toBe(taper[0]!.weekStart)
  })
})

describe('the stored plan: E2 to E4, E6, F5, H7, H10, K1 and K2', () => {
  test('E2 counts the weeks of each phase of the stored plan and the weeks to the race', () => {
    const ctx = ctxOf('marathon')
    const [phases, race] = factsOf('E2', ctx)
    const weeks = ctx.input.existing!.weeks
    const inPhase = (...p: string[]) => weeks.filter((w) => p.includes(w.phase)).length
    expect(slot(phases!, 'base', 'count').n).toBe(inPhase('base'))
    expect(slot(phases!, 'build', 'count').n).toBe(inPhase('build'))
    expect(slot(phases!, 'specific', 'count').n).toBe(inPhase('specific'))
    expect(slot(phases!, 'taper', 'count').n).toBe(inPhase('taper', 'race'))
    expect(slot(race!, 'weeks', 'count').n).toBe(
      Math.floor((Date.parse('2027-03-14') - Date.parse(TODAY)) / 86_400_000 / 7),
    )
    expect(factsOf('E2', contextOf(emptyInput()))[0]).toMatchObject({
      template: 'explain.plan-gap',
      state: 'insufficient',
    })
  })

  test('E3 gives the cycle, why it is shorter, and the next recovery week', () => {
    const usual = factsOf('E3', ctxOf('marathon'))
    expect(text(usual[0]!)).toBe('The plan puts a recovery week after every 3 weeks of work.')
    const next = idOf(usual, 'next')
    const recovery = ctxOf('marathon').input.existing!.weeks.find(
      (w) => w.isRecovery && w.weekStart >= MONDAY,
    )!
    expect(slot(next, 'minutes', 'minutes').min).toBe(recovery.targetRunMin)
    expect(usual.some((f) => f.id === 'e3.short')).toBe(false)
    const injured = factsOf('E3', ctxOf('prior-bsi'))
    expect(text(injured[0]!)).toContain('every 2 weeks')
    expect(text(idOf(injured, 'short'))).toBe(
      'The cycle is shorter than the usual 3 weeks because of an injury in your profile in the last 12 months.',
    )
    const chosen = factsOf('E3', ctxOf('marathon', { options: { recoveryCycle: '2:1' } }))
    expect(text(idOf(chosen, 'short'))).toContain('the 2:1 cycle you chose')
    const novice = factsOf('E3', ctxOf('novice-5k'))
    expect(text(idOf(novice, 'short'))).toContain('your running level')
    expect(factsOf('E3', contextOf(emptyInput())).at(-1)).toMatchObject({
      template: 'explain.plan-gap',
      state: 'insufficient',
    })
  })

  test('E4 gives the phase and the shares of the week it is asked about', () => {
    const ctx = ctxOf('marathon')
    const [week] = factsOf('E4', ctx)
    const stored = ctx.input.existing!.weeks.find((w) => w.weekStart === MONDAY)!
    expect(slot(week!, 'z1', 'percent').pct).toBe(stored.tid.z1)
    expect(slot(week!, 'z2', 'percent').pct).toBe(stored.tid.z2)
    expect(slot(week!, 'z3', 'percent').pct).toBe(stored.tid.z3)
    expect(text(week!)).toContain(`is a base week`)
    // a session reads the week it falls in
    const later = ctx.input.existing!.sessions.find(
      (s) => s.date >= addDays(MONDAY, 14) && s.rules.includes('E4'),
    )!
    const monday = addDays(mondayOf(later.date), 0)
    const forSession = view({ subject: 'session', id: later.id }, ctx).groups.find(
      (g) => g.rule === 'E4',
    )!.facts[0]!
    const storedLater = ctx.input.existing!.weeks.find((w) => w.weekStart === monday)!
    expect(forSession.window).toEqual({ from: monday, to: addDays(monday, 6) })
    expect(slot(forSession, 'z1', 'percent').pct).toBe(storedLater.tid.z1)
  })

  test('E6 names the start path the plan was drawn with', () => {
    expect(text(factsOf('E6', ctxOf('marathon'))[0]!)).toMatch(
      /^You already run enough to skip a start path/,
    )
    expect(text(factsOf('E6', ctxOf('novice-5k')).at(-1)!)).toBe(
      'You start on rung 1 of 9 of a run-walk ladder, because of your recent running.',
    )
    expect(text(factsOf('E6', ctxOf('sparse-100-mile'))[0]!)).toBe(
      'You start with 3 runs of 30 min a week, then build from there.',
    )
    const empty = factsOf('E6', contextOf(emptyInput()))
    expect(empty[0]).toMatchObject({ id: 'e6.gap', state: 'insufficient' })
    expect(empty).toHaveLength(2)
    // the injury-return ladder
    const injured = contextOf({
      ...emptyInput(),
      profile: profileOf({
        injuries: [{ kind: 'muscle', year: 2026, month: 9 } as never],
        runningSinceYear: 2015,
      }),
    })
    expect(text(factsOf('E6', injured).at(-1)!)).toBe(
      'You start on the return ladder at runs of 5 min, because of an injury in your profile.',
    )
  })

  test('E6 says what is missing and then where the plan starts, whatever the path is', () => {
    const missing = 'No run is on file in the last 365 days.'
    const novice = contextOf({ ...emptyInput(), profile: profileOf({ runningSinceYear: null }) })
    const injured = contextOf({
      ...emptyInput(),
      profile: profileOf({
        injuries: [{ kind: 'muscle', year: 2026, month: 9 } as never],
        runningSinceYear: 2015,
      }),
    })
    const experienced = contextOf({
      ...emptyInput(),
      profile: profileOf({ runningSinceYear: 2015 }),
    })
    expect(sentences(factsOf('E6', novice), 'km')).toEqual([
      missing,
      'You start on rung 1 of 9 of a run-walk ladder, because of your recent running.',
    ])
    expect(sentences(factsOf('E6', injured), 'km')).toEqual([
      missing,
      'You start on the return ladder at runs of 5 min, because of an injury in your profile.',
    ])
    expect(sentences(factsOf('E6', experienced), 'km')).toEqual([
      missing,
      'You start with 3 runs of 20 min a week, then build from there.',
    ])
  })

  test('H7, H10, K1 and K2 give the fuel weeks, the strength sessions and the taper of the plan', () => {
    const ctx = ctxOf('first-100-mile')
    const weeks = ctx.input.existing!.weeks
    const gut = weeks.filter((w) => w.flags.includes('gut-training'))
    const [gutWeeks, fuel] = factsOf('H7', ctx)
    expect(slot(gutWeeks!, 'n', 'count').n).toBe(gut.length)
    expect(slot(gutWeeks!, 'week', 'date').iso).toBe(gut[0]!.weekStart)
    const flagged = ctx.input.existing!.sessions.filter(
      (s) =>
        s.date >= gut[0]!.weekStart &&
        s.date <= addDays(gut[0]!.weekStart, 6) &&
        s.flags.includes('fuel-practice'),
    )
    expect(slot(fuel!, 'n', 'count').n).toBe(flagged.length)
    expect(fuel!.sources.map((s) => s.id).sort()).toEqual(flagged.map((s) => s.id).sort())
    expect(factsOf('H7', ctxOf('novice-5k'))[0]!.template).toBe('explain.h7-none')

    const strength = factsOf(
      'H10',
      ctxOf('first-100-mile', { profile: profileOf({ strengthPreference: 2 }) }),
    )
    expect(strength.map((f) => f.id)).toEqual(['h10.week', 'h10.wanted'])
    expect(text(strength[1]!)).toBe('Your profile asks for 2 strength sessions a week.')

    const taper = weeks.filter((w) => w.isTaper)
    const [k1] = factsOf('K1', ctx)
    expect(slot(k1!, 'days', 'count').n).toBe(taperDays(ctx.race!, ctx.state))
    expect(slot(k1!, 'week', 'date').iso).toBe(taper[0]!.weekStart)
    const k2 = factsOf('K2', ctx)
    expect(k2.map((f) => slot(f, 'minutes', 'minutes').min)).toEqual(
      taper.slice(0, EXPLAIN_MAX_SOURCES).map((w) => Math.round(w.targetRunMin)),
    )
    for (const rule of ['H7', 'H10', 'K2']) {
      expect(factsOf(rule, contextOf(emptyInput())).at(-1), rule).toMatchObject({
        template: 'explain.plan-gap',
        state: 'insufficient',
      })
    }
  })
})

describe('the goal on the course: H2, H4 to H6, H12 and O1', () => {
  test('H2 caps the longest run at the lesser of six hours and 60% of the race', () => {
    const ctx = ctxOf('first-100-mile')
    const [cap] = factsOf('H2', ctx)
    expect(slot(cap!, 'cap', 'duration').sec).toBe(
      ultraRunCapMin(ctx.race!.expectedDurationSec)! * 60,
    )
    expect(slot(cap!, 'race', 'duration').sec).toBe(ctx.race!.expectedDurationSec)
    expect(slot(cap!, 'hours', 'count').n).toBe(P.h2.longestRunCapHours.value)
    expect(factsOf('H2', ctxOf('marathon'))).toEqual([])
  })

  test('H4 and H5 give the climb, the descent and the climbing of the week', () => {
    const ctx = ctxOf('trail-50k')
    const [climb, week] = factsOf('H4', ctx)
    expect(slot(climb!, 'gain', 'climb').m).toBe(2200)
    expect(slot(climb!, 'ramp', 'percent').pct).toBe(P.h4.weeklyGainRamp.value * 100)
    const stored = ctx.input.existing!.weeks.find((w) => w.weekStart === MONDAY)!
    expect(slot(week!, 'gain', 'climb').m).toBe(stored.gainTargetM)
    const [descent] = factsOf('H5', ctx)
    expect(slot(descent!, 'loss', 'climb').m).toBe(2200)
    expect(slot(descent!, 'weeks', 'count').n).toBe(P.h5.downhillStartWeeksBeforeRace.value)
    expect(factsOf('H4', ctxOf('marathon'))).toEqual([])
    expect(factsOf('H5', ctxOf('marathon'))).toEqual([])
    const trailNoClimb = contextOf(emptyInput({ surface: 'trail', gainM: 0, lossM: 0 }))
    expect(factsOf('H4', trailNoClimb)[0]).toMatchObject({
      template: 'explain.h4-gap',
      state: 'insufficient',
    })
    expect(factsOf('H5', trailNoClimb)[0]).toMatchObject({
      template: 'explain.h5-gap',
      state: 'insufficient',
    })
  })

  test('H6 says whether the race runs into darkness and how many headlamp runs that adds', () => {
    const dark = factsOf('H6', ctxOf('first-100-mile'))[0]!
    expect(dark.template).toBe('explain.h6-dark')
    expect(slot(dark, 'low', 'count').n).toBe(P.h6.headlampRehearsalRuns.value[0])
    expect(slot(dark, 'high', 'count').n).toBe(P.h6.headlampRehearsalRuns.value[1])
    expect(factsOf('H6', ctxOf('half'))[0]!.template).toBe('explain.h6-day')
  })

  test('H12 gives the hold and the steps after the goal race, and why a hold is longer', () => {
    const ctx = ctxOf('first-100-mile')
    const { own } = postRaceWindows({ ...ctx.input, goal: ctx.race! })
    const [hold, modified] = factsOf('H12', ctx)
    expect(slot(hold!, 'days', 'count').n).toBe(own.holdDays)
    expect(slot(hold!, 'steps', 'count').n).toBe(own.stages.length)
    expect(slot(modified!, 'base', 'count').n).toBe(own.baseHoldDays)
    expect(text(modified!)).toContain('because of your age and a first race of this length')
    // a short race has one step and no hold; no reason is given when nothing lengthens it
    const short = factsOf('H12', ctxOf('half'))
    expect(short.map((f) => f.template)).toEqual(['explain.h12-steps'])
    // a race inside its window follows the window it is in
    const raced = ctxOf('half', {
      activities: [
        ...matrix('half').input.activities,
        activity(addDays(TODAY, -4), {
          id: 'marathon-race',
          type: 'race',
          distanceM: 42_195,
          durationSec: 14_400,
        }),
      ],
    })
    const past = factsOf('H12', raced).find((f) => f.id === 'h12.past')!
    expect(slot(past, 'date', 'date').iso).toBe(addDays(TODAY, -4))
    expect(past.window!.from).toBe(addDays(TODAY, -4))
  })

  test('O1 gives the ceiling a watch alerts above, from the zones, and the floor of the band', () => {
    const [ceiling] = factsOf('O1')
    expect(slot(ceiling!, 'bpm', 'bpm').bpm).toBe(richCtx.zones.hr!.z1[1])
    expect(slot(ceiling!, 'floor', 'bpm').bpm).toBe(P.o1.hrFloorBpm.value)
    expect(factsOf('O1', contextOf(emptyInput()))[0]).toMatchObject({
      template: 'explain.o1-gap',
      state: 'insufficient',
    })
  })
})

describe('heat: D6, I2, I3, I8 and H13', () => {
  const withWbgt = (wbgtC: number | null) =>
    ctxOf('half', { goal: { ...matrix('half').input.goal, raceWbgtC: wbgtC } })

  test('D6 says whether the race heat triggers an acclimation block', () => {
    const hot = factsOf('D6', ctxOf('hot-race'))[0]!
    expect(hot.template).toBe('explain.d6-hot')
    expect(slot(hot, 'trigger', 'temp').c).toBe(P.d6.raceWbgtAcclimationC.value)
    expect(factsOf('D6', withWbgt(12))[0]!.template).toBe('explain.d6-cool')
    expect(factsOf('D6', withWbgt(null))[0]).toMatchObject({
      template: 'explain.heat-gap',
      state: 'insufficient',
    })
  })

  test('I2 and I3 give the band without a penalty and the slope above it', () => {
    const [low, high] = P.i2.wbgtOptimumC.value
    expect(factsOf('I2', withWbgt(12))[0]!.template).toBe('explain.i2-band')
    expect(factsOf('I3', withWbgt(low - 2))[0]!.template).toBe('explain.i2-cool')
    expect(factsOf('I3', withWbgt(high))[0]!.template).toBe('explain.i2-band')
    const slope = factsOf('I3', withWbgt(22))[0]!
    expect(slot(slope, 'low', 'percent').pct).toBeCloseTo(P.i3.slopePctPerC.value, 9)
    expect(slot(slope, 'high', 'percent').pct).toBeCloseTo(P.i3.slopePctPerC.value * 2, 9)
    expect(slot(slope, 'end', 'temp').c).toBe(P.i3.noExtrapolationAboveC.value)
    expect(text(slope)).toBe(
      'The race-day WBGT is about 22 °C. From 15 °C to 25 °C the estimate adds 0.35% to 0.7% for each degree, more for a slower runner.',
    )
    expect(factsOf('I3', withWbgt(null))[0]!.state).toBe('insufficient')
  })

  test('I8 and H13 give the heat adaptation of the hot runs of the last weeks', () => {
    const hotRun = (n: number) =>
      activity(addDays(TODAY, -n), { id: `hot-${String(n)}`, tempC: 28, durationSec: 40 * 60 })
    const ctx = contextOf({
      ...matrix('half').input,
      activities: [...matrix('half').input.activities, ...[1, 2, 3].map(hotRun)],
    })
    expect(ctx.state.heatAcclimation).toBeGreaterThan(0)
    for (const rule of ['I8', 'H13']) {
      const [credit] = factsOf(rule, ctx)
      expect(credit!.id).toBe(`${rule.toLowerCase()}.credit`)
      expect(slot(credit!, 'share', 'share').fraction).toBe(
        Math.round(ctx.state.heatAcclimation * 100) / 100,
      )
      expect(credit!.sources.map((s) => s.id).sort()).toEqual(['hot-1', 'hot-2', 'hot-3'])
    }
    expect(factsOf('I8', ctxOf('half'))[0]).toMatchObject({
      template: 'explain.i8-gap',
      state: 'insufficient',
    })
  })
})

describe('zero minutes are not a number to state', () => {
  const zeroDecision = (kind: 'progress' | 'hold' | 'reduce'): ExplainContext => ({
    ...richCtx,
    decision: { decision: kind, signals: [], nextWeekTargetMin: 0 },
  })

  test('J5 leaves the minutes out of a decision that suggests none', () => {
    for (const kind of ['progress', 'hold', 'reduce'] as const) {
      const out = view({ subject: 'decision', weekStart: MONDAY }, zeroDecision(kind))
      const fact = out.groups.find((g) => g.rule === 'J5')!.facts[0]!
      expect(fact.template).toBe(`explain.j5-${kind}-bare`)
      expect(text(fact)).not.toMatch(/\b0 min\b/)
      expect(text(fact)).toMatch(/^For the week of 19 Oct the plan /)
    }
  })

  test('g-2 does not state a week set at no running as "up to 0 min"', () => {
    const base = richCtx.input.existing!
    const input: EngineInput = {
      ...rich,
      existing: {
        ...base,
        weeks: base.weeks.map((w) => (w.weekStart === MONDAY ? { ...w, targetRunMin: 0 } : w)),
      },
    }
    const facts = factsOf('g-2', contextOf(input))
    const week = facts.find((f) => f.id === 'g-2.plan-week')!
    expect(week.template).toBe('explain.g2-plan-week-none')
    expect(text(week)).toBe('The plan sets no running for the week of 19 Oct.')
  })

  /** The stored plan of `rich` with `change` applied to the weeks that `pick` selects. */
  function withWeeks(pick: (w: WeekDraft) => boolean, change: (w: WeekDraft) => WeekDraft) {
    const base = richCtx.input.existing!
    const input: EngineInput = {
      ...rich,
      existing: { ...base, weeks: base.weeks.map((w) => (pick(w) ? change(w) : w)) },
    }
    return contextOf(input)
  }

  test('E3 does not state a recovery week held whole as "up to 0 min"', () => {
    const recovery = richCtx.input.existing!.weeks.find(
      (w) => w.isRecovery && w.weekStart >= MONDAY,
    )!
    // a rest window over the whole week stores it at no running and keeps its flag
    for (const targetRunMin of [0, 0.4]) {
      const ctx = withWeeks(
        (w) => w.weekStart === recovery.weekStart,
        (w) => ({ ...w, targetRunMin }),
      )
      const next = factsOf('E3', ctx).find((f) => f.id === 'e3.next')!
      expect(next.template).toBe('explain.e3-next-none')
      expect(text(next)).toBe(
        'The next recovery week in your plan starts on 2 Nov, with no running set.',
      )
      expect(text(next)).not.toMatch(/\b0 min\b/)
      expect(next.window).toEqual({ from: recovery.weekStart, to: addDays(recovery.weekStart, 6) })
    }
    expect(recovery.weekStart).toBe('2026-11-02')
    expect(factsOf('E3', richCtx).find((f) => f.id === 'e3.next')!.template).toBe('explain.e3-next')
  })

  test('K2 does not state a taper week held whole as "up to 0 min"', () => {
    const taper = richCtx.input.existing!.weeks.filter((w) => w.isTaper)
    const held = taper[0]!
    const ctx = withWeeks(
      (w) => w.weekStart === held.weekStart,
      (w) => ({ ...w, targetRunMin: 0 }),
    )
    const facts = factsOf('K2', ctx)
    expect(facts[0]!.template).toBe('explain.k2-week-none')
    expect(held.weekStart).toBe('2027-02-22')
    expect(text(facts[0]!)).toBe('The taper week of 22 Feb has no running set.')
    expect(text(facts[0]!)).not.toMatch(/\b0 min\b/)
    // the other taper weeks keep their minutes
    for (const fact of facts.slice(1)) expect(fact.template).toBe('explain.k2-week')
    expect(facts).toHaveLength(Math.min(taper.length, EXPLAIN_MAX_SOURCES))
  })

  /** Two stored weeks, last week's and this week's, and no run in either. */
  function twoWeeks(lastTarget: number, nextTarget: number): ExplainContext {
    const week = (weekStart: string, targetRunMin: number): WeekDraft => ({
      weekStart,
      index: 0,
      phase: 'build',
      focus: 'Build',
      targetRunMin,
      longRunMin: Math.floor(targetRunMin / 2),
      longRunM: null,
      gainTargetM: null,
      runDays: 3,
      qualitySessions: 0,
      strengthSessions: 0,
      tid: { z1: 80, z2: 10, z3: 10 },
      flags: [],
      isRecovery: false,
      isTaper: false,
    })
    return contextOf({
      ...emptyInput(),
      profile: profileOf({}),
      existing: {
        weeks: [week(addDays(MONDAY, -7), lastTarget), week(MONDAY, nextTarget)],
        sessions: [],
      },
    })
  }

  test('g-6 reads a week planned at zero as one with nothing planned to compare with', () => {
    expect(weekEvidence(twoWeeks(0, 110).input, addDays(MONDAY, -7)).plannedMin).toBe(0)
    const [fact] = factsOf('g-6', twoWeeks(0, 110))
    expect(fact).toMatchObject({ template: 'explain.g6-gap', state: 'insufficient' })
  })

  test('g-6 leaves the cap out when nothing was run to build on', () => {
    const facts = factsOf('g-6', twoWeeks(100, 110))
    expect(facts.map((f) => f.id)).toEqual(['g-6.completion'])
    expect(text(facts[0]!)).toBe('In the week of 12 Oct you ran 0 min of 100 min planned.')
  })
})

describe('insufficient states', () => {
  /**
   * The runner with no data that each rule is asked about. The rules about the goal answer "no
   * goal" when there is none; a rule that applies to one kind of goal gets that kind; the
   * profile rules get a profile without the detail they read.
   */
  function emptyContextFor(rule: string): ExplainContext {
    const noGoal = { goal: null, race: null }
    switch (rule) {
      case 'D1':
      case 'D2':
      case 'D4':
      case 'H2':
      case 'H4':
      case 'H5':
      case 'H6':
      case 'H12':
      case 'K1':
      case 'n-7':
        return contextOf(emptyInput(), noGoal)
      case 'D5':
        return contextOf(emptyInput({ distanceM: 160_934, isUltra: true }))
      case 'D7':
        return contextOf(emptyInput({ distanceClass: '5k', distanceM: 5000 }))
      case 'L2':
        return contextOf(emptyInput({ distanceM: 42_195 }))
      case 'L4':
        return contextOf(emptyInput({ distanceM: 160_934 }))
      case 'L5':
        return contextOf(emptyInput({ surface: 'trail', gainM: 2000 }))
      case 'm-sex': {
        const input = emptyInput()
        return contextOf({ ...input, profile: { ...input.profile, sex: null } })
      }
      default:
        return contextOf(emptyInput())
    }
  }

  test('every builder has a gap sentence for a runner with no data', () => {
    for (const rule of Object.keys(INPUT_BUILDERS)) {
      const facts = factsOf(rule, emptyContextFor(rule))
      expect(facts.length, rule).toBeGreaterThan(0)
      expect(
        facts.some((f) => f.state === 'insufficient'),
        rule,
      ).toBe(true)
      for (const fact of facts.filter((f) => f.state === 'insufficient')) {
        for (const units of UNITS) expect(text(fact, units).length, fact.id).toBeGreaterThan(20)
      }
    }
  })

  test('a gap sentence says what is needed and what was found, not how to feel', () => {
    const gaps = Object.keys(INPUT_BUILDERS).flatMap((rule) =>
      factsOf(rule, contextOf(emptyInput({ distanceM: 42_195 }))).filter(
        (f) => f.state === 'insufficient',
      ),
    )
    expect(gaps.length).toBeGreaterThan(20)
    for (const fact of gaps) expect(text(fact)).not.toMatch(/\b(sorry|unfortunately|warning)\b/i)
  })
})

describe('subjects', () => {
  test('a session reads its own rules after the three every run is read against', () => {
    const session = rich.existing!.sessions.find((s) => s.kind === 'long')!
    const out = view({ subject: 'session', id: session.id }, richCtx)
    expect(out.rules.slice(0, 4)).toEqual(['g-1', 'g-2', 'C1', 'C2'])
    expect(out.rules).toEqual(expect.arrayContaining(session.rules))
    expect(out.groups.map((g) => g.rule)).toEqual(['g-1', 'g-2', 'C1', 'C2'])
    // F-lib and F3 have no builder yet: they rest on the rule alone
    expect(out.rest).toEqual(out.rules.filter((rule) => builderFor(rule) === undefined))
    expect(out.rest).toEqual(expect.arrayContaining(['F-lib']))
    expect(out).toMatchObject({ subject: 'session', asOf: TODAY, frozen: false })
  })

  test('every session of the plan explains itself in both unit systems', () => {
    const kinds = new Set<string>()
    for (const session of rich.existing!.sessions) {
      kinds.add(session.kind)
      const out = view({ subject: 'session', id: session.id }, richCtx)
      expect(out.rules, session.id).toEqual(expect.arrayContaining(session.rules))
      for (const fact of out.groups.flatMap((g) => g.facts)) {
        for (const units of UNITS) {
          const sentence = text(fact, units)
          expect(lintText(sentence), `${session.kind} ${fact.id}: ${sentence}`).toEqual([])
        }
      }
    }
    expect(kinds.size).toBeGreaterThan(4)
  })

  test('an unknown session or week is null, so the server can answer 404', () => {
    expect(explainRules({ subject: 'session', id: 'nope' }, richCtx)).toBeNull()
    expect(explainRules({ subject: 'week', weekStart: '2030-01-07' }, richCtx)).toBeNull()
    expect(explainRules({ subject: 'decision', weekStart: '2030-01-07' }, richCtx)).toBeNull()
    expect(explainRules({ subject: 'brief', weekStart: MONDAY }, richCtx)).toBeNull()
    expect(explainRules({ subject: 'activity', id: 'a' }, richCtx)).toBeNull()
    expect(view({ subject: 'session', id: 'nope' }, richCtx).groups).toEqual([])
  })

  test('the other subjects name their rules', () => {
    expect(explainRules({ subject: 'readiness' }, richCtx)).toEqual(['J2', 'J3', 'J4'])
    expect(explainRules({ subject: 'zone' }, richCtx)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'A6'])
    expect(explainRules({ subject: 'zone', boundary: 'hrMax' }, richCtx)).toEqual(['C2', 'C3'])
    expect(explainRules({ subject: 'prediction', goalId: 'g' }, richCtx)).toEqual([
      'L1',
      'L2',
      'L3',
      'L4',
      'L5',
      'L6',
    ])
    expect(explainRules({ subject: 'week', weekStart: MONDAY }, richCtx)).toEqual([
      'g-2',
      'g-6',
      'J5',
    ])
    expect(explainRules({ subject: 'decision', weekStart: MONDAY }, richCtx)).toEqual(['J5', 'g-6'])
  })

  test('requested rules are matched without regard to case, once', () => {
    const out = view({ subject: 'rules', rules: ['G-6', 'g-6', 'a2', 'A2', 'g1'] }, richCtx)
    expect(out.rules).toEqual(['G-6', 'a2', 'g1'])
    expect(out.groups.map((g) => g.rule)).toEqual(['G-6', 'a2'])
    // g1 is the global principle (not the spike guard g-1) and has no figures
    expect(out.rest).toEqual(['g1'])
  })

  test('says which values beyond the snapshot the rules read', () => {
    expect(explainNeeds(['g-1', 'C1'])).toEqual({
      hrModel: false,
      decision: false,
      prediction: false,
      race: false,
    })
    expect(explainNeeds(['a8'])).toMatchObject({ hrModel: true })
    expect(explainNeeds(['J5'])).toMatchObject({ decision: true })
    expect(explainNeeds(['L3'])).toMatchObject({ prediction: true })
    expect(explainNeeds(['F-lib'])).toEqual({
      hrModel: false,
      decision: false,
      prediction: false,
      race: false,
    })
    // the rules about the goal read the goal model; n-7 also the goal time or the prediction
    expect(explainNeeds(['D1', 'k1'])).toMatchObject({ race: true, prediction: false })
    expect(explainNeeds(['n-7'])).toMatchObject({ race: true, prediction: true })
    expect(explainNeeds(['H4', 'I3', 'H12', 'D6'])).toMatchObject({ race: true })
    // the heat adaptation reads the runs, not the goal
    expect(explainNeeds(['I8', 'H13'])).toMatchObject({ race: false })
  })
})

describe('coverage of the rule titles', () => {
  const lower = (ids: readonly string[]) => new Set(ids.map((id) => id.toLowerCase()))
  const built = lower(Object.keys(INPUT_BUILDERS))
  const policy = lower([...POLICY_ONLY_RULES])

  /** The titles that are in neither the builders nor the policy entries, or in both. */
  function misfiled(titles: readonly string[]): string[] {
    return titles.flatMap((id) => {
      const key = id.toLowerCase()
      const homes = [built.has(key), policy.has(key)].filter(Boolean).length
      if (homes === 1) return []
      return [
        homes === 0
          ? `${id} has neither a builder in INPUT_BUILDERS nor a policy entry in POLICY_ONLY_RULES; give it one (a rule that reads the runner's numbers gets a builder with a gap sentence, any other a policy entry and a reason).`
          : `${id} is in both INPUT_BUILDERS and POLICY_ONLY_RULES; a rule title belongs in exactly one.`,
      ]
    })
  }

  test('puts every title in exactly one of the builders and the policy entries', () => {
    expect(misfiled(Object.keys(RULE_TITLES))).toEqual([])
  })

  test('fails on a rule with neither a builder nor a policy entry', () => {
    const wrong = misfiled([...Object.keys(RULE_TITLES), 'zz-9'])
    expect(wrong).toHaveLength(1)
    expect(wrong[0]).toMatch(/^zz-9 has neither a builder/)
  })

  test('covers the rules the later epics added: the device targets, the windows, the fuel rules and the record', () => {
    for (const rule of ['O1', 'J9', 'H7', 'H8', 'H9', 'n-7', 'L7']) {
      expect(built.has(rule.toLowerCase()) || policy.has(rule.toLowerCase()), rule).toBe(true)
    }
    expect(Object.keys(RULE_TITLES).filter((id) => id.toLowerCase() === 'l7')).toHaveLength(1)
  })

  test('lists nothing that is not a title, and no id twice', () => {
    const titles = new Set(Object.keys(RULE_TITLES).map((id) => id.toLowerCase()))
    for (const list of [Object.keys(INPUT_BUILDERS), [...POLICY_ONLY_RULES]]) {
      const keys = list.map((id) => id.toLowerCase())
      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.filter((k) => !titles.has(k))).toEqual([])
    }
  })

  test('a policy or unknown rule rests on the rule alone', () => {
    expect(builderFor('I1')).toBeUndefined()
    const out = view({ subject: 'rules', rules: ['I1', 'F-lib', 'zz-9'] }, richCtx)
    expect(out.groups).toEqual([])
    expect(out.rest).toEqual(['I1', 'F-lib', 'zz-9'])
    expect(isPolicyOnly('f-LIB')).toBe(true)
    expect(isPolicyOnly('i1')).toBe(true)
    expect(isPolicyOnly('H4')).toBe(false)
    expect(builderFor('G-6')).toBe(builderFor('g-6'))
    expect(builderFor('g1')).toBeUndefined()
  })
})

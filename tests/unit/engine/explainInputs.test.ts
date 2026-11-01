// The input builders of "From your numbers" (phase 3a design 8.4, 8.8): dated sources, gap
// sentences, figures that agree with the engine and its Params, determinism, no mutation, and the
// coverage of every rule title.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { COPY_MAX_CHARS, EXPLAIN_MAX_SOURCES } from '../../../shared/copy/limits.ts'
import { EXPLAIN_TEMPLATES } from '../../../shared/copy/explainTemplates.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  loadCappedLine,
  loadHeldLine,
  loadHoldReason,
  loadName,
  loadPanelText,
  LOAD_TEMPLATES,
} from '../../../shared/copy/load.ts'
import { countPhrase } from '../../../shared/copy/quantity.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES, renderFact } from '../../../shared/copy/templates.ts'
import { addDays, daysBetween, isIsoDate, mondayOf } from '../../../shared/dates.ts'
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
  EQUIPMENT_WORDS,
  isPolicyOnly,
  LOAD_METRIC_WORDS,
  METHOD_WORDS,
  POLICY_ONLY_RULES,
  SIGNAL_WORDS,
  type ExplainContext,
} from '../../../shared/engine/explainInputs.ts'
import { feasibility, peakLongRunMin, trainingPace } from '../../../shared/engine/goal.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import {
  noviceRamp,
  plannedMinOf,
  responseBaseline,
  spikeOverrideLimit,
  spikeWarnLimit,
  ultraRunCapMin,
  VOLUME_KINDS,
  weeklyRamp,
} from '../../../shared/engine/limits.ts'
import { criticalSpeed } from '../../../shared/engine/load.ts'
import { startPath, strengthBlockPosition, taperDays } from '../../../shared/engine/macro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import {
  blockLiftMin,
  loadPosition,
  rebuildZone,
  responseBasis,
  zoneBlock,
  type LoadHold,
} from '../../../shared/engine/loadSetting.ts'
import { postRaceWindows } from '../../../shared/engine/postRace.ts'
import { predictFromState } from '../../../shared/engine/predict.ts'
import { readinessSnapshot } from '../../../shared/engine/readiness.ts'
import { estimateOneRm, percentOfMax, workoutFor } from '../../../shared/engine/strength.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type {
  Checkin,
  EngineInput,
  ExplainRequest,
  ExplainView,
  InputFact,
  Quantity,
  SessionKind,
  Step,
  StrengthContext,
  StrengthSessionRef,
  WeekDraft,
} from '../../../shared/engine/types.ts'
import { deliveredShares } from '../../../shared/engine/tid.ts'
import { buildZones } from '../../../shared/engine/zones.ts'
import { formatLoad } from '../../../shared/domain/weight.ts'
import type {
  Activity,
  AthleteProfile,
  Units,
  WeightUnit,
  WellnessDay,
} from '../../../shared/types.ts'
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
import {
  ALL_KINDS,
  context,
  have,
  lb,
  liftLog,
  monday,
  plan,
  sessionRef,
  withSetup,
} from './strength-fixtures.ts'
import {
  at,
  h1,
  h26,
  NO_RESPONSE,
  s3Runs,
  scenario,
  SPARSE,
  summer,
  weeks,
  withResponseWeeks,
  withTaperEnd,
} from './history-fixtures.ts'
import { athletes, TODAY } from './matrix-fixtures.ts'
import { replanChain } from './replan-steps.ts'

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

  test('g-6 and J5 give the same cap under the rebuild zone of a plan at standard [rules g-8]', () => {
    // 75 min run in the week of 12 Oct, 100 planned; the zone is R = 196 min and a step of 12%
    const base = at(h1(), 'standard')
    const input: EngineInput = {
      ...base,
      existing: {
        weeks: [week('2026-10-12', 100), week(MONDAY, 250)],
        sessions: [
          planned('p1', '2026-10-14', 'easy', { durationMin: 50 }),
          planned('p2', '2026-10-18', 'long', { durationMin: 50 }),
        ],
      },
    }
    const ctx = contextOf(input)
    const zone = rebuildZone(input, ctx.state)!
    expect(zone.ceilingMin).toBeCloseTo(196, 9)
    const decision = weeklyDecision(input, '2026-10-12', {
      redsFlags: 0,
      ramp: weeklyRamp(ctx.state),
      rebuild: zone,
    })
    const groups = view(
      { subject: 'decision', weekStart: '2026-10-12' },
      { ...ctx, decision },
    ).groups
    const cap = groups.find((g) => g.rule === 'g-6')!.facts.find((f) => f.id === 'g-6.cap')!
    // min(250 planned, 75 run + 12%) = 84, where the usual 10% would give 82
    expect(decision.nextWeekTargetMin).toBe(84)
    expect(slot(cap, 'minutes', 'minutes').min).toBe(84)
    expect(slot(cap, 'pct', 'percent').pct).toBeCloseTo(12, 9)
    expect(lintText(text(cap))).toEqual([])
    // the ramp fact says the most a week may add, which is the zone's step here
    const [, ramp] = factsOf('g-2', ctx)
    expect(slot(ramp!, 'pct', 'percent').pct).toBeCloseTo(12, 9)
    // at steady the cap is the usual one, and says 10%
    const steady = contextOf({ ...input, options: {} })
    const usual = weeklyDecision(steady.input, '2026-10-12', {
      redsFlags: 0,
      ramp: weeklyRamp(steady.state),
    })
    const steadyCap = view(
      { subject: 'decision', weekStart: '2026-10-12' },
      { ...steady, decision: usual },
    )
      .groups.find((g) => g.rule === 'g-6')!
      .facts.find((f) => f.id === 'g-6.cap')!
    expect(usual.nextWeekTargetMin).toBe(82)
    expect(slot(steadyCap, 'minutes', 'minutes').min).toBe(82)
    expect(slot(steadyCap, 'pct', 'percent').pct).toBeCloseTo(10, 9)
  })

  test('g-2, g-6 and g-8 print the upper step as the load hints do: 14%, not 14.02%', () => {
    // the upper step is the weekly rate at which two weeks meet the ceiling, 14.016...%
    const base = at(h1(), 'upper')
    const input: EngineInput = {
      ...base,
      existing: {
        weeks: [week('2026-10-12', 100), week(MONDAY, 250)],
        sessions: [
          planned('p1', '2026-10-14', 'easy', { durationMin: 50 }),
          planned('p2', '2026-10-18', 'long', { durationMin: 50 }),
        ],
      },
    }
    const ctx = contextOf(input)
    const zone = rebuildZone(input, ctx.state)!
    expect(zone.step).toBeGreaterThan(0.14)
    expect(zone.step).toBeLessThan(0.1402)
    const decision = weeklyDecision(input, '2026-10-12', {
      redsFlags: 0,
      ramp: weeklyRamp(ctx.state),
      rebuild: zone,
    })
    const groups = view(
      { subject: 'decision', weekStart: '2026-10-12' },
      { ...ctx, decision },
    ).groups
    const g2 = factsOf('g-2', ctx)
      .map((fact) => text(fact))
      .find((s) => s.startsWith('The plan adds'))!
    const g6 = groups
      .find((g) => g.rule === 'g-6')!
      .facts.map((fact) => text(fact))
      .find((s) => s.includes('capped'))!
    expect(g2).toBe('The plan adds at most 14% to a week of running.')
    expect(g6).toContain('plus 14%')
    const g8 = factsOf('g-8', ctx).map((fact) => text(fact))
    expect(g8.find((s) => s.startsWith('While a week'))).toContain('adds up to 14% a week')
    for (const sentence of [g2, g6, ...g8]) expect(sentence).not.toMatch(/14\.\d/)
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

// ---------------------------------------------------------------------------------------------
// g-8: the history-informed rebuild
// ---------------------------------------------------------------------------------------------

/** Runs `fn` with a Param set to `value`, then restores it. */
function withParam<T>(param: { value: number }, value: number, fn: () => T): T {
  const before = param.value
  param.value = value
  try {
    return fn()
  } finally {
    param.value = before
  }
}

describe('g-8: the history block, the zone, the setting and the response', () => {
  const injury = {
    area: 'knee',
    side: 'left' as const,
    year: 2026,
    month: 6,
    kind: 'joint' as const,
    notes: null,
  }
  const g8 = (input: EngineInput) => factsOf('g-8', contextOf(input))
  const ids = (facts: InputFact[]) => facts.map((f) => f.id)
  const sentences = (facts: InputFact[], units: Units = 'km') => facts.map((f) => text(f, units))
  /** A fraction as the sentences print it: 12 for 0.12, 87.5 for 0.875. */
  const pct = (fraction: number) => String(Math.round(fraction * 1000) / 10)
  const setting = (name: string) =>
    `Load setting: ${name}. It sets how fast the plan adds running time while rebuilding.`
  const limits = () =>
    `Long runs keep the ${String(P.g1.windowDays.value)}-day rule, and weekly growth stays within ${pct(P.g2.rampCeilingTwoWeeks.value)}% over ${countPhrase(P.g2.ceilingWindowWeeks.value, 'week')} apart from the start and return weeks.`
  /** The block's score is the mean of its weeks without the highest, and the sentence says so. */
  const blockSentence = (ago: string, minutes: number) =>
    `Four steady weeks ending ${ago} ago; without the highest, they averaged ${String(minutes)} min a week.`
  const zoneSentence = (ceilingMin: number, step: number) =>
    `While a week is under ${String(Math.round(ceilingMin))} min, the plan adds up to ${pct(step)}% a week; past that it adds up to ${pct(P.g2.rampSoft.value)}%.`
  const gapSentence = (weeks: number) =>
    `No four steady weeks in the last ${String(weeks)} weeks, so the plan builds from recent weeks.`
  // A runner whose weeks after the summer block run at 1.6 times the plan, re-planned every Monday
  // at standard: the later steps run above their plan, which is what the response reads.
  const base = scenario([...summer(5), ...weeks(4, 1, [40])])
  const chain = replanChain(at(base, 'standard'), { scale: 1.6, maxSteps: 5 })

  test('a runner with a block at standard: the block, the zone, the setting and the limits', () => {
    const input = at(h1(), 'standard')
    const ctx = contextOf(input)
    const facts = factsOf('g-8', ctx)
    const history = ctx.state.history!
    const zone = rebuildZone(input, ctx.state)!
    expect(ids(facts)).toEqual(['g-8.block', 'g-8.zone', 'g-8.setting', 'g-8.limits'])
    expect(sentences(facts)).toEqual([
      blockSentence('eight weeks', 280),
      zoneSentence(P.g8.creditStandard.value * 280, P.g8.stepStandard.value),
      setting('Standard'),
      limits(),
    ])
    expect(facts.every((f) => f.state === 'used')).toBe(true)
    // the figures are the ones the plan read
    expect(history.blockMin).toBe(280)
    expect(slot(facts[0]!, 'minutes', 'minutes').min).toBe(history.blockMin)
    expect(slot(facts[1]!, 'minutes', 'minutes').min).toBe(Math.round(zone.ceilingMin))
    expect(slot(facts[1]!, 'pct', 'percent').pct).toBeCloseTo(zone.step * 100, 0)
    expect(slot(facts[1]!, 'soft', 'percent').pct).toBeCloseTo(P.g2.rampSoft.value * 100, 9)
  })

  test('the block rests on its own runs: the four weeks, newest first, capped, the rest counted', () => {
    const input = at(h1(), 'standard')
    const history = contextOf(input).state.history!
    const [block] = g8(input)
    const from = addDays(history.endWeek, -7 * (P.g8.blockWeeks.value - 1))
    const to = addDays(history.endWeek, 6)
    expect(block!.window).toEqual({ from, to })
    const runs = input.activities.filter((a) => a.type === 'run' && a.date >= from && a.date <= to)
    expect(runs).toHaveLength(16)
    expect(block!.sources).toHaveLength(EXPLAIN_MAX_SOURCES)
    expect(block!.moreSources).toBe(runs.length - EXPLAIN_MAX_SOURCES)
    for (const source of block!.sources) {
      expect(source.kind).toBe('activity')
      expect(source.date >= from && source.date <= to, source.id).toBe(true)
    }
  })

  test('the block states its score, the mean without the highest week, not the mean of the four', () => {
    // 280, 280, 280 and 400 minutes: the score drops the highest, so a plain mean (310) would
    // state more than the plan read
    const steadyRuns = [45, 50, 40]
    const input = at(
      scenario([
        ...weeks(20, 9, [...steadyRuns, 145]),
        ...weeks(8, 8, [...steadyRuns, 265]),
        ...SPARSE,
      ]),
      'standard',
    )
    const ctx = contextOf(input)
    const history = ctx.state.history!
    const rows = ctx.state.weeks
      .filter((w) => w.weekStart >= addDays(history.endWeek, -21) && w.weekStart <= history.endWeek)
      .map((w) => w.runMin)
    expect(rows).toEqual([280, 280, 280, 400])
    expect(history.blockMin).toBe(280)
    const [block] = factsOf('g-8', ctx)
    expect(text(block!)).toBe(blockSentence('eight weeks', 280))
    expect(text(block!)).toContain('without the highest')
    expect(text(block!)).not.toContain('310')
    expect(lintText(text(block!))).toEqual([])
  })

  test('a block older than the full-credit window counts for part of its size, and says so', () => {
    withTaperEnd(16, () => {
      const input = at(scenario([...summer(14), ...SPARSE]), 'standard')
      const ctx = contextOf(input)
      const facts = factsOf('g-8', ctx)
      const window = P.g8.creditWindowWeeks.value
      const taper =
        1 -
        ((1 - P.g8.creditTaperFloor.value) * (14 - window)) /
          (P.g8.creditTaperEndWeeks.value - window)
      expect(ids(facts)).toEqual([
        'g-8.block',
        'g-8.taper',
        'g-8.zone',
        'g-8.setting',
        'g-8.limits',
      ])
      expect(text(facts[0]!)).toBe(blockSentence('14 weeks', 280))
      expect(text(facts[1]!)).toBe(
        `The block ended 14 weeks ago, so it counts for ${pct(taper)}% of its size.`,
      )
      // the zone is the ceiling of the tapered block
      expect(text(facts[2]!)).toBe(
        zoneSentence(P.g8.creditStandard.value * taper * 280, P.g8.stepStandard.value),
      )
      expect(slot(facts[1]!, 'share', 'share').fraction).toBeCloseTo(taper, 9)
    })
  })

  test('a block in full credit has no taper line', () => {
    expect(ids(g8(at(h1(), 'upper')))).not.toContain('g-8.taper')
    withTaperEnd(16, () => {
      expect(ids(g8(at(h1(), 'standard')))).not.toContain('g-8.taper')
    })
  })

  describe('a plan that keeps the block it opened with', () => {
    const standard = () => replanChain(at(h1(), 'standard'), { maxSteps: 14 })

    test('names the block it opened with and what it waits for, in place of a gap', () => {
      const chain = standard()
      const opened = estimateState(chain[0]!.input).history!
      // the re-plan in which the first block is older than the credit window and still kept
      const step = chain.find(
        ({ input }) =>
          mondayOf(input.today) > addDays(opened.endWeek, 7 * (P.g8.creditWindowWeeks.value + 1)) &&
          zoneBlock(input, estimateState(input))!.keptSince !== null,
      )!
      const state = estimateState(step.input)
      const zone = rebuildZone(step.input, state)!
      const facts = g8(step.input)
      expect(ids(facts)).toEqual(['g-8.block', 'g-8.kept', 'g-8.zone', 'g-8.setting', 'g-8.limits'])
      const ago = countPhrase(daysBetween(opened.endWeek, mondayOf(step.input.today)) / 7, 'week')
      expect(text(facts[0]!)).toBe(blockSentence(ago, 280))
      expect(text(facts[1]!)).toBe(
        `This plan began with that block, counted at 100% of its size, and keeps it until a week reaches ${String(Math.round(zone.ceilingMin))} min.`,
      )
      expect(slot(facts[1]!, 'share', 'share').fraction).toBe(opened.taper)
      expect(slot(facts[1]!, 'minutes', 'minutes').min).toBe(Math.round(zone.ceilingMin))
      // the block of the state is another one, or none, and is not what the sentences state
      expect(state.history === null || state.history.blockMin !== opened.blockMin).toBe(true)
    })

    test('says nothing of it once a week has reached R, and a new plan has none', () => {
      const chain = standard()
      const reached = chain.filter(
        ({ input }) => zoneBlock(input, estimateState(input))!.keptSince === null,
      )
      expect(reached.length).toBeGreaterThan(1)
      for (const { input } of reached.slice(1)) expect(ids(g8(input))).not.toContain('g-8.kept')
      expect(ids(g8(chain[0]!.input))).not.toContain('g-8.kept')
      expect(ids(g8({ ...chain[8]!.input, existing: null }))).not.toContain('g-8.kept')
    })

    test('counts a block of 13 to 16 weeks at the share found on the first Monday', () => {
      withTaperEnd(16, () => {
        const first = at(h26(60, 1), 'standard')
        const found = estimateState(first).history!
        expect(found.taper).toBeLessThan(1)
        const chain = replanChain(first, { maxSteps: 4 })
        const kept = chain.filter(
          ({ input }) => zoneBlock(input, estimateState(input))!.keptSince !== null,
        )
        expect(kept.length).toBeGreaterThan(0)
        for (const { input } of kept) {
          const facts = g8(input)
          // the share is that of the first Monday, whatever the block's age is today
          expect(ids(facts)).toContain('g-8.kept')
          expect(ids(facts)).not.toContain('g-8.taper')
          expect(
            slot(
              facts.find((f) => f.id === 'g-8.kept')!,
              'share',
              'share',
            ).fraction,
          ).toBe(found.taper)
        }
      })
    })
  })

  test('with no block it says so, with the window the plan looked in', () => {
    for (const position of ['standard', 'steady'] as const) {
      const input = at(scenario(SPARSE), position)
      const facts = g8(input)
      expect(ids(facts)).toEqual(['g-8.setting', 'g-8.gap', 'g-8.limits'])
      expect(facts[1]).toMatchObject({ state: 'insufficient', template: 'explain.g8-none' })
      expect(text(facts[1]!)).toBe(gapSentence(P.g8.creditTaperEndWeeks.value))
    }
    // a block that ended 14 weeks ago is no block while the window is 12 weeks, and the sentence
    // names the window of the shipped value
    const old = at(scenario([...summer(14), ...SPARSE]), 'standard')
    expect(text(g8(old)[1]!)).toBe(gapSentence(12))
    withTaperEnd(16, () => {
      expect(ids(g8(old))).toContain('g-8.block')
      expect(text(g8(at(scenario(SPARSE), 'standard'))[1]!)).toBe(gapSentence(16))
    })
  })

  test('at steady the block is stated and nothing is said to be in use', () => {
    const facts = g8(h1())
    expect(ids(facts)).toEqual(['g-8.block', 'g-8.setting', 'g-8.limits'])
    expect(text(facts[1]!)).toBe(setting('Steady'))
  })

  describe('a position held at steady', () => {
    const cases: Array<[string, EngineInput, LoadHold]> = [
      ['a recent injury', scenario(s3Runs(), { profile: { injuries: [injury] } }), 'recent-injury'],
      ['a REDs hold', scenario(s3Runs(), { screeningFlags: 2 }), 'reds-hold'],
    ]

    test.each(cases)('%s: the request, the reason, and no zone', (_name, base, hold) => {
      for (const position of ['standard', 'upper'] as const) {
        const input = at(base, position)
        const load = loadPosition(input, estimateState(input))
        expect(load.held).toBe(hold)
        const facts = g8(input)
        expect(ids(facts)).toEqual(['g-8.block', 'g-8.setting', 'g-8.held', 'g-8.limits'])
        expect(text(facts[1]!)).toBe(setting(loadName(position)))
        // the reason is the one the Plan page gives, and the drawer's line is the revision's line
        expect(loadPanelText(load).lead!.rest).toContain(loadHoldReason(hold))
        expect(text(facts[2]!)).toBe(loadHeldLine(hold))
        expect(text(facts[2]!)).toBe(`The steady step applies for now: ${loadHoldReason(hold)}.`)
      }
    })

    test('every reason the engine can name reads as the Plan page reads it', () => {
      const holds: LoadHold[] = [
        'recent-injury',
        'bone-stress',
        'bsi-factors',
        'reds-hold',
        'bone-pain',
        'rest-window',
        'post-race',
      ]
      for (const hold of holds) {
        for (const units of UNITS) {
          const fact = { template: 'explain.g8-held', slots: { reason: loadHoldReason(hold) } }
          const panel = render(LOAD_TEMPLATES['load.held'], { reason: loadHoldReason(hold) }, units)
          expect(renderFact(fact, units), hold).toBe(panel)
        }
      }
    })

    test('a rest window and the weeks after a race are held too', () => {
      const window = {
        id: 'w1',
        reason: 'illness-above-neck' as const,
        mode: 'rest' as const,
        startDate: '2026-10-22',
        endDate: '2026-10-26',
        maxRunMin: null,
        pain: null,
        gaitChange: false,
      }
      const withWindow = { ...h1(), disruptions: [window] }
      const race = activity('2026-10-16', {
        id: 'marathon',
        type: 'race',
        durationSec: 4 * 3600,
        movingSec: 4 * 3600,
        distanceM: 42_195,
      })
      const afterRace = { ...h1(), activities: [...h1().activities, race] }
      for (const [base, hold] of [
        [withWindow, 'rest-window'],
        [afterRace, 'post-race'],
      ] as const) {
        const input = at(base, 'standard')
        expect(loadPosition(input, estimateState(input)).held, hold).toBe(hold)
        const found = ids(g8(input))
        expect(found, hold).toContain('g-8.held')
        expect(found, hold).not.toContain('g-8.zone')
      }
    })

    test('a low-frequency runner with a block is not held: the zone is stated and no reason is', () => {
      // a summer block, then one 70 minute run a week: under two runs a week above the start-path
      // floor, so the flag is on [rules A5] and keeps the cadence, not the setting [rules g-8]
      const base = scenario([...summer(), ...weeks(7, 1, [70])])
      expect(estimateState(base).lowFrequency).toBe(true)
      for (const position of ['standard', 'upper'] as const) {
        const input = at(base, position)
        expect(loadPosition(input, estimateState(input))).toMatchObject({ position, held: null })
        const found = ids(g8(input))
        expect(found, position).toContain('g-8.zone')
        expect(found, position).not.toContain('g-8.held')
      }
    })

    test("is read from the input with the plan's own goal: a logged race that is the goal race holds nothing", () => {
      const race = activity('2026-10-16', {
        id: 'marathon',
        type: 'race',
        durationSec: 4 * 3600,
        movingSec: 4 * 3600,
        distanceM: 42_195,
      })
      const neutral = at({ ...h1(), activities: [...h1().activities, race] }, 'standard')
      // the plan's goal is that marathon, so its window is the goal race's own, not a past race's
      const own: EngineInput = {
        ...neutral,
        goal: {
          ...neutral.goal,
          date: '2026-10-16',
          distanceM: 42_195,
          distanceClass: 'marathon',
          isUltra: false,
          expectedDurationSec: 4 * 3600,
        },
      }
      const state = estimateState(neutral)
      expect(loadPosition(neutral, state).held).toBe('post-race')
      expect(loadPosition(own, state).held).toBeNull()
      // read about the athlete, the race is a past race and the drawer states the hold ...
      const without = factsOf('g-8', contextOf(neutral))
      expect(ids(without)).toContain('g-8.held')
      expect(ids(without)).not.toContain('g-8.zone')
      // ... and with the plan's own input it states what the Plan page states: no hold, the zone
      const withPlan = factsOf('g-8', contextOf(neutral, { planInput: own }))
      expect(ids(withPlan)).not.toContain('g-8.held')
      expect(ids(withPlan)).toContain('g-8.zone')
      expect(loadPanelText(loadPosition(own, state)).lead).toBeNull()
    })
  })

  test('age 45 or over: upper is shown as chosen, held at standard, with the zone of standard', () => {
    const input = at(scenario(s3Runs(), { profile: { birthYear: 1980 } }), 'upper')
    const ctx = contextOf(input)
    const load = loadPosition(input, ctx.state)
    expect(load.ageCapped).toBe(true)
    const facts = factsOf('g-8', ctx)
    expect(ids(facts)).toEqual(['g-8.block', 'g-8.zone', 'g-8.setting', 'g-8.capped', 'g-8.limits'])
    expect(text(facts[1]!)).toBe(
      zoneSentence(P.g8.creditStandard.value * 280, P.g8.stepStandard.value),
    )
    expect(text(facts[2]!)).toBe(setting('Upper band'))
    expect(text(facts[3]!)).toBe(loadCappedLine())
    expect(text(facts[3]!)).toBe(
      `The setting is held at Standard: age ${String(P.a9.noviceFlagAgeMin.value)} or over.`,
    )
    // standard at the same age is not capped
    expect(
      ids(g8(at(scenario(s3Runs(), { profile: { birthYear: 1980 } }), 'standard'))),
    ).not.toContain('g-8.capped')
  })

  test('upper: the zone is the larger credit and the step that meets the hard ceiling', () => {
    const input = at(h1(), 'upper')
    const facts = g8(input)
    expect(text(facts[1]!)).toBe(
      zoneSentence(P.g8.creditUpper.value * 280, Math.sqrt(1 + P.g2.rampCeilingTwoWeeks.value) - 1),
    )
    expect(text(facts[2]!)).toBe(setting('Upper band'))
  })

  describe('the response to weeks run above plan', () => {
    const responseOf = (input: EngineInput) => g8(input).find((fact) => fact.id === 'g-8.response')
    /** The week plans of a re-plan, one number per week: the targets. */
    const targets = (input: EngineInput) => replan(input).draft.weeks.map((w) => w.targetRunMin)

    test('is stated exactly when the response lifts the next week of the plan, with the figures it read', () => {
      let engaged = 0
      for (const [k, { input }] of chain.entries()) {
        const state = estimateState(input)
        const mean = responseBasis(input, state)?.meanMin ?? null
        const fact = responseOf(input)
        // the response is what the re-plan adds over the same input without it
        const lifted =
          input.existing !== null &&
          JSON.stringify(targets(input)) !==
            JSON.stringify(withResponseWeeks(NO_RESPONSE, () => targets(input)))
        expect(fact !== undefined, `step ${String(k)}`).toBe(lifted)
        if (fact === undefined) continue
        engaged += 1
        const planned = slot(fact, 'planned', 'minutes').min
        expect(slot(fact, 'n', 'count').n).toBe(P.g8.responseWeeks.value)
        expect(slot(fact, 'mean', 'minutes').min).toBe(Math.round(mean!))
        expect(planned).toBeLessThan(Math.round(mean!))
        // the week builds from the mean up to the two-week ceiling over the planned baseline
        const from = slot(fact, 'from', 'minutes').min
        expect(from).toBeGreaterThan(planned)
        expect(from).toBeLessThanOrEqual(Math.round(mean!))
        expect(from).toBeLessThanOrEqual(
          Math.round(planned * (1 + P.g2.rampCeilingTwoWeeks.value)) + 1,
        )
        // the planned baseline is the minutes of one week, never a sum of weeks
        const weekMinutes = [
          ...state.weeks.map((w) => Math.round(w.runMin)),
          ...input.existing!.weeks.map((w) => Math.round(plannedMinOf(w))),
        ]
        expect(weekMinutes, `step ${String(k)}`).toContain(planned)
        expect(text(fact)).toBe(
          `The last ${String(P.g8.responseWeeks.value)} weeks averaged ${String(Math.round(mean!))} min a week, above the ${String(planned)} min planned, so the next week builds from ${String(from)} min.`,
        )
        expect(fact.state).toBe('used')
      }
      // a chain that never passed its plan would test nothing
      expect(engaged).toBeGreaterThan(0)
    })

    test('steps from the minutes the current week was planned at, not from the weeks as run', () => {
      const input = chain.at(-1)!.input
      const monday = mondayOf(input.today)
      const current = input.existing!.weeks.find((w) => w.weekStart === monday)!
      const fact = responseOf(input)!
      expect(slot(fact, 'planned', 'minutes').min).toBe(Math.round(plannedMinOf(current)))
      // the week before ran above the current week as planned, and does not set the figure: the
      // re-plan carries the planned sequence on, and the weeks as run only bound a week
      const before = estimateState(input).weeks.find((w) => w.weekStart === addDays(monday, -7))!
      expect(before.runMin).toBeGreaterThan(plannedMinOf(current))
      expect(slot(fact, 'planned', 'minutes').min).toBeLessThan(Math.round(before.runMin))
    })

    test('steps from the last loading week when the current week is a recovery week', () => {
      const input = chain.at(-1)!.input
      const monday = mondayOf(input.today)
      const weeksOf = input.existing!.weeks
      const recovery: EngineInput = {
        ...input,
        existing: {
          ...input.existing!,
          weeks: weeksOf.map((w) =>
            w.weekStart === monday
              ? { ...w, isRecovery: true, flags: [...w.flags, 'recovery'] }
              : w,
          ),
        },
      }
      const lastLoading = weeksOf.filter((w) => w.weekStart < monday && !w.isRecovery).at(-1)!
      const mean = responseBasis(recovery, estimateState(recovery))!.meanMin!
      expect(mean).toBeGreaterThan(plannedMinOf(lastLoading))
      expect(slot(responseOf(recovery)!, 'planned', 'minutes').min).toBe(
        Math.round(plannedMinOf(lastLoading)),
      )
    })

    test('comes after the setting and before the limits', () => {
      const input = chain.map((step) => step.input).find((i) => responseOf(i) !== undefined)!
      const found = ids(g8(input))
      expect(found.indexOf('g-8.response')).toBeGreaterThan(found.indexOf('g-8.setting'))
      expect(found.indexOf('g-8.response')).toBeLessThan(found.indexOf('g-8.limits'))
    })

    test('builds from the baseline the response lifts to: the mean up to the two-week ceiling over the plan', () => {
      // one week run at eight times its plan among three run as planned: the mean is far above the
      // plan, so the baseline stops at the ceiling over the planned one
      const outlier = replanChain(at(base, 'standard'), {
        scale: (step) => (step === 3 ? 8 : 1),
        maxSteps: 4,
      })
      let bounded = 0
      for (const [k, { input }] of outlier.entries()) {
        const fact = responseOf(input)
        const basis = responseBasis(input, estimateState(input))
        if (fact === undefined) continue
        const mean = basis!.meanMin!
        const planned = slot(fact, 'planned', 'minutes').min
        const exact = responseBaseline(planned, basis, noviceRamp(estimateState(input)))
        expect(slot(fact, 'from', 'minutes').min, `step ${String(k)}`).toBe(Math.round(exact))
        if (Math.round(exact) < Math.round(mean)) bounded += 1
      }
      // a chain in which the bound never held would test nothing
      expect(bounded).toBeGreaterThan(0)
    })

    test('is left out when the newest eligible week was run under its stored target', () => {
      const engaged = chain.map((step) => step.input).find((i) => responseOf(i) !== undefined)!
      const newest = addDays(mondayOf(engaged.today), -7)
      const under: EngineInput = {
        ...engaged,
        existing: {
          ...engaged.existing!,
          weeks: engaged.existing!.weeks.map((w) =>
            w.weekStart === newest ? { ...w, targetRunMin: 100_000 } : w,
          ),
        },
      }
      expect(responseBasis(under, estimateState(under))).toEqual({ meanMin: null })
      expect(responseOf(under)).toBeUndefined()
    })

    test('is left out at steady, without a stored plan, and without a mean to state', () => {
      const engaged = chain.map((step) => step.input).find((i) => responseOf(i) !== undefined)!
      expect(responseOf(at(engaged, 'steady'))).toBeUndefined()
      expect(responseOf({ ...engaged, existing: null })).toBeUndefined()
      withResponseWeeks(NO_RESPONSE, () => {
        expect(responseOf(engaged)).toBeUndefined()
      })
      for (const { input } of replanChain(base, { scale: 1.6, maxSteps: 5 })) {
        expect(responseOf(input)).toBeUndefined()
      }
    })
  })

  test('every number comes from a Param: the count of weeks, the window and the limits', () => {
    const word = (n: number) => countPhrase(n, 'steady week')
    withParam(P.g8.blockWeeks, 3, () => {
      expect(text(g8(h1())[0]!)).toMatch(/^Three steady weeks ending /)
      expect(word(3)).toBe('three steady weeks')
      expect(text(g8(scenario(SPARSE))[1]!)).toBe(
        `No ${word(3)} in the last 12 weeks, so the plan builds from recent weeks.`,
      )
    })
    withParam(P.g2.rampCeilingTwoWeeks, 0.25, () => {
      expect(text(g8(h1()).at(-1)!)).toContain('weekly growth stays within 25% over two weeks')
    })
    withParam(P.g2.ceilingWindowWeeks, 3, () => {
      expect(text(g8(h1()).at(-1)!)).toContain('over three weeks')
    })
    withParam(P.g1.windowDays, 21, () => {
      expect(text(g8(h1()).at(-1)!)).toContain('the 21-day rule')
    })
    withParam(P.g2.rampSoft, 0.08, () => {
      expect(text(g8(at(h1(), 'standard'))[1]!)).toContain('past that it adds up to 8%')
    })
  })

  test('every sentence is clean, short, finished and free of a raw date in both unit systems', () => {
    const afterTaper = withTaperEnd(16, () => g8(at(scenario([...summer(14), ...SPARSE]), 'upper')))
    const all = [
      ...g8(h1()),
      ...g8(at(h1(), 'standard')),
      ...g8(at(h1(), 'upper')),
      ...g8(at(scenario(SPARSE), 'standard')),
      ...g8(at(scenario(s3Runs(), { profile: { birthYear: 1980 } }), 'upper')),
      ...g8(at(scenario(s3Runs(), { profile: { injuries: [injury] } }), 'standard')),
      ...afterTaper,
      ...chain.flatMap((step) => g8(step.input)),
      ...replanChain(at(h1(), 'standard'), { maxSteps: 9 }).flatMap((step) => g8(step.input)),
    ]
    expect(all.length).toBeGreaterThan(30)
    // every template of the rule is produced by a builder here, and no fact uses another one
    const registered = Object.keys(EXPLAIN_TEMPLATES).filter((id) => id.startsWith('explain.g8-'))
    expect(registered).toHaveLength(10)
    expect([...new Set(all.map((f) => f.template))].sort()).toEqual(registered.sort())
    for (const fact of all) {
      expect(fact.id.startsWith('g-8.'), fact.id).toBe(true)
      expect(fact.template.startsWith('explain.g8-'), fact.id).toBe(true)
      for (const units of UNITS) {
        const sentence = text(fact, units)
        expect(lintText(sentence), `${fact.id}: ${sentence}`).toEqual([])
        expect(sentence.length, sentence).toBeLessThanOrEqual(COPY_MAX_CHARS)
        expect(sentence, fact.id).toMatch(/[.?]$/)
        expect(sentence, fact.id).not.toMatch(/\d{4}-\d{2}-\d{2}|NaN|undefined|null|\{|\}/)
        // the sentence states the rule and claims nothing about safety, injury or the runner
        expect(sentence, sentence).not.toMatch(/\b(safe|unsafe|protect\w*|prevent\w*|you|your)\b/i)
      }
      // the same in miles and in kilometres: minutes, shares and counts have no unit system
      expect(text(fact, 'km'), fact.id).toBe(text(fact, 'mi'))
    }
  })

  describe('where the drawer lists g-8', () => {
    const standard = withPlan(at(h1(), 'standard'))
    const steady = withPlan(h1())
    const standardCtx = contextOf(standard)
    const steadyCtx = contextOf(steady)
    const monday = standard.existing!.weeks[1]!.weekStart
    const easy = standard.existing!.sessions.find((s) => VOLUME_KINDS.has(s.kind))!
    const other = standard.existing!.sessions.find((s) => !VOLUME_KINDS.has(s.kind))

    test('a week and a run of a plan set above steady read g-8 right after the weekly ramp', () => {
      expect(explainRules({ subject: 'week', weekStart: monday }, standardCtx)).toEqual([
        'g-2',
        'g-8',
        'g-6',
        'J5',
      ])
      expect(explainRules({ subject: 'session', id: easy.id }, standardCtx)!.slice(0, 5)).toEqual([
        'g-1',
        'g-2',
        'g-8',
        'C1',
        'C2',
      ])
    })

    test('a session that is no run, and a plan at steady, list what they always did', () => {
      expect(other, 'the plan has a session that is no run').toBeDefined()
      expect(explainRules({ subject: 'session', id: other!.id }, standardCtx)).not.toContain('g-8')
      expect(explainRules({ subject: 'week', weekStart: monday }, steadyCtx)).toEqual([
        'g-2',
        'g-6',
        'J5',
      ])
      const run = steady.existing!.sessions.find((s) => VOLUME_KINDS.has(s.kind))!
      expect(explainRules({ subject: 'session', id: run.id }, steadyCtx)!.slice(0, 4)).toEqual([
        'g-1',
        'g-2',
        'C1',
        'C2',
      ])
    })

    test('the facts sit in their own group, among the rules of the week and of the run', () => {
      for (const request of [
        { subject: 'week', weekStart: monday },
        { subject: 'session', id: easy.id },
      ] as const) {
        const out = view(request, standardCtx)
        const rules = out.groups.map((group) => group.rule)
        expect(rules, request.subject).toContain('g-8')
        expect(rules.indexOf('g-8'), request.subject).toBe(rules.indexOf('g-2') + 1)
        expect(out.rest, request.subject).not.toContain('g-8')
        const group = out.groups.find((candidate) => candidate.rule === 'g-8')!
        expect(group.facts.map((fact) => fact.template)).toContain('explain.g8-zone')
      }
    })
  })

  test('g-8 has a builder and no policy entry, and its title is the one the drawer shows', () => {
    expect(builderFor('g-8')).toBe(INPUT_BUILDERS['g-8'])
    expect(isPolicyOnly('g-8')).toBe(false)
    expect(RULE_TITLES['g-8']).toBe('History-informed rebuild')
    // never read-only: a runner with no data at all still gets a sentence
    expect(factsOf('g-8', contextOf(emptyInput())).some((f) => f.state === 'insufficient')).toBe(
      true,
    )
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
    expect(slot(now!, 'weeks', 'count').n).toBe(P.d3.weeklyFloorWeeks.value)
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
    // the 30 min come from the years of running, which the second fact names
    expect(facts.map((f) => f.template)).toEqual(['explain.e6-floor', 'explain.e6-lift-years'])
    expect(text(facts[0]!)).toBe('You start with 3 runs of 30 min a week, then build from there.')
    expect(slot(facts[0]!, 'session', 'minutes').min).toBe(firstRun(ctx).durationMin)
    expect(text(facts[1]!)).toBe(
      'Sessions longer than 20 min are allowed at the start because of 2 or more years of running and no flag that holds a start back.',
    )
  })

  test('E6 names the block that lifted a one-year runner to 3 x 30 at standard, and no route at steady', () => {
    const standard = factsOf('E6', contextOf(at(h1(), 'standard')))
    expect(standard.map((f) => f.template)).toEqual([
      'explain.e6-floor',
      'explain.e6-lift-block',
      'explain.e6-lift-block-weeks',
    ])
    expect(text(standard[0]!)).toBe(
      'You start with 3 runs of 30 min a week, then build from there.',
    )
    expect(text(standard[1]!)).toBe(
      'Sessions longer than 20 min are allowed at the start: at least one year of running and a recent block of steady weeks.',
    )
    // the block's score is the mean of its weeks without the highest, and the sentence says so
    expect(text(standard[2]!)).toBe(
      'That block is 4 steady weeks that, without the highest, averaged at least 90 min a week and ended within 12 weeks.',
    )
    for (const fact of standard) {
      expect(lintText(text(fact)), fact.id).toEqual([])
      expect(text(fact).length, fact.id).toBeLessThanOrEqual(COPY_MAX_CHARS)
    }
    // the year count and the minutes come from the Params, through the one threshold of the route
    expect(slot(standard[2]!, 'minimum', 'minutes').min).toBe(blockLiftMin())
    withParam(P.a5.noviceMaxYears, 3, () => {
      // a runner of 46 with three years of running: the years route is closed by age, the block's is open
      const aged = at(scenario(s3Runs(), { years: 3, profile: { birthYear: 1980 } }), 'standard')
      const route = factsOf('E6', contextOf(aged)).find(
        (f) => f.template === 'explain.e6-lift-block',
      )
      expect(text(route!)).toContain('at least three years of running')
    })
    // steady is the start of 3 x 20 with no lift to name
    const steady = factsOf('E6', contextOf(h1()))
    expect(steady.map((f) => f.template)).toEqual(['explain.e6-floor'])
    expect(text(steady[0]!)).toBe('You start with 3 runs of 20 min a week, then build from there.')
    // a block route that leaves N at 20 (the longest run of the last 30 days is 20 to 24 min) names nothing
    const short = scenario(
      s3Runs().map((r) => (r.weeksBack <= 7 ? { ...r, min: Math.min(r.min, 22) } : r)),
      { options: { loadAppetite: 'standard' } },
    )
    expect(factsOf('E6', contextOf(short)).map((f) => f.template)).toEqual(['explain.e6-floor'])
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

  test('E4 states what the week holds by planned minutes, then the aim it was drawn from', () => {
    const ctx = ctxOf('marathon')
    const [week, aim, ...rest] = factsOf('E4', ctx)
    expect(rest).toEqual([])
    const stored = ctx.input.existing!.weeks.find((w) => w.weekStart === MONDAY)!
    const sessions = ctx.input.existing!.sessions.filter((s) => mondayOf(s.date) === MONDAY)
    // the first fact is the sessions' own time in each zone, as whole percents that add up to 100
    expect(week!.id).toBe('e4.week')
    expect(week!.template).toBe('explain.e4-week')
    const held = deliveredShares(sessions, 'marathon')!
    const shown = [
      slot(week!, 'z1', 'percent').pct,
      slot(week!, 'z2', 'percent').pct,
      slot(week!, 'z3', 'percent').pct,
    ]
    expect(shown.reduce((sum, n) => sum + n, 0)).toBe(100)
    for (const [i, exact] of [held.z1, held.z2, held.z3].entries()) {
      expect(Math.abs(shown[i]! - exact)).toBeLessThan(1)
    }
    expect(text(week!)).toBe(
      `Planned minutes in the week of 19 Oct: ${String(shown[0])}% in zone 1, ${String(shown[1])}% in zone 2 and ${String(shown[2])}% in zone 3, with work blocks at their zone and the rest at zone 1.`,
    )
    // the second is the band the plan drew the week from, kept as the aim
    expect(aim!.id).toBe('e4.aim')
    expect(slot(aim!, 'z1', 'percent').pct).toBe(stored.tid.z1)
    expect(slot(aim!, 'z2', 'percent').pct).toBe(stored.tid.z2)
    expect(slot(aim!, 'z3', 'percent').pct).toBe(stored.tid.z3)
    expect(text(aim!)).toBe(
      `The aim for a base week is ${String(stored.tid.z1)}% in zone 1, ${String(stored.tid.z2)}% in zone 2 and ${String(stored.tid.z3)}% in zone 3.`,
    )
    // a session reads the week it falls in
    const later = ctx.input.existing!.sessions.find(
      (s) => s.date >= addDays(MONDAY, 14) && s.rules.includes('E4'),
    )!
    const monday = addDays(mondayOf(later.date), 0)
    const forSession = view({ subject: 'session', id: later.id }, ctx).groups.find(
      (g) => g.rule === 'E4',
    )!.facts
    const storedLater = ctx.input.existing!.weeks.find((w) => w.weekStart === monday)!
    expect(forSession.map((f) => f.window)).toEqual([
      { from: monday, to: addDays(monday, 6) },
      { from: monday, to: addDays(monday, 6) },
    ])
    expect(slot(forSession[1]!, 'z1', 'percent').pct).toBe(storedLater.tid.z1)
  })

  test('E4 counts a week of known sessions: threshold work in zone 2, interval work in zone 3', () => {
    // Tue easy 40, Wed threshold 50 (20 min zone 2), Fri intervals 45 (4 x 3 min zone 3), Sun long
    // 90: zone 1 193, zone 2 20, zone 3 12 of 225 minutes, 85.78 / 8.89 / 5.33 percent. By largest
    // remainder the whole percents are 86 / 9 / 5.
    const base = ctxOf('marathon')
    const step = (
      kind: 'warmup' | 'work' | 'recover' | 'cooldown',
      reps: number,
      sec: number,
      zone: 'z1' | 'z2' | 'z3',
    ) => ({ kind, reps, durationSec: sec, distanceM: null, zone })
    const template = base.input.existing!.sessions[0]!
    const made = (day: number, kind: SessionKind, durationMin: number, structure: Step[] = []) => ({
      ...template,
      id: `known-${String(day)}`,
      date: addDays(MONDAY, day),
      kind,
      durationMin,
      structure,
    })
    const known = [
      made(1, 'easy', 40),
      made(2, 'threshold', 50, [
        step('warmup', 1, 600, 'z1'),
        step('work', 1, 1200, 'z2'),
        step('cooldown', 1, 600, 'z1'),
      ]),
      made(4, 'intervals', 45, [
        step('warmup', 1, 600, 'z1'),
        step('work', 4, 180, 'z3'),
        step('recover', 4, 180, 'z1'),
        step('cooldown', 1, 600, 'z1'),
      ]),
      made(6, 'long', 90),
    ]
    const existing = base.input.existing!
    const ctx = {
      ...base,
      input: {
        ...base.input,
        existing: {
          weeks: existing.weeks,
          sessions: [...existing.sessions.filter((s) => mondayOf(s.date) !== MONDAY), ...known],
        },
      },
    }
    expect(text(factsOf('E4', ctx)[0]!)).toBe(
      'Planned minutes in the week of 19 Oct: 86% in zone 1, 9% in zone 2 and 5% in zone 3, with work blocks at their zone and the rest at zone 1.',
    )
  })

  test('E4 says so when the plan sets no running in the week', () => {
    const base = ctxOf('marathon')
    const existing = base.input.existing!
    const ctx = {
      ...base,
      input: {
        ...base.input,
        existing: {
          weeks: existing.weeks,
          sessions: existing.sessions.filter((s) => mondayOf(s.date) !== MONDAY),
        },
      },
    }
    const facts = factsOf('E4', ctx)
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ id: 'e4.week', template: 'explain.e4-week-none' })
    expect(text(facts[0]!)).toBe(
      'The plan sets no running for the week of 19 Oct, so no minutes fall in any zone.',
    )
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
    expect(strength.map((f) => f.id)).toEqual(['h10.week', 'h10.block', 'h10.wanted'])
    expect(text(strength[2]!)).toBe('Your profile asks for 2 strength sessions a week.')
    // the block week is read from the flags of the stored plan, as the engine counts it
    const at = strengthBlockPosition(weeks, mondayOf(TODAY))
    expect(at, 'the next week of the 100-mile plan is in the strength block').not.toBeNull()
    expect(strength[1]!.template).toBe('explain.h10-block')
    expect(slot(strength[1]!, 'k', 'count').n).toBe(at!.week)
    expect(slot(strength[1]!, 'n', 'count').n).toBe(at!.of)
    expect(text(strength[1]!)).toMatch(
      new RegExp(`is week ${String(at!.week)} of ${String(at!.of)} of the strength block\\.$`),
    )
    // H10 is the ultra rule: the sessions of any other goal cite E5 and F7, so it has nothing to state
    expect(factsOf('H10', ctxOf('marathon'))).toEqual([])

    const taper = weeks.filter((w) => w.isTaper)
    const [k1] = factsOf('K1', ctx)
    expect(slot(k1!, 'days', 'count').n).toBe(taperDays(ctx.race!, ctx.state))
    expect(slot(k1!, 'week', 'date').iso).toBe(taper[0]!.weekStart)
    const k2 = factsOf('K2', ctx)
    expect(k2.map((f) => slot(f, 'minutes', 'minutes').min)).toEqual(
      taper.slice(0, EXPLAIN_MAX_SOURCES).map((w) => Math.round(w.targetRunMin)),
    )
    for (const rule of ['H7', 'H10', 'K2']) {
      const input =
        rule === 'H10' ? emptyInput({ distanceM: 160_934, isUltra: true }) : emptyInput()
      expect(factsOf(rule, contextOf(input)).at(-1), rule).toMatchObject({
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
      case 'H10':
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
      planInput: false,
      strength: false,
    })
    expect(explainNeeds(['a8'])).toMatchObject({ hrModel: true })
    expect(explainNeeds(['J5'])).toMatchObject({ decision: true })
    expect(explainNeeds(['L3'])).toMatchObject({ prediction: true })
    expect(explainNeeds(['F-lib'])).toEqual({
      hrModel: false,
      decision: false,
      prediction: false,
      race: false,
      planInput: false,
      strength: false,
    })
    // the rules that read the load setting need the input with the plan's own goal
    expect(explainNeeds(['g-2'])).toMatchObject({ planInput: true })
    expect(explainNeeds(['G-6', 'a1'])).toMatchObject({ planInput: true })
    expect(explainNeeds(['g-8'])).toMatchObject({ planInput: true })
    expect(explainNeeds(['E6'])).toMatchObject({ planInput: true })
    expect(explainNeeds(['g-1', 'J5'])).toMatchObject({ planInput: false })
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

// ---------------------------------------------------------------------------------------------
// F7 to F9: a strength session, its loads and its lighter days (strength design 10.5, ADR 0014)
// ---------------------------------------------------------------------------------------------

describe('F7, F8 and F9: a strength session', () => {
  const SESSION_RULES = ['F-lib', 'F4', 'E5', 'F7']
  const heavy = sessionRef(5)
  const WEIGHT_UNITS: readonly WeightUnit[] = ['lb', 'kg']

  /** The explain context of the strength session `ref` over the strength input `strength`. */
  function strengthCtx(
    strength: StrengthContext | null,
    ref: StrengthSessionRef = heavy,
    over: Partial<ExplainContext> = {},
  ): ExplainContext {
    const session = planned(ref.id, ref.date, 'strength', {
      order: ref.order,
      durationMin: ref.durationMin,
      rules: [...ref.rules],
    })
    const input: EngineInput = { ...emptyInput(), existing: { weeks: [], sessions: [session] } }
    return contextOf(input, { strength, ...over })
  }

  function ask(
    strength: StrengthContext | null,
    ref: StrengthSessionRef = heavy,
    exercise?: string,
  ): ExplainView {
    return view(
      { subject: 'strength', id: ref.id, ...(exercise === undefined ? {} : { exercise }) },
      strengthCtx(strength, ref),
    )
  }
  const groupOf = (out: ExplainView, rule: string): InputFact[] =>
    out.groups.find((g) => g.rule === rule)?.facts ?? []
  const said = (facts: InputFact[], units: Units = 'km', weight: WeightUnit = 'lb'): string[] =>
    facts.map((fact) => renderFact(fact, units, weight))

  /** A runner with a barbell, dumbbells and a step in week 6 of a block of 12, nothing logged. */
  const equipped = (over: Partial<StrengthContext> = {}) =>
    withSetup({ equipment: have('barbell', 'dumbbells', 'step') }, { today: heavy.date, ...over })

  /** Four sets of six at 110 lb with two reps left, three days before the session. */
  const squatLog = (id = 'log-1', rirs: number[] = [2, 2, 2, 2]) =>
    liftLog(
      id,
      addDays(heavy.date, -3),
      'back-squat',
      rirs.map((rir) => [110, 6, rir] as const),
      { implement: 'barbell', baseLb: 110, template: 'heavy', activityId: `act-${id}` },
    )

  describe('the subject', () => {
    test('lists the load, the lighter day and the structure, then the session’s own rules', () => {
      const strength = equipped()
      expect(explainRules({ subject: 'strength', id: heavy.id }, strengthCtx(strength))).toEqual([
        'F8',
        'F9',
        'F7',
        'F-lib',
        'F4',
        'E5',
      ])
      const ultra = { ...heavy, rules: [...SESSION_RULES, 'H10'] }
      expect(
        explainRules({ subject: 'strength', id: ultra.id }, strengthCtx(strength, ultra)),
      ).toEqual(['F8', 'F9', 'F7', 'F-lib', 'F4', 'E5', 'H10'])
    })

    test('is an unknown record for a session that is not a strength session of the plan', () => {
      const ctx = strengthCtx(equipped())
      expect(explainRules({ subject: 'strength', id: 'nope' }, ctx)).toBeNull()
      const run = {
        ...ctx.input,
        existing: { weeks: [], sessions: [planned('run1', MONDAY, 'easy')] },
      }
      expect(explainRules({ subject: 'strength', id: 'run1' }, { ...ctx, input: run })).toBeNull()
      expect(view({ subject: 'strength', id: 'nope' }, ctx).groups).toEqual([])
    })

    test('is an unknown record for a lift that the session cannot do, and takes one it can swap in', () => {
      const strength = equipped()
      const ctx = strengthCtx(strength)
      // a jump is a dose, and the leg press needs a machine the runner has not saved
      for (const exercise of ['pogo-hop', 'leg-press', 'not-an-exercise']) {
        expect(
          explainRules({ subject: 'strength', id: heavy.id, exercise }, ctx),
          exercise,
        ).toBeNull()
      }
      // a lift of the workout, and one the dumbbells make that is not in it
      for (const exercise of ['back-squat', 'goblet-squat']) {
        expect(
          explainRules({ subject: 'strength', id: heavy.id, exercise }, ctx),
          exercise,
        ).not.toBeNull()
      }
      // without the strength input there is nothing to check the lift against
      expect(
        explainRules(
          { subject: 'strength', id: heavy.id, exercise: 'pogo-hop' },
          strengthCtx(null),
        ),
      ).not.toBeNull()
    })

    test('the session subject of a strength session lists its own rules and no run rule', () => {
      const out = view({ subject: 'session', id: heavy.id }, strengthCtx(equipped()))
      expect(out.rules).toEqual(SESSION_RULES)
      for (const run of ['g-1', 'g-2', 'C1', 'C2']) expect(out.rules).not.toContain(run)
      expect(out.groups.map((g) => g.rule)).toEqual(['F7'])
      expect(out.rest).toEqual(['F-lib', 'F4', 'E5'])
    })

    test('gives F7, F8 and F9 builders, not policy entries, and reads the strength input', () => {
      for (const rule of ['F7', 'F8', 'F9']) {
        expect(builderFor(rule), rule).toBeDefined()
        expect(isPolicyOnly(rule), rule).toBe(false)
        expect(RULE_TITLES[rule], rule).toBeDefined()
      }
      for (const rule of ['F4', 'E5', 'F-lib']) expect(isPolicyOnly(rule), rule).toBe(true)
      expect(explainNeeds(['F7'])).toMatchObject({ strength: true })
      expect(explainNeeds(['f8', 'g-1'])).toMatchObject({ strength: true })
      expect(explainNeeds(['F9'])).toMatchObject({ strength: true })
      expect(explainNeeds(['F4', 'E5', 'F-lib', 'g-1'])).toMatchObject({ strength: false })
      // H10 reads the goal: it is the rule of the ultra goal
      expect(explainNeeds(['H10'])).toMatchObject({ race: true, strength: false })
    })
  })

  describe('a gap sentence says what is needed', () => {
    test.each(['F7', 'F8', 'F9'])(
      '%s asked by id alone, or for a session without the input',
      (rule) => {
        for (const ctx of [contextOf(emptyInput()), strengthCtx(null)]) {
          const facts = factsOf(rule, ctx)
          expect(facts).toHaveLength(1)
          expect(facts[0]).toMatchObject({ state: 'insufficient', rule })
          for (const units of UNITS) {
            const sentence = text(facts[0]!, units)
            expect(sentence.length).toBeGreaterThan(20)
            expect(lintText(sentence)).toEqual([])
          }
        }
        const out = ask(null)
        expect(out.groups.map((g) => g.rule)).toEqual(['F8', 'F9', 'F7'])
        expect(out.groups.every((g) => g.facts.every((f) => f.state === 'insufficient'))).toBe(true)
      },
    )

    test('F7 says when the setup is not saved, and builds the rest for body weight', () => {
      const out = ask(withSetup({ saved: false }, { today: heavy.date }))
      const facts = groupOf(out, 'F7')
      expect(facts[0]).toMatchObject({ id: 'f7.gap', state: 'insufficient' })
      expect(text(facts[0]!)).toBe(
        'The strength setup is not saved yet, so the session is built for body weight only.',
      )
      expect(facts.slice(1).every((f) => f.state === 'used')).toBe(true)
      expect(said(facts).some((s) => / is done with body weight\.$/.test(s))).toBe(true)
    })
  })

  describe('F7: the block, the template and the equipment', () => {
    test('names the week of the block, the ramp-in and the template', () => {
      const facts = groupOf(ask(equipped()), 'F7')
      expect(said(facts).slice(0, 2)).toEqual([
        'This is week 6 of 12 of the strength block, and heavy work follows a ramp-in of three weeks.',
        'The session is a heavy session, variant A.',
      ])
      expect(facts.slice(0, 2).map((f) => f.id)).toEqual(['f7.block', 'f7.template'])
      expect(slot(facts[0]!, 'week', 'count').n).toBe(6)
      expect(slot(facts[0]!, 'of', 'count').n).toBe(12)
    })

    test('reads the ramp-in from the runner: longer for a new lifter and for age 40, none after a block', () => {
      const ramp = (strength: StrengthContext) =>
        said(groupOf(ask(strength), 'F7'))[0]!.replace(/^.*ramp-in of /, '')
      expect(ramp(equipped({ today: heavy.date }))).toBe('three weeks.')
      expect(
        ramp(withSetup({ equipment: have('barbell'), level: 'new' }, { today: heavy.date })),
      ).toBe('four weeks.')
      expect(
        ramp(
          withSetup(
            { equipment: have('barbell') },
            { today: heavy.date, athlete: { ...context().athlete, age: 41 } },
          ),
        ),
      ).toBe('four weeks.')
    })

    test('says a block that continues from logged weeks has no ramp-in', () => {
      // the block starts in week 4; a block session was logged in each of the weeks before it
      const weeks = plan(30, 16).map((w, i) => (i < 4 ? { ...w, flags: [] } : w))
      const logs = [0, 1, 2, 3].map((i) =>
        liftLog(`credit-${String(i)}`, addDays(monday(i), 1), 'goblet-squat', [[25, 6, 2]], {
          template: 'heavy',
        }),
      )
      const facts = groupOf(ask(equipped({ weeks, logs })), 'F7')
      expect(facts[0]).toMatchObject({ id: 'f7.block', template: 'explain.f7-block-credit' })
      expect(text(facts[0]!)).toBe(
        `This is week 2 of 12 of the strength block. A session was logged in each of the ${String(P.f7.blockCreditWeeks.value)} weeks before it, so it has no ramp-in.`,
      )
    })

    test('says a week outside the block is maintenance, the taper keeps two lifts, a return starts light', () => {
      const maintenance = sessionRef(14, 0, { durationMin: 25 })
      const out = said(groupOf(ask(equipped({ today: maintenance.date }), maintenance), 'F7'))
      expect(out.slice(0, 2)).toEqual([
        'This week is outside the strength block.',
        'The session is a maintenance session, variant A.',
      ])

      const taper = sessionRef(25, 0, { durationMin: 25 })
      const taperWeeks = plan(30, 12).map((w, i) => (i === 25 ? { ...w, flags: ['taper'] } : w))
      const taperFacts = said(
        groupOf(ask(equipped({ today: taper.date, weeks: taperWeeks }), taper), 'F7'),
      )
      expect(taperFacts).toContain(
        'The week is in the taper, so strength keeps only the lead lift and the calf raise.',
      )

      const back = sessionRef(26, 0, { durationMin: 25 })
      const returnWeeks = plan(30, 12).map((w, i) =>
        i === 26 ? { ...w, flags: ['injury-return'] } : w,
      )
      expect(
        said(groupOf(ask(equipped({ today: back.date, weeks: returnWeeks }), back), 'F7')),
      ).toContain('The week is a return week of your plan, so strength starts light.')

      const recovery = sessionRef(8)
      const recoveryWeeks = plan(30, 12).map((w, i) => (i === 8 ? { ...w, isRecovery: true } : w))
      expect(
        said(
          groupOf(ask(equipped({ today: recovery.date, weeks: recoveryWeeks }), recovery), 'F7'),
        ),
      ).toContain(
        'The week is a recovery week of your running plan, so strength keeps the usual load with fewer sets.',
      )
    })

    test('names the equipment of each lift, or the lift a "Why" opened on', () => {
      const strength = equipped()
      const all = said(groupOf(ask(strength), 'F7')).filter((s) => / is done with /.test(s))
      expect(all.length).toBeGreaterThanOrEqual(3)
      expect(all).toContain('Back squat is done with a barbell, from your saved setup.')
      expect(all.every((s) => /^[A-Z].* is done with .*\.$/.test(s))).toBe(true)

      const one = said(groupOf(ask(strength, heavy, 'back-squat'), 'F7')).filter((s) =>
        / is done with /.test(s),
      )
      expect(one).toEqual(['Back squat is done with a barbell, from your saved setup.'])
      // a lift the sheet swapped in is read as the rules would give it in the session's place
      expect(said(groupOf(ask(strength, heavy, 'goblet-squat'), 'F7'))).toContain(
        'Goblet squat is done with dumbbells, from your saved setup.',
      )
      // bodyweight, a band and a step: no item of weights to name
      const light = withSetup({ equipment: have('step', 'bands') }, { today: heavy.date })
      expect(said(groupOf(ask(light, heavy, 'split-squat'), 'F7'))).toContain(
        'Split squat is done with body weight.',
      )
    })

    test('gives the jump dose and the reason it is cut, the same reasons the engine cuts it for', () => {
      const cases: Array<[string, Partial<StrengthContext>, string[]]> = [
        ['no cut', {}, []],
        [
          'a goal pace above 12 km/h',
          { goal: { paceKmh: 13 } },
          ['Your goal pace is faster than 12 km/h, so the jump dose is cut to 50%.'],
        ],
        ['a goal pace of exactly 12 km/h', { goal: { paceKmh: 12 } }, []],
        [
          'a bone stress injury',
          { athlete: { ...context().athlete, risk: { priorBsi: true, recentInjury: false } } },
          [
            'A bone stress injury is in your profile, so the jump dose is cut to 50% and stops at the second rung.',
          ],
        ],
        [
          'a recent injury',
          { athlete: { ...context().athlete, risk: { priorBsi: false, recentInjury: true } } },
          [
            `An injury in your profile in the last ${String(P.a9.recentInjuryWindowMonths.value)} months cuts the jump dose to 50% and stops it at the second rung.`,
          ],
        ],
      ]
      const uncut = workoutFor(equipped(), heavy).plyo!.contacts
      for (const [name, over, reasons] of cases) {
        const strength = equipped(over)
        const contacts = workoutFor(strength, heavy).plyo!.contacts
        const facts = said(groupOf(ask(strength), 'F7'))
        expect(facts, name).toContain(`The jump dose is ${String(contacts)} contacts.`)
        expect(
          facts.filter((s) => /jump dose is cut|cuts the jump dose/.test(s)),
          name,
        ).toEqual(reasons)
        // a cut in the facts is a cut in the dose, and the other way round
        expect(contacts < uncut, name).toBe(reasons.length > 0)
      }
      // a running recovery week cuts it too
      const recovery = sessionRef(8)
      const weeks = plan(30, 12).map((w, i) => (i === 8 ? { ...w, isRecovery: true } : w))
      const lighter = equipped({ today: recovery.date, weeks })
      const dose = workoutFor(lighter, recovery).plyo!.contacts
      const facts = said(groupOf(ask(lighter, recovery), 'F7'))
      expect(facts).toContain('A lighter week cuts the jump dose to 50%.')
      expect(facts).toContain(`The jump dose is ${String(dose)} contacts.`)
      // the taper and a return have no jumps to state
      const taper = sessionRef(25, 0, { durationMin: 25 })
      const taperWeeks = plan(30, 12).map((w, i) => (i === 25 ? { ...w, flags: ['taper'] } : w))
      const none = said(
        groupOf(ask(equipped({ today: taper.date, weeks: taperWeeks }), taper), 'F7'),
      )
      expect(none.some((s) => /jump dose/.test(s))).toBe(false)
    })
  })

  describe('F8: the sets that set the load', () => {
    test('names the last session, the reason for the step and the share of the estimated maximum', () => {
      const strength = equipped({ logs: [squatLog()] })
      const lift = workoutFor(strength, heavy).lifts.find((l) => l.exerciseId === 'back-squat')!
      expect(lift.change).toBe('increase')

      const facts = groupOf(ask(strength, heavy, 'back-squat'), 'F8')
      expect(facts.map((f) => f.id)).toEqual([
        'f8.last-back-squat',
        'f8.back-squat-0',
        'f8.share-back-squat',
      ])
      const [last, reason, share] = said(facts, 'km', 'lb')
      expect(last).toBe(
        'The last session of Back squat was on Sat 7 Feb: four sets, heaviest set 110 lb x 6.',
      )
      expect(reason).toBe(
        'Every set of Back squat reached 6 reps with reps left, so the load goes up one step.',
      )
      expect(share).toMatch(
        /^About \d+% of the estimated maximum; heavy work asks for 80% or more\.$/,
      )
      // the same grams read in kilograms
      expect(renderFact(facts[0]!, 'km', 'kg')).toBe(
        `The last session of Back squat was on Sat 7 Feb: four sets, heaviest set ${formatLoad(lb(110), 'kg')} x 6.`,
      )
      // the log is the source, so the drawer links to its sets
      expect(facts[0]!.sources).toEqual([
        { kind: 'activity', id: 'act-log-1', date: addDays(heavy.date, -3), label: 'Strength' },
      ])
      // the reason is the lift's own basis: the one that made the number beside it
      expect(facts[1]).toMatchObject({
        template: lift.basis.facts[0]!.template,
        slots: lift.basis.facts[0]!.slots,
        state: 'used',
      })
      // the share is the load as a share of the estimate of the last session
      expect(slot(facts[2]!, 'floor', 'percent').pct).toBe(P.flib.heavyMinPct1rm.value)
    })

    test('says why a set short of the range, an unrecorded count and a hold are what they are', () => {
      const short = equipped({
        logs: [
          liftLog(
            'short',
            addDays(heavy.date, -3),
            'back-squat',
            [
              [110, 6, 2],
              [110, 6, 2],
              [110, 2, 0],
            ],
            { implement: 'barbell', baseLb: 110 },
          ),
        ],
      })
      expect(said(groupOf(ask(short, heavy, 'back-squat'), 'F8'))).toContain(
        'Set 3 of Back squat ended at 2 reps, below the 3 to 6 range, so the load comes down one step.',
      )
      const unrecorded = equipped({
        logs: [
          liftLog(
            'none',
            addDays(heavy.date, -3),
            'back-squat',
            [
              [110, 6, null],
              [110, 6, null],
            ],
            {
              implement: 'barbell',
              baseLb: 110,
            },
          ),
        ],
      })
      expect(said(groupOf(ask(unrecorded, heavy, 'back-squat'), 'F8'))).toContain(
        'The count of reps left was not recorded, so the load holds.',
      )
    })

    test('names a first session: no last session, and the way the first load was found', () => {
      const facts = groupOf(ask(equipped(), heavy, 'back-squat'), 'F8')
      expect(facts.some((f) => f.id.startsWith('f8.last-'))).toBe(false)
      expect(facts.length).toBeGreaterThan(0)
      expect(said(facts)[0]).toMatch(/^Back squat has no sets logged yet, so it starts /)
      // an estimated maximum entered at the setup gives the share before any log
      const anchored = equipped({
        anchors: [
          {
            exerciseId: 'back-squat',
            kind: 'max',
            loadG: lb(150),
            reps: 1,
            rir: null,
            asOf: monday(0),
          },
        ],
      })
      const share = groupOf(ask(anchored, heavy, 'back-squat'), 'F8').find((f) =>
        f.id.startsWith('f8.share-'),
      )
      expect(share).toBeDefined()
    })

    test('without a session’s lift in particular, reads every lift of the session once', () => {
      const strength = equipped({ logs: [squatLog()] })
      const facts = groupOf(ask(strength), 'F8')
      const lifts = workoutFor(strength, heavy).lifts
      for (const lift of lifts) {
        expect(
          facts.some((f) => f.id.includes(lift.exerciseId)),
          lift.exerciseId,
        ).toBe(true)
      }
      expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length)
    })

    test('leaves out a lighter day’s reasons, which are F9’s, and a bodyweight lift has no share', () => {
      const lighter = equipped({
        logs: [squatLog()],
        readiness: { date: heavy.date, state: 'possible-fatigue', pain: null, illness: 'clear' },
      })
      const f8 = groupOf(ask(lighter), 'F8')
      expect(f8.some((f) => f.template.startsWith('strength.reason.lighter'))).toBe(false)
      const f9 = groupOf(ask(lighter), 'F9')
      expect(f9.some((f) => f.template.startsWith('strength.reason.lighter-day'))).toBe(true)
      const bodyweight = withSetup({ equipment: have('step') }, { today: heavy.date })
      expect(
        groupOf(ask(bodyweight, heavy, 'split-squat'), 'F8').some((f) =>
          f.id.startsWith('f8.share-'),
        ),
      ).toBe(false)
    })
  })

  describe('F9: the lighter day, the week and the gap', () => {
    const lowReadiness = (over: Partial<NonNullable<StrengthContext['readiness']>> = {}) => ({
      date: heavy.date,
      state: 'possible-fatigue' as const,
      pain: null,
      illness: 'clear' as const,
      ...over,
    })

    test('says what made the day lighter, and keeps the usual load in view', () => {
      const strength = equipped({
        logs: [squatLog()],
        readiness: lowReadiness({ pain: P.pain.flagScore.value, illness: 'easy-only' }),
      })
      const workout = workoutFor(strength, heavy)
      const lead = workout.lifts.find((l) => l.exerciseId === 'back-squat')!
      expect(lead.change).toBe('lighter-day')

      const facts = groupOf(ask(strength, heavy, 'back-squat'), 'F9')
      const sentences = said(facts, 'mi', 'kg')
      expect(sentences).toContain('The readiness read for the day is lower than usual.')
      expect(sentences).toContain(
        `A pain score of ${String(P.pain.flagScore.value)} was reported in the last two days.`,
      )
      expect(sentences).toContain('A recent illness limits the day to easy effort.')
      expect(facts.map((f) => f.id)).toEqual(
        expect.arrayContaining(['f9.state', 'f9.pain', 'f9.illness', 'f9.usual-back-squat']),
      )
      // the reason of the engine, and the load it would otherwise have asked for
      expect(facts.some((f) => f.template.startsWith('strength.reason.lighter-day'))).toBe(true)
      const usual = facts.find((f) => f.id === 'f9.usual-back-squat')!
      expect(slot(usual, 'load', 'load').g).toBe(lead.usualLoadG)
      expect(renderFact(usual, 'km', 'lb')).toMatch(
        /^The usual load of Back squat is \d+(\.\d+)? lb\.$/,
      )
    })

    test('has nothing to say about readiness on a day that is not lighter, or without a read', () => {
      for (const readiness of [
        null,
        lowReadiness({ state: 'normal' }),
        lowReadiness({ date: monday(0) }),
      ]) {
        const facts = groupOf(ask(equipped({ readiness })), 'F9')
        expect(facts.some((f) => ['f9.state', 'f9.pain', 'f9.illness'].includes(f.id))).toBe(false)
        expect(facts.some((f) => f.id.startsWith('f9.usual-'))).toBe(false)
      }
    })

    test('names the recovery week, the taper and the maintenance as F9 reasons', () => {
      // a lift that has been done before holds its load in these weeks, and the week says why
      const before = (ref: StrengthSessionRef) => [
        liftLog(`before-${ref.id}`, addDays(ref.date, -3), 'back-squat', [[110, 6, 2]], {
          implement: 'barbell',
          baseLb: 110,
        }),
        liftLog(`calf-${ref.id}`, addDays(ref.date, -3), 'standing-calf-raise', [[0, 12, 2]], {
          baseLb: null,
        }),
      ]
      const reasons = (strength: StrengthContext, ref: StrengthSessionRef) =>
        groupOf(ask(strength, ref), 'F9').map((f) => f.template)

      const recovery = sessionRef(8)
      const recoveryWeeks = plan(30, 12).map((w, i) => (i === 8 ? { ...w, isRecovery: true } : w))
      expect(
        reasons(
          equipped({ today: recovery.date, weeks: recoveryWeeks, logs: before(recovery) }),
          recovery,
        ),
      ).toContain('strength.reason.lighter-week')

      const taper = sessionRef(25, 0, { durationMin: 25 })
      const taperWeeks = plan(30, 12).map((w, i) => (i === 25 ? { ...w, flags: ['taper'] } : w))
      expect(
        reasons(equipped({ today: taper.date, weeks: taperWeeks, logs: before(taper) }), taper),
      ).toContain('strength.reason.taper')

      const maintenance = sessionRef(14, 0, { durationMin: 25 })
      expect(
        reasons(equipped({ today: maintenance.date, logs: before(maintenance) }), maintenance),
      ).toContain('strength.reason.maintenance')

      // F8 does not repeat them
      const f8 = groupOf(
        ask(equipped({ today: maintenance.date, logs: before(maintenance) }), maintenance),
        'F8',
      )
      expect(f8.some((f) => f.template === 'strength.reason.maintenance')).toBe(false)
    })

    test('states the days since the last session and the gap that sends the load back', () => {
      const strength = equipped({ logs: [squatLog()] })
      const facts = groupOf(ask(strength, heavy, 'back-squat'), 'F9')
      const since = facts.find((f) => f.id === 'f9.since-back-squat')!
      expect(text(since)).toBe(
        'Back squat: three days since the last session. After 28 days the load comes back to about 90% of the last one.',
      )
      expect(since.sources).toEqual([
        { kind: 'activity', id: 'act-log-1', date: addDays(heavy.date, -3), label: 'Strength' },
      ])
      // after a gap the engine returns the load, and F8 gives that reason
      const gap = equipped({
        today: heavy.date,
        logs: [
          liftLog(
            'old',
            addDays(heavy.date, -35),
            'back-squat',
            [
              [110, 6, 2],
              [110, 6, 2],
            ],
            { implement: 'barbell', baseLb: 110 },
          ),
        ],
      })
      const returned = ask(gap, heavy, 'back-squat')
      expect(groupOf(returned, 'F8').some((f) => f.template === 'strength.reason.return')).toBe(
        true,
      )
      expect(said(groupOf(returned, 'F9'))).toContain(
        'Back squat: 35 days since the last session. After 28 days the load comes back to about 90% of the last one.',
      )
    })

    test('reads a session ahead as of today, and a past session by the history before it', () => {
      const ahead = sessionRef(8)
      const strength = equipped({
        today: addDays(ahead.date, -4),
        logs: [
          liftLog('near', addDays(ahead.date, -6), 'back-squat', [[110, 6, 2]], {
            implement: 'barbell',
          }),
        ],
      })
      const since = groupOf(ask(strength, ahead, 'back-squat'), 'F9').find((f) =>
        f.id.startsWith('f9.since-'),
      )!
      // today is four days before the session, and the session was two days before today
      expect(text(since)).toMatch(/^Back squat: two days since the last session\./)
    })
  })

  describe('every sentence', () => {
    function views(): Array<[string, ExplainView]> {
      const logs = [
        squatLog(),
        liftLog('calf', addDays(heavy.date, -3), 'standing-calf-raise', [[80, 8, 2]], {
          implement: 'calf-machine',
          baseLb: 80,
        }),
        liftLog(
          'short',
          addDays(heavy.date, -10),
          'goblet-squat',
          [
            [25, 8, 2],
            [25, 2, 0],
          ],
          {
            implement: 'dumbbells',
            baseLb: 25,
          },
        ),
      ]
      const lighter = lowReadinessFor(heavy)
      const bone = { ...context().athlete, risk: { priorBsi: true, recentInjury: true } }
      const recovery = sessionRef(8)
      const recoveryWeeks = plan(30, 12).map((w, i) => (i === 8 ? { ...w, isRecovery: true } : w))
      return [
        ['bodyweight', ask(withSetup({ saved: false }, { today: heavy.date }))],
        ['the first session', ask(equipped())],
        ['a session with history', ask(equipped({ logs }))],
        ['a lighter day', ask(equipped({ logs, readiness: lighter }))],
        [
          'a fast goal and bone stress',
          ask(equipped({ logs, goal: { paceKmh: 14 }, athlete: bone })),
        ],
        [
          'a recovery week',
          ask(equipped({ today: recovery.date, weeks: recoveryWeeks, logs }), recovery),
        ],
        ['each lift', ask(equipped({ logs }), heavy, 'standing-calf-raise')],
        ['a swapped lift', ask(equipped({ logs }), heavy, 'goblet-squat')],
        [
          'the session subject',
          view({ subject: 'session', id: heavy.id }, strengthCtx(equipped({ logs }))),
        ],
      ]
    }
    const lowReadinessFor = (ref: StrengthSessionRef) => ({
      date: ref.date,
      state: 'possible-fatigue' as const,
      pain: P.pain.flagScore.value,
      illness: 'easy-only' as const,
    })

    test('reads in both unit systems and both weight units, within the limit, clean of the G5 words', () => {
      let n = 0
      for (const [name, out] of views()) {
        for (const fact of out.groups.flatMap((g) => g.facts)) {
          for (const units of UNITS) {
            for (const weight of WEIGHT_UNITS) {
              const sentence = renderFact(fact, units, weight)
              expect(lintText(sentence), `${name} ${fact.id}: ${sentence}`).toEqual([])
              expect(sentence.length, `${name} ${fact.id}`).toBeLessThanOrEqual(COPY_MAX_CHARS)
              expect(sentence, `${name} ${fact.id}`).toMatch(/[.?]$/)
              expect(sentence, `${name} ${fact.id}`).not.toMatch(/undefined|NaN|\{/)
              n += 1
            }
          }
        }
      }
      expect(n).toBeGreaterThan(200)
    })

    test('has unique fact ids within a rule, and only registered templates', () => {
      for (const [name, out] of views()) {
        for (const group of out.groups) {
          const ids = group.facts.map((f) => f.id)
          expect(new Set(ids).size, `${name} ${group.rule}`).toBe(ids.length)
          for (const fact of group.facts) {
            expect(Object.keys(TEMPLATES), `${name} ${fact.id}`).toContain(fact.template)
            expect(fact.rule).toBe(group.rule)
          }
        }
      }
    })

    test('is deterministic and leaves a frozen input alone', () => {
      const logs = [squatLog()]
      const frozen = deepFreeze(equipped({ logs, readiness: lowReadinessFor(heavy) }))
      const first = ask(frozen)
      expect(ask(frozen)).toEqual(first)
    })

    test('words the equipment of every item the setup can save', () => {
      for (const kind of ALL_KINDS) {
        expect(EQUIPMENT_WORDS[kind], kind).toMatch(/^(a|an|the)? ?[a-z ]+$/)
        expect(lintText(EQUIPMENT_WORDS[kind])).toEqual([])
      }
    })
  })

  describe('what the rules judged: the read that made the number', () => {
    const goblet = (id: string, daysBack: number, implement: 'kettlebells' | 'dumbbells') =>
      liftLog(
        id,
        addDays(heavy.date, -daysBack),
        'goblet-squat',
        [
          [26, 8, 2],
          [26, 8, 2],
          [26, 8, 2],
        ],
        { implement, baseLb: 26, activityId: `act-${id}` },
      )
    const withEquipment = (kinds: Parameters<typeof have>, over: Partial<StrengthContext> = {}) =>
      withSetup({ equipment: have(...kinds) }, { today: heavy.date, ...over })
    const idsOf = (out: ExplainView, rule: string) => groupOf(out, rule).map((f) => f.id)

    test('a change of equipment starts the lift again: no last session, no share, no gap', () => {
      // goblet squats were logged with a kettlebell; the runner now has dumbbells
      const logs = [goblet('kb', 3, 'kettlebells')]
      const dumbbells = ask(withEquipment(['dumbbells', 'step'], { logs }), heavy, 'goblet-squat')
      const f8 = groupOf(dumbbells, 'F8')
      expect(f8.some((f) => f.id.startsWith('f8.last-'))).toBe(false)
      expect(f8.some((f) => f.id.startsWith('f8.share-'))).toBe(false)
      expect(said(f8)[0]).toMatch(/^Goblet squat has no sets logged yet, so it starts /)
      expect(idsOf(dumbbells, 'F9').some((id) => id.startsWith('f9.since-'))).toBe(false)

      // the control: with the kettlebell still the lift, the same log is its history
      const kettlebell = ask(
        withEquipment(['kettlebells', 'step'], { logs }),
        heavy,
        'goblet-squat',
      )
      expect(idsOf(kettlebell, 'F8')).toContain('f8.last-goblet-squat')
      expect(idsOf(kettlebell, 'F9')).toContain('f9.since-goblet-squat')
    })

    test('a session is explained by the history before it, and the estimate of that history', () => {
      const before = liftLog(
        'before',
        addDays(heavy.date, -3),
        'back-squat',
        [110, 110, 110, 110].map((pounds) => [pounds, 6, 2] as const),
        { implement: 'barbell', baseLb: 110, activityId: 'act-before' },
      )
      // a heavier session two days after the one explained, and today a week later
      const after = liftLog(
        'after',
        addDays(heavy.date, 2),
        'back-squat',
        [135, 135, 135, 135].map((pounds) => [pounds, 6, 2] as const),
        { implement: 'barbell', baseLb: 135, activityId: 'act-after' },
      )
      const strength = equipped({ today: addDays(heavy.date, 7), logs: [before, after] })
      const lift = workoutFor(strength, heavy).lifts.find((l) => l.exerciseId === 'back-squat')!
      const out = ask(strength, heavy, 'back-squat')

      const last = groupOf(out, 'F8').find((f) => f.id === 'f8.last-back-squat')!
      expect(last.sources.map((s) => s.id)).toEqual(['act-before'])
      expect(slot(last, 'load', 'load').g).toBe(lb(110))
      // the share is the load against the estimate of the session the rules read
      const share = groupOf(out, 'F8').find((f) => f.id === 'f8.share-back-squat')!
      expect(slot(share, 'pct', 'percent').pct).toBe(
        percentOfMax(lift.loadG!, estimateOneRm(lb(110), 6, 2)!),
      )
      // and the gap is counted to the day of the session
      const since = groupOf(out, 'F9').find((f) => f.id === 'f9.since-back-squat')!
      expect(text(since)).toMatch(/^Back squat: three days since the last session\./)
    })

    test('names the session that set the load, and counts the gap from the latest session of any mode', () => {
      const normal = liftLog(
        'normal',
        addDays(heavy.date, -10),
        'back-squat',
        [110, 110, 110, 110].map((pounds) => [pounds, 6, 2] as const),
        { implement: 'barbell', baseLb: 110, activityId: 'act-normal' },
      )
      const lighter = liftLog(
        'lighter',
        addDays(heavy.date, -2),
        'back-squat',
        [95, 95].map((pounds) => [pounds, 6, 2] as const),
        {
          implement: 'barbell',
          baseLb: 110,
          mode: 'lighter-day',
          template: 'heavy',
          activityId: 'act-lighter',
        },
      )
      const out = ask(equipped({ logs: [normal, lighter] }), heavy, 'back-squat')
      const last = groupOf(out, 'F8').find((f) => f.id === 'f8.last-back-squat')!
      expect(last.sources.map((s) => s.id)).toEqual(['act-normal'])
      expect(text(last)).toBe(
        'The last session of Back squat was on Sat 31 Jan: four sets, heaviest set 110 lb x 6.',
      )
      const since = groupOf(out, 'F9').find((f) => f.id === 'f9.since-back-squat')!
      expect(text(since)).toMatch(/^Back squat: two days since the last session\./)
      expect(since.sources.map((s) => s.id)).toEqual(['act-lighter'])
    })
  })

  describe('the gap and the illness, in words', () => {
    const lastBack = (daysBack: number) =>
      liftLog('gap-log', addDays(heavy.date, -daysBack), 'back-squat', [[110, 6, 2]], {
        implement: 'barbell',
        baseLb: 110,
      })

    test('says one day, not "1 days", and keeps the figures of the rule', () => {
      const one = ask(equipped({ logs: [lastBack(1)] }), heavy, 'back-squat')
      expect(said(groupOf(one, 'F9'))).toContain(
        'Back squat: one day since the last session. After 28 days the load comes back to about 90% of the last one.',
      )
      const twelve = ask(equipped({ logs: [lastBack(12)] }), heavy, 'back-squat')
      expect(said(groupOf(twelve, 'F9'))).toContain(
        'Back squat: 12 days since the last session. After 28 days the load comes back to about 90% of the last one.',
      )
    })

    test('has no gap fact for a lift with no load, which the return rule has no load for', () => {
      const bodyweight = withSetup({ equipment: have('step') }, { today: heavy.date })
      const log = liftLog('split', addDays(heavy.date, -3), 'split-squat', [
        [null, 8, 2],
        [null, 8, 2],
      ])
      const out = ask({ ...bodyweight, logs: [log] }, heavy, 'split-squat')
      expect(groupOf(out, 'F9').some((f) => f.id.startsWith('f9.since-'))).toBe(false)
    })

    test('words the rest phase of an illness as rest, and the easy phase as easy effort', () => {
      const day = (illness: 'rest' | 'easy-only') =>
        said(
          groupOf(
            ask(
              equipped({
                logs: [lastBack(3)],
                readiness: { date: heavy.date, state: 'normal', pain: null, illness },
              }),
              heavy,
              'back-squat',
            ),
            'F9',
          ),
        )
      expect(day('easy-only')).toContain('A recent illness limits the day to easy effort.')
      const rest = day('rest')
      expect(rest).toContain(
        'A recent illness asks for rest, so the lifts are lighter if the session is done.',
      )
      expect(rest).not.toContain('A recent illness limits the day to easy effort.')
    })
  })

  describe('a timed exercise and a bodyweight one have their own units', () => {
    const trunk = (
      id: string,
      rows: Array<readonly [number | null, number, number | null]>,
      implement?: 'dumbbells',
    ) =>
      liftLog(`trunk-${id}`, addDays(heavy.date, -3), id, rows, {
        ...(implement === undefined ? {} : { implement }),
        activityId: `act-${id}`,
      })

    test('a hold is a time: the longest hold of a side plank, the time of a carry', () => {
      const plank = ask(
        equipped({
          logs: [
            trunk('side-plank', [
              [null, 30, null],
              [null, 40, null],
            ]),
          ],
        }),
        heavy,
        'side-plank',
      )
      expect(said(groupOf(plank, 'F8'))).toContain(
        'The last session of Side plank was on Sat 7 Feb: two sets, longest hold 40 s.',
      )
      const carry = ask(
        equipped({ logs: [trunk('farmer-carry', [[50, 30, null]], 'dumbbells')] }),
        heavy,
        'farmer-carry',
      )
      expect(said(groupOf(carry, 'F8'))).toContain(
        'The last session of Farmer carry was on Sat 7 Feb: one set, heaviest set 50 lb for 30 s.',
      )
    })

    test('a bodyweight lift counts reps, and says so', () => {
      const bodyweight = withSetup({ equipment: have('step') }, { today: heavy.date })
      const log = liftLog('split', addDays(heavy.date, -3), 'split-squat', [
        [null, 8, 2],
        [null, 7, 2],
      ])
      const out = ask({ ...bodyweight, logs: [log] }, heavy, 'split-squat')
      expect(said(groupOf(out, 'F8'))).toContain(
        'The last session of Split squat was on Sat 7 Feb: two sets, most reps in a set 8.',
      )
    })
  })
})

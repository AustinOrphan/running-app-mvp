// The method presets [rules P1 to P4, methods proposal sections 4.3 to 4.5]: the static record of
// overrides admits only the four ids of 4.4 and keeps each inside its bound; the resolver reads a
// preset as the default for a class it does not name, under a persistent hold, for a novice and for
// a plan with no base week, and not under a transient hold; the default and the absent option are
// today's plans byte for byte; and the two presets that are offered pass the checklist and add no
// minutes on the twelve matrix athletes. No figure is asserted beyond conformance: every preset is
// grade D, a choice and not a better plan.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { persistentHoldOf } from '../../../shared/engine/holds.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { loadPosition } from '../../../shared/engine/loadSetting.ts'
import { startPath } from '../../../shared/engine/macro.ts'
import {
  appliesToClass,
  effective,
  overrides,
  resolveMethod,
} from '../../../shared/engine/methods.ts'
import { QUALITY_BY_PRESET } from '../../../shared/engine/micro.ts'
import { allParams, P, paramsForRule } from '../../../shared/engine/params/index.ts'
import {
  NUMERIC_OVERRIDE_IDS,
  OVERRIDE_IDS,
  PRESET_OVERRIDES,
  type PresetOverrides,
} from '../../../shared/engine/params/p-methods.ts'
import {
  isPresetId,
  PRESET_IDS,
  type AthleteState,
  type EngineInput,
  type PlanDraft,
  type PresetId,
  type SessionKind,
} from '../../../shared/engine/types.ts'
import { problemsOf, windowOf } from './disruption-fixtures.ts'
import { activity, wellnessDay } from './e8-fixtures.ts'
import { h13Race } from './history-fixtures.ts'
import { oracleInputs } from './history-oracle.ts'
import { SWEEP_COUNT, SWEEP_SEED, sweepCases } from './history-sweep.ts'
import {
  aboveDefault,
  maxRunDays,
  OFFERED,
  positionOf,
  QUALITY_KINDS,
  text,
  withMethod,
} from './method-fixtures.ts'
import { replanSteps } from './replan-steps.ts'
import { athletes, TODAY, type MatrixAthlete } from './matrix-fixtures.ts'

const ROOT = join(import.meta.dirname, '../../..')
const all = athletes()
const byId = (id: string): MatrixAthlete => all.find((a) => a.id === id)!
const DISTANCE_CLASSES = [
  '5k',
  '10k',
  'half',
  'marathon',
  'ultra50',
  'ultra100k',
  'ultra100mi',
  'beyond',
] as const

/** The state with one more risk fact set, as the load setting's own tests do. */
function withRisk(state: AthleteState, risk: Partial<AthleteState['risk']>): AthleteState {
  return { ...state, risk: { ...state.risk, ...risk } }
}

describe('the type of a preset', () => {
  it('holds default, three-run-days and longer-base, and not the id of rule P3', () => {
    expect([...PRESET_IDS]).toEqual(['default', 'three-run-days', 'longer-base'])
    expect(Object.keys(PRESET_OVERRIDES).sort()).toEqual([...PRESET_IDS].sort())
    expect(isPresetId('shorter-long-run')).toBe(false)
    expect(isPresetId('three-run-days')).toBe(true)
    expect(isPresetId('Default')).toBe(false)
    expect(isPresetId(undefined)).toBe(false)
    expect(isPresetId(3)).toBe(false)
  })
})

describe('the static record of overrides [methods proposal, section 4.4]', () => {
  /** The keys of a record of overrides that are not one of the four ids a preset may override. */
  const stray = (record: Record<string, object>): string[] =>
    Object.values(record)
      .flatMap((overrides) => Object.keys(overrides))
      .filter((key) => !(OVERRIDE_IDS as readonly string[]).includes(key))

  it('names the four overridable values, and no other', () => {
    expect([...OVERRIDE_IDS]).toEqual([
      'f5.mastersMaxRunDays',
      'macroDesign.longRunShareOfWeek',
      'macroDesign.buildWeeks',
      'qualityByPhase',
    ])
    expect([...NUMERIC_OVERRIDE_IDS]).toEqual(OVERRIDE_IDS.slice(0, 3))
  })

  it('holds no key outside the four ids, and the check rejects any other', () => {
    expect(stray(PRESET_OVERRIDES)).toEqual([])
    // a guard, a ceiling, a hold, the load setting or an option is never overridable
    for (const other of [
      'g1.spikeRatioWarn',
      'g2.rampSoft',
      'peakWeeklyMin.marathon',
      'peakLongRunMin.marathon',
      'f5.noviceRunDays',
      'e3.recoveryWeekCutPct',
      'recoveryCycle',
      'tidModel',
      'strengthSessions',
      'loadAppetite',
    ]) {
      expect(stray({ preset: { [other]: true } }), other).toEqual([other])
    }
    // and the type does not admit one
    // @ts-expect-error a preset cannot override a guard
    const bad: PresetOverrides = { 'g1.spikeRatioWarn': P.g1.spikeRatioWarn }
    expect(bad).toBeDefined()
  })

  it('overrides nothing for the default', () => {
    expect(PRESET_OVERRIDES.default).toEqual({})
  })

  it('makes every numeric override a registered grade D Param of rule P2 or P4, with a default note', () => {
    const registered = new Map(allParams().map((p) => [p.id, p]))
    const overrides = Object.values(PRESET_OVERRIDES).flatMap((o) =>
      NUMERIC_OVERRIDE_IDS.flatMap((id) => (o[id] === undefined ? [] : [o[id]])),
    )
    expect(overrides.map((p) => p.id).sort()).toEqual(['p2.runDays', 'p4.buildWeeks'])
    for (const param of overrides) {
      expect(registered.get(param.id), param.id).toBe(param)
      expect(param.grade, param.id).toBe('D')
      expect(param.note, param.id).toMatch(/default/i)
      expect(param.note, param.id).toMatch(/a choice, not a better plan/i)
      expect(param.evidence.length, param.id).toBeGreaterThan(0)
    }
    expect(paramsForRule('P2').map((p) => p.id)).toEqual(['p2.runDays'])
    expect(paramsForRule('P4').map((p) => p.id)).toEqual(['p4.buildWeeks'])
    // P1 has nothing to override and P3 is not offered: neither has a Param
    expect(paramsForRule('P1')).toEqual([])
    expect(paramsForRule('P3')).toEqual([])
  })

  it('maps each preset to its rule: three-run-days to P2, longer-base to P4', () => {
    expect(PRESET_OVERRIDES['three-run-days']).toEqual({ 'f5.mastersMaxRunDays': P.p2.runDays })
    expect(PRESET_OVERRIDES['longer-base']).toEqual({
      'macroDesign.buildWeeks': P.p4.buildWeeks,
      qualityByPhase: true,
    })
  })

  it('offers no preset that lowers the long-run share (P3 is not offered)', () => {
    for (const id of PRESET_IDS) {
      expect(PRESET_OVERRIDES[id]['macroDesign.longRunShareOfWeek'], id).toBeUndefined()
    }
  })
})

describe('the bounds of section 4.4, as literals', () => {
  const BOUNDS = {
    'f5.mastersMaxRunDays': [3, 6],
    'macroDesign.longRunShareOfWeek': [0.3, 0.35],
    'macroDesign.buildWeeks': [4, 6],
  } as const
  const DEFAULTS = {
    'f5.mastersMaxRunDays': 6,
    'macroDesign.longRunShareOfWeek': 0.35,
    'macroDesign.buildWeeks': 6,
  } as const

  it('has the defaults the bounds are measured from', () => {
    expect(P.f5.mastersMaxRunDays.value).toBe(DEFAULTS['f5.mastersMaxRunDays'])
    expect(P.macroDesign.longRunShareOfWeek.value).toBe(DEFAULTS['macroDesign.longRunShareOfWeek'])
    expect(P.macroDesign.buildWeeks.value).toBe(DEFAULTS['macroDesign.buildWeeks'])
  })

  it.each(PRESET_IDS)(
    '%s: every override lies inside its bound and never raises the default',
    (id) => {
      for (const key of NUMERIC_OVERRIDE_IDS) {
        const param = PRESET_OVERRIDES[id][key]
        if (param === undefined) continue
        const [low, high] = BOUNDS[key]
        expect(param.value, `${id} ${key}`).toBeGreaterThanOrEqual(low)
        expect(param.value, `${id} ${key}`).toBeLessThanOrEqual(high)
        expect(param.value, `${id} ${key}`).toBeLessThanOrEqual(DEFAULTS[key])
      }
    },
  )

  it('states the bounds of the two Params as their range, and their values', () => {
    expect(P.p2.runDays.value).toBe(3)
    expect(P.p2.runDays.range).toEqual(BOUNDS['f5.mastersMaxRunDays'])
    expect(P.p4.buildWeeks.value).toBe(4)
    expect(P.p4.buildWeeks.range).toEqual(BOUNDS['macroDesign.buildWeeks'])
  })

  it('keeps the existing kinds, the specific, taper and race rows and the default row', () => {
    const DEFAULT_TABLE = {
      base: ['strides', 'hills'],
      build: ['threshold', 'intervals'],
      specific: ['race-pace', 'threshold'],
      taper: ['race-pace', 'strides'],
      race: ['strides'],
    }
    expect(QUALITY_BY_PRESET.default).toEqual(DEFAULT_TABLE)
    const used = new Set<SessionKind>(Object.values(DEFAULT_TABLE).flat() as SessionKind[])
    expect(Object.keys(QUALITY_BY_PRESET).sort()).toEqual([...PRESET_IDS].sort())
    for (const id of PRESET_IDS) {
      const table = QUALITY_BY_PRESET[id]
      expect(Object.keys(table).sort(), id).toEqual(Object.keys(DEFAULT_TABLE).sort())
      for (const kind of Object.values(table).flat()) {
        expect(used.has(kind), `${id} ${kind}`).toBe(true)
      }
      for (const phase of ['specific', 'taper', 'race'] as const) {
        expect(table[phase], `${id} ${phase}`).toEqual(DEFAULT_TABLE[phase])
      }
      // a preset has a row of its own exactly when the record says so
      const own = PRESET_OVERRIDES[id].qualityByPhase === true
      expect(table !== QUALITY_BY_PRESET.default, id).toBe(own)
    }
    // longer-base: strides only in the base; threshold, then hills, in the build: the first quality
    // session of a build week is the default's (section (p), the order of the build row)
    expect(QUALITY_BY_PRESET['longer-base'].base).toEqual(['strides'])
    expect(QUALITY_BY_PRESET['longer-base'].build).toEqual(['threshold', 'hills'])
    expect(QUALITY_BY_PRESET['longer-base'].build[0]).toBe(DEFAULT_TABLE.build[0])
    expect(QUALITY_BY_PRESET['three-run-days']).toEqual(DEFAULT_TABLE)
  })
})

describe('effective: the value of an overridable id under a preset', () => {
  it('is the default for the default and for the ids a preset leaves alone', () => {
    const defaults = {
      'f5.mastersMaxRunDays': P.f5.mastersMaxRunDays,
      'macroDesign.longRunShareOfWeek': P.macroDesign.longRunShareOfWeek,
      'macroDesign.buildWeeks': P.macroDesign.buildWeeks,
    } as const
    for (const id of NUMERIC_OVERRIDE_IDS) {
      expect(effective('default', id), id).toBe(defaults[id].value)
    }
    expect(effective('three-run-days', 'macroDesign.buildWeeks')).toBe(6)
    expect(effective('three-run-days', 'macroDesign.longRunShareOfWeek')).toBe(0.35)
    expect(effective('longer-base', 'f5.mastersMaxRunDays')).toBe(6)
    expect(effective('longer-base', 'macroDesign.longRunShareOfWeek')).toBe(0.35)
  })

  it('is the preset Param for the id a preset overrides', () => {
    expect(effective('three-run-days', 'f5.mastersMaxRunDays')).toBe(3)
    expect(effective('longer-base', 'macroDesign.buildWeeks')).toBe(4)
  })
})

describe('applicability by goal class [rule P2]', () => {
  const half = byId('half')

  it.each(DISTANCE_CLASSES)(
    '%s: three-run-days applies to 5 km to the half marathon only',
    (cls) => {
      const input = withMethod(
        { ...half.input, goal: { ...half.input.goal, distanceClass: cls } },
        'three-run-days',
      )
      const position = resolveMethod(input, estimateState(input))
      const fits = cls === '5k' || cls === '10k' || cls === 'half'
      expect(appliesToClass('three-run-days', cls)).toBe(fits)
      expect(position).toEqual(
        fits
          ? { requested: 'three-run-days', effective: 'three-run-days', reason: null }
          : { requested: 'three-run-days', effective: 'default', reason: 'not-applicable' },
      )
    },
  )

  it.each(DISTANCE_CLASSES)('%s: longer-base names every class', (cls) => {
    const input = withMethod(
      { ...half.input, goal: { ...half.input.goal, distanceClass: cls } },
      'longer-base',
    )
    expect(appliesToClass('longer-base', cls)).toBe(true)
    expect(resolveMethod(input, estimateState(input), [{ phase: 'base' }])).toEqual({
      requested: 'longer-base',
      effective: 'longer-base',
      reason: null,
    })
  })

  it('reads a preset carried to a marathon goal as the default, and builds the default plan', () => {
    const marathon = byId('marathon')
    const input = withMethod(marathon.input, 'three-run-days')
    expect(resolveMethod(input, estimateState(input))).toEqual({
      requested: 'three-run-days',
      effective: 'default',
      reason: 'not-applicable',
    })
    expect(text(buildPlan(input))).toBe(text(buildPlan(marathon.input)))
  })

  it('reads an absent, a default and an unknown method as the default', () => {
    const state = estimateState(half.input)
    const none = { requested: 'default', effective: 'default', reason: null }
    expect(resolveMethod(half.input, state)).toEqual(none)
    expect(resolveMethod(withMethod(half.input, 'default'), state)).toEqual(none)
    const unknown = { ...half.input, options: { method: 'shorter-long-run' as PresetId } }
    expect(resolveMethod(unknown, state)).toEqual(none)
  })
})

describe('holds [methods proposal, section 4.5]', () => {
  const half = byId('half')
  const input = withMethod(half.input, 'three-run-days')
  const state = estimateState(input)
  const standard = (i: EngineInput): EngineInput => ({
    ...i,
    options: { ...i.options, loadAppetite: 'standard' },
  })

  it('starts from a runner who is not held', () => {
    expect(persistentHoldOf(input, state)).toBeNull()
    expect(resolveMethod(input, state)).toMatchObject({ effective: 'three-run-days', reason: null })
  })

  const persistent: Array<[string, EngineInput, AthleteState]> = [
    ['recent-injury', input, withRisk(state, { recentInjury: true })],
    ['bone-stress', input, withRisk(state, { priorBsi: true })],
    ['bsi-factors', input, withRisk(state, { bsiFactors: P.g3.bsiFactorsForCap.value })],
    ['reds-hold', input, withRisk(state, { redsFlags: P.j5.redsHoldFlags.value })],
    [
      'bone-pain',
      { ...input, wellness: [wellnessDay(TODAY, { painFocalBone: true, painScore: 4 })] },
      state,
    ],
  ]

  it.each(persistent)(
    '%s holds the load setting and reads the preset as the default',
    (reason, i, s) => {
      expect(loadPosition(standard(i), s).held).toBe(reason)
      expect(persistentHoldOf(i, s)).toBe(reason)
      for (const method of OFFERED) {
        const held = resolveMethod(withMethod(i, method), s, [{ phase: 'base' }])
        expect(held, method).toEqual({
          requested: method,
          effective: 'default',
          reason: `held:${reason}`,
        })
      }
    },
  )

  it('names the first persistent hold that applies', () => {
    const both = withRisk(state, { recentInjury: true, priorBsi: true })
    expect(resolveMethod(input, both).reason).toBe('held:recent-injury')
  })

  it('reads a painful niggle reported in a window as a recent injury, and a mild one as a rest window', () => {
    const niggle = (over: Parameters<typeof windowOf>[0]): EngineInput => ({
      ...input,
      disruptions: [
        windowOf({
          reason: 'niggle',
          mode: 'rest',
          startDate: TODAY,
          endDate: addDays(TODAY, 3),
          ...over,
        }),
      ],
    })
    const painful = niggle({ pain: P.pain.flagScore.value, gaitChange: false })
    expect(resolveMethod(painful, estimateState(painful))).toEqual({
      requested: 'three-run-days',
      effective: 'default',
      reason: 'held:recent-injury',
    })
    const gait = niggle({ pain: 0, gaitChange: true })
    expect(resolveMethod(gait, estimateState(gait)).reason).toBe('held:recent-injury')
    const mild = niggle({ pain: 0, gaitChange: false })
    expect(resolveMethod(mild, estimateState(mild))).toMatchObject({
      effective: 'three-run-days',
      reason: null,
    })
  })

  it('is not held by a rest window, which opens and closes between weekly re-plans', () => {
    const resting: EngineInput = {
      ...input,
      disruptions: [
        windowOf({
          reason: 'illness-above-neck',
          mode: 'rest',
          startDate: TODAY,
          endDate: addDays(TODAY, 2),
        }),
      ],
    }
    const s = estimateState(resting)
    expect(loadPosition(standard(resting), s).held).toBe('rest-window')
    expect(persistentHoldOf(resting, s)).toBeNull()
    expect(resolveMethod(resting, s)).toEqual({
      requested: 'three-run-days',
      effective: 'three-run-days',
      reason: null,
    })
  })

  it('is not held by the window of a past race', () => {
    // a plan built inside the window of a marathon run three days ago, read as a 10 km plan
    const base = h13Race()
    const racing = withMethod(
      { ...base, goal: { ...base.goal, distanceClass: '10k' } },
      'three-run-days',
    )
    const s = estimateState(racing)
    expect(loadPosition(standard(racing), s).held).toBe('post-race')
    expect(persistentHoldOf(racing, s)).toBeNull()
    expect(resolveMethod(racing, s)).toEqual({
      requested: 'three-run-days',
      effective: 'three-run-days',
      reason: null,
    })
    const longer = withMethod(base, 'longer-base')
    expect(resolveMethod(longer, estimateState(longer), [{ phase: 'base' }]).effective).toBe(
      'longer-base',
    )
  })

  it('holds the plan of a matrix athlete the load setting holds, and builds the default plan', () => {
    for (const [id, reason] of [
      ['prior-bsi', 'held:recent-injury'],
      ['reds-hold', 'held:reds-hold'],
    ] as const) {
      const athlete = byId(id)
      for (const method of OFFERED) {
        const i = withMethod(athlete.input, method)
        const position = resolveMethod(i, estimateState(i), [{ phase: 'base' }])
        // three-run-days also reads as not applicable to the 50 km goal of reds-hold
        if (!(method === 'three-run-days' && id === 'reds-hold')) {
          expect(position.reason, `${id} ${method}`).toBe(reason)
        }
        expect(position.effective, `${id} ${method}`).toBe('default')
        expect(text(buildPlan(i)), `${id} ${method}`).toBe(text(buildPlan(athlete.input)))
      }
    }
  })
})

describe('novices and the E6 start paths', () => {
  it('keeps the novice days: a novice on three-run-days reads the default and gets the default plan', () => {
    const novice = byId('novice-5k')
    const input = withMethod(novice.input, 'three-run-days')
    const state = estimateState(input)
    expect(state.experience).toBe('novice')
    expect(resolveMethod(input, state)).toEqual({
      requested: 'three-run-days',
      effective: 'default',
      reason: 'novice',
    })
    expect(text(buildPlan(input))).toBe(text(buildPlan(novice.input)))
    expect(maxRunDays(buildPlan(input))).toBeLessThanOrEqual(P.f5.noviceRunDays.value)
  })

  it('does not read longer-base as a novice case: its overrides are not the run-day cap', () => {
    const novice = byId('novice-5k')
    const input = withMethod(novice.input, 'longer-base')
    const state = estimateState(input)
    expect(resolveMethod(input, state, [{ phase: 'base' }])).toMatchObject({
      effective: 'longer-base',
      reason: null,
    })
  })

  it.each([
    ['post-marathon-short-run', 'ladder', 0],
    ['post-marathon-short-run', 'ladder', 28],
    ['sparse-100-mile', 'floor', 0],
  ] as const)(
    '%s, race %i days later: the %s start path plans its own weeks, which a preset leaves as they are',
    (id, kind, later) => {
      // the race moved later gives the default a base to fall in the ladder's weeks
      const athlete = byId(id)
      const input = {
        ...athlete.input,
        goal: { ...athlete.input.goal, date: addDays(athlete.input.goal.date, later) },
      }
      expect(startPath(input, estimateState(input))?.kind).toBe(kind)
      const base = buildPlan(input)
      const isStart = (flags: string[]) => flags.some((f) => /^ladder-|^restart-floor$/.test(f))
      const startWeeks = base.weeks.filter((w) => isStart(w.flags))
      expect(startWeeks.length).toBeGreaterThan(0)
      for (const method of OFFERED) {
        const plan = buildPlan(withMethod(input, method))
        for (const week of startWeeks) {
          // the programme sets the week and the default's phase labels it [rules E6, P4]: the preset's
          // own draw of the phases would file the week under base where the default files it under build
          const own = plan.weeks.find((w) => w.weekStart === week.weekStart)
          expect(own, `${method} ${week.weekStart}`).toEqual(week)
          const sessions = (p: PlanDraft) =>
            JSON.stringify(
              p.sessions.filter(
                (s) => s.date >= week.weekStart && s.date < addDays(week.weekStart, 7),
              ),
            )
          expect(sessions(plan), `${method} ${week.weekStart}`).toBe(sessions(base))
        }
      }
    },
  )

  it('post-marathon-short-run: a ladder that covers the base leaves no base week, so longer-base reads the default', () => {
    // the ladder runs 11 weeks, the whole of base and build; the one base week of the preset's own
    // draw would be its first ladder week, which the default files under build
    const athlete = byId('post-marathon-short-run')
    const input = withMethod(athlete.input, 'longer-base')
    const plan = buildPlan(input)
    expect(plan.weeks.filter((w) => w.phase === 'base')).toEqual([])
    expect(positionOf(input, plan)).toEqual({
      requested: 'longer-base',
      effective: 'default',
      reason: 'no-base',
    })
    expect(text(plan)).toBe(text(buildPlan(athlete.input)))
  })
})

describe('a plan with no base week [rule P4]', () => {
  const half = byId('half')
  const input = withMethod(half.input, 'longer-base')
  const state = estimateState(input)

  it('reads longer-base as the default when the plan has no base week, and applies it when it has one', () => {
    const none = resolveMethod(input, state, [{ phase: 'build' }, { phase: 'specific' }])
    expect(none).toEqual({ requested: 'longer-base', effective: 'default', reason: 'no-base' })
    const some = resolveMethod(input, state, [{ phase: 'base' }, { phase: 'build' }])
    expect(some).toEqual({ requested: 'longer-base', effective: 'longer-base', reason: null })
    // without the weeks the question is not asked
    expect(resolveMethod(input, state).effective).toBe('longer-base')
  })

  it('does not ask three-run-days for a base week', () => {
    const p2 = withMethod(half.input, 'three-run-days')
    expect(resolveMethod(p2, estimateState(p2), [{ phase: 'build' }]).effective).toBe(
      'three-run-days',
    )
  })

  /** The half marathon athlete with the race `weeks` Mondays after this one, a Saturday. */
  const racing = (weeks: number): EngineInput => ({
    ...half.input,
    goal: { ...half.input.goal, date: addDays(mondayOf(TODAY), 7 * (weeks - 1) + 5) },
  })
  const baseWeeks = (plan: PlanDraft) => plan.weeks.filter((w) => w.phase === 'base').length

  it('builds the default plan for a goal so near that the build is all there is', () => {
    // 14 weeks: 2 of taper and race week, 8 of specific work, 4 of build and no base to lengthen
    const short = racing(14)
    const base = buildPlan(short)
    expect(baseWeeks(base)).toBe(0)
    const plan = buildPlan(withMethod(short, 'longer-base'))
    expect(baseWeeks(plan)).toBe(0)
    expect(text(plan)).toBe(text(base))
    expect(
      resolveMethod(withMethod(short, 'longer-base'), estimateState(short), plan.weeks),
    ).toEqual({
      requested: 'longer-base',
      effective: 'default',
      reason: 'no-base',
    })
  })

  it('gives a plan whose default has no base a base of one week, which the preset then applies to', () => {
    // 15 weeks: 5 left after the specific phase, the default's build of 5 and no base; the preset's
    // build of 4 leaves one base week
    const mid = racing(15)
    const base = buildPlan(mid)
    expect(baseWeeks(base)).toBe(0)
    const plan = buildPlan(withMethod(mid, 'longer-base'))
    expect(baseWeeks(plan)).toBe(1)
    expect(text(plan)).not.toBe(text(base))
    expect(
      resolveMethod(withMethod(mid, 'longer-base'), estimateState(mid), plan.weeks).effective,
    ).toBe('longer-base')
  })
})

describe('the default and the absent method are the same plan [rule P1]', () => {
  it.each(all.map((a) => [a.id, a] as const))(
    '%s: method default is the plan with no method',
    (_id, a) => {
      expect(text(buildPlan(withMethod(a.input, 'default')))).toBe(text(buildPlan(a.input)))
    },
  )

  it('moves no default plan when the build row or the start-week labels of a preset change', () => {
    // the oracle pins the digests of the default; this reads the cause: the kind table of a preset
    // and the phase labels it gives a start-path week are read for a preset plan only (task M5)
    const before = all.map((a) => text(buildPlan(a.input)))
    const half = withMethod(byId('half').input, 'longer-base')
    const own = text(buildPlan(half))
    const table = QUALITY_BY_PRESET['longer-base'] as unknown as { build: readonly SessionKind[] }
    const kept = table.build
    try {
      table.build = ['intervals', 'hills']
      expect(all.map((a) => text(buildPlan(a.input)))).toEqual(before)
      // the table is read: the preset plan moves with it
      expect(text(buildPlan(half))).not.toBe(own)
    } finally {
      table.build = kept
    }
    expect(QUALITY_BY_PRESET['longer-base'].build).toEqual(['threshold', 'hills'])
  })
})

describe('the offered presets on the twelve matrix athletes', () => {
  const defaults = new Map(all.map((a) => [a.id, buildPlan(a.input)]))
  // the runners of the oracle: the twelve matrix athletes, the H cases and 40 of the sweep
  const runners: MatrixAthlete[] = oracleInputs().map((c) => ({
    id: c.name,
    label: c.name,
    input: c.input,
    isUltra: c.input.goal.isUltra,
  }))
  const runnerDefaults = new Map(runners.map((a) => [a.id, buildPlan(a.input)]))

  describe.each(OFFERED)('%s', (method) => {
    it.each(runners.map((a) => [a.id, a] as const))(
      '%s passes the checklist and adds no load',
      (id, a) => {
        const input = withMethod(a.input, method)
        const plan = buildPlan(input)
        const base = runnerDefaults.get(id)!
        // the checklist, no minutes added to any week, no week target raised, the race kept [G6];
        // what the default plan already fails (three sweep runners fail the spacing item at
        // default) is not the preset's
        const windows = input.disruptions ?? []
        const inherited = problemsOf(a, windows, base, base)
        expect(problemsOf(a, windows, plan, base).filter((p) => !inherited.includes(p))).toEqual([])
        expect(aboveDefault(base, plan)).toEqual([])
        expect(plan.weeks).toHaveLength(base.weeks.length)
        // the plan is the default's whenever the resolver reads the preset as the default
        const position = resolveMethod(input, estimateState(input), plan.weeks)
        if (position.effective === 'default') expect(text(plan)).toBe(text(base))
      },
    )
  })

  it('three-run-days caps the run days at 3 where it applies', () => {
    const applied = all.filter((a) => {
      const input = withMethod(a.input, 'three-run-days')
      return resolveMethod(input, estimateState(input)).effective === 'three-run-days'
    })
    expect(applied.map((a) => a.id).sort()).toEqual([
      'half',
      'post-marathon-short-run',
      'returning',
    ])
    for (const a of applied) {
      const plan = buildPlan(withMethod(a.input, 'three-run-days'))
      expect(maxRunDays(plan), a.id).toBeLessThanOrEqual(P.p2.runDays.value)
    }
    // the cap is a choice: the default plan of the same athletes runs more days somewhere
    expect(maxRunDays(defaults.get('half')!)).toBeGreaterThan(P.p2.runDays.value)
  })

  it('longer-base applies to eight of the twelve and reads the default for the other four', () => {
    const position = (a: MatrixAthlete) => {
      const input = withMethod(a.input, 'longer-base')
      return resolveMethod(input, estimateState(input), buildPlan(input).weeks)
    }
    const applied = all.filter((a) => position(a).effective === 'longer-base').map((a) => a.id)
    expect(applied.sort()).toEqual([
      'first-100-mile',
      'half',
      'hot-race',
      'marathon',
      'masters',
      'returning',
      'sparse-100-mile',
      'trail-50k',
    ])
    expect(position(byId('novice-5k')).reason).toBe('no-base')
    expect(position(byId('post-marathon-short-run')).reason).toBe('no-base')
    expect(position(byId('prior-bsi')).reason).toBe('held:recent-injury')
    expect(position(byId('reds-hold')).reason).toBe('held:reds-hold')
  })

  it('longer-base keeps intensity out of the base and intervals out of the build', () => {
    let build = 0
    for (const a of all) {
      const input = withMethod(a.input, 'longer-base')
      const plan = buildPlan(input)
      if (resolveMethod(input, estimateState(input), plan.weeks).effective !== 'longer-base')
        continue
      const phaseOf = new Map(plan.weeks.map((w) => [w.weekStart, w]))
      for (const s of plan.sessions) {
        const week = phaseOf.get(mondayOf(s.date))
        if (week === undefined || !QUALITY_KINDS.has(s.kind) || week.flags.includes('post-race'))
          continue
        if (week.phase === 'base') expect(s.kind, `${a.id} ${s.date}`).toBe('strides')
        if (week.phase === 'build') {
          build += 1
          expect(['hills', 'threshold'], `${a.id} ${s.date}`).toContain(s.kind)
        }
      }
    }
    expect(build).toBeGreaterThan(0)
  })

  it('longer-base lengthens the base by shortening the build, and leaves the specific phase and the taper', () => {
    const half = byId('half')
    const before = defaults.get('half')!
    const after = buildPlan(withMethod(half.input, 'longer-base'))
    const count = (plan: PlanDraft, phase: string) =>
      plan.weeks.filter((w) => w.phase === phase).length
    expect(count(after, 'specific')).toBe(count(before, 'specific'))
    expect(count(after, 'taper')).toBe(count(before, 'taper'))
    expect(count(after, 'race')).toBe(count(before, 'race'))
    expect(count(after, 'build')).toBeLessThan(count(before, 'build'))
    expect(count(after, 'build')).toBeLessThanOrEqual(P.p4.buildWeeks.value)
    expect(count(after, 'base')).toBeGreaterThan(count(before, 'base'))
  })
})

describe('a preset never plans more than the default [rule G6]', () => {
  /** The first plan of every case, at the preset, against the default plan of the same input. */
  function firstPlans(
    cases: ReadonlyArray<{ name: string; input: EngineInput }>,
    method: PresetId,
  ): number {
    let differing = 0
    for (const c of cases) {
      const base = buildPlan(c.input)
      const plan = buildPlan(withMethod(c.input, method))
      expect(aboveDefault(base, plan), `${c.name} at ${method}`).toEqual([])
      if (text(plan) !== text(base)) differing += 1
    }
    return differing
  }

  it.each(OFFERED)(
    '%s: no week target, no planned week and no peak above the default on the sweep runners',
    (method) => {
      const cases = sweepCases(SWEEP_SEED, SWEEP_COUNT)
      expect(cases).toHaveLength(SWEEP_COUNT)
      // the check is not vacuous: the preset changes plans
      expect(firstPlans(cases, method)).toBeGreaterThan(0)
    },
    300_000,
  )

  it.each(OFFERED)(
    '%s: no week target, no planned week and no peak above the default in the weekly re-plan chains',
    (method) => {
      let steps = 0
      for (const a of all) {
        const base = replanSteps(a.id)
        const chain = replanSteps(a.id, { method })
        expect(chain, a.id).toHaveLength(base.length)
        chain.forEach((step, i) => {
          steps += 1
          expect(aboveDefault(base[i]!.draft, step.draft), `${a.id} step ${String(i)}`).toEqual([])
        })
      }
      expect(steps).toBeGreaterThan(200)
    },
    300_000,
  )

  it.each(OFFERED)(
    '%s: at every step of a default chain, the preset applied to that step plans no more than the default',
    (method) => {
      for (const a of all) {
        replanSteps(a.id).forEach((step, i) => {
          const held = replan(withMethod(step.input, method)).draft
          expect(aboveDefault(step.draft, held), `${a.id} step ${String(i)}`).toEqual([])
        })
      }
    },
    300_000,
  )

  it('holds longer-base to what the default places where a session of the default places short', () => {
    // the returning runner of the matrix: in the build the default's threshold session places short
    // of its share, and a strides-only base would place the whole week and lift the ramp after it
    const [first, second] = replanSteps('returning', { method: 'longer-base' })
    const [baseFirst, baseSecond] = replanSteps('returning')
    expect(aboveDefault(baseFirst!.draft, first!.draft)).toEqual([])
    expect(aboveDefault(baseSecond!.draft, second!.draft)).toEqual([])
    // the plan is still a different plan: its weeks are filed under base where the default's are build
    expect(text(first!.draft)).not.toBe(text(baseFirst!.draft))
  })
})

describe('the run-day cap after a past race [rule P2]', () => {
  // a runner of 36 on five run days a week, in the window of a marathon run 15 days ago, read as a
  // half-marathon plan: the weeks of the window take their run days from the reference week
  const hot = byId('hot-race')
  const race = activity('2026-10-06', {
    id: 'race-late',
    type: 'race',
    durationSec: 14_400,
    movingSec: 14_400,
    distanceM: 42_195,
    rpe: 9,
  })
  const inWindow = (method?: PresetId): EngineInput => ({
    ...hot.input,
    goal: { ...hot.input.goal, distanceClass: 'half' },
    activities: [...hot.input.activities, race],
    options: method === undefined ? {} : { method },
  })

  it('caps every run week at three days for a runner under 40, in the window of a past race too', () => {
    const state = estimateState(inWindow('three-run-days'))
    expect(state.age).toBeLessThan(P.f5.mastersMinAge.value)
    const base = buildPlan(inWindow())
    const plan = buildPlan(inWindow('three-run-days'))
    // the window weeks are post-race weeks, and the default holds four runs in the first of them
    expect(plan.weeks[0]!.flags).toContain('post-race')
    expect(maxRunDays(base)).toBeGreaterThan(P.p2.runDays.value)
    expect(base.weeks.filter((w) => w.flags.includes('post-race')).some((w) => w.runDays > 3)).toBe(
      true,
    )
    expect(maxRunDays(plan)).toBeLessThanOrEqual(P.p2.runDays.value)
    for (const week of plan.weeks) expect(week.runDays, week.weekStart).toBeLessThanOrEqual(3)
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })

  it('leaves the default and longer-base on the run days they had', () => {
    expect(text(buildPlan(withMethod(inWindow(), 'default')))).toBe(text(buildPlan(inWindow())))
    const longer = buildPlan(inWindow('longer-base'))
    expect(maxRunDays(longer)).toBe(maxRunDays(buildPlan(inWindow())))
  })

  it('says which presets override the run-day cap', () => {
    expect(overrides('three-run-days', 'f5.mastersMaxRunDays')).toBe(true)
    expect(overrides('three-run-days', 'macroDesign.buildWeeks')).toBe(false)
    expect(overrides('longer-base', 'macroDesign.buildWeeks')).toBe(true)
    expect(overrides('longer-base', 'f5.mastersMaxRunDays')).toBe(false)
    for (const id of NUMERIC_OVERRIDE_IDS) expect(overrides('default', id), id).toBe(false)
  })
})

describe('the four values are read only through the resolver', () => {
  /** Source files of the app, outside the registry and the resolver, as repository-relative paths. */
  function sources(): string[] {
    return ['shared', 'server', 'web']
      .flatMap((dir) =>
        readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' }).map(
          (f) => `${dir}/${f}`,
        ),
      )
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => !f.startsWith('shared/engine/params/') && f !== 'shared/engine/methods.ts')
  }

  it('finds no read of the run-day cap, the long-run share or the build length outside methods.ts', () => {
    const direct =
      /\bP\.(?:f5\.mastersMaxRunDays|macroDesign\.buildWeeks|macroDesign\.longRunShareOfWeek)\b/
    const reads = sources().filter((f) => direct.test(readFileSync(join(ROOT, f), 'utf8')))
    expect(reads).toEqual([])
  })

  it('reads the table of quality kinds only through QUALITY_BY_PRESET', () => {
    const micro = readFileSync(join(ROOT, 'shared/engine/micro.ts'), 'utf8')
    expect(micro.match(/QUALITY_BY_PHASE\[/g)).toBeNull()
    expect(micro.match(/QUALITY_BY_PRESET\[/g)).toHaveLength(1)
  })
})

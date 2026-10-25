// The most a week target the runner raised by hand may stay at (`targetLimit`, load-progression
// proposal 4.8): the ramp's own ceiling and tightened profiles, read from `rampLimits`, and the
// plan's own figure where a rule draws the week.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { draftRamp } from '../../../shared/engine/checklist.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import {
  EPS,
  rampLimits,
  targetKept,
  targetLimit,
  type RampContext,
  type TargetGates,
} from '../../../shared/engine/limits.ts'
import { progressionHold } from '../../../shared/engine/macro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { replanSteps } from './replan-steps.ts'

const WEEK = '2026-10-19'

/** Two steady weeks of 200 minutes before the week, nothing else known. */
const context = (over: Partial<RampContext> = {}): RampContext => ({
  volumes: new Map([
    [addDays(WEEK, -7), 200],
    [addDays(WEEK, -14), 200],
    [addDays(WEEK, -21), 200],
  ]),
  skip: new Set(),
  floor: null,
  typicalWeekMin: 200,
  novice: false,
  tight: null,
  rebuild: null,
  response: null,
  ...over,
})

const plainWeek = { flags: [], isRecovery: false, isTaper: false, phase: 'build' } as const

const gates = (over: Partial<TargetGates> = {}): TargetGates => ({
  engineMin: 215,
  week: plainWeek,
  held: false,
  decided: false,
  loggedMin: 0,
  ...over,
})

describe('targetLimit on a loading week', () => {
  it('is the 2-week ceiling of the ramp, rounded down to whole minutes', () => {
    const limit = targetLimit(context(), WEEK, gates())
    expect(limit).toEqual({
      max: Math.floor(200 * (1 + P.g2.rampCeilingTwoWeeks.value) + EPS),
      bound: 'limit',
      kind: 'ceiling',
      ramp: P.g2.rampCeilingTwoWeeks.value,
    })
  })

  it('leaves the soft step out: a target above the soft 10% and under the ceiling stays', () => {
    const soft = 200 * (1 + P.g2.rampSoft.value)
    const { max } = targetLimit(context(), WEEK, gates())
    expect(max).toBeGreaterThan(soft)
  })

  it('reads the same number as rampLimits, so the generator and this rule agree', () => {
    const ctx = context()
    expect(targetLimit(ctx, WEEK, gates()).max).toBe(
      Math.floor(rampLimits(ctx, WEEK)!.allowed + EPS),
    )
  })

  it('is the tightened ramp of a profile when that is the lower of the two', () => {
    const tight = P.g3.priorBsiRampMax.value
    const limit = targetLimit(context({ tight }), WEEK, gates({ engineMin: 205 }))
    expect(limit).toEqual({
      max: Math.floor(200 * (1 + tight) + EPS),
      bound: 'limit',
      kind: 'profile',
      ramp: tight,
    })
  })

  it('never falls under the plan’s own figure or the minutes already run', () => {
    const ceiling = Math.floor(200 * (1 + P.g2.rampCeilingTwoWeeks.value) + EPS)
    expect(targetLimit(context(), WEEK, gates({ engineMin: ceiling + 40 })).max).toBe(ceiling + 40)
    expect(targetLimit(context(), WEEK, gates({ loggedMin: ceiling + 25 })).max).toBe(ceiling + 25)
  })

  it('says which of the three set the figure: the limit, the plan’s own figure or the minutes run', () => {
    const ceiling = Math.floor(200 * (1 + P.g2.rampCeilingTwoWeeks.value) + EPS)
    const at = (over: Partial<TargetGates>, ctx = context()) => targetLimit(ctx, WEEK, gates(over))
    expect(at({})).toMatchObject({ max: ceiling, bound: 'limit' })
    expect(at({ engineMin: ceiling + 40 })).toMatchObject({ max: ceiling + 40, bound: 'plan' })
    expect(at({ loggedMin: ceiling + 25 })).toMatchObject({ max: ceiling + 25, bound: 'logged' })
    // the plan's figure and the minutes run both above the limit: the larger sets it
    expect(at({ engineMin: ceiling + 40, loggedMin: ceiling + 25 }).bound).toBe('plan')
    expect(at({ engineMin: ceiling + 25, loggedMin: ceiling + 40 }).bound).toBe('logged')
    // a tie goes to the limit, which allows the figure whatever else reaches it
    expect(at({ engineMin: ceiling, loggedMin: ceiling }).bound).toBe('limit')
    // the tightened profile reads the same way
    const tight = P.g3.priorBsiRampMax.value
    const step = Math.floor(200 * (1 + tight) + EPS)
    expect(at({ engineMin: 205 }, context({ tight }))).toMatchObject({
      kind: 'profile',
      max: step,
      bound: 'limit',
    })
    expect(at({ engineMin: step + 9 }, context({ tight }))).toMatchObject({
      kind: 'profile',
      max: step + 9,
      bound: 'plan',
    })
    expect(at({ engineMin: 205, loggedMin: step + 9 }, context({ tight }))).toMatchObject({
      kind: 'profile',
      max: step + 9,
      bound: 'logged',
    })
  })

  it('measures from the weeks that set a baseline, not from a recovery week', () => {
    // the recovery week two weeks before sets no baseline, as it does for the generator
    const ctx = context({
      skip: new Set([addDays(WEEK, -14)]),
      volumes: new Map([
        [addDays(WEEK, -7), 200],
        [addDays(WEEK, -14), 120],
        [addDays(WEEK, -21), 180],
        [addDays(WEEK, -28), 180],
      ]),
    })
    const { max } = targetLimit(ctx, WEEK, gates())
    expect(max).toBe(Math.floor(180 * (1 + P.g2.rampCeilingTwoWeeks.value) + EPS))
    expect(max).toBe(Math.floor(rampLimits(ctx, WEEK)!.allowed + EPS))
  })

  it('stands at the plan’s own figure when the ramp has no week to measure from', () => {
    const limit = targetLimit(
      context({ volumes: new Map(), typicalWeekMin: 0 }),
      WEEK,
      gates({ engineMin: 120 }),
    )
    expect(limit).toEqual({ max: 120, bound: 'plan', kind: 'ceiling', ramp: null })
  })
})

describe('targetLimit on a week a rule draws', () => {
  const own = (over: Partial<TargetGates>) => targetLimit(context(), WEEK, gates(over))

  it.each([
    ['post-race', { flags: ['post-race'] }],
    ['post-race', { flags: ['post-race-restart'] }],
    ['window', { flags: ['disrupted'] }],
    ['window', { flags: ['disruption-return'] }],
    ['programme', { flags: ['restart-floor'] }],
    ['programme', { flags: ['ladder-3'] }],
    ['programme', { flags: ['injury-return', 'injury-level-1'] }],
    ['structure', { isRecovery: true }],
    ['structure', { isTaper: true }],
    ['structure', { phase: 'taper' }],
    ['structure', { phase: 'race' }],
  ] as const)('is the plan’s own figure for %s (%j)', (kind, week) => {
    expect(own({ week: { ...plainWeek, ...week } })).toEqual({
      max: 215,
      bound: 'plan',
      kind,
      ramp: null,
    })
  })

  it('is the plan’s own figure under a hold and after a decision to hold or ease', () => {
    expect(own({ held: true })).toEqual({ max: 215, bound: 'plan', kind: 'hold', ramp: null })
    expect(own({ decided: true })).toEqual({
      max: 215,
      bound: 'plan',
      kind: 'decision',
      ramp: null,
    })
  })

  it('names the most specific rule first', () => {
    const every = { flags: ['post-race', 'disrupted', 'restart-floor'], isRecovery: true }
    expect(own({ week: { ...plainWeek, ...every }, held: true, decided: true }).kind).toBe(
      'post-race',
    )
    expect(
      own({ week: { ...plainWeek, flags: ['disrupted', 'restart-floor'] }, held: true }).kind,
    ).toBe('window')
    expect(own({ week: { ...plainWeek, flags: ['restart-floor'] }, held: true }).kind).toBe(
      'programme',
    )
    expect(own({ week: { ...plainWeek, isRecovery: true }, held: true, decided: true }).kind).toBe(
      'structure',
    )
    expect(own({ held: true, decided: true }).kind).toBe('decision')
  })

  it('keeps the minutes already run in the week, and says they set the figure', () => {
    expect(own({ held: true, loggedMin: 240 })).toMatchObject({ max: 240, bound: 'logged' })
    expect(own({ held: true, loggedMin: 215 })).toMatchObject({ max: 215, bound: 'plan' })
  })
})

describe('targetKept: what a week keeps of a raised target, and who owns the figure', () => {
  const limit = (over: Partial<Parameters<typeof targetKept>[2]> = {}) => ({
    max: 247,
    kind: 'ceiling' as const,
    bound: 'limit' as const,
    ...over,
  })

  it('keeps a target within the limit as set, whatever the limit is', () => {
    expect(targetKept(230, 209, limit())).toEqual({ keptMin: 230, released: false })
    expect(targetKept(247, 209, limit())).toEqual({ keptMin: 247, released: false })
    expect(targetKept(240, 209, limit({ kind: 'hold', max: 240, bound: 'logged' }))).toEqual({
      keptMin: 240,
      released: false,
    })
  })

  it('lowers a target above the ramp’s own limit to the limit, which stays the runner’s', () => {
    for (const kind of ['ceiling', 'profile'] as const) {
      expect(targetKept(400, 209, limit({ kind }))).toEqual({ keptMin: 247, released: false })
    }
    // the minutes already run set the figure: it is the week's own fact, and stays the runner's
    expect(targetKept(400, 209, limit({ max: 262, bound: 'logged' }))).toEqual({
      keptMin: 262,
      released: false,
    })
  })

  it('gives the week back to the plan where a rule sets the figure at this moment', () => {
    for (const kind of [
      'hold',
      'decision',
      'post-race',
      'window',
      'programme',
      'structure',
    ] as const) {
      expect(targetKept(400, 209, limit({ kind, max: 209, bound: 'plan' }))).toEqual({
        keptMin: 209,
        released: true,
      })
    }
    // the minutes run in the week do not make the figure the runner's under such a rule
    expect(targetKept(400, 209, limit({ kind: 'hold', max: 262, bound: 'logged' }))).toEqual({
      keptMin: 209,
      released: true,
    })
  })

  it('gives the week back to the plan when the plan’s own figure is above the ceiling', () => {
    expect(targetKept(400, 260, limit({ max: 260, bound: 'plan' }))).toEqual({
      keptMin: 260,
      released: true,
    })
    expect(targetKept(400, 260, limit({ kind: 'profile', max: 260, bound: 'plan' }))).toEqual({
      keptMin: 260,
      released: true,
    })
  })
})

describe.each(['half', 'first-100-mile', 'marathon'])(
  'the limit along the re-plans of %s',
  (id) => {
    const steps = replanSteps(id)

    it('is never under the plan’s own week, and the weeks the plan placed are within it', () => {
      let checked = 0
      for (const { draft, input } of steps) {
        const state = estimateState(input)
        const { ctx, weeks } = draftRamp(draft, input, state)
        const held = progressionHold(input, state)
        const currentMonday = mondayOf(input.today)
        for (const week of draft.weeks.filter((w) => w.weekStart >= currentMonday)) {
          const limit = targetLimit(ctx, week.weekStart, {
            engineMin: week.targetRunMin,
            week,
            held,
            decided: false,
            loggedMin: 0,
          })
          expect(
            limit.max,
            `${week.weekStart} of the plan of ${input.today}`,
          ).toBeGreaterThanOrEqual(week.targetRunMin)
          // the generator and the checklist plan inside the limit this rule reads
          const placed = weeks.find((w) => w.weekStart === week.weekStart)
          if (placed !== undefined && (limit.kind === 'ceiling' || limit.kind === 'profile')) {
            expect(
              placed.total,
              `${week.weekStart} of the plan of ${input.today}`,
            ).toBeLessThanOrEqual(Math.max(limit.max, placed.done) + 1e-6)
            checked += 1
          }
        }
      }
      expect(checked).toBeGreaterThan(20)
    })
  },
)

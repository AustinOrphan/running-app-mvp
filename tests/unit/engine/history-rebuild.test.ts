// The rebuild zone and the response to weeks run above plan [rules g-8, proposal sections 4.2 to
// 4.7 and 5.3]: the step below the rebuild ceiling R and the usual 10% above it, the cases H1, H3,
// H4, H9, H10, H13, H14, H15 and H26 of the zone and H16 to H21 of the response, the generator, the
// guards, the checklist and the weekly decision reading one zone and one baseline, and the matrix
// and a weekly re-plan chain at the three positions. Every expectation is derived from the Params,
// the raw activities and the finished plan, not from the code under test.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { draftRamp } from '../../../shared/engine/checklist.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import {
  ceilingWeeklyRate,
  rampLimits,
  rampStep,
  plannedMinOf,
  rebuildStep,
  recentRunMean,
  responseBaseline,
  type RampContext,
  type RebuildZone,
} from '../../../shared/engine/limits.ts'
import {
  blockLift,
  loadPosition,
  rebuildZone,
  responseBasis,
  zoneBlock,
} from '../../../shared/engine/loadSetting.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import type { PlanWeek as PlanWeekRow } from '../../../server/db.ts'
import { weekRow } from '../../../server/services/planEngine.ts'
import { planWeekWrites, raisedTargetLimits } from '../../../server/services/replan.ts'
import { mulberry32, windowOf } from './disruption-fixtures.ts'
import { activity, wellnessDay } from './e8-fixtures.ts'
import {
  at,
  h1,
  h10,
  h12,
  h12Short,
  h13Race,
  h13Window,
  h15,
  h26,
  h3Back,
  h4,
  h5,
  h6,
  h7,
  HISTORY_MONDAY,
  historyCases,
  runsOn,
  s3Runs,
  s4Runs,
  s5Runs,
  scenario,
  SPARSE,
  summer,
  week,
  weeks,
  withResponseWeeks,
  withTaperEnd,
  withTaperFloor,
  NO_RESPONSE,
  type HistoryCase,
  type Run,
} from './history-fixtures.ts'
import { planDigest } from './history-oracle.ts'
import {
  ceilingProblems,
  cumulative,
  eligibleWeekList,
  eligibleWeeks,
  expectedBaseline,
  expectedBlock,
  expectedResponse,
  expectedZone,
  planProblems,
  POSITIONS,
  UPPER_STEP,
  weeklyTotals,
  weeksToLong,
  weeksToWeekly,
  windowWeeksOf,
  zoneReport,
  type Position,
} from './history-properties.ts'
import { athletes } from './matrix-fixtures.ts'
import { replanChain, replanSteps } from './replan-steps.ts'

const LIFTED = ['standard', 'upper'] as const
const floorEps = (v: number) => Math.floor(v + 1e-9)

const planAt = (base: EngineInput, position?: Position) => buildPlan(at(base, position))
const zoneAt = (base: EngineInput, position: Position): RebuildZone | null => {
  const input = at(base, position)
  return rebuildZone(input, estimateState(input))
}
const positionAt = (base: EngineInput, position: Position) => {
  const input = at(base, position)
  return loadPosition(input, estimateState(input))
}

/** The week a loading week is planned at over its baseline `b`, from the rule alone [rules g-8]. */
const nextOf = (b: number, zone: RebuildZone | null): number =>
  floorEps(
    zone !== null && b < zone.ceilingMin
      ? Math.max(b * 1.1, Math.min(b * (1 + zone.step), zone.ceilingMin))
      : b * 1.1,
  )

/** The weeks that load: not a recovery, taper or race week. */
const loading = (plan: PlanDraft) =>
  plan.weeks.filter((w) => !w.isRecovery && !w.isTaper && w.phase !== 'race')

const detailOf = (plan: PlanDraft) => plan.checklist.find((c) => c.id === 'progression')!.detail

describe('rebuildStep and the weekly rate of the ceiling [rules g-8, g-2]', () => {
  const zone: RebuildZone = { ceilingMin: 196, step: 0.12 }

  it('is the usual step with no zone, whoever the runner is', () => {
    for (const from of [0, 1, 20, 100, 196, 333.3]) {
      for (const novice of [false, true]) {
        expect(rebuildStep(from, 0.1, novice, null)).toBe(rampStep(from, 0.1, novice))
      }
    }
  })

  it('takes the zone step below R, clamped at R, and never less than the usual step', () => {
    expect(rebuildStep(100, 0.1, false, zone)).toBeCloseTo(112)
    // 180 x 1.12 = 201.6 would pass R, so the week is planned at R or at the usual step, whichever is more
    expect(rebuildStep(180, 0.1, false, zone)).toBeCloseTo(198)
    expect(rebuildStep(185, 0.1, false, zone)).toBeCloseTo(203.5)
    expect(rebuildStep(194, 0.1, false, zone)).toBeCloseTo(213.4)
    // from R up the zone is over: the usual 10%
    expect(rebuildStep(196, 0.1, false, zone)).toBeCloseTo(215.6)
    expect(rebuildStep(250, 0.1, false, zone)).toBeCloseTo(275)
  })

  it('never plans a week above R except by the usual step, and never above the zone step', () => {
    for (let from = 10; from <= 400; from += 3.7) {
      const planned = rebuildStep(from, 0.1, false, zone)
      expect(planned).toBeGreaterThanOrEqual(from * 1.1 - 1e-9)
      expect(planned).toBeLessThanOrEqual(Math.max(from * 1.1, Math.min(from * 1.12, 196)) + 1e-9)
      if (from < 196) expect(planned).toBeLessThanOrEqual(Math.max(196, from * 1.1) + 1e-9)
    }
  })

  it('keeps the minimum step of a novice in the zone', () => {
    const min = P.g2.noviceMinStepMin.value
    expect(rebuildStep(5, 0.1, true, zone)).toBe(5 + Math.max(0.6, min))
    expect(rebuildStep(5, 0.1, true, zone)).toBeGreaterThan(rebuildStep(5, 0.1, false, zone))
  })

  it('derives the upper step from the hard ceiling: two weeks at it meet 30%', () => {
    expect(ceilingWeeklyRate()).toBeCloseTo(0.14, 3)
    expect((1 + ceilingWeeklyRate()) ** 2).toBeCloseTo(1 + P.g2.rampCeilingTwoWeeks.value, 12)
    // and it is the step of the upper position
    expect(zoneAt(h1(), 'upper')!.step).toBeCloseTo(ceilingWeeklyRate(), 12)
    expect(zoneAt(h1(), 'standard')!.step).toBe(P.g8.stepStandard.value)
    expect(UPPER_STEP).toBeCloseTo(ceilingWeeklyRate(), 12)
  })
})

describe('rampLimits in the zone [rules g-8, g-2]', () => {
  const zone: RebuildZone = { ceilingMin: 196, step: 0.12 }
  const WEEK = '2026-10-19'
  const context = (over: Partial<RampContext> = {}): RampContext => ({
    volumes: new Map([
      [addDays(WEEK, -7), 100],
      [addDays(WEEK, -14), 100],
      [addDays(WEEK, -21), 100],
    ]),
    skip: new Set(),
    floor: null,
    typicalWeekMin: 100,
    novice: false,
    tight: null,
    rebuild: zone,
    response: null,
    ...over,
  })

  it('gives a week under R the zone step as its soft limit and says which zone', () => {
    const limits = rampLimits(context(), WEEK)!
    expect(limits.base).toBe(100)
    expect(limits.soft).toBeCloseTo(112)
    expect(limits.usualSoft).toBeCloseTo(110)
    expect(limits.rebuild).toEqual(zone)
    expect(limits.plan).toBeCloseTo(112)
  })

  it('has no zone from R up, at steady, or in a start-path week', () => {
    const above = rampLimits(
      context({ volumes: new Map([[addDays(WEEK, -7), 200]]), typicalWeekMin: 200 }),
      WEEK,
    )!
    expect(above.rebuild).toBeNull()
    expect(above.soft).toBeCloseTo(above.usualSoft)
    const steady = rampLimits(context({ rebuild: null }), WEEK)!
    expect(steady.rebuild).toBeNull()
    expect(steady.soft).toBeCloseTo(110)
    const exempt = rampLimits(context({ exempt: new Map([[WEEK, 'soft']]) }), WEEK)!
    expect(exempt.rebuild).toBeNull()
  })

  it('leaves the hard ceiling and the tightened ramp where they are', () => {
    // weeks two and three back were 60: the ceiling is 78, under the zone's 112
    const ceiling = rampLimits(
      context({
        volumes: new Map([
          [addDays(WEEK, -7), 100],
          [addDays(WEEK, -14), 60],
          [addDays(WEEK, -21), 60],
        ]),
      }),
      WEEK,
    )!
    expect(ceiling.soft).toBeCloseTo(112)
    expect(ceiling.allowed).toBeCloseTo(78)
    expect(ceiling.plan).toBeCloseTo(78)
    const tight = rampLimits(context({ tight: 0.05 }), WEEK)!
    expect(tight.allowed).toBeCloseTo(105)
    expect(tight.plan).toBeCloseTo(105)
  })
})

describe('rebuildZone [rules g-8]', () => {
  it('is null at steady and with the option absent', () => {
    for (const base of [h1(), h1(3), h4(), scenario(s4Runs(), { years: 3 })]) {
      expect(zoneAt(base, 'steady')).toBeNull()
      const input = base
      expect(rebuildZone(input, estimateState(input))).toBeNull()
    }
  })

  it('is R = credit x taper x H and the position step, at standard and upper', () => {
    // the block of the appendix runner is 280 minutes a week, ended 8 weeks ago
    const standard = zoneAt(h1(), 'standard')!
    expect(standard.ceilingMin).toBeCloseTo(0.7 * 280, 9)
    expect(standard.step).toBe(0.12)
    const upper = zoneAt(h1(), 'upper')!
    expect(upper.ceilingMin).toBeCloseTo(0.85 * 280, 9)
    expect(upper.step).toBeCloseTo(ceilingWeeklyRate(), 12)
    // three years of running change the start, not the zone
    expect(zoneAt(h1(3), 'standard')).toEqual(standard)
  })

  it('reads upper as standard at age 45 or over, values and all', () => {
    const aged = scenario(s3Runs(), { profile: { birthYear: 1980 } })
    expect(positionAt(aged, 'upper').ageCapped).toBe(true)
    expect(zoneAt(aged, 'upper')).toEqual(zoneAt(aged, 'standard'))
    expect(zoneAt(aged, 'standard')!.ceilingMin).toBeCloseTo(196, 9)
  })

  it('is null wherever the position is held at steady, and while there is no block', () => {
    const injury = {
      area: 'knee',
      side: 'left' as const,
      year: 2026,
      month: 6,
      kind: 'joint' as const,
      notes: null,
    }
    const held: Array<[string, EngineInput]> = [
      ['a recent injury', scenario(s3Runs(), { profile: { injuries: [injury] } })],
      [
        'a bone stress injury',
        scenario(s3Runs(), {
          profile: { injuries: [{ ...injury, year: 2022, kind: 'bone-stress' }] },
        }),
      ],
      ['a REDs hold', scenario(s3Runs(), { screeningFlags: 2 })],
      ['a rest window', h13Window()],
      ['the window after a race', h13Race()],
      ['a low-frequency runner', h10()],
    ]
    for (const [name, base] of held) {
      for (const position of LIFTED) {
        expect(positionAt(base, position).held, `${name} ${position}`).not.toBeNull()
        expect(zoneAt(base, position), `${name} ${position}`).toBeNull()
      }
    }
    // no block in the window: the credit is nothing, whichever position
    for (const base of [h5(), h7()]) {
      for (const position of LIFTED) expect(zoneAt(base, position)).toBeNull()
    }
  })

  it('scales R by the taper of a block older than the window, up to 16 weeks', () => {
    const credit = { standard: P.g8.creditStandard.value, upper: P.g8.creditUpper.value }
    withTaperEnd(16, () => {
      // a block of 280 minutes a week that ended 12 to 17 weeks ago
      const expected = new Map([
        [12, 1],
        [13, 0.875],
        [14, 0.75],
        [15, 0.625],
        [16, 0.5],
        [17, null],
      ])
      for (const [ended, taper] of expected) {
        // sparse weeks since keep the runner out of the low-frequency hold
        const base = scenario([
          ...weeks(ended + 3, ended, [70, 70, 70, 70]),
          ...SPARSE.filter((r) => r.weeksBack <= 4),
        ])
        for (const position of LIFTED) {
          const zone = zoneAt(base, position)
          if (taper === null) expect(zone, `${String(ended)} ${position}`).toBeNull()
          else {
            expect(zone!.ceilingMin, `${String(ended)} ${position}`).toBeCloseTo(
              credit[position] * taper * 280,
              9,
            )
          }
        }
      }
    })
    // the 12-week window gives an older block nothing
    withTaperEnd(12, () => {
      expect(zoneAt(scenario(weeks(17, 14, [70, 70, 70, 70])), 'standard')).toBeNull()
    })
  })
})

describe('one function builds the ramp context of the generator, the guards and the checklist', () => {
  const ENGINE = join(import.meta.dirname, '../../../shared/engine')
  const read = (file: string) => readFileSync(join(ENGINE, file), 'utf8')

  it('is rampBasis in each builder, and nowhere else is a context assembled by hand', () => {
    for (const file of ['macro.ts', 'index.ts', 'guards.ts', 'checklist.ts']) {
      expect(read(file), file).toMatch(/\.\.\.rampBasis\(/)
    }
    const bare = readdirSync(ENGINE).filter(
      (file) =>
        file.endsWith('.ts') && file !== 'limits.ts' && /tight:\s*tightRamp\(/.test(read(file)),
    )
    expect(bare).toEqual([])
  })

  it('reads the baseline of a loading week through responseBaseline in the generator and in rampLimits, and nowhere else', () => {
    const files = readdirSync(ENGINE).filter((file) => file.endsWith('.ts'))
    // the explanation names the baseline a lifted week is built from through the same function
    expect(files.filter((file) => /\bresponseBaseline\(/.test(read(file)))).toEqual([
      'explainInputs.ts',
      'limits.ts',
      'macro.ts',
    ])
    expect(read('macro.ts')).toMatch(/responseBaseline\(lastWork, rampCtx\.response, rampNovice\)/)
    expect(read('limits.ts')).toMatch(/responseBaseline\(planned, ctx\.response, ctx\.novice\)/)
    // the block is found in one function, which the zone calls once more for the plan's own Monday
    expect(files.filter((file) => /\bhistoryBlock\(/.test(read(file)))).toEqual([
      'athlete.ts',
      'loadSetting.ts',
    ])
    // the mean is computed in one place and built into the response in one place
    expect(files.filter((file) => /\brecentRunMean\(/.test(read(file)))).toEqual([
      'limits.ts',
      'loadSetting.ts',
    ])
    // each builder of a ramp context passes the response the plan was drawn with
    for (const file of ['macro.ts', 'index.ts', 'checklist.ts']) {
      expect(read(file), file).toMatch(
        /rampBasis\(state, rebuildZone\(input, state\), responseBasis\(input, state\)\)/,
      )
    }
    expect(read('guards.ts')).toMatch(
      /rampBasis\(state, options\.rebuild \?\? null, options\.response \?\? null\)/,
    )
    expect(read('index.ts')).toMatch(/response: rampCtx\.response/)
    // and a quantity of the generator is stepped by the baseline, not by the last week by hand
    expect(read('macro.ts')).not.toMatch(/rebuildStep\(lastWork/)
  })

  it('gives the checklist, and so the re-plan limit of a raised target, the response of the generator', () => {
    const input = continued([100, 100, 100, 150], 'standard', 100)
    const state = estimateState(input)
    const { ctx } = draftRamp(replan(input).draft, input, state)
    expect(ctx.response).toEqual({ meanMin: 112.5 })
    expect(ctx.response).toEqual(responseBasis(input, state))
    const steady = continued([100, 100, 100, 150], 'steady', 100)
    const { ctx: held } = draftRamp(replan(steady).draft, steady, estimateState(steady))
    expect(held.response).toBeNull()
  })

  it('gives the checklist, and so the re-plan limit of a raised target, the zone of the generator', () => {
    for (const position of LIFTED) {
      const input = at(h1(), position)
      const state = estimateState(input)
      const { ctx } = draftRamp(buildPlan(input), input, state)
      expect(ctx.rebuild, position).toEqual(zoneAt(h1(), position))
    }
    const steady = at(h1(), 'steady')
    expect(draftRamp(buildPlan(steady), steady, estimateState(steady)).ctx.rebuild).toBeNull()
  })
})

describe('H1: the appendix runner, a strong block and sparse weeks since (one year of running)', () => {
  const steady = planAt(h1())

  it.each(LIFTED)(
    '%s: lifts the start, rebuilds by the zone step to R and then by 10%',
    (position) => {
      const plan = planAt(h1(), position)
      const zone = zoneAt(h1(), position)!
      // the lift: week 1 is 3 x 30 at standard and upper, 3 x 20 at steady
      expect(plan.weeks[0]!.targetRunMin).toBe(90)
      expect(plan.weeks[0]!.flags).toContain('restart-floor')
      expect(steady.weeks[0]!.targetRunMin).toBe(60)
      // every loading week after it follows the rule from the week before, the first twelve of them
      const seq = loading(plan).map((w) => w.targetRunMin)
      for (let i = 1; i < 12; i += 1) {
        expect(seq[i], `loading week ${String(i + 1)}`).toBe(nextOf(seq[i - 1]!, zone))
      }
      // it entered the zone, passed R, and was on the usual step from there
      const beforeR = seq.filter((m) => m < zone.ceilingMin).length
      expect(beforeR).toBeGreaterThan(4)
      expect(seq[beforeR]! / seq[beforeR - 1]!).toBeLessThanOrEqual(1.1 + 0.01)
      expect(Math.max(...seq.slice(0, beforeR + 1))).toBeGreaterThanOrEqual(zone.ceilingMin)
      expect(zoneReport(at(h1(), position), plan).problems).toEqual([])
      expect(zoneReport(at(h1(), position), plan).zoneWeeks).toBeGreaterThan(2)
    },
  )

  it.each(LIFTED)(
    '%s: no spike warning, no checklist failure, no week over the ceiling',
    (position) => {
      const plan = planAt(h1(), position)
      expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
      expect(planProblems(plan)).toEqual([])
      expect(ceilingProblems(at(h1(), position), plan)).toEqual([])
      expect(plan.sessions.flatMap((s) => s.flags)).not.toContain('spike-warn')
    },
  )

  it('names the zone in the progression detail where it applied, and only there', () => {
    expect(detailOf(steady)).toBe('Every week is within the weekly ramp.')
    expect(detailOf(planAt(h1(), 'standard'))).toMatch(
      /^Every week is within the weekly ramp; \d+ week\(s\) use the rebuild step of 12% a week, up to 196 min\.$/,
    )
    expect(detailOf(planAt(h1(), 'upper'))).toMatch(
      /^Every week is within the weekly ramp; \d+ week\(s\) use the rebuild step of 14% a week, up to 238 min\.$/,
    )
    for (const position of POSITIONS) expect(lintText(detailOf(planAt(h1(), position)))).toEqual([])
    // the checklist keeps its fifteen items
    for (const position of POSITIONS) expect(planAt(h1(), position).checklist).toHaveLength(15)
  })

  it('brings the weekly level and the long run sooner than steady, and not sooner than G-1 allows', () => {
    const standard = planAt(h1(), 'standard')
    const upper = planAt(h1(), 'upper')
    // measured on the appendix runner; the values are provisional until the replay on real history
    expect(
      [steady, standard, upper].map((p) => weeksToWeekly(p, 285)),
      'weekly >= 285',
    ).toEqual([25, 17, 14])
    expect(
      [steady, standard, upper].map((p) => weeksToLong(p, HISTORY_MONDAY, 150)),
      'long >= 150',
    ).toEqual([29, 22, 22])
    expect(
      [steady, standard, upper].map((p) => weeksToWeekly(p, 150)),
      'weekly >= 150',
    ).toEqual([16, 8, 6])
    // cumulative minutes are never below steady's
    for (const plan of [standard, upper]) {
      for (let count = 1; count <= steady.weeks.length; count += 1) {
        expect(cumulative(plan, count)).toBeGreaterThanOrEqual(cumulative(steady, count))
      }
    }
    // upper is ahead of standard
    expect(cumulative(upper, 14)).toBeGreaterThan(cumulative(standard, 14))
  })

  it('does not beat the control: the long run needs as long as with weekly time not limiting (S4)', () => {
    // five 45-minute runs a week: the weekly total is never what holds the long run
    const control = planAt(scenario(s4Runs(), { years: 3 }))
    for (const target of [90, 120, 150]) {
      const floor = weeksToLong(control, HISTORY_MONDAY, target)!
      for (const years of [1, 3] as const) {
        for (const position of POSITIONS) {
          const weeksNeeded = weeksToLong(planAt(h1(years), position), HISTORY_MONDAY, target)
          expect(
            weeksNeeded,
            `${String(years)}y ${position} ${String(target)}`,
          ).toBeGreaterThanOrEqual(floor)
        }
      }
    }
    expect(weeksToLong(control, HISTORY_MONDAY, 150)).toBe(20)
  })
})

describe('H2: three years of running change the start, not the zone', () => {
  it('has the same week 1 at every position and the zone from week 2 on', () => {
    const steady = planAt(h1(3))
    expect(steady.weeks[0]!.targetRunMin).toBe(90)
    for (const position of LIFTED) {
      const plan = planAt(h1(3), position)
      expect(plan.weeks[0]!.targetRunMin).toBe(90)
      const zone = zoneAt(h1(3), position)!
      const seq = loading(plan).map((w) => w.targetRunMin)
      for (let i = 1; i < 10; i += 1) expect(seq[i]).toBe(nextOf(seq[i - 1]!, zone))
      expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
    }
    // S3 with three years reaches a 150-minute long run in 22 weeks at steady, as the lift does for one year
    expect(weeksToLong(steady, HISTORY_MONDAY, 150)).toBe(22)
  })
})

describe('H3: a strong block, then a 41-day layoff (S5)', () => {
  it.each(LIFTED)(
    '%s: the J7 restart is the steady one, and the zone is off while the flag holds',
    (position) => {
      const base = scenario(s5Runs())
      expect(positionAt(base, position)).toMatchObject({
        position: 'steady',
        held: 'low-frequency',
      })
      expect(zoneAt(base, position)).toBeNull()
      const plan = planAt(base, position)
      expect(plan).toEqual(planAt(base))
      expect(plan.checklist.find((c) => c.id === 'break-restart')!.ok).toBe(true)
      // the restart is half the typical week, a floor of 3 x 30 at its largest
      expect(plan.weeks[0]!.targetRunMin).toBe(90)
    },
  )

  it.each(LIFTED)('%s: back on three runs a week for three weeks, the zone is on', (position) => {
    const base = h3Back()
    expect(estimateState(base).lowFrequency).toBe(false)
    expect(positionAt(base, position).held).toBeNull()
    const zone = zoneAt(base, position)!
    expect(zone.ceilingMin).toBeGreaterThan(estimateState(base).typicalWeekMin)
    const plan = planAt(base, position)
    const steady = planAt(base)
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
    // the first week is the same; the zone then goes ahead of steady
    expect(plan.weeks[0]!.targetRunMin).toBe(steady.weeks[0]!.targetRunMin)
    expect(cumulative(plan, 8)).toBeGreaterThan(cumulative(steady, 8))
    const seq = loading(plan).map((w) => w.targetRunMin)
    for (let i = 1; i < 8; i += 1) expect(seq[i]).toBe(nextOf(seq[i - 1]!, zone))
    expect(zoneReport(at(base, position), plan).zoneWeeks).toBeGreaterThan(2)
  })
})

describe('H4: a steady runner with no gap', () => {
  it('has R under the weekly level, never enters the zone, and gets the same draft at every position', () => {
    const base = h4()
    const level = estimateState(base).typicalWeekMin
    for (const position of LIFTED) {
      const zone = zoneAt(base, position)!
      expect(zone.ceilingMin, position).toBeLessThan(level)
      expect(planAt(base, position), position).toEqual(planAt(base, 'steady'))
      expect(zoneReport(at(base, position), planAt(base, position)).zoneWeeks).toBe(0)
    }
    expect(planAt(base)).toEqual(planAt(base, 'steady'))
  })
})

describe('H9: a progression hold (REDs flags, focal bone pain) switches the zone off', () => {
  const checkin = wellnessDay('2026-10-22', {
    fatigue: 3,
    soreness: 3,
    mood: 3,
    stress: 3,
    sleepQuality: 3,
    painFocalBone: true,
    painScore: 4,
  })
  const cases: Array<[string, EngineInput, string]> = [
    ['a REDs hold', scenario(s3Runs(), { screeningFlags: 2 }), 'reds-hold'],
    ['focal bone pain', scenario(s3Runs(), { wellness: [checkin] }), 'bone-pain'],
  ]

  it.each(cases)('%s: no zone, volume held, the steady draft', (_name, base, reason) => {
    const steady = planAt(base, 'steady')
    for (const position of LIFTED) {
      expect(positionAt(base, position).held).toBe(reason)
      expect(zoneAt(base, position)).toBeNull()
      expect(planAt(base, position)).toEqual(steady)
    }
    // every loading week holds the level of the first
    const first = steady.weeks[0]!.targetRunMin
    expect(new Set(loading(steady).map((w) => w.targetRunMin))).toEqual(new Set([first]))
  })
})

describe('H10: a low-frequency runner above the floor', () => {
  it('has no zone and keeps the 2:1 cadence', () => {
    const base = h10()
    expect(estimateState(base).lowFrequency).toBe(true)
    const steady = planAt(base, 'steady')
    for (const position of LIFTED) {
      expect(positionAt(base, position).held).toBe('low-frequency')
      expect(zoneAt(base, position)).toBeNull()
      expect(planAt(base, position)).toEqual(steady)
    }
    expect(steady.checklist.find((c) => c.id === 'recovery-cadence')!.ok).toBe(true)
    // never more than the flagged cycle's loading weeks in a row
    let run = 0
    let longest = 0
    for (const week of steady.weeks.filter((w) => !w.isTaper && w.phase !== 'race')) {
      run = week.isRecovery ? 0 : run + 1
      longest = Math.max(longest, run)
    }
    expect(longest).toBeLessThanOrEqual(P.e3.flaggedCycleWorkWeeks.value + 1)
  })
})

describe('H13: the windows around a race and a rest window', () => {
  it.each([
    ['inside the window after a race', h13Race(), 'post-race'],
    ['inside a rest window', h13Window(), 'rest-window'],
  ] as const)('%s: no zone, and the restart volumes are the steady ones', (_name, base, reason) => {
    const steady = planAt(base, 'steady')
    for (const position of LIFTED) {
      expect(positionAt(base, position).held).toBe(reason)
      expect(zoneAt(base, position)).toBeNull()
      expect(planAt(base, position)).toEqual(steady)
    }
  })

  it('a window still ahead holds nothing back, and the weeks after its return grow by the zone again', () => {
    const base: EngineInput = {
      ...h1(),
      disruptions: [windowOf({ startDate: '2026-11-16', endDate: '2026-11-22' })],
    }
    const steady = planAt(base)
    for (const position of LIFTED) {
      expect(positionAt(base, position).held).toBeNull()
      const plan = planAt(base, position)
      expect(planProblems(plan, steady)).toEqual([])
      // before the window the weeks are the zone's
      const before = plan.weeks.filter((w) => w.weekStart < '2026-11-16')
      const seq = before.filter((w) => !w.isRecovery).map((w) => w.targetRunMin)
      const zone = zoneAt(base, position)!
      for (let i = 1; i < seq.length; i += 1) expect(seq[i]).toBe(nextOf(seq[i - 1]!, zone))
      // the window week itself is the window's, not the zone's
      const windowWeek = plan.weeks.find((w) => w.weekStart === '2026-11-16')!
      expect(windowWeek.targetRunMin).toBeLessThanOrEqual(seq.at(-1)!)
      expect(zoneReport(at(base, position), plan).problems).toEqual([])
    }
  })
})

describe('H15: a race 12 weeks away', () => {
  it('ends the zone at the peak week of the plan, and leaves the taper as it was', () => {
    for (const position of LIFTED) {
      const base = h15()
      const steady = planAt(base, 'steady')
      const plan = planAt(base, position)
      const before = plan.weeks.filter((w) => !w.isTaper && w.phase !== 'race')
      const peak = Math.max(...before.map((w) => w.targetRunMin))
      // a 5 km plan peaks at 180 minutes: the zone reaches it, which steady cannot in 12 weeks
      expect(peak).toBe(180)
      expect(
        Math.max(...steady.weeks.filter((w) => !w.isTaper).map((w) => w.targetRunMin)),
      ).toBeLessThan(180)
      expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
      // the taper keeps its shape: the same share of the peak week as at steady, week by week
      const taper = (p: PlanDraft) => p.weeks.filter((w) => w.isTaper)
      const share = (p: PlanDraft) => {
        const top = Math.max(...p.weeks.filter((w) => !w.isTaper).map((w) => w.targetRunMin))
        return taper(p).map((w) => w.targetRunMin / top)
      }
      expect(taper(plan)).toHaveLength(taper(steady).length)
      share(plan).forEach((s, i) => expect(s).toBeCloseTo(share(steady)[i]!, 1))
      expect(taper(plan).map((w) => w.targetRunMin)).toEqual(
        [...taper(plan).map((w) => w.targetRunMin)].sort((a, b) => b - a),
      )
    }
  })
})

describe('H26: a peak block that ended 14 weeks ago, modest weeks since', () => {
  // the peak is 280 a week; the modest weeks are `since` minutes in two runs
  it('reads the modest block at 12 weeks, so R is a share of that and the old peak counts for nothing', () => {
    withTaperEnd(12, () => {
      const modest = estimateState(h26(100, 2)).history!
      expect(modest).toMatchObject({ blockMin: 100, taper: 1 })
      expect(zoneAt(h26(100, 2), 'standard')!.ceilingMin).toBeCloseTo(70, 9)
      expect(zoneAt(h26(100, 2), 'upper')!.ceilingMin).toBeCloseTo(85, 9)
      // the lift takes the modest block (100 >= 90), which already stands above R: no zone week
      expect(planAt(h26(100, 2), 'standard').weeks[0]!.targetRunMin).toBe(90)
      expect(
        zoneReport(at(h26(100, 2), 'standard'), planAt(h26(100, 2), 'standard')).zoneWeeks,
      ).toBe(0)
      // a block of 60 minutes is no lift, and R = 42 is under the 60-minute start
      expect(planAt(h26(60, 2), 'standard')).toEqual(planAt(h26(60, 2), 'steady'))
    })
  })

  it('reads the old peak at 16 weeks with a taper of 0.75, and still lifts nothing by it', () => {
    withTaperEnd(16, () => {
      expect(estimateState(h26(100, 2)).history).toMatchObject({ blockMin: 280, taper: 0.75 })
      for (const [position, credit] of [
        ['standard', 0.7],
        ['upper', 0.85],
      ] as const) {
        expect(zoneAt(h26(100, 2), position)!.ceilingMin).toBeCloseTo(credit * 0.75 * 280, 9)
      }
      // no lift by the old block: with modest weeks of 60 minutes the start is 3 x 20
      expect(planAt(h26(60, 2), 'standard').weeks[0]!.targetRunMin).toBe(60)
      // with 100 minutes it is the recent block (within 12 weeks) that lifts to 3 x 30
      expect(planAt(h26(100, 2), 'standard').weeks[0]!.targetRunMin).toBe(90)
      // the zone runs to the scaled R
      const zone = zoneAt(h26(60, 2), 'standard')!
      const seq = loading(planAt(h26(60, 2), 'standard')).map((w) => w.targetRunMin)
      for (let i = 1; i < 10; i += 1) expect(seq[i]).toBe(nextOf(seq[i - 1]!, zone))
      expect(Math.max(...seq)).toBeGreaterThan(zone.ceilingMin)
      expect(planAt(h26(60, 2), 'standard').checklist.filter((c) => !c.ok)).toEqual([])
    })
  })
})

// ---- the weekly decision and the re-plan chain (H14) ----

type Existing = NonNullable<EngineInput['existing']>
const asExisting = (plan: PlanDraft, today: string): Existing => ({
  weeks: plan.weeks,
  sessions: plan.sessions.map((s, i) => ({
    ...s,
    id: `s${String(i)}`,
    status: s.date < today ? 'completed' : 'planned',
    activityId: null,
  })),
})

interface Step {
  /** Every session of the week just run was run this many times its plan (default 1). */
  scale?: number
  /** The week just run was run 30 minutes past its plan, on its first run. */
  over?: boolean
  /** The decision for the week that starts on this Monday. */
  decision?: 'hold' | 'reduce'
}

/**
 * The plan and the input of every Monday: the first plan, then a re-plan on each Monday with the
 * week before run as planned (scaled, or plus the overshoot of the step), as the server does. A
 * hold caps the week at 85% of its plan; a reduce makes it a recovery week.
 */
function runChain(
  base: EngineInput,
  steps: readonly Step[],
): Array<{ input: EngineInput; plan: PlanDraft }> {
  let plan = buildPlan(base)
  let activities = base.activities
  const out = [{ input: base, plan }]
  let monday = addDays(mondayOf(base.today), 7)
  for (const step of steps) {
    const ran = plan.sessions
      .filter((s) => s.date >= addDays(monday, -7) && s.date < monday)
      .filter((s) => !['strength', 'race', 'mobility', 'rest'].includes(s.kind))
      .map((s, i) =>
        activity(s.date, {
          id: `done-${s.date}-${String(s.order)}`,
          durationSec:
            ((step.scale === undefined ? s.durationMin : Math.round(s.durationMin * step.scale)) +
              (step.over === true && i === 0 ? 30 : 0)) *
            60,
          distanceM:
            step.scale === undefined
              ? (s.distanceM ?? s.durationMin * 170)
              : Math.round((s.distanceM ?? s.durationMin * 170) * step.scale),
        }),
      )
    activities = [...activities, ...ran]
    const weekCaps: Record<string, number> = {}
    const decisions: Record<string, 'hold' | 'reduce'> = {}
    if (step.decision !== undefined) {
      decisions[monday] = step.decision
      if (step.decision === 'hold') {
        weekCaps[monday] = Math.floor(
          plan.weeks.find((w) => w.weekStart === monday)!.targetRunMin * 0.85,
        )
      }
    }
    const input = {
      ...base,
      today: monday,
      activities,
      existing: asExisting(plan, monday),
      weekCaps,
    }
    plan = replan(input, { decisions }).draft
    out.push({ input, plan })
    monday = addDays(monday, 7)
  }
  return out
}

describe('H14: a weekly re-plan chain', () => {
  // the summer block ended 5 weeks before the first Monday, so it stays in the window for 7 re-plans
  const base = scenario([...summer(5), ...weeks(4, 1, [40])])
  const plain: Step[] = [{}, {}, {}, {}, {}, {}, {}]
  const script: Step[] = [
    {},
    { over: true },
    { decision: 'hold' },
    {},
    { decision: 'reduce' },
    {},
    {},
  ]
  const targetsFrom = (plan: PlanDraft, monday: string) =>
    plan.weeks.filter((w) => w.weekStart >= monday).map((w) => [w.targetRunMin, w.isRecovery])

  it.each(POSITIONS)(
    '%s: every plan of the chain passes its checklist and stays inside the zone',
    (position) => {
      const chain = runChain(at(base, position), script)
      for (const [k, { input, plan }] of chain.entries()) {
        expect(planProblems(plan), `step ${String(k)}`).toEqual([])
        expect(zoneReport(input, plan).problems, `step ${String(k)}`).toEqual([])
      }
    },
  )

  it('at steady equals the chain with the option absent, and the zone never enters it', () => {
    const absent = runChain(base, script)
    const steady = runChain(at(base, 'steady'), script)
    expect(steady.map((s) => s.plan)).toEqual(absent.map((s) => s.plan))
  })

  // a few minutes over the plan leave the mean of the weeks run under the planned baseline, so the
  // response (standard and upper) has nothing to lift: the heavy chains below do
  it.each(POSITIONS)(
    '%s: a week run 30 minutes over its plan lifts nothing after it',
    (position) => {
      const quiet = runChain(at(base, position), plain)
      const over = runChain(at(base, position), [{}, { over: true }, {}, {}, {}])
      // the re-plans from the Monday after the overshot week on draw the same weeks as the quiet chain
      for (let k = 2; k < over.length; k += 1) {
        const monday = addDays(mondayOf(base.today), 7 * k)
        expect(targetsFrom(over[k]!.plan, monday), `step ${String(k)}`).toEqual(
          targetsFrom(quiet[k]!.plan, monday),
        )
      }
    },
  )

  it.each(POSITIONS)(
    '%s: a hold week takes no step, and the weeks after it resume from it',
    (position) => {
      const chain = runChain(at(base, position), script)
      const zone = zoneAt(base, position)
      const monday = addDays(mondayOf(base.today), 21)
      const { plan } = chain[3]!
      const planned = chain[2]!.plan.weeks.find((w) => w.weekStart === monday)!.targetRunMin
      const held = plan.weeks.find((w) => w.weekStart === monday)!
      // the cap of a hold is 85% of the week as planned, below the week before it
      expect(held.targetRunMin).toBe(floorEps(planned * 0.85))
      const before = [...chain[2]!.plan.weeks.filter((w) => w.weekStart < monday)]
        .reverse()
        .find((w) => !w.isRecovery)!
      expect(held.targetRunMin).toBeLessThanOrEqual(before.targetRunMin)
      // the week after it grows from the held week by the rule, and so does the one after that
      const after = plan.weeks.find((w) => w.weekStart === addDays(monday, 7))!
      expect(after.targetRunMin).toBe(nextOf(held.targetRunMin, zone))
      expect(after.targetRunMin).toBeGreaterThan(held.targetRunMin)
      const later = plan.weeks.find((w) => w.weekStart === addDays(monday, 14))!
      expect(later.targetRunMin).toBe(nextOf(after.targetRunMin, zone))
    },
  )

  it.each(POSITIONS)(
    '%s: a reduce week is a recovery week, and the zone resumes from the loading week before it',
    (position) => {
      const chain = runChain(at(base, position), script)
      const zone = zoneAt(base, position)
      const monday = addDays(mondayOf(base.today), 35)
      const { plan } = chain[5]!
      const reduced = plan.weeks.find((w) => w.weekStart === monday)!
      expect(reduced.isRecovery).toBe(true)
      const lastLoading = [...plan.weeks.filter((w) => w.weekStart < monday)]
        .reverse()
        .find((w) => !w.isRecovery && !w.isTaper)!
      expect(reduced.targetRunMin).toBeLessThanOrEqual(floorEps(lastLoading.targetRunMin * 0.75))
      // the first loading week after the recovery weeks is the rule's step from that loading week
      const next = plan.weeks.find((w) => w.weekStart > monday && !w.isRecovery && !w.isTaper)!
      expect(next.targetRunMin).toBe(nextOf(lastLoading.targetRunMin, zone))
    },
  )
})

// ---- the response to weeks run above plan (H16 to H21) ----

/**
 * A plan being continued, as the weekly re-plan sees it on `HISTORY_MONDAY`: the summer block of
 * appendix A, then the weeks `lastWeeks` as run (the oldest first, two runs each, the last the week
 * that has just ended), and the plan made the Monday before from the weeks up to the one before
 * them, with its week of this Monday set to `stored` minutes when given. The week that opens is in
 * that plan, so the plan is one the runner is following.
 */
function continued(
  lastWeeks: readonly number[],
  position: Position,
  stored: number | null = null,
  over: Parameters<typeof scenario>[1] = {},
): EngineInput {
  const count = lastWeeks.length
  const runs: Run[] = [
    ...summer(count + 1),
    ...lastWeeks.flatMap((minutes, i) => week(count - i, [minutes / 2, minutes / 2])),
  ]
  const earlier = runs
    .filter((r) => r.weeksBack >= 2)
    .map((r) => ({ ...r, weeksBack: r.weeksBack - 1 }))
  const before = addDays(HISTORY_MONDAY, -7)
  const prev = buildPlan({
    ...at(scenario(earlier, over), position),
    today: before,
    activities: runsOn(before, earlier),
  })
  const stand = prev.weeks.map((w) =>
    stored !== null && w.weekStart === HISTORY_MONDAY ? { ...w, targetRunMin: stored } : w,
  )
  return {
    ...at(scenario(runs, over), position),
    today: HISTORY_MONDAY,
    existing: asExisting({ ...prev, weeks: stand }, HISTORY_MONDAY),
  }
}

const weekOf = (plan: PlanDraft, monday: string) => plan.weeks.find((w) => w.weekStart === monday)!

/** The first loading week after `monday`, and the last loading week at or before it. */
const nextLoading = (plan: PlanDraft, monday: string) =>
  plan.weeks.find((w) => w.weekStart > monday && !w.isRecovery && !w.isTaper && w.phase !== 'race')!
const lastLoadingAt = (plan: PlanDraft, monday: string) =>
  plan.weeks
    .filter(
      (w) =>
        w.weekStart <= monday &&
        !w.isRecovery &&
        !w.isTaper &&
        w.phase !== 'race' &&
        !w.flags.includes('post-race'),
    )
    .at(-1)!

describe('the mean of the weeks run [rules g-8, G-5]', () => {
  const MON = HISTORY_MONDAY
  const rowsOf = (minutes: readonly number[]) =>
    minutes.map((runMin, i) => ({ weekStart: addDays(MON, -7 * (minutes.length - i)), runMin }))

  it('is the mean of the minutes of the last g8.responseWeeks complete weeks, newest first', () => {
    expect(P.g8.responseWeeks.value).toBe(4)
    expect(recentRunMean(rowsOf([50, 90, 100, 100, 100, 150]), new Set(), MON)).toBe(112.5)
    // the current week and the weeks after it are not complete
    const rows = [...rowsOf([100, 100, 100, 150]), { weekStart: MON, runMin: 400 }]
    expect(recentRunMean(rows, new Set(), MON)).toBe(112.5)
  })

  it('skips an excluded week and reads the next older one in its place, not a zero', () => {
    // weeks back: 6:80 5:60 4:100 3:200 2:100 1:100
    const rows = rowsOf([80, 60, 100, 200, 100, 100])
    const one = new Set([addDays(MON, -7)])
    expect(recentRunMean(rows, one, MON)).toBe((100 + 200 + 100 + 60) / 4)
    const two = new Set([addDays(MON, -7), addDays(MON, -21)])
    expect(recentRunMean(rows, two, MON)).toBe((100 + 100 + 60 + 80) / 4)
  })

  it('has no mean with fewer than four eligible weeks', () => {
    expect(recentRunMean(rowsOf([100, 100, 100]), new Set(), MON)).toBeNull()
    const rows = rowsOf([100, 100, 100, 100, 100])
    expect(recentRunMean(rows, new Set([addDays(MON, -7), addDays(MON, -14)]), MON)).toBeNull()
    expect(recentRunMean(rows, new Set([addDays(MON, -7)]), MON)).toBe(100)
  })

  it('counts a recovery week as run', () => {
    expect(recentRunMean(rowsOf([120, 132, 145, 91]), new Set(), MON)).toBeCloseTo(122, 9)
  })

  it('lifts a baseline to the mean, never lowers one and never passes the two-week ceiling over the planned baseline', () => {
    const rnd = mulberry32(20_261_025)
    let bounded = 0
    for (let n = 0; n < 300; n += 1) {
      const count = 3 + Math.floor(rnd() * 10)
      const rows = rowsOf(Array.from({ length: count }, () => Math.floor(rnd() * 400)))
      const excluded = new Set(rows.filter(() => rnd() < 0.25).map((r) => r.weekStart))
      const planned = Math.floor(rnd() * 400)
      const novice = rnd() < 0.3
      const eligible = rows.filter((r) => !excluded.has(r.weekStart)).slice(-4)
      const mean = recentRunMean(rows, excluded, MON)
      if (eligible.length < 4) {
        expect(mean).toBeNull()
        expect(responseBaseline(planned, { meanMin: mean }, novice)).toBe(planned)
        continue
      }
      const expected = eligible.reduce((sum, r) => sum + r.runMin, 0) / 4
      expect(mean).toBeCloseTo(expected, 9)
      const baseline = responseBaseline(planned, { meanMin: mean }, novice)
      // a newest week under its target leaves no mean to read, whatever the other weeks hold
      expect(responseBaseline(planned, { meanMin: null }, novice)).toBe(planned)
      const bound = rampStep(planned, P.g2.rampCeilingTwoWeeks.value, novice)
      expect(baseline).toBeGreaterThanOrEqual(planned)
      // never past the larger of the planned baseline and the largest week of the window ...
      expect(baseline).toBeLessThanOrEqual(Math.max(planned, ...eligible.map((r) => r.runMin)))
      // ... nor past the planned baseline stepped by the ceiling of two weeks
      expect(baseline).toBeLessThanOrEqual(bound + 1e-9)
      expect(baseline).toBeCloseTo(Math.max(planned, Math.min(expected, bound)), 9)
      if (expected > bound) bounded += 1
    }
    // a property that never met the bound would test nothing
    expect(bounded).toBeGreaterThan(20)
  })

  it('has nothing to lift when the newest eligible week was run under its stored target', () => {
    // the null case of the response: the position applies and the mean is not read
    expect(responseBaseline(100, { meanMin: null }, false)).toBe(100)
    expect(responseBaseline(100, { meanMin: null }, true)).toBe(100)
  })

  it('leaves the baseline as it is at steady and where the state has no mean', () => {
    expect(responseBaseline(121, null, false)).toBe(121)
    expect(responseBaseline(121, { meanMin: null }, false)).toBe(121)
    expect(responseBaseline(121, { meanMin: 121 }, false)).toBe(121)
    expect(responseBaseline(121, { meanMin: 100 }, false)).toBe(121)
  })

  it('stops a lift at the planned baseline stepped by the two-week ceiling, the novice minimum step included', () => {
    const ceiling = P.g2.rampCeilingTwoWeeks.value
    // one week of 500 minutes after weeks of about 100: a mean of 185 against a planned 70 is 2.6
    // times the plan, and the lift stops at 1.3 times it
    expect(responseBaseline(70, { meanMin: 185 }, false)).toBeCloseTo(70 * (1 + ceiling), 9)
    // a mean inside the bound is taken whole, as before
    expect(responseBaseline(121, { meanMin: 126.75 }, false)).toBeCloseTo(126.75, 9)
    // the minimum step of a novice raises the bound of a small baseline
    const step = P.g2.noviceMinStepMin.value
    expect(responseBaseline(10, { meanMin: 100 }, true)).toBeCloseTo(
      10 + Math.max(10 * ceiling, step),
      9,
    )
    expect(responseBaseline(10, { meanMin: 100 }, false)).toBeCloseTo(10 * (1 + ceiling), 9)
  })
})

describe('rampLimits with the response [rules g-8, g-2]', () => {
  const WEEK = '2026-10-19'
  const context = (over: Partial<RampContext> = {}): RampContext => ({
    volumes: new Map([
      [addDays(WEEK, -7), 100],
      [addDays(WEEK, -14), 100],
      [addDays(WEEK, -21), 100],
    ]),
    skip: new Set(),
    floor: null,
    typicalWeekMin: 100,
    novice: false,
    tight: null,
    rebuild: null,
    response: null,
    ...over,
  })

  it('measures the soft step from the mean when it is higher, and leaves the ceiling where it is', () => {
    const plain = rampLimits(context(), WEEK)!
    expect(plain.base).toBe(100)
    const lifted = rampLimits(context({ response: { meanMin: 112.5 } }), WEEK)!
    expect(lifted.base).toBe(112.5)
    expect(lifted.soft).toBeCloseTo(112.5 * 1.1, 9)
    expect(lifted.usualSoft).toBeCloseTo(112.5 * 1.1, 9)
    // the hard ceiling reads the weeks two and three back, never the mean
    expect(lifted.allowed).toBe(plain.allowed)
    expect(lifted.allowed).toBeCloseTo(130, 9)
    // a mean far above the weeks lifts the baseline no further than the ceiling of two weeks over
    // the planned one, and cannot take the planned week past the hard ceiling either
    const far = rampLimits(context({ response: { meanMin: 250 } }), WEEK)!
    expect(far.base).toBeCloseTo(130, 9)
    expect(far.soft).toBeCloseTo(143, 9)
    expect(far.plan).toBeCloseTo(130, 9)
  })

  it('takes the zone step from the lifted baseline, and a mean under the baseline changes nothing', () => {
    const zone: RebuildZone = { ceilingMin: 196, step: 0.12 }
    const lifted = rampLimits(context({ rebuild: zone, response: { meanMin: 120 } }), WEEK)!
    expect(lifted.soft).toBeCloseTo(134.4, 9)
    expect(lifted.rebuild).toEqual(zone)
    // a mean past the bound steps from the bound: 100 x 1.30, then the zone's 12%
    const capped = rampLimits(context({ rebuild: zone, response: { meanMin: 150 } }), WEEK)!
    expect(capped.base).toBeCloseTo(130, 9)
    expect(capped.soft).toBeCloseTo(145.6, 9)
    const under = rampLimits(context({ rebuild: zone, response: { meanMin: 90 } }), WEEK)!
    expect(under).toEqual(rampLimits(context({ rebuild: zone }), WEEK))
    expect(rampLimits(context({ response: { meanMin: null } }), WEEK)).toEqual(
      rampLimits(context(), WEEK),
    )
  })

  it('lifts the fallback baseline of a runner with no recent week too, and a start-path week not at all', () => {
    const bare = context({ volumes: new Map(), typicalWeekMin: 80, response: { meanMin: 95 } })
    expect(rampLimits(bare, WEEK)!.base).toBe(95)
    const exempt = rampLimits(
      context({ response: { meanMin: 150 }, exempt: new Map([[WEEK, 'soft']]) }),
      WEEK,
    )!
    expect(exempt.exempt).toBe(true)
    expect(exempt.plan).toBe(exempt.allowed)
  })
})

describe('H16: weeks run above plan lift the baseline to their mean, then the position steps', () => {
  it('reads the example of the proposal: planned 100, 110, 121 and a recovery week of 91, run at 120, 132, 145 and 110', () => {
    const mean = recentRunMean(
      [120, 132, 145, 110].map((runMin, i) => ({
        weekStart: addDays(HISTORY_MONDAY, -7 * (4 - i)),
        runMin,
      })),
      new Set(),
      HISTORY_MONDAY,
    )!
    expect(mean).toBeCloseTo(126.75, 9)
    const baseline = responseBaseline(121, { meanMin: mean }, false)
    expect(baseline).toBeCloseTo(126.75, 9)
    // 4.8% above the planned baseline, and the position's step applies to it
    expect(baseline / 121 - 1).toBeCloseTo(0.0475, 3)
    expect(rebuildStep(baseline, 0.1, false, { ceilingMin: 196, step: 0.12 })).toBeCloseTo(
      126.75 * 1.12,
      9,
    )
  })

  const heavy: Step[] = Array.from({ length: 7 }, () => ({ scale: 1.6 }))
  const base = scenario([...summer(5), ...weeks(4, 1, [40])])

  it.each(LIFTED)(
    '%s: when the mean of the weeks run passes the planned baseline, the next loading week is the step from that mean',
    (position) => {
      const chain = runChain(at(base, position), heavy)
      const zone = zoneAt(base, position)
      let engaged = 0
      for (let k = 1; k < chain.length; k += 1) {
        const { input, plan } = chain[k]!
        const monday = mondayOf(input.today)
        const response = expectedResponse(input)!
        const planned = lastLoadingAt(chain[k - 1]!.plan, monday).targetRunMin
        const next = nextLoading(plan, monday).targetRunMin
        // never below the step from the planned baseline
        expect(next, `step ${String(k)}`).toBeGreaterThanOrEqual(nextOf(planned, zone))
        if (response.meanMin !== null && response.meanMin > planned) {
          engaged += 1
          // and never above the step from the mean, which stops at the ceiling of two weeks over
          // the planned baseline
          const lifted = expectedBaseline(planned, response.meanMin)
          expect(next, `step ${String(k)}`).toBeLessThanOrEqual(nextOf(lifted, zone))
          if (next > nextOf(planned, zone)) {
            expect(next, `step ${String(k)}`).toBe(nextOf(lifted, zone))
          }
        } else {
          expect(next, `step ${String(k)}`).toBe(nextOf(planned, zone))
        }
      }
      // a chain that never passed the planned baseline would test nothing
      expect(engaged).toBeGreaterThan(1)
    },
  )

  it.each(LIFTED)(
    '%s: every plan of the chain passes its checklist and keeps the limits',
    (position) => {
      const chain = runChain(at(base, position), heavy)
      for (const [k, { input, plan }] of chain.entries()) {
        expect(planProblems(plan), `step ${String(k)}`).toEqual([])
        expect(zoneReport(input, plan).problems, `step ${String(k)}`).toEqual([])
        expect(ceilingProblems(input, plan), `step ${String(k)}`).toEqual([])
        expect(
          plan.sessions.filter((s) => s.flags.includes('override-required')),
          `step ${String(k)}`,
        ).toEqual([])
      }
    },
  )

  it.each(LIFTED)(
    '%s: the response adds minutes only where the mean passes the planned baseline, and changes nothing elsewhere',
    (position) => {
      const chain = runChain(at(base, position), heavy)
      let added = 0
      for (const [k, { input, plan }] of chain.entries()) {
        if (k === 0) continue
        // the same input with the response switched off: the zone alone
        const zoneOnly = withResponseWeeks(NO_RESPONSE, () => replan(input).draft)
        const monday = mondayOf(input.today)
        const planned = lastLoadingAt(chain[k - 1]!.plan, monday).targetRunMin
        const mean = expectedResponse(input)!.meanMin
        if (mean === null || mean <= planned) {
          expect(plan, `step ${String(k)}`).toEqual(zoneOnly)
        } else {
          expect(cumulative(plan, 12), `step ${String(k)}`).toBeGreaterThanOrEqual(
            cumulative(zoneOnly, 12),
          )
          if (cumulative(plan, 12) > cumulative(zoneOnly, 12)) added += 1
        }
      }
      expect(added).toBeGreaterThan(1)
    },
  )
})

describe('H17: one big week among three modest ones (the measured example of the proposal)', () => {
  const NEXT = addDays(HISTORY_MONDAY, 7)
  const input150 = (position: Position, lastWeeks = [100, 100, 100, 150]) =>
    continued(lastWeeks, position, 100)

  it('moves the baseline by a quarter of the excess, and the standard week after it is 12% above that', () => {
    const input = input150('standard')
    expect(responseBasis(input, estimateState(input))!.meanMin).toBe(112.5)
    expect(expectedResponse(input)!.meanMin).toBe(112.5)
    const plan = replan(input).draft
    // the week that opens is the plan's own 100; the next is the zone's 12% step from 112.5
    expect(weekOf(plan, HISTORY_MONDAY).targetRunMin).toBe(100)
    expect(zoneAt(input, 'standard')!.ceilingMin).toBeCloseTo(196, 9)
    expect(weekOf(plan, NEXT).targetRunMin).toBe(floorEps(112.5 * 1.12))
    expect(weekOf(plan, NEXT).targetRunMin).toBe(126)
    // inside the 30% ceiling over the weeks two and three back, for this week and the one after
    expect(weekOf(plan, NEXT).targetRunMin).toBeLessThanOrEqual(floorEps(150 * 1.3))
    const after = nextLoading(plan, NEXT)
    const behind = [14, 21].map((d) => weekOf(plan, addDays(after.weekStart, -d)).targetRunMin)
    expect(after.targetRunMin).toBeLessThanOrEqual(floorEps(Math.max(...behind) * 1.3))
    expect(planProblems(plan)).toEqual([])
  })

  it('is above the same runner without the big week (112), at upper by the ceiling weekly rate', () => {
    const control = replan(input150('standard', [100, 100, 100, 100])).draft
    expect(weekOf(control, NEXT).targetRunMin).toBe(112)
    expect(weekOf(replan(input150('standard')).draft, NEXT).targetRunMin).toBe(126)
    const upper = replan(input150('upper')).draft
    expect(weekOf(upper, NEXT).targetRunMin).toBe(floorEps(112.5 * (1 + ceilingWeeklyRate())))
  })

  it('lifts nothing at steady: the week is 110, whether the option is steady or absent', () => {
    const input = input150('steady')
    expect(responseBasis(input, estimateState(input))).toBeNull()
    const plan = replan(input).draft
    expect(weekOf(plan, NEXT).targetRunMin).toBe(110)
    expect(replan({ ...input, options: {} }).draft).toEqual(plan)
  })
})

describe('H18: race weeks and rest-window weeks are skipped', () => {
  const back = (n: number) => addDays(HISTORY_MONDAY, -7 * n)
  // weeks back 6 .. 1, as run
  const lastWeeks = [60, 140, 90, 100, 50, 100]
  const race = activity(addDays(back(2), 5), {
    id: 'race-b2',
    type: 'race',
    durationSec: 50 * 60,
    movingSec: 50 * 60,
    distanceM: 10_000,
  })
  // two days of the week back 3 in which running is limited (no days after it are touched)
  const travel = windowOf({
    id: 'w-b3',
    reason: 'travel',
    mode: 'limited',
    maxRunMin: 60,
    startDate: addDays(back(3), 2),
    endDate: addDays(back(3), 3),
  })
  const raced = (): EngineInput => {
    const base = continued(lastWeeks, 'standard', 90)
    return { ...base, activities: [...base.activities, race] }
  }

  it('a race week among the last four is skipped, and the window reaches back to a fourth week', () => {
    const input = raced()
    const state = estimateState(input)
    expect(state.weeks.find((w) => w.weekStart === back(2))!.raceMin).toBeGreaterThan(0)
    // back 1, 3, 4 and 5, from the raw runs
    expect(eligibleWeeks(input)).toEqual([100, 100, 90, 140])
    expect(responseBasis(input, state)!.meanMin).toBeCloseTo(107.5, 9)
  })

  it('a rest-window week among the last four is skipped as well', () => {
    const input: EngineInput = { ...raced(), disruptions: [travel] }
    const state = estimateState(input)
    expect(eligibleWeeks(input, windowWeeksOf(input))).toEqual([100, 90, 140, 60])
    expect(responseBasis(input, state)!.meanMin).toBeCloseTo(97.5, 9)
    // the weeks as they stand would give (100 + 50 + 100 + 90) / 4 = 85, under the planned 90
    const plan = replan(input).draft
    expect(weekOf(plan, addDays(HISTORY_MONDAY, 7)).targetRunMin).toBe(floorEps(97.5 * 1.12))
  })

  it('a state with fewer than four eligible weeks has no response', () => {
    // a window over the last 13 weeks leaves three weeks of the 16 the state holds
    const long = windowOf({
      id: 'w-long',
      reason: 'travel',
      mode: 'limited',
      maxRunMin: 60,
      startDate: back(13),
      endDate: addDays(HISTORY_MONDAY, -1),
    })
    const input: EngineInput = { ...raced(), disruptions: [long] }
    const state = estimateState(input)
    expect(state.weeks).toHaveLength(16)
    expect(eligibleWeeks(input, windowWeeksOf(input)).length).toBeLessThan(4)
    expect(responseBasis(input, state)).toEqual({ meanMin: null })
    expect(() => replan(input)).not.toThrow()
  })
})

describe('H19: steady lifts nothing for weeks run above plan', () => {
  const heavy: Step[] = Array.from({ length: 7 }, () => ({ scale: 1.6 }))
  const base = scenario([...summer(5), ...weeks(4, 1, [40])])

  it('has no response, and the re-plan after weeks far above plan is the one with the option absent', () => {
    const input = continued([200, 200, 200, 200], 'steady', 100)
    expect(responseBasis(input, estimateState(input))).toBeNull()
    expect(expectedResponse(input)).toBeNull()
    const plan = replan(input).draft
    expect(weekOf(plan, addDays(HISTORY_MONDAY, 7)).targetRunMin).toBe(110)
    expect(replan({ ...input, options: {} }).draft).toEqual(plan)
  })

  it('draws every plan of a chain run 1.6 times its plan as the chain with the option absent', () => {
    const absent = runChain(base, heavy)
    const steady = runChain(at(base, 'steady'), heavy)
    expect(steady.map((s) => s.plan)).toEqual(absent.map((s) => s.plan))
  })
})

describe('H20: a hold or reduce decision wins over the response, and the profiles that hold the setting have none', () => {
  const base = scenario([...summer(5), ...weeks(4, 1, [40])])
  const script: Step[] = [
    ...Array.from({ length: 5 }, (): Step => ({ scale: 1.6 })),
    { scale: 1.6, decision: 'hold' },
    { scale: 1.6 },
    { scale: 1.6, decision: 'reduce' },
    { scale: 1.6 },
    { scale: 1.6 },
  ]

  it.each(LIFTED)(
    '%s: the week a hold covers takes no step and stays under the mean of the weeks run',
    (position) => {
      const chain = runChain(at(base, position), script)
      const step = 6
      const { input, plan } = chain[step]!
      const monday = mondayOf(input.today)
      const stored = weekOf(chain[step - 1]!.plan, monday).targetRunMin
      const response = expectedResponse(input)!
      // the response is in play: the mean is above the planned baseline of the week
      expect(response.meanMin!).toBeGreaterThan(
        lastLoadingAt(chain[step - 1]!.plan, monday).targetRunMin,
      )
      const held = weekOf(plan, monday)
      expect(held.targetRunMin).toBeLessThanOrEqual(floorEps(stored * 0.85))
      expect(held.targetRunMin).toBeLessThan(response.meanMin!)
      // the weeks after it are the response's again, inside every limit
      for (const [k, entry] of chain.entries()) {
        expect(planProblems(entry.plan), `step ${String(k)}`).toEqual([])
        expect(zoneReport(entry.input, entry.plan).problems, `step ${String(k)}`).toEqual([])
        expect(ceilingProblems(entry.input, entry.plan), `step ${String(k)}`).toEqual([])
      }
    },
  )

  it.each(LIFTED)(
    '%s: the week a reduce covers is a recovery week cut from the loading week before it',
    (position) => {
      const chain = runChain(at(base, position), script)
      const step = 8
      const { input, plan } = chain[step]!
      const monday = mondayOf(input.today)
      const response = expectedResponse(input)!
      const lastLoading = lastLoadingAt(
        { ...plan, weeks: plan.weeks.filter((w) => w.weekStart < monday) },
        monday,
      )
      expect(response.meanMin!).toBeGreaterThan(lastLoading.targetRunMin)
      const reduced = weekOf(plan, monday)
      expect(reduced.isRecovery).toBe(true)
      expect(reduced.targetRunMin).toBeLessThanOrEqual(floorEps(lastLoading.targetRunMin * 0.75))
    },
  )

  it('has no response under any profile that holds the position at steady, whatever the weeks run', () => {
    const injury = {
      area: 'knee',
      side: 'left' as const,
      year: 2026,
      month: 6,
      kind: 'joint' as const,
      notes: null,
    }
    const checkin = wellnessDay('2026-10-18', {
      fatigue: 3,
      soreness: 3,
      mood: 3,
      stress: 3,
      sleepQuality: 3,
      painFocalBone: true,
      painScore: 4,
    })
    const held: Array<[string, EngineInput]> = [
      [
        'a recent injury',
        continued([200, 200, 200, 200], 'standard', 100, { profile: { injuries: [injury] } }),
      ],
      [
        'a bone stress injury',
        continued([200, 200, 200, 200], 'standard', 100, {
          profile: { injuries: [{ ...injury, year: 2022, kind: 'bone-stress' }] },
        }),
      ],
      ['a REDs hold', continued([200, 200, 200, 200], 'standard', 100, { screeningFlags: 2 })],
      [
        'focal bone pain',
        continued([200, 200, 200, 200], 'standard', 100, { wellness: [checkin] }),
      ],
      [
        'a rest window',
        continued([200, 200, 200, 200], 'standard', 100, {
          disruptions: [windowOf({ startDate: '2026-10-19', endDate: '2026-10-23' })],
        }),
      ],
    ]
    const free = continued([200, 200, 200, 200], 'standard', 100)
    expect(responseBasis(free, estimateState(free))!.meanMin).toBe(200)
    for (const [name, input] of held) {
      const state = estimateState(input)
      expect(loadPosition(input, state).held, name).not.toBeNull()
      expect(responseBasis(input, state), name).toBeNull()
      expect(expectedResponse(input), name).toBeNull()
    }
  })

  it('has no response for a plan that is new or that restarts after a break', () => {
    // the same runs without a stored plan: the plan starts from the weeks as run
    const input = continued([200, 200, 200, 200], 'standard', 100)
    const fresh: EngineInput = { ...input, existing: null }
    expect(responseBasis(fresh, estimateState(fresh))).toBeNull()
    expect(buildPlan(fresh)).toEqual(buildPlan(at(fresh, 'steady')))
    // a break of a week or more restarts from the typical week
    const broken = scenario(s5Runs())
    const withPlan: EngineInput = {
      ...at(broken, 'standard'),
      existing: asExisting(buildPlan(at(broken, 'steady')), broken.today),
    }
    expect(estimateState(withPlan).layoffDays).toBeGreaterThanOrEqual(P.j7.tier1Days.value)
    expect(responseBasis(withPlan, estimateState(withPlan))).toBeNull()
  })
})

describe('a week run past its target in the week of the re-plan [rules G-2, g-8]', () => {
  const WEDNESDAY = addDays(HISTORY_MONDAY, 2)
  const NEXT = addDays(HISTORY_MONDAY, 7)
  /** The week of the re-plan with 150 minutes already run in it, against a target of 100. */
  const midWeek = (position: Position): EngineInput => {
    const input = continued([100, 100, 100, 100], position, 100)
    const runs = runsOn(HISTORY_MONDAY, [
      { weeksBack: 0, dow: 0, min: 75 },
      { weeksBack: 0, dow: 1, min: 75 },
    ])
    return { ...input, today: WEDNESDAY, activities: [...input.activities, ...runs] }
  }

  it.each(POSITIONS)(
    '%s: is taken as run and flagged, with the minutes it was planned at',
    (position) => {
      const week = weekOf(replan(midWeek(position)).draft, HISTORY_MONDAY)
      expect(week.targetRunMin).toBe(150)
      expect(week.flags).toContain('overshoot')
      expect(week.flags).toContain('planned-100')
      expect(plannedMinOf(week)).toBe(100)
    },
  )

  it.each(POSITIONS)(
    '%s: lifts nothing for the weeks after it until it is complete',
    (position) => {
      const input = midWeek(position)
      const plan = replan(input).draft
      // the part week is no week of the mean, which reads the four complete weeks of 100
      expect(expectedResponse(input)?.meanMin ?? 100).toBe(100)
      const zone = zoneAt(input, position)
      expect(weekOf(plan, NEXT).targetRunMin).toBe(nextOf(100, zone))
    },
  )
})

describe('two weeks under the plan after two above it [rules g-2, g-8]', () => {
  // weeks back 4 .. 1 of 150, 150, 60 and 60 minutes against a stored week of 150
  const dip = (position: Position) => continued([150, 150, 60, 60], position, 150)

  it.each(LIFTED)(
    '%s: the week that opens is cut as it is without the response, since missed training still lowers it',
    (position) => {
      const input = dip(position)
      const plan = replan(input).draft
      const zoneOnly = withResponseWeeks(NO_RESPONSE, () => replan(input).draft)
      // The focus is left out: it names the rebuild ceiling on the weeks the checklist counts as
      // zone weeks, and the checklist measures the opening week from the lifted baseline when the
      // response is on, where the week of 60-odd minutes is within the usual step.
      const cut = (draft: PlanDraft) => ({ ...weekOf(draft, HISTORY_MONDAY), focus: '' })
      expect(cut(plan)).toEqual(cut(zoneOnly))
      // 60 minutes in the weeks before it: not the mean of 105 that the four weeks give
      expect(weekOf(plan, HISTORY_MONDAY).targetRunMin).toBeLessThan(75)
    },
  )

  // The four weeks average 105, above the planned baseline, but the newest ran under its stored
  // target: missed training lowers the plan and is never a reason to lift it (G-2, G-6; proposal 5.6
  // finding 2). Without the rule the weeks after the opening week were lifted from 78 to 101.
  it.each(LIFTED)(
    '%s: nothing lifts the weeks after it, and they are the plan without a response',
    (position) => {
      const input = dip(position)
      expect(expectedResponse(input)!.weeksMean).toBe(105)
      expect(expectedResponse(input)!.meanMin).toBeNull()
      expect(responseBasis(input, estimateState(input))).toEqual({ meanMin: null })
      const plan = replan(input).draft
      expect(plan).toEqual(withResponseWeeks(NO_RESPONSE, () => replan(input).draft))
      expect(planProblems(plan)).toEqual([])
      expect(zoneReport(input, plan).problems).toEqual([])
      // each week after the opening week is the rule's step from the week planned before it, and
      // none reaches the mean of 105 that the old rule stepped from
      const zone = zoneAt(input, position)
      const open = weekOf(plan, HISTORY_MONDAY).targetRunMin
      const next = weekOf(plan, addDays(HISTORY_MONDAY, 7)).targetRunMin
      expect(next).toBe(nextOf(open, zone))
      expect(next).toBeLessThan(floorEps(105 * (1 + P.g8.stepStandard.value)))
    },
  )
})

describe('H21: a mean far above the plan meets the ceiling and the session guard', () => {
  const NEXT = addDays(HISTORY_MONDAY, 7)

  it.each(LIFTED)('%s: the week is cut to the 30% ceiling and no run is flagged', (position) => {
    // two big weeks, then two of 100: the mean is 250 and the ceiling reads the weeks two and three
    // back. The newest week was run as planned (100), so the response applies; the bound holds the
    // baseline at 1.3 times the planned 110, and the ceiling cuts the week to 1.3 times the 100.
    const stored = continued([400, 400, 100, 100], position, 110)
    const input: EngineInput = {
      ...stored,
      existing: {
        ...stored.existing!,
        weeks: stored.existing!.weeks.map((w) =>
          w.weekStart === addDays(HISTORY_MONDAY, -7) ? { ...w, targetRunMin: 100 } : w,
        ),
      },
    }
    expect(responseBasis(input, estimateState(input))!.meanMin).toBe(250)
    const plan = replan(input).draft
    const next = weekOf(plan, NEXT)
    expect(next.targetRunMin).toBe(floorEps(100 * (1 + P.g2.rampCeilingTwoWeeks.value)))
    expect(planProblems(plan)).toEqual([])
    expect(plan.sessions.filter((s) => s.flags.includes('spike-warn'))).toEqual([])
    expect(plan.sessions.filter((s) => s.flags.includes('override-required'))).toEqual([])
    expect(zoneReport(input, plan).problems).toEqual([])
    expect(ceilingProblems(input, plan)).toEqual([])
  })
})

// ---- the matrix ----

describe.each(athletes())('the plan matrix at standard and upper: $label', (a) => {
  const steady = buildPlan(a.input)

  it.each(LIFTED)(
    '%s: passes the load items of the checklist and keeps every limit',
    (position) => {
      const input = at(a.input, position)
      const plan = buildPlan(input)
      expect(planProblems(plan, steady)).toEqual([])
      expect(zoneReport(input, plan).problems).toEqual([])
      expect(ceilingProblems(input, plan)).toEqual([])
      expect(plan.sessions.filter((s) => s.flags.includes('override-required'))).toEqual([])
      expect(buildPlan(structuredClone(input))).toEqual(plan)
    },
  )

  it.each(LIFTED)('%s: is the steady plan unless the runner has a zone or a lift', (position) => {
    const input = at(a.input, position)
    const state = estimateState(input)
    const zone = rebuildZone(input, state)
    const state0 = estimateState(a.input)
    const lifts = loadPosition(input, state).position !== 'steady' && state0.history !== null
    if (zone === null && !lifts) expect(buildPlan(input)).toEqual(steady)
  })
})

describe.each(['half', 'first-100-mile', 'masters'])(
  'the weekly re-plan chain of %s with every week run 1.5 times its plan',
  (id) => {
    const options = { scale: 1.5, maxSteps: 6 }
    const steadyChain = replanSteps(id, { ...options, loadAppetite: 'steady' })

    it('at steady is the chain with the option absent', () => {
      const absent = replanSteps(id, options)
      expect(steadyChain.map((s) => s.draft)).toEqual(absent.map((s) => s.draft))
    })

    it.each(LIFTED)('%s: every plan keeps the limits and passes the load items', (position) => {
      const chain = replanSteps(id, { ...options, loadAppetite: position })
      expect(chain).toHaveLength(steadyChain.length)
      for (const [k, { input, draft }] of chain.entries()) {
        expect(planProblems(draft, steadyChain[k]!.draft), `step ${String(k)}`).toEqual([])
        expect(ceilingProblems(input, draft), `step ${String(k)}`).toEqual([])
        expect(zoneReport(input, draft).problems, `step ${String(k)}`).toEqual([])
        // the response adds to the zone's plan and never takes from it
        if (k > 0) {
          const zoneOnly = withResponseWeeks(NO_RESPONSE, () => replan(input).draft)
          expect(cumulative(draft, 10), `step ${String(k)}`).toBeGreaterThanOrEqual(
            cumulative(zoneOnly, 10),
          )
        }
      }
    })
  },
)

describe('the control floor over the appendix runner and other races', () => {
  // the weeks to a long run of 2 and 3 times the 45-minute reference, with weekly time not limiting
  it.each([
    ['100 miles, 40 weeks', 40],
    ['100 miles, 30 weeks', 30],
  ])('%s: no position reaches a long run sooner than the control', (_name, weeksAhead) => {
    const goal = { ...scenario([]).goal, date: addDays(HISTORY_MONDAY, 7 * weeksAhead + 5) }
    const control = planAt(scenario(s4Runs(), { years: 3, goal }))
    for (const years of [1, 3] as const) {
      for (const position of POSITIONS) {
        const plan = planAt(scenario(s3Runs(), { years, goal }), position)
        for (const target of [90, 135]) {
          const floor = weeksToLong(control, HISTORY_MONDAY, target)!
          expect(
            weeksToLong(plan, HISTORY_MONDAY, target)!,
            `${String(years)}y ${position} ${String(target)}`,
          ).toBeGreaterThanOrEqual(floor)
        }
      }
    }
  })
})

// ---- task L6: the remaining cases of section 5.3 and the property checks over every case ----

describe('H5 and H6: an old block and one big week give no extra room [rules g-8]', () => {
  it('H5: a block older than either window gives no history and the steady drafts, at both windows', () => {
    for (const end of [12, 16]) {
      withTaperEnd(end, () => {
        expect(estimateState(h5()).history, String(end)).toBeNull()
        for (const position of LIFTED) {
          expect(zoneAt(h5(), position), `${String(end)} ${position}`).toBeNull()
          expect(planAt(h5(), position), `${String(end)} ${position}`).toEqual(
            planAt(h5(), 'steady'),
          )
        }
      })
    }
  })

  it('H6: the three steady weeks set the block, so R is a share of them and the big week adds no zone', () => {
    const base = h6([30, 35, 35])
    // four weeks that hold the big one are 600, 100, 100 and 100 minutes: the highest is dropped
    expect(estimateState(base).history).toMatchObject({ blockMin: 100, weeksAgo: 8 })
    expect(zoneAt(base, 'standard')!.ceilingMin).toBeCloseTo(70, 9)
    expect(zoneAt(base, 'upper')!.ceilingMin).toBeCloseTo(85, 9)
    // the lift starts the plan at 90, above both: the weeks that follow take the usual 10% step,
    // where a plain mean of the four weeks (225) would have put R at 157 and a zone under it
    for (const position of LIFTED) {
      const plan = planAt(base, position)
      expect(plan.weeks[0]!.targetRunMin).toBe(90)
      const seq = loading(plan).map((w) => w.targetRunMin)
      for (let i = 1; i < 10; i += 1)
        expect(seq[i], `${position} ${String(i)}`).toBe(nextOf(seq[i - 1]!, null))
      expect(zoneReport(at(base, position), plan).problems).toEqual([])
    }
  })
})

describe('H8: a held profile reads steady with its reason, and has no response either [rules g-8, g-3]', () => {
  const held = historyCases().filter((c) => c.name.startsWith('H8 '))
  const reasons = ['recent-injury', 'bone-stress', 'bsi-factors']

  it('has the three profiles of the case, each with its own reason', () => {
    expect(held.map((c) => c.name)).toEqual([
      'H8 recent injury',
      'H8 bone stress injury',
      'H8 two BSI factors',
    ])
  })

  it.each([0, 1, 2])(
    'profile %i: no zone, no lift, and the steady draft at standard and upper',
    (i) => {
      const { input: base } = held[i]!
      const steady = planAt(base, 'steady')
      for (const position of LIFTED) {
        const input = at(base, position)
        const state = estimateState(input)
        expect(loadPosition(input, state), position).toMatchObject({
          position: 'steady',
          held: reasons[i],
        })
        expect(rebuildZone(input, state), position).toBeNull()
        expect(blockLift(input, state), position).toBe(false)
        expect(buildPlan(input), position).toEqual(steady)
      }
    },
  )

  it('two BSI factors: weeks run far above the plan lift nothing', () => {
    const profile = { sex: 'female' as const, heightCm: 168, weightKg: 50 }
    const input = continued([800, 800, 800, 800], 'standard', 100, { profile })
    const state = estimateState(input)
    expect(state.risk.bsiFactors).toBe(2)
    expect(loadPosition(input, state).held).toBe('bsi-factors')
    expect(responseBasis(input, state)).toBeNull()
    expect(expectedResponse(input)).toBeNull()
  })
})

describe('H10 and H13: no response for a low-frequency runner or inside the window after a race', () => {
  /** The input a weekly re-plan would see: the steady plan stored, and a run this week. */
  const withStoredPlan = (base: EngineInput): EngineInput => ({
    ...at(base, 'standard'),
    existing: asExisting(buildPlan(at(base, 'steady')), base.today),
  })

  it.each([
    [
      'a low-frequency runner',
      scenario([...summer(), ...weeks(7, 1, [70]), ...week(0, [70])]),
      'low-frequency',
    ],
    ['the window after a race', h13Race(), 'post-race'],
  ] as const)(
    '%s: the position is held, so the mean of the weeks run is not read',
    (_name, base, reason) => {
      const input = withStoredPlan(base)
      const state = estimateState(input)
      // the stored plan holds the week, and the layoff is under a week: only the hold stops the response
      expect(input.existing!.weeks.some((w) => w.weekStart === mondayOf(input.today))).toBe(true)
      expect(state.layoffDays).toBeLessThan(P.j7.tier1Days.value)
      expect(loadPosition(input, state).held).toBe(reason)
      expect(responseBasis(input, state)).toBeNull()
      expect(expectedResponse(input)).toBeNull()
    },
  )
})

describe('H12: a ladder novice with no history', () => {
  it('has no history without a run, and a block under 3 x 30 with short runs', () => {
    expect(estimateState(h12()).history).toBeNull()
    expect(estimateState(h12Short()).history).toMatchObject({ blockMin: 30, weeksAgo: 5 })
  })

  it.each([
    ['no run at all', h12],
    ['four weeks of 15-minute outings', h12Short],
  ] as const)('%s: the ladder is unchanged at standard and upper', (_name, build) => {
    const base = build()
    const steady = planAt(base, 'steady')
    const ladder = steady.weeks.filter((w) => w.flags.some((f) => f.startsWith('ladder-')))
    expect(ladder.length).toBeGreaterThanOrEqual(5)
    for (const position of LIFTED) {
      const input = at(base, position)
      const state = estimateState(input)
      // the position applies, but nothing lifts the start and the zone leaves the ladder weeks out
      expect(loadPosition(input, state).held, position).toBeNull()
      expect(blockLift(input, state), position).toBe(false)
      expect(buildPlan(input), position).toEqual(steady)
      expect(zoneReport(input, buildPlan(input)).zoneWeeks, position).toBe(0)
    }
    expect(steady.checklist.filter((c) => !c.ok)).toEqual([])
  })
})

describe('H14 as one chain: weeks run above plan, a hold, a reduce, then progress', () => {
  const base = scenario([...summer(5), ...weeks(4, 1, [40])])
  const heavy: Step = { scale: 1.6 }
  // steps 1 to 4 run 1.6 times the plan, the week of step 5 is held, the week of step 7 is reduced
  // (each run 1.6 times its plan as well), and steps 8 to 10 run as planned
  const script: Step[] = [
    heavy,
    heavy,
    heavy,
    heavy,
    { ...heavy, decision: 'hold' },
    heavy,
    { ...heavy, decision: 'reduce' },
    {},
    {},
    {},
  ]
  const chains = new Map<Position, Array<{ input: EngineInput; plan: PlanDraft }>>()
  const chainAt = (position: Position) => {
    if (!chains.has(position)) chains.set(position, runChain(at(base, position), script))
    return chains.get(position)!
  }

  it('at steady an overshot week lifts nothing: each step is the 10% step from the planned baseline', () => {
    const chain = chainAt('steady')
    for (const [k, { input }] of chain.entries()) {
      expect(responseBasis(input, estimateState(input)), `step ${String(k)}`).toBeNull()
    }
    // the steps with no decision on a loading week: 2, 3, 4 (before the hold) and 8, 9, 10 (after)
    for (const k of [2, 3, 4, 8, 9, 10]) {
      const { input, plan } = chain[k]!
      const monday = mondayOf(input.today)
      const planned = lastLoadingAt(chain[k - 1]!.plan, monday).targetRunMin
      expect(nextLoading(plan, monday).targetRunMin, `step ${String(k)}`).toBe(
        nextOf(planned, null),
      )
    }
  })

  it.each(LIFTED)('%s: every plan of the chain keeps every limit', (position) => {
    for (const [k, { input, plan }] of chainAt(position).entries()) {
      expect(planProblems(plan), `step ${String(k)}`).toEqual([])
      expect(zoneReport(input, plan).problems, `step ${String(k)}`).toEqual([])
      expect(ceilingProblems(input, plan), `step ${String(k)}`).toEqual([])
    }
  })

  it.each(LIFTED)(
    '%s: the response lifts after the overshot weeks, inside the bounds of its mean',
    (position) => {
      const chain = chainAt(position)
      const zone = zoneAt(base, position)
      let lifted = 0
      for (let k = 2; k <= 6; k += 1) {
        const { input, plan } = chain[k]!
        const monday = mondayOf(input.today)
        const planned = lastLoadingAt(chain[k - 1]!.plan, monday).targetRunMin
        const mean = expectedResponse(input)!.meanMin!
        const next = nextLoading(plan, monday).targetRunMin
        expect(next, `step ${String(k)}`).toBeGreaterThanOrEqual(nextOf(planned, zone))
        expect(next, `step ${String(k)}`).toBeLessThanOrEqual(nextOf(Math.max(planned, mean), zone))
        if (next > nextOf(planned, zone)) lifted += 1
      }
      expect(lifted).toBeGreaterThan(0)
    },
  )

  it.each(LIFTED)(
    '%s: the hold and the reduce win over the response, and the zone resumes after them',
    (position) => {
      const chain = chainAt(position)
      const zone = zoneAt(base, position)
      // the hold: the week is 85% of its plan, below the mean of the weeks run that would lift it
      const hold = chain[5]!
      const holdMonday = mondayOf(hold.input.today)
      const stored = weekOf(chain[4]!.plan, holdMonday).targetRunMin
      expect(expectedResponse(hold.input)!.meanMin!).toBeGreaterThan(stored)
      expect(weekOf(hold.plan, holdMonday).targetRunMin).toBeLessThanOrEqual(
        floorEps(stored * 0.85),
      )
      // the reduce: a recovery week, 75% of the loading week before it at most
      const reduce = chain[7]!
      const reduceMonday = mondayOf(reduce.input.today)
      const before = lastLoadingAt(
        {
          ...chain[6]!.plan,
          weeks: chain[6]!.plan.weeks.filter((w) => w.weekStart < reduceMonday),
        },
        reduceMonday,
      )
      expect(weekOf(reduce.plan, reduceMonday).isRecovery).toBe(true)
      expect(weekOf(reduce.plan, reduceMonday).targetRunMin).toBeLessThanOrEqual(
        floorEps(before.targetRunMin * 0.75),
      )
      // progress: from step 8 the runner runs as planned, the mean falls under the planned baseline,
      // and consecutive loading weeks of a plan step by the rule again
      for (const k of [8, 9, 10]) {
        const { input, plan } = chain[k]!
        const planned = lastLoadingAt(chain[k - 1]!.plan, mondayOf(input.today)).targetRunMin
        expect(expectedResponse(input)!.meanMin!, `step ${String(k)}`).toBeLessThanOrEqual(planned)
        const ahead = {
          ...plan,
          weeks: plan.weeks.filter((w) => w.weekStart >= mondayOf(input.today)),
        }
        const seq = loading(ahead).map((w) => w.targetRunMin)
        for (let i = 1; i < 4; i += 1) {
          expect(seq[i], `step ${String(k)} week ${String(i)}`).toBe(nextOf(seq[i - 1]!, zone))
        }
      }
    },
  )
})

describe('H15 at other short horizons', () => {
  it.each([6, 8, 10, 12, 14, 16])(
    'a race %i weeks away: every limit holds, the peak is the class peak at most, and the taper is the same',
    (weeksAhead) => {
      const base = h15(weeksAhead)
      const steady = planAt(base, 'steady')
      const peakOf = (p: PlanDraft) =>
        Math.max(
          ...p.weeks.filter((w) => !w.isTaper && w.phase !== 'race').map((w) => w.targetRunMin),
        )
      for (const position of LIFTED) {
        const input = at(base, position)
        const plan = buildPlan(input)
        expect(planProblems(plan, steady), position).toEqual([])
        expect(zoneReport(input, plan).problems, position).toEqual([])
        expect(ceilingProblems(input, plan), position).toEqual([])
        // R (315 or 383) is far above the 180-minute peak of the plan: the zone runs to the peak
        expect(peakOf(plan), position).toBeLessThanOrEqual(180)
        expect(peakOf(plan), position).toBeGreaterThanOrEqual(peakOf(steady))
        expect(
          plan.weeks.filter((w) => w.isTaper),
          position,
        ).toHaveLength(steady.weeks.filter((w) => w.isTaper).length)
        expect(cumulative(plan, plan.weeks.length), position).toBeGreaterThanOrEqual(
          cumulative(steady, steady.weeks.length),
        )
      }
      // from twelve weeks on the zone reaches the peak, which steady does not before sixteen
      if (weeksAhead >= 12) {
        for (const position of LIFTED) expect(peakOf(planAt(base, position))).toBe(180)
      }
    },
  )
})

describe('H26 as the owner described it: a peak that ended 14 weeks ago, at both windows', () => {
  // the weeks since are one run a week of 60 minutes: not a block (fewer than two runs a week)
  it('12 weeks: the weeks since are no block, so there is no history and the steady drafts', () => {
    withTaperEnd(12, () => {
      expect(estimateState(h26(60, 1)).history).toBeNull()
      for (const position of LIFTED) {
        expect(zoneAt(h26(60, 1), position), position).toBeNull()
        expect(planAt(h26(60, 1), position), position).toEqual(planAt(h26(60, 1), 'steady'))
      }
    })
  })

  it('16 weeks: the peak counts at 0.75, scales R, lifts nothing, and the zone goes ahead of steady', () => {
    withTaperEnd(16, () => {
      expect(estimateState(h26(60, 1)).history).toMatchObject({
        blockMin: 280,
        weeksAgo: 14,
        taper: 0.75,
        fullCreditMin: 0,
      })
      const steady = planAt(h26(60, 1), 'steady')
      for (const [position, credit] of [
        ['standard', 0.7],
        ['upper', 0.85],
      ] as const) {
        const zone = zoneAt(h26(60, 1), position)!
        expect(zone.ceilingMin, position).toBeCloseTo(credit * 0.75 * 280, 9)
        const plan = planAt(h26(60, 1), position)
        // no lift by a block that ended more than 12 weeks ago: the start is still 3 x 20
        expect(plan.weeks[0]!.targetRunMin, position).toBe(steady.weeks[0]!.targetRunMin)
        // the rule's step for the first seven weeks; later the session guard (G-1) may bind first
        const seq = loading(plan).map((w) => w.targetRunMin)
        for (let i = 1; i < 10; i += 1) {
          const rule = nextOf(seq[i - 1]!, zone)
          if (i < 8) expect(seq[i], `${position} ${String(i)}`).toBe(rule)
          else expect(seq[i], `${position} ${String(i)}`).toBeLessThanOrEqual(rule)
        }
        expect(cumulative(plan, 10), position).toBeGreaterThan(cumulative(steady, 10))
        expect(planProblems(plan, steady), position).toEqual([])
        expect(zoneReport(at(h26(60, 1), position), plan).problems, position).toEqual([])
      }
    })
  })
})

// ---- the property checks of section 5.3 over every case and position ----

describe('the property checks of section 5.3 over every case and position', () => {
  const cases = historyCases()
  const golden = JSON.parse(
    readFileSync(join(import.meta.dirname, 'history-oracle.json'), 'utf8'),
  ) as Record<string, string>
  const plans = new Map<string, PlanDraft>()
  const planOf = (c: HistoryCase, position: Position): PlanDraft => {
    const key = `${c.name}|${position}`
    if (!plans.has(key)) plans.set(key, buildPlan(at(c.input, position)))
    return plans.get(key)!
  }
  /** The problems of `check` over every case at every position, each named by its case and position. */
  const everyCase = (check: (c: HistoryCase, position: Position) => string[]): string[] =>
    cases.flatMap((c) => POSITIONS.flatMap((p) => check(c, p).map((m) => `${c.name} ${p}: ${m}`)))

  it('lists each case once', () => {
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length)
    expect(cases.length).toBeGreaterThanOrEqual(26)
  })

  it('steady equals the oracle where the oracle holds the case, and the option absent everywhere else', () => {
    for (const c of cases) {
      if (c.oracle === undefined) {
        expect(planOf(c, 'steady'), c.name).toEqual(buildPlan(c.input))
      } else {
        expect(golden[c.oracle], c.name).toBeDefined()
        expect(planDigest(planOf(c, 'steady')), c.name).toBe(golden[c.oracle])
      }
    }
  })

  it('no week passes the 30% ceiling over two weeks', () => {
    expect(everyCase((c, p) => ceilingProblems(at(c.input, p), planOf(c, p)))).toEqual([])
  })

  it('no run is flagged spike-warn or needs an override, and the load items of the checklist pass', () => {
    expect(everyCase((c, p) => planProblems(planOf(c, p), planOf(c, 'steady')))).toEqual([])
  })

  it('the zone step is never above the weekly rate of the ceiling, and no week passes its limit', () => {
    let zoneWeeks = 0
    const bad = everyCase((c, p) => {
      const input = at(c.input, p)
      const report = zoneReport(input, planOf(c, p))
      zoneWeeks += report.zoneWeeks
      const zone = expectedZone(input)
      const over = zone !== null && zone.step > ceilingWeeklyRate() + 1e-12
      return [
        ...report.problems,
        ...(over ? [`zone step ${String(zone.step)} is above the ceiling`] : []),
      ]
    })
    expect(bad).toEqual([])
    // a registry that never enters the zone would pass for nothing
    expect(zoneWeeks).toBeGreaterThan(5)
  })

  it('standard and upper plan at least the minutes of steady up to the week R is reached', () => {
    const bad = everyCase((c, p) => {
      if (p === 'steady') return []
      const plan = planOf(c, p)
      const steady = planOf(c, 'steady')
      const zone = expectedZone(at(c.input, p))
      const reached =
        zone === null ? -1 : plan.weeks.findIndex((w) => w.targetRunMin >= zone.ceilingMin)
      const count =
        reached < 0
          ? plan.weeks.filter((w) => !w.isTaper && w.phase !== 'race').length
          : reached + 1
      return cumulative(plan, count) + 1 < cumulative(steady, count)
        ? [
            `${String(cumulative(plan, count))} min against steady's ${String(cumulative(steady, count))} over ${String(count)} weeks`,
          ]
        : []
    })
    expect(bad).toEqual([])
  })

  it('the first long run never comes sooner than with weekly time not limiting (the G-1 floor)', () => {
    const controls = new Map<string, PlanDraft>()
    let compared = 0
    const bad = everyCase((c, p) => {
      const longest = Math.round(estimateState(c.input).longest30d.durationSec / 60)
      // with no run in the last 30 days G-1 has no reference, and the J7 fraction stands in
      if (longest <= 0) return []
      const key = `${String(longest)}|${c.input.goal.date}|${c.input.goal.distanceClass}`
      if (!controls.has(key)) {
        const runs = weeks(
          8,
          1,
          Array.from({ length: 5 }, () => longest),
        )
        controls.set(key, buildPlan(scenario(runs, { years: 3, goal: c.input.goal })))
      }
      const out: string[] = []
      for (const multiple of [2, 3]) {
        const target = longest * multiple
        const floor = weeksToLong(controls.get(key)!, HISTORY_MONDAY, target)
        if (floor === null) continue
        compared += 1
        const got = weeksToLong(planOf(c, p), HISTORY_MONDAY, target)
        if (got !== null && got < floor)
          out.push(`${String(target)} min in week ${String(got)}, the control in ${String(floor)}`)
      }
      return out
    })
    expect(bad).toEqual([])
    expect(compared).toBeGreaterThan(cases.length)
  })
})

describe('the taper factor of an older block [rules g-8]', () => {
  /** A block of 280 minutes a week in four runs that ended `ended` weeks ago, and nothing since. */
  const blockEnded = (ended: number) => scenario(weeks(ended + 3, ended, [70, 70, 70, 70]))

  it.each([
    [12, 0.5],
    [14, 0.5],
    [16, 0.5],
    [16, 0.25],
    [20, 0.5],
  ])(
    'window %i, floor %f: 1 up to 12 weeks, a straight line to the floor, nothing after',
    (end, floor) => {
      withTaperEnd(end, () =>
        withTaperFloor(floor, () => {
          const window = P.g8.creditWindowWeeks.value
          const tapers: number[] = []
          for (let ended = 1; ended <= end + 2; ended += 1) {
            const history = estimateState(blockEnded(ended)).history
            if (ended > end) {
              expect(history, `ended ${String(ended)}`).toBeNull()
              continue
            }
            const expected =
              ended <= window ? 1 : 1 - ((1 - floor) * (ended - window)) / (end - window)
            expect(history!.taper, `ended ${String(ended)}`).toBeCloseTo(expected, 12)
            expect(history!.blockMin, `ended ${String(ended)}`).toBe(280)
            expect(history!.weeksAgo).toBe(ended)
            if (ended >= window) tapers.push(history!.taper)
          }
          // it reaches the floor at the end of the window, in equal steps
          if (end > window) {
            expect(tapers.at(-1)).toBeCloseTo(floor, 12)
            const steps = tapers.slice(1).map((t, i) => tapers[i]! - t)
            for (const step of steps) expect(step).toBeCloseTo((1 - floor) / (end - window), 12)
          }
        }),
      )
    },
  )
})

describe('a runner who runs as planned [rules g-8, g-2]', () => {
  const weeksFrom = (plan: PlanDraft, monday: string) =>
    plan.weeks
      .filter((w) => w.weekStart >= monday)
      .map((w) => [w.weekStart, w.targetRunMin, w.isRecovery])
  const chainAt = (position: Position, maxSteps: number) =>
    replanChain(at(h1(), position), { maxSteps })

  it.each(LIFTED)(
    '%s: the response adds nothing, so every re-plan is the plan of the zone alone',
    (position) => {
      for (const [k, { input, draft }] of chainAt(position, 6).entries()) {
        if (k === 0) continue
        expect(draft, `step ${String(k)}`).toEqual(
          withResponseWeeks(NO_RESPONSE, () => replan(input).draft),
        )
      }
    },
  )

  it.each(LIFTED)(
    '%s: while the block is credited in full, every re-plan repeats the weeks of the first plan',
    (position) => {
      const chain = chainAt(position, 5)
      const block = estimateState(chain[0]!.input).history!
      let checked = 0
      for (const [k, { input, draft }] of chain.entries()) {
        const monday = mondayOf(input.today)
        if (k === 0 || daysBetween(block.endWeek, monday) / 7 > P.g8.creditWindowWeeks.value)
          continue
        expect(weeksFrom(draft, monday), `step ${String(k)}`).toEqual(
          weeksFrom(chain[0]!.draft, monday),
        )
        checked += 1
      }
      expect(checked).toBeGreaterThanOrEqual(4)
    },
  )

  // The plan keeps the block it opened with (g-8): the block leaves the credit window about six
  // weeks into the rebuild, and every re-plan still plans the weeks of the first plan, at both
  // windows and both positions, until the end of the chain (32 weeks of the plan).
  it.each(LIFTED.flatMap((position) => [12, 16].map((end) => [position, end] as const)))(
    '%s, window %i: beyond the credit window too, every re-plan repeats the weeks of the first plan',
    (position, end) => {
      withTaperEnd(end, () => {
        const chain = chainAt(position, 14)
        for (const [k, { input, draft }] of chain.entries()) {
          const monday = mondayOf(input.today)
          if (k === 0) continue
          expect(weeksFrom(draft, monday), `step ${String(k)}`).toEqual(
            weeksFrom(chain[0]!.draft, monday),
          )
        }
      })
    },
  )
})

describe('H27: a continued plan keeps the block it opened with, until a week has reached R [rules g-8]', () => {
  const chains = new Map<string, ReturnType<typeof replanChain>>()
  const chainFor = (position: Position, end: number, maxSteps = 16) => {
    const key = `${position} ${String(end)} ${String(maxSteps)}`
    if (!chains.has(key)) {
      chains.set(
        key,
        withTaperEnd(end, () => replanChain(at(h1(), position), { maxSteps })),
      )
    }
    return chains.get(key)!
  }
  const creditOf = (position: Position) =>
    position === 'upper' ? P.g8.creditUpper.value : P.g8.creditStandard.value
  const firstMondayOf = (input: EngineInput) =>
    input.existing === null
      ? mondayOf(input.today)
      : input.existing.weeks.map((w) => w.weekStart).reduce((a, b) => (a < b ? a : b))

  it.each(LIFTED.flatMap((position) => [12, 16].map((end) => [position, end] as const)))(
    '%s, window %i: the zone reads the block of the first Monday up to the week that reaches R, and the state after it',
    (position, end) => {
      withTaperEnd(end, () => {
        const chain = chainFor(position, end)
        const opened = estimateState(chain[0]!.input).history!
        const ceiling = creditOf(position) * opened.taper * opened.blockMin
        let kept = 0
        let own = 0
        let reachedAt: number | null = null
        for (const [k, { input }] of chain.entries()) {
          const state = estimateState(input)
          const credited = zoneBlock(input, state)!
          const monday = mondayOf(input.today)
          // the week since the first Monday that reached R, by the weeks as run (summed from the
          // raw activities, not from the code under test)
          const ran = new Map<string, number>()
          for (const a of input.activities) {
            if (a.type === 'run')
              ran.set(mondayOf(a.date), (ran.get(mondayOf(a.date)) ?? 0) + a.durationSec / 60)
          }
          const first = firstMondayOf(chain[0]!.input)
          let reached = false
          for (let w = first; w < monday; w = addDays(w, 7)) {
            if ((ran.get(w) ?? 0) >= ceiling) reached = true
          }
          if (!reached) {
            // the block as the first plan read it, with its taper, whatever the state says today
            expect(credited.keptSince, `step ${String(k)}`).toBe(k === 0 ? null : first)
            expect(credited.block, `step ${String(k)}`).toEqual(opened)
            kept += 1
          } else {
            expect(credited.keptSince, `step ${String(k)}`).toBeNull()
            expect(credited.block, `step ${String(k)}`).toEqual(state.history)
            own += 1
            reachedAt ??= k
          }
          // and the zone is the one of the block read
          const zone = rebuildZone(input, state)!
          expect(zone.ceilingMin, `step ${String(k)}`).toBeCloseTo(
            creditOf(position) * credited.block.taper * credited.block.blockMin,
            9,
          )
          expect(zone, `step ${String(k)}`).toEqual(expectedZone(input))
          expect(credited.block, `step ${String(k)}`).toEqual(
            expectedBlock(input, creditOf(position)),
          )
        }
        // a chain that never left the first block, or never reached R, would test nothing
        expect(kept).toBeGreaterThan(P.g8.creditWindowWeeks.value / 2)
        expect(own).toBeGreaterThan(0)
        expect(reachedAt).not.toBeNull()
      })
    },
  )

  it('the block leaves the 12-week window with the plan under way, and the state alone would have lost it', () => {
    const chain = chainFor('standard', 12)
    const opened = estimateState(chain[0]!.input).history!
    const lost = chain.findIndex(({ input }) => {
      const monday = mondayOf(input.today)
      return daysBetween(opened.endWeek, monday) / 7 > P.g8.creditWindowWeeks.value
    })
    expect(lost).toBeGreaterThan(0)
    // from that re-plan on the state's own block is another one, or none ...
    const { input } = chain[lost + 1]!
    const state = estimateState(input)
    expect(state.history === null || state.history.blockMin < opened.blockMin).toBe(true)
    // ... and the zone still reads the first plan's
    expect(rebuildZone(input, state)!.ceilingMin).toBeCloseTo(
      P.g8.creditStandard.value * opened.blockMin,
      9,
    )
  })

  it('a block of 13 to 16 weeks keeps the taper found on the first Monday', () => {
    withTaperEnd(16, () => {
      const base = h26(60, 2)
      const first = at(base, 'standard')
      const found = estimateState(first).history
      expect(found).not.toBeNull()
      expect(found!.taper).toBeLessThan(1)
      const chain = replanChain(first, { maxSteps: 6 })
      for (const [k, { input }] of chain.entries()) {
        const credited = zoneBlock(input, estimateState(input))
        if (credited === null || credited.keptSince === null) continue
        expect(credited.block.taper, `step ${String(k)}`).toBe(found!.taper)
        expect(credited.block.weeksAgo, `step ${String(k)}`).toBe(found!.weeksAgo)
      }
    })
  })

  describe('reads the state at today, as before', () => {
    const late = () => chainFor('standard', 12)[8]!.input
    const ceilingOf = (input: EngineInput) => rebuildZone(input, estimateState(input))?.ceilingMin

    it('a new plan', () => {
      const input = { ...late(), existing: null }
      const state = estimateState(input)
      expect(zoneBlock(input, state)?.keptSince ?? null).toBeNull()
      expect(zoneBlock(input, state)?.block ?? null).toEqual(state.history)
      expect(ceilingOf(input)).not.toBe(ceilingOf(late()))
    })

    it('a plan that restarts after a break', () => {
      const input = late()
      const cut = addDays(input.today, -P.j7.tier1Days.value)
      const idle: EngineInput = {
        ...input,
        activities: input.activities.filter((a) => a.date < cut),
      }
      const state = estimateState(idle)
      expect(state.layoffDays).toBeGreaterThanOrEqual(P.j7.tier1Days.value)
      expect(zoneBlock(idle, state)?.keptSince ?? null).toBeNull()
      expect(zoneBlock(idle, state)?.block ?? null).toEqual(state.history)
    })

    it('a plan that opens in the current week', () => {
      const input = chainFor('standard', 12)[0]!.input
      const mine = zoneBlock(input, estimateState(input))!
      expect(mine.keptSince).toBeNull()
      // a stored plan whose first week is the current one
      const stored: EngineInput = {
        ...input,
        existing: {
          weeks: buildPlan(input).weeks,
          sessions: [],
        },
      }
      expect(zoneBlock(stored, estimateState(stored))!.keptSince).toBeNull()
    })

    it('a plan older than the activities reach, which has no block in reach', () => {
      const input = late()
      const weeksOf = input.existing!.weeks
      const ancient = { ...weeksOf[0]!, weekStart: addDays(weeksOf[0]!.weekStart, -7 * 60) }
      const old: EngineInput = {
        ...input,
        existing: { ...input.existing!, weeks: [ancient, ...weeksOf] },
      }
      const state = estimateState(old)
      expect(zoneBlock(old, state)?.keptSince ?? null).toBeNull()
      expect(zoneBlock(old, state)?.block ?? null).toEqual(state.history)
    })

    it('a plan that found no block on its first Monday', () => {
      const base = at(scenario(SPARSE), 'standard')
      expect(estimateState(base).history).toBeNull()
      let blocks = 0
      for (const [k, { input }] of replanChain(base, { maxSteps: 10 }).entries()) {
        const state = estimateState(input)
        const credited = zoneBlock(input, state)
        expect(credited?.keptSince ?? null, `step ${String(k)}`).toBeNull()
        expect(credited?.block ?? null, `step ${String(k)}`).toEqual(state.history)
        if (state.history !== null) blocks += 1
      }
      // the runs of the plan itself form a block in the end, and then it applies
      expect(blocks).toBeGreaterThan(0)
    })
  })

  describe('a week at R ends it', () => {
    const credit = P.g8.creditStandard.value
    /** The chain input of re-plan 8 and `minutes` more running in the first week of the plan. */
    const withExtra = (extraMin: number): EngineInput => {
      const input = chainFor('standard', 12)[8]!.input
      const first = firstMondayOf(input)
      const extra = activity(addDays(first, 3), {
        id: 'extra-run',
        durationSec: Math.round(extraMin * 60),
        movingSec: Math.round(extraMin * 60),
        distanceM: Math.round(extraMin * 170),
      })
      return { ...input, activities: [...input.activities, extra] }
    }

    it('one minute under R keeps the first block, and a week at R passes to the state', () => {
      const input = chainFor('standard', 12)[8]!.input
      const first = firstMondayOf(input)
      const opened = estimateState(chainFor('standard', 12)[0]!.input).history!
      const ceiling = credit * opened.taper * opened.blockMin
      const ran = estimateState(input).weeks.find((w) => w.weekStart === first)!.runMin
      // no week since the first Monday has reached R yet
      expect(ran).toBeLessThan(ceiling)
      const need = Math.ceil(ceiling - ran)
      const under = withExtra(need - 1)
      const over = withExtra(need)
      expect(zoneBlock(under, estimateState(under))!.keptSince).toBe(first)
      expect(zoneBlock(over, estimateState(over))!.keptSince).toBeNull()
      expect(zoneBlock(over, estimateState(over))!.block).toEqual(estimateState(over).history)
      expect(expectedBlock(under, credit)).toEqual(opened)
    })
  })
})

describe('H28: the response needs the newest eligible week run at or above its stored target [rules g-8, g-2, g-6]', () => {
  const NEXT = addDays(HISTORY_MONDAY, 7)
  const BACK1 = addDays(HISTORY_MONDAY, -7)
  /** The input with the stored plan's week of `monday` set to `minutes` (and `flags` added). */
  const storedAt = (
    input: EngineInput,
    monday: string,
    minutes: number,
    flags: readonly string[] = [],
  ): EngineInput => ({
    ...input,
    existing: {
      ...input.existing!,
      weeks: input.existing!.weeks.map((w) =>
        w.weekStart === monday ? { ...w, targetRunMin: minutes, flags: [...w.flags, ...flags] } : w,
      ),
    },
  })
  const zoneOnly = (input: EngineInput) => withResponseWeeks(NO_RESPONSE, () => replan(input).draft)

  it.each(LIFTED)(
    '%s: a week run at its target lifts, a week one minute under it lifts nothing',
    (position) => {
      const input = continued([100, 100, 100, 150], position, 100)
      expect(responseBasis(input, estimateState(input))!.meanMin).toBe(112.5)
      const at150 = storedAt(input, BACK1, 150)
      expect(responseBasis(at150, estimateState(at150))!.meanMin).toBe(112.5)
      const at151 = storedAt(input, BACK1, 151)
      expect(responseBasis(at151, estimateState(at151))).toEqual({ meanMin: null })
      expect(expectedResponse(at151)!.meanMin).toBeNull()
      expect(expectedResponse(at151)!.weeksMean).toBe(112.5)
      // the plan is the one without a response, week for week
      expect(replan(at151).draft).toEqual(zoneOnly(at151))
      // while the lifting week is higher than that plan
      expect(weekOf(replan(at150).draft, NEXT).targetRunMin).toBeGreaterThan(
        weekOf(replan(at151).draft, NEXT).targetRunMin,
      )
    },
  )

  it('a week taken as run past its plan counts at the minutes it was planned at, not at the minutes run', () => {
    // weeks hold whole minutes: 150.4 is 150, under the 151 the stored week was rounded up to
    const input = continued([100, 100, 100, 150.4], 'standard', 100)
    // the stored week holds the minutes run rounded up and the minutes it was planned at
    const taken = storedAt(
      { ...input, existing: { ...input.existing!, weeks: input.existing!.weeks } },
      BACK1,
      151,
      ['overshoot', 'planned-100'],
    )
    const stored = taken.existing!.weeks.find((w) => w.weekStart === BACK1)!
    expect(stored.targetRunMin).toBe(151)
    expect(plannedMinOf(stored)).toBe(stored.flags.includes('overshoot') ? 100 : 151)
    // 150.4 minutes run are under 151 and above 100: the week was run above its plan
    const state = estimateState(taken)
    expect(state.weeks.find((w) => w.weekStart === BACK1)!.runMin).toBe(150)
    expect(responseBasis(taken, state)!.meanMin).toBe(112.5)
    expect(expectedResponse(taken)!.meanMin).toBe(112.5)
    // read at the stored minutes alone (151), the week would count as run under its target
    expect(150).toBeLessThan(stored.targetRunMin)
  })

  it('a newest week that the stored plan did not hold gives no response either', () => {
    const input = continued([100, 100, 100, 150], 'standard', 100)
    const plain: EngineInput = {
      ...input,
      existing: {
        ...input.existing!,
        weeks: input.existing!.weeks.filter((w) => w.weekStart !== BACK1),
      },
    }
    expect(plain.existing!.weeks.some((w) => w.weekStart === HISTORY_MONDAY)).toBe(true)
    expect(responseBasis(plain, estimateState(plain))).toEqual({ meanMin: null })
    expect(expectedResponse(plain)!.meanMin).toBeNull()
    expect(replan(plain).draft).toEqual(zoneOnly(plain))
  })

  it('the newest eligible week is the one before a race week, whose target the plan may not hold', () => {
    const input = continued([100, 100, 100, 150], 'standard', 100)
    const race = activity(addDays(BACK1, 5), {
      id: 'race-b1',
      type: 'race',
      durationSec: 50 * 60,
      movingSec: 50 * 60,
      distanceM: 10_000,
    })
    const raced: EngineInput = { ...input, activities: [...input.activities, race] }
    const state = estimateState(raced)
    // the race week is skipped, so the newest eligible week is the one before it, which the plan
    // that began a week ago did not hold
    expect(eligibleWeekList(raced)[0]!.weekStart).toBe(addDays(BACK1, -7))
    expect(responseBasis(raced, state)).toEqual({ meanMin: null })
  })

  it('agrees with the rule over random weeks and stored targets', () => {
    const rnd = mulberry32(20_261_026)
    let applied = 0
    let gated = 0
    for (let n = 0; n < 40; n += 1) {
      const lastWeeks = Array.from({ length: 4 }, () => 40 + Math.floor(rnd() * 200))
      const input = continued(lastWeeks, 'standard', 100)
      const stored = Math.floor(rnd() * 260)
      const probe = storedAt(input, BACK1, stored)
      const basis = responseBasis(probe, estimateState(probe))!
      const expected = expectedResponse(probe)!
      expect(basis.meanMin === null, `case ${String(n)}`).toBe(expected.meanMin === null)
      if (basis.meanMin !== null) {
        expect(basis.meanMin, `case ${String(n)}`).toBeCloseTo(expected.meanMin!, 9)
        applied += 1
        // the newest week was run at or above its target
        expect(lastWeeks[3]!, `case ${String(n)}`).toBeGreaterThanOrEqual(stored)
      } else {
        gated += 1
        expect(lastWeeks[3]!, `case ${String(n)}`).toBeLessThan(stored)
      }
    }
    expect(applied).toBeGreaterThan(5)
    expect(gated).toBeGreaterThan(5)
  })

  describe('a hold after weeks run well above the plan, the held week run under its target', () => {
    const base = scenario([...summer(5), ...weeks(4, 1, [40])])
    const heavy: Step[] = [
      { scale: 1.6 },
      { scale: 1.6 },
      { scale: 1.6 },
      { scale: 1.6 },
      { scale: 1.6, decision: 'hold' },
    ]
    const nextAfter = (chain: ReturnType<typeof runChain>, k: number) => {
      const { input, plan } = chain[k]!
      return nextLoading(plan, mondayOf(input.today)).targetRunMin
    }

    it.each(LIFTED)(
      '%s: the week after it is the plan without a response; run at 1.6 times its plan it is lifted',
      (position) => {
        const under = runChain(at(base, position), [...heavy, { scale: 0.8 }])
        const over = runChain(at(base, position), [...heavy, { scale: 1.6 }])
        const k = heavy.length + 1
        // the held week is run under its stored (held) target in one chain, far above it in the other
        const held = mondayOf(under[k]!.input.today)
        const heldWeek = addDays(held, -7)
        const stored = weekOf(under[k - 1]!.plan, heldWeek).targetRunMin
        const ranUnder = estimateState(under[k]!.input).weeks.find((w) => w.weekStart === heldWeek)!
        const ranOver = estimateState(over[k]!.input).weeks.find((w) => w.weekStart === heldWeek)!
        expect(ranUnder.runMin).toBeLessThan(stored)
        expect(ranOver.runMin).toBeGreaterThan(stored)
        // the mean of the four weeks is above the planned baseline in both, as finding 2 had it
        expect(expectedResponse(under[k]!.input)!.weeksMean!).toBeGreaterThan(
          lastLoadingAt(under[k - 1]!.plan, held).targetRunMin,
        )
        expect(expectedResponse(under[k]!.input)!.meanMin).toBeNull()
        expect(under[k]!.plan).toEqual(zoneOnly(under[k]!.input))
        expect(nextAfter(over, k)).toBeGreaterThan(nextAfter(under, k))
        expect(planProblems(under[k]!.plan)).toEqual([])
      },
    )
  })
})

describe('H29: the lift of the response stops at the two-week ceiling over the planned baseline [rules g-8, g-2]', () => {
  const NEXT = addDays(HISTORY_MONDAY, 7)
  const bound = (planned: number) => planned * (1 + P.g2.rampCeilingTwoWeeks.value)

  it.each(LIFTED)(
    '%s: one week of 500 minutes lifts the baseline to 1.3 times the plan, not 2.6 times',
    (position) => {
      // four weeks of 50, 70, 120 and 500 minutes: a mean of 185 against a planned baseline of 70
      const input = continued([50, 70, 120, 500], position, 70)
      const state = estimateState(input)
      expect(responseBasis(input, state)!.meanMin).toBeCloseTo(185, 9)
      const plan = replan(input).draft
      // the baseline is the planned 70 stepped by the ceiling of two weeks: 91, not 185
      const basis = responseBasis(input, state)
      expect(responseBaseline(70, basis, false)).toBeCloseTo(bound(70), 9)
      expect(responseBaseline(70, basis, false) / 70).toBeLessThanOrEqual(
        1 + P.g2.rampCeilingTwoWeeks.value + 1e-9,
      )
      const zone = zoneAt(input, position)
      expect(weekOf(plan, NEXT).targetRunMin).toBe(nextOf(bound(70), zone))
      // against the 203 minutes (2.9 times the plan) that the mean gave without the bound
      expect(weekOf(plan, NEXT).targetRunMin).toBeLessThan(120)
      expect(planProblems(plan)).toEqual([])
      expect(ceilingProblems(input, plan)).toEqual([])
    },
  )

  it('leaves the example of the proposal alone: 112.5 is inside the bound of 130', () => {
    const input = continued([100, 100, 100, 150], 'standard', 100)
    const basis = responseBasis(input, estimateState(input))
    expect(responseBaseline(100, basis, false)).toBe(112.5)
    expect(112.5).toBeLessThan(bound(100))
    expect(weekOf(replan(input).draft, NEXT).targetRunMin).toBe(126)
  })
})

describe('H3 inside a chain: the low-frequency hold arms when the start level passes 60 minutes [rules A5, g-8]', () => {
  it('holds the setting at steady for the one re-plan in which a week run 1.6 times the plan lifts the start level over 60', () => {
    const chain = replanChain(at(h1(), 'standard'), { scale: 1.6, maxSteps: 4 })
    const held = chain.map(({ input }) => loadPosition(input, estimateState(input)).held)
    // the runs a week of the window are still under two when the start level reaches 60 (A5)
    expect(held).toEqual([null, null, 'low-frequency', null, null])
    // that re-plan is the steady plan's, as H3 says: the zone and the response are off while the
    // flag holds, so the weeks ahead fall back, and the next re-plan returns to the zone
    const { input, draft } = chain[2]!
    expect(draft).toEqual(replan(at(input, 'steady')).draft)
    const monday = mondayOf(input.today)
    expect(
      nextLoading(chain[1]!.draft, mondayOf(chain[1]!.input.today)).targetRunMin,
    ).toBeGreaterThan(nextLoading(draft, monday).targetRunMin)
  })
})

describe('weeks run 1.6 times the plan, along the chains of three cases [rules g-8]', () => {
  it.each(LIFTED)(
    '%s: the first loading week after a re-plan is inside the bounds of the response',
    (position) => {
      // runners who are not low-frequency when their start level passes 60 (h1 is: the hold would
      // switch the zone and the response off for a week, which the next test of this file states)
      const bases = [scenario([...summer(5), ...weeks(4, 1, [40])]), h3Back(), h4()]
      let engaged = 0
      for (const base of bases) {
        const chain = replanChain(at(base, position), { scale: 1.6, maxSteps: 4 })
        for (const [k, { input, draft }] of chain.entries()) {
          if (k === 0) continue
          const monday = mondayOf(input.today)
          const zone = rebuildZone(input, estimateState(input))
          const planned = lastLoadingAt(chain[k - 1]!.draft, monday).targetRunMin
          const next = nextLoading(draft, monday).targetRunMin
          // never below the step from the planned baseline (the response lifts a baseline and never
          // lowers one), never above the step from the largest week of its window, which the mean
          // of those weeks cannot pass
          const largest = expectedResponse(input)?.maxWeekMin ?? 0
          expect(next, `${position} step ${String(k)}`).toBeGreaterThanOrEqual(
            nextOf(planned, zone),
          )
          expect(next, `${position} step ${String(k)}`).toBeLessThanOrEqual(
            nextOf(Math.max(planned, largest), zone),
          )
          // and never above the step from the planned baseline stepped by the two-week ceiling
          expect(next, `${position} step ${String(k)}`).toBeLessThanOrEqual(
            nextOf(expectedBaseline(planned, expectedResponse(input)?.meanMin ?? null), zone),
          )
          if (next > nextOf(planned, zone)) engaged += 1
        }
      }
      expect(engaged).toBeGreaterThan(0)
    },
  )
})

describe('a week target raised by hand along the chain at standard and upper [rules g-2, g-8, ADR 0007]', () => {
  /** The stored rows of a draft's weeks from the current Monday, with the targets in `raised`. */
  function rowsOf(draft: PlanDraft, today: string, raised: Record<string, number>) {
    return draft.weeks
      .filter((w) => w.weekStart >= mondayOf(today))
      .map((week, i): PlanWeekRow => {
        const row = {
          ...weekRow(week),
          id: `w${String(i)}`,
          planId: 'plan',
          updatedAt: new Date(0),
        } as PlanWeekRow
        return {
          ...row,
          targetRunMin: raised[week.weekStart] ?? row.baselineRunMin,
          targetSource: 'override',
          overrideNote: 'Synthetic note.',
        }
      })
  }

  it.each(LIFTED)(
    '%s: a target far above the limit is clipped to it, and the limit is not past the ceiling of the weeks before',
    (position) => {
      const steps = replanChain(at(h1(), position), { maxSteps: 8 }).filter((_, i) => i % 4 === 0)
      let checked = 0
      for (const step of steps) {
        const state = estimateState(step.input)
        const totals = weeklyTotals(step.input, step.draft)
        const future = step.draft.weeks.filter(
          (w) => w.weekStart >= mondayOf(step.input.today) && w.targetRunMin > 0 && !w.isTaper,
        )
        for (const week of [future[1]!, future[Math.floor(future.length / 2)]!, future.at(-2)!]) {
          const asked = week.targetRunMin * 10 + 1000
          const rows = rowsOf(step.draft, step.input.today, { [week.weekStart]: asked })
          const limits = raisedTargetLimits({
            rows,
            draft: step.draft,
            input: step.input,
            state,
            decidedWeek: null,
          })
          const planned = planWeekWrites(rows, {
            today: step.input.today,
            weeks: step.draft.weeks,
            limits,
          })
          const where = `${position} ${week.weekStart} of the plan of ${step.input.today}`
          const limit = limits.get(week.weekStart)!
          const named = planned.targets.find((t) => t.weekStart === week.weekStart)!
          expect(named.outcome, where).toBe('clipped')
          expect(named.keptMin, where).toBeLessThanOrEqual(limit.max)
          expect(named.keptMin, where).toBeGreaterThanOrEqual(week.targetRunMin)
          const written = planned.updated.find((u) => u.before.weekStart === week.weekStart)
          if (written !== undefined) {
            expect(written.data.targetRunMin, where).toBeLessThanOrEqual(limit.max)
          }
          if (limit.kind === 'ceiling') {
            // the ceiling reads two earlier weeks of the plan, so it is under the largest week before
            const before = Math.max(
              0,
              ...[...totals]
                .filter(([monday]) => monday < week.weekStart)
                .map(([, minutes]) => minutes),
            )
            expect(limit.max, where).toBeLessThanOrEqual(
              Math.floor(before * (1 + P.g2.rampCeilingTwoWeeks.value)) + 1,
            )
          }
          checked += 1
        }
      }
      expect(checked).toBe(9)
    },
  )
})

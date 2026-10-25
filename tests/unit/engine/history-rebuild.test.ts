// The rebuild zone [rules g-8, proposal sections 4.2 to 4.5 and 5.3]: the step below the rebuild
// ceiling R and the usual 10% above it, the cases H1, H3, H4, H9, H10, H13, H14 (without the
// response of task L3b), H15 and H26, the generator, the guards, the checklist and the weekly
// decision reading one zone, and the matrix and a weekly re-plan chain at the three positions.
// Every expectation is derived from the Params and the finished plan, not from the code under test.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { draftRamp } from '../../../shared/engine/checklist.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import {
  ceilingWeeklyRate,
  rampLimits,
  rampStep,
  rebuildStep,
  type RampContext,
  type RebuildZone,
} from '../../../shared/engine/limits.ts'
import { loadPosition, rebuildZone } from '../../../shared/engine/loadSetting.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { windowOf } from './disruption-fixtures.ts'
import { activity, wellnessDay } from './e8-fixtures.ts'
import {
  at,
  h1,
  h10,
  h13Race,
  h13Window,
  h15,
  h26,
  h3Back,
  h4,
  h5,
  h7,
  HISTORY_MONDAY,
  s3Runs,
  s4Runs,
  s5Runs,
  scenario,
  SPARSE,
  summer,
  weeks,
  withTaperEnd,
} from './history-fixtures.ts'
import {
  ceilingProblems,
  cumulative,
  planProblems,
  POSITIONS,
  UPPER_STEP,
  weeksToLong,
  weeksToWeekly,
  zoneReport,
  type Position,
} from './history-properties.ts'
import { athletes } from './matrix-fixtures.ts'

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
  /** The week just run was run 30 minutes past its plan, on its first run. */
  over?: boolean
  /** The decision for the week that starts on this Monday. */
  decision?: 'hold' | 'reduce'
}

/**
 * The plan and the input of every Monday: the first plan, then a re-plan on each Monday with the
 * week before run as planned (plus the overshoot of the step), as the server does. A hold caps the
 * week at 85% of its plan; a reduce makes it a recovery week.
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
          durationSec: (s.durationMin + (step.over === true && i === 0 ? 30 : 0)) * 60,
          distanceM: s.distanceM ?? s.durationMin * 170,
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

describe('H14: a weekly re-plan chain, without the response of task L3b', () => {
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

  it.each(POSITIONS)('%s: a week run over its plan lifts nothing after it', (position) => {
    const quiet = runChain(at(base, position), plain)
    const over = runChain(at(base, position), [{}, { over: true }, {}, {}, {}])
    // the re-plans from the Monday after the overshot week on draw the same weeks as the quiet chain
    for (let k = 2; k < over.length; k += 1) {
      const monday = addDays(mondayOf(base.today), 7 * k)
      expect(targetsFrom(over[k]!.plan, monday), `step ${String(k)}`).toEqual(
        targetsFrom(quiet[k]!.plan, monday),
      )
    }
  })

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

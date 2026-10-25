// The focus of a plan week in the rebuild zone [rules g-8, proposal 4.6]: "Rebuilding toward
// {minutes} a week" on the weeks the checklist's progression item counts as zone weeks, and the
// phase's own focus on every other week. Kept apart from history-rebuild.test.ts, which the fixtures
// task edits. The expectations come from the checklist's own count, the zone ceiling and the plan
// at steady, not from the code that writes the focus.
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { loadFocus } from '../../../shared/copy/load.ts'
import { mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { draftRamp } from '../../../shared/engine/checklist.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { rampLimits, rebuildZoneUsed } from '../../../shared/engine/limits.ts'
import { loadPosition, rebuildZone } from '../../../shared/engine/loadSetting.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { at, h15, h1, s3Runs, scenario } from './history-fixtures.ts'
import { replanChain } from './replan-steps.ts'

const REBUILDING = /^Rebuilding toward /

const focusOf = (plan: PlanDraft, weekStart: string) =>
  plan.weeks.find((w) => w.weekStart === weekStart)!.focus

/** The weeks the checklist's progression item counts as zone weeks, from the draft's own ramp. */
function checklistZoneWeeks(input: EngineInput, plan: PlanDraft): string[] {
  const { ctx, weeks } = draftRamp(plan, input, estimateState(input))
  return weeks
    .filter(
      ({ weekStart, total }) =>
        total > 0 &&
        !plan.weeks.some(
          (w) =>
            w.weekStart === weekStart &&
            (w.flags.includes('post-race') || w.flags.includes('post-race-restart')),
        ) &&
        rebuildZoneUsed(rampLimits(ctx, weekStart), total, 1e-6) !== null,
    )
    .map(({ weekStart }) => weekStart)
}

/** How many weeks the progression item of the checklist says use the rebuild step. */
function checklistCount(plan: PlanDraft): number {
  const detail = plan.checklist.find((c) => c.id === 'progression')!.detail
  const found = /(\d+) week\(s\) use the rebuild step/.exec(detail)
  return found === null ? 0 : Number(found[1])
}

const rebuilding = (plan: PlanDraft) =>
  plan.weeks.filter((w) => REBUILDING.test(w.focus)).map((w) => w.weekStart)

describe('the focus of a week in the rebuild zone [rules g-8]', () => {
  it('is worded from the ceiling in whole minutes, and passes the G5 lint', () => {
    expect(loadFocus(196)).toBe('Rebuilding toward 196 min a week')
    expect(loadFocus(195.6)).toBe('Rebuilding toward 196 min a week')
    expect(lintText(loadFocus(238))).toEqual([])
  })

  describe.each(['standard', 'upper'] as const)('%s', (position) => {
    const input = at(h1(), position)
    const plan = buildPlan(input)
    const zone = rebuildZone(input, estimateState(input))!

    it('names the ceiling on exactly the weeks the checklist counts as zone weeks', () => {
      const counted = checklistZoneWeeks(input, plan)
      expect(counted.length).toBeGreaterThan(3)
      expect(rebuilding(plan)).toEqual(counted)
      expect(checklistCount(plan)).toBe(counted.length)
      for (const weekStart of counted) {
        expect(focusOf(plan, weekStart), weekStart).toBe(loadFocus(zone.ceilingMin))
      }
    })

    it('leaves every other week with the focus it has at steady, or its start words', () => {
      const steady = buildPlan(h1())
      const zoneWeeks = new Set(rebuilding(plan))
      const others = plan.weeks.filter((w) => !zoneWeeks.has(w.weekStart))
      expect(others.length).toBeGreaterThan(10)
      for (const week of others) {
        expect(week.focus, week.weekStart).not.toMatch(REBUILDING)
        // the start week words its own minutes; every other week reads as it does at steady
        // the weeks after the race restart from the peak the plan reached, which differs by position
        const own = week.flags.some((f) => f === 'restart-floor' || f.startsWith('post-race'))
        if (own) continue
        expect(week.focus, week.weekStart).toBe(focusOf(steady, week.weekStart))
      }
      // recovery, taper and race weeks are never named
      for (const week of plan.weeks.filter((w) => w.isRecovery || w.isTaper)) {
        expect(week.focus, week.weekStart).not.toMatch(REBUILDING)
      }
    })

    it('says nothing in a week above the ceiling, where the step is the usual one again', () => {
      const past = plan.weeks.filter(
        (w) => !w.isRecovery && !w.isTaper && w.targetRunMin > zone.ceilingMin * 1.2,
      )
      expect(past.length).toBeGreaterThan(0)
      for (const week of past) expect(week.focus, week.weekStart).not.toMatch(REBUILDING)
    })
  })

  it('names the ceiling of standard for upper read as standard at age 45 or over', () => {
    const input = at(scenario(s3Runs(), { profile: { birthYear: 1980 } }), 'upper')
    expect(loadPosition(input, estimateState(input)).ageCapped).toBe(true)
    const plan = buildPlan(input)
    const zone = rebuildZone(input, estimateState(input))!
    const weeks = rebuilding(plan)
    expect(weeks.length).toBeGreaterThan(3)
    expect(weeks).toEqual(checklistZoneWeeks(input, plan))
    for (const weekStart of weeks) expect(focusOf(plan, weekStart)).toBe(loadFocus(zone.ceilingMin))
  })

  it('links the progression item to g-8 when a week used the zone, and only then', () => {
    const rulesOf = (plan: PlanDraft) => plan.checklist.find((c) => c.id === 'progression')!.rules
    expect(rulesOf(buildPlan(at(h1(), 'standard')))).toEqual(['g-2', 'g-3', 'g-8'])
    expect(rulesOf(buildPlan(at(h1(), 'upper')))).toEqual(['g-2', 'g-3', 'g-8'])
    expect(rulesOf(buildPlan(h1()))).toEqual(['g-2', 'g-3'])
  })

  it('says nothing at steady, and nothing where the setting is held at steady', () => {
    expect(rebuilding(buildPlan(h1()))).toEqual([])
    expect(rebuilding(buildPlan(at(h1(), 'steady')))).toEqual([])
    const injury = {
      area: 'knee',
      side: 'left' as const,
      year: 2026,
      month: 6,
      kind: 'joint' as const,
      notes: null,
    }
    const held = at(scenario(s3Runs(), { profile: { injuries: [injury] } }), 'standard')
    expect(loadPosition(held, estimateState(held)).held).toBe('recent-injury')
    expect(rebuilding(buildPlan(held))).toEqual([])
  })

  it('stops at the peak week of a plan whose race is near, as the zone does', () => {
    const input = at(h15(), 'standard')
    const plan = buildPlan(input)
    const counted = checklistZoneWeeks(input, plan)
    expect(rebuilding(plan)).toEqual(counted)
    expect(counted.length).toBeGreaterThan(0)
    for (const week of plan.weeks.filter((w) => w.isTaper || w.phase === 'race')) {
      expect(week.focus, week.weekStart).not.toMatch(REBUILDING)
    }
  })

  it('names the weeks of a re-plan the same way, step by step along a season', () => {
    const chain = replanChain(at(h1(), 'standard'), { maxSteps: 4 })
    expect(chain.length).toBeGreaterThan(3)
    for (const [k, { input, draft }] of chain.entries()) {
      // the weeks before the current one stay as the replaced plan had them
      const fromNow = rebuilding(draft).filter((weekStart) => weekStart >= mondayOf(input.today))
      expect(fromNow, `step ${String(k)}`).toEqual(checklistZoneWeeks(input, draft))
      expect(fromNow.length, `step ${String(k)}`).toBeGreaterThan(0)
    }
  })
})

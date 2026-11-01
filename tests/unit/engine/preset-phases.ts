// The phases of a longer-base plan [rule P4, task M5 review]: the preset draws base, build, specific,
// taper and race in that order, the build is at most `p4.buildWeeks` weeks, a week of a start path
// (a ladder rung, an injury-return level, the restart floor) keeps the phase the preset's own draw
// gives it, and a plan whose only base weeks are those reads the default and is the default plan.
// `phaseProblems` says what is wrong with the plan of one input; `preset-phases*.test.ts` run it on
// the matrix and the history sweep with the race moved later in steps of 7 days from 0 to 175.
import { describe, expect, it, vi } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { injuryLevel, startKind } from '../../../shared/engine/startWeeks.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { positionOf, text, withMethod } from './method-fixtures.ts'

/** Days the race is moved later: 0 to 175 in steps of 7. */
export const SHIFTS: readonly number[] = Array.from({ length: 26 }, (_, i) => 7 * i)

const ORDER = ['base', 'build', 'specific', 'taper', 'race']

const isStartWeek = (w: PlanDraft['weeks'][number]): boolean =>
  startKind(w.flags) !== null || injuryLevel(w.flags) !== null

/** The input with the race `days` days later. */
export const later = (input: EngineInput, days: number): EngineInput => ({
  ...input,
  goal: { ...input.goal, date: addDays(input.goal.date, days) },
})

export interface PhaseResult {
  problems: string[]
  /** The preset applies to the plan. */
  applies: boolean
  /** The plan has a week of a start path. */
  start: boolean
}

/** What is wrong with the phases of the longer-base plan of `input`; empty when they are well formed. */
export function phaseProblems(input: EngineInput): PhaseResult {
  const preset = withMethod(input, 'longer-base')
  const plan = buildPlan(preset)
  const position = positionOf(preset, plan)
  const weeks = plan.weeks.filter((w) => !w.flags.includes('post-race'))
  const problems: string[] = []
  // the order never goes back: base, build, specific, taper, race
  for (let i = 1; i < weeks.length; i += 1) {
    const [before, after] = [weeks[i - 1]!, weeks[i]!]
    if (ORDER.indexOf(after.phase) < ORDER.indexOf(before.phase)) {
      problems.push(`${after.weekStart}: ${after.phase} after ${before.phase}`)
    }
  }
  const build = weeks.filter((w) => w.phase === 'build').length
  const ownBase = weeks.filter((w) => w.phase === 'base' && !isStartWeek(w)).length
  if (position.effective === 'longer-base') {
    // the build is at most 4 weeks, and the preset applies only for a base week of its own
    if (build > P.p4.buildWeeks.value) problems.push(`build of ${String(build)} weeks`)
    if (ownBase === 0) problems.push('applies with no base week outside a start path')
  } else if (position.reason === 'no-base') {
    // a plan with no base to lengthen is the default plan
    if (text(plan) !== text(buildPlan(input))) problems.push('reads no-base, not the default plan')
  }
  return { problems, applies: position.effective === 'longer-base', start: weeks.some(isStartWeek) }
}

interface Runner {
  name: string
  input: EngineInput
}

/** One test: every runner with the race at every shift, no problem found, and at least `minStartPlans` plans with a start path. */
export function describePhases(title: string, runners: readonly Runner[], minStartPlans = 0): void {
  // a plan takes 30 to 80 ms: the runners of a file at 26 dates take about a minute, and more beside
  // the other test files, so the timeout is three minutes
  vi.setConfig({ testTimeout: 180_000 })
  describe(title, () => {
    it('never decrease and keep the build to p4.buildWeeks, with the race 0 to 175 days later', () => {
      const bad: string[] = []
      let plans = 0
      let applying = 0
      let starts = 0
      for (const runner of runners) {
        for (const days of SHIFTS) {
          const result = phaseProblems(later(runner.input, days))
          plans += 1
          if (result.applies) applying += 1
          if (result.start) starts += 1
          for (const problem of result.problems) {
            bad.push(`${runner.name} +${String(days)}: ${problem}`)
          }
        }
      }
      expect(bad).toEqual([])
      expect(plans).toBe(runners.length * SHIFTS.length)
      // the sample holds plans the preset applies to, and plans with a start path
      expect(applying).toBeGreaterThan(plans / 3)
      expect(starts).toBeGreaterThanOrEqual(minStartPlans)
    })
  })
}

// The phases of a longer-base plan [rule P4, task M5 review]: the preset draws base, build, specific,
// taper and race in that order, the build is at most `p4.buildWeeks` weeks, a week of a start path
// (a ladder rung, an injury-return level, the restart floor) keeps the phase the preset's own draw
// gives it, and a plan whose only base weeks are those reads the default and is the default plan.
// `phaseProblems` says what is wrong with the plan of one input. `preset-phases.test.ts` runs it in
// `npm run check` on the matrix with the race moved later in steps of 7 days from 0 to 175, and on a
// sample of the history sweep. The full sweep (the 150 runners at all 26 dates, about 3.5 minutes on
// one core) is by hand, as the simulator's figures are, in `preset-phases-sweep-1..3.test.ts`, on
// three workers: run it at each `PARAMS_VERSION` bump, beside `npm run plan:report`,
//
//   PRESET_PHASES_FULL=1 npx vitest run tests/unit/engine/preset-phases-sweep
import { describe, expect, it } from 'vitest'
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

export interface PhaseOptions {
  /** The days the race is moved later (default: every 7 days from 0 to 175). */
  shifts?: readonly number[]
  /** The least number of plans with a start path the sample must hold. */
  minStartPlans?: number
  /** By hand: skipped unless `PRESET_PHASES_FULL` is set. */
  byHand?: boolean
}

/**
 * One test: every runner with the race at every shift, no problem found. The test timeout is the
 * `sweep` project's (`tests/vitestProjects.ts`): every file that calls this is in it.
 */
export function describePhases(
  title: string,
  runners: readonly Runner[],
  { shifts = SHIFTS, minStartPlans = 0, byHand = false }: PhaseOptions = {},
): void {
  const suite = byHand ? describe.skipIf(process.env.PRESET_PHASES_FULL === undefined) : describe
  suite(title, () => {
    it('never decrease and keep the build to p4.buildWeeks, with the race moved later', () => {
      const bad: string[] = []
      let plans = 0
      let applying = 0
      let starts = 0
      for (const runner of runners) {
        for (const days of shifts) {
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
      expect(plans).toBe(runners.length * shifts.length)
      // the sample holds plans the preset applies to, and plans with a start path
      expect(applying).toBeGreaterThan(plans / 3)
      expect(starts).toBeGreaterThanOrEqual(minStartPlans)
    })
  })
}

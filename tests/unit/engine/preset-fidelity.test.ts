// The fidelity of a method preset [rules P1 to P4, task M5]: what the sessions a runner finished held,
// week by week, against what the preset promises. The twelve matrix athletes run every session of
// the plan at the simulator's compliant level (`sim-athlete.ts`: 90% to 110% of each session, inside
// the band of the completion rules, no day skipped), at the default and at each preset, from the
// first plan to the race week, and `scoreChain` reads the finished sessions:
// - three-run-days [P2]: at most three run days in any week, where the preset applies;
// - longer-base [P4]: strides alone as quality in the base weeks, threshold and hills in the build
//   weeks, never intervals before the specific phase, where the preset applies;
// - both: at most the two quality sessions of F2 in a week, and the long run's share of the week the
//   default's (P3, a shorter long run, is not offered).
// A runner the preset reads as the default finishes the default's weeks, figure for figure.
//
// Every preset is grade D, a choice and not a better plan: the `fidelity` figure is report-only, and
// these asserts check that a preset keeps its words, never that its weeks are better.
import { describe, expect, it, vi } from 'vitest'
import type { SessionKind } from '../../../shared/engine/types.ts'
import { athletes } from './matrix-fixtures.ts'
import { OFFERED, READING, type Offered } from './method-fixtures.ts'
import {
  scoreChain,
  SimAthlete,
  simulateChain,
  type Fidelity,
  type SimChain,
} from './sim-athlete.ts'

// The 36 chains take about ten seconds on a development machine and more beside the other test files:
// the timeout is a minute, so a slow machine fails an assertion and not a bare timeout.
vi.setConfig({ testTimeout: 60_000 })

/** One seed for every chain, so the athlete draws the same days at every preset (`sim-athlete.test.ts`). */
const SEED = 20_261_031
const all = athletes()

/** The most quality sessions a week holds [rule F2: one or two]. */
const QUALITY_PER_WEEK = 2

/**
 * The share of the week the long run takes may differ from the default's by this much on average
 * over a chain, no more: a preset that does not offer P3 does not move the long run. A tolerance of
 * this file, not a rule; the largest of the 24 chains is about 0.005.
 */
const LONG_RUN_SHARE_TOLERANCE = 0.01

const chains = new Map<string, SimChain>()
function chainOf(index: number, method: Offered | 'default'): SimChain {
  const key = `${method}/${String(index)}`
  let chain = chains.get(key)
  if (chain === undefined) {
    chain = simulateChain(
      new SimAthlete(SEED + index, 'compliant'),
      all[index]!.input,
      method === 'default' ? {} : { method },
    )
    chains.set(key, chain)
  }
  return chain
}
const fidelityOf = (index: number, method: Offered | 'default'): Fidelity =>
  scoreChain(chainOf(index, method)).fidelity.value

const kindsOf = (week: Fidelity['weeks'][number]): SessionKind[] =>
  Object.keys(week.quality) as SessionKind[]
const count = (week: Fidelity['weeks'][number]): number =>
  Object.values(week.quality).reduce((sum, n) => sum + n, 0)

describe('the chains of the compliant level', () => {
  it.each(['default', ...OFFERED] as const)(
    'finish every session of the plan at %s, so the figure reads the plan',
    (method) => {
      let weeks = 0
      all.forEach((_, index) => {
        for (const step of chainOf(index, method).steps) {
          if (step.week === null) continue
          expect(step.week.sessions.skipped, `${all[index]!.id} ${step.week.weekStart}`).toBe(0)
          weeks += 1
        }
        expect(fidelityOf(index, method).weeks.length, all[index]!.id).toBeGreaterThan(10)
      })
      // 12 athletes: the weeks of each chain, the first plan apart
      expect(weeks).toBe(237)
    },
  )

  it('hold at most the two quality sessions of F2 in any week, at the default and at both presets', () => {
    all.forEach((a, index) => {
      for (const method of ['default', ...OFFERED] as const) {
        for (const week of fidelityOf(index, method).weeks) {
          expect(count(week), `${a.id} ${method} ${week.weekStart}`).toBeLessThanOrEqual(
            QUALITY_PER_WEEK,
          )
        }
      }
    })
  })
})

describe('three-run-days [rule P2]', () => {
  const applies = all.flatMap((a, index) =>
    READING['three-run-days'][a.id] === 'applies' ? [{ a, index }] : [],
  )

  it('finishes at most three run days in any week where it applies, and the default more for two of the three', () => {
    expect(applies.map(({ a }) => a.id)).toEqual(['half', 'returning', 'post-marathon-short-run'])
    const defaultDays = applies.map(({ index }) => fidelityOf(index, 'default').maxRunDays)
    expect(defaultDays).toEqual([4, 4, 3])
    for (const { a, index } of applies) {
      const f = fidelityOf(index, 'three-run-days')
      expect(f.maxRunDays, a.id).toBeLessThanOrEqual(3)
      for (const week of f.weeks)
        expect(week.runDays, `${a.id} ${week.weekStart}`).toBeLessThanOrEqual(3)
    }
  })

  it('finishes no more quality sessions in a week than the default chain does in the same week', () => {
    for (const { a, index } of applies) {
      const base = new Map(fidelityOf(index, 'default').weeks.map((w) => [w.weekStart, w]))
      for (const week of fidelityOf(index, 'three-run-days').weeks) {
        expect(count(week), `${a.id} ${week.weekStart}`).toBeLessThanOrEqual(
          count(base.get(week.weekStart)!),
        )
      }
    }
  })

  it('finishes the weeks of the default where it reads the default', () => {
    all.forEach((a, index) => {
      if (READING['three-run-days'][a.id] === 'applies') return
      expect(fidelityOf(index, 'three-run-days'), a.id).toEqual(fidelityOf(index, 'default'))
    })
  })
})

describe('longer-base [rule P4]', () => {
  const applies = all.flatMap((a, index) =>
    READING['longer-base'][a.id] === 'applies' ? [{ a, index }] : [],
  )

  it('finishes strides alone as quality in the base weeks, threshold and hills in the build, no intervals before the specific phase', () => {
    expect(applies).toHaveLength(8)
    let base = 0
    let build = 0
    let hills = 0
    for (const { a, index } of applies) {
      for (const week of fidelityOf(index, 'longer-base').weeks) {
        const at = `${a.id} ${week.weekStart} (${String(week.phase)})`
        if (week.phase === 'base') {
          base += 1
          expect(
            kindsOf(week).filter((k) => k !== 'strides'),
            at,
          ).toEqual([])
        }
        if (week.phase === 'build') {
          build += 1
          for (const kind of kindsOf(week)) expect(['threshold', 'hills'], at).toContain(kind)
          if (week.quality.hills !== undefined) hills += 1
        }
        if (week.phase === 'base' || week.phase === 'build') {
          expect(week.quality.intervals, at).toBeUndefined()
        }
      }
    }
    // the weeks were read, hills are used where a build week holds two sessions
    expect(base).toBeGreaterThan(50)
    expect(build).toBeGreaterThan(25)
    expect(hills).toBeGreaterThan(5)
  })

  it('shows the intervals the default holds in the build, so the check is not vacuous', () => {
    const withIntervals = applies.filter(({ index }) =>
      fidelityOf(index, 'default').weeks.some((w) => w.phase === 'build' && w.quality.intervals),
    )
    expect(withIntervals.map(({ a }) => a.id)).toEqual([
      'half',
      'marathon',
      'masters',
      'returning',
      'hot-race',
    ])
  })

  it('opens a build week with threshold when it holds one quality session', () => {
    let single = 0
    for (const { a, index } of applies) {
      for (const week of fidelityOf(index, 'longer-base').weeks) {
        if (week.phase !== 'build' || count(week) !== 1) continue
        single += 1
        expect(week.quality.threshold, `${a.id} ${week.weekStart}`).toBe(1)
      }
    }
    expect(single).toBeGreaterThan(10)
  })

  it('finishes the weeks of the default where it reads the default', () => {
    all.forEach((a, index) => {
      if (READING['longer-base'][a.id] === 'applies') return
      expect(fidelityOf(index, 'longer-base'), a.id).toEqual(fidelityOf(index, 'default'))
    })
  })
})

describe.each(OFFERED)('the long run at %s [rule P3 is not offered]', (method) => {
  it('takes the same share of the week as the default, over a chain, for every athlete', () => {
    all.forEach((a, index) => {
      const f = fidelityOf(index, method).meanLongRunShare
      const base = fidelityOf(index, 'default').meanLongRunShare
      expect(f, a.id).not.toBeNull()
      expect(Math.abs(f! - base!), a.id).toBeLessThanOrEqual(LONG_RUN_SHARE_TOLERANCE)
    })
  })
})

describe('the fidelity figure', () => {
  it('is labelled with the Params its figures are read against, and is a figure and nothing more', () => {
    const score = scoreChain(chainOf(1, 'three-run-days'))
    expect(score.fidelity.grade).toBe('D')
    expect(score.fidelity.rule).toBe('P2, design-macro')
    expect(Object.keys(score.fidelity.value).sort()).toEqual([
      'maxRunDays',
      'meanLongRunShare',
      'meanQualitySessions',
      'weeks',
    ])
  })
})

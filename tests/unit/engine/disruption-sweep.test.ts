// A seeded sweep of rest windows over the matrix athletes [phase 3a design 9.8, rule J9]: every
// athlete takes every reason and mode, at start offsets from 14 days back to 14 days ahead and in
// lengths of 1, 3, 7, 14 and 28 days. Each plan must pass its checklist, keep rest on the held days,
// the caps and the quiet days, add no minutes to any week, hold the return weeks to the J7 share,
// build the same plan twice and, with the window removed, give the plan without it again.
//
// The whole product is 14 000 plans; the seed picks a sample (`rest-window-sweep.ts`) that covers
// every athlete with every reason and mode, so a failure names a combination to replay.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { disruptionPlan, injuryReportOf } from '../../../shared/engine/disruption.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { planMinutes, problemsOf, windowOf, withWindows } from './disruption-fixtures.ts'
import { athletes, TODAY } from './matrix-fixtures.ts'
import {
  REST_SWEEP_KINDS,
  REST_SWEEP_LENGTHS,
  REST_SWEEP_ROUNDS,
  restWindowCombos,
} from './rest-window-sweep.ts'

// The budget of design 9.8: the sweep runs in under 60 s. The test timeout below is twice that, so
// a slow machine fails the assertion with the elapsed time instead of a bare timeout.
const BUDGET_MS = 60_000

const all = athletes()
const baselines = new Map(all.map((a) => [a.id, buildPlan(a.input)]))

const asExisting = (plan: PlanDraft): NonNullable<EngineInput['existing']> => ({
  weeks: plan.weeks,
  sessions: plan.sessions.map((s, i) => ({
    ...s,
    id: `s${i}`,
    status: 'planned',
    activityId: null,
  })),
})

describe('seeded sweep of rest windows over the matrix', () => {
  const sample = restWindowCombos(all)

  it('covers every athlete with every reason and mode, and every length and a spread of starts', () => {
    expect(sample.length).toBe(all.length * REST_SWEEP_KINDS.length * REST_SWEEP_ROUNDS)
    for (const a of all) {
      for (const kind of REST_SWEEP_KINDS) {
        const hits = sample.filter(
          (c) =>
            c.athlete.id === a.id && c.window.reason === kind.reason && c.window.mode === kind.mode,
        )
        expect(hits.length, `${a.id} ${kind.reason}/${kind.mode}`).toBe(REST_SWEEP_ROUNDS)
      }
    }
    const lengths = new Set(
      sample.map(
        (c) => (Date.parse(c.window.endDate) - Date.parse(c.window.startDate)) / 864e5 + 1,
      ),
    )
    for (const length of REST_SWEEP_LENGTHS)
      expect(lengths.has(length), `length ${length}`).toBe(true)
    const starts = new Set(sample.map((c) => c.window.startDate))
    expect(starts.size).toBeGreaterThan(20)
    // the sample reaches the restart share, the injury ramp and the capped days
    const holds = sample.filter((c) => disruptionPlan([c.window]).holds.some((h) => h.fraction < 1))
    expect(holds.length).toBeGreaterThan(100)
    expect(sample.filter((c) => injuryReportOf(c.window) !== null).length).toBeGreaterThan(20)
    expect(sample.filter((c) => c.window.mode === 'limited').length).toBeGreaterThan(100)
  })

  it('keeps every invariant, builds the same plan twice and restores the plan on removal (under 60 s)', () => {
    const started = Date.now()
    const failures: string[] = []
    for (const [n, combo] of sample.entries()) {
      const { athlete: a, window } = combo
      const base = baselines.get(a.id)!
      const input = withWindows(a, window)
      const plan = buildPlan(input)
      for (const problem of problemsOf(a, [window], plan, base)) {
        failures.push(`${combo.name}: ${problem}`)
      }
      if (
        n % 3 === 0 &&
        JSON.stringify(buildPlan(structuredClone(input))) !== JSON.stringify(plan)
      ) {
        failures.push(`${combo.name}: the plan is not deterministic`)
      }
      // removal: a plan built without the window is the plan without it
      if (n % 12 === 0) {
        if (JSON.stringify(buildPlan({ ...input, disruptions: [] })) !== JSON.stringify(base)) {
          failures.push(`${combo.name}: removing the window does not restore the plan`)
        }
        // a re-plan from the windowed plan without the window never adds a minute to any week;
        // the weeks after the next Monday are the plan without it
        const restored = replan({ ...a.input, existing: asExisting(plan) }).draft
        const before = planMinutes(base)
        for (const [week, minutes] of planMinutes(restored)) {
          if (minutes > (before.get(week) ?? 0)) {
            failures.push(`${combo.name}: restored week ${week} holds ${minutes} min`)
          }
        }
      }
    }
    expect(failures).toEqual([])
    const elapsedMs = Date.now() - started
    expect(elapsedMs, `the sweep took ${String(elapsedMs)} ms`).toBeLessThan(BUDGET_MS)
  }, 120_000)

  it('puts no negative or fractional number into a week', () => {
    // a cap never goes below zero, even when a window holds a whole week
    const half = all.find((a) => a.id === 'half')!
    const plan = buildPlan(
      withWindows(
        half,
        windowOf({ startDate: TODAY, endDate: addDays(TODAY, 27), reason: 'travel' }),
      ),
    )
    for (const week of plan.weeks) {
      expect(week.targetRunMin).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(week.targetRunMin)).toBe(true)
      expect(week.longRunMin).toBeGreaterThanOrEqual(0)
    }
    const weeks = new Set(plan.sessions.map((s) => mondayOf(s.date)))
    expect(weeks.size).toBeGreaterThan(4)
  })
})

// Entered B and C races on every week of a plan [rules K6, H12, task SR1]: for matrix athletes (short
// road plans, a 50 km and a 100 miles plan), a race of each priority in a 5 km and a marathon class,
// dated in every week, passes the full checklist, plans no week above the plan without the race,
// and a re-plan the day after, two days after and a week after the race fails no check that the
// same re-plan without the race passes.
import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { runningMinutes } from '../../../shared/engine/limits.ts'
import type { EngineInput, EnteredRace, GoalModel } from '../../../shared/engine/types.ts'
import { athletes } from './matrix-fixtures.ts'

const CLASSES: Record<string, Partial<GoalModel>> = {
  '5k': { distanceM: 5000, distanceClass: '5k', expectedDurationSec: 1500 },
  marathon: { distanceM: 42_195, distanceClass: 'marathon', expectedDurationSec: 13_500 },
}

function race(base: EngineInput, priority: 'B' | 'C', date: string, cls: string): EnteredRace {
  return {
    priority,
    goal: {
      ...base.goal,
      goalId: `tune-${priority}-${date}`,
      name: `Synthetic ${date}`,
      date,
      gainM: 0,
      lossM: 0,
      surface: 'road',
      goalType: 'finish',
      targetTimeSec: null,
      startTime: null,
      isUltra: false,
      crossesDarkness: false,
      raceWbgtC: null,
      ...CLASSES[cls],
    },
  }
}

const failing = (checklist: ReadonlyArray<{ id: string; ok: boolean }>) =>
  checklist.filter((c) => !c.ok).map((c) => c.id)

describe('an entered race in every week of a plan', () => {
  for (const id of ['novice-5k', 'half', 'trail-50k', 'first-100-mile']) {
    it(`${id}: the plan passes the checks and the re-plans after the race fail nothing new`, () => {
      const base = athletes().find((a) => a.id === id)!.input
      const plain = buildPlan(base)
      expect(failing(plain.checklist)).toEqual([])
      const weeks = Math.floor(daysBetween(mondayOf(base.today), base.goal.date) / 7)
      const minutesOf = (sessions: typeof plain.sessions) => {
        const byWeek = new Map<string, number>()
        for (const s of sessions) {
          const week = mondayOf(s.date)
          byWeek.set(week, (byWeek.get(week) ?? 0) + runningMinutes([s]))
        }
        return byWeek
      }
      const without = minutesOf(plain.sessions)
      for (let w = 0; w < weeks; w++) {
        const date = addDays(mondayOf(base.today), 7 * w + 5)
        if (date <= base.today || date >= base.goal.date) continue
        for (const cls of Object.keys(CLASSES)) {
          for (const priority of ['B', 'C'] as const) {
            const entered = race(base, priority, date, cls)
            const label = `${id} ${cls} ${priority} ${date}`
            const plan = buildPlan({ ...base, races: [entered] })
            expect(failing(plan.checklist), label).toEqual([])
            expect(plan.sessions.filter((s) => s.kind === 'race').length, label).toBe(2)
            for (const [week, minutes] of minutesOf(plan.sessions)) {
              expect(minutes, `${label} week ${week}`).toBeLessThanOrEqual(without.get(week) ?? 0)
            }
            const existing = {
              weeks: plan.weeks,
              sessions: plan.sessions.map((s, i) => ({
                ...s,
                id: `s${String(i)}`,
                status: 'planned',
                activityId: null,
              })),
            }
            const plainExisting = {
              weeks: plain.weeks,
              sessions: plain.sessions.map((s, i) => ({
                ...s,
                id: `p${String(i)}`,
                status: 'planned',
                activityId: null,
              })),
            }
            for (const after of [1, 2, 7]) {
              const today = addDays(date, after)
              if (today >= base.goal.date) continue
              const run = replan({ ...base, today, existing }).draft
              const reference = replan({ ...base, today, existing: plainExisting }).draft
              const fresh = failing(run.checklist).filter(
                (item) => !failing(reference.checklist).includes(item),
              )
              expect(fresh, `${label}: re-plan ${String(after)} days after`).toEqual([])
            }
          }
        }
      }
    }, 120_000)
  }
})

// A race on every weekday, and a re-plan on every day from 7 days before it to 10 days after it (the
// race day included), the way the server re-plans: the races it sends are the ones after today, and
// the plan being replaced holds the race session. The re-plan with the race must fail no check
// that the same re-plan without the race passes.
const REPLAN_FROM = -7
const REPLAN_TO = 10

describe('a race on every weekday, re-planned around its day', () => {
  for (const id of ['novice-5k', 'half', 'trail-50k', 'first-100-mile']) {
    it(`${id}: no re-plan from 7 days before to 10 days after fails a check the plan without the race passes`, () => {
      const base = athletes().find((a) => a.id === id)!.input
      const plain = buildPlan(base)
      const stored = (plan: typeof plain, prefix: string) => ({
        weeks: plan.weeks,
        sessions: plan.sessions.map((s, i) => ({
          ...s,
          id: `${prefix}${String(i)}`,
          status: 'planned',
          activityId: null,
        })),
      })
      const plainExisting = stored(plain, 'p')
      const withoutRace = new Map<string, string[]>()
      const without = (today: string) => {
        let failed = withoutRace.get(today)
        if (failed === undefined) {
          failed = failing(replan({ ...base, today, existing: plainExisting }).draft.checklist)
          withoutRace.set(today, failed)
        }
        return failed
      }
      const week = addDays(mondayOf(base.today), 21)
      let cases = 0
      const problems: string[] = []
      for (let weekday = 0; weekday < 7; weekday++) {
        const date = addDays(week, weekday)
        if (date >= base.goal.date) continue
        for (const cls of Object.keys(CLASSES)) {
          for (const priority of ['B', 'C'] as const) {
            const entered = race(base, priority, date, cls)
            const existing = stored(buildPlan({ ...base, races: [entered] }), 's')
            for (let offset = REPLAN_FROM; offset <= REPLAN_TO; offset++) {
              const today = addDays(date, offset)
              if (today <= base.today || today >= base.goal.date) continue
              const races = offset < 0 ? [entered] : []
              const draft = replan({ ...base, today, races, existing }).draft
              const fresh = failing(draft.checklist).filter(
                (item) => !without(today).includes(item),
              )
              if (fresh.length > 0) {
                problems.push(`${cls} ${priority} race ${date}, re-plan ${today}: ${fresh.join()}`)
              }
              cases += 1
            }
          }
        }
      }
      expect(problems.slice(0, 12), `${String(problems.length)} of ${String(cases)} cases`).toEqual(
        [],
      )
      expect(cases).toBeGreaterThan(400)
    }, 300_000)
  }
})

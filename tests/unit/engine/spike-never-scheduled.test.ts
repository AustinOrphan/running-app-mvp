// The generator never schedules a run in the override band [rules g-1]: a generated run is shortened
// to the warn band instead, and the minutes that do not fit are dropped, not moved (task E19).
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { goalModel } from '../../../shared/engine/goal.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import type { Activity, Goal, Weekday } from '../../../shared/types.ts'
import { activity, goal as placeholderGoal, profile } from './e8-fixtures.ts'

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
/** Monday 2026-10-19 plus the offset is "today": one input per weekday. */
const MONDAY = '2026-10-19'

function marathon(date: string): Goal {
  return {
    id: 'goal-1',
    userId: 'u1',
    name: 'Synthetic marathon',
    priority: 'A',
    status: 'target',
    targetDate: date,
    dateProvisional: false,
    distanceM: 42_195,
    location: null,
    successCriteria: null,
    notes: null,
    url: null,
    isActive: true,
    gainM: null,
    lossM: null,
    surface: 'road',
    goalType: 'time',
    targetTimeSec: null,
    startTime: null,
    raceLat: null,
    raceLng: null,
    supportLevel: 'aided',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  }
}

/** 0 = Monday. */
const dow = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7

/** Eight weeks of 40-minute runs on six days (no Sunday), ending with the week before `today`. */
function history(today: string): Activity[] {
  const out: Activity[] = []
  const first = addDays(mondayOf(today), -7 * 8)
  for (let date = first; date < mondayOf(today); date = addDays(date, 1)) {
    if (dow(date) === 6) continue
    out.push(
      activity(date, {
        id: `run-${date}`,
        durationSec: 2400,
        movingSec: 2400,
        distanceM: 6500,
        rpe: 3,
      }),
    )
  }
  return out
}

/** The reproduction: today is `offset` days into the week, the day 3 days ahead is closed. */
function inputFor(offset: number): EngineInput {
  const today = addDays(MONDAY, offset)
  const closed = WEEKDAYS[(offset + 3) % 7]!
  const base: EngineInput = {
    today,
    profile: profile({
      birthYear: 1985,
      hrMax: 188,
      hrMaxSource: 'measured',
      availability: {
        ...profile().availability,
        [closed]: { available: false, maxMin: 0 },
      },
    }),
    activities: history(today),
    wellness: [],
    reviews: [],
    goal: placeholderGoal(),
    forecast: null,
    existing: null,
    options: {},
  }
  const model = goalModel(marathon(addDays(today, 140)), estimateState(base), null)
  return { ...base, goal: model }
}

function check(plan: PlanDraft, input: EngineInput): void {
  const bad = plan.sessions.filter((s) => s.flags.includes('override-required'))
  expect(bad.map((s) => `${s.date} ${s.kind} ${s.durationMin}`)).toEqual([])
  expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  // the current week stays in the normal band of the 40-minute reference, and the minutes that do
  // not fit are dropped, never moved to another day
  const week = plan.weeks.find((w) => w.weekStart === mondayOf(input.today))!
  const thisWeek = plan.sessions.filter(
    (s) => s.date >= input.today && mondayOf(s.date) === week.weekStart && s.kind !== 'strength',
  )
  for (const s of thisWeek) {
    expect(s.durationMin, `${s.date} ${s.kind}`).toBeLessThanOrEqual(44)
    expect(s.flags).not.toContain('spike-warn')
  }
  expect(thisWeek.reduce((n, s) => n + s.durationMin, 0)).toBeLessThanOrEqual(week.targetRunMin)
}

describe('buildPlan: the current week never packs a spike into its last days [rules g-1]', () => {
  for (const [offset, day] of WEEKDAYS.entries()) {
    it(`generated on a ${day} schedules nothing that needs an override`, () => {
      const input = inputFor(offset)
      check(buildPlan(input), input)
    })
  }
})

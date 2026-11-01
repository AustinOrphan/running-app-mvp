// The week of a long race, re-planned with nothing new [rules K6, G-6, J9, G6]. The day before the race
// is cut to a shake-out from its share of the week, so every bound on the minutes a week still has
// (what the replaced plan still has planned, what a window leaves, what the default places for a
// preset) is net of the cut, and the week is placed at the target whose placement, cut once, totals
// those minutes. Each case builds the plan, runs the days before today as planned, and re-plans the
// week three times, each pass storing the plan the last one drew: the runs still to come are the
// stored runs (date, kind, minutes) every time (third review of RF3).
//
// A session skipped in advance is kept as it is and stays out of what the plan still has planned, so
// the bound of the week is the minutes planned and not the figure of the week less what was run.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  DisruptionWindow,
  EngineInput,
  PlanDraft,
  PresetId,
  SessionSpec,
} from '../../../shared/engine/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { replanChain } from './replan-steps.ts'

const NOT_RUNS = ['strength', 'mobility', 'rest', 'race', 'hike', 'cross']
type Run = [string, string, number]

const athlete = (id: string) => athletes().find((a) => a.id === id)!

/** The runs of the week of `monday` from `from` on, without the dates in `except`. */
function runs(
  sessions: ReadonlyArray<SessionSpec>,
  monday: string,
  from: string,
  except: readonly string[] = [],
): Run[] {
  return sessions
    .filter(
      (s) =>
        s.date >= from &&
        mondayOf(s.date) === monday &&
        !NOT_RUNS.includes(s.kind) &&
        !s.flags.includes('post-race') &&
        !except.includes(s.date),
    )
    .map((s): Run => [s.date, s.kind, s.durationMin])
}

/** The plan as stored on `today`: the days before it run as planned, the dates in `skipped` skipped. */
function storedAt(plan: PlanDraft, today: string, skipped: readonly string[]) {
  return {
    weeks: plan.weeks,
    sessions: plan.sessions.map((s, i) => ({
      ...s,
      id: `s${String(i)}`,
      status: s.date < today ? 'completed' : skipped.includes(s.date) ? 'skipped' : 'planned',
      activityId: null,
    })),
  }
}

interface Passes {
  stored: Run[]
  passes: Run[][]
}

/**
 * Builds the plan of `input`, runs the days of the week before `today` as planned and re-plans on
 * `today` three times, each with the last pass stored. `skipped` are dates ahead of today whose
 * sessions were skipped in advance.
 */
function replanPasses(
  input: EngineInput,
  today: string,
  skipped: readonly string[] = [],
  reported: readonly DisruptionWindow[] = [],
): Passes {
  const monday = mondayOf(today)
  const first = buildPlan(input)
  const done = first.sessions
    .filter((s) => s.date < today && !NOT_RUNS.includes(s.kind))
    .map((s) =>
      activity(s.date, {
        id: `done-${s.date}`,
        durationSec: s.durationMin * 60,
        distanceM: s.distanceM ?? s.durationMin * 170,
      }),
    )
  let current: EngineInput = {
    ...input,
    today,
    activities: [...input.activities, ...done],
    disruptions: [...(input.disruptions ?? []), ...reported],
    existing: storedAt(first, today, skipped),
  }
  const passes: Run[][] = []
  for (let pass = 1; pass <= 3; pass += 1) {
    const draft = replan(current).draft
    passes.push(runs(draft.sessions, monday, today, skipped))
    current = { ...current, existing: storedAt(draft, today, skipped) }
  }
  return { stored: runs(first.sessions, monday, today, skipped), passes }
}

const total = (list: Run[]) => list.reduce((n, r) => n + r[2], 0)

function expectStored({ stored, passes }: Passes) {
  expect(stored.length).toBeGreaterThan(0)
  passes.forEach((pass, i) => expect(pass, `pass ${String(i + 1)}`).toEqual(stored))
}

const limited = (date: string, maxRunMin: number): DisruptionWindow => ({
  id: 'w1',
  reason: 'travel',
  mode: 'limited',
  startDate: date,
  endDate: date,
  maxRunMin,
  pain: null,
  gaitChange: false,
})
const resting = (date: string): DisruptionWindow => ({
  ...limited(date, 0),
  mode: 'rest',
  maxRunMin: null,
})

/** A Saturday 100-mile race: Monday to Thursday run 48 minutes, Friday is the shake-out. */
const hundred = athlete('first-100-mile').input
const raceMonday = mondayOf(hundred.goal.date)
const friday = addDays(hundred.goal.date, -1)

/** The same race on the Monday after: the Saturday and the Sunday before it are easy days. */
const mondayRace: EngineInput = {
  ...hundred,
  goal: { ...hundred.goal, date: addDays(raceMonday, 7) },
}

describe('the race week re-planned with nothing new: the bound counts the cut', () => {
  it('gives the taper week of a Monday race back with a session skipped in advance', () => {
    // the Sunday before a Monday race is the day before it, in the week before; the long run is on the
    // Friday, and a bound that took the largest of the other runs for the cut would add it to the week
    const today = addDays(raceMonday, 1)
    expectStored(replanPasses(mondayRace, today, [addDays(raceMonday, 2)]))
  })

  it('gives the week back when the day before has its own availability limit', () => {
    // Friday 32 minutes: the share-out gives it 32 of the 52 and the cap cuts 12, not the 32 that the
    // other runs hold above the cap (30 shuffles a minute from run to run on a main without the rule)
    const availability = { ...hundred.profile.availability, fri: { available: true, maxMin: 32 } }
    const input = { ...hundred, profile: { ...hundred.profile, availability } }
    expectStored(replanPasses(input, addDays(raceMonday, 1), [addDays(raceMonday, 2)]))
  })

  it.each([0, 10])('gives the week back when a cap of %i minutes drops the run', (cap) => {
    // a cap under the run day minimum leaves the day without a run: the week still has the share of
    // the day to spread, or each pass would spread what is left over the days that remain
    const param = P.k6.dayBeforeMaxMin as { value: number }
    const saved = param.value
    try {
      param.value = cap
      for (const [day, skipped] of [
        [1, []],
        [1, [addDays(raceMonday, 2)]],
        [3, []],
      ] as const) {
        const result = replanPasses(hundred, addDays(raceMonday, day), skipped)
        expect(result.stored.map((r) => r[0])).not.toContain(friday)
        expectStored(result)
      }
    } finally {
      param.value = saved
    }
  })
})

describe('the race week re-planned with a window on the day before', () => {
  it.each([25, 47])('gives the week back with a limited window of %i minutes', (cap) => {
    // the window is known to the stored plan; its limit is above the shake-out, and the share-out
    // meets it before the cap does
    const input = { ...hundred, disruptions: [limited(friday, cap)] }
    const today = addDays(raceMonday, 1)
    expectStored(replanPasses(input, today))
    expectStored(replanPasses(input, today, [addDays(raceMonday, 2)]))
  })

  it('takes only the minutes of the day from a window that is new on the day before', () => {
    // the plan being replaced did not know the window: the day loses its shake-out, and the other
    // runs keep the minutes they had, as they do without the rule
    const today = addDays(raceMonday, 1)
    const rest = replanPasses(hundred, today, [], [resting(friday)])
    expect(rest.stored.map((r) => r[0])).toContain(friday)
    const withoutDay = rest.stored.filter((r) => r[0] !== friday)
    rest.passes.forEach((pass, i) => expect(pass, `pass ${String(i + 1)}`).toEqual(withoutDay))
    // a limit above the shake-out costs nothing: the cap is the lesser of the two
    expectStored(replanPasses(hundred, today, [], [limited(friday, 25)]))
  })

  it('gives the week back with a rest window on the day before', () => {
    const input = { ...hundred, disruptions: [resting(friday)] }
    const today = addDays(raceMonday, 1)
    const result = replanPasses(input, today)
    expect(result.stored.map((r) => r[0])).not.toContain(friday)
    expectStored(result)
  })
})

describe('the week before a Monday race with a window on the Saturday', () => {
  const saturday = addDays(raceMonday, 5)
  const longRun = (list: Run[]) => list.filter((r) => r[1] === 'long')

  it.each([
    ['rest', resting(saturday)],
    ['limited to 25 minutes', limited(saturday, 25)],
  ])('keeps the long run and every other run of the plan: %s', (_, window) => {
    // the Saturday is an easy day: the week holds no long run there, and a window on it takes none
    const without = buildPlan(mondayRace)
    const withWindow = buildPlan({ ...mondayRace, disruptions: [window] })
    expect(longRun(runs(without.sessions, raceMonday, raceMonday)).length).toBe(1)
    expect(runs(withWindow.sessions, raceMonday, raceMonday)).toEqual(
      runs(without.sessions, raceMonday, raceMonday),
    )
    expect(withWindow.checklist.filter((c) => !c.ok).map((c) => c.id)).toEqual([])
  })

  it.each([
    ['rest', resting(saturday)],
    ['limited to 25 minutes', limited(saturday, 25)],
  ])('gives the week back when it is re-planned on the Tuesday: %s', (_, window) => {
    const input = { ...mondayRace, disruptions: [window] }
    expectStored(replanPasses(input, addDays(raceMonday, 1)))
    expectStored(replanPasses(input, addDays(raceMonday, 1), [addDays(raceMonday, 2)]))
  })
})

describe('the week before a Monday race of the marathon athlete', () => {
  // The marathon athlete's taper week holds a long run that the re-plan places longer than the plan did
  // (74 minutes for 63), with the rule off as well; the week the chain re-plans on the Tuesday is not
  // the stored week, and what is asked is that the rule never adds running to it (G6).
  const marathon = athlete('marathon').input
  const input: EngineInput = {
    ...marathon,
    goal: { ...marathon.goal, date: addDays(mondayOf(marathon.goal.date), 7) },
  }

  it('holds no more running to come than the plan it replaces, pass after pass', () => {
    const steps = replanChain(input, { weekday: 1 })
    const last = steps.at(-1)!
    const today = last.input.today
    const monday = mondayOf(today)
    expect(addDays(monday, 7)).toBe(input.goal.date)
    const stored = runs(last.input.existing!.sessions, monday, today)
    const pass1 = runs(last.draft.sessions, monday, today)
    expect(total(pass1)).toBeLessThanOrEqual(total(stored))
    expect(pass1.at(-1)).toEqual([addDays(input.goal.date, -1), 'easy', 20])
  })
})

describe('a method preset: the race week is cut once', () => {
  // The default places the week net of the cut and the preset is held to those minutes [rule G6]; the
  // preset is cut by its own cap, so it is placed at the target whose placement, cut once, totals them
  it.each(['longer-base', 'three-run-days'] as const)(
    'gives the race week of %s back on days 1 to 3',
    (method: PresetId) => {
      for (const id of ['first-100-mile', 'trail-50k']) {
        const a = athlete(id).input
        const input = { ...a, options: { ...a.options, method } }
        const monday = mondayOf(a.goal.date)
        for (const day of [1, 2, 3]) {
          const result = replanPasses(input, addDays(monday, day))
          expect(result.stored.at(-1)![2], `${id} ${method} day ${String(day)}`).toBe(
            P.k6.dayBeforeMaxMin.value,
          )
          expectStored(result)
        }
      }
    },
  )

  it('cuts the day before of every preset once: the other runs are those of the week without the rule', () => {
    const param = P.k6.carbLoadMinRaceMin as { value: number }
    const saved = param.value
    for (const method of ['longer-base', 'three-run-days'] as const) {
      for (const id of ['half', 'marathon', 'trail-50k', 'first-100-mile']) {
        const a = athlete(id).input
        const input = { ...a, options: { ...a.options, method } }
        const monday = mondayOf(a.goal.date)
        const dayBefore = addDays(a.goal.date, -1)
        const week = () => runs(buildPlan(input).sessions, monday, monday)
        const on = week()
        let off: Run[]
        try {
          param.value = Number.POSITIVE_INFINITY
          off = week()
        } finally {
          param.value = saved
        }
        const label = `${method} ${id}`
        expect(
          on.filter((r) => r[0] !== dayBefore),
          label,
        ).toEqual(off.filter((r) => r[0] !== dayBefore))
        expect(total(on), label).toBeLessThanOrEqual(total(off))
      }
    }
  })
})

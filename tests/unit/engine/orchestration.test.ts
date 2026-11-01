// buildPlan, replan, explain, the checklist's failure cases and the entry points of index.ts.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import * as adapt from '../../../shared/engine/adapt.ts'
import * as engine from '../../../shared/engine/index.ts'
import { buildPlan, explain, replan, runChecklist } from '../../../shared/engine/index.ts'
import * as execution from '../../../shared/engine/execution.ts'
import { P } from '../../../shared/engine/params/index.ts'
import * as predict from '../../../shared/engine/predict.ts'
import * as readiness from '../../../shared/engine/readiness.ts'
import type {
  ChecklistResult,
  EngineInput,
  PlanDraft,
  SessionSpec,
} from '../../../shared/engine/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes, TODAY } from './matrix-fixtures.ts'

const all = athletes()
const athlete = (id: string) => all.find((a) => a.id === id)!

type Existing = NonNullable<EngineInput['existing']>

/** The plan as the server would hand it back: every session saved, none yet done. */
function asExisting(plan: PlanDraft, status = 'planned'): Existing {
  return {
    weeks: plan.weeks,
    sessions: plan.sessions.map((s, i) => ({ ...s, id: `s${i}`, status, activityId: null })),
  }
}

const failed = (items: ChecklistResult[]) => items.filter((c) => !c.ok).map((c) => c.id)

describe('explain', () => {
  it('resolves a rule id to its parameters and the papers behind them', () => {
    const [g1] = explain(['g-1'])
    expect(g1!.rule).toBe('g-1')
    expect(g1!.params.map((p) => p.id)).toContain('g1.spikeRatioWarn')
    expect(g1!.papers).toContain('frandsen-2025-session-spike')
    expect(g1!.papers).toEqual([...new Set(g1!.papers)].sort())
  })

  it('matches ids without regard to case, keeps hyphens apart and resolves a repeated id once', () => {
    const out = explain(['g-1', 'G-1', 'H4', 'g-1'])
    expect(out.map((e) => e.rule)).toEqual(['g-1', 'H4'])
    // 'g-3' (tightened profiles) and 'G3' (priors, not optima) are different rules
    expect(explain(['g-3', 'G3']).map((e) => e.rule)).toEqual(['g-3', 'G3'])
  })

  it('returns an empty entry, not an error, for a rule without parameters', () => {
    expect(explain(['nope-9'])).toEqual([{ rule: 'nope-9', params: [], papers: [] }])
  })

  it('finds the grade and note of a rule that has no number in the rules text', () => {
    const [f3] = explain(['F3'])
    expect(f3!.params).toHaveLength(1)
    expect(f3!.params[0]!.grade).toBe('D')
    expect(f3!.params[0]!.note).toMatch(/default/i)
  })
})

describe('buildPlan', () => {
  const half = athlete('half')

  it('returns the contract: weeks, sessions, feasibility, checklist, prediction, zones, version', () => {
    const plan = buildPlan(half.input)
    expect(plan.weeks[0]!.weekStart).toBe(mondayOf(TODAY))
    expect(plan.feasibility.label).toBe('comfortable')
    expect(plan.checklist).toHaveLength(15)
    expect(plan.zones.hr).not.toBeNull()
    expect(plan.paramsVersion).toBe(engine.PARAMS_VERSION)
    expect(plan.sessions).toEqual(
      [...plan.sessions].sort((a, b) =>
        a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1,
      ),
    )
  })

  it('plans the rest of the current week without making up what was not run', () => {
    // History holds no run on the Monday and Tuesday of the current week.
    const plan = buildPlan(half.input)
    const week0 = plan.weeks[0]!
    const minutes = plan.sessions
      .filter((s) => mondayOf(s.date) === week0.weekStart && s.kind !== 'strength')
      .reduce((n, s) => n + s.durationMin, 0)
    expect(minutes).toBeLessThanOrEqual(week0.targetRunMin)
    expect(plan.sessions.every((s) => s.date >= TODAY)).toBe(true)
  })

  it('counts running already done this week toward its target', () => {
    const ran = activity(addDays(mondayOf(TODAY), 1), {
      id: 'run-this-week',
      durationSec: 60 * 60,
      distanceM: 10_000,
    })
    const plain = buildPlan(half.input)
    const withRun = buildPlan({ ...half.input, activities: [...half.input.activities, ran] })
    const sum = (p: PlanDraft) =>
      p.sessions
        .filter((s) => mondayOf(s.date) === mondayOf(TODAY) && s.kind !== 'strength')
        .reduce((n, s) => n + s.durationMin, 0)
    expect(sum(withRun)).toBeLessThan(sum(plain))
    expect(sum(withRun) + 60).toBeLessThanOrEqual(withRun.weeks[0]!.targetRunMin + 1)
  })

  it('has no sessions and a note when the goal date has passed', () => {
    const plan = buildPlan({
      ...half.input,
      goal: { ...half.input.goal, date: addDays(TODAY, -3) },
    })
    expect(plan.weeks).toEqual([])
    expect(plan.sessions).toEqual([])
    expect(plan.warnings.map((w) => w.code)).toContain('goal-in-past')
    expect(failed(plan.checklist)).toEqual([])
  })

  it('holds the checklist from any weekday of the first week', () => {
    for (let shift = 0; shift < 7; shift++) {
      const plan = buildPlan({ ...half.input, today: addDays(TODAY, shift - 2) })
      expect(failed(plan.checklist), `today ${addDays(TODAY, shift - 2)}`).toEqual([])
      expect(plan.sessions.every((s) => s.date >= addDays(TODAY, shift - 2))).toBe(true)
    }
  })

  it('holds the checklist when the race is close', () => {
    for (const id of ['half', 'novice-5k', 'first-100-mile', 'returning']) {
      const a = athlete(id)
      for (const days of [0, 1, 3, 6, 8, 15, 22, 40]) {
        const goal = { ...a.input.goal, date: addDays(TODAY, days) }
        const plan = buildPlan({ ...a.input, goal })
        expect(failed(plan.checklist), `${id} race in ${days} days`).toEqual([])
        expect(plan.sessions.filter((s) => s.kind === 'race').map((s) => s.date)).toEqual([
          goal.date,
        ])
      }
    }
  })

  // The race is the session of its day [rules K2, K3, H12]. The race week used to place a run on the
  // race day, which the race replaces, so a share of its minutes was never run (found by RF1, fixed by
  // RF2); its runs go on the days before the race, and a race early in the week, with fewer days
  // before it than run days, holds fewer runs at the size of the others and not the same minutes on
  // fewer days (a run of 103 minutes the day before a half marathon on a Tuesday).
  it.each([0, 1, 2, 3, 4, 5, 6])(
    'places the runs of the race week on the days before a race on day %i of the week',
    (day) => {
      const monday = mondayOf(half.input.goal.date)
      const date = addDays(monday, day)
      const full = buildPlan(half.input).weeks.find((w) => w.weekStart === monday)!
      const plan = buildPlan({ ...half.input, goal: { ...half.input.goal, date } })
      const week = plan.weeks.find((w) => w.weekStart === monday)!
      const inWeek = plan.sessions.filter((s) => mondayOf(s.date) === monday)
      expect(plan.sessions.filter((s) => s.date === date).map((s) => s.kind)).toEqual(['race'])
      const runs = inWeek.filter(
        (s) => !['strength', 'mobility', 'rest', 'race', 'hike'].includes(s.kind),
      )
      // nothing on the race day or after it but the return steps of the race's window
      expect(runs.every((s) => s.date < date || s.flags.includes('post-race'))).toBe(true)
      const before = runs.filter((s) => s.date < date)
      expect(before).toHaveLength(Math.min(full.runDays, day))
      expect(week.runDays).toBe(Math.min(full.runDays, day))
      // the week holds its minutes, in runs no longer than those of a week with all its days, but
      // for the shake-out of the day before the race (a half marathon runs 90 minutes or more): the
      // cap takes what the run held above it, and the minutes are not made up on the other days
      const share = Math.ceil(full.targetRunMin / full.runDays)
      const held = before.reduce((n, s) => n + s.durationMin, 0)
      expect(held).toBeLessThanOrEqual(week.targetRunMin)
      expect(week.targetRunMin - held).toBeLessThanOrEqual(
        Math.max(0, share - P.k6.dayBeforeMaxMin.value),
      )
      for (const s of before) expect(s.durationMin).toBeLessThanOrEqual(share)
      expect(failed(plan.checklist)).toEqual([])
    },
  )
})

// The last two days before a race of `k6.carbLoadMinRaceMin` minutes or more [rule K6, task RF3]: the
// day before holds at most a shake-out of `k6.dayBeforeMaxMin` minutes, the days before the race
// (`k6.easyDaysBefore`, the day before included) hold easy running only, and what the cap removes is
// not made up on other days. A race early in the week reaches into the week before.
describe('buildPlan: the last two days before a race of 90 minutes or more', () => {
  const half = athlete('half')
  const NOT_RUNS = ['strength', 'mobility', 'rest', 'race', 'hike', 'cross']
  const EASY = ['easy', 'recovery']
  const cap = P.k6.dayBeforeMaxMin.value
  const easyDays = P.k6.easyDaysBefore.value
  const runsOn = (plan: PlanDraft, date: string) =>
    plan.sessions.filter(
      (s) => s.date === date && !NOT_RUNS.includes(s.kind) && !s.flags.includes('post-race'),
    )
  const minutes = (list: SessionSpec[]) => list.reduce((n, s) => n + s.durationMin, 0)
  /** The runs of the race week before the race day. */
  const beforeRace = (plan: PlanDraft, race: string) =>
    plan.sessions.filter(
      (s) =>
        mondayOf(s.date) === mondayOf(race) &&
        s.date < race &&
        !NOT_RUNS.includes(s.kind) &&
        !s.flags.includes('post-race'),
    )
  /** What the rule asks of the days before a race, as a list of what is wrong. */
  const wrongBefore = (plan: PlanDraft, race: string): string[] => {
    const wrong: string[] = []
    const dayBefore = runsOn(plan, addDays(race, -1))
    if (minutes(dayBefore) > cap) wrong.push(`${minutes(dayBefore)} min the day before`)
    for (let k = 1; k <= easyDays; k++) {
      for (const s of runsOn(plan, addDays(race, -k))) {
        if (!EASY.includes(s.kind)) wrong.push(`${s.kind} ${k} day(s) before`)
      }
    }
    return wrong
  }

  it('holds a shake-out the day before a Saturday 100-mile race and does not make up the minutes', () => {
    const a = athlete('first-100-mile')
    const race = a.input.goal.date
    const plan = buildPlan(a.input)
    expect(addDays(mondayOf(race), 5)).toBe(race)
    const week = plan.weeks.find((w) => w.weekStart === mondayOf(race))!
    const friday = runsOn(plan, addDays(race, -1))
    expect(friday.map((s) => s.kind)).toEqual(['easy'])
    expect(minutes(friday)).toBe(cap)
    // the Why drawer of the short run names the rule
    expect(friday[0]!.rules).toContain('K6')
    expect(runsOn(plan, addDays(race, -2)).map((s) => s.kind)).toEqual(['easy'])
    expect(wrongBefore(plan, race)).toEqual([])
    // the four other runs keep the size they had (48 min of the 240 over 5 runs): the 28 minutes
    // the cap removes from Friday are not packed into them, and the figure of the week stays K2's
    const share = Math.ceil(week.targetRunMin / week.runDays)
    const others = beforeRace(plan, race).filter((s) => s.date !== addDays(race, -1))
    expect(others.map((s) => s.durationMin)).toEqual([share, share, share, share])
    expect(minutes(beforeRace(plan, race))).toBe(week.targetRunMin - (share - cap))
    expect(failed(plan.checklist)).toEqual([])
  })

  it('caps the day before a Sunday marathon and leaves the other runs of the week as they are', () => {
    const a = athlete('marathon')
    const race = a.input.goal.date
    const plan = buildPlan(a.input)
    expect(addDays(mondayOf(race), 6)).toBe(race)
    const week = plan.weeks.find((w) => w.weekStart === mondayOf(race))!
    const saturday = runsOn(plan, addDays(race, -1))
    expect(saturday.map((s) => [s.kind, s.durationMin])).toEqual([['easy', cap]])
    const share = Math.ceil(week.targetRunMin / week.runDays)
    expect(share).toBeGreaterThan(cap)
    for (const s of beforeRace(plan, race).filter((r) => r.date < addDays(race, -1))) {
      expect(s.durationMin).toBeLessThanOrEqual(share)
    }
    expect(wrongBefore(plan, race)).toEqual([])
    expect(failed(plan.checklist)).toEqual([])
  })

  it.each([
    [89, false],
    [90, true],
  ])('applies to a race expected to last %i minutes: %s', (min, capped) => {
    const race = { ...half.input.goal, expectedDurationSec: min * 60 }
    const plan = buildPlan({ ...half.input, goal: race })
    const saturday = minutes(runsOn(plan, addDays(race.date, -1)))
    // the threshold is k6.carbLoadMinRaceMin; under it the week is placed as the runs of the race
    // week go (a run of the share of the week on the day before)
    expect(P.k6.carbLoadMinRaceMin.value).toBe(90)
    if (capped) expect(saturday).toBe(cap)
    else expect(saturday).toBeGreaterThan(cap)
  })

  // The days before a Saturday race are Thursday and Friday: a runner who is free on those two days
  // only gets a week of two runs that would have held the strides of the week on Thursday.
  it('keeps the quality session of the race week off the two days before a Saturday race', () => {
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
    const availability = Object.fromEntries(
      days.map((d) => [
        d,
        d === 'thu' || d === 'fri'
          ? half.input.profile.availability[d]
          : { available: false, maxMin: 0 },
      ]),
    ) as typeof half.input.profile.availability
    const race = addDays(mondayOf(half.input.goal.date), 5)
    const plan = buildPlan({
      ...half.input,
      goal: { ...half.input.goal, date: race },
      profile: { ...half.input.profile, availability },
    })
    expect(runsOn(plan, addDays(race, -2)).map((s) => s.kind)).toEqual(['easy'])
    expect(runsOn(plan, addDays(race, -1)).map((s) => s.kind)).toEqual(['easy'])
    expect(minutes(runsOn(plan, addDays(race, -1)))).toBeLessThanOrEqual(cap)
    const week = plan.sessions.filter((s) => mondayOf(s.date) === mondayOf(race))
    expect(week.some((s) => s.kind === 'strides')).toBe(false)
  })

  it.each([0, 1, 2, 3, 4, 5, 6])(
    'keeps the two days before a race on day %i of the week short and easy',
    (day) => {
      const date = addDays(mondayOf(half.input.goal.date), day)
      const plan = buildPlan({ ...half.input, goal: { ...half.input.goal, date } })
      expect(wrongBefore(plan, date)).toEqual([])
      expect(plan.sessions.filter((s) => s.date === date).map((s) => s.kind)).toEqual(['race'])
      expect(failed(plan.checklist)).toEqual([])
    },
  )

  // A race on a Monday or a Tuesday has its day before (and, on a Monday, its second day before) in
  // the last taper week, which places its own runs by the same rule: its long run is not on them.
  it.each([0, 1])('reaches into the week before for a race on day %i of the week', (day) => {
    const date = addDays(mondayOf(half.input.goal.date), day)
    const plan = buildPlan({ ...half.input, goal: { ...half.input.goal, date } })
    const before = addDays(mondayOf(date), -7)
    const lastWeek = plan.sessions.filter((s) => mondayOf(s.date) === before)
    expect(wrongBefore(plan, date)).toEqual([])
    expect(lastWeek.some((s) => s.kind === 'long')).toBe(true)
    const prevDay = addDays(date, -1)
    expect(minutes(runsOn(plan, prevDay))).toBeLessThanOrEqual(cap)
  })

  it('makes the day before a rest day when the cap is 0, without making the minutes up', () => {
    const param = P.k6.dayBeforeMaxMin as { value: number }
    const saved = param.value
    try {
      param.value = 0
      const race = half.input.goal.date
      const plan = buildPlan(half.input)
      const week = plan.weeks.find((w) => w.weekStart === mondayOf(race))!
      expect(runsOn(plan, addDays(race, -1))).toEqual([])
      const share = Math.ceil(week.targetRunMin / week.runDays)
      for (const s of beforeRace(plan, race)) expect(s.durationMin).toBeLessThanOrEqual(share)
      expect(wrongBefore(plan, race)).toEqual([])
      expect(failed(plan.checklist)).toEqual([])
    } finally {
      param.value = saved
    }
  })

  it('reads the number of easy days from k6.easyDaysBefore', () => {
    const param = P.k6.easyDaysBefore as { value: number }
    const saved = param.value
    const date = addDays(mondayOf(half.input.goal.date), 3)
    const input = { ...half.input, goal: { ...half.input.goal, date } }
    const strides = (plan: PlanDraft) =>
      plan.sessions.filter((s) => mondayOf(s.date) === mondayOf(date) && s.kind === 'strides')
    try {
      // a Thursday race: Monday is the third day before it
      expect(strides(buildPlan(input)).map((s) => s.date)).toEqual([addDays(mondayOf(date), 0)])
      param.value = 3
      expect(strides(buildPlan(input))).toEqual([])
    } finally {
      param.value = saved
    }
  })
})

describe('replan', () => {
  const half = athlete('half')
  const plan = buildPlan(half.input)

  it('changes nothing when nothing happened', () => {
    const out = replan({ ...half.input, existing: asExisting(plan) })
    expect(out.changes).toEqual([])
    expect(out.draft.sessions).toEqual(plan.sessions)
    expect(out.draft.weeks).toEqual(plan.weeks)
  })

  describe('a week later', () => {
    const later = addDays(TODAY, 7)
    const thisMonday = mondayOf(later)
    // The runner followed the plan: every planned session before `later` became an activity.
    const done = plan.sessions
      .filter((s) => s.date < later && s.kind !== 'strength')
      .map((s) =>
        activity(s.date, {
          id: `done-${s.date}`,
          durationSec: s.durationMin * 60,
          distanceM: s.distanceM ?? s.durationMin * 170,
        }),
      )
    const skippedDate = addDays(thisMonday, 3)
    const base: EngineInput = {
      ...half.input,
      today: later,
      activities: [...half.input.activities, ...done],
    }
    const old = asExisting(plan)
    const existing: Existing = {
      weeks: old.weeks,
      sessions: old.sessions.map((s) =>
        s.date < later
          ? { ...s, status: 'completed' }
          : s.date === skippedDate
            ? { ...s, status: 'skipped' }
            : s,
      ),
    }
    const out = replan({ ...base, existing })

    it('keeps every session before today exactly as it was', () => {
      const before = (list: SessionSpec[]) => list.filter((s) => s.date < later)
      const stripped = existing.sessions.map(
        ({ id: _id, status: _status, activityId: _activity, ...spec }) => spec,
      )
      expect(before(out.draft.sessions)).toEqual(before(stripped))
    })

    it('keeps the past weeks and continues their indexes', () => {
      const past = out.draft.weeks.filter((w) => w.weekStart < thisMonday)
      expect(past).toEqual(existing.weeks.filter((w) => w.weekStart < thisMonday))
      const indexes = out.draft.weeks.map((w) => w.index)
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
      expect(new Set(indexes).size).toBe(indexes.length)
    })

    it('keeps the recovery weeks where the replaced plan had them, the current week included', () => {
      const flags = (weeks: PlanDraft['weeks']) =>
        weeks.filter((w) => w.weekStart >= thisMonday).map((w) => [w.weekStart, w.isRecovery])
      expect(plan.weeks.find((w) => w.weekStart === thisMonday)!.isRecovery).toBe(true)
      expect(flags(out.draft.weeks)).toEqual(flags(plan.weeks))
    })

    it('keeps a finished session of the current week and plans nothing else on its day', () => {
      const kept = out.draft.sessions.filter((s) => s.date === skippedDate)
      expect(kept.map((s) => s.kind)).toEqual(
        existing.sessions.filter((s) => s.date === skippedDate).map((s) => s.kind),
      )
    })

    it('lists changes only from the current week on, each with rule ids', () => {
      expect(out.changes.every((c) => c.weekStart >= thisMonday)).toBe(true)
      expect(out.changes.every((c) => c.rules.length > 0)).toBe(true)
      for (const c of out.changes) expect(c.from).not.toEqual(c.to)
    })

    it('passes the checklist', () => {
      expect(failed(out.draft.checklist)).toEqual([])
    })

    it('is deterministic', () => {
      expect(replan({ ...structuredClone(base), existing: structuredClone(existing) })).toEqual(out)
    })
  })

  it('re-plans on the day a session is finished without counting that run twice', () => {
    // The session planned for today is done and its activity stored; nothing else changed.
    for (const id of ['prior-bsi', 'half', 'masters']) {
      const a = athlete(id)
      const built = buildPlan(a.input)
      const week = (list: SessionSpec[]) =>
        list.filter(
          (s) => mondayOf(s.date) === mondayOf(TODAY) && s.kind !== 'strength' && s.kind !== 'race',
        )
      const first = week(built.sessions)[0]!
      const ran = activity(first.date, {
        id: 'done-today',
        durationSec: first.durationMin * 60,
        distanceM: first.durationMin * 170,
      })
      const old = asExisting(built)
      const out = replan({
        ...a.input,
        today: first.date,
        activities: [...a.input.activities, ran],
        existing: {
          weeks: old.weeks,
          sessions: old.sessions.map((s) =>
            s.date === first.date && s.order === first.order ? { ...s, status: 'completed' } : s,
          ),
        },
      })
      expect(failed(out.draft.checklist), id).toEqual([])
      // The finished run and its activity use one run day: the rest of the week keeps its runs.
      expect(week(out.draft.sessions).length, id).toBe(week(built.sessions).length)
    }
  })

  it('lowers the coming weeks after a week that was mostly missed and never makes it up', () => {
    const later = addDays(TODAY, 7)
    // Only one short run was done in the week; the plan asked for far more.
    const one = activity(addDays(TODAY, 1), {
      id: 'only-run',
      durationSec: 30 * 60,
      distanceM: 5000,
    })
    const old = asExisting(plan)
    const input: EngineInput = {
      ...half.input,
      today: later,
      activities: [...half.input.activities, one],
      existing: {
        weeks: old.weeks,
        sessions: old.sessions.map((s) => (s.date < later ? { ...s, status: 'skipped' } : s)),
      },
    }
    const out = replan(input)
    const minutes = out.changes.filter((c) => c.field === 'plannedMin')
    // The week after the miss is cut, with the never-make-up rule behind it.
    const cut = minutes.filter((c) => Number(c.to) < Number(c.from))
    expect(cut.length).toBeGreaterThan(0)
    expect(cut.some((c) => c.rules.includes('g-6'))).toBe(true)
    // No week is above the plan it replaces: nothing is added to make up the miss.
    for (const c of minutes) expect(Number(c.to)).toBeLessThanOrEqual(Number(c.from))
    expect(failed(out.draft.checklist)).toEqual([])
  })
})

describe('a sparse history and the restart floor', () => {
  const sparse = athlete('sparse-100-mile')
  const plan = buildPlan(sparse.input)
  const monday = mondayOf(TODAY)
  const runsIn = (list: SessionSpec[], weekStart: string) =>
    list.filter((s) => mondayOf(s.date) === weekStart && s.kind !== 'strength' && s.kind !== 'race')

  it('opens with the floor week: three runs of at least 20 min, an info warning, a clean checklist', () => {
    const first = runsIn(plan.sessions, monday)
    expect(first).toHaveLength(3)
    expect(Math.min(...first.map((s) => s.durationMin))).toBeGreaterThanOrEqual(20)
    expect(plan.weeks[0]!.flags).toContain('restart-floor')
    expect(plan.warnings.find((w) => w.code === 'restart-floor')?.severity).toBe('info')
    expect(failed(plan.checklist)).toEqual([])
  })

  it('exempts only the flagged week: the checklist still fails a week above the ramp after it', () => {
    const copy = structuredClone(plan)
    const second = addDays(monday, 14)
    for (const s of copy.sessions) if (mondayOf(s.date) === second) s.durationMin *= 3
    expect(failed(runChecklist(copy, sparse.input))).toContain('progression')

    const unflagged = structuredClone(plan)
    unflagged.weeks[0]!.flags = unflagged.weeks[0]!.flags.filter((f) => f !== 'restart-floor')
    const ids = failed(runChecklist(unflagged, sparse.input))
    expect(ids).toEqual(expect.arrayContaining(['progression', 'break-restart']))
  })

  it('keeps every week of a re-plan a week later at two or more runs, without collapsing', () => {
    const later = addDays(TODAY, 7)
    const done = plan.sessions
      .filter((s) => s.date < later && s.kind !== 'strength')
      .map((s) =>
        activity(s.date, {
          id: `done-${s.date}`,
          durationSec: s.durationMin * 60,
          distanceM: s.distanceM ?? s.durationMin * 170,
        }),
      )
    const out = replan({
      ...sparse.input,
      today: later,
      activities: [...sparse.input.activities, ...done],
      existing: {
        weeks: plan.weeks,
        sessions: asExisting(plan).sessions.map((s) =>
          s.date < later ? { ...s, status: 'completed' } : s,
        ),
      },
    })
    expect(failed(out.draft.checklist)).toEqual([])
    const weeks = out.draft.weeks.filter(
      (w) => w.weekStart > mondayOf(later) && w.targetRunMin > 0 && !w.flags.includes('race-week'),
    )
    for (const w of weeks.filter((x) => !x.isTaper && !x.flags.includes('post-race'))) {
      expect(runsIn(out.draft.sessions, w.weekStart).length, w.weekStart).toBeGreaterThanOrEqual(2)
    }
  })

  it('says so once when fewer run days are open than planned', () => {
    const closed = structuredClone(sparse.input)
    for (const day of ['mon', 'tue', 'thu', 'fri'] as const) {
      closed.profile.availability[day] = { available: false, maxMin: null }
    }
    const out = buildPlan(closed)
    const notes = out.warnings.filter((w) => w.code === 'availability-limits-runs')
    expect(notes).toHaveLength(1)
    expect(notes[0]!.rules).toContain('F5')
    expect(failed(out.checklist)).toEqual([])
  })
})

describe('the checklist fails on a plan that breaks its rule', () => {
  const clone = (plan: PlanDraft): PlanDraft => structuredClone(plan)
  const failedIds = (plan: PlanDraft, input: EngineInput) => failed(runChecklist(plan, input))

  it('progression: a week three times its neighbours', () => {
    const a = athlete('half')
    const plan = clone(buildPlan(a.input))
    const week = plan.weeks[6]!.weekStart
    for (const s of plan.sessions) if (mondayOf(s.date) === week) s.durationMin *= 3
    expect(failedIds(plan, a.input)).toContain('progression')
  })

  it('recovery cadence: no recovery week at all', () => {
    const a = athlete('marathon')
    const plan = clone(buildPlan(a.input))
    for (const w of plan.weeks) w.isRecovery = false
    expect(failedIds(plan, a.input)).toContain('recovery-cadence')
  })

  it('tid: a week with 60% zone 1', () => {
    const a = athlete('half')
    const plan = clone(buildPlan(a.input))
    plan.weeks[3]!.tid = { z1: 60, z2: 25, z3: 15 }
    expect(failedIds(plan, a.input)).toContain('tid')
  })

  it('taper: a taper week that does not fall', () => {
    const a = athlete('half')
    const plan = clone(buildPlan(a.input))
    const taper = plan.weeks.filter((w) => w.isTaper)
    taper[1]!.targetRunMin = taper[0]!.targetRunMin + 10
    expect(failedIds(plan, a.input)).toContain('taper')
  })

  it('level differentiation: a novice with a fourth run day', () => {
    const a = athlete('novice-5k')
    const plan = clone(buildPlan(a.input))
    const date = addDays(plan.weeks[2]!.weekStart, 1)
    const template = plan.sessions.find((s) => s.kind === 'easy')!
    plan.sessions.push({ ...template, date: addDays(date, 0), order: 0 })
    plan.sessions.push({ ...template, date: addDays(date, 2), order: 0 })
    expect(failedIds(plan, a.input)).toContain('level-differentiation')
  })

  it('break restart: a first week back at the pre-break volume', () => {
    const a = athlete('returning')
    const plan = clone(buildPlan(a.input))
    for (const s of plan.sessions) if (mondayOf(s.date) === mondayOf(TODAY)) s.durationMin *= 3
    expect(failedIds(plan, a.input)).toContain('break-restart')
  })

  it('spike guard: a run that needs an override', () => {
    const a = athlete('half')
    const plan = clone(buildPlan(a.input))
    plan.sessions.find((s) => s.kind === 'long')!.flags.push('override-required')
    expect(failedIds(plan, a.input)).toContain('spike-guard')
  })

  it('spike guard: a warn-band run under the recent-injury hard limit', () => {
    const a = athlete('prior-bsi')
    const plan = clone(buildPlan(a.input))
    plan.sessions.find((s) => s.kind === 'long')!.flags.push('spike-warn')
    expect(failedIds(plan, a.input)).toContain('spike-guard')
  })

  it('availability: a run on a closed day', () => {
    const a = athlete('masters')
    const plan = clone(buildPlan(a.input))
    const run = plan.sessions.find((s) => s.kind === 'easy' && s.date > addDays(TODAY, 7))!
    run.date = mondayOf(run.date) // Monday is closed for this runner
    expect(failedIds(plan, a.input)).toContain('availability')
  })

  it('spacing: two threshold sessions on consecutive days', () => {
    const a = athlete('marathon')
    const plan = clone(buildPlan(a.input))
    const first = plan.sessions.find((s) => s.kind === 'threshold')!
    const template = { ...first, date: addDays(first.date, 1) }
    plan.sessions.push(template)
    expect(failedIds(plan, a.input)).toContain('spacing')
  })

  it('spacing: the long run between two quality days', () => {
    const a = athlete('half')
    const plan = clone(buildPlan(a.input))
    const long = plan.sessions.find((s) => s.kind === 'long' && s.date > TODAY)!
    const quality = plan.sessions.find((s) => s.kind === 'race-pace' || s.kind === 'threshold')!
    plan.sessions.push(
      { ...quality, date: addDays(long.date, -1) },
      { ...quality, date: addDays(long.date, 1) },
    )
    expect(failedIds(plan, a.input)).toContain('spacing')
  })

  it('ultra caps: a six-hour-plus run and a pair with a longer second day', () => {
    const a = athlete('first-100-mile')
    const plan = clone(buildPlan(a.input))
    plan.sessions.find((s) => s.kind === 'long')!.durationMin = 500
    expect(failedIds(plan, a.input)).toContain('ultra-caps')
    const plan2 = clone(buildPlan(a.input))
    const day2 = plan2.sessions.find((s) => s.flags.includes('b2b-day2'))!
    day2.durationMin = 400
    expect(failedIds(plan2, a.input)).toContain('ultra-caps')
  })

  it('race day: the race missing', () => {
    const a = athlete('half')
    const plan = clone(buildPlan(a.input))
    plan.sessions = plan.sessions.filter((s) => s.kind !== 'race')
    expect(failedIds(plan, a.input)).toContain('race-day')
  })

  it('race day: a run in the hold, a run over its step cap and quality work before the window ends', () => {
    const a = athlete('first-100-mile')
    const plan = clone(buildPlan(a.input))
    const race = a.input.goal.date
    expect(plan.checklist.find((c) => c.id === 'race-day')?.detail).toMatch(
      /15 days without running/,
    )
    const easy = plan.sessions.find((s) => s.kind === 'recovery' && s.date > race)!
    const template = { ...easy, durationMin: 30, flags: [] as SessionSpec['flags'] }
    // 100 miles with no earlier finish: the hold runs 15 days after the race
    const inHold = clone(plan)
    inHold.sessions.push({ ...template, date: addDays(race, 3) })
    const hold = runChecklist(inHold, a.input).find((c) => c.id === 'race-day')!
    expect(hold.ok).toBe(false)
    expect(hold.detail).toMatch(/inside the hold/)
    const over = clone(plan)
    over.sessions.find((s) => s.kind === 'recovery' && s.date > race)!.durationMin = 55
    expect(failedIds(over, a.input)).toContain('race-day')
    const hard = clone(plan)
    hard.sessions.push({ ...template, kind: 'threshold', date: addDays(race, 26) })
    expect(runChecklist(hard, a.input).find((c) => c.id === 'race-day')?.detail).toMatch(
      /before the end of the post-race window/,
    )
  })

  it('post-race window: a plan built inside a window needs the hold, the caps and no quality', () => {
    const a = athlete('first-100-mile')
    const input: EngineInput = {
      ...a.input,
      activities: [
        ...a.input.activities,
        activity(addDays(TODAY, -5), {
          id: 'just-raced',
          type: 'race',
          durationSec: 108_000,
          distanceM: 160_934,
        }),
      ],
    }
    const plan = clone(buildPlan(input))
    expect(failed(plan.checklist)).toEqual([])
    const run = plan.sessions.find((s) => s.kind === 'recovery')!
    const early = clone(plan)
    early.sessions.push({ ...run, date: TODAY })
    expect(failedIds(early, input)).toContain('post-race-window')
    const hard = clone(plan)
    hard.sessions.push({ ...run, kind: 'intervals', date: addDays(run.date, 14) })
    expect(failedIds(hard, input)).toContain('post-race-window')
  })

  it('reds hold: a plan that grows or pairs long runs under two or more flags', () => {
    const a = athlete('first-100-mile')
    const grown = buildPlan(a.input)
    expect(grown.checklist.find((c) => c.id === 'reds-hold')?.ok).toBe(true)
    const flagged = { ...a.input, screeningFlags: 2 }
    const items = runChecklist(grown, flagged)
    const hold = items.find((c) => c.id === 'reds-hold')!
    expect(hold.ok).toBe(false)
    expect(hold.rules).toContain('n-4')
    // the same plan passes with one flag only
    expect(failed(runChecklist(grown, { ...a.input, screeningFlags: 1 }))).toEqual([])
  })

  it('states the break length and the flag count of its pass lines from the Params', () => {
    const a = athlete('half')
    const plan = buildPlan(a.input)
    const detail = (id: string) => runChecklist(plan, a.input).find((c) => c.id === id)!.detail
    expect(detail('break-restart')).toBe('No break of 7 days or more before the plan.')
    expect(detail('reds-hold')).toBe('No energy-availability hold: fewer than 2 flags.')
    const before = { tier1Days: P.j7.tier1Days.value, redsHoldFlags: P.j5.redsHoldFlags.value }
    try {
      P.j7.tier1Days.value = 10
      P.j5.redsHoldFlags.value = 3
      expect(detail('break-restart')).toBe('No break of 10 days or more before the plan.')
      expect(detail('reds-hold')).toBe('No energy-availability hold: fewer than 3 flags.')
    } finally {
      P.j7.tier1Days.value = before.tier1Days
      P.j5.redsHoldFlags.value = before.redsHoldFlags
    }
  })

  it('returns a result per item with the rules it rests on', () => {
    const a = athlete('half')
    for (const item of runChecklist(buildPlan(a.input), a.input)) {
      expect(item.detail.length).toBeGreaterThan(0)
      expect(item.rules.length).toBeGreaterThan(0)
    }
  })
})

describe('REDs hold at build time and re-plan', () => {
  const a = athlete('reds-hold')
  const codes = (p: PlanDraft) => p.warnings.map((w) => w.code)

  it('buildPlan holds progression and says so once, with a clinician prompt', () => {
    const plan = buildPlan(a.input)
    expect(codes(plan).filter((c) => c === 'reds-hold')).toHaveLength(1)
    const warning = plan.warnings.find((w) => w.code === 'reds-hold')!
    expect(warning.severity).toBe('hold')
    expect(warning.message).toMatch(/clinician/i)
    expect(failed(plan.checklist)).toEqual([])
  })

  it('replan holds too, from the screening in the input', () => {
    const plan = buildPlan(a.input)
    const later = addDays(TODAY, 7)
    const out = replan({
      ...a.input,
      today: later,
      existing: {
        weeks: plan.weeks,
        sessions: asExisting(plan).sessions.map((s) =>
          s.date < later ? { ...s, status: 'completed' } : s,
        ),
      },
    })
    expect(codes(out.draft)).toContain('reds-hold')
    expect(failed(out.draft.checklist)).toEqual([])
    const loading = out.draft.weeks.filter(
      (w) =>
        w.weekStart >= mondayOf(later) &&
        !w.isRecovery &&
        !w.isTaper &&
        !w.flags.includes('post-race'),
    )
    for (const w of loading) expect(w.targetRunMin).toBeLessThanOrEqual(loading[0]!.targetRunMin)
    expect(out.draft.sessions.some((s) => s.date >= later && s.flags.includes('b2b-day1'))).toBe(
      false,
    )
  })

  it('one flag leaves the plan as it was', () => {
    const open = buildPlan({ ...a.input, screeningFlags: 0 })
    expect(buildPlan({ ...a.input, screeningFlags: 1 })).toEqual(open)
    expect(codes(open)).not.toContain('reds-hold')
  })
})

describe('entry points', () => {
  it('delegate to the modules that own the rules', () => {
    expect(engine.assessExecution).toBe(execution.assessExecution)
    expect(engine.matchSessions).toBe(execution.matchSessions)
    expect(engine.todayAdvice).toBe(readiness.todayAdvice)
    expect(engine.weeklyDecision).toBe(adapt.weeklyDecision)
    expect(engine.zoneProposals).toBe(adapt.zoneProposals)
    expect(engine.predictRace).toBe(predict.predictRace)
  })

  it('advises a planned session as planned when nothing speaks against it', () => {
    const a = athlete('half')
    const plan = buildPlan(a.input)
    const today = plan.sessions
      .filter((s) => s.date === TODAY)
      .map((s, i) => ({ ...s, id: `t${i}` }))
    expect(today.length).toBeGreaterThan(0)
    const advice = engine.todayAdvice(a.input, today)
    expect(advice.map((x) => x.advice)).toEqual(today.map(() => 'as-planned'))
  })

  it('decides a week from the input and gives a next-week target within the ramp', () => {
    const a = athlete('half')
    const decision = engine.weeklyDecision(a.input, addDays(mondayOf(TODAY), -7))
    expect(['progress', 'hold', 'reduce']).toContain(decision.decision)
    expect(decision.nextWeekTargetMin).toBeGreaterThan(0)
  })
})

// The race week of a race of 90 minutes or more, re-planned on a day of it with the days before run as
// planned: the day before the race is still the shake-out, and the figure of the week is still K2's
// [rules K6, K2, G-6].
describe('replan: the shake-out of the race week', () => {
  const a = athlete('first-100-mile')
  const first = buildPlan(a.input)
  const race = a.input.goal.date
  const monday = mondayOf(race)
  const cap = P.k6.dayBeforeMaxMin.value
  const NOT_RUNS = ['strength', 'mobility', 'rest', 'race', 'hike', 'cross']

  it.each([1, 2, 3, 4])(
    'keeps the day before the race short when the week is re-planned on day %i',
    (day) => {
      const today = addDays(monday, day)
      const done = first.sessions
        .filter((s) => s.date < today && !NOT_RUNS.includes(s.kind))
        .map((s) =>
          activity(s.date, {
            id: `done-${s.date}`,
            durationSec: s.durationMin * 60,
            distanceM: s.distanceM ?? s.durationMin * 170,
          }),
        )
      const old = asExisting(first)
      const existing: Existing = {
        weeks: old.weeks,
        sessions: old.sessions.map((s) => (s.date < today ? { ...s, status: 'completed' } : s)),
      }
      const out = replan({
        ...a.input,
        today,
        activities: [...a.input.activities, ...done],
        existing,
      })
      const runs = out.draft.sessions.filter(
        (s) => mondayOf(s.date) === monday && !NOT_RUNS.includes(s.kind) && s.date < race,
      )
      const dayBefore = runs.filter((s) => s.date === addDays(race, -1))
      expect(dayBefore.map((s) => [s.kind, s.durationMin])).toEqual([['easy', cap]])
      // the figure of the week is the one of the plan it replaces, and no run is above its share
      const figure = (p: PlanDraft) => p.weeks.find((w) => w.weekStart === monday)!.targetRunMin
      expect(figure(out.draft)).toBe(figure(first))
      const share = Math.ceil(
        figure(first) / first.weeks.find((w) => w.weekStart === monday)!.runDays,
      )
      for (const s of runs) expect(s.durationMin).toBeLessThanOrEqual(share)
      expect(failed(out.draft.checklist)).toEqual([])
    },
  )
})

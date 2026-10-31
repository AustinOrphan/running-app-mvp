// The plan matrix at every method preset [rules P1 to P4, task M5 of the sources, methods and
// evaluation proposal]: the twelve athletes of the matrix asked for `three-run-days` and for
// `longer-base`. Each plan passes the checklist and keeps every limit the default keeps (the checks
// of `matrix-checks.ts`, each re-derived from the finished sessions with literals), the run-day cap
// holds where P2 applies, the base is as long as P4 says where P4 applies, and a preset that reads
// the default says why and plans the default. The tables below are literals on purpose: a change of
// a reading, a base length or a run-day count is a change of what a preset does to a runner.
//
// Every preset is grade D, a choice and not a better plan: nothing here compares a preset's plan
// with the default's for being better, only for being the plan it says it is, inside every limit.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import type { PlanDraft, PresetId, SessionKind, SessionSpec } from '../../../shared/engine/types.ts'
import { problemsOf, windowOf } from './disruption-fixtures.ts'
import { CHECKLIST_IDS, describePlanMatrix, planWeeks } from './matrix-checks.ts'
import { athletes, TODAY, type MatrixAthlete } from './matrix-fixtures.ts'
import {
  aboveDefault,
  maxRunDays,
  OFFERED,
  positionOf,
  QUALITY_KINDS,
  text,
  withMethod,
} from './method-fixtures.ts'

const all = athletes()
const defaults = new Map(all.map((a) => [a.id, buildPlan(a.input)]))
type Offered = (typeof OFFERED)[number]

/** What the resolver says of each athlete: `applies`, or why the preset reads the default. */
type Reading =
  'applies' | 'not-applicable' | 'novice' | 'no-base' | 'held:recent-injury' | 'held:reds-hold'

const READING: Record<Offered, Record<string, Reading>> = {
  // goals of 5 km to the half marathon only; a novice keeps the novice days; a recent injury holds it
  'three-run-days': {
    'novice-5k': 'novice',
    half: 'applies',
    marathon: 'not-applicable',
    'trail-50k': 'not-applicable',
    'first-100-mile': 'not-applicable',
    masters: 'not-applicable',
    returning: 'applies',
    'prior-bsi': 'held:recent-injury',
    'hot-race': 'not-applicable',
    'sparse-100-mile': 'not-applicable',
    'reds-hold': 'not-applicable',
    'post-marathon-short-run': 'applies',
  },
  // every class; a plan with no base week of its own reads the default (a ladder that covers the
  // base, a novice plan with no base), and so does a plan held by a persistent condition
  'longer-base': {
    'novice-5k': 'no-base',
    half: 'applies',
    marathon: 'applies',
    'trail-50k': 'applies',
    'first-100-mile': 'applies',
    masters: 'applies',
    returning: 'applies',
    'prior-bsi': 'held:recent-injury',
    'hot-race': 'applies',
    'sparse-100-mile': 'applies',
    'reds-hold': 'held:reds-hold',
    'post-marathon-short-run': 'no-base',
  },
}

/** Base weeks of the default plan and of `longer-base`, by athlete, where the preset applies. */
const BASE_WEEKS: Record<string, [default_: number, preset: number]> = {
  half: [3, 5],
  marathon: [4, 6],
  'trail-50k': [4, 6],
  'first-100-mile': [13, 15],
  masters: [2, 4],
  returning: [4, 6],
  'hot-race': [9, 11],
  'sparse-100-mile': [17, 19],
}

/** The most run days a week holds in the default plan and under `three-run-days`, where it applies. */
const RUN_DAYS: Record<string, [default_: number, preset: number]> = {
  half: [5, 3],
  returning: [4, 3],
  'post-marathon-short-run': [3, 3],
}

const subjectsOf = (method: Offered) =>
  all.map((athlete) => {
    const input = withMethod(athlete.input, method)
    const plan = buildPlan(input)
    const applies = READING[method][athlete.id] === 'applies'
    return {
      athlete: { ...athlete, input },
      plan,
      // the F5 floors (4 run days from 3 h, 5 from 5 h) give way to the cap of P2
      ...(method === 'three-run-days' && applies ? { runDayCap: 3 } : {}),
    }
  })

for (const method of OFFERED) {
  describePlanMatrix(subjectsOf(method), `plan matrix at ${method}`, `plan adequacy at ${method}`)
}

/** Weeks of a phase, the weeks after the race left out. */
const inPhase = (plan: PlanDraft, phase: string) =>
  plan.weeks.filter((w) => w.phase === phase && !w.flags.includes('post-race'))

describe.each(OFFERED)('the matrix at %s', (method) => {
  const planned = new Map(
    all.map((a) => {
      const input = withMethod(a.input, method)
      return [a.id, { input, plan: buildPlan(input) }] as const
    }),
  )
  const of = (a: MatrixAthlete) => planned.get(a.id)!

  it('reads the preset as the table says, with the reason where it reads the default', () => {
    const read = Object.fromEntries(
      all.map((a) => {
        const { input, plan } = of(a)
        const position = positionOf(input, plan)
        expect(position.requested, a.id).toBe(method)
        return [a.id, position.reason === null ? 'applies' : position.reason]
      }),
    )
    expect(read).toEqual(READING[method])
  })

  it('passes every checklist item, as the default does, and keeps the race', () => {
    for (const a of all) {
      const { plan } = of(a)
      expect(
        plan.checklist.map((c) => c.id),
        a.id,
      ).toEqual(CHECKLIST_IDS)
      expect(
        plan.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`),
        a.id,
      ).toEqual([])
      expect(
        plan.sessions.filter((s) => s.kind === 'race').map((s) => s.date),
        a.id,
      ).toEqual([a.input.goal.date])
      expect(plan.weeks, a.id).toHaveLength(defaults.get(a.id)!.weeks.length)
    }
  })

  it('plans the default plan for a runner it reads as the default, and a different plan for one it applies to', () => {
    for (const a of all) {
      const same = text(of(a).plan) === text(defaults.get(a.id)!)
      const reading = READING[method][a.id]
      // a ladder that runs the days of the cap already (post-marathon-short-run at three-run-days)
      // leaves the preset nothing to change
      const unchanged = reading !== 'applies' || a.id === 'post-marathon-short-run'
      expect(same, `${a.id} (${reading})`).toBe(unchanged)
    }
  })

  it('adds no minute and no week target above the default plan, and keeps the post-race weeks', () => {
    for (const a of all) {
      expect(aboveDefault(defaults.get(a.id)!, of(a).plan), a.id).toEqual([])
      const post = (p: PlanDraft) => p.weeks.filter((w) => w.flags.includes('post-race')).length
      expect(post(of(a).plan), a.id).toBe(post(defaults.get(a.id)!))
    }
  })

  it('holds a rest window to the invariants of the window, and the preset reads as it did without one', () => {
    // a three-day illness starting in two days: rest through the symptom-free day, easy running after
    const window = windowOf({
      reason: 'illness-above-neck',
      startDate: addDays(TODAY, 2),
      endDate: addDays(TODAY, 4),
    })
    for (const a of all) {
      const { input, plan } = of(a)
      const withWindow = { ...input, disruptions: [window] }
      const windowed = buildPlan(withWindow)
      expect(problemsOf(a, [window], windowed, plan), a.id).toEqual([])
      expect(
        windowed.checklist.map((c) => c.id),
        a.id,
      ).toEqual([...CHECKLIST_IDS, 'disruption-window'])
      // a rest window is transient: it does not hold the preset, so the reading is the same
      expect(positionOf(withWindow, windowed), a.id).toEqual(positionOf(input, plan))
    }
  })
})

describe('three-run-days [rule P2]', () => {
  const applied = all.filter((a) => READING['three-run-days'][a.id] === 'applies')

  it('names the three athletes it applies to', () => {
    expect(applied.map((a) => a.id)).toEqual(['half', 'returning', 'post-marathon-short-run'])
  })

  it('holds every week to three run days where it applies, and the default holds more somewhere', () => {
    for (const a of applied) {
      const plan = buildPlan(withMethod(a.input, 'three-run-days'))
      const base = defaults.get(a.id)!
      expect([maxRunDays(base), maxRunDays(plan)], a.id).toEqual(RUN_DAYS[a.id])
      expect(maxRunDays(plan), a.id).toBeLessThanOrEqual(3)
      for (const week of plan.weeks)
        expect(week.runDays, `${a.id} ${week.weekStart}`).toBeLessThanOrEqual(3)
    }
    // the check is not vacuous: two of the three plans run more days at the default
    expect(applied.filter((a) => maxRunDays(defaults.get(a.id)!) > 3).map((a) => a.id)).toEqual([
      'half',
      'returning',
    ])
  })

  it('keeps the long run and the quality sessions of the default, so a week holds fewer easy runs', () => {
    // P2 keeps the other values: the quality sessions, the long run and every phase are the default's
    const kinds = (plan: PlanDraft, kinds: ReadonlySet<SessionKind>) =>
      plan.sessions.filter((s) => kinds.has(s.kind)).length
    const LONG = new Set<SessionKind>(['long', 'long-fast-finish', 'b2b'])
    for (const a of applied) {
      const plan = buildPlan(withMethod(a.input, 'three-run-days'))
      const base = defaults.get(a.id)!
      expect(
        plan.weeks.map((w) => w.phase),
        a.id,
      ).toEqual(base.weeks.map((w) => w.phase))
      expect(kinds(plan, LONG), a.id).toBe(kinds(base, LONG))
      // no week gains a quality session, and every week keeps a long run where the default has one
      for (const week of plan.weeks) {
        const before = base.weeks.find((w) => w.weekStart === week.weekStart)!
        expect(week.qualitySessions, `${a.id} ${week.weekStart}`).toBeLessThanOrEqual(
          before.qualitySessions,
        )
      }
      expect(kinds(plan, QUALITY_KINDS), a.id).toBeLessThanOrEqual(kinds(base, QUALITY_KINDS))
    }
  })
})

describe('longer-base [rule P4]', () => {
  const applied = all.filter((a) => READING['longer-base'][a.id] === 'applies')
  const planOf = (a: MatrixAthlete) => buildPlan(withMethod(a.input, 'longer-base'))
  const weekOf = (plan: PlanDraft) => new Map(plan.weeks.map((w) => [w.weekStart, w]))

  it('names the eight athletes it applies to', () => {
    expect(applied.map((a) => a.id).sort()).toEqual(Object.keys(BASE_WEEKS).sort())
  })

  it('shortens the build to 4 weeks and gives the weeks to the base, up to 2 weeks more', () => {
    for (const a of applied) {
      const plan = planOf(a)
      const base = defaults.get(a.id)!
      const [before, after] = BASE_WEEKS[a.id]!
      expect([inPhase(base, 'base').length, inPhase(plan, 'base').length], a.id).toEqual([
        before,
        after,
      ])
      expect(inPhase(plan, 'build').length, a.id).toBe(4)
      expect(inPhase(base, 'build').length, a.id).toBe(6)
      expect(after - before, a.id).toBeLessThanOrEqual(2)
      // the specific phase, the taper and the race week are the default's
      for (const phase of ['specific', 'taper', 'race']) {
        expect(inPhase(plan, phase).length, `${a.id} ${phase}`).toBe(inPhase(base, phase).length)
      }
    }
  })

  it('holds strides only in the base weeks, and threshold and hills, never intervals, in the build', () => {
    let build = 0
    let hills = 0
    for (const a of applied) {
      const plan = planOf(a)
      const weeks = weekOf(plan)
      for (const s of plan.sessions) {
        const week = weeks.get(mondayOf(s.date))
        if (week === undefined || week.flags.includes('post-race') || !QUALITY_KINDS.has(s.kind)) {
          continue
        }
        if (week.phase === 'base') expect(s.kind, `${a.id} ${s.date}`).toBe('strides')
        if (week.phase === 'build') {
          build += 1
          if (s.kind === 'hills') hills += 1
          expect(['threshold', 'hills'], `${a.id} ${s.date}`).toContain(s.kind)
        }
      }
    }
    // the checks ran over many sessions, and hills are used where a week holds two
    expect(build).toBeGreaterThan(20)
    expect(hills).toBeGreaterThan(5)
  })

  it('opens every quality day of a build week with threshold: a one-session week keeps the default stimulus', () => {
    // the order of the build row (section (p), decided in task M5): the first quality session of a
    // build week is threshold, so a runner with one session a week has no week of hills alone
    let single = 0
    for (const a of applied) {
      const plan = planOf(a)
      for (const week of inPhase(plan, 'build')) {
        const sessions: SessionSpec[] = plan.sessions
          .filter((s) => mondayOf(s.date) === week.weekStart && QUALITY_KINDS.has(s.kind))
          .sort((x, y) => (x.date < y.date ? -1 : 1))
        if (sessions.length === 0) continue
        expect(sessions[0]!.kind, `${a.id} ${week.weekStart}`).toBe('threshold')
        if (sessions.length === 1) single += 1
      }
    }
    expect(single).toBeGreaterThan(5)
  })

  it('leaves the run days of the default, and plans the weeks of the preset from today on', () => {
    for (const a of applied) {
      const plan = planOf(a)
      expect(maxRunDays(plan), a.id).toBe(maxRunDays(defaults.get(a.id)!))
      expect(planWeeks(plan)[0]!.weekStart, a.id).toBe(mondayOf(TODAY))
    }
  })
})

/** The presets are the only values the record offers, so the tables above name all of them. */
describe('the offered presets', () => {
  it('are the two the tables of this file name', () => {
    expect([...OFFERED]).toEqual(Object.keys(READING))
    const ids: PresetId[] = [...OFFERED]
    expect(ids).toEqual(['three-run-days', 'longer-base'])
  })
})

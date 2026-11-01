// Rest windows in the engine [phase 3a design 9.5, rule J9]: how windows reach the week placement,
// the caps, the re-plan, the injury profile and the checklist. The window geometry itself is
// pinned in disruption.test.ts; the seeded sweep over every matrix athlete is
// disruption-sweep.test.ts.
import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import {
  dayRuleOn,
  disruptionPlan,
  holdReference,
  illnessDays,
  isDisruptedWeek,
  windowedWeeks,
} from '../../../shared/engine/disruption.ts'
import { matchSessions } from '../../../shared/engine/execution.ts'
import { applyGuards } from '../../../shared/engine/guards.ts'
import { buildPlan, keptByReplan, replan, runChecklist } from '../../../shared/engine/index.ts'
import { injuryTight, tightRamp, weeklyRamp } from '../../../shared/engine/limits.ts'
import { startPath, taperMultipliers } from '../../../shared/engine/macro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { illnessPhase } from '../../../shared/engine/readiness.ts'
import type {
  DisruptionWindow,
  EngineInput,
  PlanDraft,
  SessionSpec,
} from '../../../shared/engine/types.ts'
import { activity, planned, wellnessDay } from './e8-fixtures.ts'
import {
  HARD_OR_STRIDES,
  planMinutes,
  problemsOf,
  RUNNING,
  windowOf,
  withWindows,
} from './disruption-fixtures.ts'
import { athletes, TODAY } from './matrix-fixtures.ts'
import { replanChain } from './replan-steps.ts'

const all = athletes()
const byId = (id: string) => all.find((a) => a.id === id)!
const half = byId('half')
const baseHalf = buildPlan(half.input)
const NEXT_MONDAY = addDays(mondayOf(TODAY), 7)

const asExisting = (plan: PlanDraft): NonNullable<EngineInput['existing']> => ({
  weeks: plan.weeks,
  sessions: plan.sessions.map((s, i) => ({
    ...s,
    id: `s${i}`,
    status: 'planned',
    activityId: null,
  })),
})

const sessionsOn = (plan: PlanDraft, from: string, to: string) =>
  plan.sessions.filter((s) => s.date >= from && s.date <= to)
const minutesOn = (plan: PlanDraft, date: string) =>
  plan.sessions
    .filter((s) => s.date === date && RUNNING.has(s.kind))
    .reduce((n, s) => n + s.durationMin, 0)

describe('without windows', () => {
  it('gives the same plan with no field, an empty list or windows that cannot be used', () => {
    const unusable = [
      windowOf({ id: 'bad', startDate: '2026-02-30', endDate: '2026-03-02' }),
      windowOf({ id: 'backwards', startDate: '2026-11-05', endDate: '2026-11-01' }),
    ]
    for (const a of all) {
      const plan = buildPlan(a.input)
      for (const disruptions of [[], unusable]) {
        expect(buildPlan({ ...a.input, disruptions }), `${a.id} build`).toEqual(plan)
      }
      expect(
        plan.checklist.map((c) => c.id),
        a.id,
      ).not.toContain('disruption-window')
      const existing = asExisting(plan)
      const again = replan({ ...a.input, existing })
      expect(replan({ ...a.input, existing, disruptions: [] }), `${a.id} replan`).toEqual(again)
      expect(replan({ ...a.input, existing, disruptions: unusable }), `${a.id} replan`).toEqual(
        again,
      )
    }
  })

  it('leaves the athlete state and the illness days as the check-ins alone make them', () => {
    const a = half
    expect(estimateState(withWindows(a))).toEqual(estimateState(a.input))
    expect(estimateState(a.input).risk).not.toHaveProperty('injuryReport')
    expect(illnessDays({ wellness: [wellnessDay('2026-10-20', { illness: true })] })).toEqual([
      '2026-10-20',
    ])
  })
})

describe('a short illness: Thu to Sat, in the week ahead', () => {
  const window = windowOf({
    reason: 'illness-above-neck',
    startDate: '2026-10-22',
    endDate: '2026-10-24',
  })
  const plan = buildPlan(withWindows(half, window))

  it('puts a rest session with the window words on every held day, the symptom-free day included', () => {
    const rest = sessionsOn(plan, '2026-10-22', '2026-10-25')
    expect(rest.map((s) => [s.date, s.kind])).toEqual([
      ['2026-10-22', 'rest'],
      ['2026-10-23', 'rest'],
      ['2026-10-24', 'rest'],
      ['2026-10-25', 'rest'],
    ])
    for (const s of rest) {
      expect(s.title).toBe('Rest: illness')
      expect(s.flags).toEqual(['rest-window'])
      expect(s.rules).toEqual(['J9', 'n-3', 'g-6'])
      expect(s.durationMin).toBe(0)
    }
    expect(rest[3]!.purpose).toMatch(/symptom-free day/)
    expect(rest[0]!.purpose).toMatch(/not added back/)
  })

  it('holds no run, no hard work and no strength on a held day, and no hard work on the easy days after', () => {
    const rules = disruptionPlan([window])
    const problems = problemsOf(half, [window], plan, baseHalf)
    expect(problems).toEqual([])
    // the three easy days after the symptom-free day carry easy running only
    const easy = sessionsOn(plan, '2026-10-26', '2026-10-28')
    expect(easy.length).toBe(3)
    for (const s of easy) {
      expect(HARD_OR_STRIDES.has(s.kind), `${s.date} ${s.kind}`).toBe(false)
      expect(dayRuleOn(rules, s.date)?.quality).toBe(false)
    }
    // the baseline had a session with strides on the first of them
    expect(baseHalf.sessions.find((s) => s.date === '2026-10-26')!.kind).toBe('strides')
  })

  it('loses the minutes of the held days and does not move them', () => {
    // the baseline ran 47 + 47 + 46 + 75 min from Wednesday on; only Wednesday remains
    expect(minutesOn(baseHalf, '2026-10-21')).toBe(47)
    const week = mondayOf(TODAY)
    expect(planMinutes(baseHalf).get(week)).toBe(215)
    expect(planMinutes(plan).get(week)).toBe(47)
    expect(minutesOn(plan, '2026-10-21')).toBe(47)
    // the long run of Saturday is lost, not moved to another day
    expect(plan.sessions.filter((s) => s.kind === 'long' && mondayOf(s.date) === week)).toEqual([])
  })

  it('flags the weeks the window touches and leaves the weeks after it as they were', () => {
    const flags = (p: PlanDraft, week: string) => p.weeks.find((w) => w.weekStart === week)!.flags
    expect(flags(plan, mondayOf(TODAY))).toContain('disrupted')
    expect(flags(plan, NEXT_MONDAY)).toContain('disrupted')
    expect(flags(plan, addDays(NEXT_MONDAY, 7))).not.toContain('disrupted')
    // no hold of 7 days or more: no restart share and no return flag
    expect(plan.weeks.some((w) => w.flags.includes('disruption-return'))).toBe(false)
    const later = (p: PlanDraft) => p.sessions.filter((s) => s.date >= addDays(NEXT_MONDAY, 7))
    expect(later(plan)).toEqual(later(baseHalf))
    expect(plan.weeks.filter((w) => w.weekStart >= addDays(NEXT_MONDAY, 7))).toEqual(
      baseHalf.weeks.filter((w) => w.weekStart >= addDays(NEXT_MONDAY, 7)),
    )
  })

  it('keeps the race, the prediction and the label of the plan without the window', () => {
    expect(plan.feasibility).toEqual(baseHalf.feasibility)
    expect(plan.prediction).toEqual(baseHalf.prediction)
    expect(plan.sessions.filter((s) => s.kind === 'race').map((s) => s.date)).toEqual([
      half.input.goal.date,
    ])
    expect(plan.checklist.map((c) => c.id)).toEqual([
      ...baseHalf.checklist.map((c) => c.id),
      'disruption-window',
    ])
    expect(plan.checklist.every((c) => c.ok)).toBe(true)
  })
})

describe('strength', () => {
  it('is not planned on a held day', () => {
    const input = {
      ...half.input,
      profile: { ...half.input.profile, strengthPreference: 2 as const },
    }
    const base = buildPlan(input)
    const window = windowOf({ reason: 'travel', startDate: '2026-10-22', endDate: '2026-10-25' })
    const plan = buildPlan({ ...input, disruptions: [window] })
    const strength = (p: PlanDraft) =>
      p.sessions.filter((s) => s.kind === 'strength').map((s) => s.date)
    // the baseline puts strength on Sunday 25 October, a day the window holds
    expect(strength(base)).toContain('2026-10-25')
    const held = ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']
    expect(strength(plan).filter((d) => held.includes(d))).toEqual([])
    expect(strength(plan)).toContain('2026-10-21')
    expect(strength(plan)).toContain('2026-10-26')
    expect(plan.checklist.every((c) => c.ok)).toBe(true)
  })
})

describe('short easy runs while travelling', () => {
  const marathon = byId('marathon')
  const base = buildPlan(marathon.input)
  const window = windowOf({
    reason: 'travel',
    mode: 'limited',
    maxRunMin: 30,
    startDate: '2026-10-23',
    endDate: '2026-10-28',
  })
  const plan = buildPlan(withWindows(marathon, window))

  it('caps each run of the window and puts no long run there', () => {
    const inside = sessionsOn(plan, '2026-10-23', '2026-10-28').filter((s) => RUNNING.has(s.kind))
    expect(inside.length).toBeGreaterThan(4)
    for (const s of inside) expect(s.durationMin).toBeLessThanOrEqual(30)
    expect(inside.some((s) => s.kind === 'long')).toBe(false)
    // the long run of Saturday 24 October is not squeezed into 30 minutes, and not moved
    expect(base.sessions.find((s) => s.date === '2026-10-24')!.kind).toBe('long')
    expect(plan.sessions.filter((s) => s.kind === 'long' && s.date < '2026-10-29')).toEqual([])
  })

  it('does not move the minutes above the cap to another day or week', () => {
    const baseDay = (date: string) => minutesOn(base, date)
    const lost = (from: string, to: string) => {
      let sum = 0
      for (let d = from; d <= to; d = addDays(d, 1)) sum += Math.max(0, baseDay(d) - 30)
      return sum
    }
    const minutes = planMinutes(plan)
    const before = planMinutes(base)
    const week = mondayOf(TODAY)
    expect(minutes.get(week)).toBe(before.get(week)! - lost('2026-10-23', '2026-10-25'))
    expect(minutes.get(NEXT_MONDAY)).toBe(
      before.get(NEXT_MONDAY)! - lost('2026-10-26', '2026-10-28'),
    )
    // the days outside the window keep the lengths they had
    expect(minutesOn(plan, '2026-10-21')).toBe(baseDay('2026-10-21'))
    expect(minutesOn(plan, '2026-10-22')).toBe(baseDay('2026-10-22'))
    expect(minutesOn(plan, '2026-10-29')).toBe(baseDay('2026-10-29'))
    expect(problemsOf(marathon, [window], plan, base)).toEqual([])
  })

  it('lets quality sessions stay where a run fits (no easy tail follows)', () => {
    expect(disruptionPlan([window]).days.every((d) => d.quality)).toBe(true)
    const quality = plan.sessions.filter(
      (s) => s.date >= '2026-10-23' && s.date <= '2026-10-28' && HARD_OR_STRIDES.has(s.kind),
    )
    expect(quality.length).toBeGreaterThan(0)
  })
})

describe('a long hold sends the weeks back at the J7 share of the week before', () => {
  // The half-marathon runner ran 215 min a week for twelve weeks.
  const REFERENCE = 215

  it('holds the return week to the share and does not jump back to 110% of the week before', () => {
    // ill from Thu 29 Oct to Sat 7 Nov (10 days) and the symptom-free day: 11 days off, first run
    // day Monday 9 November, so that week is both the return week and the first full week
    const window = windowOf({
      reason: 'illness-below-neck',
      startDate: '2026-10-29',
      endDate: '2026-11-07',
    })
    const plan = buildPlan(withWindows(half, window))
    const rules = disruptionPlan([window])
    expect(rules.holds[0]).toMatchObject({
      layoffDays: 11,
      runFrom: '2026-11-09',
      returnWeekStart: '2026-11-09',
      fullWeekStart: '2026-11-09',
    })
    const minutes = planMinutes(plan)
    const cap = Math.floor(REFERENCE * P.j7.restart7to14.value)
    expect(cap).toBe(193)
    // the week of the hold holds no run, the return week stays under its share and close to it
    expect(minutes.get('2026-11-02') ?? 0).toBe(0)
    expect(minutes.get('2026-11-09')!).toBeLessThanOrEqual(cap)
    expect(minutes.get('2026-11-09')!).toBeGreaterThanOrEqual(cap - 3)
    // the next week climbs from the return week by the weekly ramp, not back to the week before
    expect(minutes.get('2026-11-16')!).toBeLessThan(REFERENCE)
    const flags = (week: string) => plan.weeks.find((w) => w.weekStart === week)!.flags
    expect(flags('2026-11-09')).toContain('disruption-return')
    expect(flags('2026-11-16')).not.toContain('disruption-return')
    expect(flags('2026-11-02')).toContain('disrupted')
    // every held day has its rest session, 11 of them
    const rest = plan.sessions.filter((s) => s.kind === 'rest' && s.flags.includes('rest-window'))
    expect(rest.length).toBe(11)
    expect(problemsOf(half, [window], plan, baseHalf)).toEqual([])
  })

  it('prorates a mid-week return by its open days and holds the first full week after it', () => {
    // 15 days off from Mon 26 Oct to Mon 9 Nov: the first run day is Tue 10 Nov, 6 open days
    const window = windowOf({
      reason: 'travel',
      startDate: '2026-10-26',
      endDate: '2026-11-09',
    })
    const plan = buildPlan(withWindows(half, window))
    const share = P.j7.restart15to28.value
    const minutes = planMinutes(plan)
    expect(disruptionPlan([window]).holds[0]).toMatchObject({
      layoffDays: 15,
      runFrom: '2026-11-10',
      returnWeekStart: '2026-11-09',
      fullWeekStart: '2026-11-16',
    })
    expect(minutes.get('2026-11-09')!).toBeLessThanOrEqual(Math.floor((REFERENCE * share * 6) / 7))
    expect(minutes.get('2026-11-16')!).toBeLessThanOrEqual(Math.floor(REFERENCE * share))
    // the weekly ramp from the return week keeps the next week under the share too
    expect(minutes.get('2026-11-16')!).toBeGreaterThan(minutes.get('2026-11-09')!)
    for (const week of ['2026-11-09', '2026-11-16']) {
      expect(plan.weeks.find((w) => w.weekStart === week)!.flags).toContain('disruption-return')
    }
    expect(problemsOf(half, [window], plan, baseHalf)).toEqual([])
  })

  it('adds a minute to no week, whatever the athlete and the length of the hold', () => {
    for (const a of all) {
      const base = buildPlan(a.input)
      for (const days of [7, 14, 28]) {
        const window = windowOf({
          reason: 'travel',
          startDate: addDays(TODAY, 3),
          endDate: addDays(TODAY, 2 + days),
        })
        const plan = buildPlan(withWindows(a, window))
        expect(problemsOf(a, [window], plan, base), `${a.id} ${days} days`).toEqual([])
      }
    }
  })

  it('leaves a start path to its programme: its weeks are not cut to the share', () => {
    const novice = byId('novice-5k')
    const base = buildPlan(novice.input)
    const window = windowOf({
      reason: 'travel',
      startDate: addDays(TODAY, 3),
      endDate: addDays(TODAY, 16),
    })
    const plan = buildPlan(withWindows(novice, window))
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
    // the ladder weeks that follow the hold hold their rung's runs
    const after = plan.weeks.filter((w) => w.weekStart >= addDays(mondayOf(TODAY), 21))
    expect(after.some((w) => /ladder-/.test(w.flags.join(' ')))).toBe(true)
    expect(planMinutes(plan).get(after[0]!.weekStart)!).toBeGreaterThan(0)
    expect(problemsOf(novice, [window], plan, base)).toEqual([])
  })
})

describe('a back-dated hold re-planned after it', () => {
  // The runner ran as planned until Wed 28 October, was ill for 14 days from then (28 Oct to 10 Nov)
  // and opens the app on Wed 11 November, the symptom-free day. The two sessions of that week that
  // came before today were skipped by the window.
  const stop = addDays(TODAY, 7)
  const today = addDays(stop, 14)
  const window = windowOf({
    reason: 'illness-above-neck',
    startDate: stop,
    endDate: addDays(stop, 13),
  })
  const ran = baseHalf.sessions
    .filter((s) => s.date >= TODAY && s.date < stop && RUNNING.has(s.kind))
    .map((s) =>
      activity(s.date, {
        id: `done-${s.date}`,
        durationSec: s.durationMin * 60,
        distanceM: s.distanceM ?? s.durationMin * 170,
      }),
    )
  const existing: NonNullable<EngineInput['existing']> = {
    weeks: baseHalf.weeks,
    sessions: baseHalf.sessions.map((s, i) => {
      const skipped = s.date >= stop && s.date < today
      return {
        ...s,
        id: `s${i}`,
        flags: skipped ? [...s.flags, 'rest-window' as const] : s.flags,
        status: s.date < stop ? 'completed' : skipped ? 'skipped' : 'planned',
        activityId: null,
      }
    }),
  }
  const input: EngineInput = {
    ...half.input,
    today,
    activities: [...half.input.activities, ...ran],
    existing,
    disruptions: [window],
  }
  const { draft } = replan(input)

  it('rests on the symptom-free day and returns at the share for the 15 days lost, not at a second cut', () => {
    expect(draft.sessions.find((s) => s.date === today)).toMatchObject({
      kind: 'rest',
      flags: ['rest-window'],
    })
    const minutes = (from: string, to: string) =>
      draft.sessions
        .filter((s) => s.date >= from && s.date <= to && s.date >= today && RUNNING.has(s.kind))
        .reduce((n, s) => n + s.durationMin, 0)
    const share = P.j7.restart15to28.value
    // the return week: Thursday to Sunday, 4 open days of 7
    const returnCap = Math.floor((215 * share * 4) / 7)
    expect(returnCap).toBe(92)
    expect(minutes('2026-11-09', '2026-11-15')).toBeLessThanOrEqual(returnCap)
    expect(minutes('2026-11-09', '2026-11-15')).toBeGreaterThanOrEqual(returnCap - 3)
    // the first full week holds 75% of the week before the hold; a second cut by the 90% of the
    // break restart would leave 145 min
    const fullCap = Math.floor(215 * share)
    expect(fullCap).toBe(161)
    expect(minutes('2026-11-16', '2026-11-22')).toBeLessThanOrEqual(fullCap)
    expect(minutes('2026-11-16', '2026-11-22')).toBeGreaterThanOrEqual(fullCap - 3)
    expect(
      draft.weeks.filter((w) => w.flags.includes('disruption-return')).map((w) => w.weekStart),
    ).toEqual(['2026-11-09', '2026-11-16'])
  })

  it('keeps the checklist, and counts the skipped runs of the window as runs not run', () => {
    expect(draft.checklist.filter((c) => !c.ok)).toEqual([])
    expect(draft.checklist.map((c) => c.id)).toContain('disruption-window')
    // the sessions the window skipped stay in the plan, kept as they were
    const kept = draft.sessions.filter((s) => s.date >= '2026-11-09' && s.date < today)
    expect(kept.map((s) => s.date)).toEqual(['2026-11-09', '2026-11-10'])
    expect(kept.every((s) => s.flags.includes('rest-window'))).toBe(true)
  })

  it('adds no minute to a week against the plan before the window', () => {
    const before = planMinutes(baseHalf)
    const after = new Map<string, number>()
    for (const s of draft.sessions) {
      if (!RUNNING.has(s.kind) || s.flags.includes('rest-window')) continue
      after.set(mondayOf(s.date), (after.get(mondayOf(s.date)) ?? 0) + s.durationMin)
    }
    for (const [week, minutes] of after) {
      if (week < mondayOf(today)) continue
      expect(minutes, week).toBeLessThanOrEqual(before.get(week) ?? 0)
    }
  })
})

describe('a re-plan with the window its plan already carries', () => {
  // The held days' minutes are lost once, when the window first reaches the plan. A further re-plan
  // of the same window (the Monday job, "Update plan", an edit of another window) reads a plan whose
  // held days already rest, so it takes nothing more from the days that are left [rules J9, G-6].
  const monday = addDays(mondayOf(TODAY), 7)
  const cases: Array<{
    name: string
    athlete: string
    today: string
    window: DisruptionWindow
    ran?: boolean
  }> = [
    {
      name: 'a rest window on the last days of the week',
      athlete: 'half',
      today: TODAY,
      window: windowOf({ reason: 'travel', startDate: '2026-10-23', endDate: '2026-10-25' }),
    },
    {
      name: 'an illness window that starts tomorrow',
      athlete: 'half',
      today: TODAY,
      window: windowOf({
        reason: 'illness-above-neck',
        startDate: '2026-10-22',
        endDate: '2026-10-23',
      }),
    },
    {
      name: 'a rest window with a run already logged on Monday',
      athlete: 'marathon',
      today: TODAY,
      window: windowOf({ reason: 'travel', startDate: '2026-10-23', endDate: '2026-10-25' }),
      ran: true,
    },
    {
      name: 'a window of capped days',
      athlete: 'marathon',
      today: TODAY,
      window: windowOf({
        reason: 'travel',
        mode: 'limited',
        maxRunMin: 30,
        startDate: '2026-10-23',
        endDate: '2026-10-28',
      }),
    },
    {
      name: 'the Monday job in the middle of a rest window',
      athlete: 'half',
      today: monday,
      window: windowOf({ reason: 'travel', startDate: '2026-10-23', endDate: '2026-10-28' }),
    },
  ]

  for (const c of cases) {
    it(`gives the same plan again after ${c.name}`, () => {
      const a = byId(c.athlete)
      const logged = c.ran
        ? [
            activity('2026-10-19', {
              id: 'done-monday',
              durationSec: 40 * 60,
              distanceM: 40 * 170,
            }),
          ]
        : []
      const input: EngineInput = {
        ...a.input,
        today: c.today,
        activities: [...a.input.activities, ...logged],
        disruptions: [c.window],
      }
      const first = replan({ ...input, existing: asExisting(buildPlan(a.input)) }).draft
      const from = mondayOf(c.today)
      const ahead = (plan: PlanDraft) =>
        plan.sessions.filter((s) => s.date >= c.today).map((s) => [s.date, s.kind, s.durationMin])
      expect(planMinutes(first).get(from)).toBeLessThan(planMinutes(buildPlan(a.input)).get(from)!)
      let existing = asExisting(first)
      for (let pass = 2; pass <= 4; pass++) {
        const again = replan({ ...input, existing }).draft
        expect(ahead(again), `pass ${pass}`).toEqual(ahead(first))
        expect(again.weeks, `pass ${pass}`).toEqual(first.weeks)
        expect(again.checklist.filter((item) => !item.ok)).toEqual([])
        existing = asExisting(again)
      }
    })
  }
})

describe('keptByReplan with the days a window holds', () => {
  const today = '2026-10-21' // a Wednesday
  const holds = new Set(['2026-10-22', '2026-10-27'])
  const row = (date: string, status: string, rules: string[] = []) => ({ date, status, rules })

  it('releases an owner edit or a trim on a held day, and nothing else', () => {
    for (const status of ['moved', 'skipped', 'adjusted', 'downgraded']) {
      // this week
      expect(keptByReplan(row('2026-10-22', status), today, holds), `${status} this week`).toBe(
        false,
      )
      // the next 14 days
      expect(keptByReplan(row('2026-10-27', status, ['design-4.3']), today, holds), status).toBe(
        false,
      )
    }
    // a finished session is a fact, whatever the window says
    for (const status of ['completed', 'partial']) {
      expect(keptByReplan(row('2026-10-22', status), today, holds), status).toBe(true)
    }
    // the past is never released
    expect(keptByReplan(row('2026-10-20', 'moved'), today, new Set(['2026-10-20']))).toBe(true)
  })

  it('keeps an edit on a day no window holds, and behaves as before without hold dates', () => {
    expect(keptByReplan(row('2026-10-23', 'moved'), today, holds)).toBe(true)
    expect(keptByReplan(row('2026-10-28', 'skipped'), today, holds)).toBe(true)
    for (const status of ['planned', 'moved', 'skipped', 'adjusted', 'completed']) {
      for (const date of ['2026-10-20', '2026-10-22', '2026-10-27', '2026-11-05', '2026-11-20']) {
        expect(keptByReplan(row(date, status), today, new Set()), `${status} ${date}`).toBe(
          keptByReplan(row(date, status), today),
        )
      }
    }
  })

  it('keeps an adjusted session like a moved one: in the next 14 days, not beyond', () => {
    expect(keptByReplan(row('2026-10-27', 'adjusted'), today)).toBe(true)
    expect(keptByReplan(row('2026-11-04', 'adjusted'), today)).toBe(false)
    expect(keptByReplan(row('2026-10-24', 'planned'), today)).toBe(false)
  })
})

describe('a re-plan releases an owner edit that breaks a window', () => {
  const sat = '2026-10-24'
  const edited = (status: string, date: string, over: Partial<SessionSpec> = {}) => {
    const existing = asExisting(baseHalf)
    existing.sessions = existing.sessions.map((s) =>
      s.date === date && s.kind !== 'rest' ? { ...s, ...over, status } : s,
    )
    return existing
  }

  it('puts the rest session where the moved run was, and shows the change', () => {
    const existing = edited('moved', sat)
    const window = windowOf({ reason: 'travel', startDate: '2026-10-23', endDate: '2026-10-25' })
    // without the window the owner's session stays
    const kept = replan({ ...half.input, existing })
    expect(kept.draft.sessions.find((s) => s.date === sat)).toMatchObject({ kind: 'long' })
    // with it the day is a rest day
    const out = replan({ ...half.input, existing, disruptions: [window] })
    const day = out.draft.sessions.filter((s) => s.date === sat)
    expect(day.map((s) => s.kind)).toEqual(['rest'])
    expect(day[0]!.flags).toEqual(['rest-window'])
    expect(out.changes.some((c) => c.field === 'plannedMin' && c.weekStart === mondayOf(sat))).toBe(
      true,
    )
    expect(out.draft.checklist.filter((c) => !c.ok)).toEqual([])
  })

  it('keeps an owner edit on a day the window leaves alone', () => {
    const existing = edited('adjusted', '2026-10-31', { durationMin: 40 })
    const window = windowOf({ reason: 'travel', startDate: '2026-10-23', endDate: '2026-10-25' })
    const out = replan({ ...half.input, existing, disruptions: [window] })
    expect(out.draft.sessions.find((s) => s.date === '2026-10-31')).toMatchObject({
      kind: 'long',
      durationMin: 40,
    })
  })
})

describe('an injury report tightens the recent-injury profile', () => {
  const niggle = (over: Partial<DisruptionWindow> = {}) =>
    windowOf({
      reason: 'niggle',
      startDate: '2026-10-19',
      endDate: '2026-10-23',
      pain: P.pain.flagScore.value,
      ...over,
    })
  const kneeInjury = {
    area: 'knee',
    side: 'left' as const,
    year: 2026,
    month: 8,
    kind: 'joint' as const,
    notes: null,
  }

  it('sets the report for pain at the flag score or a gait change, while it is active or ahead', () => {
    const risk = (w: DisruptionWindow) => estimateState(withWindows(half, w)).risk
    expect(risk(niggle()).injuryReport).toBe(true)
    expect(risk(niggle({ pain: 1, gaitChange: true })).injuryReport).toBe(true)
    // a window that has not started yet counts: the plan is drawn tight from the report on
    expect(risk(niggle({ startDate: '2026-11-02', endDate: '2026-11-04' })).injuryReport).toBe(true)
    // below the flag score, an illness, or a window whose ladder is over
    expect(risk(niggle({ pain: P.pain.flagScore.value - 1 }))).not.toHaveProperty('injuryReport')
    expect(risk(windowOf({ reason: 'travel' }))).not.toHaveProperty('injuryReport')
    expect(risk(niggle({ startDate: '2026-08-01', endDate: '2026-08-05' }))).not.toHaveProperty(
      'injuryReport',
    )
    // the report is the only thing in the state that changes
    const { injuryReport: _report, ...rest } = risk(niggle())
    expect(rest).toEqual(estimateState(half.input).risk)
  })

  it('reads as injuryTight beside a recent injury of the profile, and nowhere else', () => {
    const state = estimateState(withWindows(half, niggle()))
    expect(injuryTight(state)).toBe(true)
    expect(injuryTight(estimateState(half.input))).toBe(false)
    const injured = estimateState({
      ...half.input,
      profile: { ...half.input.profile, injuries: [kneeInjury] },
    })
    expect(injuryTight(injured)).toBe(true)
    expect(tightRamp(state)).toBe(P.g3.recentInjuryRamp.value[1])
    expect(weeklyRamp(state)).toBe(Math.min(P.g2.rampSoft.value, P.g3.recentInjuryRamp.value[0]))
    expect(weeklyRamp(estimateState(half.input))).toBe(P.g2.rampSoft.value)
  })

  it('makes the 1.10x session limit a hard one in the guards', () => {
    const run = baseHalf.sessions.find((s) => s.kind === 'long')!
    const longest = estimateState(half.input).longest30d.durationSec / 60
    const over: SessionSpec = {
      ...run,
      date: addDays(TODAY, 3),
      kind: 'easy',
      durationMin: Math.round(longest * 1.2),
      distanceM: null,
      gainM: null,
    }
    const guard = (input: EngineInput) =>
      applyGuards([over], estimateState(input), input.activities)
    const loose = guard(half.input)
    expect(loose.sessions[0]!.flags).toContain('spike-warn')
    expect(loose.sessions[0]!.durationMin).toBe(over.durationMin)
    const tight = guard(withWindows(half, niggle()))
    expect(tight.warnings.map((w) => w.code)).toContain('spike-hard-limit')
    expect(tight.sessions[0]!.durationMin).toBeLessThanOrEqual(Math.floor(longest * 1.1 + 1e-9))
    expect(tight.sessions[0]!.flags).not.toContain('spike-warn')
  })

  it('fails the checklist on a warn-band run, as it does for a recent injury', () => {
    const flagged: PlanDraft = {
      ...baseHalf,
      sessions: baseHalf.sessions.map((s, i) =>
        i === 3 ? { ...s, flags: [...s.flags, 'spike-warn' as const] } : s,
      ),
    }
    const spike = (input: EngineInput) =>
      runChecklist(flagged, input).find((c) => c.id === 'spike-guard')!
    expect(spike(half.input).ok).toBe(true)
    expect(spike(withWindows(half, niggle())).ok).toBe(false)
    expect(spike(withWindows(half, niggle())).detail).toMatch(/above the hard limit/)
  })

  it('opens the injury-return ladder for a runner under the 3 x 20 floor', () => {
    const sparse = byId('sparse-100-mile')
    const path = (input: EngineInput) => startPath(input, estimateState(input))
    expect(path(sparse.input)?.kind).not.toBe('injury-return')
    expect(path(withWindows(sparse, niggle()))?.kind).toBe('injury-return')
  })

  it('leaves the recovery cadence as it is, where a recent injury changes it', () => {
    const cadence = (plan: PlanDraft) => plan.weeks.map((w) => w.isRecovery)
    const reported = buildPlan(withWindows(half, niggle()))
    expect(cadence(reported)).toEqual(cadence(baseHalf))
    expect(reported.checklist.find((c) => c.id === 'recovery-cadence')!.ok).toBe(true)
    // control: the profile's injury moves the cadence to the flagged cycle
    const injured = buildPlan({
      ...half.input,
      profile: { ...half.input.profile, injuries: [kneeInjury] },
    })
    expect(cadence(injured)).not.toEqual(cadence(baseHalf))
  })

  it('holds the weekly ramp of the report', () => {
    const plan = buildPlan(withWindows(half, niggle()))
    const loading = plan.weeks.filter(
      (w) => !w.isRecovery && !w.isTaper && w.phase !== 'race' && w.weekStart > TODAY,
    )
    const ramp = P.g3.recentInjuryRamp.value[1]
    const minutes = planMinutes(plan)
    const previous = (week: string) =>
      Math.max(minutes.get(addDays(week, -7)) ?? 0, minutes.get(addDays(week, -14)) ?? 0)
    for (const w of loading.slice(1, 6)) {
      const base = previous(w.weekStart)
      if (base > 0) {
        expect(minutes.get(w.weekStart)!, w.weekStart).toBeLessThanOrEqual(base * (1 + ramp) + 1)
      }
    }
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })
})

describe('the illness gate reads the check-ins and the illness windows alike', () => {
  const window = windowOf({
    reason: 'illness-below-neck',
    startDate: '2026-10-20',
    endDate: '2026-10-22',
  })
  const checkins = ['2026-10-20', '2026-10-21', '2026-10-22'].map((d) =>
    wellnessDay(d, { illness: true }),
  )

  it('gives the same phase on every date', () => {
    const fromWindow = { ...half.input, disruptions: [window] }
    const fromCheckins = { ...half.input, wellness: checkins }
    for (let k = -3; k <= 12; k += 1) {
      const date = addDays('2026-10-20', k)
      expect(illnessPhase(fromWindow, date), date).toEqual(illnessPhase(fromCheckins, date))
    }
    expect(illnessPhase(fromWindow, '2026-10-23').phase).toBe('rest')
    expect(illnessPhase(fromWindow, '2026-10-24').phase).toBe('easy-only')
    expect(illnessPhase(fromWindow, '2026-10-27').phase).toBe('clear')
  })

  it('merges both sources and ignores a window of another reason', () => {
    const merged = illnessDays({
      wellness: [wellnessDay('2026-10-15', { illness: true })],
      disruptions: [window, windowOf({ id: 'other', reason: 'niggle' })],
    })
    expect(merged.sort()).toEqual(['2026-10-15', '2026-10-20', '2026-10-21', '2026-10-22'])
  })
})

describe('adjacent-day matching', () => {
  const runOn = (date: string) => activity(date, { id: `run-${date}`, durationSec: 3000 })
  const match = (status: string) =>
    matchSessions(
      [
        {
          ...planned('s1', '2026-10-22', 'easy', { durationMin: 50 }),
          status,
          linkSource: null,
        },
      ],
      [runOn('2026-10-23')],
    )

  it('links a run a day off to a session still to be run, whatever its status', () => {
    for (const status of ['planned', 'moved', 'downgraded', 'adjusted']) {
      expect(match(status), status).toEqual([{ sessionId: 's1', activityId: 'run-2026-10-23' }])
    }
  })

  it('leaves a settled session alone', () => {
    for (const status of ['completed', 'partial', 'skipped', 'unknown']) {
      expect(match(status), status).toEqual([])
    }
  })
})

describe('the disruption-window checklist item', () => {
  const window = windowOf({
    reason: 'illness-above-neck',
    startDate: '2026-10-22',
    endDate: '2026-10-24',
  })
  const input = withWindows(half, window)
  const plan = buildPlan(input)
  const item = (draft: PlanDraft, over: Partial<EngineInput> = {}) =>
    runChecklist(draft, { ...input, ...over }).find((c) => c.id === 'disruption-window')!
  const extra = (spec: Partial<SessionSpec> & Pick<SessionSpec, 'date' | 'kind'>): PlanDraft => ({
    ...plan,
    sessions: [
      ...plan.sessions,
      {
        order: 0,
        title: spec.kind,
        durationMin: 30,
        distanceM: null,
        gainM: null,
        structure: [],
        target: baseHalf.sessions[0]!.target,
        purpose: '',
        rules: [],
        flags: [],
        ...spec,
      },
    ],
  })

  it('passes a plan that keeps its windows and names the rules it rests on', () => {
    const result = item(plan)
    expect(result.ok).toBe(true)
    expect(result.rules).toEqual(['J9', 'J7', 'g-6'])
    expect(result.detail).toMatch(/rest on the held days/)
  })

  it('counts the days under a window in words that agree with the count, for one day and for several', () => {
    const line = (w: DisruptionWindow) => {
      const windowed = withWindows(half, w)
      const result = runChecklist(buildPlan(windowed), windowed).find(
        (c) => c.id === 'disruption-window',
      )!
      expect(result.ok, result.detail).toBe(true)
      return { days: disruptionPlan([w]).days.length, detail: result.detail }
    }
    const one = line(windowOf({ reason: 'travel', startDate: '2026-10-23', endDate: '2026-10-23' }))
    expect(one.days).toBe(1)
    expect(one.detail).toMatch(/^1 day under a rest window holds: rest on the held day, /)
    const several = line(
      windowOf({ reason: 'travel', startDate: '2026-10-23', endDate: '2026-10-25' }),
    )
    expect(several.days).toBe(3)
    expect(several.detail).toMatch(/^3 days under rest windows hold: rest on the held days, /)
    // no placeholder plural, and the words pass the shared lint like every other app sentence
    for (const { detail } of [one, several]) {
      expect(detail).not.toMatch(/\(s\)/)
      expect(lintText(detail)).toEqual([])
      expect(detail.length).toBeLessThanOrEqual(COPY_MAX_CHARS)
    }
  })

  it('fails a run, a hike or a strength session on a held day, and names the date', () => {
    for (const kind of ['easy', 'hike', 'strength'] as const) {
      const result = item(extra({ date: '2026-10-23', kind }))
      expect(result.ok, kind).toBe(false)
      expect(result.detail).toMatch(
        new RegExp(`2026-10-23 ${kind} falls on a day a rest window holds`),
      )
    }
  })

  it('fails a held day without a session', () => {
    const missing: PlanDraft = {
      ...plan,
      sessions: plan.sessions.filter((s) => s.date !== '2026-10-23'),
    }
    const result = item(missing)
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(
      /2026-10-23 is a day a rest window holds and carries no rest session/,
    )
  })

  it('fails hard work on a day the window keeps easy', () => {
    const result = item(extra({ date: '2026-10-27', kind: 'threshold' }))
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/2026-10-27 threshold is hard work on a day windows keep easy/)
    // the day after the easy days may carry it
    expect(item(extra({ date: '2026-10-30', kind: 'threshold' })).ok).toBe(true)
  })

  it('fails a run above the cap of its day', () => {
    const marathon = byId('marathon')
    const limited = windowOf({
      reason: 'travel',
      mode: 'limited',
      maxRunMin: 30,
      startDate: '2026-10-23',
      endDate: '2026-10-28',
    })
    const capped = withWindows(marathon, limited)
    const base = buildPlan(capped)
    const loud: PlanDraft = {
      ...base,
      sessions: base.sessions.map((s) =>
        s.date === '2026-10-26' && RUNNING.has(s.kind) ? { ...s, durationMin: 45 } : s,
      ),
    }
    const result = runChecklist(loud, capped).find((c) => c.id === 'disruption-window')!
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/2026-10-26 \w+ runs 45 min on a 30 min day/)
  })

  it('fails a week held to the restart share that runs more', () => {
    const long = windowOf({
      reason: 'illness-below-neck',
      startDate: '2026-10-29',
      endDate: '2026-11-07',
    })
    const withLong = withWindows(half, long)
    const base = buildPlan(withLong)
    expect(runChecklist(base, withLong).every((c) => c.ok)).toBe(true)
    const heavy: PlanDraft = {
      ...base,
      sessions: [
        ...base.sessions,
        {
          ...base.sessions.find((s) => s.date === '2026-11-10')!,
          date: '2026-11-13',
          order: 1,
          durationMin: 60,
        },
      ],
    }
    const result = runChecklist(heavy, withLong).find((c) => c.id === 'disruption-window')!
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/week of 2026-11-09: \d+ min is above 193 min/)
  })

  it('leaves a session the runner moved or shortened to the runner', () => {
    const mine = {
      ...extra({ date: '2026-10-23', kind: 'easy' }).sessions.at(-1)!,
      id: 'mine',
      status: 'moved',
      activityId: null,
    }
    const draft = extra({ date: '2026-10-23', kind: 'easy' })
    expect(item(draft).ok).toBe(false)
    expect(item(draft, { existing: { weeks: plan.weeks, sessions: [mine] } }).ok).toBe(true)
  })

  it('is absent without a usable window, and the other items still pass with one', () => {
    expect(runChecklist(baseHalf, half.input).map((c) => c.id)).not.toContain('disruption-window')
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })
})

describe('the checklist exempts the weeks a window touched', () => {
  const novice = byId('novice-5k')
  const noviceBase = buildPlan(novice.input)
  const flagWeek = (plan: PlanDraft, week: string): PlanDraft => ({
    ...plan,
    weeks: plan.weeks.map((w) =>
      w.weekStart === week ? { ...w, flags: [...w.flags, 'disrupted'] } : w,
    ),
  })
  const item = (plan: PlanDraft, input: EngineInput, id: string) =>
    runChecklist(plan, input).find((c) => c.id === id)!

  it('does not count a disrupted week in the cadence, and does not ask it for the recovery cut', () => {
    const weeks = baseHalf.weeks
    // turn the first recovery week after the plan's first loading block into a loading week
    const recovery = weeks.filter((w) => w.isRecovery && w.weekStart > mondayOf(TODAY))[1]!
    const loaded: PlanDraft = {
      ...baseHalf,
      weeks: weeks.map((w) =>
        w === recovery ? { ...w, isRecovery: false, targetRunMin: 400 } : w,
      ),
    }
    expect(item(loaded, half.input, 'recovery-cadence').ok).toBe(false)
    expect(item(flagWeek(loaded, recovery.weekStart), half.input, 'recovery-cadence').ok).toBe(true)
  })

  it('does not ask a disrupted week of a novice plan for three non-consecutive run days', () => {
    const week = noviceBase.weeks.find((w) => w.weekStart >= '2026-11-16' && w.targetRunMin > 0)!
    const monday = week.weekStart
    const crowded: PlanDraft = {
      ...noviceBase,
      sessions: [
        ...noviceBase.sessions.filter((s) => mondayOf(s.date) !== monday),
        ...[0, 1, 2, 3].map((k) => ({
          ...noviceBase.sessions[0]!,
          date: addDays(monday, k),
          kind: 'easy' as const,
          order: 0,
        })),
      ],
    }
    expect(item(crowded, novice.input, 'level-differentiation').ok).toBe(false)
    expect(item(flagWeek(crowded, monday), novice.input, 'level-differentiation').ok).toBe(true)
  })

  it('does not ask a disrupted start-path week for a run', () => {
    const ladder = noviceBase.weeks.find(
      (w) => /ladder-/.test(w.flags.join(' ')) && w.weekStart > TODAY,
    )!
    const bare: PlanDraft = {
      ...noviceBase,
      sessions: noviceBase.sessions.filter(
        (s) => mondayOf(s.date) !== ladder.weekStart || !RUNNING.has(s.kind),
      ),
    }
    expect(item(bare, novice.input, 'ladder-steps').ok).toBe(false)
    expect(item(flagWeek(bare, ladder.weekStart), novice.input, 'ladder-steps').ok).toBe(true)
  })

  it('still holds a held plan to its level: a window lowers it but nothing may grow past it', () => {
    const reds = byId('reds-hold')
    const window = windowOf({
      reason: 'short-on-time',
      startDate: '2026-10-13',
      endDate: '2026-10-26',
    })
    const input = withWindows(reds, window)
    const plan = buildPlan(input)
    expect(item(plan, input, 'reds-hold')).toMatchObject({ ok: true })
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
    // a later week above the held level still fails
    const typical = estimateState(input).typicalWeekMin
    const grown: PlanDraft = {
      ...plan,
      weeks: plan.weeks.map((w, i) =>
        i === plan.weeks.length - 6 ? { ...w, targetRunMin: typical + 50 } : w,
      ),
    }
    expect(item(grown, input, 'reds-hold').ok).toBe(false)
  })
})

describe('a long hold leaves the guards nothing to cut', () => {
  // A plan placed inside the limits needs no trimming afterwards. After 30 days without a run the
  // 30-day reference is empty, and each run of the first weeks back is compared with the runs
  // before it, those of its own week included; a plan that ignored that would be cut run by run,
  // week after week, as every cut lowers the reference of the next.
  const CUTS = [
    'spike-shortened',
    'spike-run-dropped',
    'spike-hard-limit',
    'ramp-ceiling',
    'ramp-run-dropped',
    'b2b-removed',
  ]
  const cuts = (plan: PlanDraft) => {
    const out: Record<string, number> = {}
    for (const w of plan.warnings) if (CUTS.includes(w.code)) out[w.code] = (out[w.code] ?? 0) + 1
    return out
  }

  it.each(all.filter((a) => a.id !== 'sparse-100-mile'))(
    'adds no cut for $label after 28 days off',
    (a) => {
      const base = cuts(buildPlan(a.input))
      for (const reason of ['illness-below-neck', 'travel'] as const) {
        for (const start of [-6, 0, 3]) {
          const window = windowOf({
            reason,
            startDate: addDays(TODAY, start),
            endDate: addDays(TODAY, start + 27),
          })
          const got = cuts(buildPlan(withWindows(a, window)))
          for (const code of CUTS) {
            expect(
              got[code] ?? 0,
              `${reason} from ${window.startDate}: ${code}`,
            ).toBeLessThanOrEqual(base[code] ?? 0)
          }
        }
      }
    },
  )
})

describe('the weeks after a window start from the last week run [rules J7, J9, g-2]', () => {
  // Weekly re-plans of a matrix athlete, each week run exactly as planned (`replanChain`): the runner
  // reports a window at the first Monday on or after its first day and honours it from that day. The
  // fifth Monday of the chain is the first re-plan that sees it, and the plan of the Monday before
  // is the plan before the window. The week the window left with a few minutes was once the whole
  // baseline of the weeks after it: they planned 16 to 29 minutes where the plan before had 190 to
  // 330 (found by M5, fixed by RF2).
  const OPENING = addDays(mondayOf(TODAY), 28)
  const SOFT = 1 + P.g2.rampSoft.value
  const loadingAfter = (plan: PlanDraft, weekStart: string) =>
    plan.weeks.filter(
      (w) => w.weekStart > weekStart && !w.isRecovery && !w.isTaper && w.phase !== 'race',
    )
  const target = (plan: PlanDraft, weekStart: string) =>
    plan.weeks.find((w) => w.weekStart === weekStart)!.targetRunMin

  describe('a 7-day illness, the Saturday before the fifth Monday (J7: 8 days off, 90%)', () => {
    const illness = windowOf({
      id: 'ill',
      reason: 'illness-above-neck',
      startDate: addDays(OPENING, -2),
      endDate: addDays(OPENING, 4),
    })
    const hold = disruptionPlan([illness]).holds[0]!

    it('is a layoff of 8 days that restarts at 90% of the reference week, in the first full week after the return week', () => {
      expect(hold).toMatchObject({
        layoffDays: 8,
        fraction: P.j7.restart7to14.value,
        runFrom: addDays(OPENING, 6),
        returnWeekStart: OPENING,
        fullWeekStart: addDays(OPENING, 7),
      })
    })

    it.each(['hot-race', 'half', 'trail-50k', 'sparse-100-mile'])(
      'holds the first full week of %s at the share and climbs from it by the ramp, never above the plan before',
      (id) => {
        const chain = replanChain(byId(id).input, { windows: [illness] })
        const before = chain[3]!.draft
        const step = chain[4]!
        expect(step.input.today).toBe(OPENING)
        // the reference week of the hold, from the weeks as run (the plan was run exactly)
        const run = new Map(estimateState(step.input).weeks.map((w) => [w.weekStart, w.runMin]))
        const share = Math.floor(holdReference(hold, (w) => run.get(w)) * hold.fraction)
        const minutes = planMinutes(step.draft)
        const full = minutes.get(hold.fullWeekStart)!
        expect(full).toBeLessThanOrEqual(share)
        expect(full).toBeGreaterThanOrEqual(Math.min(share, target(before, hold.fullWeekStart)) - 3)
        // the weeks after it climb from it: none under it, none above the ramp step over the
        // loading week before it, none above the plan before the window
        let last = full
        for (const week of loadingAfter(step.draft, hold.fullWeekStart)) {
          const planned = minutes.get(week.weekStart) ?? 0
          expect(planned, week.weekStart).toBeGreaterThanOrEqual(Math.min(last, full))
          expect(planned, week.weekStart).toBeLessThanOrEqual(Math.floor(last * SOFT + 1e-9) + 1)
          expect(week.targetRunMin, week.weekStart).toBeLessThanOrEqual(
            target(before, week.weekStart),
          )
          last = planned
        }
        // the restart is not a collapse: a loading week four weeks after the window holds at least
        // the deepest restart share of the plan before
        const four = loadingAfter(step.draft, hold.fullWeekStart)[3]!
        expect(four.targetRunMin).toBeGreaterThanOrEqual(
          P.j7.restartOver28.value * target(before, four.weekStart),
        )
      },
    )
  })

  describe('a mild niggle of 3 days from the fifth Monday (J7: under 7 days, 100%)', () => {
    const niggle = windowOf({
      id: 'nig',
      reason: 'niggle',
      startDate: OPENING,
      endDate: addDays(OPENING, 2),
      pain: P.pain.flagScore.value - 1,
    })

    it('is no layoff to restart from', () => {
      expect(disruptionPlan([niggle]).holds[0]).toMatchObject({
        layoffDays: 3,
        fraction: P.j7.restartUnder7.value,
      })
    })

    it.each(['half', 'returning', 'sparse-100-mile'])(
      'returns %s to the last week it ran and no further than the plan before the window',
      (id) => {
        const chain = replanChain(byId(id).input, { windows: [niggle] })
        const before = chain[3]!.draft
        const step = chain[4]!
        const minutes = planMinutes(step.draft)
        // the week it touched holds what the window left
        expect(minutes.get(OPENING)!).toBeLessThan(target(before, OPENING))
        // the last loading week run before the window (the plan was run exactly)
        const lastRun = before.weeks
          .filter((w) => w.weekStart < OPENING && !w.isRecovery && !w.isTaper)
          .at(-1)!
        const run = planMinutes(before).get(lastRun.weekStart)!
        const after = loadingAfter(step.draft, OPENING)
        // J7: 100% of the week before the break, then the normal limits: the week after the touched
        // one is not under it, and none passes the plan before the window
        expect(minutes.get(after[0]!.weekStart)!).toBeGreaterThanOrEqual(run)
        for (const week of after) {
          expect(week.targetRunMin, week.weekStart).toBeLessThanOrEqual(
            target(before, week.weekStart),
          )
        }
      },
    )
  })
})

describe('the restart week of a hold is cut from a week the window left [rules E3, J7, J9]', () => {
  // Found by the review of RF2 (2026-11-01). The cut of a recovery week was taken from the loading
  // week before it, and for a restart week that is still ahead that week is the part week the
  // window has just capped: on the hot-race chain with a niggle of 14 days from 2026-11-22 the
  // restart week of 2026-12-07 planned 24 minutes against 247 before, and `holdRestartWeeks` made it
  // the whole baseline of the weeks after it (22, 22, 22 ...). The cut is taken from the figure the
  // touched week has without the window, or from the last loading week the window left; the restart
  // week is the lesser of that cut and the J7 share, and it is a baseline only when the share holds it.
  //
  // Each case reports the window on a Monday of four in a row, the Saturday before, so that every
  // alignment of the recovery cadence with the return is read, and re-plans every Monday until the
  // one before the restart week. The restart week is not under three quarters of the J7 share, or, as
  // a recovery week, of the lesser of the share and the E3 cut of the last loading week before the
  // window. Each of the next four loading weeks is at least the restart week as placed and at least
  // half of the lesser of the plan before and the reference week.
  //
  // STILL PINNED (RF4), found by the second review of RF2: three re-plans of the half-marathon
  // athlete after a hold of 21 days leave a loading week a few percent under that half (92 against
  // 101, 99 against 107, 115 against 124 minutes). The J7 return week of such a hold is prorated by
  // its open days and plans a couple of runs of about 28 and 20 minutes; they are the only runs in the
  // 30-day reference of G-1 when the restart week is placed, so its runs stay under 1.1 times the
  // longest of them (three runs of 30 minutes, 84 to 105 placed against a target of 147 to 169), and
  // the weeks after it grow from the minutes placed. It is the prorated return week taken with G-1,
  // not the window code: the same activities with no window reported plan the restart week lower
  // still (52 minutes in the case of 2026-12-07). Each case is listed by its re-plan; a case that fails and is
  // not listed fails the test, and a listed one that passes does too.
  const STILL_PINNED: Record<string, string[]> = {
    'half, 21 days': [
      'half, 21 days from 2026-11-14, re-plan of 2026-11-30',
      'half, 21 days from 2026-11-21, re-plan of 2026-12-07',
      'half, 21 days from 2026-12-05, re-plan of 2026-12-21',
    ],
  }
  const REPORT_MONDAYS = [4, 5, 6, 7].map((n) => addDays(mondayOf(TODAY), 7 * n))
  const CUT = 1 - P.e3.recoveryWeekCutPct.value / 100
  const target = (plan: PlanDraft, weekStart: string) =>
    plan.weeks.find((w) => w.weekStart === weekStart)!.targetRunMin
  const weeksBetween = (from: string, to: string) =>
    Math.round((Date.parse(to) - Date.parse(from)) / (7 * 864e5))
  const loadingWeeks = (plan: PlanDraft, after: string) =>
    plan.weeks
      .filter((w) => w.weekStart > after)
      .filter((w) => !w.isRecovery && !w.isTaper && w.phase !== 'race')
      .filter((w) => !w.flags.includes('post-race'))
      .slice(0, 4)

  describe.each(['hot-race', 'half', 'marathon', 'first-100-mile'])('%s', (id) => {
    it.each([10, 15, 21])(
      'plans the restart week and the weeks after it from the weeks the window left, after a hold of %i days',
      (days) => {
        const weakCases: string[] = []
        for (const monday of REPORT_MONDAYS) {
          const start = addDays(monday, -2)
          const window = windowOf({
            id: 'cut',
            reason: 'niggle',
            startDate: start,
            endDate: addDays(start, days - 1),
            pain: 0,
          })
          const touched = windowedWeeks(disruptionPlan([window]))
          const hold = disruptionPlan([window]).holds[0]!
          const restart = hold.fullWeekStart
          const reportStep = weeksBetween(mondayOf(TODAY), monday)
          // the last re-plan that sees the restart week ahead is the one a week before it
          const lastStep = reportStep + weeksBetween(monday, restart) - 1
          const chain = replanChain(byId(id).input, { windows: [window], maxSteps: lastStep })
          const planBefore = chain[reportStep - 1]!.draft
          const lastLoading = planBefore.weeks
            .filter((w) => w.weekStart < mondayOf(hold.from))
            .filter((w) => !w.isRecovery && !w.isTaper && !touched.includes(w.weekStart))
            .at(-1)!
          const cut = Math.floor(lastLoading.targetRunMin * CUT + 1e-9)
          for (let s = reportStep; s <= lastStep; s += 1) {
            const step = chain[s]!
            const where = `${id}, ${days} days from ${start}, re-plan of ${step.input.today}`
            const run = new Map(estimateState(step.input).weeks.map((w) => [w.weekStart, w.runMin]))
            const reference = holdReference(hold, (w) => run.get(w))
            const share = Math.floor(reference * hold.fraction + 1e-9)
            const row = step.draft.weeks.find((w) => w.weekStart === restart)!
            const bound = row.isRecovery ? Math.min(share, cut) : share
            expect(row.targetRunMin, `${where}: the restart week`).toBeGreaterThanOrEqual(
              0.75 * bound,
            )
            const placed = planMinutes(step.draft).get(restart) ?? 0
            const weak = loadingWeeks(step.draft, restart).some((week) => {
              const was = planBefore.weeks.find((w) => w.weekStart === week.weekStart)!
              return (
                week.targetRunMin < placed ||
                week.targetRunMin < 0.5 * Math.min(was.targetRunMin, reference)
              )
            })
            if (weak) weakCases.push(where)
          }
        }
        expect(weakCases).toEqual(STILL_PINNED[`${id}, ${days} days`] ?? [])
      },
      240_000,
    )
  })

  it('keeps the weeks after a niggle of 14 days from 2026-11-22 near the plan at every re-plan (hot-race)', () => {
    // the reviewer's case: step 5 planned R24 L22 L22 L22 against R247 L330, and step 7 collapsed again
    const window = windowOf({
      id: 'w',
      reason: 'niggle',
      startDate: '2026-11-22',
      endDate: '2026-12-05',
      pain: 0,
    })
    const chain = replanChain(byId('hot-race').input, { windows: [window], maxSteps: 10 })
    const before = chain[4]!.draft
    const restart = '2026-12-07'
    for (let s = 5; s <= 10; s += 1) {
      const step = chain[s]!
      const where = `re-plan of ${step.input.today}`
      expect(
        step.draft.weeks.find((w) => w.weekStart === restart)!.targetRunMin,
        where,
      ).toBeGreaterThanOrEqual(0.5 * target(before, restart))
      for (const week of loadingWeeks(step.draft, restart)) {
        expect(week.targetRunMin, `${where}: ${week.weekStart}`).toBeGreaterThanOrEqual(
          0.5 * target(before, week.weekStart),
        )
      }
    }
  }, 240_000)
})

describe('the taper is cut from the week as it has no window [rules K2, J9]', () => {
  // Found by the second review of RF2 (2026-11-01). The taper was held below the week before it as
  // placed (`before.at(-1).targetRunMin - 1`), so a window in the last loading week, which shrinks or
  // empties that week, took the taper down with it: the half-marathon athlete planned 0 minutes in
  // both taper weeks after a hold of 7 days, and the marathon athlete 0, 0, 0 (the checklist's taper
  // item failed). The taper now falls from the figure the part week has without the window, as the
  // cut of a recovery week does, and the checklist reads the fall from the last week no window touched.
  //
  // The window opens on the Monday of the last loading week before the taper, so that a hold of 3 days
  // leaves the taper week alone, one of 7 days ends on the Sunday and sends the taper week back as
  // the return week, and one of 10 and one of 15 days run into it (3 and 7 days of it held). The
  // half-marathon athlete tapers over 2 weeks (the race week is the second) and the marathon athlete
  // over 3.
  const HOLDS = [3, 7, 10, 15]
  const UNEQUAL_DAYS = 0.9

  describe.each([
    ['half', 2],
    ['marathon', 3],
  ])('%s, a taper of %i weeks', (id, weeks) => {
    const athlete = byId(id)
    const base = buildPlan(athlete.input)
    const taperWeeks = base.weeks.filter(
      (w) => (w.isTaper || w.phase === 'race') && !w.flags.includes('post-race'),
    )
    const first = taperWeeks[0]!
    const lastLoading = base.weeks
      .filter((w) => w.weekStart < first.weekStart && !w.isRecovery && !w.isTaper)
      .at(-1)!

    it('has the taper the case is about', () => {
      expect(taperWeeks).toHaveLength(weeks)
      expect(first.isTaper).toBe(true)
    })

    it.each(HOLDS)(
      'holds the first taper week up after a hold of %i days from the Monday of the last loading week',
      (days) => {
        const window = windowOf({
          id: 'taper',
          reason: 'travel',
          startDate: lastLoading.weekStart,
          endDate: addDays(lastLoading.weekStart, days - 1),
        })
        const dplan = disruptionPlan([window])
        const plan = buildPlan(withWindows(athlete, window))
        const week = plan.weeks.find((w) => w.weekStart === first.weekStart)!
        // the days of the taper week the window holds, and the J7 fraction when the window sends the
        // runner back in it
        const lost = dplan.days.filter(
          (d) => d.held && d.date >= first.weekStart && d.date <= addDays(first.weekStart, 6),
        ).length
        const hold = dplan.holds.find(
          (h) => h.returnWeekStart === first.weekStart || h.fullWeekStart === first.weekStart,
        )
        const fraction = hold === undefined ? 1 : hold.fraction
        // a day's minutes are not an equal share of the week (the long run weighs more)
        const floor = Math.floor(first.targetRunMin * ((7 - lost) / 7) * fraction * UNEQUAL_DAYS)
        expect(week.targetRunMin, `${days} days: ${lost} of 7 days held`).toBeGreaterThanOrEqual(
          floor,
        )
        if (lost === 0 && fraction === 1) {
          // a window that leaves the taper week alone leaves its K2 figure alone: not under the
          // multiplier of the last loading week no window touched
          const untouched = plan.weeks
            .filter((w) => w.weekStart < lastLoading.weekStart && !w.isRecovery && !w.isTaper)
            .at(-1)!
          const multiplier = taperMultipliers(weeks)[0]!
          expect(week.targetRunMin).toBeGreaterThanOrEqual(
            Math.floor(untouched.targetRunMin * multiplier * UNEQUAL_DAYS),
          )
        }
        // and the taper still falls week by week, as the checklist reads it
        expect(plan.checklist.find((c) => c.id === 'taper')!.ok).toBe(true)
      },
    )
  })
})

describe('the long run of the week in progress keeps its pace [rules J7, J9, g-1]', () => {
  // Found by the second review of RF2 (2026-11-01). `remainingOfWeek` held the long run to the
  // minutes left in the week but scaled its distance by the share of the whole week, so the return
  // week of a hold of 21 days, planned as the week in progress, got a long run of 28 minutes over
  // 1633 m (17 minutes a kilometre, where the plan's other long runs sit near 6). Once the runs before
  // the hold had aged out of the 30-day reference of G-1 it was the only distance in it, the distance
  // limit fell to about 2100 m, and the restart week placed three runs of 12 minutes (36 of 169).
  // The distance now follows the minutes. Every long run with a distance, in the weeks ahead of every
  // re-plan, is within 15% of the median pace of the long runs of its plan.
  const PACE_BAND = 0.15
  const minPerKm = (s: SessionSpec) => s.durationMin / (s.distanceM! / 1000)

  it.each(['half', 'hot-race', 'marathon', 'first-100-mile', 'masters'])(
    'plans the long runs of %s, with a hold of 21 days, at one pace',
    (id) => {
      let checked = 0
      for (const n of [4, 6]) {
        const monday = addDays(mondayOf(TODAY), 7 * n)
        const start = addDays(monday, -2)
        const window = windowOf({
          id: 'pace',
          reason: 'niggle',
          startDate: start,
          endDate: addDays(start, 20),
          pain: 0,
        })
        const chain = replanChain(byId(id).input, { windows: [window], maxSteps: n + 4 })
        for (const step of chain.slice(n)) {
          const longRuns = step.draft.sessions.filter(
            (s) =>
              (s.kind === 'long' || s.kind === 'long-fast-finish') &&
              s.date >= step.input.today &&
              s.durationMin > 0 &&
              s.distanceM !== null &&
              s.distanceM > 0,
          )
          if (longRuns.length === 0) continue
          const paces = longRuns.map(minPerKm).sort((a, b) => a - b)
          const median = paces[Math.floor(paces.length / 2)]!
          for (const run of longRuns) {
            checked += 1
            expect(
              minPerKm(run),
              `${id}, re-plan of ${step.input.today}, ${run.date}: ${run.durationMin} min over ${run.distanceM} m`,
            ).toBeLessThanOrEqual(median * (1 + PACE_BAND))
            expect(minPerKm(run)).toBeGreaterThanOrEqual(median * (1 - PACE_BAND))
          }
        }
      }
      expect(checked).toBeGreaterThan(10)
    },
    120_000,
  )
})

describe('the taper of a build that still rises falls below the last week no window touched [rules K2, J9, G6]', () => {
  // Found by the third review of RF2 (2026-11-01), a regression of the taper cut: the engine cut the
  // first taper week from the figure the touched last loading week has without the window, and the
  // checklist reads the fall from the last week no window touched. They agree while the loading
  // weeks plateau. A hold earlier in the plan holds a build back so that its weeks still climb into
  // the taper, and a short window in the last loading week then left the first taper week above the
  // last untouched week: the plan failed its own `taper` item and `applyReplan` answered 422. The
  // taper is cut from the lesser of the two (G6: of two readings, the more conservative).
  const LENGTHS = [1, 3]
  const OFFSETS = [0, 2, 4]

  describe.each([
    ['half', 28, 7],
    ['marathon', 28, 7],
    ['returning', 21, 7],
  ])('%s, a niggle of %i days %i weeks before the taper', (id, hold, weeksBefore) => {
    const athlete = byId(id)
    const base = buildPlan(athlete.input)
    const first = base.weeks.find((w) => w.isTaper)!
    const lastLoading = base.weeks
      .filter((w) => w.weekStart < first.weekStart && !w.isRecovery && !w.isTaper)
      .at(-1)!
    const start = addDays(first.weekStart, -7 * weeksBefore - 2)
    const niggle = windowOf({
      id: 'a',
      reason: 'niggle',
      startDate: start,
      endDate: addDays(start, hold - 1),
      pain: 0,
    })

    it('has loading weeks that still rise into the taper', () => {
      const plan = buildPlan(withWindows(athlete, niggle))
      const loading = plan.weeks.filter(
        (w) => w.weekStart <= lastLoading.weekStart && !w.isRecovery && !w.isTaper,
      )
      expect(loading.at(-1)!.targetRunMin).toBeGreaterThan(loading.at(-2)!.targetRunMin)
    })

    it.each(LENGTHS.flatMap((length) => OFFSETS.map((offset) => [length, offset] as const)))(
      'passes the taper item after a travel window of %i days at +%i days of the last loading week',
      (length, offset) => {
        const from = addDays(lastLoading.weekStart, offset)
        const travel = windowOf({
          id: 'b',
          reason: 'travel',
          startDate: from,
          endDate: addDays(from, length - 1),
        })
        const plan = buildPlan(withWindows(athlete, niggle, travel))
        const taper = plan.checklist.find((c) => c.id === 'taper')!
        expect(taper.ok, taper.detail).toBe(true)
        const untouched = plan.weeks
          .filter(
            (w) => w.weekStart < first.weekStart && !w.isRecovery && !isDisruptedWeek(w.flags),
          )
          .at(-1)!
        const week = plan.weeks.find((w) => w.weekStart === first.weekStart)!
        expect(week.targetRunMin).toBeLessThan(untouched.targetRunMin)
      },
    )
  })
})

describe('the taper under way keeps the reference of the plan before the window [rules K2, J9]', () => {
  // Found by the third review of RF2 (2026-11-01). When the first taper week is the current week the
  // plan has no pre-taper week to draw, and the K2 reference was the level the runner starts from,
  // the median of the last four weeks. A part week a window left in the last loading week pulled it
  // down and every taper week with it, though the window held none of their days: the half-marathon
  // athlete, a travel window of 3 days in the last loading week, planned 153 and 94 against 175 and
  // 108 at the re-plan of 2027-02-15; the marathon athlete 216, 158 and 101 against 247, 181 and 115
  // at 2027-02-22. The reference is now the last loading week the window did not touch.
  //
  // The chain is re-planned on every Monday to the race, each week run as planned; at every step each
  // taper week no window touched is at least the same week of the chain with no window, less the
  // share of its days the window holds (none: the window is in the last loading week).
  const lostShare = (window: DisruptionWindow, weekStart: string) => {
    const held = disruptionPlan([window]).days.filter(
      (d) => d.held && d.date >= weekStart && d.date <= addDays(weekStart, 6),
    )
    return held.length / 7
  }

  it.each([
    ['half', 2],
    ['marathon', 3],
  ])('plans the taper of %s, a taper of %i weeks, as the plan with no window does', (id, weeks) => {
    const athlete = byId(id)
    const base = buildPlan(athlete.input)
    const taper = base.weeks.filter(
      (w) => (w.isTaper || w.phase === 'race') && !w.flags.includes('post-race'),
    )
    expect(taper).toHaveLength(weeks)
    const lastLoading = base.weeks
      .filter((w) => w.weekStart < taper[0]!.weekStart && !w.isRecovery && !w.isTaper)
      .at(-1)!
    const window = windowOf({
      id: 'taper-chain',
      reason: 'travel',
      startDate: lastLoading.weekStart,
      endDate: addDays(lastLoading.weekStart, 2),
    })
    const without = replanChain(athlete.input)
    const withWindow = replanChain(athlete.input, { windows: [window] })
    expect(withWindow).toHaveLength(without.length)
    let compared = 0
    withWindow.forEach((step, k) => {
      if (step.input.today < lastLoading.weekStart) return
      for (const week of step.draft.weeks) {
        if (!week.isTaper || week.flags.includes('post-race') || isDisruptedWeek(week.flags))
          continue
        if (week.weekStart < mondayOf(step.input.today)) continue
        const plain = without[k]!.draft.weeks.find((w) => w.weekStart === week.weekStart)!
        compared += 1
        expect(
          week.targetRunMin,
          `${id}, re-plan of ${step.input.today}, ${week.weekStart}`,
        ).toBeGreaterThanOrEqual(
          Math.floor(plain.targetRunMin * (1 - lostShare(window, week.weekStart))),
        )
      }
    })
    expect(compared).toBeGreaterThan(weeks)
  })
})

describe('the checklist accepts every re-plan after a hold of 21 or 28 days [rules E3, K2, J9, G-2]', () => {
  // Found by the third review of RF2 (2026-11-01). With the long run's distance following its minutes
  // (67331196) re-plans that had been refused for another reason stopped failing, and 26 newly failed
  // the checklist, so `applyReplan` answered 422 and wrote nothing, in four chains: the week after
  // the restart week above what the 30% ceiling allows (trail-50k, first-100-mile), a recovery week
  // not cut 20% from the week before it that the chain kept to the race (sparse-100-mile), and a
  // race week standing above the first taper week (reds-hold). Three readings differed between the
  // generator and the checklist, which refuses a draft: the restart week the J7 share holds is read
  // by the figure its row will stand at (for the week in progress, the figure of the plan being
  // replaced that holds it, not the minutes left to place); a recovery week or a race week after the
  // week in progress is cut from that row and not from the week drawn; the recovery week in progress is
  // cut from the loading week before it as it stands; and the restart floor week, a block of its own
  // for the generator, is one for the cadence item too.
  //
  // Two start Mondays of each of the four athletes, a niggle of 21 or 28 days that opens on the
  // Saturday before; every re-plan to the race passes the checklist. The grid of 12 athletes, holds
  // of 7, 14, 21 and 28 days and every start Monday is `window-grids.test.ts`, by hand.
  const CASES: Array<[string, number, number]> = [
    ['trail-50k', 21, 2],
    ['trail-50k', 28, 4],
    ['first-100-mile', 21, 4],
    ['first-100-mile', 28, 17],
    ['sparse-100-mile', 21, 4],
    ['sparse-100-mile', 28, 6],
    ['reds-hold', 28, 1],
    ['reds-hold', 28, 13],
  ]

  it.each(CASES)(
    'passes the checklist at every re-plan of %s, a niggle of %i days from the Monday %i weeks on',
    (id, days, weeksOn) => {
      const start = addDays(addDays(mondayOf(TODAY), 7 * weeksOn), -2)
      const window = windowOf({
        id: 'chain',
        reason: 'niggle',
        startDate: start,
        endDate: addDays(start, days - 1),
        pain: 0,
      })
      const chain = replanChain(byId(id).input, { windows: [window] })
      const failing = chain.flatMap((step) =>
        step.draft.checklist
          .filter((c) => !c.ok)
          .map((c) => `re-plan of ${step.input.today}: ${c.id}: ${c.detail}`),
      )
      expect(failing).toEqual([])
      expect(chain.length).toBeGreaterThan(weeksOn + days / 7)
    },
    120_000,
  )
})

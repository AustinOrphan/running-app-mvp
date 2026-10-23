// Rest windows in the engine [phase 3a design 9.5, rule J9]: how windows reach the week placement,
// the caps, the re-plan, the injury profile and the checklist. The window geometry itself is
// pinned in disruption.test.ts; the seeded sweep over every matrix athlete is
// disruption-sweep.test.ts.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { dayRuleOn, disruptionPlan, illnessDays } from '../../../shared/engine/disruption.ts'
import { matchSessions } from '../../../shared/engine/execution.ts'
import { applyGuards } from '../../../shared/engine/guards.ts'
import { buildPlan, keptByReplan, replan, runChecklist } from '../../../shared/engine/index.ts'
import { injuryTight, tightRamp, weeklyRamp } from '../../../shared/engine/limits.ts'
import { startPath } from '../../../shared/engine/macro.ts'
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

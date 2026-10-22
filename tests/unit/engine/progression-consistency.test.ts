// Progression consistent by construction (task E21): the macrocycle and the week placement plan
// inside the limits the guards check, so a generated plan needs no trimming [rules g-1 to g-3, H2
// to H4]; the part current week is no ramp baseline; a re-plan keeps owner edits; focal bone pain
// holds progression [rules n-1]; hold and reduce decisions reach the sessions [rules J5].
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { feasibility } from '../../../shared/engine/goal.ts'
import { breakRestart } from '../../../shared/engine/adapt.ts'
import { applyGuards } from '../../../shared/engine/guards.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { macroPlan } from '../../../shared/engine/macro.ts'
import type { EngineInput, PlanDraft, SessionSpec } from '../../../shared/engine/types.ts'
import type { WeekRow } from '../../../shared/types.ts'
import { session, state } from './e6-fixtures.ts'
import { activity, wellnessDay } from './e8-fixtures.ts'
import { athletes, TODAY, type MatrixAthlete } from './matrix-fixtures.ts'

/** Warnings a generated plan never carries: each one means the plan was trimmed after the fact. */
const TRIMMED = new Set([
  'spike-shortened',
  'spike-run-dropped',
  'spike-warn',
  'spike-override',
  'spike-hard-limit',
  'ramp-ceiling',
  'ramp-soft',
  'ramp-tightened',
  'ramp-run-dropped',
  'gain-ramp-soft',
  'ultra-run-cap',
  'b2b-day2-cap',
  'b2b-total-cap',
  'b2b-removed',
])
const RUNNING = new Set([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'b2b',
])
const MONDAY = '2026-10-19'

type Existing = NonNullable<EngineInput['existing']>

const trimmed = (plan: PlanDraft) =>
  plan.warnings.filter((w) => TRIMMED.has(w.code)).map((w) => `${w.code}: ${w.message}`)
const failed = (plan: PlanDraft) =>
  plan.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)
const minutesIn = (sessions: SessionSpec[], weekStart: string) =>
  sessions
    .filter((s) => mondayOf(s.date) === weekStart && RUNNING.has(s.kind))
    .reduce((n, s) => n + s.durationMin, 0)

const asExisting = (plan: PlanDraft, today: string): Existing => ({
  weeks: plan.weeks,
  sessions: plan.sessions.map((s, i) => ({
    ...s,
    id: `s${i}`,
    status: s.date < today ? 'completed' : 'planned',
    activityId: null,
  })),
})

const all = athletes()

describe.each(all)('generated plan inside the limits: $label', (a: MatrixAthlete) => {
  for (let offset = 0; offset < 7; offset++) {
    const today = addDays(MONDAY, offset)
    it(`carries no trimming warning and passes the checklist when made on ${today}`, () => {
      const plan = buildPlan({ ...a.input, today })
      expect(trimmed(plan)).toEqual([])
      expect(failed(plan)).toEqual([])
    })
  }

  it('is a no-op for the guards: checking the finished sessions again changes nothing', () => {
    const plan = buildPlan(a.input)
    const st = estimateState(a.input)
    const runs = plan.sessions.filter((s) => s.kind !== 'race')
    const again = applyGuards(runs, st, a.input.activities, {
      ultraRaceDurationSec: a.input.goal.isUltra ? a.input.goal.expectedDurationSec : null,
      neverOverride: true,
      lowWeeks: plan.weeks.filter((w) => w.isRecovery || w.isTaper).map((w) => w.weekStart),
      restartFloor: (() => {
        const floor = plan.weeks.find((w) => w.flags.includes('restart-floor'))
        return floor === undefined
          ? null
          : { weekStart: floor.weekStart, minutes: floor.targetRunMin }
      })(),
    })
    expect(again.warnings.filter((w) => TRIMMED.has(w.code))).toEqual([])
    expect(again.sessions.map((s) => s.durationMin)).toEqual(runs.map((s) => s.durationMin))
  })

  it('plans the weeks the macrocycle drew: no week lowered after the fact', () => {
    // the state the generator plans from: after a break the typical week is the restart volume
    const raw = estimateState(a.input)
    const st =
      raw.layoffDays >= 7 && raw.typicalWeekMin > 0
        ? {
            ...raw,
            typicalWeekMin: Math.min(
              raw.typicalWeekMin,
              breakRestart(raw.layoffDays, raw.typicalWeekMin).restartMin,
            ),
          }
        : raw
    const macro = macroPlan(a.input, st, a.input.goal, feasibility(a.input.goal, st, TODAY))
    const plan = buildPlan(a.input)
    const lowered = plan.weeks
      .filter((w) => w.weekStart > mondayOf(TODAY))
      .filter((w) => {
        const drawn = macro.find((m) => m.weekStart === w.weekStart)
        return drawn !== undefined && w.targetRunMin < drawn.targetRunMin
      })
      .map((w) => w.weekStart)
    expect(lowered).toEqual([])
  })
})

describe('sparse history, first 100-mile: adequate as well as clean', () => {
  const a = all.find((x) => x.id === 'sparse-100-mile')!

  for (let offset = 0; offset < 7; offset++) {
    const today = addDays(MONDAY, offset)
    it(`reaches 6 h in the last specific week and a run of 3 h when made on ${today}`, () => {
      const plan = buildPlan({ ...a.input, today })
      const last = plan.weeks.filter((w) => w.phase === 'specific' && !w.isRecovery).at(-1)!
      expect(minutesIn(plan.sessions, last.weekStart)).toBeGreaterThanOrEqual(360)
      const longest = Math.max(
        ...plan.sessions.filter((s) => RUNNING.has(s.kind)).map((s) => s.durationMin),
      )
      expect(longest).toBeGreaterThanOrEqual(180)
    })
  }
})

describe('weekly re-plans across 12 Mondays', () => {
  for (const id of ['sparse-100-mile', 'half', 'first-100-mile']) {
    it(`${id}: keeps progressing, keeps the specific phase and stays clean`, () => {
      const a = all.find((x) => x.id === id)!
      const first = buildPlan(a.input)
      let plan = first
      let activities = a.input.activities
      let monday = addDays(mondayOf(a.input.today), 7)
      for (let k = 0; k < 12; k++) {
        const ran = plan.sessions
          .filter((s) => s.date >= addDays(monday, -7) && s.date < monday && RUNNING.has(s.kind))
          .map((s) =>
            activity(s.date, {
              id: `done-${s.date}-${s.order}`,
              durationSec: s.durationMin * 60,
              movingSec: s.durationMin * 60,
              distanceM: s.distanceM ?? Math.round(s.durationMin * 166),
              elevationGainM: s.gainM,
              elevationLossM: s.gainM,
              rpe: 3,
            }),
          )
        activities = [...activities, ...ran]
        plan = replan({
          ...a.input,
          today: monday,
          activities,
          existing: asExisting(plan, monday),
        }).draft
        expect(trimmed(plan), `re-plan of ${monday}`).toEqual([])
        expect(failed(plan), `re-plan of ${monday}`).toEqual([])
        monday = addDays(monday, 7)
      }
      // The loading weeks run so far never fall below the loading week before them.
      const loading = plan.weeks.filter(
        (w) => w.weekStart < monday && !w.isRecovery && !w.isTaper && w.phase !== 'race',
      )
      for (let i = 1; i < loading.length; i++) {
        expect(loading[i]!.targetRunMin, loading[i]!.weekStart).toBeGreaterThanOrEqual(
          loading[i - 1]!.targetRunMin,
        )
      }
      // The re-plans keep the volume the first plan drew for the weeks ahead.
      const peak = (p: PlanDraft) =>
        Math.max(
          ...p.weeks.filter((w) => !w.isTaper && w.phase !== 'race').map((w) => w.targetRunMin),
        )
      expect(peak(plan)).toBeGreaterThanOrEqual(peak(first) * 0.9)
      const firstSpecific = first.weeks.find((w) => w.phase === 'specific')!.weekStart
      expect(
        plan.weeks.filter(
          (w) =>
            w.weekStart >= firstSpecific &&
            !w.isTaper &&
            w.phase !== 'race' &&
            w.phase !== 'specific',
        ),
      ).toEqual([])
    })
  }
})

describe('the part current week is never a ramp baseline [rules g-2]', () => {
  const row = (weekStart: string, runMin: number): WeekRow => ({
    weekStart,
    runMin,
    runM: 0,
    runSessions: 4,
    runDays: 4,
    strengthSessions: 0,
    crossMin: 0,
    raceMin: 0,
    longestRunMin: 0,
    longRunShare: null,
    avg4wRunMin: runMin,
    streak3Plus: 0,
  })
  // Wednesday 2026-11-04; 120 min were run on Monday and Tuesday of the current week.
  const st = state({
    asOf: '2026-11-04',
    weeks: [row('2026-10-19', 200), row('2026-10-26', 200), row('2026-11-02', 120)],
  })
  const thisWeek = [1, 2].map((d) =>
    session({ date: addDays('2026-11-02', d + 1), durationMin: 50 }),
  )
  const nextWeek = (min: number) =>
    [0, 1, 3, 5].map((d) => session({ date: addDays('2026-11-09', d), durationMin: min }))

  it('measures next week against the completed full weeks, whatever has been logged', () => {
    // 120 done + 100 planned = 220 this week; the baseline is still 200, so 4 x 60 = 240 warns.
    const over = applyGuards([...thisWeek, ...nextWeek(60)], st, [])
    expect(over.warnings.map((w) => w.code)).toContain('ramp-soft')
    const fits = applyGuards([...thisWeek, ...nextWeek(55)], st, [])
    expect(fits.warnings.filter((w) => w.code.startsWith('ramp'))).toEqual([])
  })

  it('is still a baseline when the plan starts on its Monday', () => {
    const monday = state({
      asOf: '2026-11-02',
      weeks: [row('2026-10-19', 200), row('2026-10-26', 200)],
    })
    const week = [0, 2, 4, 6].map((d) =>
      session({ date: addDays('2026-11-02', d), durationMin: 55 }),
    )
    const out = applyGuards([...week, ...nextWeek(60)], monday, [])
    // base for the next week is this full week (220); 240 is within 10%
    expect(out.warnings.filter((w) => w.code.startsWith('ramp'))).toEqual([])
  })
})

describe('a re-plan keeps owner edits of the next 14 days', () => {
  const a = all.find((x) => x.id === 'half')!
  const plan = buildPlan(a.input)
  const nextMonday = addDays(mondayOf(TODAY), 7)
  const base = asExisting(plan, TODAY)
  const inWeek = base.sessions.filter((s) => mondayOf(s.date) === nextMonday && RUNNING.has(s.kind))
  const easy = inWeek.filter((s) => s.kind === 'easy')
  const quality = inWeek.find((s) =>
    ['threshold', 'intervals', 'hills', 'race-pace', 'strides'].includes(s.kind),
  )!
  const skipped = easy[0]!
  const free = [0, 1, 2, 3, 4, 5, 6]
    .map((d) => addDays(nextMonday, d))
    .find(
      (date) =>
        !base.sessions.some((s) => s.date === date) &&
        !base.sessions.some((s) => s.date === addDays(date, -1) && s.kind !== 'easy') &&
        !base.sessions.some((s) => s.date === addDays(date, 1) && s.kind !== 'easy'),
    )
  const moved = easy[1]!
  const trimmedSession: SessionSpec = {
    ...quality,
    durationMin: quality.durationMin - 5,
    rules: [...quality.rules, 'design-4.3'],
  }
  const existing: Existing = {
    weeks: base.weeks,
    sessions: base.sessions.map((s) => {
      if (s.id === skipped.id) return { ...s, status: 'skipped' }
      if (s.id === moved.id && free !== undefined) return { ...s, date: free, status: 'moved' }
      if (s.id === quality.id)
        return { ...trimmedSession, id: s.id, status: 'downgraded', activityId: null }
      return s
    }),
  }
  const out = replan({ ...a.input, existing })
  const keep = existing.sessions.filter((s) =>
    ['skipped', 'moved', 'downgraded'].includes(s.status),
  )

  it('has edits to keep', () => {
    expect(free).toBeDefined()
    expect(keep).toHaveLength(3)
  })

  it('keeps each edited session as it is and plans nothing else on its day', () => {
    for (const s of keep) {
      const same = out.draft.sessions.filter((x) => x.date === s.date && RUNNING.has(x.kind))
      expect(same, `${s.date} ${s.status}`).toHaveLength(1)
      expect(same[0]).toMatchObject({ kind: s.kind, durationMin: s.durationMin })
    }
  })

  it('plans the rest of the week around them without making up the skipped run', () => {
    const before = minutesIn(base.sessions, nextMonday)
    const after = minutesIn(out.draft.sessions, nextMonday)
    // the skipped run is still listed but not run; the trim's 5 minutes are not put back either
    expect(after - skipped.durationMin).toBeLessThanOrEqual(before - skipped.durationMin - 5)
    expect(failed(out.draft)).toEqual([])
    expect(trimmed(out.draft)).toEqual([])
  })
})

describe('focal bone pain holds progression [rules n-1]', () => {
  const a = all.find((x) => x.id === 'trail-50k')!
  const pain = [wellnessDay(addDays(TODAY, -1), { painFocalBone: true, painScore: 3 })]
  const held = buildPlan({ ...a.input, wellness: pain })
  const open = buildPlan(a.input)
  const loading = (p: PlanDraft) =>
    p.weeks.filter(
      (w) => !w.isRecovery && !w.isTaper && w.phase !== 'race' && !w.flags.includes('post-race'),
    )

  it('warns once with a hold and a clinician prompt', () => {
    const warnings = held.warnings.filter((w) => w.code === 'focal-bone-hold')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.severity).toBe('hold')
    expect(warnings[0]!.message).toMatch(/clinician/i)
    expect(warnings[0]!.rules).toContain('n-1')
    expect(open.warnings.some((w) => w.code === 'focal-bone-hold')).toBe(false)
  })

  it('grows no weekly target, long run or gain target, and plans no back-to-back', () => {
    const weeks = loading(held)
    const first = weeks[0]!
    for (const w of weeks) {
      expect(w.targetRunMin, w.weekStart).toBeLessThanOrEqual(first.targetRunMin)
      expect(w.longRunMin, w.weekStart).toBeLessThanOrEqual(first.longRunMin)
      expect(w.gainTargetM ?? 0, w.weekStart).toBeLessThanOrEqual(first.gainTargetM ?? 0)
    }
    expect(held.sessions.some((s) => s.kind === 'b2b')).toBe(false)
    expect(Math.max(...loading(open).map((w) => w.targetRunMin))).toBeGreaterThan(
      first.targetRunMin,
    )
  })

  it('passes the checklist, its hold item included', () => {
    expect(failed(held)).toEqual([])
    expect(held.checklist.find((c) => c.id === 'bone-pain-hold')?.detail).toMatch(/hold/i)
  })

  it('holds a re-plan too, and lifts once a later check-in no longer reports it', () => {
    const later = addDays(TODAY, 7)
    const out = replan({
      ...a.input,
      today: later,
      wellness: pain,
      existing: asExisting(held, later),
    })
    expect(out.draft.warnings.some((w) => w.code === 'focal-bone-hold')).toBe(true)
    const cleared = replan({
      ...a.input,
      today: later,
      wellness: [...pain, wellnessDay(addDays(later, -1), { painFocalBone: false, painScore: 0 })],
      existing: asExisting(held, later),
    })
    expect(cleared.draft.warnings.some((w) => w.code === 'focal-bone-hold')).toBe(false)
  })
})

describe('hold and reduce decisions reach the sessions [rules J5]', () => {
  const a = all.find((x) => x.id === 'half')!
  const plan = buildPlan({ ...a.input, today: MONDAY })
  // the first loading week after the opening one that holds a quality session
  const later = plan.weeks.find(
    (w) =>
      w.index > 0 &&
      !w.isRecovery &&
      !w.isTaper &&
      plan.sessions.some(
        (s) =>
          mondayOf(s.date) === w.weekStart &&
          ['threshold', 'intervals', 'hills', 'race-pace'].includes(s.kind),
      ),
  )!.weekStart
  const input: EngineInput = { ...a.input, today: later, existing: asExisting(plan, later) }
  const open = replan(input).draft
  const quality = (p: PlanDraft) =>
    p.sessions.find(
      (s) =>
        mondayOf(s.date) === later &&
        ['threshold', 'intervals', 'hills', 'race-pace', 'long-fast-finish'].includes(s.kind),
    )

  it('a hold trims the next quality session of the following week, marked as a trim', () => {
    const held = replan(input, { decisions: { [later]: 'hold' } }).draft
    const before = quality(open)!
    const after = quality(held)!
    expect(after.date).toBe(before.date)
    expect(after.durationMin).toBeLessThan(before.durationMin)
    expect(after.rules).toContain('design-4.3')
    expect(before.rules).not.toContain('design-4.3')
    expect(held.sessions.filter((s) => s.rules.includes('design-4.3'))).toHaveLength(1)
    expect(failed(held)).toEqual([])
  })

  it('a week capped by a reduce decision is a recovery week', () => {
    const cap = Math.floor(open.weeks.find((w) => w.weekStart === later)!.targetRunMin * 0.7)
    const reduced = replan(
      { ...input, weekCaps: { [later]: cap } },
      { decisions: { [later]: 'reduce' } },
    ).draft
    const week = reduced.weeks.find((w) => w.weekStart === later)!
    expect(week.isRecovery).toBe(true)
    expect(week.flags).toContain('recovery')
    expect(week.targetRunMin).toBeLessThanOrEqual(cap)
    expect(open.weeks.find((w) => w.weekStart === later)!.isRecovery).toBe(false)
    expect(failed(reduced)).toEqual([])
  })
})

describe('a 30-day longest run too short for a run day [rules g-1, F5]', () => {
  const a = all.find((x) => x.id === 'half')!
  const short = a.input.activities.map((x) => ({
    ...x,
    durationSec: 13 * 60,
    movingSec: 13 * 60,
    distanceM: 2300,
  }))
  const plan = buildPlan({ ...a.input, activities: short })

  it('leaves the weeks it cannot fill empty and says so', () => {
    const empty = plan.weeks.filter(
      (w) => w.targetRunMin > 0 && minutesIn(plan.sessions, w.weekStart) === 0,
    )
    expect(empty.length).toBeGreaterThan(0)
    const warning = plan.warnings.find((w) => w.code === 'spike-run-dropped')
    expect(warning?.severity).toBe('info')
    expect(warning?.rules).toContain('g-1')
    expect(warning?.message).toContain(empty[0]!.weekStart)
  })
})

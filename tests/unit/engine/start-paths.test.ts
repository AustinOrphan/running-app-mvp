// The start paths [rules E6, G-3, A9, A5]: the run-walk ladder, the 3 x N floor and the
// injury-return ladder, from the choice of the path to the ladder weeks, the advance and hold at a
// re-plan, the sessions and the limits around them. Synthetic runners; no personal data.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { breakRestart, weekEvidence } from '../../../shared/engine/adapt.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { runChecklist } from '../../../shared/engine/checklist.ts'
import { feasibility } from '../../../shared/engine/goal.ts'
import { applyGuards } from '../../../shared/engine/guards.ts'
import { afterBreak, buildPlan, replan, weeklyDecision } from '../../../shared/engine/index.ts'
import { macroPlan, startLift, startPath } from '../../../shared/engine/macro.ts'
import { isProgramme, startLevelMin, startWeekMin } from '../../../shared/engine/limits.ts'
import { blockLift, loadPosition, type LoadHold } from '../../../shared/engine/loadSetting.ts'
import { placeWeek } from '../../../shared/engine/micro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { prescribe } from '../../../shared/engine/sessions.ts'
import {
  clipBlueprint,
  injuryLevel,
  rungCount,
  rungSessions,
  sessionMin,
  startSessionMinMin,
  startWeek,
  stepAt,
} from '../../../shared/engine/startWeeks.ts'
import type {
  Checkin,
  DisruptionWindow,
  EngineInput,
  LoadAppetite,
  SessionSpec,
  WeekDraft,
} from '../../../shared/engine/types.ts'
import type { Activity, AthleteProfile } from '../../../shared/types.ts'
import { ZONES } from './e6-fixtures.ts'
import { activity, input, planned, profile, TODAY, wellnessDay } from './e8-fixtures.ts'
import {
  at,
  h1,
  h26,
  h5,
  h6,
  h7,
  h7Twice,
  HISTORY_TODAY,
  s3Runs,
  s4Runs,
  s5Runs,
  scenario,
  SPARSE,
  summer,
  weeks,
  withTaperEnd,
} from './history-fixtures.ts'

const MONDAY = mondayOf(TODAY) // 2026-10-19; TODAY is the Wednesday of its week

const daysAgo = (n: number) => addDays(TODAY, -n)
const runOf = (daysBack: number, minutes: number, over: Partial<Activity> = {}) =>
  activity(daysAgo(daysBack), {
    id: `run-${String(daysBack)}-${String(minutes)}`,
    durationSec: minutes * 60,
    movingSec: minutes * 60,
    distanceM: Math.round(minutes * 160),
    ...over,
  })

/** The start path chosen for a runner described by a profile and a history. */
function pathOf(activities: Activity[], over: Partial<AthleteProfile> = {}) {
  const inp = input({ activities, profile: profile(over) })
  return startPath(inp, estimateState(inp))
}

const NOVICE: Partial<AthleteProfile> = { runningSinceYear: null }
const INJURY = {
  area: 'knee',
  side: 'left' as const,
  year: 2026,
  month: 6,
  kind: 'joint' as const,
  notes: null,
}

describe('the ladder data [rules E6]', () => {
  it('has nine rungs, as in the decisions table', () => {
    expect(rungCount()).toBe(9)
    expect(P.flib.runWalkWeeks.value).toBe(rungCount())
    // R1 is 1 min run and 2 min walk, 7 times: the ratio of the flib run-walk units
    expect(rungSessions(1)[0]).toEqual(Array(7).fill([1, 2]).flat())
    expect(P.flib.runWalkRunUnits.value).toBe(1)
    expect(P.flib.runWalkWalkUnits.value).toBe(2)
    expect(rungSessions(4)[0]).toEqual([3, 1.5, 5, 2.5, 3, 1.5, 5])
    expect(rungSessions(5)).toEqual([[5, 3, 5, 3, 5], [8, 5, 8], [20]])
    expect(rungSessions(6)).toEqual([[5, 3, 8, 3, 5], [10, 3, 10], [22]])
    expect([7, 8, 9].map((r) => rungSessions(r)[0])).toEqual([[25], [28], [30]])
  })

  it('has the weekly time on feet of the table, with rung 4 rounded per session', () => {
    const weekly = Array.from({ length: 9 }, (_, i) => startWeek('ladder', i + 1).minutes)
    // 63, 63, 54, 64.5 (three sessions of 21.5 min, each 22 min), 62, 69, 75, 84, 90
    expect(weekly).toEqual([63, 63, 54, 66, 62, 69, 75, 84, 90])
    // rung 9 is the old start floor, 3 x 30 min
    expect(weekly[8]).toBe(90)
    expect(startWeek('ladder', 1).minutes).toBe(P.macroDesign.startFloorWeekMin.value + 3)
  })

  it('numbers the rungs by the plan week, holds rung 1 for the BMI weeks, and ends after rung 9', () => {
    const steps = (holdWeeks: number) =>
      Array.from({ length: 12 }, (_, i) => stepAt({ kind: 'ladder', step: 1, holdWeeks }, i))
    expect(steps(0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, null, null, null])
    expect(steps(3)).toEqual([1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, null])
    expect(stepAt({ kind: 'floor', step: 25 }, 0)).toBe(25)
    expect(stepAt({ kind: 'floor', step: 25 }, 1)).toBeNull()
    expect(stepAt({ kind: 'injury-return', step: 4 }, 1)).toBe(5)
    expect(stepAt({ kind: 'injury-return', step: 4 }, 2)).toBeNull()
  })

  it('cuts a session to a limit from the end, and rounds its minutes', () => {
    expect(clipBlueprint([3, 1.5, 5, 2.5, 3, 1.5, 5], 12)).toEqual([3, 1.5, 5, 2.5])
    expect(clipBlueprint([3, 1.5, 5, 2.5, 3, 1.5, 5], 10)).toEqual([3, 1.5, 5, 0.5])
    expect(clipBlueprint([20], 16)).toEqual([16])
    expect(clipBlueprint([20], Infinity)).toEqual([20])
    expect(sessionMin([3, 1.5, 5, 2.5, 3, 1.5, 5])).toBe(22)
  })

  it('writes the grade, rule and evidence of every start-path parameter', () => {
    const params = [
      P.noviceLadder.rungs,
      P.noviceLadder.advanceMinCompletion,
      P.noviceLadder.holdRpe,
      P.noviceLadder.bmiHoldWeeks,
      P.noviceLadder.quietWeeksAfter,
      P.restartFloor.sessionMaxMin,
      P.restartFloor.lookbackDays,
      P.injuryReturn.levelsMin,
      P.injuryReturn.repeatsPerLevel,
      P.injuryReturn.restDaysBetween,
      P.a5.lowFrequencyRunsPerWeek,
      P.a5.lowFrequencyWindowWeeks,
      P.macroDesign.startFloorWeekMin,
    ]
    for (const p of params) {
      expect(p.rule, p.id).toMatch(/^(E6|g-3|A5)$/)
      expect(p.evidence.length, p.id).toBeGreaterThan(0)
    }
    expect(P.noviceLadder.rungs.grade).toBe('D')
    expect(P.noviceLadder.bmiHoldWeeks.grade).toBe('C')
    expect(P.noviceLadder.advanceMinCompletion.value).toBe(0.8)
    expect(P.noviceLadder.holdRpe.value).toBe(5)
    expect(P.noviceLadder.bmiHoldWeeks.value).toBe(3)
    expect(P.noviceLadder.quietWeeksAfter.value).toBe(2)
    expect(P.restartFloor.sessionMaxMin.value).toBe(30)
    expect(P.restartFloor.lookbackDays.value).toBe(30)
    expect(P.injuryReturn.levelsMin.value).toEqual([5, 10, 15, 20, 25, 30])
    expect(P.injuryReturn.repeatsPerLevel.value).toBe(2)
    expect(P.injuryReturn.restDaysBetween.value).toBe(1)
    expect(P.a5.lowFrequencyRunsPerWeek.value).toBe(2)
    expect(P.macroDesign.startFloorWeekMin.value).toBe(60)
  })
})

describe('startPath: the choice from history [rules E6, A9]', () => {
  it('sends a true novice with no run to rung 1', () => {
    expect(pathOf([], NOVICE)).toEqual({ kind: 'ladder', rung: 1, bmiHold: false })
  })

  it('enters the ladder by the longest run when a novice has only short runs', () => {
    // 15 min a few days ago: 1.10 x 15 = 16.5 min allows the 5-minute bouts of rung 4, not the 20
    const path = pathOf([runOf(3, 15), runOf(6, 15)], NOVICE)
    expect(path).toEqual({ kind: 'ladder', rung: 4, bmiHold: false })
  })

  it('lifts a returner with a 25-minute run in the last 30 days to 3 x 25', () => {
    const years3 = { runningSinceYear: 2023 }
    expect(pathOf([runOf(10, 25)], years3)).toEqual({ kind: 'floor', sessionMin: 25 })
    // the longest run is rounded down to 5 minutes and held to 30
    expect(pathOf([runOf(10, 29.9)], years3)).toEqual({ kind: 'floor', sessionMin: 25 })
    expect(pathOf([runOf(10, 55)], years3)).toEqual({ kind: 'floor', sessionMin: 30 })
  })

  it('gives 3 x 20 when a flag, under 2 years of running or the run itself holds the lift back', () => {
    // age 50: a soft flag (45 and over, no upper bound)
    expect(pathOf([runOf(10, 25)], { runningSinceYear: 2023, birthYear: 1976 })).toEqual({
      kind: 'floor',
      sessionMin: 20,
    })
    // BMI above 30
    expect(
      pathOf([runOf(10, 25)], { runningSinceYear: 2023, heightCm: 170, weightKg: 95 }),
    ).toEqual({ kind: 'floor', sessionMin: 20 })
    // one year of running
    expect(pathOf([runOf(10, 25)], { runningSinceYear: 2025 })).toEqual({
      kind: 'floor',
      sessionMin: 20,
    })
    // a run of 20 to 24 minutes
    expect(pathOf([runOf(10, 24)], { runningSinceYear: 2023 })).toEqual({
      kind: 'floor',
      sessionMin: 20,
    })
  })

  it('applies the J7 fraction to a run older than 30 days: 40 days off after 45 minutes is 3 x 20', () => {
    // 50% of 45 min is 22.5 min, so the floor at 20; the 30-day window holds no run
    expect(pathOf([runOf(40, 45)])).toEqual({ kind: 'floor', sessionMin: 20 })
    // 60 days off after 25 minutes: 12.5 min, so the ladder at the rung that run allows
    expect(pathOf([runOf(60, 25)], NOVICE)).toEqual({ kind: 'ladder', rung: 4, bmiHold: false })
  })

  it('treats no run in 90 days by the years of running', () => {
    expect(pathOf([runOf(100, 30)], { runningSinceYear: 2022 })).toEqual({
      kind: 'floor',
      sessionMin: 20,
    })
    // no flag-free experience: rung 1
    expect(pathOf([runOf(100, 30)], { runningSinceYear: 2026 })).toEqual({
      kind: 'ladder',
      rung: 1,
      bmiHold: false,
    })
    // an experienced runner with a flag is not lifted
    expect(pathOf([runOf(100, 30)], { runningSinceYear: 2022, birthYear: 1970 })).toEqual({
      kind: 'ladder',
      rung: 1,
      bmiHold: false,
    })
  })

  it('sends a recent injury with a small week to the injury-return ladder, at the longest pain-free run', () => {
    const injured = { runningSinceYear: 2023, injuries: [INJURY] }
    expect(pathOf([], injured)).toEqual({ kind: 'injury-return', level: 0 })
    // 12 pain-free minutes allow the 10-minute level; the 20-minute run hurt
    const runs = [runOf(5, 12, { pain: 0 }), runOf(8, 20, { pain: 3 })]
    expect(pathOf(runs, injured)).toEqual({ kind: 'injury-return', level: 1 })
    expect(pathOf([runOf(5, 17, { pain: null })], injured)).toEqual({
      kind: 'injury-return',
      level: 2,
    })
    // a run older than 30 days does not count
    expect(pathOf([runOf(35, 30, { pain: 0 })], injured)).toEqual({
      kind: 'injury-return',
      level: 0,
    })
  })

  it('leaves a recent injury with a typical week at or above 60 min to the usual plan', () => {
    const week = (back: number) => [0, 2, 4].map((d) => runOf(back * 7 + d + 4, 30))
    const runs = [1, 2, 3, 4].flatMap(week)
    expect(pathOf(runs, { injuries: [INJURY] })).toBeNull()
  })

  it('takes an earlier bone stress injury through the start path, but never lifts it above 3 x 20', () => {
    const old = { ...INJURY, year: 2022, kind: 'bone-stress' as const }
    // an unflagged runner with the same 30-min run is lifted to 3 x 30
    expect(pathOf([runOf(10, 30)], { runningSinceYear: 2020 })).toEqual({
      kind: 'floor',
      sessionMin: 30,
    })
    expect(pathOf([runOf(10, 30)], { runningSinceYear: 2020, injuries: [old] })).toEqual({
      kind: 'floor',
      sessionMin: 20,
    })
    // a novice with no runs takes the ladder, as an unflagged novice does
    expect(pathOf([], { ...NOVICE, injuries: [old] })).toEqual({
      kind: 'ladder',
      rung: 1,
      bmiHold: false,
    })
  })

  it('takes the two BSI factors (earlier bone stress injury and a low BMI) through the start path too', () => {
    const lean: Partial<AthleteProfile> = {
      ...NOVICE,
      sex: 'female',
      heightCm: 168,
      weightKg: 50,
      injuries: [{ ...INJURY, year: 2021, kind: 'bone-stress' as const }],
    }
    const inp = input({ activities: [], profile: profile(lean) })
    expect(estimateState(inp).risk.bsiFactors).toBeGreaterThanOrEqual(2)
    expect(startPath(inp, estimateState(inp))).toEqual({ kind: 'ladder', rung: 1, bmiHold: false })
  })

  it('returns null from a typical week of 3 x 20 min', () => {
    const runs = [1, 2, 3, 4].flatMap((w) => [0, 2, 4].map((d) => runOf(w * 7 + d + 4, 20)))
    expect(pathOf(runs)).toBeNull()
  })

  it('holds rung 1 for the BMI weeks only at rung 1', () => {
    const heavy = { ...NOVICE, heightCm: 170, weightKg: 93 }
    expect(pathOf([], heavy)).toEqual({ kind: 'ladder', rung: 1, bmiHold: true })
    expect(pathOf([runOf(3, 15)], heavy)).toEqual({ kind: 'ladder', rung: 4, bmiHold: false })
  })

  it('counts a run-walk activity by its longest running bout, not its length', () => {
    // one ladder session of rung 1, logged as a 31-minute activity with its walks
    const session = planned('s1', daysAgo(4), 'easy', {
      activityId: 'rw-1',
      flags: ['run-walk'],
      structure: prescribe(
        'easy',
        21,
        ZONES,
        { weekStart: MONDAY, flags: ['run-walk', 'ladder-1'] } as WeekDraft,
        { blueprint: rungSessions(1)[0] },
      ).structure,
    })
    const walk = runOf(4, 31, { id: 'rw-1', distanceM: 3400 })
    // as a plain run it is a 31-minute run: 3 x 30 for an experienced runner
    const plain = input({ activities: [walk], profile: profile({ runningSinceYear: 2022 }) })
    expect(startPath(plain, estimateState(plain))).toEqual({ kind: 'floor', sessionMin: 30 })
    // linked to its run-walk session, the longest running bout is 1 minute: rung 1
    const linked = { ...plain, existing: { weeks: [], sessions: [session] } }
    expect(startPath(linked, estimateState(linked))).toEqual({
      kind: 'ladder',
      rung: 1,
      bmiHold: false,
    })
  })
})

describe('macroPlan: the weeks of the ladder [rules E6]', () => {
  const novice = (over: Partial<EngineInput> = {}) => input({ profile: profile(NOVICE), ...over })
  const weeksOf = (inp: EngineInput) => {
    const st = estimateState(inp)
    return macroPlan(inp, st, inp.goal, feasibility(inp.goal, st, inp.today))
  }
  const ladderOf = (weeks: WeekDraft[]) =>
    weeks.filter((w) => w.flags.some((f) => f.startsWith('ladder-')))

  it('draws nine ladder weeks from rung 1, three non-consecutive run days, easy only', () => {
    const weeks = weeksOf(novice())
    const ladder = ladderOf(weeks)
    expect(ladder).toHaveLength(9)
    expect(ladder.map((w) => w.flags.find((f) => f.startsWith('ladder-')))).toEqual(
      Array.from({ length: 9 }, (_, i) => `ladder-${String(i + 1)}`),
    )
    expect(ladder[0]!.flags).toEqual(expect.arrayContaining(['restart-floor', 'run-walk']))
    for (const w of ladder) {
      expect(w.runDays).toBe(P.f5.noviceRunDays.value)
      expect(w.qualitySessions).toBe(0)
      expect(w.isRecovery).toBe(false)
      expect(w.longRunMin).toBe(0)
      expect(w.tid).toEqual({ z1: 100, z2: 0, z3: 0 })
      expect(w.focus).not.toMatch(/behind|missed|streak|failed|\bred\b/i)
    }
  })

  it('draws the time on feet of the table, rung 4 rounded to whole minutes a session', () => {
    const minutes = ladderOf(weeksOf(novice())).map((w) => w.targetRunMin)
    // 63, 63, 54, 64.5 (three sessions of 21.5 min, each 22 min), 62, 69, 75, 84, 90
    expect(minutes).toEqual([63, 63, 54, 66, 62, 69, 75, 84, 90])
  })

  it('holds the weeks after the ladder at 90 min and above, with no quality for two weeks', () => {
    const weeks = weeksOf(novice())
    const ladder = ladderOf(weeks)
    const after = weeks.slice(ladder.length)
    expect(after[0]!.flags.some((f) => f.startsWith('ladder-'))).toBe(false)
    expect(after[0]!.targetRunMin).toBeGreaterThan(ladder.at(-1)!.targetRunMin)
    expect(after[0]!.targetRunMin).toBeLessThanOrEqual(
      Math.floor(ladder.at(-1)!.targetRunMin * 1.1 + 1),
    )
    expect(after[0]!.isRecovery).toBe(false)
    expect(
      after.slice(0, P.noviceLadder.quietWeeksAfter.value).map((w) => w.qualitySessions),
    ).toEqual([0, 0])
    expect(after[2]!.qualitySessions).toBeGreaterThan(0)
  })

  it('holds rung 1 for three weeks for a BMI above 30, then moves on one rung a week', () => {
    const heavy = novice({ profile: profile({ ...NOVICE, heightCm: 170, weightKg: 93 }) })
    const rungs = ladderOf(weeksOf(heavy)).map((w) =>
      Number(w.flags.find((f) => f.startsWith('ladder-'))!.slice(7)),
    )
    expect(rungs).toEqual([1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('keeps the ladder under a progression hold, at its entry rung and with no growth', () => {
    const held = weeksOf(novice({ screeningFlags: 2 }))
    const ladder = ladderOf(held)
    // a hold stops growth: every pre-taper week repeats rung 1, as run-walk, not as 3 x 20
    expect(ladder.length).toBeGreaterThan(9)
    for (const w of ladder) {
      expect(w.flags).toContain('ladder-1')
      expect(w.targetRunMin).toBe(startWeek('ladder', 1).minutes)
    }
    expect(held[0]!.flags).toEqual(expect.arrayContaining(['restart-floor', 'run-walk']))
    expect(held[0]!.targetRunMin).toBeLessThanOrEqual(P.macroDesign.startFloorWeekMin.value + 3)
    // and without the hold the same runner climbs
    const free = ladderOf(weeksOf(novice()))
    expect(free.map((w) => w.targetRunMin)).not.toEqual(
      ladder.slice(0, free.length).map((w) => w.targetRunMin),
    )
  })

  it('repeats the 3 x N floor every week under a progression hold', () => {
    const experienced = input({
      screeningFlags: 2,
      profile: profile({ runningSinceYear: 2020 }),
    })
    const weeks = weeksOf(experienced).filter((w) => !w.isTaper && !w.flags.includes('post-race'))
    expect(weeks[0]!.flags).toContain('restart-floor')
    for (const w of weeks.filter((x) => !x.isTaper && x.phase !== 'race').slice(0, 8)) {
      expect(w.targetRunMin, w.weekStart).toBe(3 * P.restartFloor.sessionMin.value)
      expect(w.runDays).toBe(3)
    }
  })

  it('leaves a runner with a typical week to the hold, as before: no start path lifts the week', () => {
    const week = (back: number) => [0, 2].map((d) => runOf(back * 7 + d + 4, 20))
    const typical = input({
      screeningFlags: 2,
      profile: profile({ runningSinceYear: 2020 }),
      activities: [1, 2, 3, 4].flatMap(week),
    })
    const weeks = weeksOf(typical)
    expect(weeks[0]!.flags).not.toContain('restart-floor')
    expect(weeks[0]!.targetRunMin).toBe(40)
  })

  it('cuts the ladder where the taper begins', () => {
    const soon = novice({ goal: { ...input().goal, date: addDays(TODAY, 30) } })
    const weeks = weeksOf(soon)
    expect(ladderOf(weeks).length).toBeLessThan(9)
    expect(weeks.filter((w) => w.isTaper).length).toBeGreaterThan(0)
  })
})

describe('buildPlan: the sessions of the ladder [rules E6, g-1]', () => {
  const plan = buildPlan(input({ profile: profile(NOVICE) }))
  const sessionsIn = (weekStart: string): SessionSpec[] =>
    plan.sessions.filter(
      (s) => mondayOf(s.date) === weekStart && s.kind !== 'strength' && s.kind !== 'race',
    )

  it('builds each rung from its blueprint, with a walk before and after that no minute counts', () => {
    const first = sessionsIn(MONDAY)
    expect(first).toHaveLength(3)
    for (const s of first) {
      expect(s.durationMin).toBe(21)
      expect(s.flags).toContain('run-walk')
      expect(s.rules).toEqual(expect.arrayContaining(['E6', 'A9']))
      expect(s.title).toBe('Run-walk, step 1')
      const [warm, work, walk, cool] = s.structure
      expect(warm).toMatchObject({ kind: 'warmup', durationSec: 300 })
      expect(work).toMatchObject({ kind: 'work', reps: 7, durationSec: 60 })
      expect(walk).toMatchObject({ kind: 'recover', reps: 7, durationSec: 120 })
      expect(cool).toMatchObject({ kind: 'cooldown', durationSec: 300 })
      // the minutes of the session are its runs and its walking breaks, not the framing walks
      const counted = s.structure
        .filter((st) => st.kind === 'work' || st.kind === 'recover')
        .reduce((n, st) => n + (st.durationSec! * st.reps) / 60, 0)
      expect(counted).toBe(21)
      expect(s.purpose).toMatch(/not counted/)
      expect(s.purpose).not.toMatch(/behind|missed|streak|failed/i)
    }
  })

  it('shows rung 5 as two run-walk sessions and one continuous run, longest last', () => {
    const rung5 = plan.weeks.find((w) => w.flags.includes('ladder-5'))!
    const sessions = sessionsIn(rung5.weekStart)
    expect(sessions.map((s) => s.durationMin)).toEqual([21, 21, 20])
    expect(sessions[2]!.structure.map((st) => st.kind)).toEqual(['warmup', 'steady', 'cooldown'])
    expect(sessions[2]!.structure[1]).toMatchObject({ durationSec: 1200 })
  })

  it('plans the days, the minutes and the checklist of the whole ladder', () => {
    for (const w of plan.weeks.filter((x) => x.flags.some((f) => f.startsWith('ladder-')))) {
      const sessions = sessionsIn(w.weekStart)
      expect(sessions.reduce((n, s) => n + s.durationMin, 0)).toBe(w.targetRunMin)
      const days = sessions.map((s) => s.date).sort()
      for (let i = 1; i < days.length; i++) {
        expect((Date.parse(days[i]!) - Date.parse(days[i - 1]!)) / 864e5).toBeGreaterThanOrEqual(2)
      }
    }
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
    expect(plan.checklist.map((c) => c.id)).toContain('ladder-steps')
  })

  it('adds no strides or quality to the ladder weeks or the two weeks after', () => {
    const ladderEnd = plan.weeks.filter((w) => w.flags.some((f) => f.startsWith('ladder-'))).at(-1)!
    const quiet = [7, 14].map((d) => addDays(ladderEnd.weekStart, d))
    for (const week of [
      ...plan.weeks
        .filter((w) => w.flags.some((f) => f.startsWith('ladder-')))
        .map((w) => w.weekStart),
      ...quiet,
    ]) {
      const kinds = sessionsIn(week).map((s) => s.kind)
      expect(kinds.filter((k) => k !== 'easy' && k !== 'long')).toEqual([])
    }
  })

  it('cuts a session to the distance limit of G-1 for a runner whose zones are fast', () => {
    // a 20-minute run of 3.2 km is the 30-day reference: duration allows 22 min, distance 3.7 km
    const st = {
      ...estimateState(input({ profile: profile(NOVICE) })),
      experience: 'novice' as const,
    }
    const fast = {
      ...ZONES,
      pace: { z1: [330, 270], z2: [270, 240], z3: [240, 210] },
    } as typeof ZONES
    const week: WeekDraft = {
      weekStart: addDays(MONDAY, 7),
      index: 1,
      phase: 'build',
      focus: '',
      targetRunMin: 66,
      longRunMin: 0,
      longRunM: null,
      gainTargetM: null,
      runDays: 3,
      qualitySessions: 0,
      strengthSessions: 0,
      tid: { z1: 100, z2: 0, z3: 0 },
      flags: ['run-walk', 'ladder-4'],
      isRecovery: false,
      isTaper: false,
    }
    const limits = {
      runs: [{ date: daysAgo(3), min: 20, distanceM: 3200, gainM: null, lossM: null }],
      virtualTwoDay: [],
    }
    const sessions = placeWeek(week, {
      profile: profile(),
      zones: fast,
      state: st,
      prevSessions: [],
      limits,
    }).filter((s) => s.kind === 'easy')
    expect(sessions.length).toBeGreaterThan(0)
    for (const s of sessions) {
      // 22 minutes at 5:00 per km would be 4.4 km
      expect(s.durationMin).toBeLessThan(22)
      expect(s.durationMin).toBeGreaterThanOrEqual(P.fplace.minRunDayMin.value)
      expect(s.distanceM!).toBeLessThanOrEqual(3700)
    }
    // the guards find nothing left to cut
    const guarded = applyGuards(sessions, st, [runOf(3, 20, { distanceM: 3200 })], {
      neverOverride: true,
    })
    expect(guarded.warnings.filter((w) => w.code.startsWith('spike'))).toEqual([])
  })
})

describe('the ladder at a re-plan: advance and hold [rules E6]', () => {
  const NEXT = MONDAY // the Monday of the re-plan; the ladder weeks end the week before

  /** Ladder weeks at the given rungs, the last one the week before NEXT, as a stored plan holds them. */
  function ladderWeeks(rungs: number[]): WeekDraft[] {
    return rungs.map((rung, i) => {
      const sw = startWeek('ladder', rung)
      return {
        weekStart: addDays(NEXT, -7 * (rungs.length - i)),
        index: i,
        phase: 'build',
        focus: sw.focus,
        targetRunMin: sw.minutes,
        longRunMin: 0,
        longRunM: null,
        gainTargetM: null,
        runDays: 3,
        qualitySessions: 0,
        strengthSessions: 0,
        tid: { z1: 100, z2: 0, z3: 0 },
        flags: [...(i === 0 ? ['restart-floor'] : []), ...sw.flags],
        isRecovery: false,
        isTaper: false,
      }
    })
  }

  /** The runs of a week at a share of its planned minutes, three sessions. */
  const runsFor = (week: WeekDraft, share: number, over: Partial<Activity> = {}) =>
    [1, 3, 5].map((d) =>
      runOf(
        -(Date.parse(addDays(week.weekStart, d)) - Date.parse(TODAY)) / 864e5,
        (week.targetRunMin * share) / 3,
        { id: `wk-${week.weekStart}-${String(d)}`, ...over },
      ),
    )

  function rungAfter(
    rungs: number[],
    shares: number[],
    over: { rpe?: number | null; pain?: number | null; profile?: Partial<AthleteProfile> } = {},
  ) {
    const weeks = ladderWeeks(rungs)
    const activities = weeks.flatMap((w, i) =>
      runsFor(w, shares[i]!, {
        // pain and ratings are reported in the week just completed
        rpe: i === weeks.length - 1 ? (over.rpe ?? null) : null,
        pain: i === weeks.length - 1 ? (over.pain ?? null) : null,
      }),
    )
    const inp = input({
      today: NEXT,
      activities,
      profile: profile({ ...NOVICE, ...over.profile }),
      existing: { weeks, sessions: [] },
    })
    const st = estimateState(inp)
    const out = macroPlan(inp, st, inp.goal, feasibility(inp.goal, st, NEXT))
    return {
      first: out[0]!,
      rung: Number(out[0]!.flags.find((f) => f.startsWith('ladder-'))?.slice(7)),
      second: out[1]!,
    }
  }

  it('advances one rung after a week of at least 80% of the planned minutes with no pain', () => {
    expect(rungAfter([1, 2], [1, 1]).rung).toBe(3)
    expect(rungAfter([1, 2], [1, 0.81]).rung).toBe(3)
    expect(rungAfter([1, 2], [1, 0.85]).rung).toBe(3)
    expect(rungAfter([1, 2], [1, 1]).first.focus).not.toMatch(/repeating/)
  })

  it('repeats the rung after under 80%, and says so without a word of blame', () => {
    const out = rungAfter([1, 2], [1, 0.79])
    expect(out.rung).toBe(2)
    expect(out.first.focus).toMatch(/repeating the step/)
    expect(out.first.focus).not.toMatch(/behind|missed|streak|failed/i)
    // the week after a repeat moves on
    expect(Number(out.second.flags.find((f) => f.startsWith('ladder-'))!.slice(7))).toBe(3)
  })

  it('repeats the rung after any pain in the week', () => {
    expect(rungAfter([1, 2], [1, 1], { pain: 2 }).rung).toBe(2)
    expect(rungAfter([1, 2], [1, 1], { pain: 0 }).rung).toBe(3)
  })

  it('repeats the rung when the mean session RPE is 5 or more, and ignores a week without ratings', () => {
    expect(rungAfter([1, 2], [1, 1], { rpe: 5 }).rung).toBe(2)
    expect(rungAfter([1, 2], [1, 1], { rpe: 6 }).rung).toBe(2)
    expect(rungAfter([1, 2], [1, 1], { rpe: 4 }).rung).toBe(3)
    expect(rungAfter([1, 2], [1, 1], { rpe: null }).rung).toBe(3)
  })

  it('walks the weeks from the first, so a stored plan that ran ahead of the runner does not', () => {
    // the plan showed rungs 1, 2, 3; the runner skipped the first week and did the second
    expect(rungAfter([1, 2, 3], [0, 1, 0]).rung).toBe(3)
    // and with nothing run at all, the ladder waits at rung 1
    expect(rungAfter([1, 2, 3], [0, 0, 0]).rung).toBe(1)
  })

  it('holds rung 1 until the third week for a BMI above 30, then advances', () => {
    const heavy = { heightCm: 170, weightKg: 93 }
    expect(rungAfter([1, 1], [1, 1], { profile: heavy }).rung).toBe(1)
    const third = rungAfter([1, 1, 1], [1, 1, 1], { profile: heavy })
    expect(third.rung).toBe(2)
  })

  it('advances after a week with fewer sessions than the rung draws when each was run, and repeats a rung the bound held short', () => {
    const advancedTo = (change: Partial<WeekDraft>, minutes: number[]) => {
      const weeks = ladderWeeks([1, 2]).map((w, i) => (i === 1 ? { ...w, ...change } : w))
      const week = weeks[1]!
      const activities = [
        ...runsFor(weeks[0]!, 1),
        ...minutes.map((m, i) =>
          runOf(-(Date.parse(addDays(week.weekStart, 1 + 2 * i)) - Date.parse(TODAY)) / 864e5, m, {
            id: `own-${String(i)}`,
          }),
        ),
      ]
      const inp = input({
        today: NEXT,
        activities,
        profile: profile(NOVICE),
        existing: { weeks, sessions: [] },
      })
      const st = estimateState(inp)
      const out = macroPlan(inp, st, inp.goal, feasibility(inp.goal, st, NEXT))
      return Number(out[0]!.flags.find((f) => f.startsWith('ladder-'))?.slice(7))
    }
    // two spaced days held two sessions of 21 min, both run: on to rung 3
    expect(advancedTo({ runDays: 2, targetRunMin: 42 }, [21, 21])).toBe(3)
    // three sessions cut to 13 min by G-1, all run: the rung is not yet run at its length
    expect(advancedTo({ runDays: 3, targetRunMin: 39 }, [13, 13, 13])).toBe(2)
  })

  it('draws no ladder week after the last rung, and no quality for two weeks', () => {
    const out = rungAfter([8, 9], [1, 1])
    expect(out.first.flags.some((f) => f.startsWith('ladder-'))).toBe(false)
    expect(out.first.qualitySessions).toBe(0)
    expect(out.second.qualitySessions).toBe(0)
  })

  it('repeats rung 9 rather than finishing the ladder after a short week', () => {
    expect(rungAfter([8, 9], [1, 0.5]).rung).toBe(9)
  })

  it('keeps the rung of a plan that began this week', () => {
    const weeks = ladderWeeks([4]).map((w) => ({ ...w, weekStart: NEXT }))
    const inp = input({ today: NEXT, existing: { weeks, sessions: [] }, profile: profile(NOVICE) })
    const st = estimateState(inp)
    const out = macroPlan(inp, st, inp.goal, feasibility(inp.goal, st, NEXT))
    expect(out[0]!.flags).toContain('ladder-4')
  })

  it('carries a ladder through twelve weekly re-plans, a short week held on the way', () => {
    const RUNNING = new Set(['easy', 'recovery', 'long', 'long-fast-finish', 'strides'])
    let current = buildPlan(input({ profile: profile(NOVICE) }))
    let activities: Activity[] = []
    let monday = addDays(MONDAY, 7)
    const shares = [1, 0.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    const rungs: number[] = []
    for (let k = 0; k < 12; k++) {
      activities = [
        ...activities,
        ...current.sessions
          .filter((s) => s.date >= addDays(monday, -7) && s.date < monday && RUNNING.has(s.kind))
          .map((s) =>
            runOf(-(Date.parse(s.date) - Date.parse(TODAY)) / 864e5, s.durationMin * shares[k]!, {
              id: `chain-${s.date}`,
              rpe: 3,
            }),
          ),
      ]
      const existing = {
        weeks: current.weeks,
        sessions: current.sessions.map((s, i) => ({
          ...s,
          id: `s${String(i)}`,
          status: s.date < monday ? 'completed' : 'planned',
          activityId: null,
        })),
      }
      current = replan({
        ...input({ profile: profile(NOVICE) }),
        today: monday,
        activities,
        existing,
      }).draft
      const week = current.weeks.find((w) => w.weekStart === monday)!
      rungs.push(Number(week.flags.find((f) => f.startsWith('ladder-'))?.slice(7) ?? 0))
      expect(
        current.checklist.filter((c) => !c.ok),
        `re-plan of ${monday}`,
      ).toEqual([])
      monday = addDays(monday, 7)
    }
    // week 2 was half run, so rung 2 repeats; the ladder ends one week later than drawn
    expect(rungs).toEqual([2, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0])
  })
})

describe('the floor and the injury-return ladder [rules E6, g-3]', () => {
  it('draws a 3 x 25 floor week with plain easy runs and no quality', () => {
    const inp = input({
      activities: [runOf(10, 25)],
      profile: profile({ runningSinceYear: 2023 }),
    })
    const plan = buildPlan(inp)
    const first = plan.weeks[0]!
    expect(first.flags).toContain('restart-floor')
    expect(first.flags).not.toContain('run-walk')
    expect(first.targetRunMin).toBe(75)
    expect(first.qualitySessions).toBe(0)
    const runs = plan.sessions.filter((s) => mondayOf(s.date) === MONDAY && s.kind !== 'strength')
    expect(runs.map((s) => s.durationMin)).toEqual([25, 25, 25])
    for (const s of runs) {
      expect(s.rules).toEqual(expect.arrayContaining(['E6', 'A9']))
      expect(s.structure).toEqual([])
    }
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })

  const injured = () => input({ profile: profile({ runningSinceYear: 2023, injuries: [INJURY] }) })

  it('starts a recent injury with no runs at 2 x 5 min and steps one level a week up to 30', () => {
    const plan = buildPlan(injured())
    const levels = plan.weeks.filter((w) => w.flags.includes('injury-return'))
    expect(levels.map((w) => w.flags.find((f) => f.startsWith('injury-level-')))).toEqual(
      [0, 1, 2, 3, 4, 5].map((n) => `injury-level-${String(n)}`),
    )
    for (const w of levels) {
      expect(w.runDays).toBe(P.injuryReturn.repeatsPerLevel.value)
      expect(w.qualitySessions).toBe(0)
    }
    const first = plan.sessions.filter((s) => mondayOf(s.date) === MONDAY && s.kind === 'easy')
    expect(first.map((s) => s.durationMin)).toEqual([5, 5])
    expect(first.every((s) => s.flags.includes('injury-return'))).toBe(true)
    expect(first.every((s) => s.rules.includes('g-3'))).toBe(true)
    expect(first[0]!.title).toBe('Return to running, level 1')
    // the weeks are the levels of the programme: G-1 holds each run to 1.10x the longest run that
    // was completed, which a plan made before any run cannot know
    expect(levels.map((w) => w.targetRunMin)).toEqual([10, 20, 30, 40, 50, 60])
    const runs = plan.sessions.filter((x) => x.flags.includes('injury-return'))
    expect(runs.map((s) => s.durationMin)).toEqual([5, 5, 10, 10, 15, 15, 20, 20, 25, 25, 30, 30])
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
    // no quality or strides for two weeks after the last level either [rules E6, G-3]
    const after = plan.weeks.slice(plan.weeks.indexOf(levels.at(-1)!) + 1)
    expect(
      after.slice(0, P.noviceLadder.quietWeeksAfter.value).map((w) => w.qualitySessions),
    ).toEqual([0, 0])
    const quietKinds = after
      .slice(0, P.noviceLadder.quietWeeksAfter.value)
      .flatMap((w) =>
        plan.sessions
          .filter((s) => mondayOf(s.date) === w.weekStart && s.kind !== 'strength')
          .map((s) => s.kind),
      )
    expect(quietKinds.filter((k) => k !== 'easy' && k !== 'long' && k !== 'rest')).toEqual([])
  })

  it('climbs the levels from a pain-free run: 25 minutes allow level 5, and level 6 is held at the bound until it is run', () => {
    const plan = buildPlan({
      ...injured(),
      activities: [runOf(5, 25, { pain: 0 })],
    })
    const levels = plan.weeks.filter((w) => w.flags.includes('injury-return'))
    const names = levels.map((w) => w.flags.find((f) => f.startsWith('injury-level-')))
    // level 5 is 25 min, the run before it; level 6 is 30 min, held to the G-1 bound on a 25-min
    // run, the larger of 1.10 x 25 = 27.5 and 25 + 3 (the duration step), so 28. The bound does not
    // grow until a run is logged, so level 6 repeats at 28 and the programme does not end by the
    // count of weeks: it ends once level 6 has been run at its own length.
    expect(names.slice(0, 2)).toEqual(['injury-level-4', 'injury-level-5'])
    expect(names.slice(2).every((n) => n === 'injury-level-5')).toBe(true)
    expect(names.length).toBeGreaterThan(2)
    const runs = plan.sessions.filter((s) => s.flags.includes('injury-return'))
    expect(runs.map((s) => s.durationMin).slice(0, 4)).toEqual([25, 25, 28, 28])
    // while the 25-min run is in the 30-day window; level 6 is run at 30 once it is out of it
    expect(runs.slice(0, 8).every((s) => s.durationMin === 25 || s.durationMin === 28)).toBe(true)
    // the label says what the week holds and what it works toward
    expect(levels[1]!.focus).toMatch(/28 min this week, working toward 30 min/)
    expect(levels[0]!.focus).not.toMatch(/working toward/)
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })

  it('advances a level after two symptom-free runs and drops one on pain', () => {
    const levels = (n: number[]): WeekDraft[] =>
      n.map((level, i) => {
        const sw = startWeek('injury-return', level)
        return {
          weekStart: addDays(MONDAY, -7 * (n.length - i)),
          index: i,
          phase: 'build',
          focus: sw.focus,
          targetRunMin: sw.minutes,
          longRunMin: 0,
          longRunM: null,
          gainTargetM: null,
          runDays: 2,
          qualitySessions: 0,
          strengthSessions: 0,
          tid: { z1: 100, z2: 0, z3: 0 },
          flags: sw.flags,
          isRecovery: false,
          isTaper: false,
        }
      })
    const levelAfter = (
      weeks: WeekDraft[],
      runs: (w: WeekDraft, i: number) => Activity[],
      extra: Partial<EngineInput> = {},
    ) => {
      const inp = {
        ...injured(),
        today: MONDAY,
        activities: weeks.flatMap(runs),
        existing: { weeks, sessions: [] },
        ...extra,
      }
      const st = estimateState(inp)
      const out = macroPlan(inp, st, inp.goal, feasibility(inp.goal, st, MONDAY))
      return Number(out[0]!.flags.find((f) => f.startsWith('injury-level-'))?.slice(13) ?? -1)
    }
    const twoRuns = (w: WeekDraft, over: Partial<Activity> = {}, minutes = 10) =>
      [1, 4].map((d) =>
        runOf(-(Date.parse(addDays(w.weekStart, d)) - Date.parse(TODAY)) / 864e5, minutes, {
          id: `inj-${w.weekStart}-${String(d)}`,
          ...over,
        }),
      )
    const weeks = levels([0, 1])
    expect(levelAfter(weeks, (w) => twoRuns(w))).toBe(2)
    // one run only: the level repeats
    expect(levelAfter(weeks, (w, i) => (i === 1 ? twoRuns(w).slice(0, 1) : twoRuns(w)))).toBe(1)
    // pain on a run: back one level
    expect(levelAfter(weeks, (w) => twoRuns(w, { pain: 2 }))).toBe(0)
    // pain on the next day's check-in: back one level
    const next = addDays(weeks[1]!.weekStart, 5)
    expect(
      levelAfter(weeks, (w) => twoRuns(w), {
        wellness: [wellnessDay(next, { painScore: 1 })],
      }),
    ).toBe(0)
    // the ladder ends after level 6, run at its own length (30 min, within a minute)
    expect(levelAfter(levels([4, 5]), (w) => twoRuns(w, {}, 30))).toBe(-1)
    expect(levelAfter(levels([4, 5]), (w) => twoRuns(w, {}, 29))).toBe(-1)
  })

  it("advances a level only when both runs reached the level's minutes, else repeats it", () => {
    const level = (n: number): WeekDraft[] => {
      const sw = startWeek('injury-return', n)
      return [
        {
          weekStart: addDays(MONDAY, -7),
          index: 0,
          phase: 'build',
          focus: sw.focus,
          targetRunMin: sw.minutes,
          longRunMin: 0,
          longRunM: null,
          gainTargetM: null,
          runDays: 2,
          qualitySessions: 0,
          strengthSessions: 0,
          tid: { z1: 100, z2: 0, z3: 0 },
          flags: sw.flags,
          isRecovery: false,
          isTaper: false,
        },
      ]
    }
    const after = (n: number, minutes: number[]) => {
      const weeks = level(n)
      const inp = {
        ...injured(),
        today: MONDAY,
        activities: minutes.map((m, i) =>
          runOf(
            -(Date.parse(addDays(weeks[0]!.weekStart, 1 + 3 * i)) - Date.parse(TODAY)) / 864e5,
            m,
            { id: `lvl-${String(n)}-${String(i)}`, pain: 0 },
          ),
        ),
        existing: { weeks, sessions: [] },
      }
      const st = estimateState(inp)
      const out = macroPlan(inp, st, inp.goal, feasibility(inp.goal, st, MONDAY))
      return injuryLevel(out[0]!.flags)
    }
    // level index 2 is 15 min: a minute under it still counts, two minutes under does not
    expect(after(2, [15, 15])).toBe(3)
    expect(after(2, [14, 14])).toBe(3)
    expect(after(2, [13, 15])).toBe(2)
    expect(after(2, [13, 13])).toBe(2)
    // short runs held by G-1 do not carry the level on, however many weeks pass
    expect(after(2, [11, 11])).toBe(2)
  })

  it('holds the checklist item of the ladder steps: one rung a week at most', () => {
    const plan = buildPlan(input({ profile: profile(NOVICE) }))
    const bad = structuredClone(plan)
    const w = bad.weeks.find((x) => x.flags.includes('ladder-5'))!
    w.flags = w.flags.map((f) => (f === 'ladder-5' ? 'ladder-7' : f))
    const item = runChecklist(bad, input({ profile: profile(NOVICE) })).find(
      (c) => c.id === 'ladder-steps',
    )!
    expect(item.ok).toBe(false)
    expect(item.detail).toMatch(/rung 7 follows rung 4/)
  })
})

describe('a re-plan in the first weeks of a start path [rules E6]', () => {
  // two 15-minute, 2400-m runs a few days ago: the ladder starts at rung 4, held to 17 min a
  // session by the distance bound (2400 m + 0.5 km at the run's pace), just under the 18-min
  // duration bound (the larger of 1.10 x 15 and 15 + 3)
  const inp = input({
    activities: [runOf(3, 15, { distanceM: 2400 }), runOf(6, 15, { distanceM: 2400 })],
    profile: profile(NOVICE),
  })
  const plan = buildPlan(inp)
  const replanAt = (shift: number) => {
    const today = addDays(TODAY, shift)
    return replan({
      ...inp,
      today,
      existing: {
        weeks: plan.weeks,
        sessions: plan.sessions.map((s, i) => ({
          ...s,
          id: `s${String(i)}`,
          status: s.date < today ? 'completed' : 'planned',
          activityId: null,
        })),
      },
    }).draft
  }

  it('draws the first plan from the run it can hold: rung 4 in sessions of 17 minutes', () => {
    expect(plan.weeks[0]!.flags).toEqual(
      expect.arrayContaining(['restart-floor', 'run-walk', 'ladder-4']),
    )
    const runs = plan.sessions.filter((s) => mondayOf(s.date) === MONDAY && s.kind === 'easy')
    expect(runs.map((s) => s.durationMin)).toEqual([17, 17, 17])
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })

  it('keeps the first week, its floor flag and its rung when it is re-planned a day later', () => {
    const next = replanAt(1)
    expect(next.weeks[0]).toMatchObject({ targetRunMin: plan.weeks[0]!.targetRunMin })
    expect(next.weeks[0]!.flags).toEqual(expect.arrayContaining(['restart-floor', 'ladder-4']))
    // the run kept on Wednesday leaves Thursday free of a run
    const days = next.sessions
      .filter((s) => mondayOf(s.date) === MONDAY && s.kind === 'easy')
      .map((s) => s.date)
    expect(days).not.toContain(addDays(TODAY, 1))
    expect(next.checklist.filter((c) => !c.ok)).toEqual([])
  })

  it('repeats the rung after a week with no run, and the break check allows it', () => {
    const next = replanAt(5)
    const week = next.weeks.find((w) => w.weekStart === addDays(MONDAY, 7))!
    expect(week.flags).toContain('ladder-4')
    expect(week.flags).not.toContain('restart-floor')
    expect(week.focus).toMatch(/repeating the step/)
    expect(next.checklist.filter((c) => !c.ok)).toEqual([])
  })
})

// ---- review fixes, round 2: the start paths against the G-1 reference ----

const raceOf = (daysBack: number, distanceM: number, minutes: number): Activity =>
  activity(daysAgo(daysBack), {
    id: `race-${String(daysBack)}-${String(distanceM)}`,
    type: 'race',
    durationSec: minutes * 60,
    movingSec: minutes * 60,
    distanceM,
  })

const runsIn = (plan: { sessions: SessionSpec[] }, weekStart: string): SessionSpec[] =>
  plan.sessions.filter(
    (s) => mondayOf(s.date) === weekStart && s.kind !== 'strength' && s.kind !== 'race',
  )

describe('the start path reads the runs that the G-1 reference counts [rules E6, g-1]', () => {
  const years = { runningSinceYear: 2018 }

  it('leaves a marathon or longer race out of the longest run, as the reference does', () => {
    const marathon = raceOf(25, 42_195, 240)
    // the marathon would lift a runner with 2018 on the clock to 3 x 30 on its own
    expect(pathOf([marathon], years)).toEqual({ kind: 'floor', sessionMin: 20 })
    // with a short run since, the 30-day reference is that run: the ladder, not 3 x 30
    expect(pathOf([marathon, runOf(3, 10)], years)).toEqual({
      kind: 'ladder',
      rung: 4,
      bmiHold: false,
    })
    // an ultra is no reference run either
    expect(pathOf([raceOf(25, 80_000, 600), runOf(3, 10)], years)).toEqual({
      kind: 'ladder',
      rung: 4,
      bmiHold: false,
    })
  })

  it('holds the first week to the bound it will have: a long run leaving the 30 days that week does not lift the floor', () => {
    // 25 minutes 28 days ago leaves the window two days into the week; the 10-minute run two days
    // ago is what limits the sessions from then on (1.10 x 10 = 11, or 10 + 3 = 13 minutes)
    const runs = [runOf(28, 25), runOf(2, 10)]
    expect(pathOf(runs, { runningSinceYear: 2020 })).toEqual({
      kind: 'ladder',
      rung: 4,
      bmiHold: false,
    })
    const plan = buildPlan(
      input({ activities: runs, profile: profile({ runningSinceYear: 2020 }) }),
    )
    // the weeks after the part week of the start say what they hold
    for (const w of plan.weeks
      .filter((x) => x.weekStart > MONDAY && x.targetRunMin > 0)
      .slice(0, 4)) {
      const placed = runsIn(plan, w.weekStart)
      expect(placed.length, w.weekStart).toBeGreaterThan(0)
      expect(w.targetRunMin, w.weekStart).toBe(placed.reduce((n, s) => n + s.durationMin, 0))
    }
    expect(plan.warnings.map((w) => w.code)).not.toContain('spike-run-dropped')
  })

  it('counts a race shorter than the marathon as a run, as the reference does', () => {
    expect(pathOf([raceOf(25, 21_097, 110)], years)).toEqual({ kind: 'floor', sessionMin: 30 })
  })

  it('plans no floor above what G-1 leaves: a marathon and a 10-minute run give runs, not an empty plan', () => {
    const plan = buildPlan(
      input({ activities: [raceOf(25, 42_195, 240), runOf(3, 10)], profile: profile(years) }),
    )
    // the ladder at the 13-minute bound, not 3 x 30 cut to nothing
    expect(plan.weeks[0]!.flags).toEqual(
      expect.arrayContaining(['restart-floor', 'run-walk', 'ladder-4']),
    )
    for (const w of plan.weeks.filter((x) => x.targetRunMin > 0).slice(0, 6)) {
      const runs = runsIn(plan, w.weekStart)
      expect(runs.length, w.weekStart).toBeGreaterThan(0)
      expect(w.targetRunMin, w.weekStart).toBe(runs.reduce((n, s) => n + s.durationMin, 0))
    }
    expect(plan.warnings.map((w) => w.code)).not.toContain('spike-run-dropped')
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })

  it('writes the week target and focus from the sessions placed after a marathon', () => {
    // two 20-minute runs long ago and a marathon five days ago: the restart week is 3 x 20
    const plan = buildPlan(
      input({
        activities: [runOf(80, 20), runOf(60, 20), raceOf(5, 42_195, 240)],
        profile: profile({ runningSinceYear: 2020 }),
      }),
    )
    const restart = plan.weeks.find((w) => w.flags.includes('post-race-restart'))!
    const runs = runsIn(plan, restart.weekStart)
    expect(runs.length).toBeGreaterThan(0)
    expect(restart.targetRunMin).toBe(runs.reduce((n, s) => n + s.durationMin, 0))
    expect(restart.focus).toContain(
      `${String(Math.max(...runs.map((s) => s.durationMin)))} minutes`,
    )
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })

  it('holds the restart week after the window to the G-1 band of the last step run, in three runs', () => {
    // the window ends with a 15-minute run, so the restart floor of 3 x 20 is cut to 1.10x of it
    // (or 3 minutes more) rather than left out
    const plan = buildPlan(
      input({
        activities: [runOf(80, 20), runOf(60, 20), raceOf(5, 42_195, 240)],
        profile: profile({ runningSinceYear: 2020 }),
      }),
    )
    const step = plan.sessions.filter((s) => s.flags.includes('post-race')).at(-1)!
    const restart = plan.weeks.find((w) => w.flags.includes('post-race-restart'))!
    const runs = runsIn(plan, restart.weekStart)
    expect(runs).toHaveLength(3)
    const band = Math.max(
      P.g1.spikeRatioWarn.value * step.durationMin,
      step.durationMin + P.g1.minStepMin.value,
    )
    for (const s of runs) {
      expect(s.durationMin).toBeLessThanOrEqual(band)
      expect(s.durationMin).toBeGreaterThanOrEqual(startSessionMinMin())
    }
    // the week as drawn and as placed agree, so nothing is cut or left out afterwards
    expect(restart.targetRunMin).toBe(runs.reduce((n, s) => n + s.durationMin, 0))
    const codes = plan.warnings.map((w) => w.code)
    expect(codes).not.toContain('spike-run-dropped')
    expect(codes).not.toContain('spike-shortened')
  })
})

describe('a ladder or injury-return session the bound leaves short [rules E6, g-3]', () => {
  const shortRuns = [runOf(3, 10), runOf(6, 10)]

  it('places the sessions at the bound under the run day minimum, never under 5 minutes', () => {
    const plan = buildPlan(input({ activities: shortRuns, profile: profile(NOVICE) }))
    const first = runsIn(plan, MONDAY)
    expect(first).toHaveLength(3)
    for (const s of first) {
      expect(s.durationMin).toBeGreaterThanOrEqual(5)
      expect(s.durationMin).toBeLessThan(P.fplace.minRunDayMin.value)
    }
    expect(plan.weeks[0]!.targetRunMin).toBe(first.reduce((n, s) => n + s.durationMin, 0))
    expect(plan.warnings.map((w) => w.code)).not.toContain('spike-run-dropped')
  })

  it('holds the rung, and says what the week works toward, while the bound keeps it short', () => {
    const plan = buildPlan(input({ activities: shortRuns, profile: profile(NOVICE) }))
    const ladder = plan.weeks.filter((w) => w.flags.some((f) => f.startsWith('ladder-')))
    // rung 4 is 22 minutes a session; the bound is lower, so the step repeats instead of
    // moving on with sessions the rung does not describe
    expect(ladder.slice(0, 4).every((w) => w.flags.includes('ladder-4'))).toBe(true)
    expect(ladder[0]!.focus).toMatch(/up to \d+ min this week, working toward 22 min/)
    expect(ladder[0]!.focus).not.toMatch(/behind|missed|streak|failed|\bred\b/i)
    for (const w of ladder) expect(runsIn(plan, w.weekStart).length, w.weekStart).toBeGreaterThan(0)
  })

  it('never leaves a ladder or injury-return week without a run, and the checklist says so if one is', () => {
    for (const inp of [
      input({ activities: shortRuns, profile: profile(NOVICE) }),
      input({ profile: profile({ runningSinceYear: 2023, injuries: [INJURY] }) }),
    ]) {
      const plan = buildPlan(inp)
      const bad = structuredClone(plan)
      // a whole week: the week of the plan's start is a part week, which may have no day left
      const week = bad.weeks.find(
        (w) => w.weekStart >= TODAY && w.flags.some((f) => /^(ladder-|injury-level-)/.test(f)),
      )!
      bad.sessions = bad.sessions.filter((s) => mondayOf(s.date) !== week.weekStart)
      const item = runChecklist(bad, inp).find((c) => c.id === 'ladder-steps')!
      expect(item.ok).toBe(false)
      expect(item.detail).toContain(`week of ${week.weekStart}: a start-path week holds no run`)
      expect(runChecklist(plan, inp).find((c) => c.id === 'ladder-steps')!.ok).toBe(true)
    }
  })
})

describe('tightened profiles and a progression hold on the start path [rules E6, A9, n-1, n-4]', () => {
  const OLD_BSI = { ...INJURY, year: 2022, kind: 'bone-stress' as const }

  it('starts a novice with an earlier bone stress injury on rung 1, run-walk, as an unflagged novice', () => {
    const plan = buildPlan(
      input({ profile: profile({ ...NOVICE, injuries: [OLD_BSI] }), activities: [] }),
    )
    const first = runsIn(plan, MONDAY)
    expect(plan.weeks[0]!.flags).toEqual(expect.arrayContaining(['restart-floor', 'ladder-1']))
    expect(first.map((s) => s.durationMin)).toEqual([21, 21, 21])
    expect(first.every((s) => s.flags.includes('run-walk'))).toBe(true)
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })

  it('keeps the ladder at its rung under a progression hold, in the sessions as well as the weeks', () => {
    const plan = buildPlan(input({ profile: profile(NOVICE), screeningFlags: 2 }))
    const ladder = plan.weeks.filter((w) => w.flags.some((f) => f.startsWith('ladder-')))
    expect(ladder.length).toBeGreaterThan(2)
    for (const w of ladder.slice(0, 4)) {
      expect(w.flags).toContain('ladder-1')
      expect(runsIn(plan, w.weekStart).map((s) => s.durationMin)).toEqual(
        w === ladder[0] ? [21, 21, 21] : [21, 21, 21],
      )
    }
    // the runs stay run-walk, never three continuous 20-minute runs
    expect(runsIn(plan, MONDAY).every((s) => s.flags.includes('run-walk'))).toBe(true)
  })

  it('carries a ladder through a hold without advancing it', () => {
    // two weeks of rung 1 and 2 were run in full; a hold now keeps the plan at the last rung
    const weeks = [1, 2].map((rung, i) => {
      const sw = startWeek('ladder', rung)
      return {
        weekStart: addDays(MONDAY, -7 * (2 - i)),
        index: i,
        phase: 'build',
        focus: sw.focus,
        targetRunMin: sw.minutes,
        longRunMin: 0,
        longRunM: null,
        gainTargetM: null,
        runDays: 3,
        qualitySessions: 0,
        strengthSessions: 0,
        tid: { z1: 100, z2: 0, z3: 0 },
        flags: [...(i === 0 ? ['restart-floor'] : []), ...sw.flags],
        isRecovery: false,
        isTaper: false,
      } satisfies WeekDraft
    })
    const activities = weeks.flatMap((w) =>
      [1, 3, 5].map((d) =>
        runOf(
          -(Date.parse(addDays(w.weekStart, d)) - Date.parse(TODAY)) / 864e5,
          w.targetRunMin / 3,
          { id: `hold-${w.weekStart}-${String(d)}`, pain: 0 },
        ),
      ),
    )
    const base = {
      today: MONDAY,
      activities,
      profile: profile(NOVICE),
      existing: { weeks, sessions: [] },
    }
    const rungOf = (inp: EngineInput) => {
      const st = estimateState(inp)
      const out = macroPlan(inp, st, inp.goal, feasibility(inp.goal, st, MONDAY))
      return Number(out[0]!.flags.find((f) => f.startsWith('ladder-'))?.slice(7))
    }
    expect(rungOf(input(base))).toBe(3)
    expect(rungOf(input({ ...base, screeningFlags: 2 }))).toBe(2)
  })
})

describe('the injury-return ladder runs each level at its length [rules G-3]', () => {
  const injured = () => input({ profile: profile({ runningSinceYear: 2022, injuries: [INJURY] }) })
  const RUNNING = new Set(['easy', 'recovery', 'long', 'long-fast-finish', 'strides'])

  it('never ends by the count of weeks: nine re-plans keep every level week with runs and an honest label', () => {
    let current = buildPlan(injured())
    let activities: Activity[] = []
    let monday = addDays(MONDAY, 7)
    for (let k = 0; k < 9; k++) {
      activities = [
        ...activities,
        ...current.sessions
          .filter((s) => s.date >= addDays(monday, -7) && s.date < monday && RUNNING.has(s.kind))
          .map((s) =>
            runOf(-(Date.parse(s.date) - Date.parse(TODAY)) / 864e5, s.durationMin, {
              id: `inj-chain-${s.date}`,
              pain: 0,
              rpe: 3,
            }),
          ),
      ]
      const existing = {
        weeks: current.weeks,
        sessions: current.sessions.map((s, i) => ({
          ...s,
          id: `s${String(i)}`,
          status: s.date < monday ? 'completed' : 'planned',
          activityId: null,
        })),
      }
      current = replan({ ...injured(), today: monday, activities, existing }).draft
      const ahead = current.weeks.filter((w) => w.weekStart >= monday && w.targetRunMin > 0)
      for (const w of ahead) {
        // no week is left without a run, and a week ahead says the minutes it holds
        const runs = runsIn(current, w.weekStart)
        expect(runs.length, `${monday} ${w.weekStart}`).toBeGreaterThan(0)
      }
      const week = current.weeks.find((w) => w.weekStart === monday)!
      const level = Number(week.flags.find((f) => f.startsWith('injury-level-'))?.slice(13))
      // the programme is still on: the runs are far under level 6, so it has not been run
      expect(Number.isNaN(level), monday).toBe(false)
      const longest = Math.max(...runsIn(current, monday).map((s) => s.durationMin))
      const table = P.injuryReturn.levelsMin.value[level]!
      if (longest < table) expect(week.focus, monday).toMatch(/working toward/)
      expect(current.warnings.map((w) => w.code)).not.toContain('spike-run-dropped')
      expect(current.checklist.filter((c) => !c.ok)).toEqual([])
      monday = addDays(monday, 7)
    }
    // eight weeks of 5 to 13 minutes: the ladder is on level 3 or lower, not at its end
    expect(activities.at(-1)!.durationSec / 60).toBeLessThan(15)
  })

  it('labels a level held short by G-1 with its minutes and what it works toward', () => {
    const plan = buildPlan({ ...injured(), activities: [runOf(5, 9, { pain: 0 })] })
    const first = plan.weeks.find((w) => w.flags.includes('injury-return'))!
    // a 9-minute run allows level 1 (5 min) at most: pain-free runs of 5 and 10 are the levels
    expect(first.flags).toContain('injury-level-0')
    const next = plan.weeks.filter((w) => w.flags.includes('injury-return'))[1]!
    // level 2 is 10 minutes; the bound on a 9-minute run is 12, so it is run in full
    expect(next.focus).toMatch(/10 minutes/)
  })

  it('draws the plain weeks after the ladder from the last run, with runs in them', () => {
    const plan = buildPlan({ ...injured(), activities: [runOf(5, 30, { pain: 0 })] })
    const after = plan.weeks.filter(
      (w) => !w.flags.includes('injury-return') && w.targetRunMin > 0 && !w.isTaper,
    )
    expect(after.length).toBeGreaterThan(0)
    for (const w of after.slice(0, 4)) {
      expect(runsIn(plan, w.weekStart).length, w.weekStart).toBeGreaterThan(0)
    }
    expect(plan.warnings.map((w) => w.code)).not.toContain('spike-run-dropped')
  })
})

describe('a re-plan the day after the first run of a floor or injury-return week [rules F5, E6, g-3]', () => {
  function replanAfterFirstRun(inp: EngineInput, recorded = true) {
    const plan = buildPlan(inp)
    const firstRun = plan.sessions.find((s) => s.date >= inp.today && s.kind !== 'strength')!
    const done = activity(firstRun.date, {
      id: 'done-1',
      durationSec: firstRun.durationMin * 60,
      movingSec: firstRun.durationMin * 60,
      distanceM: Math.round(firstRun.durationMin * 160),
      pain: 0,
    })
    const today = addDays(firstRun.date, 1)
    const next = replan({
      ...inp,
      today,
      activities: recorded ? [...inp.activities, done] : inp.activities,
      existing: {
        weeks: plan.weeks,
        sessions: plan.sessions.map((s, i) => ({
          ...s,
          id: `s${String(i)}`,
          status: s === firstRun ? 'completed' : 'planned',
          activityId: s === firstRun && recorded ? 'done-1' : null,
        })),
      },
    }).draft
    return { plan, next, firstRun }
  }

  const noConsecutive = (plan: { sessions: SessionSpec[] }, weekStart: string) => {
    const days = [
      ...new Set(
        runsIn(plan, weekStart)
          .filter((s) => s.kind !== 'rest')
          .map((s) => s.date),
      ),
    ].sort()
    for (let i = 1; i < days.length; i++) {
      expect(
        (Date.parse(days[i]!) - Date.parse(days[i - 1]!)) / 864e5,
        days.join(' '),
      ).toBeGreaterThan(1)
    }
  }

  it('keeps the floor week on non-consecutive days against the run already done', () => {
    const { next, firstRun } = replanAfterFirstRun(
      input({ activities: [runOf(5, 25)], profile: profile({ runningSinceYear: 2023 }) }),
    )
    expect(next.weeks[0]!.flags).toContain('restart-floor')
    expect(next.weeks[0]!.flags).not.toContain('run-walk')
    noConsecutive(next, MONDAY)
    expect(runsIn(next, MONDAY).some((s) => s.date === addDays(firstRun.date, 1))).toBe(false)
    expect(next.checklist.filter((c) => !c.ok)).toEqual([])
  })

  it('keeps the injury-return week a rest day apart from the run already done', () => {
    const { next, firstRun } = replanAfterFirstRun(
      input({ profile: profile({ runningSinceYear: 2023, injuries: [INJURY] }) }),
    )
    expect(next.weeks[0]!.flags).toContain('injury-return')
    noConsecutive(next, MONDAY)
    expect(runsIn(next, MONDAY).some((s) => s.date === addDays(firstRun.date, 1))).toBe(false)
    expect(next.checklist.filter((c) => !c.ok)).toEqual([])
  })

  // A session kept as finished with no recorded activity is still a run of the week: the week
  // holds its 3 run days with it, not 3 more.
  describe.each([
    [
      'floor',
      () =>
        input({
          today: MONDAY,
          activities: [runOf(5, 25)],
          profile: profile({ runningSinceYear: 2023 }),
        }),
    ],
    ['ladder', () => input({ today: MONDAY, activities: [], profile: profile(NOVICE) })],
    [
      'injury-return',
      () =>
        input({
          today: MONDAY,
          profile: profile({ runningSinceYear: 2023, injuries: [INJURY] }),
        }),
    ],
  ])('the %s week with a finished session that no activity records', (_name, make) => {
    it('counts the finished session among its run days and keeps the rest day between runs', () => {
      // planned on the Monday, re-planned on the Tuesday: Wednesday to Sunday could hold three more
      const { next, firstRun } = replanAfterFirstRun(make(), false)
      expect(firstRun.date).toBe(MONDAY)
      const week = next.weeks[0]!
      expect(week.flags).toContain('restart-floor')
      const kept = runsIn(next, MONDAY).filter((s) => s.date < addDays(firstRun.date, 1))
      expect(kept.map((s) => s.date)).toContain(firstRun.date)
      const days = new Set(runsIn(next, MONDAY).map((s) => s.date))
      expect(days.size).toBeLessThanOrEqual(P.f5.noviceRunDays.value)
      noConsecutive(next, MONDAY)
      expect(next.checklist.filter((c) => !c.ok)).toEqual([])
    })
  })

  it('does not count a finished session that an activity stands for twice', () => {
    const { next } = replanAfterFirstRun(
      input({ activities: [runOf(5, 25)], profile: profile({ runningSinceYear: 2023 }) }),
    )
    const days = new Set(runsIn(next, MONDAY).map((s) => s.date))
    expect(days.size).toBe(P.f5.noviceRunDays.value)
  })
})

describe('a ladder week that fewer than three spaced days can hold [rules F5, E6]', () => {
  const day = (available: boolean) => ({ available, maxMin: null })
  const onlyMonTueWed = {
    mon: day(true),
    tue: day(true),
    wed: day(true),
    thu: day(false),
    fri: day(false),
    sat: day(false),
    sun: day(false),
  }

  it('sets the week target, run days and focus to what is placed, and counts the weeks in one note', () => {
    const plan = buildPlan(input({ profile: profile({ ...NOVICE, availability: onlyMonTueWed }) }))
    const ladder = plan.weeks.filter((w) => w.flags.some((f) => f.startsWith('ladder-')))
    // the week of the plan's start is a part week and keeps the programme's own numbers
    for (const w of ladder.slice(1)) {
      const runs = runsIn(plan, w.weekStart)
      expect(runs).toHaveLength(2)
      expect(w.runDays, w.weekStart).toBe(2)
      expect(w.targetRunMin, w.weekStart).toBe(runs.reduce((n, s) => n + s.durationMin, 0))
      expect(w.focus, w.weekStart).toMatch(/two days a week/)
    }
    const notes = plan.warnings.filter((w) => w.code === 'availability-limits-runs')
    expect(notes).toHaveLength(1)
    // the part week of the start and the eight whole ladder weeks after it, counted in one note
    expect(notes[0]!.message).toMatch(
      /^9 week\(s\), from the week of 2026-10-19, have room for fewer run days/,
    )
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })

  it('does the same for the injury-return ladder', () => {
    // Monday and Tuesday are open, and a level keeps a rest day between its two runs
    const plan = buildPlan(
      input({
        profile: profile({
          runningSinceYear: 2023,
          injuries: [INJURY],
          availability: { ...onlyMonTueWed, wed: day(false) },
        }),
      }),
    )
    const levels = plan.weeks.filter((w) => w.flags.includes('injury-return')).slice(1)
    expect(levels.length).toBeGreaterThan(2)
    for (const w of levels) {
      const runs = runsIn(plan, w.weekStart)
      expect(runs, w.weekStart).toHaveLength(1)
      expect(w.runDays, w.weekStart).toBe(1)
      expect(w.targetRunMin, w.weekStart).toBe(runs[0]!.durationMin)
      expect(w.focus, w.weekStart).not.toMatch(/behind|missed|streak|failed/i)
    }
    expect(plan.warnings.map((w) => w.code)).toContain('availability-limits-runs')
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
  })
})

describe('ladder completion and the review of a ladder week [rules E6, G-3, G-6]', () => {
  const ladderWeek1 = (() => {
    const sw = startWeek('ladder', 1)
    return {
      weekStart: addDays(MONDAY, -7),
      index: 0,
      phase: 'build',
      focus: sw.focus,
      targetRunMin: sw.minutes,
      longRunMin: 0,
      longRunM: null,
      gainTargetM: null,
      runDays: 3,
      qualitySessions: 0,
      strengthSessions: 0,
      tid: { z1: 100, z2: 0, z3: 0 },
      flags: ['restart-floor', ...sw.flags],
      isRecovery: false,
      isTaper: false,
    } satisfies WeekDraft
  })()

  /** Three planned sessions of the week, each linked to the activity logged for it, if any. */
  const withLinks = (logged: number[]) => {
    const sessions = [1, 3, 5].map((d, i) =>
      planned(`ls-${String(i)}`, addDays(ladderWeek1.weekStart, d), 'easy', {
        durationMin: 21,
        activityId: logged[i] === undefined ? null : `lk-${String(i)}`,
        status: logged[i] === undefined ? 'planned' : 'completed',
      }),
    )
    const activities = logged.map((m, i) =>
      activity(addDays(ladderWeek1.weekStart, [1, 3, 5][i]!), {
        id: `lk-${String(i)}`,
        durationSec: m * 60,
        movingSec: m * 60,
        distanceM: Math.round(m * 160),
        pain: 0,
      }),
    )
    return input({
      today: MONDAY,
      activities,
      profile: profile(NOVICE),
      existing: { weeks: [ladderWeek1], sessions },
    })
  }

  it("credits an activity linked to a session with at most the session's minutes", () => {
    // two of three sessions logged, each with the two 5-minute walks the watch recorded
    const inp = withLinks([31, 31])
    const ev = weekEvidence(inp, ladderWeek1.weekStart)
    expect(ev.plannedMin).toBe(63)
    expect(ev.actualMin).toBe(42)
    expect(ev.share!).toBeLessThan(P.noviceLadder.advanceMinCompletion.value)
    const st = estimateState(inp)
    const out = macroPlan(inp, st, inp.goal, feasibility(inp.goal, st, MONDAY))
    expect(out[0]!.flags).toContain('ladder-1')
    expect(out[0]!.focus).toMatch(/repeating the step/)
  })

  it('advances when all three sessions were done, walks recorded or not', () => {
    for (const logged of [
      [31, 31, 31],
      [21, 21, 21],
    ]) {
      const inp = withLinks(logged)
      const st = estimateState(inp)
      const out = macroPlan(inp, st, inp.goal, feasibility(inp.goal, st, MONDAY))
      expect(out[0]!.flags, logged.join()).toContain('ladder-2')
    }
  })

  it('counts a run that is not linked to a session whole', () => {
    const inp = withLinks([])
    const run = (d: number) =>
      activity(addDays(ladderWeek1.weekStart, d), {
        id: `free-${String(d)}`,
        durationSec: 21 * 60,
        movingSec: 21 * 60,
        pain: 0,
      })
    const free = { ...inp, activities: [run(1), run(3)] }
    expect(weekEvidence(free, ladderWeek1.weekStart).actualMin).toBe(42)
  })

  it('suggests the planned minutes for a ladder week next, not the soft ramp of the week before', () => {
    // rung 3 is 54 min and was run in full; rung 4 is 66 min, 22% more, which the ladder is
    // exempt from the soft 10% for
    const weeks = [3, 4].map((rung, i) => {
      const sw = startWeek('ladder', rung)
      return {
        ...ladderWeek1,
        weekStart: addDays(MONDAY, -7 + 7 * i),
        index: i,
        focus: sw.focus,
        targetRunMin: sw.minutes,
        flags: sw.flags,
      } satisfies WeekDraft
    })
    const done = [1, 3, 5].map((d) =>
      runOf(-(Date.parse(addDays(weeks[0]!.weekStart, d)) - Date.parse(TODAY)) / 864e5, 18, {
        id: `rev-${String(d)}`,
        pain: 0,
        rpe: 3,
      }),
    )
    const inp = input({
      today: addDays(weeks[0]!.weekStart, 7),
      activities: done,
      profile: profile(NOVICE),
      existing: { weeks, sessions: [] },
    })
    const decision = weeklyDecision(inp, weeks[0]!.weekStart)
    expect(decision.decision).toBe('progress')
    expect(decision.nextWeekTargetMin).toBe(66)
    // the same runner with a plain next week keeps the soft ramp
    const plain = {
      ...inp,
      existing: {
        weeks: [weeks[0]!, { ...weeks[1]!, flags: [], targetRunMin: 66 }],
        sessions: [],
      },
    }
    expect(weeklyDecision(plain, weeks[0]!.weekStart).nextWeekTargetMin).toBe(59)
  })
})

describe('the flags and titles of the ladder sessions [rules E6]', () => {
  const plan = buildPlan(input({ profile: profile(NOVICE) }))
  const sessionsOfRung = (rung: number) => {
    const week = plan.weeks.find((w) => w.flags.includes(`ladder-${String(rung)}`))!
    return runsIn(plan, week.weekStart)
  }

  it('gives the run-walk flag and title only to a session with a walking break', () => {
    const rung5 = sessionsOfRung(5)
    expect(rung5.map((s) => s.flags.includes('run-walk'))).toEqual([true, true, false])
    expect(rung5.map((s) => s.title)).toEqual([
      'Run-walk, step 5',
      'Run-walk, step 5',
      'Ladder step 5: 20 min easy',
    ])
  })

  it('titles the continuous rungs by their rung, as easy runs', () => {
    for (const [rung, minutes] of [
      [7, 25],
      [8, 28],
      [9, 30],
    ] as const) {
      for (const s of sessionsOfRung(rung)) {
        expect(s.title).toBe(`Ladder step ${String(rung)}: ${String(minutes)} min easy`)
        expect(s.flags).not.toContain('run-walk')
        expect(s.kind).toBe('easy')
      }
    }
  })

  it('still treats a continuous ladder run as a ladder session: no reference for the next step, 5-minute minimum', () => {
    const continuous = sessionsOfRung(8)[0]!
    expect(isProgramme(continuous)).toBe(true)
    // the guards may cut it down to 5 minutes, not to the run day minimum
    const near = activity(addDays(continuous.date, -3), {
      id: 'near-ref',
      durationSec: 600,
      movingSec: 600,
      distanceM: 1600,
    })
    const cut = applyGuards(
      [continuous],
      estimateState(input({ profile: profile(NOVICE) })),
      [near],
      { neverOverride: true },
    )
    // 28 minutes against a 10-minute run: held to the 13-minute bound, kept under the 15-minute
    // run day minimum
    expect(cut.sessions.map((x) => x.durationMin)).toEqual([13])
  })

  it('counts the longest running bout of a continuous ladder run, not the framing walks', () => {
    const rung7 = sessionsOfRung(7)[0]!
    const walk = runOf(4, 35, { id: 'rung7-run', distanceM: 4000 })
    const linked = planned('rung7', daysAgo(4), 'easy', {
      activityId: 'rung7-run',
      structure: rung7.structure,
      flags: rung7.flags,
    })
    const inp = input({ activities: [walk], profile: profile({ runningSinceYear: 2022 }) })
    const withSession = { ...inp, existing: { weeks: [], sessions: [linked] } }
    // 35 minutes recorded, 25 of them running: a 3 x 25 floor, not 3 x 30
    expect(startPath(inp, estimateState(inp))).toEqual({ kind: 'floor', sessionMin: 30 })
    expect(startPath(withSession, estimateState(withSession))).toEqual({
      kind: 'floor',
      sessionMin: 25,
    })
  })
})

describe('the orphan J7 run-walk rule is gone [rules J7, E6]', () => {
  it('leaves no run-walk threshold in the J7 parameters and no run-walk output on the restart', () => {
    expect('runWalkIfConsistentUnderMonths' in P.j7).toBe(false)
    expect(Object.keys(breakRestart(60, 100)).sort()).toEqual(['fraction', 'restartMin'])
  })
})

describe('the start level: the last two complete weeks [rules E6, G-2]', () => {
  /** The runs of the Monday week `back` weeks before the current one, on Tuesday, Thursday and Saturday. */
  const weekOf = (back: number, minutes: number[]): Activity[] =>
    minutes.map((min, i) =>
      activity(addDays(MONDAY, -7 * back + [1, 3, 5][i]!), {
        id: `week-${String(back)}-${String(i)}`,
        durationSec: min * 60,
        movingSec: min * 60,
        distanceM: Math.round(min * 160),
      }),
    )
  // weeks of 30, 30, 90 and 79 min, oldest first: a four-week median of about 55
  const stepUp = [
    ...weekOf(4, [10, 10, 10]),
    ...weekOf(3, [10, 10, 10]),
    ...weekOf(2, [30, 30, 30]),
    ...weekOf(1, [30, 25, 24]),
  ]
  const openingWeek = (activities: Activity[], over: Partial<AthleteProfile> = {}) =>
    buildPlan(input({ activities, profile: profile(over) })).weeks[0]!

  it('starts from the lesser of the last two complete weeks when the median sits below them', () => {
    const inp = input({ activities: stepUp })
    const state = estimateState(inp)
    expect(state.typicalWeekMin).toBe(55)
    expect(state.recentWeekMin).toBe(79)
    // 79 min is above 3 x 20: no start path, the plan grows from the weeks the runner ran
    expect(startPath(inp, state)).toBeNull()
    const first = openingWeek(stepUp)
    expect(first.targetRunMin).toBe(79)
    expect(first.flags).not.toContain('restart-floor')
  })

  it('opens at 79 min with no ramp warning: the baseline is the highest of the 2 preceding weeks', () => {
    const plan = buildPlan(input({ activities: stepUp }))
    // 90 min is the baseline, so 79 is inside the soft 10% step
    expect(plan.weeks[0]!.targetRunMin).toBeLessThanOrEqual(90 * (1 + P.g2.rampSoft.value))
    expect(plan.warnings.map((w) => w.code)).not.toContain('ramp-soft')
    expect(plan.warnings.map((w) => w.code)).not.toContain('ramp-ceiling')
    // the label and the plan agree: feasibility starts from the same 79 min
    expect(startWeekMin(estimateState(input({ activities: stepUp })), null)).toBe(79)
  })

  it('keeps the 3 x 20 floor for a sparse history of 30-minute weeks', () => {
    // one 30-min run a week for 4 weeks, age 50 (a soft flag): the median and the recent level are 30
    const sparse = [1, 2, 3, 4].flatMap((back) => weekOf(back, [30]))
    const flagged = { birthYear: 1976 }
    const inp = input({ activities: sparse, profile: profile(flagged) })
    const state = estimateState(inp)
    expect(state.typicalWeekMin).toBe(30)
    expect(state.recentWeekMin).toBe(30)
    expect(startPath(inp, state)).toEqual({ kind: 'floor', sessionMin: 20 })
    const first = openingWeek(sparse, flagged)
    expect(first.targetRunMin).toBe(3 * P.restartFloor.sessionMin.value)
    expect(first.flags).toContain('restart-floor')
  })

  it('is not lifted by a single big week: the recent level needs two', () => {
    // 30, 30, 30 and then 120 min in one week
    const spike = [
      ...weekOf(4, [30]),
      ...weekOf(3, [30]),
      ...weekOf(2, [30]),
      ...weekOf(1, [40, 40, 40]),
    ]
    const flagged = { birthYear: 1976 }
    const inp = input({ activities: spike, profile: profile(flagged) })
    const state = estimateState(inp)
    expect(state.typicalWeekMin).toBe(30)
    expect(state.recentWeekMin).toBe(30)
    expect(startPath(inp, state)).toEqual({ kind: 'floor', sessionMin: 20 })
    expect(openingWeek(spike, flagged).targetRunMin).toBe(60)
  })

  it('counts a big current week as nothing: only complete weeks set the level', () => {
    const thisWeek = activity(TODAY, { id: 'big-today', durationSec: 7200, movingSec: 7200 })
    const inp = input({ activities: [...weekOf(1, [30]), ...weekOf(2, [30]), thisWeek] })
    expect(estimateState(inp).recentWeekMin).toBe(30)
  })

  it('does not lift a restart after a break above the J7 restart volume', () => {
    // the same weeks seen from the Sunday after the last run: 8 days off, restart at 90%
    const sunday = addDays(MONDAY, 6)
    const inp = input({ today: sunday, activities: stepUp })
    const raw = estimateState(inp)
    expect(raw.layoffDays).toBe(8)
    expect(raw.recentWeekMin).toBe(79)
    const state = afterBreak(raw)
    expect(state.typicalWeekMin).toBe(breakRestart(raw.layoffDays, raw.typicalWeekMin).restartMin)
    expect(state.typicalWeekMin).toBeLessThan(79)
    // the start level is the restart volume, not the 79 minutes before the break
    expect(startLevelMin(state)).toBe(state.typicalWeekMin)
  })
})

describe('the 3 x 30 start from a block of weeks [rules E6, g-8]', () => {
  const FLOOR_20 = { kind: 'floor', sessionMin: 20 }
  const FLOOR_30 = { kind: 'floor', sessionMin: 30 }
  const LIFTED = ['standard', 'upper'] as const
  const pathAt = (base: EngineInput, position?: LoadAppetite) => {
    const inp = at(base, position)
    return startPath(inp, estimateState(inp))
  }
  const planAt = (base: EngineInput, position?: LoadAppetite) => buildPlan(at(base, position))
  const positionAt = (base: EngineInput, position: LoadAppetite) => {
    const inp = at(base, position)
    return loadPosition(inp, estimateState(inp))
  }
  /** The draft at standard and upper is the steady one: nothing but the lift differs in this task. */
  const sameAtEveryPosition = (base: EngineInput) => {
    const steady = planAt(base, 'steady')
    expect(planAt(base)).toEqual(steady)
    for (const position of LIFTED) expect(planAt(base, position), position).toEqual(steady)
  }
  const cleanPlan = (plan: ReturnType<typeof buildPlan>) => {
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
    const flags = plan.sessions.flatMap((s) => s.flags)
    expect(flags).not.toContain('spike-warn')
    expect(flags).not.toContain('override-required')
    // 'spike-no-reference' only says that no run of the last 30 days gives a reference; the
    // others say a run was cut, dropped or left at its hard limit
    const cuts = ['spike-hard-limit', 'spike-shortened', 'spike-run-dropped']
    expect(plan.warnings.map((w) => w.code).filter((code) => cuts.includes(code))).toEqual([])
  }

  it('H1: the runner of appendix A starts on 3 x 20 at steady and 3 x 30 at standard and upper', () => {
    expect(pathAt(h1())).toEqual(FLOOR_20)
    expect(pathAt(h1(), 'steady')).toEqual(FLOOR_20)
    for (const position of LIFTED) expect(pathAt(h1(), position), position).toEqual(FLOOR_30)

    const steady = planAt(h1())
    const standard = planAt(h1(), 'standard')
    expect(steady.weeks[0]!.targetRunMin).toBe(60)
    expect(standard.weeks[0]!.targetRunMin).toBe(90)
    expect(standard.weeks[0]!.flags).toContain('restart-floor')
    // the only difference between the positions is the lift
    expect(planAt(h1(), 'upper')).toEqual(standard)
    expect(planAt(h1(), 'steady')).toEqual(steady)
    cleanPlan(steady)
    cleanPlan(standard)
  })

  it('H2: three years of running start on 3 x 30 at every position, and the drafts are the same', () => {
    for (const position of ['steady', ...LIFTED] as const) {
      expect(pathAt(h1(3), position), position).toEqual(FLOOR_30)
    }
    sameAtEveryPosition(h1(3))
    expect(planAt(h1(3)).weeks[0]!.targetRunMin).toBe(90)
  })

  it('S4 and S5 have no start path at any position, and the drafts are the same', () => {
    const control = scenario(s4Runs(), { years: 3 })
    const layoff = scenario(s5Runs())
    for (const base of [control, layoff]) {
      for (const position of ['steady', ...LIFTED] as const) {
        expect(pathAt(base, position)).toBeNull()
      }
      sameAtEveryPosition(base)
    }
  })

  it('passes the checklist and cuts no run on every case at every position', () => {
    const bases = [
      h1(),
      h1(3),
      scenario(s4Runs(), { years: 3 }),
      scenario(s5Runs()),
      h5(),
      h6([30, 35, 35]),
      h6([20, 20, 20]),
      h7(),
      h7Twice(),
      h26(60, 2),
      h26(100, 2),
      scenario(s3Runs(), { profile: { birthYear: 1980 } }),
    ]
    for (const [i, base] of bases.entries()) {
      for (const position of ['steady', ...LIFTED] as const) {
        const plan = planAt(base, position)
        expect(
          plan.checklist.filter((c) => !c.ok).map((c) => c.id),
          `case ${String(i)} at ${position}`,
        ).toEqual([])
        expect(
          plan.sessions.flatMap((s) => s.flags).filter((f) => f === 'spike-warn'),
          `case ${String(i)} at ${position}`,
        ).toEqual([])
      }
    }
  })

  it('H5, H7 and a modest H6 lift nothing: no block, so the drafts are the steady ones', () => {
    for (const base of [h5(), h7(), h6([20, 20, 20])]) {
      for (const position of LIFTED) expect(pathAt(base, position)).toEqual(FLOOR_20)
      sameAtEveryPosition(base)
    }
  })

  it('H6: the steady weeks set the block, not the 600-minute week among them', () => {
    // 100-minute weeks lift at standard; the window with the big week would read 250 either way
    expect(pathAt(h6([30, 35, 35]), 'standard')).toEqual(FLOOR_30)
    expect(pathAt(h6([30, 35, 35]))).toEqual(FLOOR_20)
    // 60-minute weeks around the same big week do not, though a plain mean would be 195
    expect(pathAt(h6([20, 20, 20]), 'upper')).toEqual(FLOOR_20)
  })

  it('H7: two runs a week make the block, one does not', () => {
    expect(pathAt(h7Twice(), 'standard')).toEqual(FLOOR_30)
    expect(pathAt(h7Twice())).toEqual(FLOOR_20)
    expect(pathAt(h7(), 'standard')).toEqual(FLOOR_20)
  })

  it('needs a block of at least 3 x 30 minutes a week: 90 lifts, 89 does not', () => {
    const block = (minutes: number[]) => scenario([...weeks(20, 8, minutes), ...SPARSE])
    expect(pathAt(block([45, 45]), 'standard')).toEqual(FLOOR_30)
    expect(pathAt(block([45, 44]), 'standard')).toEqual(FLOOR_20)
    expect(P.restartFloor.sessions.value * P.restartFloor.sessionMaxMin.value).toBe(90)
  })

  it('needs a year of running: under a year the block route stays shut', () => {
    const young = scenario(s3Runs(), { profile: { runningSinceYear: 2026 } })
    expect(estimateState(young).yearsRunning).toBe(0)
    for (const position of LIFTED) expect(pathAt(young, position)).not.toEqual(FLOOR_30)
  })

  it('keeps N at the longest run of the last 30 days, rounded down to 5, and G-1 bounds it', () => {
    // S3 with no run of the last weeks longer than `cap` minutes
    const short = (cap: number) =>
      scenario([...summer(), ...SPARSE.map((r) => ({ ...r, min: Math.min(r.min, cap) }))])
    // a longest run of 25 minutes gives 3 x 25; of 32 minutes gives 3 x 30
    expect(pathAt(short(25), 'standard')).toEqual({ kind: 'floor', sessionMin: 25 })
    expect(pathAt(short(25))).toEqual(FLOOR_20)
    expect(pathAt(short(32), 'standard')).toEqual(FLOOR_30)
    // under 20 minutes there is no floor session to lift
    expect(pathAt(short(18), 'standard')).not.toEqual(FLOOR_30)
  })

  describe('H8: held at steady under every excluded profile', () => {
    const injury = {
      area: 'knee',
      side: 'left' as const,
      year: 2026,
      month: 6,
      kind: 'joint' as const,
      notes: null,
    }
    const bsi = { ...injury, year: 2022, kind: 'bone-stress' as const }
    const checkin = (over: Partial<Checkin>) =>
      wellnessDay(addDays(HISTORY_TODAY, -2), {
        fatigue: 3,
        soreness: 3,
        mood: 3,
        stress: 3,
        sleepQuality: 3,
        ...over,
      })
    const windowOf = (over: Partial<DisruptionWindow>): DisruptionWindow => ({
      id: 'w1',
      reason: 'illness-above-neck',
      mode: 'rest',
      startDate: '2026-10-22',
      endDate: '2026-10-26',
      maxRunMin: null,
      pain: null,
      gaitChange: false,
      ...over,
    })
    const race = activity('2026-10-16', {
      id: 'marathon',
      type: 'race',
      durationSec: 4 * 3600,
      movingSec: 4 * 3600,
      distanceM: 42_195,
    })
    const withRace = () => {
      const base = h1()
      return { ...base, activities: [...base.activities, race] }
    }
    const cases: Array<[string, EngineInput, LoadHold]> = [
      [
        'an injury in the last 12 months',
        scenario(s3Runs(), { profile: { injuries: [injury] } }),
        'recent-injury',
      ],
      [
        'an earlier bone stress injury',
        scenario(s3Runs(), { profile: { injuries: [bsi] } }),
        'bone-stress',
      ],
      [
        'two BSI factors (an earlier injury and a low BMI)',
        scenario(s3Runs(), {
          profile: { injuries: [bsi], sex: 'female', heightCm: 168, weightKg: 50 },
        }),
        'bone-stress',
      ],
      ['a REDs hold', scenario(s3Runs(), { screeningFlags: 2 }), 'reds-hold'],
      [
        'focal bone pain',
        scenario(s3Runs(), { wellness: [checkin({ painFocalBone: true, painScore: 4 })] }),
        'bone-pain',
      ],
      ['a rest window', scenario(s3Runs(), { disruptions: [windowOf({})] }), 'rest-window'],
      [
        'an injury report',
        scenario(s3Runs(), {
          disruptions: [windowOf({ reason: 'niggle', pain: 6 })],
        }),
        'recent-injury',
      ],
      ['the window after a past race', withRace(), 'post-race'],
    ]

    it.each(cases)('%s', (_name, base, reason) => {
      for (const position of LIFTED) {
        const inp = at(base, position)
        const state = estimateState(inp)
        expect(loadPosition(inp, state)).toEqual({
          requested: position,
          position: 'steady',
          held: reason,
          ageCapped: false,
        })
        expect(blockLift(inp, state)).toBe(false)
        expect(startPath(inp, state), position).toEqual(pathAt(base, 'steady'))
      }
      sameAtEveryPosition(base)
    })

    it('holds a low-frequency runner at steady (the profile that needs no start path)', () => {
      // one 70-minute run a week for 12 weeks: a start level above 3 x 20, under 2 runs a week
      const base = scenario(weeks(12, 1, [70]))
      const state = estimateState(base)
      expect(state.lowFrequency).toBe(true)
      expect(positionAt(base, 'standard')).toMatchObject({
        position: 'steady',
        held: 'low-frequency',
      })
      expect(positionAt(base, 'upper')).toMatchObject({ position: 'steady', held: 'low-frequency' })
      sameAtEveryPosition(base)
    })

    it('holds a profile that two BSI factors tighten, without an earlier injury', () => {
      const inp = at(h1(), 'standard')
      const state = estimateState(inp)
      const tight = { ...state, risk: { ...state.risk, bsiFactors: P.g3.bsiFactorsForCap.value } }
      expect(loadPosition(inp, tight)).toMatchObject({ position: 'steady', held: 'bsi-factors' })
      expect(blockLift(inp, tight)).toBe(false)
    })

    it('names the first reason that applies, and lets a held position resume when it ends', () => {
      const both = scenario(s3Runs(), { screeningFlags: 2, profile: { injuries: [injury] } })
      expect(positionAt(both, 'standard').held).toBe('recent-injury')
      // the window ended: the position is back
      const over = scenario(s3Runs(), {
        disruptions: [windowOf({ endDate: '2026-10-01', startDate: '2026-09-28' })],
      })
      expect(positionAt(over, 'standard')).toMatchObject({ position: 'standard', held: null })
      // a window that has not begun does not hold it
      const ahead = scenario(s3Runs(), {
        disruptions: [windowOf({ startDate: '2026-11-02', endDate: '2026-11-05' })],
      })
      expect(positionAt(ahead, 'standard')).toMatchObject({ position: 'standard', held: null })
    })

    it('reads steady and an absent option the same way, with nothing to hold', () => {
      for (const [, base] of cases) {
        const state = estimateState(base)
        expect(loadPosition(base, state)).toEqual({
          requested: 'steady',
          position: 'steady',
          held: null,
          ageCapped: false,
        })
        expect(loadPosition(at(base, 'steady'), state)).toEqual(loadPosition(base, state))
      }
    })
  })

  describe('H11 and Q12: age 45 or over', () => {
    const aged = { birthYear: 1980 } // 46 in 2026
    it('leaves the block route open, reads upper as standard and keeps the years route shut', () => {
      const base = scenario(s3Runs(), { profile: aged })
      expect(estimateState(base).risk.noviceFlags).toEqual(['age-45-plus'])
      expect(pathAt(base)).toEqual(FLOOR_20)
      expect(pathAt(base, 'standard')).toEqual(FLOOR_30)
      expect(pathAt(base, 'upper')).toEqual(FLOOR_30)
      expect(positionAt(base, 'standard')).toEqual({
        requested: 'standard',
        position: 'standard',
        held: null,
        ageCapped: false,
      })
      expect(positionAt(base, 'upper')).toEqual({
        requested: 'upper',
        position: 'standard',
        held: null,
        ageCapped: true,
      })
      expect(planAt(base, 'upper')).toEqual(planAt(base, 'standard'))
      expect(planAt(base, 'standard').weeks[0]!.targetRunMin).toBe(90)

      // the years route keeps its age rule: three years and no block still start on 3 x 20 ...
      const noBlock = scenario(SPARSE, { years: 3, profile: aged })
      for (const position of ['steady', ...LIFTED] as const) {
        expect(pathAt(noBlock, position), position).toEqual(FLOOR_20)
      }
      // ... where the same runner at 40 is lifted by the years
      expect(pathAt(scenario(SPARSE, { years: 3 }))).toEqual(FLOOR_30)
    })

    it('leaves an upper request at 45 the way it is under 45', () => {
      expect(positionAt(h1(), 'upper')).toMatchObject({ position: 'upper', ageCapped: false })
    })
  })

  it('holds the block route back for the other soft start flags', () => {
    const heavy = scenario(s3Runs(), { profile: { heightCm: 170, weightKg: 95 } })
    expect(estimateState(heavy).risk.noviceFlags).toEqual(['bmi-over-30'])
    for (const position of LIFTED) expect(pathAt(heavy, position)).toEqual(FLOOR_20)
  })

  it('H26: the lift reads a block that ended within 12 weeks, whichever window ships', () => {
    // the peak ended 14 weeks ago; modest weeks of 60 minutes since are under 3 x 30
    for (const end of [12, 16]) {
      withTaperEnd(end, () => {
        expect(pathAt(h26(60, 2), 'standard'), String(end)).toEqual(FLOOR_20)
        // a recent block of 100 minutes lifts, though at 16 weeks the tapered peak outranks it
        expect(pathAt(h26(100, 2), 'standard'), String(end)).toEqual(FLOOR_30)
        expect(pathAt(h26(100, 2)), String(end)).toEqual(FLOOR_20)
      })
    }
    withTaperEnd(16, () => {
      const state = estimateState(h26(100, 2))
      expect(state.history).toMatchObject({ blockMin: 280, taper: 0.75, fullCreditMin: 100 })
    })
  })

  it('names the route taken: the years, the block, or neither', () => {
    expect(startLift(at(h1(), 'standard'), estimateState(h1()))).toBe('block')
    expect(startLift(at(h1(3), 'standard'), estimateState(h1(3)))).toBe('years')
    expect(startLift(h1(3), estimateState(h1(3)))).toBe('years')
    expect(startLift(h1(), estimateState(h1()))).toBeNull()
  })
})

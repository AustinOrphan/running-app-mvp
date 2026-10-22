// The start paths [rules E6, G-3, A9, A5]: the run-walk ladder, the 3 x N floor and the
// injury-return ladder, from the choice of the path to the ladder weeks, the advance and hold at a
// re-plan, the sessions and the limits around them. Synthetic runners; no personal data.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { runChecklist } from '../../../shared/engine/checklist.ts'
import { feasibility } from '../../../shared/engine/goal.ts'
import { applyGuards } from '../../../shared/engine/guards.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { macroPlan, startPath } from '../../../shared/engine/macro.ts'
import { placeWeek } from '../../../shared/engine/micro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { prescribe } from '../../../shared/engine/sessions.ts'
import {
  clipBlueprint,
  rungCount,
  rungSessions,
  sessionMin,
  startWeek,
  stepAt,
} from '../../../shared/engine/startWeeks.ts'
import type { EngineInput, SessionSpec, WeekDraft } from '../../../shared/engine/types.ts'
import type { Activity, AthleteProfile } from '../../../shared/types.ts'
import { ZONES } from './e6-fixtures.ts'
import { activity, input, planned, profile, TODAY, wellnessDay } from './e8-fixtures.ts'

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

  it('does not lift an earlier bone stress injury or the other tightened profiles', () => {
    const old = { ...INJURY, year: 2022, kind: 'bone-stress' as const }
    expect(pathOf([runOf(10, 30)], { injuries: [old] })).toBeNull()
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

  it('draws no ladder under a progression hold, and starts from the start floor week', () => {
    const held = weeksOf(novice({ screeningFlags: 2 }))
    expect(ladderOf(held)).toEqual([])
    expect(held[0]!.targetRunMin).toBe(P.macroDesign.startFloorWeekMin.value)
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
  })

  it('climbs the levels from a pain-free run: 25 minutes allow level 5 and then level 6 at 1.10x', () => {
    const plan = buildPlan({
      ...injured(),
      activities: [runOf(5, 25, { pain: 0 })],
    })
    const levels = plan.weeks.filter((w) => w.flags.includes('injury-return'))
    expect(levels.map((w) => w.flags.find((f) => f.startsWith('injury-level-')))).toEqual([
      'injury-level-4',
      'injury-level-5',
    ])
    const runs = plan.sessions.filter((s) => s.flags.includes('injury-return'))
    // level 5 is 25 min, the run before it; level 6 is 30 min, held to 1.10 x 25 = 27
    expect(runs.map((s) => s.durationMin)).toEqual([25, 25, 27, 27])
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
    const twoRuns = (w: WeekDraft, over: Partial<Activity> = {}) =>
      [1, 4].map((d) =>
        runOf(-(Date.parse(addDays(w.weekStart, d)) - Date.parse(TODAY)) / 864e5, 10, {
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
    // the ladder ends after level 6
    expect(levelAfter(levels([4, 5]), (w) => twoRuns(w))).toBe(-1)
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
  // two 15-minute runs a few days ago: the ladder starts at rung 4, held to 16 min a session
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

  it('draws the first plan from the run it can hold: rung 4 in sessions of 16 minutes', () => {
    expect(plan.weeks[0]!.flags).toEqual(
      expect.arrayContaining(['restart-floor', 'run-walk', 'ladder-4']),
    )
    const runs = plan.sessions.filter((s) => mondayOf(s.date) === MONDAY && s.kind === 'easy')
    expect(runs.map((s) => s.durationMin)).toEqual([16, 16, 16])
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

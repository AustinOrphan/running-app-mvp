// The post-race window [rules H12]: holds by class, the 1.5 modifier, the steps and their caps, the
// check-in gate that only delays, the plan weeks it lays over the Mondays, and the plans built
// around it. Synthetic runners only.
import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { completedReference, countsTowardReference } from '../../../shared/engine/limits.ts'
import { P } from '../../../shared/engine/params/index.ts'
import {
  dayLimit,
  holdDaysOf,
  postRaceWarnings,
  postRaceWindow,
  postRaceWindows,
  windowDay,
  windowViolations,
  windowWeeks,
  type PostRaceHistoryRace,
  type PostRaceRace,
} from '../../../shared/engine/postRace.ts'
import type { Checkin, EngineInput, GoalModel } from '../../../shared/engine/types.ts'
import { activity, profile, spec, wellnessDay } from './e8-fixtures.ts'
import { athletes, TODAY } from './matrix-fixtures.ts'

type RaceClass = GoalModel['distanceClass']

/** A Sunday. */
const RACE = '2027-03-14'
const DISTANCE: Record<RaceClass, number> = {
  '5k': 5000,
  '10k': 10_000,
  half: 21_097,
  marathon: 42_195,
  ultra50: 50_000,
  ultra100k: 100_000,
  ultra100mi: 160_934,
  beyond: 200_000,
}

function race(distanceClass: RaceClass, over: Partial<PostRaceRace> = {}): PostRaceRace {
  return {
    date: RACE,
    distanceM: DISTANCE[distanceClass],
    lossM: null,
    distanceClass,
    ...over,
  }
}

/** An earlier race in the class, so that no first-finish modifier applies. */
const earlier = (distanceClass: RaceClass): PostRaceHistoryRace[] => [
  { date: '2025-05-01', distanceM: DISTANCE[distanceClass] },
]

const checkin = (date: string, over: Partial<Checkin> = {}): Checkin => ({
  date,
  fatigue: 3,
  soreness: 3,
  sleepQuality: 3,
  mood: 3,
  stress: 3,
  illness: false,
  painScore: null,
  painArea: null,
  painFocalBone: false,
  ...over,
})

/** A window without a modifier: a runner of 30 with an earlier race of the class. */
function plain(distanceClass: RaceClass, checkins: Checkin[] = [], today = addDays(RACE, -30)) {
  return postRaceWindow(race(distanceClass), { age: 30 }, earlier(distanceClass), checkins, today)
}

/** Daily check-ins from the day after the race through `last`, with `over` for chosen days. */
function daily(
  last: number,
  over: Record<number, Partial<Checkin>> = {},
  usual: Partial<Checkin> = {},
): Checkin[] {
  return Array.from({ length: last }, (_, i) => {
    const day = i + 1
    return checkin(addDays(RACE, day), { ...usual, ...over[day] })
  })
}

const day = (n: number) => addDays(RACE, n)

describe('hold and window length by class', () => {
  it.each([
    ['marathon', 2, 16],
    ['ultra50', 4, 18],
    ['ultra100k', 7, 28],
    ['ultra100mi', 10, 31],
    ['beyond', 14, 35],
  ] as const)('%s: a %i-day hold and quality from day %i', (distanceClass, hold, quiet) => {
    const w = plain(distanceClass)
    expect(w.holdDays).toBe(hold)
    expect(w.holdUntil).toBe(day(hold))
    expect(w.quietUntil).toBe(day(quiet))
    expect(w.extensionDays).toBe(0)
    expect(w.modified).toBe(false)
  })

  it.each(['5k', '10k', 'half'] as const)('%s: no hold and one step of 7 days', (distanceClass) => {
    const w = plain(distanceClass)
    expect(w.holdDays).toBe(0)
    expect(w.stages).toHaveLength(1)
    expect(w.stages[0]).toMatchObject({ fraction: 0.5, from: RACE, to: day(6) })
    expect(w.quietUntil).toBe(day(7))
  })

  it('reads the hold from the parameters', () => {
    expect(P.h12HoldDays.marathon.value).toBe(2)
    expect(P.h12HoldDays.marathon.grade).toBe('B')
    expect(P.h12HoldDays.ultra100mi.grade).toBe('D')
  })
})

describe('return steps and run caps', () => {
  it('runs 7-day steps from the end of the hold, each at its fraction of the reference week', () => {
    const marathon = plain('marathon')
    expect(marathon.stages.map((s) => s.fraction)).toEqual([0.5, 0.75])
    expect(marathon.stages.map((s) => [s.from, s.to])).toEqual([
      [day(2), day(8)],
      [day(9), day(15)],
    ])
    expect(plain('ultra50').stages.map((s) => s.fraction)).toEqual([0.5, 0.75])
    for (const c of ['ultra100k', 'ultra100mi', 'beyond'] as const) {
      const w = plain(c)
      expect(w.stages.map((s) => s.fraction)).toEqual([0.25, 0.5, 0.75])
      w.stages.forEach((s, i) => {
        expect(daysBetween(s.from, s.to)).toBe(6)
        if (i > 0) expect(s.from).toBe(addDays(w.stages[i - 1]!.to, 1))
      })
      expect(w.stages[2]!.to).toBe(addDays(w.quietUntil, -1))
    }
  })

  it('caps the first step at 3 runs of 40 min, the second at 60, later steps at 90 for the longest', () => {
    const [one, two, three] = plain('ultra100k').stages
    expect(one).toMatchObject({ runMaxMin: 40, maxRuns: 3, longRunMaxMin: 40 })
    expect(two).toMatchObject({ runMaxMin: 60, maxRuns: null, longRunMaxMin: 60 })
    expect(three).toMatchObject({ runMaxMin: 60, maxRuns: null, longRunMaxMin: 90 })
    expect(P.h12.step1RunMaxMin.grade).toBe('B')
    expect(P.h12.step2RunMaxMin.grade).toBe('D')
  })

  it('limits a day by its step and closes the hold', () => {
    const w = plain('marathon')
    expect(dayLimit([w], day(1))).toMatchObject({ hold: true })
    expect(dayLimit([w], day(2))).toMatchObject({ hold: false, step: 1, runMaxMin: 40 })
    expect(dayLimit([w], day(9))).toMatchObject({ step: 2, runMaxMin: 60 })
    expect(dayLimit([w], day(16))).toBeNull()
    expect(dayLimit([w], addDays(RACE, -1))).toBeNull()
    expect(windowDay(w, day(1))).toEqual({ kind: 'hold' })
  })
})

describe('the 1.5 modifier', () => {
  const hilly = { lossM: 35 * 160.934 }

  it('applies once for a first 100-miler with 35 m/km of descent at 45: 15 days, not 34', () => {
    const r = race('ultra100mi', hilly)
    const w = postRaceWindow(r, { age: 45 }, [], [], addDays(RACE, -1))
    expect(w.modified).toBe(true)
    expect(w.baseHoldDays).toBe(10)
    expect(w.holdDays).toBe(15)
    expect(w.quietUntil).toBe(day(15 + 21))
  })

  it.each([
    ['a steep descent of 30 m/km', race('ultra100mi', { lossM: 30 * 160.934 }), 30, earlier],
    ['an age of 40', race('ultra100mi'), 40, earlier],
    ['a first finish in the class', race('ultra100mi'), 30, () => []],
  ] as const)('lengthens the hold for %s', (_label, r, age, history) => {
    const h = holdDaysOf(r, { age }, history('ultra100mi'))
    expect(h).toEqual({ days: 15, base: 10, modified: true })
  })

  it('does not apply to a runner of 39 with an earlier finish and a gentle course', () => {
    const r = race('ultra100mi', { lossM: 29 * 160.934 })
    expect(holdDaysOf(r, { age: 39 }, earlier('ultra100mi')).days).toBe(10)
  })

  it('skips the descent rule when the loss is unknown, and ignores an earlier race of another class', () => {
    expect(holdDaysOf(race('ultra100mi'), { age: 30 }, earlier('ultra100mi')).days).toBe(10)
    expect(holdDaysOf(race('ultra100mi'), { age: 30 }, earlier('marathon')).days).toBe(15)
  })

  it('rounds up: 2 to 3, 4 to 6, 7 to 11, 14 to 21', () => {
    const days = (c: RaceClass) => holdDaysOf(race(c), { age: 50 }, earlier(c)).days
    expect([days('marathon'), days('ultra50'), days('ultra100k'), days('beyond')]).toEqual([
      3, 6, 11, 21,
    ])
  })

  it('leaves a race without a hold at no hold', () => {
    expect(holdDaysOf(race('half'), { age: 50 }, []).days).toBe(0)
  })
})

describe('the check-in gate', () => {
  const marathon = (checkins: Checkin[], today: string) =>
    postRaceWindow(race('marathon'), { age: 30 }, earlier('marathon'), checkins, today)

  it('keeps the default schedule on two clean check-ins, and with no check-ins at all', () => {
    expect(marathon(daily(20), day(20)).quietUntil).toBe(day(16))
    expect(marathon([], day(20)).quietUntil).toBe(day(16))
    expect(marathon([], day(20)).extensionDays).toBe(0)
  })

  it('moves a boundary one day for a sore day just before it, and the later boundaries with it', () => {
    // the step-2 boundary is day 9: day 7 is among the last two check-ins before day 9 only
    const w = marathon(daily(14, { 7: { soreness: 5 } }), day(14))
    expect(w.holdUntil).toBe(day(2))
    expect(w.stages[1]!.from).toBe(day(10))
    expect(w.quietUntil).toBe(day(17))
    expect(w.extensionDays).toBe(1)
  })

  it('moves a boundary by the length of a run of poor days', () => {
    const w = marathon(
      daily(20, { 7: { fatigue: 5 }, 8: { fatigue: 5 }, 9: { fatigue: 5 }, 10: { fatigue: 5 } }),
      day(20),
    )
    expect(w.stages[1]!.from).toBe(day(13))
    expect(w.extensionDays).toBe(4)
    expect(w.quietUntil).toBe(day(20))
  })

  it('never advances a stage: good check-ins leave the default dates', () => {
    const w = marathon(daily(20, { 3: { mood: 5, fatigue: 1, soreness: 1 } }), day(20))
    expect(w.stages[1]!.from).toBe(day(9))
    expect(w.quietUntil).toBe(day(16))
  })

  it('holds a boundary for pain, illness or focal bone pain, whatever the scores say', () => {
    const delayed = (over: Partial<Checkin>) =>
      marathon(daily(14, { 7: over }), day(14)).extensionDays
    expect(delayed({ painScore: 1 })).toBe(1)
    expect(delayed({ illness: true })).toBe(1)
    expect(delayed({ painFocalBone: true })).toBe(1)
    expect(delayed({ painScore: 0 })).toBe(0)
  })

  it('looks at check-ins after the race only', () => {
    const before = [checkin(addDays(RACE, -1), { fatigue: 5 }), checkin(RACE, { fatigue: 5 })]
    expect(marathon([...before, ...daily(20)], day(20)).extensionDays).toBe(0)
  })

  it('stays at the default dates for boundaries after today, plus the delay so far', () => {
    // today is day 8: the day-9 boundary is ahead, so it is not tested yet
    const w = marathon(daily(8, { 7: { soreness: 5 }, 8: { soreness: 5 } }), day(8))
    expect(w.stages[1]!.from).toBe(day(9))
    expect(w.extensionDays).toBe(0)
    // today is day 9 with day 8 poor: the boundary of day 9 is tested and moves to tomorrow
    const later = marathon(daily(9, { 8: { soreness: 5 } }), day(9))
    expect(later.stages[1]!.from).toBe(day(10))
    expect(later.extensionDays).toBe(1)
  })

  it('also counts a check-in as poor when it is worse than the own median of 14 pre-race days', () => {
    const fresh = Array.from({ length: 14 }, (_, i) =>
      checkin(addDays(RACE, -28 + i), { fatigue: 1, soreness: 1 }),
    )
    // fatigue 3 and soreness 3 are normal on the fixed scale but two points worse than own median
    const sorePost = daily(14, { 7: { fatigue: 3, soreness: 3 } }, { fatigue: 1, soreness: 1 })
    expect(marathon(sorePost, day(14)).extensionDays).toBe(0)
    expect(marathon([...fresh, ...sorePost], day(14)).extensionDays).toBe(1)
    // 13 check-ins are not enough for an own baseline
    expect(marathon([...fresh.slice(1), ...sorePost], day(14)).extensionDays).toBe(0)
  })

  it('shows the J8 checklist once the delay reaches 14 days, and not before', () => {
    const poorTo = (last: number) => {
      const over: Record<number, Partial<Checkin>> = {}
      for (let d = 1; d <= last; d++) over[d] = { fatigue: 5 }
      return postRaceWindow(
        race('ultra100mi'),
        { age: 30 },
        earlier('ultra100mi'),
        daily(30, over),
        day(30),
      )
    }
    const short = poorTo(12)
    expect(short.extensionDays).toBeLessThan(P.h12.gateEscalationDays.value)
    expect(postRaceWarnings([short])).toEqual([])
    const long = poorTo(21)
    expect(long.extensionDays).toBeGreaterThanOrEqual(P.h12.gateEscalationDays.value)
    const [warning] = postRaceWarnings([long])
    expect(warning?.code).toBe('post-race-gate')
    expect(warning?.message).toMatch(/energy intake, iron, illness and sleep/)
    expect(warning?.message).not.toMatch(/behind|missed/i)
    expect(warning?.rules).toContain('J8')
  })
})

describe('the Monday weeks of a window', () => {
  it('lays each step over the days of the week it covers, after the hold', () => {
    // a Sunday race: Monday is day 1, the 10-day hold ends on day 10, a Wednesday
    const w = plain('ultra100mi')
    const mondays = [day(1), day(8), day(15), day(22), day(29)]
    const weeks = windowWeeks(w, {
      weekStarts: mondays,
      firstIndex: 4,
      reference: 400,
      referenceRunDays: 5,
    })
    // week 1: days 1 to 7, all hold; week 2: days 8 and 9 hold, days 10 to 14 step 1 (.25)
    expect(weeks.map((x) => x.index)).toEqual([4, 5, 6, 7, 8])
    expect(weeks[0]).toMatchObject({ targetRunMin: 0, runDays: 0, focus: 'After the race: rest' })
    expect(weeks[1]!.targetRunMin).toBe(Math.floor((0.25 * 400 * 5) / 7))
    expect(weeks[1]!.runDays).toBe(3)
    // week 3: days 15 to 16 step 1, days 17 to 21 step 2 (.5)
    expect(weeks[2]!.targetRunMin).toBe(Math.floor((0.25 * 400 * 2 + 0.5 * 400 * 5) / 7))
    for (const x of weeks) {
      expect(x).toMatchObject({
        flags: ['post-race'],
        isRecovery: true,
        isTaper: false,
        qualitySessions: 0,
        strengthSessions: 0,
        gainTargetM: null,
      })
      expect(x.focus).not.toMatch(/behind|missed/i)
    }
  })

  it('holds a week to what its run caps allow', () => {
    // step 1 of a marathon at 0.5 x 600 min: three runs of 40 min hold 120 min at most
    const w = plain('marathon')
    const [first] = windowWeeks(w, {
      weekStarts: [day(1)],
      firstIndex: 0,
      reference: 600,
      referenceRunDays: 6,
    })
    expect(first!.targetRunMin).toBeLessThanOrEqual(3 * 40)
    expect(first!.runDays).toBe(3)
  })

  it('gives a late week a long run of up to 90 min from the third step', () => {
    const w = plain('ultra100k')
    const weeks = windowWeeks(w, {
      weekStarts: [day(23)],
      firstIndex: 0,
      reference: 500,
      referenceRunDays: 5,
    })
    expect(weeks[0]!.longRunMin).toBeGreaterThan(60)
    expect(weeks[0]!.longRunMin).toBeLessThanOrEqual(90)
  })
})

describe('what breaks a window', () => {
  const w = plain('marathon')
  const run = (date: string, over = {}) => spec(date, 'easy', { durationMin: 30, ...over })

  it('finds a run in the hold, a run over its cap, and quality work before the end', () => {
    expect(windowViolations([run(day(2))], [w], day(1))).toEqual([])
    expect(windowViolations([run(day(1))], [w], day(1))[0]).toMatch(/inside the hold/)
    expect(windowViolations([run(day(3), { durationMin: 41 })], [w], day(1))[0]).toMatch(/cap/)
    expect(windowViolations([spec(day(12), 'threshold')], [w], day(1))[0]).toMatch(
      /quality|threshold/,
    )
    expect(windowViolations([spec(day(16), 'threshold')], [w], day(1))).toEqual([])
    expect(windowViolations([run(day(12), { flags: ['downhill'] })], [w], day(1))[0]).toMatch(
      /easy work|before the end/,
    )
  })

  it('finds a fourth run, and runs on consecutive days, in the first step', () => {
    const four = [run(day(2)), run(day(4)), run(day(6)), run(day(8))]
    expect(windowViolations(four, [w], day(1)).join(' ')).toMatch(/4 run days/)
    expect(windowViolations([run(day(2)), run(day(3))], [w], day(1)).join(' ')).toMatch(
      /consecutive/,
    )
    expect(windowViolations([run(day(2)), run(day(4)), run(day(6))], [w], day(1))).toEqual([])
  })
})

describe('the windows of an input', () => {
  const base = athletes().find((a) => a.id === 'first-100-mile')!
  const raceActivity = (daysAgo: number, distanceM: number, over = {}) =>
    activity(addDays(TODAY, -daysAgo), {
      id: `race-${daysAgo}-${distanceM}`,
      type: 'race',
      durationSec: Math.round(distanceM * 0.45),
      distanceM,
      ...over,
    })
  const withRaces = (...races: ReturnType<typeof raceActivity>[]): EngineInput => ({
    ...base.input,
    profile: profile({ birthYear: 1990, longRunDay: 'sat' }),
    activities: [...base.input.activities, ...races],
  })

  it('finds a 100-mile race 5 days ago still in its window', () => {
    const { past, own } = postRaceWindows(withRaces(raceActivity(5, 160_934)))
    expect(past?.race.date).toBe(addDays(TODAY, -5))
    expect(past?.holdDays).toBe(15) // a first finish in the class: 10 x 1.5
    expect(own.race.date).toBe(base.input.goal.date)
  })

  it('has no past window for a race over its window, a short race or a duplicate', () => {
    // a first 100-miler: hold 15 days plus 21 of steps, so 33 days ago is open and 40 is over
    expect(postRaceWindows(withRaces(raceActivity(33, 160_934))).past?.race.date).toBe(
      addDays(TODAY, -33),
    )
    expect(postRaceWindows(withRaces(raceActivity(40, 160_934))).past).toBeNull()
    expect(postRaceWindows(withRaces(raceActivity(5, 21_097))).past).toBeNull()
    expect(
      postRaceWindows(
        withRaces(raceActivity(5, 160_934, { duplicateStatus: 'confirmed', id: 'dup' })),
      ).past,
    ).toBeNull()
  })

  it('keeps the window open past the default end while the gate delays it', () => {
    // a marathon 17 days ago: the default window ended on day 16 (with no modifier)
    const marathon = raceActivity(17, 42_195)
    const old = raceActivity(400, 42_195, { id: 'old-marathon' })
    const clean = withRaces(old, marathon)
    expect(postRaceWindows(clean).past).toBeNull()
    const sore = {
      ...clean,
      wellness: [
        wellnessDay(addDays(TODAY, -9), { fatigue: 5 }),
        wellnessDay(addDays(TODAY, -8), { fatigue: 3 }),
        wellnessDay(addDays(TODAY, -7), { fatigue: 3 }),
      ],
    }
    expect(postRaceWindows(sore).past?.extensionDays).toBeGreaterThan(0)
  })
})

describe('plans around a window', () => {
  const base = athletes().find((a) => a.id === 'marathon')!
  const earlierMarathon = activity('2025-10-12', {
    id: 'marathon-old',
    type: 'race',
    durationSec: 14_400,
    distanceM: 42_195,
  })

  it('gives a Sunday marathon no run before Tuesday', () => {
    const input: EngineInput = {
      ...base.input,
      profile: profile({ birthYear: 1990, longRunDay: 'sat' }),
      activities: [...base.input.activities, earlierMarathon],
      goal: { ...base.input.goal, date: RACE },
    }
    const plan = buildPlan(input)
    const after = plan.sessions.filter((s) => s.date > RACE)
    expect(after[0]).toMatchObject({ date: day(1), kind: 'rest' })
    expect(after[0]!.purpose).toMatch(/no running until 2027-03-16/)
    const firstRun = after.find((s) => s.kind !== 'rest')!
    expect(firstRun.date).toBe(day(2))
    expect(new Date(`${firstRun.date}T00:00:00Z`).getUTCDay()).toBe(2)
    expect(firstRun.title).toMatch(/^After the race: easy \d+ min$/)
    expect(firstRun.flags).toContain('post-race')
    // no run in the hold, none over its cap, no quality before day 16
    expect(windowViolations(plan.sessions, [postRaceWindows(input).own], day(1))).toEqual([])
    expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
    expect(plan.checklist.find((c) => c.id === 'race-day')?.detail).toMatch(
      /2 days without running/,
    )
  })

  describe('built 5 days after a 100-mile race', () => {
    const raceDate = addDays(TODAY, -5)
    const input: EngineInput = {
      ...athletes().find((a) => a.id === 'first-100-mile')!.input,
      profile: profile({ birthYear: 1990, longRunDay: 'sat' }),
      activities: [
        ...athletes().find((a) => a.id === 'first-100-mile')!.input.activities,
        activity(addDays(TODAY, -400), {
          id: 'old-100',
          type: 'race',
          durationSec: 108_000,
          distanceM: 160_934,
        }),
        activity(raceDate, {
          id: 'new-100',
          type: 'race',
          durationSec: 108_000,
          distanceM: 160_934,
        }),
      ],
    }
    const plan = buildPlan(input)
    const window = postRaceWindows(input).past!
    const ahead = plan.sessions.filter((s) => s.date >= TODAY)

    it('knows the window: a 10-day hold and quality from day 31', () => {
      expect(window.holdUntil).toBe(addDays(raceDate, 10))
      expect(window.quietUntil).toBe(addDays(raceDate, 31))
    })

    it('places only rest until the hold ends, with the hold copy', () => {
      const hold = ahead.filter((s) => s.date < window.holdUntil)
      expect(hold.length).toBeGreaterThan(0)
      expect(hold.every((s) => s.kind === 'rest')).toBe(true)
      expect(hold[0]!.purpose).toBe(
        `Rest. Walking and easy movement are fine; no running until ${window.holdUntil}.`,
      )
      expect(hold.map((s) => s.date)).toEqual(
        Array.from({ length: daysBetween(TODAY, window.holdUntil) }, (_, i) => addDays(TODAY, i)),
      )
    })

    it('then places capped easy runs, three in the first step on non-consecutive days', () => {
      const runs = ahead.filter((s) => s.kind !== 'rest' && s.date < window.quietUntil)
      expect(runs.length).toBeGreaterThan(0)
      for (const s of runs) {
        expect(['recovery', 'easy'], s.date).toContain(s.kind)
        expect(s.flags).toContain('post-race')
        const limit = dayLimit([window], s.date)!
        expect(s.durationMin, s.date).toBeLessThanOrEqual(limit.longRunMaxMin)
      }
      const step1 = runs.filter((s) => s.date <= window.stages[0]!.to)
      expect(step1).toHaveLength(3)
      expect(step1.map((s) => s.date)).toEqual([
        window.holdUntil,
        addDays(window.holdUntil, 2),
        addDays(window.holdUntil, 4),
      ])
      expect(step1.every((s) => s.durationMin <= 40)).toBe(true)
      expect(
        runs.every(
          (s) => !['threshold', 'intervals', 'race-pace', 'hills', 'strides'].includes(s.kind),
        ),
      ).toBe(true)
    })

    it('puts no quality session before day 31, and allows strides from that day', () => {
      const quality = ahead.filter((s) =>
        [
          'threshold',
          'intervals',
          'race-pace',
          'hills',
          'strides',
          'long-fast-finish',
          'b2b',
        ].includes(s.kind),
      )
      expect(quality.every((s) => s.date >= window.quietUntil)).toBe(true)
      expect(quality.some((s) => s.date === window.quietUntil)).toBe(true)
    })

    it('passes the checklist, its post-race item included, and starts the normal plan from J7', () => {
      expect(plan.checklist.filter((c) => !c.ok)).toEqual([])
      expect(plan.checklist.find((c) => c.id === 'post-race-window')?.detail).toMatch(
        /still in its window/,
      )
      const weeks = plan.weeks
      const afterRace = weeks.filter((w) => w.flags.includes('post-race'))
      expect(afterRace.length).toBeGreaterThan(0)
      expect(afterRace.every((w) => w.isRecovery && w.qualitySessions === 0)).toBe(true)
      const restart = weeks.find((w) => w.flags.includes('post-race-restart'))!
      const windowWeeks = afterRace.filter((w) => w.weekStart < restart.weekStart)
      // the Monday weeks of the window, then the restart week once most of the window is over
      expect(windowWeeks).toHaveLength(4)
      expect(windowWeeks[windowWeeks.length - 1]!.weekStart).toBe('2026-11-09')
      expect(restart.weekStart).toBe('2026-11-16')
      // a layoff of 10 days restarts at 90%, held to the last step plus one ramp step
      const reference = Math.max(
        ...input.activities
          .filter((a) => a.type === 'run')
          .map((a) => a.date)
          .map((d) => mondayOf(d))
          .map((m) =>
            input.activities
              .filter((a) => a.type === 'run' && mondayOf(a.date) === m)
              .reduce((n, a) => n + a.durationSec / 60, 0),
          ),
      )
      expect(restart.targetRunMin).toBeLessThanOrEqual(Math.round(reference * 0.9))
      // for 100 miles that is 0.825 of the reference, not 0.90
      expect(restart.targetRunMin).toBe(Math.floor(Math.floor(reference * 0.75) * 1.1 + 1e-9))
    })

    it('re-plans inside the window with the same window weeks and the same J7 restart', () => {
      const existing = {
        weeks: plan.weeks,
        sessions: plan.sessions.map((s, i) => ({
          ...s,
          id: `s${i}`,
          status: 'planned',
          activityId: null,
        })),
      }
      const later = addDays(TODAY, 8)
      const { draft } = replan({ ...input, today: later, existing })
      const key = (w: { weekStart: string; targetRunMin: number; flags: string[] }) =>
        `${w.weekStart} ${w.targetRunMin} ${w.flags.includes('post-race-restart')}`
      const from = mondayOf(later)
      const before = plan.weeks.filter((w) => w.weekStart >= from && w.weekStart <= '2026-11-16')
      const after = draft.weeks.filter((w) => w.weekStart >= from && w.weekStart <= '2026-11-16')
      expect(after.map(key)).toEqual(before.map(key))
      expect(draft.checklist.filter((c) => !c.ok)).toEqual([])
      const quality = draft.sessions.filter(
        (s) => s.date >= later && ['threshold', 'intervals', 'strides', 'hills'].includes(s.kind),
      )
      expect(quality.every((s) => s.date >= window.quietUntil)).toBe(true)
    })

    it('never advances the return: excellent check-ins leave the plan as it is', () => {
      const best = { fatigue: 1, soreness: 1, sleepQuality: 5, mood: 5, stress: 1 }
      const rated: EngineInput = {
        ...input,
        wellness: [-4, -3, -2, -1].map((n) => wellnessDay(addDays(TODAY, n), best)),
      }
      const firstRun = (p: typeof plan) =>
        p.sessions.find((s) => s.kind !== 'rest' && s.date >= TODAY)!
      expect(firstRun(buildPlan(rated)).date).toBe(firstRun(plan).date)
      expect(postRaceWindows(rated).past?.quietUntil).toBe(window.quietUntil)
    })

    it('moves the end of the hold when the check-ins say so', () => {
      const delayed: EngineInput = {
        ...input,
        today: addDays(raceDate, 12),
        wellness: [
          wellnessDay(addDays(raceDate, 8), { fatigue: 5 }),
          wellnessDay(addDays(raceDate, 9), { fatigue: 5 }),
        ],
      }
      const later = postRaceWindows(delayed).past!
      expect(later.holdUntil > window.holdUntil).toBe(true)
      expect(later.quietUntil).toBe(addDays(window.quietUntil, later.extensionDays))
      const delayedPlan = buildPlan(delayed)
      const firstRun = delayedPlan.sessions.find(
        (s) => s.kind !== 'rest' && s.date >= delayed.today,
      )!
      expect(firstRun.date >= later.holdUntil).toBe(true)
    })
  })
})

describe('the 30-day reference of the session spike guard (G-1)', () => {
  const at = (daysAgo: number, over: Parameters<typeof activity>[1]) =>
    activity(addDays(TODAY, -daysAgo), { id: `ref-${daysAgo}`, ...over })

  it('leaves a race of marathon distance or longer out of it, and counts shorter ones', () => {
    expect(P.g1.referenceRaceMaxM.value).toBe(42_195)
    expect(countsTowardReference(at(5, { type: 'race', distanceM: 42_195 }))).toBe(false)
    expect(countsTowardReference(at(5, { type: 'race', distanceM: 160_934 }))).toBe(false)
    expect(countsTowardReference(at(5, { type: 'race', distanceM: 42_194 }))).toBe(true)
    expect(countsTowardReference(at(5, { type: 'race', distanceM: 10_000 }))).toBe(true)
    expect(countsTowardReference(at(5, { type: 'race', distanceM: null }))).toBe(true)
    expect(countsTowardReference(at(5, { type: 'run', distanceM: 60_000 }))).toBe(true)
    expect(countsTowardReference(at(5, { type: 'run', duplicateStatus: 'confirmed' }))).toBe(false)
  })

  it('keeps a 100-mile race 10 days ago from raising the reference, and lets a 10 km race raise it', () => {
    const base = athletes().find((a) => a.id === 'half')!.input
    const history = [
      at(20, { durationSec: 50 * 60, distanceM: 9000 }),
      at(10, { type: 'race', durationSec: 108_000, distanceM: 160_934 }),
    ]
    const state = estimateState({ ...base, activities: history })
    const longest = (acts: typeof history) =>
      Math.max(...completedReference(acts, state).runs.map((r) => r.min))
    expect(longest(history)).toBe(50)
    const tenK = at(8, { type: 'race', durationSec: 55 * 60, distanceM: 10_000 })
    expect(longest([...history, tenK])).toBe(55)
  })
})

// The first hot days hold a build week [rules J5, I8; task HH1, owner decision D7].
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { isTrimmed } from '../../../shared/domain/sessionStatus.ts'
import { isHeatOnlyHold, weeklyDecision } from '../../../shared/engine/adapt.ts'
import { firstHotDays, HEAT_HOLD_FLAG } from '../../../shared/engine/heat.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EngineInput, WeekDraft } from '../../../shared/engine/types.ts'
import type { Activity } from '../../../shared/types.ts'
import { activity, input, TODAY } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'

const LAST = '2026-10-12' // the week reviewed
const COMING = '2026-10-19' // the week the hold covers; TODAY (a Wednesday) lies in it
const HOT = P.acclim.exposureTempC.value
const HOUR = P.i7.windowStartHour.value + 4 // inside the training window

function week(weekStart: string, over: Partial<WeekDraft> = {}): WeekDraft {
  return {
    weekStart,
    index: 0,
    phase: 'build',
    focus: '',
    targetRunMin: 200,
    longRunMin: 70,
    longRunM: null,
    gainTargetM: null,
    runDays: 4,
    qualitySessions: 1,
    strengthSessions: 0,
    tid: { z1: 0.8, z2: 0.1, z3: 0.1 },
    flags: [],
    isRecovery: false,
    isTaper: false,
    ...over,
  }
}

function hours(date: string, tempC: number) {
  return [
    {
      time: `${date}T${String(HOUR).padStart(2, '0')}:00`,
      tempC,
      dewPointC: 10,
      humidityPct: 50,
      windKph: 5,
    },
  ]
}

/** A forecast with a warmest hour of `tempC` on each of the given days of the coming week. */
function forecast(days: number[], tempC: number, cool = 15): NonNullable<EngineInput['forecast']> {
  return [0, 1, 2, 3, 4, 5, 6].flatMap((d) =>
    hours(addDays(COMING, d), days.includes(d) ? tempC : cool),
  )
}

function heatRun(date: string, tempC: number | null = HOT): Activity {
  return activity(date, { id: `hot-${date}`, durationSec: 45 * 60, tempC })
}

function run(date: string, min: number): Activity {
  return activity(date, { id: `run-${date}`, durationSec: min * 60, tempC: 12 })
}

function base(
  over: Partial<EngineInput> = {},
): Pick<EngineInput, 'today' | 'forecast' | 'activities' | 'existing'> & EngineInput {
  return input({
    activities: [run('2026-10-12', 70), run('2026-10-14', 70), run('2026-10-16', 60)],
    existing: { weeks: [week(LAST), week(COMING, { targetRunMin: 220 })], sessions: [] },
    forecast: forecast([2, 3], HOT),
    ...over,
  })
}

describe('firstHotDays: the forecast', () => {
  it('fires at the number of hot days and not below it', () => {
    expect(firstHotDays(base({ forecast: forecast([2, 3], HOT) }), COMING)).toEqual({
      source: 'forecast',
      days: 2,
    })
    expect(firstHotDays(base({ forecast: forecast([2], HOT) }), COMING)).toBeNull()
  })

  it('counts a day at the exposure temperature and not a degree under it', () => {
    expect(firstHotDays(base({ forecast: forecast([2, 3], HOT - 0.1) }), COMING)).toBeNull()
  })

  it('counts only the hours inside the training window and the days from today on', () => {
    const night = [2, 3].flatMap((d) => [
      {
        time: `${addDays(COMING, d)}T${String(P.i7.windowStartHour.value - 1).padStart(2, '0')}:00`,
        tempC: 35,
        dewPointC: 10,
        humidityPct: 50,
        windKph: 5,
      },
    ])
    expect(firstHotDays(base({ forecast: [...forecast([], HOT), ...night] }), COMING)).toBeNull()
    // Monday and Tuesday are past on the Wednesday
    expect(firstHotDays(base({ forecast: forecast([0, 1], HOT) }), COMING)).toBeNull()
  })

  it('reads a cool forecast as cool: hot runs do not stand in for it', () => {
    const hot = [heatRun('2026-10-20', HOT + 3)]
    expect(firstHotDays(base({ forecast: forecast([], HOT), activities: hot }), COMING)).toBeNull()
  })
})

describe('firstHotDays: the recent runs, with no forecast for the week', () => {
  const runs = (date: string, tempC: number) =>
    base({ forecast: null, activities: [heatRun(date, tempC)] })

  it('fires on a run at the exposure temperature within the window, and not under it', () => {
    expect(firstHotDays(runs('2026-10-20', HOT), COMING)).toEqual({ source: 'runs', days: 1 })
    expect(firstHotDays(runs('2026-10-20', HOT - 0.1), COMING)).toBeNull()
  })

  it('stops at the edge of the recent days', () => {
    const edge = addDays(TODAY, -(P.j5.heatRecentDays.value - 1))
    expect(firstHotDays(runs(edge, HOT), COMING)).not.toBeNull()
    expect(firstHotDays(runs(addDays(edge, -1), HOT), COMING)).toBeNull()
  })

  it('stands in for a forecast with no hour for the week', () => {
    const far = hours(addDays(COMING, 20), 30)
    expect(
      firstHotDays(base({ forecast: far, activities: [heatRun('2026-10-20')] }), COMING),
    ).toEqual({ source: 'runs', days: 1 })
  })
})

describe('firstHotDays: the acclimation credit', () => {
  const days = (n: number) =>
    Array.from({ length: n }, (_, k) => heatRun(addDays(TODAY, -(n - 1 - k))))

  it('holds below the credit and not at it', () => {
    // each exposure day adds 1 / i8.blockDays: two days are 0.2, three are 0.3
    expect(P.j5.heatCreditBelow.value).toBeCloseTo(0.3)
    expect(firstHotDays(base({ activities: days(2) }), COMING)).not.toBeNull()
    expect(firstHotDays(base({ activities: days(3) }), COMING)).toBeNull()
  })

  it('counts a marked warm-room run as an exposure, as the credit does', () => {
    const warmRoom = Array.from({ length: 3 }, (_, k) =>
      activity(addDays(TODAY, -k), {
        id: `room-${k}`,
        durationSec: 45 * 60,
        heatExposure: 'warm-room',
      }),
    )
    expect(firstHotDays(base({ activities: warmRoom }), COMING)).toBeNull()
  })
})

describe('firstHotDays: where it never applies', () => {
  const hold = (over: Partial<WeekDraft>) =>
    firstHotDays(
      base({
        existing: {
          weeks: [week(LAST), week(COMING, { targetRunMin: 220, ...over })],
          sessions: [],
        },
      }),
      COMING,
    )

  it('holds a loading week of the build or the specific phase', () => {
    expect(hold({})).not.toBeNull()
    expect(hold({ phase: 'specific' })).not.toBeNull()
  })

  it.each<[string, Partial<WeekDraft>]>([
    ['a taper week', { phase: 'taper', isTaper: true }],
    ['a race week', { phase: 'race' }],
    ['a recovery week', { isRecovery: true }],
    ['a post-race week', { flags: ['post-race'] }],
    ['a week of a start programme', { flags: ['injury-return'] }],
  ])('never holds %s', (_name, over) => {
    expect(hold(over)).toBeNull()
  })

  it('has nothing to hold in a week planned at or under the last loading week as it was run', () => {
    expect(hold({ targetRunMin: 200 })).toBeNull()
    expect(hold({ targetRunMin: 201 })).not.toBeNull()
  })

  it('never holds a week the plan does not have', () => {
    expect(firstHotDays(base({ existing: null }), COMING)).toBeNull()
  })

  it('holds once in the gap and again after it', () => {
    const flagged = (weeksBack: number) =>
      firstHotDays(
        base({
          existing: {
            weeks: [
              week(addDays(COMING, -7 * weeksBack), { flags: [HEAT_HOLD_FLAG] }),
              week(COMING, { targetRunMin: 220 }),
            ],
            sessions: [],
          },
        }),
        COMING,
      )
    expect(flagged(1)).toBeNull()
    expect(flagged(P.j5.heatHoldGapWeeks.value)).toBeNull()
    expect(flagged(P.j5.heatHoldGapWeeks.value + 1)).not.toBeNull()
  })

  it('keeps a week held while it is in progress, whatever the forecast says', () => {
    const held = base({
      forecast: forecast([], HOT),
      existing: { weeks: [week(LAST), week(COMING, { flags: [HEAT_HOLD_FLAG] })], sessions: [] },
    })
    expect(firstHotDays(held, COMING)).not.toBeNull()
    expect(firstHotDays({ ...held, today: addDays(COMING, 7) }, COMING)).toBeNull()
  })
})

describe('weeklyDecision with the first hot days', () => {
  const STABLE = { current: 1, trendPct: 0, samples: 12 }
  const decide = (over: Partial<EngineInput> = {}) =>
    weeklyDecision(base(over), LAST, { efficiency: STABLE })

  it('holds on its own and names the heat, with no alarm and no verdict', () => {
    const d = decide()
    expect(d.decision).toBe('hold')
    expect(d.signals.map((s) => s.code)).toEqual(['heat'])
    expect(d.signals[0]!.rules).toEqual(['J5', 'I8'])
    expect(isHeatOnlyHold(d)).toBe(true)
    expect(lintText(d.signals[0]!.detail)).toEqual([])
  })

  it('never makes progress under a forecast that stays cool', () => {
    expect(decide({ forecast: forecast([], HOT) }).decision).toBe('progress')
  })

  it('holds the week at the minutes of the last loading week, never above them', () => {
    // 200 minutes were run in the week under review; the plan has 220 for the coming one
    expect(decide().nextWeekTargetMin).toBe(200)
    expect(decide().nextWeekTargetMin).toBeLessThanOrEqual(200)
  })

  it('reads a recovery week as no level: the week before it is', () => {
    const weeks = [
      week('2026-10-05'),
      week(LAST, { isRecovery: true, targetRunMin: 20 }),
      week(COMING, { targetRunMin: 220 }),
    ]
    const d = decide({
      existing: { weeks, sessions: [] },
      activities: [run('2026-10-06', 60), run('2026-10-08', 60), run('2026-10-13', 20)],
    })
    expect(d.decision).toBe('hold')
    expect(d.nextWeekTargetMin).toBe(120)
  })

  it('is not heat-only beside another signal', () => {
    const d = weeklyDecision(base(), LAST, { efficiency: STABLE, redsFlags: 2 })
    expect(d.signals.map((s) => s.code)).toEqual(['reds', 'heat'])
    expect(isHeatOnlyHold(d)).toBe(false)
  })

  it('takes a caller answer in the place of the derivation', () => {
    expect(decide({ forecast: null }).decision).toBe('progress')
    expect(
      weeklyDecision(base({ forecast: null }), LAST, { efficiency: STABLE, heatFirstDays: true })
        .decision,
    ).toBe('hold')
    expect(
      weeklyDecision(base(), LAST, { efficiency: STABLE, heatFirstDays: false }).decision,
    ).toBe('progress')
  })
})

describe('replan with a week held for the first hot days', () => {
  const half = athletes().find((a) => a.id === 'half')!
  const plan = buildPlan(half.input)
  const existing: NonNullable<EngineInput['existing']> = {
    weeks: plan.weeks,
    sessions: plan.sessions.map((s, i) => ({
      ...s,
      id: `s${i}`,
      status: 'planned',
      activityId: null,
    })),
  }
  const current = mondayOf(TODAY)
  const loading = plan.weeks.find(
    (w) =>
      w.weekStart > current &&
      !w.isRecovery &&
      !w.isTaper &&
      (w.phase === 'build' || w.phase === 'specific') &&
      !w.flags.includes('post-race') &&
      w.longRunMin >= 60,
  )
  const taper = plan.weeks.find((w) => w.isTaper && w.weekStart > current)

  const planned = (weekStart: string, sessions = plan.sessions) =>
    sessions.filter((s) => mondayOf(s.date) === weekStart)
  const minutes = (weekStart: string, sessions = plan.sessions) =>
    planned(weekStart, sessions)
      .filter((s) => !['strength', 'race', 'rest'].includes(s.kind))
      .reduce((n, s) => n + s.durationMin, 0)

  it('has a loading week of the build to hold', () => {
    expect(loading).toBeDefined()
  })

  it('caps the week, keeps its long run in place and trims no session', () => {
    const w = loading!
    const cap = Math.floor(w.targetRunMin * 0.9)
    const input = { ...half.input, existing, weekCaps: { [w.weekStart]: cap } }
    const open = replan({ ...half.input, existing })
    const heat = replan(input, { decisions: { [w.weekStart]: 'hold' }, heatHeld: [w.weekStart] })
    const plain = replan(input, { decisions: { [w.weekStart]: 'hold' } })

    const week = heat.draft.weeks.find((x) => x.weekStart === w.weekStart)!
    expect(week.targetRunMin).toBe(cap)
    expect(week.flags).toContain(HEAT_HOLD_FLAG)
    expect(week.longRunMin).toBe(w.longRunMin)
    expect(minutes(w.weekStart, heat.draft.sessions)).toBeLessThanOrEqual(cap)
    expect(minutes(w.weekStart, heat.draft.sessions)).toBeLessThan(
      minutes(w.weekStart, open.draft.sessions),
    )
    const longOf = (sessions: typeof plan.sessions) =>
      Math.max(
        0,
        ...planned(w.weekStart, sessions)
          .filter((s) => s.kind === 'long' || s.kind === 'long-fast-finish')
          .map((s) => s.durationMin),
      )
    expect(longOf(heat.draft.sessions)).toBe(longOf(open.draft.sessions))
    expect(planned(w.weekStart, heat.draft.sessions).some((s) => isTrimmed(s.rules))).toBe(false)
    // an ordinary hold of the same cap shrinks the long run with the rest and trims a session
    expect(plain.draft.weeks.find((x) => x.weekStart === w.weekStart)!.longRunMin).toBeLessThan(
      w.longRunMin,
    )
    expect(plain.draft.weeks.find((x) => x.weekStart === w.weekStart)!.flags).not.toContain(
      HEAT_HOLD_FLAG,
    )
  })

  it('carries the weeks after the held one on from it', () => {
    const w = loading!
    const cap = Math.floor(w.targetRunMin * 0.9)
    const heat = replan(
      { ...half.input, existing, weekCaps: { [w.weekStart]: cap } },
      { decisions: { [w.weekStart]: 'hold' }, heatHeld: [w.weekStart] },
    )
    const after = heat.draft.weeks.find((x) => x.weekStart === addDays(w.weekStart, 7))
    const open = plan.weeks.find((x) => x.weekStart === addDays(w.weekStart, 7))
    expect(after).toBeDefined()
    expect(after!.targetRunMin).toBeLessThanOrEqual(open!.targetRunMin)
  })

  it('never marks or caps a taper week as a heat hold', () => {
    if (taper === undefined) return
    const cap = Math.floor(taper.targetRunMin * 0.85)
    const heat = replan(
      { ...half.input, existing, weekCaps: { [taper.weekStart]: cap } },
      { heatHeld: [taper.weekStart] },
    )
    expect(heat.draft.weeks.find((x) => x.weekStart === taper.weekStart)!.flags).not.toContain(
      HEAT_HOLD_FLAG,
    )
  })
})

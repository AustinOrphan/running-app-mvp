// The share of a race week's time above zone 1 [rules F2, K6, H12]. An entered race takes the week's
// long run out of the time the check counts (the race is not plan volume), and a quality session that
// has already passed cannot be eased, so the sessions that are left can hold more than `f2.z2z3ShareMax`
// of it. The week then adds easy minutes back, never beyond the minutes it held without the race; when
// the only room left is the day before the race, its shake-out grows, to the easing's own cap.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { weeklyDecision } from '../../../shared/engine/adapt.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { buildPlan, replan, weeklyRamp } from '../../../shared/engine/index.ts'
import { rebuildZone } from '../../../shared/engine/loadSetting.ts'
import { runningMinutes } from '../../../shared/engine/limits.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EngineInput, EnteredRace } from '../../../shared/engine/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'

const NOT_RUNS = new Set(['strength', 'mobility', 'rest', 'cross', 'race'])

// The half marathon runner with two closed days and caps on Thursday and Friday, and a break week
// (a finished loading week run at about 28% of its target) three weeks before a C race of marathon
// distance on a Saturday: the weekly update's re-plans on Tuesday to Friday of the race week.
function raceWeek() {
  const matrix = athletes().find((a) => a.id === 'half')!.input
  const base: EngineInput = {
    ...matrix,
    profile: {
      ...matrix.profile,
      availability: {
        ...matrix.profile.availability,
        mon: { available: false, maxMin: null },
        wed: { available: false, maxMin: null },
        thu: { available: true, maxMin: 50 },
        fri: { available: true, maxMin: 45 },
      },
    },
  }
  const plain = buildPlan(base)
  const scheduled = plain.weeks.find((w, i) => i >= 1 && w.isRecovery && !w.isTaper)!
  const monday = scheduled.weekStart
  const breakMonday = addDays(monday, -7)
  const date = addDays(breakMonday, 7 * 3 + 5)
  const entered: EnteredRace = {
    priority: 'C',
    goal: {
      ...base.goal,
      goalId: `tune-C-${date}`,
      name: `Synthetic ${date}`,
      date,
      gainM: 0,
      lossM: 0,
      surface: 'road',
      goalType: 'finish',
      targetTimeSec: null,
      startTime: null,
      isUltra: false,
      crossesDarkness: false,
      raceWbgtC: null,
      distanceM: 42_195,
      distanceClass: 'marathon',
      expectedDurationSec: 13_500,
    },
  }
  const runs = plain.sessions
    .filter((x) => !NOT_RUNS.has(x.kind) && x.durationMin > 0 && x.date < monday)
    .map((x, i) =>
      activity(x.date, {
        id: `run-${String(i)}`,
        durationSec: Math.round(x.durationMin * 60 * (mondayOf(x.date) === breakMonday ? 0.28 : 1)),
        tempC: 12,
      }),
    )
  const existing = (() => {
    const plan = buildPlan({ ...base, races: [entered] })
    return {
      weeks: plan.weeks,
      sessions: plan.sessions.map((x, i) => ({
        ...x,
        id: `s${String(i)}`,
        status: x.date < monday ? 'completed' : 'planned',
        activityId: null,
      })),
    }
  })()
  /** The re-plan as the weekly update runs it: the decision of the break week, its repeat capped. */
  const weekly = (today: string, races: EnteredRace[] = [entered]) => {
    const input: EngineInput = {
      ...base,
      today,
      activities: [...base.activities, ...runs],
      existing,
      races,
    }
    const state = estimateState(input)
    const d = weeklyDecision(input, breakMonday, {
      ramp: weeklyRamp(state),
      rebuild: rebuildZone(input, state),
    })
    const caps =
      d.decision === 'progress' && d.breakRepeat === undefined
        ? {}
        : { [monday]: d.nextWeekTargetMin }
    return replan(
      {
        ...input,
        weekCaps: caps,
        ...(d.breakRepeat === undefined ? {} : { breakWeek: d.breakRepeat }),
      },
      { decisions: d.decision === 'progress' ? {} : { [monday]: d.decision } },
    ).draft
  }
  return { date, weekly }
}

describe('a race week whose quality has passed', () => {
  const { date, weekly } = raceWeek()
  const week = mondayOf(date)

  for (const offset of [-4, -3, -2, -1]) {
    const n = -offset
    it(`${String(n)} day${n === 1 ? '' : 's'} before the race`, () => {
      const draft = weekly(addDays(date, offset))
      const tid = draft.checklist.find((c) => c.id === 'tid')!
      expect(tid.detail).not.toContain('above zone 1')
      expect(tid.ok).toBe(true)
      const sessions = draft.sessions.filter((s) => mondayOf(s.date) === week)
      // the race is the day's session, and the week holds no more running than the same re-plan
      // without the race
      expect(sessions.find((s) => s.date === date)?.kind).toBe('race')
      const without = weekly(addDays(date, offset), []).sessions.filter(
        (s) => mondayOf(s.date) === week,
      )
      expect(runningMinutes(sessions)).toBeLessThanOrEqual(runningMinutes(without))
      const shake = sessions.find((s) => s.date === addDays(date, -1))
      expect(runningMinutes([shake!])).toBeLessThanOrEqual(P.k6.tuneUpCDayBeforeMaxMin.value)
    })
  }
})

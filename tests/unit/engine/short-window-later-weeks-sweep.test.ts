// A window under 7 days leaves the loading weeks after it as the plan without it has them (rule J9,
// owner decision 2026-11-20, "Fix both"): the minutes the window took are not added back, and the
// weeks after it are not stepped down a ramp step for the rest of the build. The cases are the
// first-100-mile matrix athlete at the Monday of 2026-11-02, a three-day travel window, and the
// re-plans made on the Wednesday, the Monday after and a window reported ahead. Each re-plans the
// plan of the Monday before it, with every run before the day done as planned.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { replan } from '../../../shared/engine/index.ts'
import { windowFreeMinutes } from '../../../shared/engine/disruption.ts'
import type { DisruptionWindow, EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { activity } from './e8-fixtures.ts'
import { windowOf } from './disruption-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { replanChain } from './replan-steps.ts'

const NOT_RUNS = new Set(['strength', 'race', 'mobility', 'rest'])
const WEEK = '2026-11-02'

function ranFrom(draft: PlanDraft, from: string, to: string, window: DisruptionWindow | null) {
  return draft.sessions
    .filter((s) => s.date >= from && s.date < to && !NOT_RUNS.has(s.kind))
    .filter((s) => !(window !== null && window.startDate <= s.date && s.date <= window.endDate))
    .map((s) =>
      activity(s.date, {
        id: `done-${s.date}-${String(s.order)}`,
        durationSec: s.durationMin * 60,
        distanceM: s.distanceM ?? s.durationMin * 170,
      }),
    )
}

function inputAt(
  base: EngineInput,
  draft: PlanDraft,
  today: string,
  activities: EngineInput['activities'],
  windows: DisruptionWindow[],
): EngineInput {
  return {
    ...base,
    today,
    activities,
    ...(windows.length > 0 ? { disruptions: windows } : {}),
    existing: {
      weeks: draft.weeks,
      sessions: draft.sessions.map((s, i) => ({
        ...s,
        id: `s${String(i)}`,
        status: s.date < today ? 'completed' : 'planned',
        activityId: null,
      })),
    },
  }
}

const targets = (draft: PlanDraft, from: string, count: number) =>
  draft.weeks
    .filter((w) => w.weekStart >= from)
    .slice(0, count)
    .map((w) => w.targetRunMin)

function setup() {
  const athlete = athletes().find((a) => a.id === 'first-100-mile')!
  const steps = replanChain(athlete.input)
  const step = steps.find((s) => s.input.today === WEEK)!
  const base = { ...step.input, existing: null } as EngineInput
  const wed = addDays(WEEK, 2)
  const window = windowOf({
    id: 'w1',
    reason: 'travel',
    mode: 'rest',
    startDate: wed,
    endDate: addDays(wed, 2),
    maxRunMin: null,
    pain: null,
  })
  return { step, base, wed, window, nextMonday: addDays(WEEK, 7) }
}

describe('a window under 7 days leaves the later loading weeks unchanged', () => {
  it('re-planned on the Wednesday, then on the next Monday, the weeks after are the plan without it', () => {
    const { step, base, wed, window, nextMonday } = setup()
    const acts = [...step.input.activities, ...ranFrom(step.draft, WEEK, wed, null)]
    const without = replan(inputAt(base, step.draft, wed, acts, [])).draft
    const windowed = replan(inputAt(base, step.draft, wed, acts, [window])).draft
    // the days of the window are lost, and the week says what it held without them
    const week = windowed.weeks.find((w) => w.weekStart === WEEK)!
    expect(windowFreeMinutes(week.flags)).toBe(
      without.weeks.find((w) => w.weekStart === WEEK)!.targetRunMin,
    )
    expect(targets(windowed, nextMonday, 7)).toEqual(targets(without, nextMonday, 7))

    const actsNone = [...acts, ...ranFrom(without, wed, nextMonday, null)]
    const actsWindow = [...acts, ...ranFrom(windowed, wed, nextMonday, window)]
    const monNone = replan(inputAt(base, without, nextMonday, actsNone, [])).draft
    const monWindow = replan(inputAt(base, windowed, nextMonday, actsWindow, [window])).draft
    // the week the window cut is not made up, and the weeks after it are the stored plan's own
    expect(targets(monNone, nextMonday, 6)).toEqual([326, 478, 525, 577, 432, 600])
    expect(targets(monWindow, nextMonday, 6)).toEqual(targets(monNone, nextMonday, 6))
  })

  it('a window reported on the Monday of its week leaves the weeks after it as the plan has them', () => {
    const { step, base, window, nextMonday } = setup()
    const without = replan(inputAt(base, step.draft, WEEK, step.input.activities, [])).draft
    const windowed = replan(inputAt(base, step.draft, WEEK, step.input.activities, [window])).draft
    expect(targets(windowed, nextMonday, 7)).toEqual(targets(without, nextMonday, 7))
  })

  it('a window reported ahead in the next loading week leaves the weeks after it as the plan has them', () => {
    const { step, base } = setup()
    const ahead = windowOf({
      id: 'w2',
      reason: 'travel',
      mode: 'rest',
      startDate: '2026-11-18',
      endDate: '2026-11-20',
      maxRunMin: null,
      pain: null,
    })
    const without = replan(inputAt(base, step.draft, WEEK, step.input.activities, [])).draft
    const windowed = replan(inputAt(base, step.draft, WEEK, step.input.activities, [ahead])).draft
    // the weeks before the window's week are unchanged, the weeks after it equal the plan without it
    expect(targets(windowed, WEEK, 2)).toEqual(targets(without, WEEK, 2))
    expect(targets(windowed, addDays(mondayOf('2026-11-18'), 7), 6)).toEqual(
      targets(without, addDays(mondayOf('2026-11-18'), 7), 6),
    )
  })
})

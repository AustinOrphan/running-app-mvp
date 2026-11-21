// Tiny plans under repeated holds (owner decision 2026-11-20, "One run, growing ~10%/wk"): a week too
// small for two runs at the minimum holds one run of its minutes and grows about 10% a week until two
// fit; the placement loop and the guards agree on what a week holds, so a week's target is what its
// sessions place. A day whose G-1 limit alone lies under the session minimum still takes a run.
// Synthetic matrix athletes only.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { runningMinutes } from '../../../shared/engine/limits.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  DisruptionWindow,
  EngineInput,
  PlanDraft,
  WeekDraft,
} from '../../../shared/engine/types.ts'
import { planMinutes, windowOf } from './disruption-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { replanChain } from './replan-steps.ts'

const MIN = P.fplace.easyRunMinMin.value
const placed = (draft: PlanDraft, w: WeekDraft): number =>
  runningMinutes(
    draft.sessions.filter((s) => s.date >= w.weekStart && s.date < addDays(w.weekStart, 7)),
  )
const isLoading = (w: WeekDraft): boolean =>
  !w.isRecovery && !w.isTaper && w.phase !== 'race' && !w.flags.includes('restart-floor')

/** The first re-plan of an athlete's plan with a hold that caps the Monday's week at `cap` minutes. */
const firstPlans = new Map<string, PlanDraft>()

function held(
  id: string,
  cap: number,
  disruptions: DisruptionWindow[] = [],
): { draft: PlanDraft; monday: string } {
  const athlete = athletes().find((a) => a.id === id)!
  const first = firstPlans.get(id) ?? buildPlan(athlete.input)
  firstPlans.set(id, first)
  const monday = addDays(mondayOf(athlete.input.today), 7)
  const input: EngineInput = {
    ...athlete.input,
    today: monday,
    existing: {
      weeks: first.weeks,
      sessions: first.sessions.map((s, i) => ({
        ...s,
        id: `s${String(i)}`,
        status: s.date < monday ? 'completed' : 'planned',
        activityId: null,
      })),
    },
    weekCaps: { [monday]: cap },
    ...(disruptions.length === 0 ? {} : { disruptions }),
  }
  return { draft: replan(input, { decisions: { [monday]: 'hold' } }).draft, monday }
}

describe('a tiny plan after a hold', () => {
  for (const [id, cap] of [
    ['sparse-100-mile', 0],
    ['sparse-100-mile', 15],
    ['sparse-100-mile', 30],
    ['marathon', 15],
    ['marathon', 30],
    ['first-100-mile', 45],
  ] as const) {
    describe(`${id} at a cap of ${String(cap)} min`, () => {
      const { draft, monday } = held(id, cap)
      const ahead = draft.weeks.filter((w) => w.weekStart > monday && isLoading(w))

      it('places each loading week at its target, the one run or the runs that fit', () => {
        for (const w of ahead) {
          expect(
            placed(draft, w),
            `${w.weekStart} target ${String(w.targetRunMin)}`,
          ).toBeGreaterThanOrEqual(Math.floor(0.8 * w.targetRunMin))
        }
      })

      it('leaves no run out for the weekly ramp: the loop and the guards agree', () => {
        const dropped = (draft.warnings ?? []).filter((x) => x.code === 'ramp-run-dropped')
        expect(dropped.map((x) => x.message)).toEqual([])
      })

      it('holds one run a week while the target is under two runs at the minimum', () => {
        for (const w of ahead.filter((x) => x.targetRunMin >= 15 && x.targetRunMin < 2 * MIN)) {
          const runs = draft.sessions.filter(
            (s) =>
              s.date >= w.weekStart &&
              s.date < addDays(w.weekStart, 7) &&
              !['strength', 'mobility', 'rest'].includes(s.kind),
          )
          expect(runs.length, `${w.weekStart} target ${String(w.targetRunMin)}`).toBe(1)
        }
      })

      it('grows by about 10% a week between loading weeks, never by more than the 2-week ceiling', () => {
        let before: WeekDraft | undefined
        for (const w of ahead) {
          if (before !== undefined && placed(draft, before) > 0) {
            const step = placed(draft, w) / placed(draft, before)
            expect(step, w.weekStart).toBeLessThanOrEqual(1 + P.g2.rampSoft.value + 0.07)
          }
          before = w
        }
      })
    })
  }

  // Cause D: after a capped week of 15-minute runs, 1.10 x the 30-day reference lies under the run
  // minimum; the weeks after it held nothing, and their targets climbed back to the plan's own figure.
  it('keeps a run a week when the G-1 limit lies under the run minimum, down to the run day minimum', () => {
    const { draft, monday } = held('returning', 15)
    const weeks = draft.weeks.filter((w) => w.weekStart >= monday && isLoading(w)).slice(0, 8)
    expect(weeks.length).toBeGreaterThan(0)
    for (const w of weeks) {
      expect(
        placed(draft, w),
        `${w.weekStart} target ${String(w.targetRunMin)}`,
      ).toBeGreaterThanOrEqual(P.fplace.minRunDayMin.value)
      // the target follows what is placed: it never jumps back to the plan's own figure
      expect(w.targetRunMin, w.weekStart).toBeLessThanOrEqual(2 * MIN)
    }
  })
})

// A tiny week the guards leave with no running is no baseline: a zero in the guards' ramp sent the
// recovery week after it to the typical week (a limit of about 97 minutes), while the checklist, which
// counts the weeks that hold a session, held it to 1.3 x the last run week (14 minutes).
describe('a re-plan after a 28-day niggle that leaves weeks empty', () => {
  it('passes the checklist at the three re-plans of sparse-100-mile that failed its progression item', () => {
    const athlete = athletes().find((a) => a.id === 'sparse-100-mile')!
    const failures: string[] = []
    for (const start of ['2026-11-14', '2026-12-12', '2027-01-02']) {
      const window = windowOf({
        id: 'w',
        reason: 'niggle',
        startDate: start,
        endDate: addDays(start, 27),
        pain: 0,
      })
      for (const step of replanChain(athlete.input, { windows: [window] })) {
        for (const item of step.draft.checklist.filter((c) => !c.ok)) {
          failures.push(`${start} ${step.input.today}: ${item.id}: ${item.detail}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

// The relation that the first candidate of the redesign broke (sim-athlete: "a closed day never raises
// a week"), checked where the weeks are tiny: the shape of a week turns on its own target, which a
// closed day can only lower, and not on the room of the ramp.
describe('a closed day in a tiny plan', () => {
  const closedDay = (date: string): DisruptionWindow => ({
    id: 'closed',
    reason: 'travel',
    mode: 'rest',
    startDate: date,
    endDate: date,
    maxRunMin: null,
    pain: null,
    gaitChange: false,
  })

  it('never raises the target or the minutes of a week', () => {
    let checks = 0
    // the cases where the plan before this rule failed the relation
    for (const [id, cap] of [
      ['sparse-100-mile', 0],
      ['sparse-100-mile', 20],
      ['returning', 15],
      ['marathon', 15],
    ] as const) {
      const open = held(id, cap)
      const openMinutes = planMinutes(open.draft)
      for (let d = 0; d < 7; d += 1) {
        checks += 1
        const closed = held(id, cap, [closedDay(addDays(open.monday, d))]).draft
        for (const w of closed.weeks) {
          const was = open.draft.weeks.find((x) => x.weekStart === w.weekStart)
          if (was === undefined) continue
          expect(w.targetRunMin, `${id} ${String(cap)} ${w.weekStart} target`).toBeLessThanOrEqual(
            was.targetRunMin,
          )
        }
        for (const [week, minutes] of planMinutes(closed)) {
          expect(minutes, `${id} ${String(cap)} ${week} minutes`).toBeLessThanOrEqual(
            openMinutes.get(week) ?? 0,
          )
        }
      }
    }
    expect(checks).toBe(28)
  })
})

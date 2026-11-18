import { describe, expect, it } from 'vitest'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { descentCue } from '../../../shared/copy/downhill.ts'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import {
  DOWNHILL_FLAGS,
  downhillHeld,
  downhillLeadBegan,
  downhillWindowStart,
  holdDownhill,
  pausedOnRead,
  quadPauseThrough,
} from '../../../shared/engine/downhill.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EngineInput, SessionFlag, SessionSpec } from '../../../shared/engine/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { replanChain } from './replan-steps.ts'

const trail = athletes().find((a) => a.id === 'trail-50k')!
const RACE = trail.input.goal.date
const WINDOW_START = addDays(mondayOf(RACE), -7 * P.h5.downhillStartWeeksBeforeRace.value)
const LEAD_END = addDays(WINDOW_START, 7 * P.h5.repeatedBoutLeadWeeks.value)

const isDownhill = (s: SessionSpec): boolean =>
  s.flags.includes('downhill') || s.flags.includes('downhill-first')

const downhillRuns = (input: EngineInput): SessionSpec[] =>
  buildPlan(input).sessions.filter(isDownhill)

const checkin = (date: string, painArea: string, painScore: number) =>
  ({
    date,
    painArea,
    painScore,
    restingHr: null,
    hrvRmssd: null,
    hrvSdnn: null,
    sleepSec: null,
    sleepScore: null,
    weightKg: null,
    vo2max: null,
    id: date,
    notes: null,
    source: 'manual',
    updatedAt: date,
  }) as EngineInput['wellness'][number]

describe('downhill ordering (rule H5)', () => {
  const flagged = downhillRuns(trail.input)

  it('gives the first exposure to the lead weeks and the emphasis to the weeks after them', () => {
    expect(flagged.length).toBeGreaterThan(0)
    for (const s of flagged) {
      const lead = s.date < LEAD_END
      expect(s.flags.includes('downhill-first')).toBe(lead)
      expect(s.flags.includes('downhill')).toBe(!lead)
    }
    expect(flagged.some((s) => s.date < LEAD_END)).toBe(true)
    expect(flagged.some((s) => s.date >= LEAD_END)).toBe(true)
  })

  it('puts the emphasis at least the lead weeks after the window starts', () => {
    const first = flagged.find((s) => s.flags.includes('downhill'))!
    expect(first.date >= addDays(WINDOW_START, 7 * P.h5.repeatedBoutLeadWeeks.value)).toBe(true)
  })

  it('carries the downhill rule on every flagged session', () => {
    for (const s of flagged) expect(s.rules).toContain('H5')
  })
})

describe('the taper cut-off (rule H5)', () => {
  it('flags no session in the last days before the race', () => {
    const cut = addDays(RACE, -P.h5.taperExclusionDays.value)
    const flagged = downhillRuns(trail.input)
    expect(flagged.length).toBeGreaterThan(0)
    expect(flagged.every((s) => s.date < cut)).toBe(true)
  })

  it('holds a session 10 days out and keeps the one 11 days out', () => {
    const hold = { raceDate: RACE, pausedThrough: null, today: addDays(RACE, -60) }
    const cut = addDays(RACE, -P.h5.taperExclusionDays.value)
    expect(downhillHeld(addDays(cut, -1), hold)).toBe(false)
    expect(downhillHeld(cut, hold)).toBe(true)
    expect(downhillHeld(addDays(RACE, -1), hold)).toBe(true)
  })
})

describe('the quad soreness pause (rule H5)', () => {
  const today = '2026-12-01'

  it('starts on a quad report at the minimum pain and lasts the pause days', () => {
    const score = P.h5.quadPauseMinPain.value
    expect(quadPauseThrough([checkin(today, 'left quad', score)], today)).toBe(
      addDays(today, P.h5.quadPauseDays.value),
    )
  })

  it('ignores another area, a lower score, an old report and a future one', () => {
    const score = P.h5.quadPauseMinPain.value
    expect(quadPauseThrough([checkin(today, 'left knee', 9)], today)).toBeNull()
    expect(quadPauseThrough([checkin(today, 'quads', score - 1)], today)).toBeNull()
    expect(
      quadPauseThrough([checkin(addDays(today, -P.h5.quadPauseDays.value - 1), 'quads', 9)], today),
    ).toBeNull()
    expect(quadPauseThrough([checkin(addDays(today, 1), 'quads', 9)], today)).toBeNull()
  })

  it('takes the downhill flag and the rule off a paused session and nothing else', () => {
    const session = {
      date: addDays(today, 1),
      flags: ['downhill-first', 'night'],
      rules: ['H5', 'H6'],
      gainM: 200,
      durationMin: 60,
    } as unknown as SessionSpec
    const [held] = holdDownhill([session], {
      raceDate: addDays(today, 60),
      today,
      pausedThrough: addDays(today, 3),
    })
    expect(held!.flags).toEqual(['night'])
    expect(held!.rules).toEqual(['H6'])
    expect(held!.gainM).toBe(200)
    expect(held!.durationMin).toBe(60)
    const [after] = holdDownhill([{ ...session, date: addDays(today, 4) }], {
      raceDate: addDays(today, 60),
      today,
      pausedThrough: addDays(today, 3),
    })
    expect(after!.flags).toContain('downhill-first')
  })

  it('removes the flag from the plan of a runner with sore quads, and never adds a session', () => {
    const firstLater = downhillRuns(trail.input).find((s) => s.date >= LEAD_END)!
    const input = { ...trail.input, today: firstLater.date }
    const free = buildPlan(input)
    const sore = buildPlan({
      ...input,
      wellness: [checkin(input.today, 'sore quads', 5)],
    })
    const dates = (p: typeof free) => p.sessions.map((s) => `${s.date}:${s.kind}:${s.durationMin}`)
    expect(dates(sore)).toEqual(dates(free))
    const through = addDays(input.today, P.h5.quadPauseDays.value)
    const freeHeld = free.sessions.filter(
      (s) => isDownhill(s) && s.date >= input.today && s.date <= through,
    )
    expect(freeHeld.length).toBeGreaterThan(0)
    expect(
      sore.sessions.filter((s) => isDownhill(s) && s.date >= input.today && s.date <= through),
    ).toEqual([])
  })
})

describe('the pause on read (rule H5)', () => {
  const wednesday = '2026-12-02'
  const thursday = '2026-12-03'
  const stored = (date: string) =>
    ({ date, flags: ['downhill'], rules: ['H5'] }) as unknown as SessionSpec

  it('hides the flags of a stored session without a re-plan, and shows them again after the pause', () => {
    const report = [checkin(wednesday, 'left quad', 4)]
    const [during] = pausedOnRead([stored(thursday)], report, wednesday)
    expect(during!.flags).toEqual([])
    expect(descentCue(during!)).toBeNull()
    const last = addDays(wednesday, P.h5.quadPauseDays.value)
    expect(pausedOnRead([stored(last)], report, last)[0]!.flags).toEqual([])
    const after = addDays(last, 1)
    expect(pausedOnRead([stored(after)], report, after)[0]!.flags).toEqual(['downhill'])
  })

  it('leaves the sessions as they are without a quad report', () => {
    const [kept] = pausedOnRead([stored(thursday)], [checkin(wednesday, 'left knee', 6)], wednesday)
    expect(kept!.flags).toEqual(['downhill'])
  })
})

describe('the descent cue (rule H5, G5)', () => {
  it('reads from the downhill flag and names the grades of the Param', () => {
    const cue = descentCue({ flags: ['downhill'] })
    expect(cue).toContain(String(P.h5.cueGradePct.value[0]))
    expect(cue).toContain(String(P.h5.cueGradePct.value[1]))
    expect(descentCue({ flags: ['downhill-first'] })).toContain('gentle')
    expect(descentCue({ flags: ['night'] })).toBeNull()
  })

  it('reads clean in both variants', () => {
    assertCleanCopy(descentCue({ flags: ['downhill'] })!)
    assertCleanCopy(descentCue({ flags: ['downhill-first'] })!)
  })
})

describe('where the downhill lead began (rule H5, follow-up 41)', () => {
  const W = '2027-01-04'
  const FIRST = '2027-01-18'
  const week = (weekStart: string, ...flags: string[]) => ({ weekStart, flags })

  it('puts the window start of a race on the Monday its param weeks before the race week', () => {
    expect(downhillWindowStart('2027-03-06')).toBe(W)
    expect(downhillWindowStart('2027-03-01')).toBe(W)
  })

  it('is null with no stored week', () => {
    expect(downhillLeadBegan([], W, FIRST)).toBeNull()
  })

  it('ignores weeks from the current Monday on, before the window and with no downhill flag', () => {
    expect(
      downhillLeadBegan(
        [
          week('2026-12-28', 'downhill'),
          week(W, 'recovery'),
          week('2027-01-11', 'post-race'),
          week(FIRST, 'downhill-first'),
          week('2027-01-25', 'downhill'),
        ],
        W,
        FIRST,
      ),
    ).toBeNull()
  })

  it('counts `downhill` alone (a plan from before the lead) and `downhill-first` alone', () => {
    expect(downhillLeadBegan([week('2027-01-11', 'downhill')], W, FIRST)).toBe('2027-01-11')
    expect(downhillLeadBegan([week('2027-01-11', 'downhill-first')], W, FIRST)).toBe('2027-01-11')
  })

  it('takes the earliest week whatever the order of the weeks', () => {
    const weeks = [
      week('2027-01-11', 'downhill'),
      week(W, 'downhill-first'),
      week('2027-01-18', 'downhill'),
    ]
    expect(downhillLeadBegan(weeks, W, '2027-01-25')).toBe(W)
    expect(downhillLeadBegan([...weeks].reverse(), W, '2027-01-25')).toBe(W)
  })
})

describe('the downhill lead of a plan opened inside the window (rule H5, follow-up 41)', () => {
  const baseOf = (id: string, lossM?: number): EngineInput => {
    const a = athletes().find((x) => x.id === id)!.input
    return lossM === undefined ? a : { ...a, goal: { ...a.goal, lossM } }
  }
  const bases: Array<[string, EngineInput]> = [
    ['trail-50k', baseOf('trail-50k')],
    ['first-100-mile', baseOf('first-100-mile')],
    ['marathon with 600 m of descent', baseOf('marathon', 600)],
  ]
  const WEEKS = P.h5.downhillStartWeeksBeforeRace.value
  const LEAD = P.h5.repeatedBoutLeadWeeks.value

  /** The plan opened `k` weeks into its window (negative: before it), the history and today kept. */
  const opened = (base: EngineInput, k: number, today = base.today): EngineInput => {
    const race = addDays(mondayOf(base.today), 7 * (WEEKS - k) + 5)
    return { ...base, today, goal: { ...base.goal, date: race } }
  }
  const windowStartOf = (input: EngineInput) => downhillWindowStart(input.goal.date)
  /** The weeks of the window before the taper, from the first one the plan draws. */
  const isPre = (w: { weekStart: string; isTaper: boolean; flags: string[] }, start: string) =>
    w.weekStart >= start &&
    !w.isTaper &&
    !w.flags.includes('race-week') &&
    !w.flags.includes('post-race')
  const preTaper = (draft: ReturnType<typeof buildPlan>, input: EngineInput) =>
    draft.weeks.filter((w) => isPre(w, windowStartOf(input)))
  const letters = (weeks: Array<{ flags: string[] }>) =>
    weeks
      .map((w) =>
        w.flags.includes('downhill-first') ? 'F' : w.flags.includes('downhill') ? 'H' : '.',
      )
      .join('')
  const openings = [-1, 0, 1, 2, 3, 4, 5, 6, 7]

  for (const [name, base] of bases) {
    describe(name, () => {
      it('flags every pre-taper window week and leads with the first min(3, n) of them', () => {
        for (const k of openings) {
          const input = opened(base, k)
          const draft = buildPlan(input)
          const pre = preTaper(draft, input)
          const n = pre.length
          const flagged = draft.weeks.filter(
            (w) => w.flags.includes('downhill') || w.flags.includes('downhill-first'),
          )
          expect(
            flagged.map((w) => w.weekStart),
            `opened at W+${k}`,
          ).toEqual(pre.map((w) => w.weekStart))
          expect(letters(pre), `opened at W+${k}`).toBe(
            'F'.repeat(Math.min(LEAD, n)) + 'H'.repeat(Math.max(0, n - LEAD)),
          )
        }
      })

      it('gives the same week flags when opened on the Thursday of that week', () => {
        for (const k of openings) {
          const monday = buildPlan(opened(base, k)).weeks.map((w) => w.flags)
          const thursday = opened(base, k, addDays(mondayOf(base.today), 3))
          expect(
            buildPlan(thursday).weeks.map((w) => w.flags),
            `opened at W+${k}`,
          ).toEqual(monday)
        }
      })

      it('puts the week flag on its sessions and none within the exclusion', () => {
        for (const k of openings) {
          const input = opened(base, k)
          const draft = buildPlan(input)
          const cut = addDays(input.goal.date, -P.h5.taperExclusionDays.value)
          for (const s of draft.sessions.filter(isDownhill)) {
            const w = draft.weeks.find((x) => x.weekStart === mondayOf(s.date))!
            expect(s.flags.includes('downhill-first')).toBe(w.flags.includes('downhill-first'))
            expect(s.date < cut).toBe(true)
          }
        }
      })

      it('changes only flags and the rule: the plan of a goal with no descent is the same', () => {
        const strip = (d: ReturnType<typeof buildPlan>) =>
          JSON.stringify({
            weeks: d.weeks.map((w) => ({
              ...w,
              flags: w.flags.filter((f) => !DOWNHILL_FLAGS.includes(f as SessionFlag)),
            })),
            sessions: d.sessions.map((s) => ({
              ...s,
              flags: s.flags.filter((f) => !DOWNHILL_FLAGS.includes(f)),
              rules: s.rules.filter((r) => r !== 'H5'),
            })),
          })
        for (const k of openings) {
          const input = opened(base, k)
          const flat = { ...input, goal: { ...input.goal, lossM: 0 } }
          expect(strip(buildPlan(input)), `opened at W+${k}`).toBe(strip(buildPlan(flat)))
        }
      })

      it('never starts the lead before the window or shortens it, and keeps it at every re-plan', () => {
        for (const k of [-1, 0, 1, 2, 3, 4, 5]) {
          const steps = replanChain(opened(base, k))
          const w = windowStartOf(steps[0]!.input)
          const lead = new Set(
            steps[0]!.draft.weeks
              .filter((x) => x.flags.includes('downhill-first'))
              .map((x) => x.weekStart),
          )
          for (const [i, step] of steps.entries()) {
            const here = step.draft.weeks
            const pre = here.filter((x) => isPre(x, w))
            const downhill = here.filter(
              (x) => x.flags.includes('downhill') || x.flags.includes('downhill-first'),
            )
            expect(
              downhill.map((x) => x.weekStart),
              `W+${k} step ${i}`,
            ).toEqual(pre.map((x) => x.weekStart))
            const first = downhill[0]?.weekStart
            for (const x of downhill) {
              // the calendar's lead is kept, and no emphasis week comes before the lead is served
              if (x.weekStart < addDays(w, 7 * LEAD)) {
                expect(x.flags, `W+${k} step ${i}`).toContain('downhill-first')
              }
              if (!x.flags.includes('downhill-first')) {
                expect(x.weekStart >= addDays(first!, 7 * LEAD), `W+${k} step ${i}`).toBe(true)
              }
            }
            expect(
              new Set(
                here.filter((x) => x.flags.includes('downhill-first')).map((x) => x.weekStart),
              ),
              `W+${k} step ${i}`,
            ).toEqual(lead)
          }
        }
      })
    })
  }

  const trailBase = bases[0]![1]

  it('gives the explicit shapes of the trail athlete: F F F H at W+3 and one F at W+6', () => {
    const shape = (k: number) => {
      const input = opened(trailBase, k)
      return letters(preTaper(buildPlan(input), input))
    }
    expect(shape(0)).toBe('FFFHHHH')
    expect(shape(1)).toBe('FFFHHH')
    expect(shape(3)).toBe('FFFH')
    expect(shape(4)).toBe('FFF')
    expect(shape(6)).toBe('F')
    expect(shape(7)).toBe('')
  })

  it('gives three lead weeks and no emphasis at W+3 to a goal with a three-week taper', () => {
    const marathon = bases[2]![1]
    const input = opened(marathon, 3)
    expect(letters(preTaper(buildPlan(input), input))).toBe('FFF')
  })

  it('reads a stored plan from before the lead flags as exposure from its first downhill week', () => {
    const [, second] = replanChain(opened(trailBase, 1), { maxSteps: 1 })
    const w = windowStartOf(second!.input)
    const old = {
      ...second!.input,
      existing: {
        ...second!.input.existing!,
        weeks: second!.input.existing!.weeks.map((x) => ({
          ...x,
          flags: x.flags.filter((f) => f !== 'downhill-first'),
        })),
      },
    }
    const here = replan(old).draft.weeks.filter((x) => x.weekStart >= addDays(w, 7))
    // W+1 stays as stored (downhill alone), W+2 and W+3 finish the lead, W+4 on carries the emphasis
    expect(letters(here.slice(0, 4))).toBe('HFFH')
  })

  it('starts the lead where the descent is first raised inside the window', () => {
    const flat = opened({ ...trailBase, goal: { ...trailBase.goal, lossM: 0 } }, -2)
    const steps = replanChain(flat, { maxSteps: 4 })
    const last = steps[steps.length - 1]!
    const input = { ...last.input, goal: { ...last.input.goal, lossM: trailBase.goal.lossM } }
    expect(input.today).toBe(addDays(windowStartOf(input), 14))
    const draft = replan(input).draft
    expect(letters(preTaper(draft, input).filter((x) => x.weekStart >= input.today))).toBe('FFFHH')
  })

  it('counts from the new window start when the goal moves later, and from the first stored week when earlier', () => {
    // the plan was opened at W and is re-planned at W+1, with the goal two weeks later or earlier
    const steps = replanChain(opened(trailBase, 0), { maxSteps: 1 })
    const at = steps[steps.length - 1]!
    const moved = (days: number) => {
      const input = {
        ...at.input,
        goal: { ...at.input.goal, date: addDays(at.input.goal.date, days) },
      }
      return letters(
        replan(input)
          .draft.weeks.filter((x) => isPre(x, input.today))
          .filter((x) => x.weekStart >= windowStartOf(input)),
      )
    }
    // later: the stored week is before the new window, so the lead counts from the new window start
    expect(moved(14)).toBe('FFFHHHH')
    // earlier: the lead counts from the first stored downhill week (W), so one week of it is served
    expect(moved(-14)).toBe('FFHH')
  })

  describe('with a past B race (rule J7)', () => {
    const withRace = (input: EngineInput, date: string): EngineInput => ({
      ...input,
      activities: [
        ...input.activities,
        activity(date, {
          id: `race-${date}`,
          type: 'race',
          durationSec: 14_400,
          movingSec: 14_400,
          distanceM: 42_195,
          rpe: 9,
        }),
      ],
    })
    /** The weeks from `today` on that carry a downhill flag, after the post-race weeks. */
    const fromToday = (draft: ReturnType<typeof buildPlan>, today: string) =>
      draft.weeks.filter((x) => x.weekStart >= mondayOf(today))
    const leadFrom = (weeks: ReturnType<typeof fromToday>) => {
      const normal = weeks.filter((x) => !x.flags.includes('post-race'))
      expect(normal.length).toBeLessThan(weeks.length)
      return { normal, flagged: normal.filter((x) => isDownhillWeek(x)) }
    }
    const isDownhillWeek = (w: { flags: string[] }) =>
      w.flags.includes('downhill') || w.flags.includes('downhill-first')

    it('keeps a lead stored before the race across the recovery weeks', () => {
      const [, , at] = replanChain(opened(trailBase, 0), { maxSteps: 2 })
      const input = withRace(at!.input, addDays(at!.input.today, -2))
      const weeks = fromToday(replan(input).draft, input.today)
      expect(weeks.some((x) => x.flags.includes('post-race'))).toBe(true)
      // the lead was served in the two stored weeks, so only the emphasis is left
      expect(weeks.some((x) => x.flags.includes('downhill-first'))).toBe(false)
      expect(weeks.some((x) => x.flags.includes('downhill'))).toBe(true)
    })

    it('starts the lead of a new plan at the first normal week after the recovery weeks', () => {
      const input = withRace(opened(trailBase, 1), addDays(opened(trailBase, 1).today, -3))
      const { normal, flagged } = leadFrom(fromToday(buildPlan(input), input.today))
      expect(flagged.length).toBeGreaterThan(LEAD)
      expect(letters(flagged.slice(0, LEAD + 1))).toBe('F'.repeat(LEAD) + 'H')
      expect(flagged[0]!.weekStart).toBe(normal[0]!.weekStart)
    })

    it('starts the lead after the recovery weeks when the race was just before the window', () => {
      const [, , at] = replanChain(opened(trailBase, -2), { maxSteps: 2 })
      const w = windowStartOf(at!.input)
      expect(at!.input.today).toBe(w)
      const input = withRace(at!.input, addDays(w, -2))
      const { normal, flagged } = leadFrom(fromToday(replan(input).draft, input.today))
      expect(letters(flagged.slice(0, LEAD + 1))).toBe('F'.repeat(LEAD) + 'H')
      expect(flagged[0]!.weekStart).toBe(normal[0]!.weekStart)
    })
  })

  it('still lets a quad report and the cut take both flags off a session of the moved lead', () => {
    const input = opened(trailBase, 4)
    const sore = buildPlan({ ...input, wellness: [checkin(input.today, 'sore quads', 5)] })
    const free = buildPlan(input)
    const through = addDays(input.today, P.h5.quadPauseDays.value)
    expect(free.sessions.some((s) => isDownhill(s) && s.date <= through)).toBe(true)
    expect(sore.sessions.filter((s) => isDownhill(s) && s.date <= through)).toEqual([])
    expect(sore.sessions.filter((s) => s.date <= through && s.rules.includes('H5'))).toEqual([])
    const cut = addDays(input.goal.date, -P.h5.taperExclusionDays.value)
    expect(free.sessions.filter((s) => isDownhill(s) && s.date >= cut)).toEqual([])
  })
})

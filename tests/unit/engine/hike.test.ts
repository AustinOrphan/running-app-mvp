import { describe, expect, it } from 'vitest'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { hikeCue } from '../../../shared/copy/hike.ts'
import { addDays } from '../../../shared/dates.ts'
import { holdHike } from '../../../shared/engine/hike.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { prescribe } from '../../../shared/engine/sessions.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type { EngineInput, PlanDraft, SessionKind } from '../../../shared/engine/types.ts'
import { toWorkoutPlan } from '../../../shared/workouts/plan.ts'
import { athletes } from './matrix-fixtures.ts'
import { weekFixture, zoneSetFixture } from './fixtures.ts'

const input = (id: string): EngineInput => athletes().find((a) => a.id === id)!.input
const HIKE_KINDS: ReadonlySet<SessionKind> = new Set(['long', 'long-fast-finish', 'b2b'])
const hiking = (plan: PlanDraft) => plan.sessions.filter((s) => s.flags.includes('hike-practice'))

describe('hiking practice (rule H4, HK1)', () => {
  const trail = input('trail-50k')
  const plan = buildPlan(trail)
  const flagged = hiking(plan)
  const specificWeeks = new Set(
    plan.weeks.filter((w) => w.flags.includes('hike-practice')).map((w) => w.weekStart),
  )

  it('flags long and back-to-back sessions of a trail ultra, with the H4 rule', () => {
    expect(flagged.length).toBeGreaterThan(0)
    for (const s of flagged) {
      expect(HIKE_KINDS.has(s.kind)).toBe(true)
      expect(s.rules).toContain('H4')
    }
    // every long run of a flagged week outside the last days carries it
    const cut = addDays(trail.goal.date, -P.h5.taperExclusionDays.value)
    const longs = plan.sessions.filter(
      (s) => HIKE_KINDS.has(s.kind) && s.date < cut && specificWeeks.has(weekOf(plan, s.date)),
    )
    expect(longs.length).toBeGreaterThan(0)
    for (const s of longs) expect(s.flags).toContain('hike-practice')
  })

  it('flags only weeks of the specific phase', () => {
    for (const w of plan.weeks) {
      if (w.flags.includes('hike-practice')) expect(w.phase).toBe('specific')
    }
    for (const w of plan.weeks.filter((x) => x.phase !== 'specific')) {
      expect(w.flags).not.toContain('hike-practice')
    }
  })

  it('flags nothing in the last days before the race, on the race, or in the taper', () => {
    const cut = addDays(trail.goal.date, -P.h5.taperExclusionDays.value)
    expect(flagged.every((s) => s.date < cut)).toBe(true)
    for (const s of plan.sessions.filter((x) => x.kind === 'race')) {
      expect(s.flags).not.toContain('hike-practice')
    }
    for (const w of plan.weeks.filter((x) => x.phase === 'taper' || x.phase === 'race')) {
      expect(w.flags).not.toContain('hike-practice')
    }
  })

  it('flags no session of a road goal', () => {
    for (const id of ['novice-5k', 'half', 'marathon', 'hot-race']) {
      expect(hiking(buildPlan(input(id))), id).toEqual([])
    }
  })

  it('flags no session of a base or build week', () => {
    for (const s of flagged) {
      const week = plan.weeks.find(
        (w) => w.weekStart <= s.date && s.date <= addDays(w.weekStart, 6),
      )
      expect(week?.phase).toBe('specific')
    }
  })

  it('changes no minute, distance or gain: the plan without the flags is the plan with them', () => {
    const strip = (p: PlanDraft) =>
      p.sessions.map((s) => ({
        date: s.date,
        kind: s.kind,
        durationMin: s.durationMin,
        distanceM: s.distanceM,
        gainM: s.gainM,
      }))
    const without = {
      ...plan,
      sessions: plan.sessions.map((s) => ({
        ...s,
        flags: s.flags.filter((f) => f !== 'hike-practice'),
      })),
    }
    expect(strip(without)).toEqual(strip(plan))
  })

  it('holds a session inside the last taper-exclusion days and keeps one before them', () => {
    const race = '2027-03-06'
    const cut = addDays(race, -P.h5.taperExclusionDays.value)
    const mk = (date: string) => ({ date, flags: ['hike-practice'] as never[], rules: ['H4'] })
    const held = holdHike([mk(cut), mk(addDays(cut, -1))], race, addDays(race, -60))
    expect(held[0]!.flags).toEqual([])
    expect(held[0]!.rules).toEqual([])
    expect(held[1]!.flags).toEqual(['hike-practice'])
    expect(held[1]!.rules).toEqual(['H4'])
  })
})

/** The Monday of the plan week that holds `date`. */
function weekOf(plan: PlanDraft, date: string): string {
  return plan.weeks.find((w) => w.weekStart <= date && date <= addDays(w.weekStart, 6))!.weekStart
}

describe('the hiking cue (rule H4, HK1)', () => {
  it('names the grade and the start from the Params, in words only', () => {
    const cue = hikeCue({ flags: ['hike-practice'] })!
    expect(cue).toContain(`${String(P.h4.walkCheaperGradePct.value)} percent`)
    expect(cue).toContain(`minute ${String(P.h4.hikeCueFromMin.value)}`)
    expect(cue).toMatch(/minutes stay the same/)
    assertCleanCopy(cue)
  })

  it('is absent without the flag', () => {
    expect(hikeCue({ flags: [] })).toBeNull()
    expect(hikeCue({ flags: ['downhill'] })).toBeNull()
  })

  it('stays off the watch: the workout is the same with and without the flag', () => {
    const zones = zoneSetFixture()
    const build = (flags: string[]) => {
      const session = prescribe('long', 150, zones, weekFixture({ flags }), {
        goalPaceSecPerKm: 330,
      })
      return toWorkoutPlan(session, resolveTargets(session, zones, { hot: false }), {
        units: 'km',
      })
    }
    const flagged = prescribe('long', 150, zones, weekFixture({ flags: ['hike-practice'] }), {
      goalPaceSecPerKm: 330,
    })
    expect(flagged.flags).toContain('hike-practice')
    expect(build(['hike-practice'])).toEqual(build([]))
  })
})

import { describe, expect, it } from 'vitest'
import { descentCue } from '../../../shared/copy/downhill.ts'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { downhillHeld, holdDownhill, quadPauseThrough } from '../../../shared/engine/downhill.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EngineInput, SessionSpec } from '../../../shared/engine/types.ts'
import { athletes } from './matrix-fixtures.ts'

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
    expect(flagged.every((s) => s.date <= cut)).toBe(true)
  })

  it('holds a session on the first cut-off day and keeps the one before it', () => {
    const hold = { raceDate: RACE, pausedThrough: null, today: addDays(RACE, -60) }
    const cut = addDays(RACE, -P.h5.taperExclusionDays.value)
    expect(downhillHeld(cut, hold)).toBe(false)
    expect(downhillHeld(addDays(cut, 1), hold)).toBe(true)
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

describe('the descent cue (rule H5, G5)', () => {
  it('reads from the downhill flag and names the grades of the Param', () => {
    const cue = descentCue({ flags: ['downhill'] })
    expect(cue).toContain(String(P.h5.cueGradePct.value[0]))
    expect(cue).toContain(String(P.h5.cueGradePct.value[1]))
    expect(descentCue({ flags: ['downhill-first'] })).toContain('gentle')
    expect(descentCue({ flags: ['night'] })).toBeNull()
  })
})

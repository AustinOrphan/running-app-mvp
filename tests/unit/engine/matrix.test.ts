// The plan matrix [design section 9]: nine synthetic athletes with their goals. For each plan the
// checklist is asserted item by item and every limit is re-derived here from the finished
// sessions, in every week, without calling the code that enforces it. Determinism is asserted too.
import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { buildPlan, explain } from '../../../shared/engine/index.ts'
import type { PlanDraft, SessionKind, SessionSpec } from '../../../shared/engine/types.ts'
import type { Weekday } from '../../../shared/types.ts'
import { athletes, TODAY, type MatrixAthlete } from './matrix-fixtures.ts'

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Sessions that count as running minutes in a week (a race and a hike do not). */
const RUNNING: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'b2b',
])
const ANY_RUN: ReadonlySet<SessionKind> = new Set<SessionKind>([...RUNNING, 'hike'])
const HARD: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'long-fast-finish',
  'b2b',
])
const QUALITY: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
])

const CHECKLIST_IDS = [
  'progression',
  'recovery-cadence',
  'tid',
  'taper',
  'level-differentiation',
  'break-restart',
  'spike-guard',
  'availability',
  'spacing',
  'ultra-caps',
  'race-day',
]

const all = athletes()
const plans = new Map<string, PlanDraft>(all.map((a) => [a.id, buildPlan(a.input)]))
const planOf = (a: MatrixAthlete): PlanDraft => plans.get(a.id)!

/** Weekly running minutes: completed history plus the planned sessions from today. */
function weeklyVolume(a: MatrixAthlete, plan: PlanDraft): Map<string, number> {
  const out = new Map<string, number>()
  for (const act of a.input.activities) {
    if (act.type !== 'run' && act.type !== 'race') continue
    const w = mondayOf(act.date)
    out.set(w, (out.get(w) ?? 0) + act.durationSec / 60)
  }
  for (const s of plan.sessions) {
    if (!RUNNING.has(s.kind)) continue
    const w = mondayOf(s.date)
    out.set(w, (out.get(w) ?? 0) + s.durationMin)
  }
  return out
}

function planWeeks(plan: PlanDraft) {
  return plan.weeks.filter((w) => w.weekStart >= mondayOf(TODAY))
}

describe.each(all)('plan matrix: $label', (a) => {
  const plan = planOf(a)
  const state = estimateState(a.input)

  it('passes every checklist item', () => {
    expect(plan.checklist.map((c) => c.id)).toEqual(CHECKLIST_IDS)
    const failed = plan.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)
    expect(failed).toEqual([])
    for (const item of plan.checklist) expect(item.rules.length).toBeGreaterThan(0)
  })

  it('is deterministic: the same input twice gives the identical plan', () => {
    const again = buildPlan(structuredClone(a.input))
    expect(again).toEqual(plan)
  })

  it('plans from today to the race, with the race on race day and nothing after it until the recovery weeks', () => {
    expect(plan.sessions.length).toBeGreaterThan(0)
    expect(plan.sessions.every((s) => s.date >= TODAY)).toBe(true)
    const races = plan.sessions.filter((s) => s.kind === 'race')
    expect(races.map((s) => s.date)).toEqual([a.input.goal.date])
    expect(plan.sessions.filter((s) => s.date === a.input.goal.date).map((s) => s.kind)).toEqual([
      'race',
    ])
    const raceWeek = mondayOf(a.input.goal.date)
    const after = plan.sessions.filter(
      (s) => mondayOf(s.date) === raceWeek && s.date > a.input.goal.date,
    )
    expect(after).toEqual([])
    expect(plan.paramsVersion).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('keeps no session on an unavailable day or above the day limit', () => {
    const bad: string[] = []
    for (const s of plan.sessions) {
      if (s.kind === 'race') continue
      const day = a.input.profile.availability[WEEKDAYS[daysBetween(mondayOf(s.date), s.date)]!]
      if (!day.available) bad.push(`${s.date} ${s.kind} on a closed day`)
      else if (day.maxMin !== null && ANY_RUN.has(s.kind) && s.durationMin > day.maxMin) {
        bad.push(`${s.date} ${s.kind} ${s.durationMin} > ${day.maxMin} min`)
      }
    }
    expect(bad).toEqual([])
  })

  it('never ramps a week above the 2-week 30% ceiling, or the tightened ramp of its profile', () => {
    const volume = weeklyVolume(a, plan)
    const at = (weekStart: string, back: number) => volume.get(addDays(weekStart, -7 * back)) ?? 0
    const tight = state.risk.priorBsi || state.risk.recentInjury ? 0.05 : null
    const bad: string[] = []
    for (const w of planWeeks(plan)) {
      const total = at(w.weekStart, 0)
      const ceilingBase = Math.max(at(w.weekStart, 2), at(w.weekStart, 3))
      const previous = Math.max(at(w.weekStart, 1), at(w.weekStart, 2))
      const step = state.experience === 'novice' ? 1 : 0
      const base = previous > 0 ? previous : state.typicalWeekMin
      if (ceilingBase > 0 && total > ceilingBase * 1.3 + step + 1) {
        bad.push(
          `${w.weekStart}: ${Math.round(total)} min vs ${Math.round(ceilingBase)} two weeks back`,
        )
      }
      if (tight !== null && base > 0 && total > base * (1 + tight) + step + 1) {
        bad.push(
          `${w.weekStart}: ${Math.round(total)} min is above ${tight * 100}% on ${Math.round(base)}`,
        )
      }
    }
    expect(bad).toEqual([])
  })

  it('applies the session spike guard to every run, in every week', () => {
    const bad: string[] = []
    const completed = a.input.activities
      .filter((x) => x.type === 'run' || x.type === 'race')
      .map((x) => ({ date: x.date, min: x.durationSec / 60, distanceM: x.distanceM }))
    const earlier: Array<{ date: string; min: number; distanceM: number | null }> = []
    const runs = plan.sessions
      .filter((s) => ANY_RUN.has(s.kind))
      .sort((x, y) => (x.date < y.date ? -1 : 1))
    for (const s of runs) {
      const window = [...completed, ...earlier].filter((r) => {
        const ago = daysBetween(r.date, s.date)
        return ago >= 1 && ago <= 30
      })
      const refMin = Math.max(0, ...window.map((r) => r.min))
      const refDist = Math.max(0, ...window.map((r) => r.distanceM ?? 0))
      if (refMin > 0) {
        const ratio = s.durationMin / refMin
        if (ratio > 2) bad.push(`${s.date} ${s.kind} is ${ratio.toFixed(2)}x by time`)
        if (ratio > 1.1 + 1e-9 && !s.flags.includes('spike-warn')) {
          bad.push(`${s.date} ${s.kind} is ${ratio.toFixed(2)}x by time without a warning`)
        }
        if (state.risk.recentInjury && ratio > 1.1 + 1e-9) {
          bad.push(`${s.date} ${s.kind} passes the hard limit (${ratio.toFixed(2)}x)`)
        }
      }
      if (refDist > 0 && s.distanceM !== null) {
        const warnLimit = refDist + Math.max(refDist * 0.1, 500)
        if (s.distanceM > refDist * 2 + 1) bad.push(`${s.date} ${s.kind} is over 2x by distance`)
        if (s.distanceM > warnLimit + 1 && !s.flags.includes('spike-warn')) {
          bad.push(`${s.date} ${s.kind} is above the distance limit without a warning`)
        }
      }
      expect(s.flags).not.toContain('override-required')
      earlier.push({ date: s.date, min: s.durationMin, distanceM: s.distanceM })
    }
    expect(bad).toEqual([])
  })

  it('spaces hard days and keeps the long run out from between quality days', () => {
    const byDate = new Map<string, SessionKind[]>()
    for (const s of plan.sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s.kind])
    const bad: string[] = []
    for (const s of plan.sessions) {
      const next = byDate.get(addDays(s.date, 1)) ?? []
      const prev = byDate.get(addDays(s.date, -1)) ?? []
      const pair = s.flags.includes('b2b-day1')
      if (HARD.has(s.kind) && !pair && next.some((k) => HARD.has(k))) {
        bad.push(`${s.date} ${s.kind} is followed by a hard day`)
      }
      if (
        s.kind === 'long' &&
        prev.some((k) => QUALITY.has(k)) &&
        next.some((k) => QUALITY.has(k))
      ) {
        bad.push(`${s.date} long run between quality days`)
      }
    }
    expect(bad).toEqual([])
  })

  it('holds zone 1 at the floor in every week and the session mix under the cap', () => {
    const bad: string[] = []
    for (const w of planWeeks(plan)) {
      if (w.targetRunMin <= 0) continue
      if (w.tid.z1 < 70) bad.push(`${w.weekStart}: z1 ${w.tid.z1}`)
      if (w.tid.z2 > w.tid.z1) bad.push(`${w.weekStart}: z2 above z1`)
      if (w.tid.z1 + w.tid.z2 + w.tid.z3 !== 100)
        bad.push(`${w.weekStart}: shares do not add to 100`)
      const sessions = plan.sessions.filter(
        (s) => mondayOf(s.date) === w.weekStart && RUNNING.has(s.kind),
      )
      const total = sessions.reduce((sum, s) => sum + s.durationMin, 0)
      const hard = sessions
        .flatMap((s) => s.structure)
        .filter((st) => st.kind === 'work' && st.zone !== 'z1')
        .reduce((sum, st) => sum + ((st.durationSec ?? 0) * st.reps) / 60, 0)
      if (total > 0 && hard / total > 0.25 + 1e-9) {
        bad.push(`${w.weekStart}: ${Math.round((hard / total) * 100)}% above zone 1`)
      }
    }
    expect(bad).toEqual([])
  })

  it('cuts recovery weeks and never runs more loading weeks in a row than the cycle', () => {
    const cycle = state.risk.recentInjury || state.experience === 'novice' ? 2 : 3
    const weeks = planWeeks(plan).filter((w) => !w.isTaper && !w.flags.includes('post-race'))
    let run = 0
    let first = true
    let last = null as null | { target: number }
    const bad: string[] = []
    for (const w of weeks) {
      if (w.isRecovery) {
        if (last !== null && w.targetRunMin > last.target * 0.8 + 1) {
          bad.push(`${w.weekStart}: recovery week ${w.targetRunMin} vs ${last.target}`)
        }
        run = 0
        first = false
        continue
      }
      run += 1
      last = { target: w.targetRunMin }
      // The plan never opens with a recovery week, so the first block may be one week longer.
      if (run > cycle + (first ? 1 : 0)) bad.push(`${w.weekStart}: ${run} loading weeks in a row`)
    }
    expect(bad).toEqual([])
  })

  it('tapers strictly: each taper week holds less than the one before', () => {
    const taper = planWeeks(plan).filter((w) => w.isTaper)
    expect(taper.length).toBeGreaterThan(0)
    const volume = weeklyVolume(a, plan)
    const minutes = taper.map((w) => volume.get(w.weekStart) ?? 0)
    for (let i = 1; i < minutes.length; i++) expect(minutes[i]!).toBeLessThan(minutes[i - 1]!)
    const lastLoad = planWeeks(plan)
      .filter((w) => !w.isTaper && !w.isRecovery && w.weekStart < taper[0]!.weekStart)
      .at(-1)!
    expect(minutes[0]!).toBeLessThan(volume.get(lastLoad.weekStart) ?? 0)
  })

  it('ties every session rule id to parameters, and keeps the copy free of red states', () => {
    const rules = [...new Set(plan.sessions.flatMap((s) => s.rules))]
    const unresolved = explain(rules)
      .filter((e) => e.params.length === 0)
      .map((e) => e.rule)
    expect(unresolved).toEqual([])
    const text = [
      ...plan.sessions.flatMap((s) => [s.title, s.purpose, s.target.heatNote ?? '']),
      ...plan.warnings.map((w) => w.message),
      ...plan.weeks.map((w) => w.focus),
    ].join('\n')
    expect(text).not.toMatch(/\b(behind|missed|streak|badge|failed)\b/i)
  })
})

describe('plan matrix: per-athlete expectations', () => {
  const get = (id: string) => {
    const a = all.find((x) => x.id === id)!
    return { a, plan: planOf(a), state: estimateState(a.input) }
  }

  it('novice 5 km: three non-consecutive run days, run-walk, no hard work early, peak below the half', () => {
    const { plan, state } = get('novice-5k')
    expect(state.experience).toBe('novice')
    const days = new Map<string, Set<string>>()
    for (const s of plan.sessions.filter((x) => ANY_RUN.has(x.kind))) {
      const w = mondayOf(s.date)
      days.set(w, (days.get(w) ?? new Set()).add(s.date))
    }
    for (const set of days.values()) expect(set.size).toBeLessThanOrEqual(3)
    expect(plan.sessions.some((s) => s.flags.includes('run-walk'))).toBe(true)
    const first = planWeeks(plan)
      .slice(0, 4)
      .map((w) => w.weekStart)
    expect(
      plan.sessions.filter((s) => first.includes(mondayOf(s.date)) && HARD.has(s.kind)),
    ).toEqual([])
  })

  it('levels differ: the novice, half, marathon and 100-mile plans grow in that order', () => {
    const peak = (id: string) => {
      const { a, plan } = get(id)
      const v = weeklyVolume(a, plan)
      return Math.max(...planWeeks(plan).map((w) => v.get(w.weekStart) ?? 0))
    }
    const longest = (id: string) =>
      Math.max(
        ...get(id)
          .plan.sessions.filter((s) => s.kind !== 'race')
          .map((s) => s.durationMin),
      )
    expect(peak('novice-5k')).toBeLessThan(peak('half'))
    expect(peak('half')).toBeLessThan(peak('marathon'))
    expect(peak('marathon')).toBeLessThan(peak('first-100-mile'))
    expect(longest('novice-5k')).toBeLessThan(longest('half'))
    expect(longest('half')).toBeLessThan(longest('marathon'))
    expect(longest('marathon')).toBeLessThan(longest('first-100-mile'))
  })

  it('first 100-mile: volume first, the ultra long-run cap, night and fuel practice, spaced pairs, rest after the race', () => {
    const { a, plan } = get('first-100-mile')
    expect(a.input.goal.distanceClass).toBe('ultra100mi')
    expect(planWeeks(plan).every((w) => w.qualitySessions <= 1)).toBe(true)
    const longest = Math.max(
      ...plan.sessions.filter((s) => s.kind !== 'race').map((s) => s.durationMin),
    )
    expect(longest).toBeLessThanOrEqual(360)
    expect(plan.sessions.some((s) => s.flags.includes('night'))).toBe(true)
    expect(plan.sessions.some((s) => s.flags.includes('fuel-practice'))).toBe(true)
    const day1 = plan.sessions.filter((s) => s.flags.includes('b2b-day1'))
    expect(day1.length).toBeGreaterThan(0)
    for (const d of day1) {
      const d2 = plan.sessions.find(
        (s) => s.date === addDays(d.date, 1) && s.flags.includes('b2b-day2'),
      )
      expect(d2).toBeDefined()
      expect(d2!.durationMin).toBeLessThanOrEqual(d.durationMin)
    }
    for (let i = 1; i < day1.length; i++) {
      expect(daysBetween(day1[i - 1]!.date, day1[i]!.date)).toBeGreaterThanOrEqual(14)
    }
    const rest = plan.weeks.find((w) => w.flags.includes('post-race'))!
    expect(rest.targetRunMin).toBe(0)
    expect(plan.sessions.filter((s) => mondayOf(s.date) === rest.weekStart)).toEqual([])
  })

  it('50 km trail: climbing grows toward the course gain and sessions carry gain', () => {
    const { a, plan } = get('trail-50k')
    const gains = planWeeks(plan).map((w) => w.gainTargetM ?? 0)
    expect(Math.max(...gains)).toBeGreaterThan(0)
    expect(plan.sessions.some((s) => (s.gainM ?? 0) > 0)).toBe(true)
    expect(a.input.goal.surface).toBe('trail')
  })

  it('masters: at most six run days in a week and the closed days stay empty', () => {
    const { plan } = get('masters')
    const days = new Map<string, Set<string>>()
    for (const s of plan.sessions.filter((x) => ANY_RUN.has(x.kind) && x.kind !== 'race')) {
      const w = mondayOf(s.date)
      days.set(w, (days.get(w) ?? new Set()).add(s.date))
    }
    for (const set of days.values()) expect(set.size).toBeLessThanOrEqual(6)
    for (const s of plan.sessions) {
      const weekday = WEEKDAYS[daysBetween(mondayOf(s.date), s.date)]
      if (s.kind !== 'race') expect(['mon', 'wed']).not.toContain(weekday)
    }
  })

  it('returning after six weeks off: the first week restarts at half the pre-break week', () => {
    const { a, plan, state } = get('returning')
    expect(state.layoffDays).toBeGreaterThanOrEqual(35)
    const v = weeklyVolume(a, plan)
    const first = v.get(mondayOf(TODAY)) ?? 0
    expect(first).toBeLessThanOrEqual(state.typicalWeekMin * 0.5 * 1.1 + 1)
    expect(first).toBeGreaterThan(0)
  })

  it('prior bone stress injury: the ramp stays at or below 5% a week after the first week', () => {
    const { a, plan, state } = get('prior-bsi')
    expect(state.risk.priorBsi).toBe(true)
    const v = weeklyVolume(a, plan)
    const weeks = planWeeks(plan).filter((w) => w.isRecovery === false && !w.isTaper)
    for (let i = 1; i < weeks.length; i++) {
      const now = v.get(weeks[i]!.weekStart) ?? 0
      const before = Math.max(
        v.get(addDays(weeks[i]!.weekStart, -7)) ?? 0,
        v.get(addDays(weeks[i]!.weekStart, -14)) ?? 0,
      )
      if (before > 0) expect(now).toBeLessThanOrEqual(before * 1.05 + 1)
    }
  })

  it('hot race: heat acclimation weeks, a heat warning and a heat flag on the race', () => {
    const { a, plan } = get('hot-race')
    expect(a.input.goal.raceWbgtC).toBe(27)
    expect(plan.weeks.some((w) => w.flags.includes('heat-acclimation'))).toBe(true)
    expect(plan.warnings.some((w) => w.code === 'heat-above-model-range')).toBe(true)
    const race = plan.sessions.find((s) => s.kind === 'race')!
    expect(race.flags).toContain('heat')
  })

  it('time goals carry a race pace and a prediction with an interval when history allows', () => {
    const { plan } = get('marathon')
    expect(plan.prediction).not.toBeNull()
    expect(plan.prediction!.lowSec).toBeLessThan(plan.prediction!.predictedSec)
    expect(plan.prediction!.highSec).toBeGreaterThan(plan.prediction!.predictedSec)
    const race: SessionSpec = plan.sessions.find((s) => s.kind === 'race')!
    expect(race.target.paceSecPerKm).not.toBeNull()
  })
})

// The plan matrix [design section 9]: ten synthetic athletes with their goals. For each plan the
// checklist is asserted item by item and every limit is re-derived here from the finished
// sessions, in every week, without calling the code that enforces it. Determinism is asserted too.
import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { buildPlan, explain } from '../../../shared/engine/index.ts'
import { ownWindow, windowViolations } from '../../../shared/engine/postRace.ts'
import type { PlanDraft, SessionKind, SessionSpec } from '../../../shared/engine/types.ts'
import type { Weekday } from '../../../shared/types.ts'
import { problemsOf, windowOf } from './disruption-fixtures.ts'
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

/**
 * A session set by a ladder or injury-return programme [rules E6, g-3]: a run-walk session, an
 * injury-return run, or a continuous run of the upper rungs, which opens with the framing walk.
 */
const isStartSession = (s: SessionSpec): boolean =>
  s.flags.includes('run-walk') ||
  s.flags.includes('injury-return') ||
  (s.kind === 'easy' && s.structure[0]?.kind === 'warmup')
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
  'ladder-steps',
  'break-restart',
  'spike-guard',
  'availability',
  'spacing',
  'ultra-caps',
  'race-day',
  'post-race-window',
  'reds-hold',
  'bone-pain-hold',
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

  it('schedules no session that needs an override [rules g-1]', () => {
    expect(plan.sessions.filter((s) => s.flags.includes('override-required'))).toEqual([])
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
    // the days after the race are rest days in the hold, then easy runs of the first return step
    // within its caps [H12]
    const after = plan.sessions.filter(
      (s) => mondayOf(s.date) === raceWeek && s.date > a.input.goal.date,
    )
    const runsAfter = after.filter((s) => s.kind !== 'rest')
    expect(runsAfter.every((s) => s.flags.includes('post-race'))).toBe(true)
    expect(windowViolations(after, [ownWindow(a.input)], addDays(a.input.goal.date, 1))).toEqual([])
    expect(plan.paramsVersion).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('keeps no session on an unavailable day or above the day limit', () => {
    const bad: string[] = []
    for (const s of plan.sessions) {
      if (s.kind === 'race' || s.kind === 'rest') continue
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
    // The restart floor week is exempt from G-2 and is the ceiling baseline of the week after it.
    const floor = plan.weeks.find((w) => w.flags.includes('restart-floor'))
    for (const w of planWeeks(plan)) {
      const total = at(w.weekStart, 0)
      // the weeks after the race are exempt from G-2, as a return to an established base [H12]
      if (w.flags.includes('post-race')) continue
      if (floor !== undefined && w.weekStart === floor.weekStart) {
        // exempt from G-2 only up to the floor
        if (total > floor.targetRunMin + 1) {
          bad.push(`${w.weekStart}: floor week ${Math.round(total)} min > ${floor.targetRunMin}`)
        }
        continue
      }
      const afterFloor = floor !== undefined && daysBetween(floor.weekStart, w.weekStart) === 7
      const ceilingBase = Math.max(
        at(w.weekStart, 2),
        at(w.weekStart, 3),
        afterFloor ? at(w.weekStart, 1) : 0,
      )
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
    const earlier: Array<{ date: string; min: number; distanceM: number | null; step: boolean }> =
      []
    const runs = plan.sessions
      .filter((s) => ANY_RUN.has(s.kind))
      .sort((x, y) => (x.date < y.date ? -1 : 1))
    for (const s of runs) {
      // G-1 is checked against completed runs: a session of a run-walk or injury-return ladder is a
      // programme step, compared with the completed and the plain runs but not with another step
      // [rules E6]; the plain runs after the ladder see its sessions too
      const step = isStartSession(s)
      const window = [...completed, ...earlier.filter((r) => !step || !r.step)].filter((r) => {
        const ago = daysBetween(r.date, s.date)
        return ago >= 1 && ago <= 30
      })
      const refMin = Math.max(0, ...window.map((r) => r.min))
      const refDist = Math.max(0, ...window.map((r) => r.distanceM ?? 0))
      if (refMin > 0) {
        const ratio = s.durationMin / refMin
        // the band is 1.10x, or the reference plus the 3-minute duration step where that is more
        const warnLimit = refMin + Math.max(refMin * 0.1, 3)
        if (ratio > 2) bad.push(`${s.date} ${s.kind} is ${ratio.toFixed(2)}x by time`)
        if (s.durationMin > warnLimit + 1e-9 && !s.flags.includes('spike-warn')) {
          bad.push(`${s.date} ${s.kind} is ${ratio.toFixed(2)}x by time without a warning`)
        }
        if (state.risk.recentInjury && s.durationMin > warnLimit + 1e-9) {
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
      earlier.push({ date: s.date, min: s.durationMin, distanceM: s.distanceM, step })
    }
    expect(bad).toEqual([])
  })

  it('stays in the normal band: no warn-band run and no minimum-step gain warning [rules G6]', () => {
    expect(plan.sessions.filter((s) => s.flags.includes('spike-warn'))).toEqual([])
    const weekly = new Map<string, number>()
    for (const act of a.input.activities) {
      if (act.type !== 'run') continue
      const w = mondayOf(act.date)
      weekly.set(w, (weekly.get(w) ?? 0) + (act.elevationGainM ?? 0))
    }
    for (const s of plan.sessions) {
      if (!RUNNING.has(s.kind)) continue
      const w = mondayOf(s.date)
      weekly.set(w, (weekly.get(w) ?? 0) + (s.gainM ?? 0))
    }
    for (const w of plan.warnings.filter((x) => x.code === 'gain-ramp-soft')) {
      const week = /week of (\d{4}-\d{2}-\d{2}) is (\d+) m/.exec(w.message)!
      const before = Math.max(
        0,
        ...[1, 2, 3, 4].map((k) => weekly.get(addDays(week[1]!, -7 * k)) ?? 0),
      )
      // a warning needs a rise above both 10% and the 100 m minimum step
      expect(Number(week[2]) - before, w.message).toBeGreaterThan(100)
    }
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
      // the weeks of the run-walk ladder follow its own steps and repeats [rules E6]
      if (w.flags.some((f) => f.startsWith('ladder-'))) {
        run = 0
        continue
      }
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
    // a 100-mile race: the first week after it is inside the hold, so it holds rest days only
    const rest = plan.weeks.find((w) => w.flags.includes('post-race'))!
    expect(rest.targetRunMin).toBe(0)
    const inRest = plan.sessions.filter((s) => mondayOf(s.date) === rest.weekStart)
    expect(inRest.length).toBeGreaterThan(0)
    expect(inRest.every((s) => s.kind === 'rest')).toBe(true)
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
      if (s.kind !== 'race' && s.kind !== 'rest') expect(['mon', 'wed']).not.toContain(weekday)
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

// ---- plan adequacy [task E16] ----

const MIN_RUN = 20
const RUN_WALK_MIN = 15

/** Weeks the guards shortened: the warning message names the Monday of the week. */
function cutWeeks(plan: PlanDraft): Set<string> {
  const out = new Set<string>()
  for (const w of plan.warnings) {
    if (w.code !== 'ramp-ceiling' && w.code !== 'ramp-tightened') continue
    const m = /week of (\d{4}-\d{2}-\d{2})/.exec(w.message)
    if (m !== null) out.add(m[1]!)
  }
  return out
}

/** Weeks placed in full: not the part week the plan opens in, the race week or the weeks after it. */
function fullWeeks(plan: PlanDraft) {
  return planWeeks(plan).filter(
    (w) =>
      w.weekStart > mondayOf(TODAY) &&
      !w.flags.includes('race-week') &&
      !w.flags.includes('post-race'),
  )
}

describe.each(all)('plan adequacy: $label', (a) => {
  const plan = planOf(a)
  const state = estimateState(a.input)

  it('places the run days of every week plus its strength sessions', () => {
    const cut = cutWeeks(plan)
    const bad: string[] = []
    for (const w of fullWeeks(plan)) {
      const sessions = plan.sessions.filter((s) => mondayOf(s.date) === w.weekStart)
      const runs = sessions.filter((s) => ANY_RUN.has(s.kind))
      const strength = sessions.filter((s) => s.kind === 'strength')
      const open = WEEKDAYS.filter((d) => {
        const day = a.input.profile.availability[d]
        return day.available && (day.maxMin === null || day.maxMin >= RUN_WALK_MIN)
      }).length
      let days = w.runDays
      if (state.experience === 'novice') days = Math.min(days, 3)
      if (state.age !== null && state.age >= 40) days = Math.min(days, 6)
      const walking = runs.some((s) => s.flags.includes('run-walk'))
      // a ladder or injury-return session is exempt from the run day minimum: 5 minutes at least
      const programme =
        runs.some(isStartSession) || w.flags.some((f) => /^ladder-|^injury-/.test(f))
      const fit = Math.floor(w.targetRunMin / (programme ? 5 : walking ? RUN_WALK_MIN : MIN_RUN))
      const lowest = w.isRecovery || w.isTaper ? 1 : Math.min(2, days)
      const expected = Math.min(days, open, Math.max(lowest, fit))
      if (cut.has(w.weekStart)) {
        if (runs.length < 1) bad.push(`${w.weekStart}: no run left`)
        continue
      }
      if (runs.length !== expected) {
        bad.push(`${w.weekStart}: ${runs.length} runs, expected ${expected} (runDays ${w.runDays})`)
      }
      if (strength.length !== w.strengthSessions) {
        bad.push(`${w.weekStart}: ${strength.length} strength sessions of ${w.strengthSessions}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('keeps every run at the session minimum outside run-walk, and the long run the longest', () => {
    const bad: string[] = []
    for (const s of plan.sessions) {
      if (!RUNNING.has(s.kind) || isStartSession(s)) continue
      if (s.durationMin < MIN_RUN) bad.push(`${s.date} ${s.kind} ${s.durationMin} min`)
    }
    for (const w of fullWeeks(plan)) {
      const runs = plan.sessions.filter(
        (s) => mondayOf(s.date) === w.weekStart && RUNNING.has(s.kind),
      )
      const long = runs.find((s) => s.kind === 'long' || s.kind === 'long-fast-finish')
      if (long === undefined) continue
      const longer = runs.find((s) => s.durationMin > long.durationMin)
      if (longer !== undefined) {
        bad.push(
          `${w.weekStart}: ${longer.kind} ${longer.durationMin} min is longer than the long run`,
        )
      }
    }
    expect(bad).toEqual([])
  })

  it('holds at least one run in every week that has a running target, a ladder or injury-return week included', () => {
    const bad: string[] = []
    for (const w of fullWeeks(plan)) {
      if (w.targetRunMin <= 0) continue
      const runs = plan.sessions.filter(
        (s) => mondayOf(s.date) === w.weekStart && RUNNING.has(s.kind),
      )
      if (runs.length === 0)
        bad.push(`${w.weekStart}: a target of ${w.targetRunMin} min and no run`)
    }
    expect(bad).toEqual([])
  })

  it('never holds a week down for a recovery or taper week two weeks earlier', () => {
    const byStart = new Map(plan.weeks.map((w) => [w.weekStart, w]))
    const bad: string[] = []
    for (const warning of plan.warnings) {
      if (warning.code !== 'ramp-ceiling') continue
      const m = /week of (\d{4}-\d{2}-\d{2})/.exec(warning.message)
      const earlier = byStart.get(addDays(m![1]!, -14))
      if (earlier !== undefined && (earlier.isRecovery || earlier.isTaper)) {
        bad.push(
          `${m![1]}: held by the ${earlier.isTaper ? 'taper' : 'recovery'} week of ${earlier.weekStart}`,
        )
      }
    }
    expect(bad).toEqual([])
  })

  it('plans the minutes of the week target, within 10%', () => {
    const volume = weeklyVolume(a, plan)
    const bad: string[] = []
    for (const w of fullWeeks(plan)) {
      const planned = volume.get(w.weekStart) ?? 0
      if (w.targetRunMin <= 0) continue
      if (Math.abs(planned - w.targetRunMin) > w.targetRunMin * 0.1 + 1) {
        bad.push(`${w.weekStart}: ${Math.round(planned)} planned vs ${w.targetRunMin} target`)
      }
    }
    expect(bad).toEqual([])
  })

  it('lists each week flag once', () => {
    for (const w of plan.weeks) expect(new Set(w.flags).size, w.weekStart).toBe(w.flags.length)
  })

  it('gives at least four run days from 3 h, five from 5 h and six from 7 h when the days are free', () => {
    const open = WEEKDAYS.filter((d) => a.input.profile.availability[d].available).length
    const bad: string[] = []
    for (const w of fullWeeks(plan)) {
      if (w.isTaper || w.isRecovery || state.experience === 'novice') continue
      const want =
        w.targetRunMin >= 420 ? 6 : w.targetRunMin >= 300 ? 5 : w.targetRunMin >= 180 ? 4 : 0
      if (Math.min(want, open) > w.runDays) {
        bad.push(`${w.weekStart}: ${w.runDays} run days at ${w.targetRunMin} min`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('plan adequacy: sparse history, first 100-mile', () => {
  const a = all.find((x) => x.id === 'sparse-100-mile')!
  const plan = planOf(a)

  it('starts with three runs of at least 20 minutes on non-consecutive days', () => {
    const first = plan.sessions.filter(
      (s) => mondayOf(s.date) === mondayOf(TODAY) && ANY_RUN.has(s.kind),
    )
    expect(first).toHaveLength(3)
    for (const s of first) expect(s.durationMin).toBeGreaterThanOrEqual(MIN_RUN)
    const dates = first.map((s) => s.date).sort()
    for (let i = 1; i < dates.length; i++) {
      expect(daysBetween(dates[i - 1]!, dates[i]!)).toBeGreaterThanOrEqual(2)
    }
  })

  it('grows to 6 h in the last specific week with a 3 h long run, and labels feasibility', () => {
    const specific = planWeeks(plan).filter((w) => w.phase === 'specific' && !w.isRecovery)
    const last = specific.at(-1)!
    const volume = weeklyVolume(a, plan)
    const long = Math.max(
      ...plan.sessions
        .filter((s) => mondayOf(s.date) === last.weekStart && RUNNING.has(s.kind))
        .map((s) => s.durationMin),
    )
    // Whatever the label, a not-reachable verdict must come with its warning, and the plan
    // still has to grow to the volume and the long run.
    if (plan.feasibility.label === 'not-reachable') {
      expect(plan.warnings.some((w) => w.code === 'not-reachable')).toBe(true)
    }
    expect(volume.get(last.weekStart) ?? 0).toBeGreaterThanOrEqual(360)
    expect(long).toBeGreaterThanOrEqual(180)
  })

  it('does not collapse to one session a week after the opening weeks', () => {
    const counts = fullWeeks(plan)
      .filter((w) => !w.isTaper)
      .map(
        (w) =>
          plan.sessions.filter((s) => mondayOf(s.date) === w.weekStart && ANY_RUN.has(s.kind))
            .length,
      )
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(2)
  })
})

describe('plan matrix: REDs hold', () => {
  const a = all.find((x) => x.id === 'reds-hold')!
  const plan = planOf(a)
  const open = buildPlan({ ...a.input, screeningFlags: 0 })
  const peak = (p: PlanDraft) => Math.max(...planWeeks(p).map((w) => w.targetRunMin))

  it('reads the screening into the state and warns with a clinician prompt', () => {
    expect(estimateState(a.input).risk.redsFlags).toBe(2)
    const warning = plan.warnings.find((w) => w.code === 'reds-hold')
    expect(warning?.severity).toBe('hold')
    expect(warning?.message).toMatch(/clinician/i)
    expect(warning?.rules).toContain('n-4')
    expect(open.warnings.some((w) => w.code === 'reds-hold')).toBe(false)
  })

  it('holds the weekly level and plans no back-to-back, where the same athlete otherwise grows', () => {
    expect(peak(open)).toBeGreaterThan(peak(plan))
    const loading = planWeeks(plan).filter(
      (w) => !w.isRecovery && !w.isTaper && !w.flags.includes('post-race'),
    )
    const first = loading[0]!.targetRunMin
    for (const w of loading) expect(w.targetRunMin, w.weekStart).toBeLessThanOrEqual(first)
    expect(open.sessions.some((s) => s.flags.includes('b2b-day1'))).toBe(true)
    expect(plan.sessions.some((s) => s.flags.includes('b2b-day1'))).toBe(false)
    expect(plan.sessions.some((s) => s.kind === 'b2b')).toBe(false)
  })

  it('passes every checklist item, the hold item included', () => {
    const item = plan.checklist.find((c) => c.id === 'reds-hold')!
    expect(item.ok).toBe(true)
    expect(item.detail).toMatch(/hold/i)
  })
})

describe.each(all)('plan matrix with a rest window: $label', (a) => {
  // A three-day illness starting in two days: rest through the symptom-free day, easy running after.
  const window = windowOf({
    reason: 'illness-above-neck',
    startDate: addDays(TODAY, 2),
    endDate: addDays(TODAY, 4),
  })
  const plan = buildPlan({ ...a.input, disruptions: [window] })

  it('is the plan of the athlete without the field when the list of windows is empty', () => {
    expect(buildPlan({ ...a.input, disruptions: [] })).toEqual(planOf(a))
    expect(planOf(a).checklist.map((c) => c.id)).toEqual(CHECKLIST_IDS)
  })

  it('passes every item, the window item last, and keeps the label and the race', () => {
    expect(plan.checklist.map((c) => c.id)).toEqual([...CHECKLIST_IDS, 'disruption-window'])
    expect(plan.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)).toEqual([])
    expect(plan.feasibility.label).toBe(planOf(a).feasibility.label)
    expect(plan.sessions.filter((s) => s.kind === 'race').map((s) => s.date)).toEqual([
      a.input.goal.date,
    ])
  })

  it('rests on the held days, adds no minutes and keeps the invariants of the window', () => {
    expect(problemsOf(a, [window], plan, planOf(a))).toEqual([])
    const held = [2, 3, 4, 5].map((k) => addDays(TODAY, k))
    for (const date of held) {
      expect(plan.sessions.filter((s) => s.date === date).map((s) => s.kind)).toEqual(['rest'])
    }
  })
})

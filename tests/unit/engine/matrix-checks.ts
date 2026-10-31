// The checks of the plan matrix [design section 9, task E16], run over a list of plans so that the
// default and each method preset [rules P1 to P4] are held to the same limits, each re-derived here
// from the finished sessions without calling the code that enforces it.
import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { buildPlan, explain } from '../../../shared/engine/index.ts'
import { ownWindow, windowViolations } from '../../../shared/engine/postRace.ts'
import type { PlanDraft, SessionKind, SessionSpec } from '../../../shared/engine/types.ts'
import type { Weekday } from '../../../shared/types.ts'
import { TODAY, type MatrixAthlete } from './matrix-fixtures.ts'

export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Sessions that count as running minutes in a week (a race and a hike do not). */
export const RUNNING: ReadonlySet<SessionKind> = new Set<SessionKind>([
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
export const ANY_RUN: ReadonlySet<SessionKind> = new Set<SessionKind>([...RUNNING, 'hike'])

/**
 * A session set by a ladder or injury-return programme [rules E6, g-3]: a run-walk session, an
 * injury-return run, or a continuous run of the upper rungs, which opens with the framing walk.
 */
export const isStartSession = (s: SessionSpec): boolean =>
  s.flags.includes('run-walk') ||
  s.flags.includes('injury-return') ||
  (s.kind === 'easy' && s.structure[0]?.kind === 'warmup')
export const HARD: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'long-fast-finish',
  'b2b',
])
export const QUALITY: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
])

export const CHECKLIST_IDS = [
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

/** Weekly running minutes: completed history plus the planned sessions from today. */
export function weeklyVolume(a: MatrixAthlete, plan: PlanDraft): Map<string, number> {
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

export function planWeeks(plan: PlanDraft) {
  return plan.weeks.filter((w) => w.weekStart >= mondayOf(TODAY))
}

export const MIN_RUN = 20
export const RUN_WALK_MIN = 15

/** Weeks the guards shortened: the warning message names the Monday of the week. */
export function cutWeeks(plan: PlanDraft): Set<string> {
  const out = new Set<string>()
  for (const w of plan.warnings) {
    if (w.code !== 'ramp-ceiling' && w.code !== 'ramp-tightened') continue
    const m = /week of (\d{4}-\d{2}-\d{2})/.exec(w.message)
    if (m !== null) out.add(m[1]!)
  }
  return out
}

/** Weeks placed in full: not the part week the plan opens in, the race week or the weeks after it. */
export function fullWeeks(plan: PlanDraft) {
  return planWeeks(plan).filter(
    (w) =>
      w.weekStart > mondayOf(TODAY) &&
      !w.flags.includes('race-week') &&
      !w.flags.includes('post-race'),
  )
}

/**
 * The plan of one matrix athlete at one method: `athlete.input` carries the `method` option, so
 * the determinism test builds the same plan again. `runDayCap` is the most run days a week may
 * hold where the preset lowers the cap [rules F5, P2]; the floors of F5 give way to it.
 */
export interface MatrixSubject {
  athlete: MatrixAthlete
  plan: PlanDraft
  runDayCap?: number
}

/**
 * The plan matrix and the plan adequacy checks [design section 9, task E16] over `subjects`: the
 * checklist item by item, and every limit re-derived from the finished sessions in every week,
 * without calling the code that enforces it. `matrix.test.ts` runs them for the default plans and
 * `matrix-methods.test.ts` for each method preset, so a preset is held to what the default is.
 */
export function describePlanMatrix(
  subjects: readonly MatrixSubject[],
  title = 'plan matrix',
  adequacy = 'plan adequacy',
): void {
  // `describe.each` names a case by a property of the case itself
  const labelled = subjects.map((s) => ({ ...s, label: s.athlete.label }))
  describe.each(labelled)(`${title}: $label`, ({ athlete: a, plan }) => {
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
      expect(windowViolations(after, [ownWindow(a.input)], addDays(a.input.goal.date, 1))).toEqual(
        [],
      )
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

  describe.each(labelled)(`${adequacy}: $label`, ({ athlete: a, plan, runDayCap = Infinity }) => {
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
          bad.push(
            `${w.weekStart}: ${runs.length} runs, expected ${expected} (runDays ${w.runDays})`,
          )
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
        if (Math.min(want, open, runDayCap) > w.runDays) {
          bad.push(`${w.weekStart}: ${w.runDays} run days at ${w.targetRunMin} min`)
        }
      }
      expect(bad).toEqual([])
    })
  })
}

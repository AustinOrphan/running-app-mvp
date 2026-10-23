// Shared by the disruption integration and sweep tests: windows on the matrix athletes, and the
// invariants a plan with windows keeps, re-derived here from the finished sessions without calling
// the code that enforces them [rules J9, J7, G-6].
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import {
  dayRuleOn,
  disruptionPlan,
  holdReference,
  isDisruptedWeek,
} from '../../../shared/engine/disruption.ts'
import type {
  DisruptionWindow,
  EngineInput,
  PlanDraft,
  SessionKind,
} from '../../../shared/engine/types.ts'
import type { MatrixAthlete } from './matrix-fixtures.ts'
import { TODAY } from './matrix-fixtures.ts'

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

/** What a day that windows keep easy does not hold: hard work, back-to-back runs and strides. */
export const HARD_OR_STRIDES: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'long-fast-finish',
  'b2b',
  'strides',
])

/** The weeks of a start path are set by their programme, not by the J7 share. */
const PROGRAMME_FLAGS = /ladder-|injury-return|restart-floor/

export function windowOf(over: Partial<DisruptionWindow> = {}): DisruptionWindow {
  return {
    id: 'w1',
    reason: 'illness-above-neck',
    mode: 'rest',
    startDate: TODAY,
    endDate: addDays(TODAY, 2),
    maxRunMin: null,
    pain: null,
    gaitChange: false,
    ...over,
  }
}

/** The athlete's input with the windows. */
export function withWindows(a: MatrixAthlete, ...windows: DisruptionWindow[]): EngineInput {
  return { ...a.input, disruptions: windows }
}

/** Running minutes of the plan's sessions by Monday. */
export function planMinutes(plan: PlanDraft): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of plan.sessions) {
    if (!RUNNING.has(s.kind)) continue
    out.set(mondayOf(s.date), (out.get(mondayOf(s.date)) ?? 0) + s.durationMin)
  }
  return out
}

/**
 * Weekly running minutes as the generator counts them: the completed weeks, then the planned ones
 * (the current week holds what was run and what is still planned).
 */
export function weeklyVolume(
  a: MatrixAthlete,
  windows: DisruptionWindow[],
  plan: PlanDraft,
): Map<string, number> {
  const state = estimateState({ ...a.input, disruptions: windows })
  const volume = new Map<string, number>(state.weeks.map((w) => [w.weekStart, w.runMin]))
  const current = mondayOf(TODAY)
  for (const [week, minutes] of planMinutes(plan)) {
    volume.set(week, (week === current ? (volume.get(week) ?? 0) : 0) + minutes)
  }
  return volume
}

/**
 * Everything that is wrong with a plan built with `windows`, against the plan `base` built without
 * them: an empty list means every invariant holds. Every line starts with the invariant it breaks.
 */
export function problemsOf(
  a: MatrixAthlete,
  windows: DisruptionWindow[],
  plan: PlanDraft,
  base: PlanDraft,
): string[] {
  const problems: string[] = []
  const rules = disruptionPlan(windows)
  const goalDate = a.input.goal.date

  for (const item of plan.checklist) {
    if (!item.ok) problems.push(`checklist ${item.id}: ${item.detail}`)
  }
  if (rules.days.length > 0 && !plan.checklist.some((c) => c.id === 'disruption-window')) {
    problems.push('checklist: no disruption-window item')
  }

  // the days: rest on held days, caps and quiet days
  for (const s of plan.sessions) {
    const rule = dayRuleOn(rules, s.date)
    if (rule === null || s.kind === 'race') continue
    if (rule.held) {
      if (s.kind !== 'rest') problems.push(`held day ${s.date} carries ${s.kind}`)
      else if (!s.flags.includes('rest-window') && !s.rules.includes('H12')) {
        problems.push(`held day ${s.date} rests without the window flag`)
      }
      continue
    }
    if (rule.maxRunMin !== null && RUNNING.has(s.kind) && s.durationMin > rule.maxRunMin) {
      problems.push(`cap ${s.date} ${s.kind} ${s.durationMin} min above ${rule.maxRunMin}`)
    }
    if (!rule.quality && HARD_OR_STRIDES.has(s.kind)) {
      problems.push(`quiet day ${s.date} carries ${s.kind}`)
    }
  }
  const dates = new Set(plan.sessions.map((s) => s.date))
  for (const rule of rules.days) {
    if (!rule.held || rule.date < TODAY || rule.date >= goalDate) continue
    if (!dates.has(rule.date)) problems.push(`held day ${rule.date} carries no session`)
  }

  // no minutes are added to any week, and no week target rises
  const baseline = planMinutes(base)
  for (const [week, minutes] of planMinutes(plan)) {
    const before = baseline.get(week) ?? 0
    if (minutes > before) problems.push(`added minutes week ${week}: ${minutes} against ${before}`)
  }
  for (const week of plan.weeks) {
    const before = base.weeks.find((w) => w.weekStart === week.weekStart)
    if (before !== undefined && week.targetRunMin > before.targetRunMin) {
      problems.push(`target ${week.weekStart}: ${week.targetRunMin} against ${before.targetRunMin}`)
    }
  }

  // the J7 fraction of the reference week holds the return week (prorated) and the next full week
  const volume = weeklyVolume(a, windows, plan)
  const current = mondayOf(TODAY)
  for (const hold of rules.holds) {
    if (hold.fraction >= 1) continue
    const reference = holdReference(hold, (week) => volume.get(week))
    if (reference <= 0) continue
    const open = [0, 1, 2, 3, 4, 5, 6].filter(
      (k) => dayRuleOn(rules, addDays(hold.returnWeekStart, k))?.held !== true,
    ).length
    const caps: Array<[string, number]> = [
      [hold.returnWeekStart, Math.floor((reference * hold.fraction * open) / 7)],
      [hold.fullWeekStart, Math.floor(reference * hold.fraction)],
    ]
    for (const [week, cap] of caps) {
      if (week < current) continue
      const flags = plan.weeks.find((w) => w.weekStart === week)?.flags.join(' ') ?? ''
      if (PROGRAMME_FLAGS.test(flags)) continue
      if ((volume.get(week) ?? 0) > cap + 1) {
        problems.push(`J7 week ${week}: ${volume.get(week)} min above the share ${cap}`)
      }
    }
  }

  // the race is kept
  const races = plan.sessions.filter((s) => s.kind === 'race')
  if (races.length !== 1 || races[0]!.date !== goalDate) problems.push('the race is not kept')

  // a week carries a window flag only when a window touches the plan
  if (rules.days.length === 0 && plan.weeks.some((w) => isDisruptedWeek(w.flags))) {
    problems.push('a week is flagged without a window')
  }
  return problems
}

/** A small seeded generator, so a failing combination can be replayed from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

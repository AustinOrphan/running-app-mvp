// The plan quality checklist, run before a plan is published [rules G1]: progression within the
// limits, recovery cadence, intensity distribution, a strictly decreasing taper, level
// differentiation, the session spike guard, availability, spacing, ultra caps and race day.
// It re-reads the finished plan; it never repairs one. A failed item blocks publishing with its
// detail, so each detail names the week or date at fault.
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import type { Weekday } from '../types.ts'
import { breakRestart } from './adapt.ts'
import { estimateState } from './athlete.ts'
import { redsHold } from './macro.ts'
import { intensityMinutes } from './micro.ts'
import { P } from './params/index.ts'
import type {
  AthleteState,
  ChecklistResult,
  EngineInput,
  PlanDraft,
  SessionKind,
  SessionSpec,
  WeekDraft,
} from './types.ts'

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const EPS = 1e-6

/** Sessions that count toward the weekly running minutes (a race and a hike do not). */
const VOLUME_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
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
/** Sessions on the road or trail, for availability and run-day counts. */
const RUN_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([...VOLUME_KINDS, 'hike'])
/** Hard sessions: the next day is not hard [rules F1]. */
const HARD_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'long-fast-finish',
  'b2b',
])
/** Quality sessions: the long run does not sit between two of them [rules F3]. */
const QUALITY_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
])

const result = (id: string, ok: boolean, detail: string, rules: string[]): ChecklistResult => ({
  id,
  ok,
  detail,
  rules,
})

const isRecoveryOnly = (w: WeekDraft) => w.flags.includes('post-race')

function sortedWeeks(draft: PlanDraft): WeekDraft[] {
  return [...draft.weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
}

/**
 * A re-plan keeps the sessions of the current week that are finished: done (their running is
 * already in the week's history) or skipped. They add no running still to come.
 */
const FINISHED: ReadonlySet<string> = new Set(['completed', 'partial', 'skipped'])
const slotKey = (s: SessionSpec) => `${s.date}|${s.order}|${s.kind}|${s.title}|${s.durationMin}`

/** The sessions from today on that are still to run. */
function toRun(draft: PlanDraft, input: EngineInput): SessionSpec[] {
  const finished = new Set(
    (input.existing?.sessions ?? [])
      .filter((s) => s.date >= input.today && FINISHED.has(s.status))
      .map(slotKey),
  )
  return draft.sessions.filter((s) => s.date >= input.today && !finished.has(slotKey(s)))
}

function weekMinutes(sessions: SessionSpec[], weekStart: string, from: string): number {
  return sessions
    .filter((s) => mondayOf(s.date) === weekStart && s.date >= from && VOLUME_KINDS.has(s.kind))
    .reduce((sum, s) => sum + s.durationMin, 0)
}

/**
 * Largest value among `count` weeks that end `lag` weeks before `weekStart`; null when none is
 * known. Weeks in `skip` (recovery and taper weeks) are left out.
 */
function highest(
  values: ReadonlyMap<string, number>,
  weekStart: string,
  lag: number,
  count: number,
  skip?: ReadonlySet<string>,
  lookback = count,
): number | null {
  let best: number | null = null
  for (let k = 0; k < Math.max(count, lookback); k++) {
    const week = addDays(weekStart, -7 * (lag + k))
    // past the window, only a window that found nothing keeps looking
    if (k >= count && best !== null) break
    if (skip?.has(week)) continue
    const v = values.get(week)
    if (v !== undefined) best = best === null ? v : Math.max(best, v)
  }
  return best
}

const positive = (v: number | null): number | null => (v !== null && v > 0 ? v : null)

function tightRamp(state: AthleteState): number | null {
  const caps: number[] = []
  if (state.risk.recentInjury) caps.push(P.g3.recentInjuryRamp.value[1])
  if (state.risk.priorBsi) caps.push(P.g3.priorBsiRampMax.value)
  if (state.risk.bsiFactors >= P.g3.bsiFactorsForCap.value) {
    caps.push(P.g2.rampSoft.value * P.g3.bsiRampFactor.value)
  }
  return caps.length === 0 ? null : Math.min(...caps)
}

/** G-2, G-3: no week above the 2-week ceiling or the tightened ramp; the soft 10% only warns. */
function progression(draft: PlanDraft, input: EngineInput, state: AthleteState): ChecklistResult {
  const rules = ['g-2', 'g-3']
  const volume = new Map<string, number>()
  for (const row of state.weeks) volume.set(row.weekStart, row.runMin)
  const currentMonday = mondayOf(input.today)
  const starts = [...new Set(draft.sessions.map((s) => mondayOf(s.date)))].sort()
  const baselineWeeks = P.g2.baselineWeeks.value
  const minStep = state.experience === 'novice' ? P.g2.noviceMinStepMin.value : 0
  const limitOf = (from: number, ramp: number) => from + Math.max(from * ramp, minStep)
  const tight = tightRamp(state)
  const failures: string[] = []
  const ahead = toRun(draft, input)
  let soft = 0
  // A recovery or taper week never sets the ceiling baseline. The restart floor week is exempt from
  // G-2 up to the floor and is the ceiling baseline of the week after it [design-macro].
  const lowWeeks = new Set(
    draft.weeks.filter((w) => w.isRecovery || w.isTaper).map((w) => w.weekStart),
  )
  const floorWeek = draft.weeks.find((w) => w.flags.includes('restart-floor'))
  // A week under way with no running logged is only part of a week, so it is no baseline for the
  // weeks after it (as in guards.ts).
  const rampSkip: ReadonlySet<string> =
    input.today > currentMonday && (volume.get(currentMonday) ?? 0) === 0
      ? new Set([...lowWeeks, currentMonday])
      : lowWeeks
  for (const weekStart of starts) {
    if (weekStart < currentMonday) continue
    // The current week holds what was already run plus the sessions still planned.
    const done = weekStart === currentMonday ? (volume.get(weekStart) ?? 0) : 0
    const total = done + weekMinutes(ahead, weekStart, input.today)
    volume.set(weekStart, total)
    if (total <= 0) continue
    const base =
      positive(highest(volume, weekStart, 1, baselineWeeks, rampSkip)) ??
      (state.typicalWeekMin > 0 ? state.typicalWeekMin : null)
    if (base === null) continue
    const afterFloor =
      floorWeek !== undefined &&
      weekStart > floorWeek.weekStart &&
      daysBetween(floorWeek.weekStart, weekStart) <= 7 * (P.g2.ceilingWindowWeeks.value - 1)
    const window = highest(
      volume,
      weekStart,
      P.g2.ceilingWindowWeeks.value,
      baselineWeeks,
      rampSkip,
      P.g2.ceilingLookbackWeeks.value,
    )
    const floorBase = afterFloor ? (volume.get(floorWeek.weekStart) ?? null) : null
    const ceilingBase =
      positive(
        window === null ? floorBase : floorBase === null ? window : Math.max(window, floorBase),
      ) ?? base
    const ceilingLimit = limitOf(ceilingBase, P.g2.rampCeilingTwoWeeks.value)
    const tightLimit = tight === null ? Infinity : limitOf(base, tight)
    let allowed = Math.min(ceilingLimit, tightLimit)
    const isFloorWeek = floorWeek !== undefined && weekStart === floorWeek.weekStart
    if (isFloorWeek) allowed = Math.max(allowed, floorWeek.targetRunMin)
    if (total > allowed + EPS) {
      failures.push(
        `week of ${weekStart}: ${Math.round(total)} min is above ${Math.round(allowed)} min`,
      )
    } else if (!isFloorWeek && total > limitOf(base, P.g2.rampSoft.value) + EPS) soft += 1
  }
  if (failures.length > 0) return result('progression', false, failures.join('; '), rules)
  return result(
    'progression',
    true,
    soft === 0
      ? 'Every week is within the weekly ramp.'
      : `Every week is within the ceiling; ${soft} week(s) step above the soft ${Math.round(P.g2.rampSoft.value * 100)}% and carry a warning.`,
    rules,
  )
}

/** E3: no more than the cycle's loading weeks in a row, and recovery weeks cut the volume. */
function recoveryCadence(
  draft: PlanDraft,
  state: AthleteState,
  input: EngineInput,
): ChecklistResult {
  const rules = ['E3', 'g-3']
  let cycle: number = P.e3.defaultCycleWorkWeeks.value
  if (
    state.risk.recentInjury ||
    input.options.recoveryCycle === '2:1' ||
    (input.options.recoveryCycle !== '3:1' && state.experience === 'novice')
  ) {
    cycle = P.e3.flaggedCycleWorkWeeks.value
  }
  const failures: string[] = []
  // The plan never opens with a recovery week, so its first block may run one week longer (macro).
  let first = true
  let run = 0
  let lastLoad: WeekDraft | null = null
  for (const week of sortedWeeks(draft)) {
    if (week.isTaper || week.phase === 'taper' || week.phase === 'race' || isRecoveryOnly(week)) {
      run = 0
      lastLoad = null
      continue
    }
    if (week.isRecovery) {
      if (lastLoad !== null) {
        const allowed = lastLoad.targetRunMin * (1 - P.e3.recoveryWeekCutPct.range![0] / 100)
        if (week.targetRunMin > allowed + 1) {
          failures.push(
            `recovery week of ${week.weekStart} (${week.targetRunMin} min) is not cut ${P.e3.recoveryWeekCutPct.range![0]}% from ${lastLoad.targetRunMin} min`,
          )
        }
      }
      run = 0
      first = false
      continue
    }
    run += 1
    lastLoad = week
    if (run > cycle + (first ? 1 : 0)) {
      failures.push(`${run} loading weeks in a row at ${week.weekStart}; the cycle is ${cycle}:1`)
    }
  }
  return result(
    'recovery-cadence',
    failures.length === 0,
    failures.length === 0
      ? `A recovery week at least every ${cycle + 1}th week.`
      : failures.join('; '),
    rules,
  )
}

/** E4, F2: the weekly targets hold the Z1 floor, and the planned sessions stay under the cap. */
function tid(draft: PlanDraft): ChecklistResult {
  const rules = ['E4', 'F2']
  const failures: string[] = []
  for (const week of sortedWeeks(draft)) {
    if (week.targetRunMin <= 0) continue
    const { z1, z2, z3 } = week.tid
    if (Math.abs(z1 + z2 + z3 - 100) > 1)
      failures.push(`week of ${week.weekStart}: shares add up to ${z1 + z2 + z3}`)
    else if (z1 < P.e4.z1Floor.value) failures.push(`week of ${week.weekStart}: Z1 is ${z1}%`)
    else if (z2 > z1) failures.push(`week of ${week.weekStart}: Z2 is above Z1`)
    const sessions = draft.sessions.filter(
      (s) => mondayOf(s.date) === week.weekStart && VOLUME_KINDS.has(s.kind),
    )
    const total = sessions.reduce((sum, s) => sum + s.durationMin, 0)
    const hard = sessions.reduce((sum, s) => sum + intensityMinutes(s), 0)
    if (total > 0 && (hard / total) * 100 > P.f2.z2z3ShareMax.value + EPS) {
      failures.push(
        `week of ${week.weekStart}: ${Math.round((hard / total) * 100)}% of the planned time is above zone 1`,
      )
    }
  }
  return result(
    'tid',
    failures.length === 0,
    failures.length === 0
      ? `Zone 1 holds at least ${P.e4.z1Floor.value}% in every week and no week passes ${P.f2.z2z3ShareMax.value}% above it.`
      : failures.join('; '),
    rules,
  )
}

/** K2: the taper weeks fall strictly, from below the last loading week to race week. */
function taper(draft: PlanDraft): ChecklistResult {
  const rules = ['K1', 'K2']
  const weeks = sortedWeeks(draft).filter((w) => !isRecoveryOnly(w))
  const taperWeeks = weeks.filter((w) => w.isTaper)
  if (taperWeeks.length === 0) {
    return result('taper', true, 'The plan has no taper weeks to check.', rules)
  }
  const failures: string[] = []
  const first = taperWeeks[0]!
  const before = weeks.filter((w) => w.weekStart < first.weekStart && !w.isRecovery).slice(-1)[0]
  if (before !== undefined && first.targetRunMin >= before.targetRunMin) {
    failures.push(`taper starts at ${first.targetRunMin} min, not below ${before.targetRunMin} min`)
  }
  for (let i = 1; i < taperWeeks.length; i++) {
    const prev = taperWeeks[i - 1]!
    const week = taperWeeks[i]!
    if (week.targetRunMin >= prev.targetRunMin) {
      failures.push(
        `week of ${week.weekStart} (${week.targetRunMin} min) does not fall from ${prev.targetRunMin} min`,
      )
    }
  }
  for (const week of taperWeeks) {
    const planned = weekMinutes(draft.sessions, week.weekStart, week.weekStart)
    if (planned > week.targetRunMin + 1) {
      failures.push(
        `week of ${week.weekStart} holds ${planned} min, above its ${week.targetRunMin} min`,
      )
    }
  }
  return result(
    'taper',
    failures.length === 0,
    failures.length === 0
      ? `The taper falls every week over ${taperWeeks.length} week(s).`
      : failures.join('; '),
    rules,
  )
}

/** F5, E1: a novice plan keeps three non-consecutive run days and no hard work in the run-walk weeks. */
function levelDifferentiation(draft: PlanDraft, state: AthleteState): ChecklistResult {
  const rules = ['F5', 'G1']
  if (state.experience !== 'novice') {
    return result(
      'level-differentiation',
      true,
      `Plan built for a ${state.experience} runner; the novice limits do not apply.`,
      rules,
    )
  }
  const failures: string[] = []
  for (const week of sortedWeeks(draft)) {
    const days = [
      ...new Set(
        draft.sessions
          .filter(
            (s) =>
              mondayOf(s.date) === week.weekStart && RUN_KINDS.has(s.kind) && s.kind !== 'race',
          )
          .map((s) => s.date),
      ),
    ].sort()
    if (days.length > P.f5.noviceRunDays.value) {
      failures.push(`week of ${week.weekStart}: ${days.length} run days`)
    }
    for (let i = 1; i < days.length; i++) {
      if (daysBetween(days[i - 1]!, days[i]!) === 1) {
        failures.push(
          `week of ${week.weekStart}: run days ${days[i - 1]} and ${days[i]} are consecutive`,
        )
        break
      }
    }
    if (week.index < P.flib.runWalkWeeks.value) {
      const hard = draft.sessions.find(
        (s) => mondayOf(s.date) === week.weekStart && HARD_KINDS.has(s.kind),
      )
      if (hard !== undefined)
        failures.push(`week of ${week.weekStart}: ${hard.kind} in a run-walk week`)
    }
  }
  return result(
    'level-differentiation',
    failures.length === 0,
    failures.length === 0
      ? `Novice plan: at most ${P.f5.noviceRunDays.value} non-consecutive run days and no hard work while run-walking.`
      : failures.join('; '),
    rules,
  )
}

/** J7: after a break of 7 days or more the first weeks start from the restart volume. */
function breakRestartItem(
  draft: PlanDraft,
  input: EngineInput,
  state: AthleteState,
): ChecklistResult {
  const rules = ['J7']
  if (state.layoffDays < P.j7.tier1Days.value || state.typicalWeekMin <= 0) {
    return result('break-restart', true, 'No break of 7 days or more before the plan.', rules)
  }
  const { restartMin, fraction } = breakRestart(state.layoffDays, state.typicalWeekMin)
  const first = sortedWeeks(draft).find((w) => w.weekStart >= mondayOf(input.today))
  // The restart floor week starts above the restart volume by design [design-macro].
  const floorMin = first?.flags.includes('restart-floor') ? first.targetRunMin : 0
  const limit = Math.max(restartMin * (1 + P.g2.rampSoft.value) + 1, floorMin + 1)
  const done = state.weeks.find((w) => w.weekStart === mondayOf(input.today))?.runMin ?? 0
  const planned =
    first === undefined ? 0 : done + weekMinutes(toRun(draft, input), first.weekStart, input.today)
  return result(
    'break-restart',
    planned <= limit,
    planned <= limit
      ? `After ${state.layoffDays} days off the first week holds ${Math.round(planned)} min, from a restart at ${Math.round(fraction * 100)}% of ${state.typicalWeekMin} min.`
      : `After ${state.layoffDays} days off the first week holds ${Math.round(planned)} min, above ${Math.round(limit)} min (${Math.round(fraction * 100)}% of ${state.typicalWeekMin} min, plus one step).`,
    rules,
  )
}

/** G-1: nothing needs an override, a hard-limit profile has no warn-band run. */
function spikeGuard(draft: PlanDraft, state: AthleteState): ChecklistResult {
  const rules = ['g-1', 'g-3']
  const over = draft.sessions.filter((s) => s.flags.includes('override-required'))
  const failures = over.map((s) => `${s.date} ${s.kind} needs an explicit override`)
  if (state.risk.recentInjury) {
    for (const s of draft.sessions) {
      if (s.flags.includes('spike-warn'))
        failures.push(`${s.date} ${s.kind} is above the hard limit`)
    }
  }
  const warned = draft.sessions.filter((s) => s.flags.includes('spike-warn')).length
  return result(
    'spike-guard',
    failures.length === 0,
    failures.length === 0
      ? warned === 0
        ? 'No run is above the session spike limit.'
        : `${warned} run(s) are in the warn band and carry a warning.`
      : failures.join('; '),
    rules,
  )
}

/** F5: no run on a day the profile closes, none above the day's limit (the race excepted). */
function availability(draft: PlanDraft, input: EngineInput): ChecklistResult {
  const rules = ['F5']
  const failures: string[] = []
  for (const s of draft.sessions) {
    if (s.kind === 'race' || s.date < input.today) continue
    if (!RUN_KINDS.has(s.kind) && s.kind !== 'strength') continue
    const weekday = WEEKDAYS[daysBetween(mondayOf(s.date), s.date)]!
    const day = input.profile.availability[weekday]
    const cap = day.maxMin ?? Infinity
    if (!day.available || cap <= 0) failures.push(`${s.date} ${s.kind} falls on a closed day`)
    else if (RUN_KINDS.has(s.kind) && s.durationMin > cap + EPS) {
      failures.push(`${s.date} ${s.kind} runs ${s.durationMin} min on a ${cap} min day`)
    }
  }
  return result(
    'availability',
    failures.length === 0,
    failures.length === 0 ? 'Every session is on an available day.' : failures.join('; '),
    rules,
  )
}

/** F1, F3: no hard day after a hard day; the long run is not between two quality days. */
function spacing(draft: PlanDraft, input: EngineInput): ChecklistResult {
  const rules = ['F1', 'F3']
  const failures: string[] = []
  const byDate = new Map<string, SessionSpec[]>()
  for (const s of draft.sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s])
  const has = (date: string, kinds: ReadonlySet<SessionKind>) =>
    (byDate.get(date) ?? []).some((s) => kinds.has(s.kind))
  const hardDays = new Set([...byDate.keys()].filter((d) => has(d, HARD_KINDS)))
  for (const s of draft.sessions) {
    if (s.date < input.today) continue
    const next = addDays(s.date, 1)
    if (HARD_KINDS.has(s.kind) && hardDays.has(next)) {
      // A back-to-back pair is one block [rules H3]
      const pair =
        s.flags.includes('b2b-day1') &&
        (byDate.get(next) ?? []).some((n) => n.flags.includes('b2b-day2'))
      if (!pair) failures.push(`${s.date} and ${next} are both hard days`)
    }
    const neighbours =
      Number(has(addDays(s.date, -1), QUALITY_KINDS)) + Number(has(next, QUALITY_KINDS))
    if (s.kind === 'long' && neighbours > P.f3.maxQualityNeighboursOfLongRun.value) {
      failures.push(`the long run on ${s.date} sits between two quality days`)
    }
  }
  return result(
    'spacing',
    failures.length === 0,
    failures.length === 0
      ? 'Hard days are spaced and the long run is not between quality days.'
      : failures.join('; '),
    rules,
  )
}

/** H2, H3: the longest run, back-to-back pairs and the taper, for ultra goals. */
function ultraCaps(draft: PlanDraft, input: EngineInput): ChecklistResult {
  const rules = ['H2', 'H3']
  if (!input.goal.isUltra) {
    return result('ultra-caps', true, 'Not an ultra goal.', rules)
  }
  const failures: string[] = []
  const cap = Math.min(
    P.h2.longestRunCapHours.value * 60,
    (input.goal.expectedDurationSec / 60) * P.h2.longestRunCapRaceFraction.value,
  )
  for (const s of draft.sessions) {
    if (s.date < input.today || !VOLUME_KINDS.has(s.kind)) continue
    if (s.durationMin > cap + 1)
      failures.push(`${s.date} ${s.kind} runs ${s.durationMin} min, above ${Math.round(cap)} min`)
  }
  const day1 = draft.sessions
    .filter((s) => s.flags.includes('b2b-day1'))
    .map((s) => s.date)
    .sort()
  for (const date of day1) {
    const second = draft.sessions.find(
      (s) => s.date === addDays(date, 1) && s.flags.includes('b2b-day2'),
    )
    const first = draft.sessions.find((s) => s.date === date && s.flags.includes('b2b-day1'))
    if (second === undefined) failures.push(`the pair on ${date} has no second day`)
    else if (first !== undefined && second.durationMin > first.durationMin + EPS) {
      failures.push(`day 2 of the pair on ${date} is longer than day 1`)
    }
    const week = draft.weeks.find((w) => w.weekStart === mondayOf(date))
    if (week !== undefined && (week.isTaper || week.phase === 'taper' || week.phase === 'race')) {
      failures.push(`the pair on ${date} is in the taper`)
    }
  }
  for (let i = 1; i < day1.length; i++) {
    if (daysBetween(day1[i - 1]!, day1[i]!) < P.h3.b2bMinGapWeeks.value * 7) {
      failures.push(
        `pairs on ${day1[i - 1]} and ${day1[i]} are less than ${P.h3.b2bMinGapWeeks.value} weeks apart`,
      )
    }
  }
  return result(
    'ultra-caps',
    failures.length === 0,
    failures.length === 0
      ? `No run is above ${Math.round(cap)} min and the back-to-back pairs keep their limits.`
      : failures.join('; '),
    rules,
  )
}

/** The race is on race day and nothing is planned after it until the recovery weeks. */
function raceDay(draft: PlanDraft, input: EngineInput): ChecklistResult {
  const rules = ['K1', 'H12']
  if (input.goal.date < input.today) {
    return result('race-day', true, 'The goal date has passed; nothing to plan.', rules)
  }
  const failures: string[] = []
  const races = draft.sessions.filter((s) => s.kind === 'race')
  if (races.length !== 1 || races[0]!.date !== input.goal.date) {
    failures.push(`expected one race on ${input.goal.date}`)
  }
  const sameDay = draft.sessions.filter(
    (s) => s.date === input.goal.date && s.kind !== 'race' && VOLUME_KINDS.has(s.kind),
  )
  if (sameDay.length > 0) failures.push(`${sameDay.length} run(s) share the race day`)
  const rest = draft.weeks.find((w) => w.flags.includes('post-race'))
  if (rest !== undefined && rest.targetRunMin === 0) {
    const running = draft.sessions.filter(
      (s) => mondayOf(s.date) === rest.weekStart && VOLUME_KINDS.has(s.kind),
    )
    if (running.length > 0) failures.push('the rest week after the race holds runs')
  }
  return result(
    'race-day',
    failures.length === 0,
    failures.length === 0 ? `The race is on ${input.goal.date}.` : failures.join('; '),
    rules,
  )
}

/**
 * N-4: with two or more REDs flags no loading week from today is above the first one, its long run
 * and gain target do not grow, and no back-to-back pair is planned.
 */
function redsHoldItem(draft: PlanDraft, input: EngineInput, state: AthleteState): ChecklistResult {
  const rules = ['n-4', 'J5']
  if (!redsHold(state)) {
    return result('reds-hold', true, 'No energy-availability hold: fewer than 2 flags.', rules)
  }
  const failures: string[] = []
  const currentMonday = mondayOf(input.today)
  const loading = sortedWeeks(draft).filter(
    (w) =>
      w.weekStart >= currentMonday &&
      !w.isRecovery &&
      !w.isTaper &&
      w.phase !== 'race' &&
      !isRecoveryOnly(w),
  )
  const first = loading[0]
  if (first !== undefined) {
    for (const w of loading.slice(1)) {
      if (w.targetRunMin > first.targetRunMin) {
        failures.push(
          `week of ${w.weekStart}: ${w.targetRunMin} min is above the held ${first.targetRunMin} min`,
        )
      }
      if (w.longRunMin > first.longRunMin) {
        failures.push(
          `week of ${w.weekStart}: long run ${w.longRunMin} min is above the held ${first.longRunMin} min`,
        )
      }
      if ((w.gainTargetM ?? 0) > (first.gainTargetM ?? 0)) {
        failures.push(`week of ${w.weekStart}: gain target grows`)
      }
    }
  }
  for (const s of draft.sessions) {
    if (s.date >= input.today && (s.flags.includes('b2b-day1') || s.flags.includes('b2b-day2'))) {
      failures.push(`${s.date} plans a back-to-back run`)
    }
  }
  return result(
    'reds-hold',
    failures.length === 0,
    failures.length === 0
      ? `${state.risk.redsFlags} energy-availability flags: progression holds, with no growth and no back-to-back runs.`
      : failures.join('; '),
    rules,
  )
}

/** The plan quality checklist run before publishing [rules G1]. */
export function runChecklist(draft: PlanDraft, input: EngineInput): ChecklistResult[] {
  const state = estimateState(input)
  return [
    progression(draft, input, state),
    recoveryCadence(draft, state, input),
    tid(draft),
    taper(draft),
    levelDifferentiation(draft, state),
    breakRestartItem(draft, input, state),
    spikeGuard(draft, state),
    availability(draft, input),
    spacing(draft, input),
    ultraCaps(draft, input),
    raceDay(draft, input),
    redsHoldItem(draft, input, state),
  ]
}

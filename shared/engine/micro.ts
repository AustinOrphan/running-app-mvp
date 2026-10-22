// Week to days: which days run, where the long run goes, which days carry quality, where strength
// fits [rules F1 to F5, H3]. Pure: the same week and context give the same sessions. Session
// content (structure, targets, purpose) comes from `prescribe` (sessions.ts); this module only
// decides when and how long.
import { addDays, daysBetween } from '../dates.ts'
import type { AthleteProfile, Weekday } from '../types.ts'
import { P } from './params/index.ts'
import { prescribe } from './sessions.ts'
import type {
  AthleteState,
  SessionFlag,
  SessionKind,
  SessionSpec,
  WeekDraft,
  ZoneSet,
} from './types.ts'

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Sessions that need the rest after them that F1 asks for. Strides are not hard work. */
const HARD_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'long-fast-finish',
  'b2b',
  'race',
])
const RUN_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'hike',
  'b2b',
  'race',
])

/** Quality kinds by phase, in the order they are used. */
const QUALITY_BY_PHASE: Record<WeekDraft['phase'], SessionKind[]> = {
  base: ['strides', 'hills'],
  build: ['threshold', 'intervals'],
  specific: ['race-pace', 'threshold'],
  taper: ['race-pace', 'strides'],
  race: ['strides'],
}

interface Slot {
  day: number
  date: string
  open: boolean
  /** Minutes the day can hold; Infinity when the day has no limit. */
  capMin: number
}

interface RunPlan {
  day: number
  kind: SessionKind
  minutes: number
  flags: SessionFlag[]
}

/** Week to days: availability, long-run day, quality sessions, spacing, strength [rules F, H3]. */
export function placeWeek(
  week: WeekDraft,
  ctx: {
    profile: AthleteProfile
    zones: ZoneSet
    state: AthleteState
    prevSessions: SessionSpec[]
  },
): SessionSpec[] {
  const slots = slotsOf(week, ctx.profile)
  const before = ctx.prevSessions.filter((s) => s.date < week.weekStart)
  const runs = planRuns(week, ctx, slots, before)
  const strength = planStrength(week, ctx.profile, slots, runs)

  const sessions: SessionSpec[] = []
  for (const run of runs) {
    const spec = prescribe(run.kind, run.minutes, ctx.zones, week)
    // `prescribe` marks every 'b2b' session as day 1; the second day of a pair is day 2 only.
    const specFlags = run.flags.includes('b2b-day2')
      ? spec.flags.filter((f) => f !== 'b2b-day1')
      : spec.flags
    sessions.push({
      ...spec,
      date: slots[run.day]!.date,
      order: 0,
      flags: unique([...specFlags, ...run.flags]),
    })
  }
  fillDistanceAndGain(sessions, week)
  for (const day of strength) {
    const spec = prescribe('strength', P.fplace.strengthSessionMin.value, ctx.zones, week)
    const hasRun = runs.some((r) => r.day === day)
    sessions.push({ ...spec, date: slots[day]!.date, order: hasRun ? 1 : 0 })
  }
  return sessions.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1))
}

// ---- runs ----

function planRuns(
  week: WeekDraft,
  ctx: { profile: AthleteProfile; state: AthleteState },
  slots: Slot[],
  before: SessionSpec[],
): RunPlan[] {
  const { profile, state } = ctx
  const minRun = P.fplace.minRunDayMin.value
  const novice = state.experience === 'novice'
  const runWalk = novice && week.index < P.flib.runWalkWeeks.value

  let runDays = Math.max(0, Math.min(7, Math.floor(week.runDays)))
  if (state.age !== null && state.age >= P.f5.mastersMinAge.value) {
    runDays = Math.min(runDays, P.f5.mastersMaxRunDays.value)
  }
  if (novice) runDays = Math.min(runDays, P.f5.noviceRunDays.value)
  if (runDays === 0 || week.targetRunMin <= 0) return []

  const hardGapDays = Math.ceil(P.f1.hitSpacingHours.value / 24)
  const offsetOf = (date: string) => daysBetween(week.weekStart, date)
  const prevHard = before.filter((s) => HARD_KINDS.has(s.kind)).map((s) => offsetOf(s.date))
  const prevRunYesterday = before.some((s) => RUN_KINDS.has(s.kind) && offsetOf(s.date) === -1)
  const flagText = week.flags.join(' ')
  const wantsPair = /b2b|back-to-back/i.test(flagText)
  const fuel = /gut|fuel/i.test(flagText)
  const night = /night|dark/i.test(flagText)
  const heat = /heat/i.test(flagText)
  const preferred = WEEKDAYS.indexOf(profile.longRunDay)
  const usable = (day: number) => slots[day]!.open && slots[day]!.capMin >= minRun

  // The long day (or the pair of days) comes first.
  const target = week.targetRunMin
  const longMin = Math.max(0, Math.min(week.longRunMin, target))
  const fixed: RunPlan[] = []
  const pair = !novice && runDays >= 2 && wantsPair ? choosePair() : null
  if (pair !== null) {
    fixed.push(...pair)
  } else if (longMin > 0) {
    const day = chooseLongDay(longMin)
    if (day !== null) {
      const minutes = Math.min(longMin, slots[day]!.capMin)
      const kind = fastFinishAllowed() ? 'long-fast-finish' : 'long'
      fixed.push({ day, kind, minutes, flags: [] })
    }
  }
  const longDays = fixed.map((r) => r.day)
  if (fixed.length > 0) {
    const first = fixed[0]!
    if (fuel) first.flags.push('fuel-practice')
    if (night) first.flags.push('night')
  }

  // Run days, in the order they are chosen; a prefix of the list is the plan for fewer days.
  const order = [...longDays]
  for (;;) {
    const next = bestExtraDay(order)
    if (next === null || order.length >= runDays) break
    order.push(next)
  }

  const cap0 = fixed[0]?.minutes ?? Infinity
  const fixedMin = fixed.reduce((sum, r) => sum + r.minutes, 0)
  let count = Math.min(runDays, order.length)
  let others = order.slice(longDays.length, count)
  while (others.length > 0 && (target - fixedMin) / others.length < minRun) {
    count -= 1
    others = order.slice(longDays.length, count)
  }
  const minutes = distribute(
    Math.max(0, target - fixedMin),
    others.map((d) => Math.min(slots[d]!.capMin, cap0)),
  )

  // Quality days: spacing F1 and F3, not the day before the long run if it can be helped.
  let quality = Math.min(week.qualitySessions, P.f2.qualitySessionsPerWeek.value)
  if (runWalk) quality = 0
  if (pair !== null) quality = Math.min(quality, 1)
  if (fixed[0]?.kind === 'long-fast-finish') quality -= 1
  const kinds = QUALITY_BY_PHASE[week.phase]
  quality = Math.max(0, Math.min(quality, others.length, kinds.length))
  const chosen = chooseQuality(others, quality).sort((a, b) => a - b)
  const plan: RunPlan[] = [...fixed]
  others.forEach((day, i) => {
    const q = chosen.indexOf(day)
    plan.push({
      day,
      kind: q >= 0 ? kinds[q]! : 'easy',
      minutes: minutes[i]!,
      flags: [],
    })
  })
  const withKinds = plan.filter((r) => r.minutes > 0)
  if (runWalk) for (const r of withKinds) r.flags.push('run-walk')
  return withKinds.sort((a, b) => a.day - b.day)

  // ---- placement helpers ----

  function chooseLongDay(minutes: number): number | null {
    if (usable(preferred)) return preferred
    const days = slots.map((s) => s.day).filter(usable)
    if (days.length === 0) return null
    const fits = days.filter((d) => slots[d]!.capMin >= minutes)
    if (fits.length > 0) return nearest(fits, preferred)
    const biggest = Math.max(...days.map((d) => slots[d]!.capMin))
    return nearest(
      days.filter((d) => slots[d]!.capMin === biggest),
      preferred,
    )
  }

  function nearest(days: number[], to: number): number {
    // On a tie the later day wins: a long run moved off its day usually lands on the weekend.
    return [...days].sort((a, b) => Math.abs(a - to) - Math.abs(b - to) || b - a)[0]!
  }

  /** A back-to-back pair when the phase, the spacing and the days allow it; otherwise null. */
  function choosePair(): RunPlan[] | null {
    if (week.phase !== 'build' && week.phase !== 'specific') return null
    if (week.isTaper || week.isRecovery) return null
    const gapDays = P.h3.b2bMinGapWeeks.value * 7
    const lastPairs = before
      .filter((s) => s.flags.includes('b2b-day1'))
      .map((s) => offsetOf(s.date))
    const starts = [0, 1, 2, 3, 4, 5]
      .filter((d) => usable(d) && usable(d + 1))
      .filter((d) => lastPairs.every((p) => d - p >= gapDays))
      .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b)
    for (const day1 of starts) {
      const first = Math.min(longMin, slots[day1]!.capMin)
      const second = Math.min(
        Math.round(first * P.fplace.b2bDay2Fraction.value),
        Math.floor(first * P.h3.b2bDay2MaxRatioOfDay1.value),
        slots[day1 + 1]!.capMin,
        target - first,
      )
      if (first < minRun || second < minRun) continue
      return [
        { day: day1, kind: 'b2b', minutes: first, flags: ['b2b-day1'] },
        { day: day1 + 1, kind: 'b2b', minutes: second, flags: ['b2b-day2'] },
      ]
    }
    return null
  }

  /** A fast finish when the week is in the specific phase, a quality slot is free and the gap since the last one is long enough. */
  function fastFinishAllowed(): boolean {
    if (week.phase !== 'specific' || week.isRecovery || week.isTaper) return false
    if (novice || heat || week.qualitySessions < 1) return false
    const gapDays = P.flib.fastFinishMinGapWeeks.value * 7
    const lastFast = before
      .filter((s) => s.kind === 'long-fast-finish')
      .map((s) => offsetOf(s.date))
    // Whole weeks between the Monday of the last fast finish and this week's Monday.
    return lastFast.every((last) => -Math.floor(last / 7) * 7 >= gapDays)
  }

  /** The open day that keeps the most distance from the days already chosen. */
  function bestExtraDay(chosenDays: number[]): number | null {
    let best: number | null = null
    let bestDistance = -1
    for (const slot of slots) {
      const d = slot.day
      if (!usable(d) || chosenDays.includes(d)) continue
      if (novice) {
        if (chosenDays.some((c) => Math.abs(c - d) < 2)) continue
        if (d === 0 && prevRunYesterday) continue
      }
      const distance =
        chosenDays.length === 0 ? Infinity : Math.min(...chosenDays.map((c) => Math.abs(c - d)))
      if (distance > bestDistance) {
        best = d
        bestDistance = distance
      }
    }
    return best
  }

  /** Quality days among `days`: the best combination that keeps F1 and F3, fewer if none fits. */
  function chooseQuality(days: number[], count: number): number[] {
    const fixedHard = fixed.filter((r) => HARD_KINDS.has(r.kind)).map((r) => r.day)
    const pairDays = pair === null ? [] : pair.map((r) => r.day)
    const firstLong = longDays.length > 0 ? Math.min(...longDays) : null
    const lastLong = longDays.length > 0 ? Math.max(...longDays) : null
    for (let k = count; k > 0; k -= 1) {
      let best: { key: number[]; combo: number[] } | null = null
      for (const combo of combinations(days, k)) {
        const hard = [...fixedHard, ...combo, ...prevHard].sort((a, b) => a - b)
        if (!spacedOut(hard, pairDays)) continue
        if (firstLong !== null && lastLong !== null && fixed[0]!.kind === 'long') {
          const sandwiched =
            [...combo, ...prevHard].includes(firstLong - 1) &&
            [...combo, ...prevHard].includes(lastLong + 1)
          if (sandwiched) continue
        }
        const penalty =
          combo.filter((d) => firstLong !== null && d === firstLong - 1).length * 10 +
          combo.filter((d) => lastLong !== null && d === lastLong + 1).length * 4
        const inWeek = [...fixedHard, ...combo].sort((a, b) => a - b)
        let minGap = 7
        for (let i = 1; i < inWeek.length; i += 1)
          minGap = Math.min(minGap, inWeek[i]! - inWeek[i - 1]!)
        const key = [penalty, -minGap, ...combo]
        if (best === null || compareKeys(key, best.key) < 0) best = { key, combo }
      }
      if (best !== null) return best.combo
    }
    return []

    function spacedOut(hard: number[], together: number[]): boolean {
      for (let i = 0; i < hard.length; i += 1) {
        for (let j = i + 1; j < hard.length; j += 1) {
          const a = hard[i]!
          const b = hard[j]!
          if (together.includes(a) && together.includes(b)) continue
          if (b - a < hardGapDays) return false
        }
      }
      return true
    }
  }
}

// ---- strength ----

/** Days for strength: easy or free days, never a hard day, the long day or the day before it. */
function planStrength(
  week: WeekDraft,
  profile: AthleteProfile,
  slots: Slot[],
  runs: RunPlan[],
): number[] {
  const wanted = Math.min(week.strengthSessions, profile.strengthPreference)
  if (wanted <= 0) return []
  const minutes = P.fplace.strengthSessionMin.value
  const longStart = runs
    .filter((r) => r.kind === 'long' || r.kind === 'long-fast-finish' || r.kind === 'b2b')
    .map((r) => r.day)
  const firstLong = longStart.length > 0 ? Math.min(...longStart) : null
  const runOn = (day: number) => runs.find((r) => r.day === day)
  const candidates = slots
    .map((s) => s.day)
    .filter((day) => {
      const run = runOn(day)
      if (!slots[day]!.open) return false
      if (run && (HARD_KINDS.has(run.kind) || run.kind === 'long')) return false
      if (firstLong !== null && day === firstLong - 1) return false
      return slots[day]!.capMin - (run?.minutes ?? 0) >= minutes
    })
  const picked: number[] = []
  while (picked.length < wanted) {
    const left = candidates.filter((d) => !picked.includes(d))
    if (left.length === 0) break
    const keyOf = (d: number) => [
      picked.some((p) => Math.abs(p - d) < 2) ? 1 : 0,
      runOn(d) ? 0 : 1,
      d,
    ]
    left.sort((a, b) => compareKeys(keyOf(a), keyOf(b)))
    picked.push(left[0]!)
  }
  return picked.sort((a, b) => a - b)
}

// ---- small helpers ----

function slotsOf(week: WeekDraft, profile: AthleteProfile): Slot[] {
  return WEEKDAYS.map((weekday, day) => {
    const a = profile.availability[weekday]
    const open = a.available && (a.maxMin === null || a.maxMin > 0)
    return {
      day,
      date: addDays(week.weekStart, day),
      open,
      capMin: open ? (a.maxMin ?? Infinity) : 0,
    }
  })
}

/** Integer minutes for each day, as even as the day limits allow, adding up to `total` or less. */
function distribute(total: number, caps: number[]): number[] {
  const out = caps.map(() => 0)
  let left = Math.floor(total)
  let active = caps.map((_, i) => i)
  while (left > 0 && active.length > 0) {
    const share = Math.max(1, Math.floor(left / active.length))
    for (const i of active) {
      const give = Math.min(share, caps[i]! - out[i]!, left)
      out[i]! += give
      left -= give
    }
    active = active.filter((i) => out[i]! < caps[i]!)
  }
  return out
}

/** The weekly gain goes to the runs without a gain of their own, by minutes; the long run gets its distance. */
function fillDistanceAndGain(sessions: SessionSpec[], week: WeekDraft): void {
  if (week.longRunM !== null && week.longRunMin > 0) {
    for (const s of sessions) {
      const isLongDay =
        s.kind === 'long' || s.kind === 'long-fast-finish' || s.flags.includes('b2b-day1')
      if (isLongDay && s.distanceM === null) {
        s.distanceM = Math.round((week.longRunM * s.durationMin) / week.longRunMin)
      }
    }
  }
  if (week.gainTargetM !== null && week.gainTargetM > 0) {
    const runs = sessions.filter((s) => RUN_KINDS.has(s.kind))
    const open = runs.filter((s) => s.gainM === null)
    const taken = runs.reduce((sum, s) => sum + (s.gainM ?? 0), 0)
    const minutes = open.reduce((sum, s) => sum + s.durationMin, 0)
    if (minutes > 0) {
      const left = Math.max(0, week.gainTargetM - taken)
      for (const s of open) s.gainM = Math.floor((left * s.durationMin) / minutes)
    }
  }
}

function combinations(days: number[], k: number): number[][] {
  if (k === 0) return [[]]
  const out: number[][] = []
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push([...acc])
      return
    }
    for (let i = start; i < days.length; i += 1) {
      acc.push(days[i]!)
      pick(i + 1, acc)
      acc.pop()
    }
  }
  pick(0, [])
  return out
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const unique = <T>(values: T[]): T[] => [...new Set(values)]

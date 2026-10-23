// Week to days: which days run, where the long run goes, which days carry quality, where strength
// fits [rules F1 to F5, H3]. Pure: the same week and context give the same sessions. Session
// content (structure, targets, purpose) comes from `prescribe` (sessions.ts); this module only
// decides when and how long.
import { addDays, daysBetween } from '../dates.ts'
import type { AthleteProfile, Weekday } from '../types.ts'
import {
  recordOf,
  referenceAt,
  runCaps,
  twoDayReference,
  VOLUME_KINDS,
  type CompletedReference,
  type RunCaps,
  type RunRecord,
} from './limits.ts'
import { P } from './params/index.ts'
import {
  afterRaceTitle,
  dayLimit,
  holdPurpose,
  inQuietPeriod,
  windowDay,
  type PostRaceWindow,
} from './postRace.ts'
import { prescribe, type PrescribeContext } from './sessions.ts'
import {
  clipBlueprint,
  fitBlueprints,
  hasWalk,
  injuryLevel,
  ladderRung,
  rungSessions,
  sessionMin,
  startSessionMinMin,
  startWeek,
} from './startWeeks.ts'
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
  /** The most an ordinary run holds on a post-race return day; the longest run may take `capMin` [H12]. */
  runMaxMin?: number
  /** The post-race step the day is in, when it is in one. */
  step?: number
}

interface RunPlan {
  day: number
  kind: SessionKind
  minutes: number
  flags: SessionFlag[]
  /** A session of the run-walk ladder: its run and walk minutes in order [rules E6]. */
  blueprint?: number[]
  /** A session of a start path: its length is set by the programme, never stretched. */
  fixed?: boolean
}

/** The prescription context of a planned run: ladder sessions carry their blueprint. */
const contextOf = (run: RunPlan): PrescribeContext | undefined =>
  run.blueprint === undefined ? undefined : { blueprint: run.blueprint }

/**
 * The runs the session spike guard and the back-to-back rule compare this week with (limits.ts):
 * the completed runs and the runs planned before the week, as the guards count them.
 */
export interface PlaceLimits {
  runs: RunRecord[]
  virtualTwoDay: CompletedReference['virtualTwoDay']
}

/**
 * Week to days: availability, long-run day, quality sessions, spacing, strength [rules F, H3]. No
 * run is placed above the normal band of the session spike guard on its day (1.10x the 30-day
 * reference on duration, distance and gain), and a back-to-back pair stays within 1.10x of the
 * largest 2-day total [rules g-1, H3, H4]: minutes that do not fit are left out, never moved.
 * Without `limits` (a single week placed on its own) no 30-day reference is applied, and the 2-day
 * total comes from the sessions before and the state.
 */
export function placeWeek(
  week: WeekDraft,
  ctx: {
    profile: AthleteProfile
    zones: ZoneSet
    state: AthleteState
    prevSessions: SessionSpec[]
    limits?: PlaceLimits
    /** The post-race windows the week's days fall in [rules H12]. */
    postRace?: readonly PostRaceWindow[]
    /** No run of the week carries more than this: the 16 km of a 5 km or 10 km goal [rules D7]. */
    longRunMaxM?: number
  },
): SessionSpec[] {
  const limits = ctx.limits ?? defaultLimits(ctx.state, ctx.prevSessions)
  const caps = WEEKDAYS.map((_, day) => {
    const reference =
      ctx.limits === undefined
        ? runCaps({ min: 0, distanceM: null, gainM: null, lossM: null })
        : runCaps(referenceAt(limits.runs, addDays(week.weekStart, day)))
    return { ...reference, distanceM: Math.min(reference.distanceM, ctx.longRunMaxM ?? Infinity) }
  })
  const windows = ctx.postRace ?? []
  const slots = slotsOf(week, ctx.profile, caps)
  applyWindowLimits(
    slots,
    windows,
    ctx.prevSessions.filter((s) => VOLUME_KINDS.has(s.kind)).map((s) => s.date),
  )
  // Earlier weeks, plus sessions kept on closed days of this week (a re-plan keeps finished
  // sessions), so spacing and pair limits see them [rules F1, F3, H3].
  const weekEnd = addDays(week.weekStart, 6)
  const before = ctx.prevSessions.filter(
    (s) =>
      s.date < week.weekStart ||
      (s.date <= weekEnd && slots[daysBetween(week.weekStart, s.date)]?.open === false),
  )
  const runs = planRuns(week, ctx, slots, before, caps, limits, windows)
  capIntensity(runs, week, ctx.zones)
  const strength = planStrength(week, ctx.profile, slots, runs)

  const specs = fitDistances(runs, slots, caps, ctx.zones, week)
  const afterRace = week.flags.includes('post-race')
  const sessions: SessionSpec[] = []
  for (const [i, run] of runs.entries()) {
    const spec = specs[i]!
    // `prescribe` marks every 'b2b' session as day 1; the second day of a pair is day 2 only.
    const specFlags = run.flags.includes('b2b-day2')
      ? spec.flags.filter((f) => f !== 'b2b-day1')
      : spec.flags
    const flags = unique([...specFlags, ...run.flags])
    sessions.push({
      ...spec,
      date: slots[run.day]!.date,
      order: 0,
      flags,
      // a run of the post-race weeks says so [rules H12]
      ...(afterRace
        ? {
            title: afterRaceTitle(spec.durationMin),
            flags: unique<SessionFlag>([...flags, 'post-race']),
            rules: unique([...spec.rules, 'H12']),
          }
        : {}),
    })
  }
  // The weekly gain is split here, to the metre and within each run's limit, not per prescription.
  if (week.gainTargetM !== null && week.gainTargetM > 0) {
    for (const s of sessions) if (RUN_KINDS.has(s.kind)) s.gainM = null
  }
  fillDistanceAndGain(sessions, week, (date) => caps[daysBetween(week.weekStart, date)]!.gainM)
  for (const day of strength) {
    const spec = prescribe('strength', P.fplace.strengthSessionMin.value, ctx.zones, week)
    const hasRun = runs.some((r) => r.day === day)
    sessions.push({ ...spec, date: slots[day]!.date, order: hasRun ? 1 : 0 })
  }
  return sessions.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1))
}

// ---- intensity cap [rules F2] ----

/** Minutes of work steps outside zone 1 (threshold, intervals, race pace, hills, strides). */
export function intensityMinutes(session: SessionSpec): number {
  return session.structure.reduce(
    (sum, step) =>
      step.kind === 'work' && step.zone !== 'z1'
        ? sum + ((step.durationSec ?? 0) * step.reps) / 60
        : sum,
    0,
  )
}

/** Sessions that give up their intensity first, and what they become. */
const DEMOTED_TO: Partial<Record<SessionKind, SessionKind>> = {
  threshold: 'easy',
  intervals: 'easy',
  'race-pace': 'easy',
  hills: 'easy',
  'long-fast-finish': 'long',
}

/**
 * Zone 2 and zone 3 together never take more than the cap of the week's running time [F2]. While
 * the planned sessions pass it, the quality session with the most work becomes an easy run (a
 * fast-finish long run becomes a plain one); on a tie the later day gives way.
 */
function capIntensity(runs: RunPlan[], week: WeekDraft, zones: ZoneSet): void {
  const cap = P.f2.z2z3ShareMax.value / 100
  const counted = (r: RunPlan) => r.kind !== 'hike' && r.kind !== 'race'
  for (;;) {
    const total = runs.filter(counted).reduce((sum, r) => sum + r.minutes, 0)
    const entries = runs.map((run) => ({
      run,
      hard: counted(run) ? intensityMinutes(prescribe(run.kind, run.minutes, zones, week)) : 0,
    }))
    const hard = entries.reduce((sum, e) => sum + e.hard, 0)
    if (total <= 0 || hard <= cap * total + 1e-9) return
    const worst = entries
      .filter((e) => e.hard > 0 && DEMOTED_TO[e.run.kind] !== undefined)
      .sort((a, b) => b.hard - a.hard || b.run.day - a.run.day)[0]
    if (worst === undefined) return
    worst.run.kind = DEMOTED_TO[worst.run.kind]!
  }
}

// ---- runs ----

function planRuns(
  week: WeekDraft,
  ctx: { profile: AthleteProfile; state: AthleteState; zones: ZoneSet },
  slots: Slot[],
  before: SessionSpec[],
  caps: RunCaps[],
  limits: PlaceLimits,
  windows: readonly PostRaceWindow[],
): RunPlan[] {
  const { profile, state } = ctx
  const novice = state.experience === 'novice'
  const floorWeek = week.flags.includes('restart-floor')
  const rung = ladderRung(week.flags)
  const injuryWeek = week.flags.includes('injury-return')
  const runWalk = week.flags.includes('run-walk')
  // A novice plan holds no quality work in its first weeks, on the ladder or not [rules F5, E6].
  const gentle = runWalk || (novice && week.index < P.flib.runWalkWeeks.value)
  // A ladder or injury-return week: the programme sets the sessions [rules E6, g-3].
  const startWeekPlan = rung !== null || injuryWeek
  // Post-race days [H12]: the first return step has at most 3 runs on non-consecutive days, and
  // no quality work falls before the end of the window.
  const step1Week = slots.some((s) => s.open && s.step === 1)
  const quiet = slots.map((s) => inQuietPeriod(windows, s.date))
  // Novices, the restart floor week and the first return step run on non-consecutive days.
  const spaced = novice || floorWeek || step1Week

  let runDays = Math.max(0, Math.min(7, Math.floor(week.runDays)))
  if (state.age !== null && state.age >= P.f5.mastersMinAge.value) {
    runDays = Math.min(runDays, P.f5.mastersMaxRunDays.value)
  }
  if (novice) runDays = Math.min(runDays, P.f5.noviceRunDays.value)
  if (runDays === 0 || week.targetRunMin <= 0) return []

  // Shortest run of the week: the session minimum, the run day minimum for run-walk and the first
  // weeks of a novice plan [F5]. A session of a start path (the ladder, the injury-return ladder
  // and the 3 x N floor) is exempt from both and is placed at the day's G-1 bound down to the
  // first level of the injury-return ladder (5 minutes), not left out [E6, G-3]. The sessions of
  // the floor share the week's minutes, so a week held under N a session by a limit counts its
  // runs at their share, not at the session minimum.
  const shortest = startSessionMinMin()
  const minRun = startWeekPlan
    ? shortest
    : floorWeek
      ? Math.max(
          shortest,
          Math.min(P.fplace.easyRunMinMin.value, Math.floor(week.targetRunMin / runDays)),
        )
      : gentle
        ? P.fplace.minRunDayMin.value
        : P.fplace.easyRunMinMin.value
  const usableMin = startWeekPlan || floorWeek ? shortest : minRun

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
  // In a start-path week (the ladder, the injury-return ladder and the 3 x N floor) a run never
  // sits next to a run kept earlier in the same week: the weeks of a start path keep a rest day
  // between runs [rules F5, E6, g-3].
  const spacedFromKept = startWeekPlan || floorWeek
  const startGap = injuryWeek ? P.injuryReturn.restDaysBetween.value + 1 : 2
  const nearKept = (day: number) =>
    before.some(
      (s) =>
        RUN_KINDS.has(s.kind) &&
        offsetOf(s.date) >= 0 &&
        Math.abs(offsetOf(s.date) - day) < startGap,
    )
  const usable = (day: number) =>
    slots[day]!.open && slots[day]!.capMin >= usableMin && !(spacedFromKept && nearKept(day))
  // A taper, race or recovery week may hold a single run; any other week at least two [F5].
  const light = week.isTaper || week.isRecovery || week.phase === 'taper' || week.phase === 'race'
  const fewest = light ? 1 : P.fplace.minRunsPerWeek.value
  if (startWeekPlan) return planStartRuns()
  // A taper, race or recovery week with fewer minutes than the shortest run holds one run of those
  // minutes, from the run day minimum up, and none under it: its target is a ceiling [rules F5, K2].
  const small = light && week.targetRunMin < minRun
  if (small && week.targetRunMin < P.fplace.minRunDayMin.value) return []

  // The long day (or the pair of days) comes first. The long run is never shorter than the
  // session minimum, and a week of several runs keeps the others at the minimum too.
  const target = week.targetRunMin
  const longMin = Math.max(
    0,
    Math.min(Math.max(week.longRunMin, week.longRunMin > 0 ? minRun : 0), target),
  )
  let fixed: RunPlan[] = []
  const pair = !novice && runDays >= 2 && wantsPair ? choosePair() : null
  const longPlan = (day: number): RunPlan => {
    // the fast finish covers more ground in the same time; it is left out when only the plain
    // long run fits the day's distance limit
    const plain = Math.min(longMin, longCap(day, 'long'))
    const kind: SessionKind =
      fastFinishAllowed() && !quiet[day] && longCap(day, 'long-fast-finish') >= plain
        ? 'long-fast-finish'
        : 'long'
    return { day, kind, minutes: plain, flags: [] }
  }
  if (pair !== null) {
    fixed.push(...pair)
  } else if (longMin > 0) {
    const day = chooseLongDay(longMin)
    if (day !== null) fixed.push(longPlan(day))
  }
  let longDays = fixed.map((r) => r.day)

  // Run days, in the order they are chosen; a prefix of the list is the plan for fewer days.
  const order = [...longDays]
  for (;;) {
    const next = bestExtraDay(order)
    if (next === null || order.length >= runDays) break
    order.push(next)
  }
  if (spaced && pair === null && order.length < runDays) {
    // A greedy pick can leave no room for the last run (a long day in the middle of a short
    // week): look for the largest set of non-consecutive days instead.
    const days = spacedDays(runDays)
    if (days.length > order.length) {
      const longDay = nearest(days, preferred)
      order.length = 0
      order.push(longDay, ...days.filter((d) => d !== longDay))
      fixed = longMin > 0 ? [longPlan(longDay)] : []
      longDays = fixed.map((r) => r.day)
    }
  }
  if (fixed.length > 0) {
    const first = fixed[0]!
    if (fuel) first.flags.push('fuel-practice')
    if (night) first.flags.push('night')
  }

  // Fewer runs rather than runs under the minimum [F5].
  const fit = Math.max(fewest, Math.floor(target / minRun))
  let count = Math.max(
    Math.min(runDays, order.length, fit),
    Math.min(longDays.length, order.length),
  )
  let others = order.slice(longDays.length, count)
  let fixedMin = fixed.reduce((sum, r) => sum + r.minutes, 0)
  if (fixed.length === 1 && others.length > 0) {
    // the long run gives up minutes before a run drops below the minimum
    const room = target - others.length * minRun
    if (room >= minRun && room < fixedMin) {
      fixed[0]!.minutes = room
      fixedMin = room
    }
  }
  // A week outside taper, race and recovery keeps two runs even when its minutes do not fit them
  // at the minimum; the guards cut such a week back if its limit is lower.
  const forced = Math.min(Math.max(fewest, longDays.length), order.length)
  while (others.length > 0 && count > forced && (target - fixedMin) / others.length < minRun) {
    count -= 1
    others = order.slice(longDays.length, count)
  }
  if (fixed.length === 1 && others.length > 0 && count < runDays) {
    // fewer runs than planned: the long run takes its share of the runs left out, so it stays the
    // longest of the week
    const share = Math.ceil(target / (others.length + 1))
    const raised = Math.min(Math.max(fixed[0]!.minutes, share), longCap(fixed[0]!.day))
    fixed[0]!.minutes = raised
    fixedMin = raised
  }
  const cap0 = fixed[0]?.minutes ?? Infinity
  const toPlace = Math.max(0, target - fixedMin, small ? 0 : others.length * minRun)
  const minutes = distribute(
    toPlace,
    others.map((d) => Math.min(slots[d]!.runMaxMin ?? slots[d]!.capMin, cap0)),
  )
  // Post-race return days [H12]: one run of the week may reach the long cap of its step.
  const spare = toPlace - minutes.reduce((sum, m) => sum + m, 0)
  const room = (i: number) => Math.min(slots[others[i]!]!.capMin, cap0) - minutes[i]!
  const longest = minutes.map((_, i) => i).sort((a, b) => room(b) - room(a) || a - b)[0]
  if (spare > 0 && longest !== undefined && room(longest) > 0) {
    minutes[longest]! += Math.min(spare, room(longest))
  }

  // Quality days: spacing F1 and F3, not the day before the long run if it can be helped.
  let quality = Math.min(week.qualitySessions, P.f2.qualitySessionsPerWeek.value)
  if (gentle) quality = 0
  if (pair !== null) quality = Math.min(quality, 1)
  if (fixed[0]?.kind === 'long-fast-finish') quality -= 1
  const kinds = QUALITY_BY_PHASE[week.phase]
  // none before the end of a post-race window [H12]
  const qualityDays = others.filter((d) => !quiet[d])
  quality = Math.max(0, Math.min(quality, qualityDays.length, kinds.length))
  const chosen = chooseQuality(qualityDays, quality).sort((a, b) => a - b)
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
  if (week.flags.includes('post-race')) {
    // easy running only, a recovery run in the first return step [H12]
    for (const r of withKinds) r.kind = slots[r.day]!.step === 1 ? 'recovery' : 'easy'
  }
  return withKinds.sort((a, b) => a.day - b.day)

  // ---- placement helpers ----

  /**
   * The sessions of a ladder rung or an injury-return level on non-consecutive days [rules E6,
   * g-3]: the programme sets each session, the day's limit (G-1 is hard in a start path) cuts it,
   * and with fewer days than sessions the later, longer sessions stay. The first session goes on
   * the first day, so the longest of the week comes last.
   */
  function planStartRuns(): RunPlan[] {
    const all = injuryWeek
      ? startWeek('injury-return', injuryLevel(week.flags) ?? 0).sessions
      : rungSessions(rung!)
    const wanted = Math.min(all.length, runDays)
    const gap = injuryWeek ? P.injuryReturn.restDaysBetween.value + 1 : 2
    const days = spacedDays(wanted, gap).sort((a, b) => a - b)
    const blueprints = all.slice(all.length - days.length)
    // each session is cut to its day's limit, and the week to its target: the week is placed
    // against the target the ramp allows. A session the day's limit cut keeps that length, and the
    // others give way to the target, so a limit that ends during the week (an old run leaving the
    // 30 days) does not shorten the sessions after it in proportion.
    const byDay = blueprints.map((bp, i) => clipBlueprint(bp, slots[days[i]!]!.capMin))
    const held = byDay.map((bp, i) => sessionMin(bp) < sessionMin(blueprints[i]!))
    const heldMin = byDay.reduce((n, bp, i) => n + (held[i] ? sessionMin(bp) : 0), 0)
    const cut =
      held.some(Boolean) && held.some((h) => !h) && heldMin <= week.targetRunMin
        ? (() => {
            const free = fitBlueprints(
              byDay.filter((_, i) => !held[i]),
              week.targetRunMin - heldMin,
            )
            let next = 0
            return byDay.map((bp, i) => (held[i] ? bp : free[next++]!))
          })()
        : fitBlueprints(byDay, week.targetRunMin)
    const plan: RunPlan[] = []
    cut.forEach((clipped, i) => {
      const day = days[i]!
      const minutes = sessionMin(clipped)
      if (minutes < minRun) return
      plan.push({
        day,
        kind: 'easy',
        minutes,
        flags: injuryWeek ? ['injury-return'] : hasWalk(clipped) ? ['run-walk'] : [],
        blueprint: injuryWeek ? undefined : clipped,
        fixed: true,
      })
    })
    return plan
  }

  /**
   * The longest the long run (or day 1 of a pair) may be on `day`: the day's limit, and the
   * distance limit of the day at the distance the run will carry.
   */
  function longCap(day: number, kind: SessionKind = 'long'): number {
    return Math.min(slots[day]!.capMin, distanceCapMin(kind, caps[day]!.distanceM, ctx.zones, week))
  }

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

  /** The largest set (up to `want`) of usable, non-consecutive days; the best spread that holds the long day. */
  function spacedDays(want: number, spacing = 2): number[] {
    const days = slots.map((s) => s.day).filter((d) => usable(d) && !(d === 0 && prevRunYesterday))
    for (let k = Math.min(want, days.length); k > 0; k -= 1) {
      let best: { key: number[]; combo: number[] } | null = null
      for (const combo of combinations(days, k)) {
        if (combo.some((d, i) => i > 0 && d - combo[i - 1]! < spacing)) continue
        let minGap = 7
        for (let i = 1; i < combo.length; i += 1)
          minGap = Math.min(minGap, combo[i]! - combo[i - 1]!)
        const key = [Math.min(...combo.map((d) => Math.abs(d - preferred))), -minGap, ...combo]
        if (best === null || compareKeys(key, best.key) < 0) best = { key, combo }
      }
      if (best !== null) return best.combo
    }
    return []
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
      .filter((d) => !quiet[d] && !quiet[d + 1])
      .filter((d) => lastPairs.every((p) => d - p >= gapDays))
      .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b)
    for (const day1 of starts) {
      const first = Math.min(longMin, longCap(day1, 'b2b'))
      // The pair stays within H3 of the largest 2-day total the guards will see; day 2 takes the rest.
      const reference = twoDayReference(limits.runs, limits.virtualTwoDay, slots[day1]!.date)
      const room =
        reference > 0 ? Math.floor(reference * P.h3.b2bTwoDayRatio.value + 1e-9) - first : Infinity
      const second = Math.min(
        Math.round(first * P.fplace.b2bDay2Fraction.value),
        Math.floor(first * P.h3.b2bDay2MaxRatioOfDay1.value),
        slots[day1 + 1]!.capMin,
        target - first,
        room,
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
      if (spaced) {
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

/** The days of the week: open or not, and the most a run may hold on each (availability, G-1). */
function slotsOf(week: WeekDraft, profile: AthleteProfile, caps: RunCaps[]): Slot[] {
  return WEEKDAYS.map((weekday, day) => {
    const a = profile.availability[weekday]
    const open = a.available && (a.maxMin === null || a.maxMin > 0)
    return {
      day,
      date: addDays(week.weekStart, day),
      open,
      capMin: open ? Math.min(a.maxMin ?? Infinity, caps[day]!.min) : 0,
    }
  })
}

/**
 * The days of a post-race window [rules H12]: a hold day is closed to running, and a return day
 * holds no run above the cap of its step (one run may reach the long cap of a later step).
 */
function applyWindowLimits(
  slots: Slot[],
  windows: readonly PostRaceWindow[],
  runDates: readonly string[],
): void {
  for (const slot of slots) {
    const limit = dayLimit(windows, slot.date)
    if (limit === null) continue
    if (limit.hold) {
      slot.open = false
      slot.capMin = 0
      continue
    }
    slot.capMin = Math.min(slot.capMin, limit.longRunMaxMin)
    slot.runMaxMin = Math.min(slot.capMin, limit.runMaxMin)
    slot.step = limit.step
  }
  // The first return step holds at most `maxRuns` runs on non-consecutive days, counted across
  // the weeks it spans: the days are taken from the start of the step, as the trial ran them
  // (days 2, 4 and 6), among the days that are open.
  for (const window of windows) {
    const first = window.stages[0]
    if (first === undefined || first.maxRuns === null) continue
    const taken = [...new Set(runDates.filter((d) => d >= first.from && d <= first.to))].sort()
    let quota = first.maxRuns - taken.length
    let last = taken[taken.length - 1] ?? null
    for (const slot of slots) {
      if (slot.date < first.from || slot.date > first.to || !slot.open) continue
      const fits =
        quota > 0 &&
        slot.capMin >= P.fplace.easyRunMinMin.value &&
        (last === null || daysBetween(last, slot.date) >= 2)
      if (fits) {
        quota -= 1
        last = slot.date
      } else {
        slot.open = false
        slot.capMin = 0
      }
    }
  }
}

/**
 * Rest days for the hold of a post-race window: one session a day from `from` on, with the hold
 * copy. The race day itself carries the race and gets none [rules H12].
 */
export function holdSessions(
  week: WeekDraft,
  zones: ZoneSet,
  windows: readonly PostRaceWindow[],
  from: string,
): SessionSpec[] {
  const out: SessionSpec[] = []
  for (let day = 0; day < 7; day++) {
    const date = addDays(week.weekStart, day)
    if (date < from) continue
    const window = windows.find((w) => date > w.race.date && windowDay(w, date)?.kind === 'hold')
    if (window === undefined) continue
    out.push({
      ...prescribe('rest', 0, zones, week),
      date,
      order: 0,
      title: 'After the race: rest',
      purpose: holdPurpose(window),
      rules: ['H12'],
      flags: [],
    })
  }
  return out
}

/** Minutes per metre are measured on a run of this length, so rounding barely moves them. */
const PROBE_MIN = 100

/**
 * The most minutes a run of `kind` may hold and carry no more than `metres`: its distance as
 * prescribed (at the zone paces, rounded to 100 m), or, for a long run without zone paces, the
 * week's long-run distance. Infinity without a limit or a distance.
 */
function distanceCapMin(
  kind: SessionKind,
  metres: number,
  zones: ZoneSet,
  week: WeekDraft,
): number {
  if (!Number.isFinite(metres)) return Infinity
  const probe = prescribe(kind, PROBE_MIN, zones, week).distanceM
  const perMin =
    probe !== null
      ? probe / PROBE_MIN
      : week.longRunM !== null && week.longRunMin > 0
        ? week.longRunM / week.longRunMin
        : null
  if (perMin === null || perMin <= 0) return Infinity
  // a prescribed distance rounds to 100 m, so it may sit 50 m above the minutes' own
  return Math.floor((metres - 50) / perMin + 1e-9)
}

/**
 * The runs prescribed, each held to its day's distance limit [rules g-1]: a run that would carry
 * more (a faster session as long as the long run, say) is shortened to fit, and the minutes it
 * gives up go to the slower runs that have room on their day, never above the long run and never
 * to a back-to-back day; what no run can take is left out.
 */
function fitDistances(
  runs: RunPlan[],
  slots: Slot[],
  caps: RunCaps[],
  zones: ZoneSet,
  week: WeekDraft,
): SessionSpec[] {
  const fits = (spec: SessionSpec, day: number) =>
    spec.distanceM === null || spec.distanceM <= caps[day]!.distanceM
  let freed = 0
  const specs = runs.map((run) => {
    let spec = prescribe(run.kind, run.minutes, zones, week, contextOf(run))
    let minutes = run.minutes
    while (!fits(spec, run.day) && minutes > 1) {
      const perMin = spec.distanceM! / minutes
      minutes = Math.max(
        1,
        Math.min(minutes - 1, Math.floor((caps[run.day]!.distanceM - 50) / perMin + 1e-9)),
      )
      spec = prescribe(run.kind, minutes, zones, week, contextOf(run))
    }
    freed += run.minutes - minutes
    return spec
  })
  if (freed <= 0) return specs
  const isLongDay = (r: RunPlan) => r.kind === 'long' || r.kind === 'long-fast-finish'
  const longest = Math.max(
    0,
    ...runs.flatMap((r, i) => (isLongDay(r) ? [specs[i]!.durationMin] : [])),
  )
  const takers = runs
    .map((r, i) => i)
    .filter((i) => runs[i]!.kind !== 'b2b' && runs[i]!.fixed !== true)
    .sort((a, b) => takerRank(runs[a]!) - takerRank(runs[b]!) || a - b)
  for (const i of takers) {
    const run = runs[i]!
    while (freed > 0) {
      const next = specs[i]!.durationMin + 1
      const dayCap = slots[run.day]!.runMaxMin ?? slots[run.day]!.capMin
      if (next > Math.max(dayCap, specs[i]!.durationMin)) break
      if (next > slots[run.day]!.capMin) break
      if (!isLongDay(run) && longest > 0 && next > longest) break
      const trial = prescribe(run.kind, next, zones, week, contextOf(run))
      if (!fits(trial, run.day)) break
      specs[i] = trial
      freed -= 1
    }
  }
  return specs
}

/** Which runs take freed minutes first: the slowest, easy runs, then the long run, then the rest. */
function takerRank(run: RunPlan): number {
  if (run.kind === 'easy' || run.kind === 'recovery') return 0
  if (run.kind === 'long') return 1
  return 2
}

/** For a week placed on its own: the sessions before it, and the state's largest 2-day total. */
function defaultLimits(state: AthleteState, prevSessions: SessionSpec[]): PlaceLimits {
  const twoDay = state.longest30d.twoDaySec / 60
  return {
    runs: prevSessions.filter((s) => VOLUME_KINDS.has(s.kind)).map(recordOf),
    virtualTwoDay: twoDay > 0 ? [{ date: state.asOf, min: twoDay }] : [],
  }
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

/**
 * The long run gets its distance. The weekly gain goes to the runs without a gain of their own, by
 * minutes, to the metre, and never above a run's own gain limit (`gainCap`); what no run can take
 * is left out.
 */
function fillDistanceAndGain(
  sessions: SessionSpec[],
  week: WeekDraft,
  gainCap: (date: string) => number,
): void {
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
    const left = Math.max(0, Math.floor(week.gainTargetM - taken))
    const shares = allocate(
      left,
      open.map((s) => s.durationMin),
      open.map((s) => Math.floor(gainCap(s.date))),
    )
    open.forEach((s, i) => {
      s.gainM = shares[i]!
    })
  }
}

/**
 * Splits `total` whole units by `weights` (largest remainder, ties to the earlier entry), never
 * giving an entry more than its cap; what a capped entry cannot take goes to the others.
 */
function allocate(total: number, weights: number[], caps: number[]): number[] {
  const out = weights.map(() => 0)
  let left = total
  let active = weights.flatMap((w, i) => (w > 0 && caps[i]! > 0 ? [i] : []))
  while (left > 0 && active.length > 0) {
    const sum = active.reduce((n, i) => n + weights[i]!, 0)
    const exact = active.map((i) => (left * weights[i]!) / sum)
    const give = exact.map((x) => Math.floor(x + 1e-9))
    let rest = left - give.reduce((n, g) => n + g, 0)
    const order = active
      .map((_, k) => k)
      .sort((a, b) => exact[b]! - give[b]! - (exact[a]! - give[a]!) || a - b)
    for (const k of order) {
      if (rest <= 0) break
      give[k]! += 1
      rest -= 1
    }
    let given = 0
    active.forEach((i, k) => {
      const g = Math.min(give[k]!, caps[i]! - out[i]!)
      out[i]! += g
      given += g
    })
    left -= given
    const still = active.filter((i) => out[i]! < caps[i]!)
    if (given === 0 || still.length === active.length) break
    active = still
  }
  return out
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

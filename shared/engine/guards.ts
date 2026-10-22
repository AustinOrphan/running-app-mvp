// Safety limits applied to a planned session list: the session spike guard (rules g-1, H4), the
// weekly ramp (g-2), the tightened profiles (g-3), the ultra caps (H2, H3) and the helper behind
// "never make up missed volume" (g-6). Pure: no I/O, no clock; `state.asOf` is today.
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import type { Activity } from '../types.ts'
import { P } from './params/index.ts'
import type {
  AthleteState,
  EngineWarning,
  SessionFlag,
  SessionKind,
  SessionSpec,
  Step,
} from './types.ts'

/** Context a plan needs beyond the athlete state. */
export interface GuardOptions {
  /** Expected race duration for an ultra goal; the H2 caps apply only when this is set. */
  ultraRaceDurationSec?: number | null
  /**
   * Mondays of the planned recovery and taper weeks. Such a week never sets the baseline of the
   * 2-week ceiling, so a planned easy week cannot hold the weeks after it down [rules g-2].
   */
  lowWeeks?: Iterable<string>
  /**
   * The restart floor [design-macro]: the first week of a plan for a runner whose recent weeks are
   * below it. That one week is exempt from G-2 up to `minutes`, and counts as the baseline of the
   * 2-week ceiling for the week after it. Every session still obeys G-1.
   */
  restartFloor?: { weekStart: string; minutes: number } | null
  /**
   * For a generated plan: a run above 2.00x the 30-day reference on any dimension is shortened to
   * that limit (and left out when it would fall under the session minimum) instead of being
   * flagged `override-required`, because the generator never schedules an override [rules g-1].
   * Without it, such a run keeps the flag, as an owner edit does.
   */
  neverOverride?: boolean
}

/** Run sessions the guards may shorten. Hikes and races are never rewritten. */
const MUTABLE_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
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
/**
 * Sessions that count toward the weekly running minutes. A race does not: the weeks before the
 * plan (`state.weeks.runMin`) leave races out too, and a race week must not lose its shake-out runs.
 */
const VOLUME_KINDS: ReadonlySet<SessionKind> = MUTABLE_KINDS
const EPS = 1e-9

/** One completed or projected run. */
interface RunRecord {
  date: string
  min: number
  distanceM: number | null
  gainM: number | null
  lossM: number | null
}

/** Maxima of the 30-day window; null when no run in the window records that dimension. */
interface Reference {
  min: number
  distanceM: number | null
  gainM: number | null
  lossM: number | null
}

type DimName = 'duration' | 'distance' | 'gain' | 'descent'

interface Dim {
  name: DimName
  value: number
  ref: number
  minStep: number
}

/** min(planned target, actual last week x (1 + ramp)); missed volume is never made up [rules g-6]. */
export function nextWeekCap(plannedMin: number, actualLastWeekMin: number, ramp: number): number {
  const planned = Math.max(0, plannedMin)
  const ceiling = Math.max(0, actualLastWeekMin) * (1 + ramp)
  return Math.min(planned, ceiling)
}

/**
 * Session spike guard, weekly ramp, tightened profiles and ultra caps [rules g-1 to g-3, H2 to H4].
 *
 * Sessions are returned ordered by date and order. Sessions before `state.asOf` are never
 * touched. A planned run is compared with the longest completed run of the 30 days before it
 * (from `history`, or from `state.longest30d` when the history holds no run); planned runs
 * from `state.asOf` on that come earlier count as done, so a multi-week plan has a reference,
 * except runs flagged `override-required`. Descent is estimated by the planned gain (a loop
 * course), because a session carries no descent field. A dimension no run in the window records
 * is not compared and yields an info warning; a recorded 0 (a flat history) is compared, with
 * the minimum step as the allowance. Races are left out of the weekly minutes. Above 1.10x a run gets `spike-warn`,
 * above 2.00x `override-required`, or with `neverOverride` (a generated plan) it is shortened to
 * 2.00x and left out when that falls under the session minimum; with the recent-injury flag 1.10x is a hard limit and the
 * run is shortened. A week above the 2-week 30% ceiling or a tightened ramp is shortened; the
 * soft 10% only warns. Every cut leaves a warning with rule ids.
 */
export function applyGuards(
  sessions: SessionSpec[],
  state: AthleteState,
  history: Activity[],
  options: GuardOptions = {},
): { sessions: SessionSpec[]; warnings: EngineWarning[] } {
  const warnings: EngineWarning[] = []
  const seen = new Set<string>()
  const warn = (key: string, warning: EngineWarning) => {
    if (seen.has(key)) return
    seen.add(key)
    warnings.push(warning)
  }

  const items: Array<SessionSpec | null> = sessions
    .map(cloneSession)
    .sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1))
  const asOf = state.asOf
  const records = completedRuns(history)
  const hasHistory = records.length > 0
  const virtualTwoDay: Array<{ date: string; min: number }> = []
  if (!hasHistory) {
    const longest = state.longest30d
    const date = addDays(asOf, -1)
    if (longest.durationSec > 0 || longest.distanceM > 0) {
      // The state stores an unknown maximum as 0, so 0 here reads as "not recorded".
      records.push({
        date,
        min: longest.durationSec / 60,
        distanceM: longest.distanceM > 0 ? longest.distanceM : null,
        gainM: longest.gainM > 0 ? longest.gainM : null,
        lossM: longest.lossM > 0 ? longest.lossM : null,
      })
    }
    if (longest.twoDaySec > 0) virtualTwoDay.push({ date, min: longest.twoDaySec / 60 })
  }

  const minRun = P.fplace.minRunDayMin.value
  const modifiable = (s: SessionSpec): boolean => MUTABLE_KINDS.has(s.kind) && s.date >= asOf

  // Weekly running minutes: what was run for the weeks before the plan, then the final plan.
  const volume = new Map<string, number>()
  for (const row of state.weeks) volume.set(row.weekStart, row.runMin)
  const gainVolume = weeklyGain(history)
  const firstWeek = mondayOf(asOf)
  const weekStarts = [
    ...new Set(items.filter((s): s is SessionSpec => s !== null).map((s) => mondayOf(s.date))),
  ]
    .filter((w) => w >= firstWeek)
    .sort()

  const ultraCapMin = ultraCap(options)
  const low = new Set(options.lowWeeks ?? [])
  const floor = options.restartFloor ?? null
  const pairStarts: string[] = items
    .filter((s): s is SessionSpec => s !== null && s.date < asOf && s.flags.includes('b2b-day1'))
    .map((s) => s.date)
  let noReferenceWarned = false

  // Running already done in the current week counts toward its volume; the plan holds the rest.
  const currentMonday = mondayOf(asOf)
  const doneRow = state.weeks.find((w) => w.weekStart === currentMonday)
  const doneThisWeek = (weekStart: string) =>
    weekStart === currentMonday && doneRow !== undefined ? doneRow.runMin : 0
  const weekMinutes = (weekStart: string, week: SessionSpec[]) =>
    doneRow !== undefined && weekStart === currentMonday
      ? doneRow.runMin + weeklyMinutes(week.filter((s) => s.date >= asOf))
      : weeklyMinutes(week)

  const indicesOf = (weekStart: string) =>
    items.flatMap((s, i) => (s !== null && mondayOf(s.date) === weekStart ? [i] : []))

  for (const weekStart of weekStarts) {
    // H2: no single run beyond the cap, for ultra goals.
    if (ultraCapMin !== null) {
      for (const i of indicesOf(weekStart)) {
        const s = items[i]!
        if (!modifiable(s) || s.durationMin <= ultraCapMin + EPS) continue
        items[i] = scaleSession(s, ultraCapMin / s.durationMin)
        warn(`h2|${s.date}`, {
          code: 'ultra-run-cap',
          severity: 'warn',
          message: `The run on ${s.date} is limited to ${ultraCapMin} min, the lesser of ${P.h2.longestRunCapHours.value} h and ${Math.round(P.h2.longestRunCapRaceFraction.value * 100)}% of the expected race time.`,
          rules: ['H2'],
        })
      }
    }

    // g-2, g-3: the weekly ramp.
    rampWeek(weekStart)

    // g-1, H3, H4 in date order, so every run sees the runs before it.
    for (const i of indicesOf(weekStart)) {
      const s = items[i]
      if (s === null || s === undefined || !modifiable(s)) continue
      let current: SessionSpec = s
      if (current.flags.includes('b2b-day1')) {
        current = pairChecks(i)
      }
      const outcome = spikeCheck(current)
      items[i] = outcome
      if (outcome !== null && !outcome.flags.includes('override-required')) {
        records.push(recordOf(outcome))
      }
    }

    const final = indicesOf(weekStart).map((i) => items[i]!)
    volume.set(weekStart, weekMinutes(weekStart, final))
    gainVolume.set(
      weekStart,
      final.reduce((sum, s) => sum + (VOLUME_KINDS.has(s.kind) ? (s.gainM ?? 0) : 0), 0),
    )
    gainRamp(weekStart)
  }

  return { sessions: items.filter((s): s is SessionSpec => s !== null), warnings }

  // ---- weekly ramp ----

  function rampWeek(weekStart: string): void {
    const indices = indicesOf(weekStart)
    const week = indices.map((i) => items[i]!)
    const total = weekMinutes(weekStart, week)
    if (total <= 0) return

    const baselineWeeks = P.g2.baselineWeeks.value
    const soft = highest(volume, weekStart, 1, baselineWeeks)
    const typical = state.typicalWeekMin > 0 ? state.typicalWeekMin : null
    const base = positive(soft) ?? typical
    if (base === null) return
    // A recovery or taper week never sets the ceiling baseline; the restart floor week does for
    // the week right after it, which would otherwise be held to 130% of the weeks before the floor.
    const floorMin = floor === null ? null : (volume.get(floor.weekStart) ?? null)
    const afterFloor =
      floor !== null &&
      floorMin !== null &&
      weekStart > floor.weekStart &&
      daysBetween(floor.weekStart, weekStart) <= 7 * (P.g2.ceilingWindowWeeks.value - 1)
    const ceilingBase =
      positive(
        maxOf(
          highest(
            volume,
            weekStart,
            P.g2.ceilingWindowWeeks.value,
            baselineWeeks,
            low,
            P.g2.ceilingLookbackWeeks.value,
          ),
          afterFloor ? floorMin : null,
        ),
      ) ?? base

    const minStep = state.experience === 'novice' ? P.g2.noviceMinStepMin.value : 0
    const limitOf = (from: number, ramp: number) => from + Math.max(from * ramp, minStep)
    const softLimit = limitOf(base, P.g2.rampSoft.value)
    const ceilingLimit = limitOf(ceilingBase, P.g2.rampCeilingTwoWeeks.value)
    const tight = tightRamp()
    const tightLimit = tight === null ? Infinity : limitOf(base, tight)
    let allowed = Math.min(ceilingLimit, tightLimit)
    const isFloorWeek = floor !== null && weekStart === floor.weekStart
    if (floor !== null && isFloorWeek) {
      // The floor week is exempt from G-2 up to the floor; it is not exempt from anything else.
      allowed = Math.max(allowed, floor.minutes)
      warn(`floor|${weekStart}`, {
        code: 'restart-floor',
        severity: 'info',
        message: `The week of ${weekStart} restarts at ${floor.minutes} min, ${P.restartFloor.sessions.value} sessions of at least ${P.restartFloor.sessionMin.value} min, above the usual weekly step. Growth from it follows the weekly ramp.`,
        rules: ['g-2'],
      })
    }
    if (total > allowed + 1e-6) {
      // Runs before the plan starts are already in `doneThisWeek`.
      const fixed =
        doneRow !== undefined && weekStart === currentMonday
          ? 0
          : week
              .filter((s) => VOLUME_KINDS.has(s.kind) && !modifiable(s))
              .reduce((sum, s) => sum + s.durationMin, 0)
      shortenWeek(indices, Math.max(0, allowed - fixed - doneThisWeek(weekStart)), weekStart)
      const tightened = tightLimit <= ceilingLimit
      warn(`ramp|${weekStart}`, {
        code: tightened ? 'ramp-tightened' : 'ramp-ceiling',
        severity: 'warn',
        message: tightened
          ? `Running time in the week of ${weekStart} is held to ${Math.round(allowed)} min, a ramp of ${Math.round((tight ?? 0) * 100)}% on the highest of the previous ${baselineWeeks} weeks, for the injury profile.`
          : `Running time in the week of ${weekStart} is held to ${Math.round(allowed)} min, ${Math.round(P.g2.rampCeilingTwoWeeks.value * 100)}% above the week ${P.g2.ceilingWindowWeeks.value} weeks earlier.`,
        rules: tightened ? ['g-2', 'g-3'] : ['g-2'],
      })
    } else if (!isFloorWeek && total > softLimit + 1e-6) {
      warn(`ramp|${weekStart}`, {
        code: 'ramp-soft',
        severity: 'warn',
        message: `Running time in the week of ${weekStart} is ${Math.round(total)} min, above a ${Math.round(P.g2.rampSoft.value * 100)}% step on the highest of the previous ${baselineWeeks} weeks (${Math.round(base)} min). Keep it if it feels right.`,
        rules: ['g-2'],
      })
    }
  }

  /**
   * Brings the movable runs of a week down to `budget` minutes. Runs shrink in proportion but not
   * below the session minimum; when even the minimums do not fit, the shortest easy run goes first,
   * then the shortest other run. A long run (or either day of a pair) is scaled, never removed
   * unless the budget is under the shortest run a day can hold.
   */
  function shortenWeek(indices: number[], budget: number, weekStart: string): void {
    const isAnchor = (s: SessionSpec) =>
      s.kind === 'long' ||
      s.kind === 'long-fast-finish' ||
      s.flags.includes('b2b-day1') ||
      s.flags.includes('b2b-day2')
    const isEasy = (s: SessionSpec) =>
      s.kind === 'easy' || s.kind === 'recovery' || s.kind === 'strides'
    const dropOrder = (a: number, b: number) => {
      const x = items[a]!
      const y = items[b]!
      return x.durationMin - y.durationMin || (x.date < y.date ? 1 : -1)
    }
    for (;;) {
      const ids = indices.filter((i) => items[i] !== null && modifiable(items[i]!))
      if (ids.length === 0) return
      const sizes = ids.map((i) => items[i]!.durationMin)
      const mins = ids.map((i, k) => Math.min(sizes[k]!, minSize(items[i]!)))
      const total = sizes.reduce((a, b) => a + b, 0)
      if (total <= budget + EPS) return
      const minTotal = mins.reduce((a, b) => a + b, 0)
      if (minTotal <= budget + EPS) {
        const extra = budget - minTotal
        const above = total - minTotal
        ids.forEach((i, k) => {
          const keep = mins[k]! + Math.floor((extra * (sizes[k]! - mins[k]!)) / above + EPS)
          items[i] = scaleSession(items[i]!, keep / sizes[k]!, 0)
        })
        return
      }
      const drop =
        [...ids].filter((i) => !isAnchor(items[i]!) && isEasy(items[i]!)).sort(dropOrder)[0] ??
        [...ids].filter((i) => !isAnchor(items[i]!)).sort(dropOrder)[0]
      if (drop === undefined) {
        // Only long runs are left: scale them to the budget, and drop one only when the budget is
        // under the shortest run a day can hold.
        for (const i of ids) {
          items[i] = scaleSession(items[i]!, budget / total, P.fplace.minRunDayMin.value)
        }
        return
      }
      const gone = items[drop]!
      items[drop] = null
      warn(`drop|${gone.date}|${gone.kind}`, {
        code: 'ramp-run-dropped',
        severity: 'info',
        message: `The ${gone.kind} run of ${gone.durationMin} min on ${gone.date} is left out so the week of ${weekStart} stays within its weekly ramp.`,
        rules: ['g-2'],
      })
    }
  }

  /** The lowest weekly ramp of the athlete's profiles, or null for the default profile. */
  function tightRamp(): number | null {
    const caps: number[] = []
    if (state.risk.recentInjury) caps.push(P.g3.recentInjuryRamp.value[1])
    if (state.risk.priorBsi) caps.push(P.g3.priorBsiRampMax.value)
    if (state.risk.bsiFactors >= P.g3.bsiFactorsForCap.value) {
      caps.push(P.g2.rampSoft.value * P.g3.bsiRampFactor.value)
    }
    return caps.length === 0 ? null : Math.min(...caps)
  }

  function gainRamp(weekStart: string): void {
    const gain = gainVolume.get(weekStart) ?? 0
    const base = positive(highest(gainVolume, weekStart, 1, P.g2.baselineWeeks.value))
    if (base === null || gain <= base * (1 + P.h4.weeklyGainRamp.value) + EPS) return
    warn(`gain|${weekStart}`, {
      code: 'gain-ramp-soft',
      severity: 'warn',
      message: `Climbing in the week of ${weekStart} is ${Math.round(gain)} m, above a ${Math.round(P.h4.weeklyGainRamp.value * 100)}% step on the highest of the previous weeks (${Math.round(base)} m).`,
      rules: ['H4'],
    })
  }

  // ---- back-to-back pairs (H3) ----

  /** Checks the pair that starts at item `i`; returns day 1, turned into a plain long run if the pair is dropped. */
  function pairChecks(i: number): SessionSpec {
    const day1 = items[i]!
    const j = items.findIndex(
      (s) =>
        s !== null &&
        s.date === addDays(day1.date, 1) &&
        s.kind === 'b2b' &&
        s.flags.includes('b2b-day2'),
    )
    const dePair = (message: string, code: string): SessionSpec => {
      if (j >= 0) items[j] = null
      const plain: SessionSpec = {
        ...day1,
        kind: day1.kind === 'b2b' ? 'long' : day1.kind,
        flags: day1.flags.filter((f) => f !== 'b2b-day1'),
      }
      items[i] = plain
      warn(`h3|${day1.date}|${code}`, { code, severity: 'warn', message, rules: ['H3'] })
      return plain
    }
    if (j < 0)
      return dePair(
        `The run on ${day1.date} has no second day and stays a single long run.`,
        'b2b-removed',
      )

    const gapDays = P.h3.b2bMinGapWeeks.value * 7
    if (pairStarts.some((d) => Math.abs(daysBetween(d, day1.date)) < gapDays)) {
      return dePair(
        `A back-to-back pair on ${day1.date} is closer than ${P.h3.b2bMinGapWeeks.value} weeks to another one, so the second day is dropped.`,
        'b2b-removed',
      )
    }

    let day2 = items[j]!
    const longest = day1.durationMin * P.h3.b2bDay2MaxRatioOfDay1.value
    if (day2.durationMin > longest + EPS) {
      const scaled = scaleSession(day2, longest / day2.durationMin)
      warn(`h3|${day2.date}|b2b-day2`, {
        code: 'b2b-day2-cap',
        severity: 'warn',
        message: `Day 2 of the pair on ${day1.date} is held to no more than day 1.`,
        rules: ['H3'],
      })
      if (scaled === null) {
        return dePair(
          `Day 2 of the pair on ${day1.date} is too short after the cap, so the pair is dropped.`,
          'b2b-removed',
        )
      }
      day2 = scaled
      items[j] = day2
    }

    const cap = twoDayReference(day1.date) * P.h3.b2bTwoDayRatio.value
    if (cap > 0 && day1.durationMin + day2.durationMin > cap + EPS) {
      const fit = cap - day1.durationMin
      const scaled = fit >= minRun ? scaleSession(day2, fit / day2.durationMin) : null
      if (scaled === null) {
        return dePair(
          `The pair on ${day1.date} is over ${P.h3.b2bTwoDayRatio.value}x the largest 2-day total of the last ${P.g1.windowDays.value} days and does not fit, so it stays a single long run.`,
          'b2b-removed',
        )
      }
      items[j] = scaled
      warn(`h3|${day1.date}|b2b-total`, {
        code: 'b2b-total-cap',
        severity: 'warn',
        message: `Day 2 of the pair on ${day1.date} is shortened so the pair stays within ${P.h3.b2bTwoDayRatio.value}x the largest 2-day total of the last ${P.g1.windowDays.value} days.`,
        rules: ['H3'],
      })
    }
    pairStarts.push(day1.date)
    return day1
  }

  /** Largest total of two consecutive days among the completed and projected runs before `date`. */
  function twoDayReference(date: string): number {
    const window = P.g1.windowDays.value
    const perDay = new Map<string, number>()
    for (const r of records) {
      const ago = daysBetween(r.date, date)
      if (ago >= 1 && ago <= window) perDay.set(r.date, (perDay.get(r.date) ?? 0) + r.min)
    }
    let best = 0
    for (let ago = window; ago >= 2; ago -= 1) {
      const first = addDays(date, -ago)
      best = Math.max(best, (perDay.get(first) ?? 0) + (perDay.get(addDays(first, 1)) ?? 0))
    }
    for (const entry of virtualTwoDay) {
      const ago = daysBetween(entry.date, date)
      if (ago >= 1 && ago <= window) best = Math.max(best, entry.min)
    }
    return best
  }

  // ---- session spike guard (g-1, H4) ----

  function spikeCheck(s: SessionSpec): SessionSpec | null {
    const ref = referenceAt(s.date)
    if (ref.min <= 0 && !noReferenceWarned) {
      noReferenceWarned = true
      warn('spike-none', {
        code: 'spike-no-reference',
        severity: 'info',
        message: `No completed run in the ${P.g1.windowDays.value} days before ${s.date}, so the session spike guard has nothing to compare with until runs are logged.`,
        rules: ['g-1'],
      })
    }
    const base: SessionSpec = {
      ...s,
      flags: s.flags.filter((f) => f !== 'spike-warn' && f !== 'override-required'),
    }
    if (ref.min > 0) {
      const unknown: Array<[DimName, number | null, number | null]> = [
        ['distance', s.distanceM, ref.distanceM],
        ['gain', s.gainM, ref.gainM],
        ['descent', s.gainM, ref.lossM],
      ]
      for (const [name, value, known] of unknown) {
        if (value === null || value <= 0 || known !== null) continue
        warn(`spike-none|${name}`, {
          code: 'spike-no-reference',
          severity: 'info',
          message: `No completed run in the ${P.g1.windowDays.value} days before ${s.date} records its ${name}, so the ${name} of planned runs is not compared until runs with it are logged.`,
          rules: name === 'distance' ? ['g-1'] : ['g-1', 'H4'],
        })
      }
    }
    const dims = dimensionsOf(s, ref)
    const checked = dims.map((d) => ({ d, ...limits(d) }))
    const over = checked.filter((c) => c.level > 0)
    if (over.length === 0) return base
    const level = Math.max(...over.map((c) => c.level))
    const text = over
      .map((c) =>
        c.d.ref > 0
          ? `${c.d.name} ${(c.d.value / c.d.ref).toFixed(2)}x`
          : `${c.d.name} ${Math.round(c.d.value)} m against none`,
      )
      .join(', ')
    const where = `${P.g1.windowDays.value}-day longest completed run`

    if (state.risk.recentInjury) {
      const factor = Math.min(...over.map((c) => c.warnLimit / c.d.value))
      const scaled = scaleSession(base, factor)
      warn(`g1|${s.date}`, {
        code: 'spike-hard-limit',
        severity: 'warn',
        message: `The run on ${s.date} was ${text} of the ${where}; with the recent-injury flag ${P.g1.spikeRatioWarn.value}x is a hard limit, so it is shortened.`,
        rules: ['g-1', 'g-3'],
      })
      return scaled
    }
    if (level === 2 && options.neverOverride === true) {
      const factor = Math.min(
        ...over.filter((c) => c.level === 2).map((c) => c.overrideLimit / c.d.value),
      )
      const scaled = scaleSession(base, factor)
      if (scaled === null) {
        dropPartner(s)
        warn(`g1|${s.date}`, {
          code: 'spike-run-dropped',
          severity: 'info',
          message: `The run on ${s.date} would be ${text} of the ${where}, and a run that short is not worth scheduling, so it is left out. Runs are never scheduled above ${P.g1.spikeRatioOverride.value}x without an explicit override.`,
          rules: ['g-1'],
        })
        return null
      }
      warn(`g1|${s.date}`, {
        code: 'spike-shortened',
        severity: 'warn',
        message: `The run on ${s.date} would be ${text} of the ${where}, so it is shortened to ${P.g1.spikeRatioOverride.value}x. The minutes cut are not made up.`,
        rules: ['g-1'],
      })
      // the shortened run may still sit in the warn band, which carries its own flag
      return spikeCheck(scaled)
    }
    const flag: SessionFlag = level === 2 ? 'override-required' : 'spike-warn'
    warn(`g1|${s.date}`, {
      code: level === 2 ? 'spike-override' : 'spike-warn',
      severity: level === 2 ? 'hold' : 'warn',
      message:
        level === 2
          ? `The run on ${s.date} is ${text} of the ${where}. It needs an explicit override before it is scheduled.`
          : `The run on ${s.date} is ${text} of the ${where}. Check that it feels right before doing it.`,
      rules: ['g-1'],
    })
    return { ...base, flags: [...base.flags, flag] }
  }

  /** A dropped day 1 of a back-to-back pair takes its day 2 with it. */
  function dropPartner(day1: SessionSpec): void {
    if (!day1.flags.includes('b2b-day1')) return
    const j = items.findIndex(
      (x) =>
        x !== null &&
        x.date === addDays(day1.date, 1) &&
        x.kind === 'b2b' &&
        x.flags.includes('b2b-day2'),
    )
    if (j >= 0) items[j] = null
  }

  function referenceAt(date: string): Reference {
    const window = P.g1.windowDays.value
    const ref: Reference = { min: 0, distanceM: null, gainM: null, lossM: null }
    const max = (a: number | null, b: number | null) => (b === null ? a : Math.max(a ?? 0, b))
    for (const r of records) {
      const ago = daysBetween(r.date, date)
      if (ago < 1 || ago > window) continue
      ref.min = Math.max(ref.min, r.min)
      // A distance of 0 is a run without a recorded distance; a gain of 0 is a flat run.
      ref.distanceM = max(
        ref.distanceM,
        r.distanceM !== null && r.distanceM > 0 ? r.distanceM : null,
      )
      ref.gainM = max(ref.gainM, r.gainM)
      ref.lossM = max(ref.lossM, r.lossM)
    }
    return ref
  }
}

// ---- helpers ----

function limits(d: Dim): { level: 0 | 1 | 2; warnLimit: number; overrideLimit: number } {
  const warnLimit = d.ref + Math.max(d.ref * (P.g1.spikeRatioWarn.value - 1), d.minStep)
  const overrideLimit = Math.max(d.ref * P.g1.spikeRatioOverride.value, warnLimit)
  const level = d.value > overrideLimit + EPS ? 2 : d.value > warnLimit + EPS ? 1 : 0
  return { level, warnLimit, overrideLimit }
}

/** The dimensions to compare: a dimension is skipped only when the window holds no record of it. */
function dimensionsOf(s: SessionSpec, ref: Reference): Dim[] {
  if (ref.min <= 0) return []
  const dims: Dim[] = [{ name: 'duration', value: s.durationMin, ref: ref.min, minStep: 0 }]
  if (s.distanceM !== null && ref.distanceM !== null) {
    dims.push({
      name: 'distance',
      value: s.distanceM,
      ref: ref.distanceM,
      minStep: P.g1.minStepDistanceM.value,
    })
  }
  if (s.gainM !== null) {
    const minStep = P.h4.minStepGainM.value
    if (ref.gainM !== null) dims.push({ name: 'gain', value: s.gainM, ref: ref.gainM, minStep })
    if (ref.lossM !== null) dims.push({ name: 'descent', value: s.gainM, ref: ref.lossM, minStep })
  }
  return dims
}

function ultraCap(options: GuardOptions): number | null {
  const race = options.ultraRaceDurationSec
  if (race === null || race === undefined || race <= 0) return null
  return Math.floor(
    Math.min(
      P.h2.longestRunCapHours.value * 60,
      (race / 60) * P.h2.longestRunCapRaceFraction.value,
    ) + EPS,
  )
}

function completedRuns(history: Activity[]): RunRecord[] {
  return history
    .filter(
      (a) =>
        (a.type === 'run' || a.type === 'race') &&
        a.duplicateOfId === null &&
        a.duplicateStatus !== 'possible' &&
        a.duplicateStatus !== 'confirmed',
    )
    .map((a) => ({
      date: a.date,
      min: a.durationSec / 60,
      distanceM: a.distanceM,
      gainM: a.elevationGainM,
      lossM: a.elevationLossM,
    }))
}

function recordOf(s: SessionSpec): RunRecord {
  return {
    date: s.date,
    min: s.durationMin,
    distanceM: s.distanceM,
    gainM: s.gainM,
    lossM: s.gainM,
  }
}

function weeklyGain(history: Activity[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of history) {
    if (a.type !== 'run') continue
    if (
      a.duplicateOfId !== null ||
      a.duplicateStatus === 'possible' ||
      a.duplicateStatus === 'confirmed'
    )
      continue
    const week = mondayOf(a.date)
    out.set(week, (out.get(week) ?? 0) + (a.elevationGainM ?? 0))
  }
  return out
}

function weeklyMinutes(week: SessionSpec[]): number {
  return week.reduce((sum, s) => sum + (VOLUME_KINDS.has(s.kind) ? s.durationMin : 0), 0)
}

/**
 * Highest value among `count` weeks that end `lag` weeks before `weekStart`; null if none is known.
 * Weeks in `skip` (planned recovery and taper weeks) are left out; when all of them are, the window
 * moves back, at most to `lookback` weeks, to the first week that is not.
 */
function highest(
  values: Map<string, number>,
  weekStart: string,
  lag: number,
  count: number,
  skip?: ReadonlySet<string>,
  lookback = count,
): number | null {
  let best: number | null = null
  for (let k = 0; k < Math.max(count, lookback); k += 1) {
    const week = addDays(weekStart, -7 * (lag + k))
    // past the window, only a window that found nothing keeps looking
    if (k >= count && best !== null) break
    if (skip?.has(week)) continue
    const v = values.get(week)
    if (v !== undefined) best = best === null ? v : Math.max(best, v)
  }
  return best
}

const maxOf = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b)

const positive = (value: number | null): number | null =>
  value !== null && value > 0 ? value : null

function cloneSession(s: SessionSpec): SessionSpec {
  return structuredClone(s)
}

/** The shortest a run may be made by a cut: the session minimum, or the run day minimum for run-walk. */
function runMinimum(s: SessionSpec): number {
  return s.flags.includes('run-walk') ? P.fplace.minRunDayMin.value : P.fplace.easyRunMinMin.value
}

/** The smallest size a guard cuts a run to; a run already under the session minimum may go to the run day minimum. */
function minSize(s: SessionSpec): number {
  return s.durationMin >= runMinimum(s) ? runMinimum(s) : P.fplace.minRunDayMin.value
}

/**
 * Shortens a session to `factor` of its size, rounding down; null when it falls under `minMin`
 * (by default the session minimum of the run, or the run day minimum for a run already under it).
 */
function scaleSession(s: SessionSpec, factor: number, minMin?: number): SessionSpec | null {
  if (factor >= 1) return s
  const down = (v: number) => Math.floor(Math.max(0, v) * factor + EPS)
  const durationMin = down(s.durationMin)
  if (durationMin < (minMin ?? minSize(s))) return null
  const structure: Step[] = s.structure.map((step) => ({
    ...step,
    durationSec: step.durationSec === null ? null : down(step.durationSec),
    distanceM: step.distanceM === null ? null : down(step.distanceM),
  }))
  return {
    ...s,
    durationMin,
    distanceM: s.distanceM === null ? null : down(s.distanceM),
    gainM: s.gainM === null ? null : down(s.gainM),
    structure,
  }
}

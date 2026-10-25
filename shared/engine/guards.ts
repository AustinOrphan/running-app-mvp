// Safety limits applied to a planned session list: the session spike guard (rules g-1, H4), the
// weekly ramp (g-2), the tightened profiles (g-3), the ultra caps (H2, H3) and the helper behind
// "never make up lost volume" (g-6). Pure: no I/O, no clock; `state.asOf` is today. Every number
// comes from limits.ts, which the macrocycle and the week placement plan with, so a generated
// plan passes here unchanged; the cuts remain for owner edits and as a safety net.
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import type { Activity } from '../types.ts'
import {
  completedReference,
  EPS,
  gainLimit,
  injuryTight,
  isProgramme,
  rampBasis,
  rampLimits,
  rampSkipWeeks,
  rebuildStep,
  recordOf,
  referenceAt,
  runningGain,
  runningMinutes,
  spikeOverrideLimit,
  spikeWarnLimit,
  twoDayReference,
  ultraRunCapMin,
  VOLUME_KINDS,
  weeklyGain,
  type RampContext,
  type RampExemption,
  type RebuildZone,
  type SpikeReference,
} from './limits.ts'
import { intensityMinutes } from './micro.ts'
import { P } from './params/index.ts'
import { isLadderSession, startSessionMinMin, type StartKind } from './startWeeks.ts'
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
   * Mondays of the planned recovery and taper weeks. Such a week never sets a ramp baseline, so a
   * planned easy week cannot hold the weeks after it down [rules g-2].
   */
  lowWeeks?: Iterable<string>
  /**
   * Mondays of the post-race return weeks [rules H12]: exempt from the weekly ramp as a return to
   * an established base, like the start path's first week. Every session still obeys G-1.
   */
  exemptWeeks?: Iterable<string>
  /**
   * The start path [rules E6]: the first week of a plan for a runner whose recent weeks are below
   * the floor, whether it opens the run-walk ladder, the 3 x N floor or the injury-return ladder.
   * That one week is exempt from G-2 up to `minutes`, and is a baseline at those minutes for the
   * weeks after it. Every session still obeys G-1.
   */
  startPath?: { weekStart: string; minutes: number; kind?: StartKind } | null
  /**
   * The later weeks of a start path and what each is exempt from (limits.ts `RampExemption`): the
   * ladder weeks from the soft 10% warning only, the injury-return weeks from the whole weekly
   * ramp, as each of their runs is held to 1.10x the longest completed run instead.
   */
  exempt?: ReadonlyMap<string, RampExemption>
  /**
   * The rebuild zone of the plan [rules g-8] (`rebuildZone`, loadSetting.ts), which sets the soft
   * step of a week under its ceiling: the generator's own zone, so that the guards check the plan
   * against the step it was drawn with. Absent at steady and for a caller that has no plan options.
   */
  rebuild?: RebuildZone | null
  /**
   * For a generated plan: a run above the normal band (1.10x the 30-day reference, or the minimum
   * step) on any dimension is shortened to that limit (and left out when it would fall under the
   * session minimum) instead of being flagged [rules g-1, G6]. A generated plan is built inside the
   * band, so this only catches what the planning missed. Without it, such a run keeps `spike-warn`
   * or `override-required`, as an owner edit does.
   */
  neverOverride?: boolean
  /**
   * Sessions still to run that a re-plan keeps as the owner left them (moved, swapped or trimmed).
   * They count toward their week and as runs done before later ones, are never changed and are not
   * returned.
   */
  fixed?: SessionSpec[]
}

/** Run sessions the guards may shorten. Hikes and races are never rewritten. */
const MUTABLE_KINDS: ReadonlySet<SessionKind> = VOLUME_KINDS

type DimName = 'duration' | 'distance' | 'gain' | 'descent'

interface Dim {
  name: DimName
  value: number
  ref: number
  minStep: number
}

/**
 * min(planned target, actual last week x (1 + ramp)); missed volume is never made up [rules g-6].
 * Under a rebuild zone the growth below its ceiling is the zone's [rules g-8].
 */
export function nextWeekCap(
  plannedMin: number,
  actualLastWeekMin: number,
  ramp: number,
  rebuild: RebuildZone | null = null,
): number {
  const planned = Math.max(0, plannedMin)
  const actual = Math.max(0, actualLastWeekMin)
  // below the rebuild ceiling the cap grows by the zone's step, as the plan does [rules g-8]
  const ceiling = rebuild === null ? actual * (1 + ramp) : rebuildStep(actual, ramp, false, rebuild)
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
 * 1.10x and left out when that falls under the session minimum; with the recent-injury flag 1.10x is a hard limit and the
 * run is shortened. A week above the 2-week 30% ceiling or a tightened ramp is shortened; the
 * soft 10% only warns. The current week is measured as what was run plus what is planned, and
 * when the plan starts after its Monday it is no baseline for the weeks after it. Every cut
 * leaves a warning with rule ids.
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

  const fixedSet = new Set<SessionSpec>()
  const items: Array<SessionSpec | null> = [
    ...sessions.map(cloneSession),
    ...(options.fixed ?? []).map((s) => {
      const copy = cloneSession(s)
      fixedSet.add(copy)
      return copy
    }),
  ].sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1))
  const asOf = state.asOf
  const completed = completedReference(history, state)
  // The runs a planned run is compared with: the completed runs and the planned ones before it.
  // The sessions of a start-path programme are compared with the completed runs and the plain
  // runs only (G-1 reads completed runs); the runs after a programme see its sessions too.
  const records = [...completed.runs]
  const plain = [...completed.runs]

  const modifiable = (s: SessionSpec): boolean =>
    MUTABLE_KINDS.has(s.kind) && s.date >= asOf && !fixedSet.has(s)

  // Weekly running minutes and climbing: what was run for the weeks before the plan, then the
  // final plan; the current week holds what was run plus what is still planned.
  const volume = new Map<string, number>()
  for (const row of state.weeks) volume.set(row.weekStart, row.runMin)
  const gainVolume = weeklyGain(history)
  const firstWeek = mondayOf(asOf)
  const weekStarts = [
    ...new Set(items.filter((s): s is SessionSpec => s !== null).map((s) => mondayOf(s.date))),
  ]
    .filter((w) => w >= firstWeek)
    .sort()

  const ultraCapMin = ultraRunCapMin(options.ultraRaceDurationSec)
  const exemptWeeks = new Set(options.exemptWeeks ?? [])
  const floor = options.startPath ?? null
  const rampCtx: RampContext = {
    volumes: volume,
    skip: rampSkipWeeks(asOf, options.lowWeeks ?? []),
    floor,
    exempt: options.exempt,
    ...rampBasis(state, options.rebuild ?? null),
  }
  const pairStarts: string[] = items
    .filter((s): s is SessionSpec => s !== null && s.date < asOf && s.flags.includes('b2b-day1'))
    .map((s) => s.date)
  let noReferenceWarned = false

  const currentMonday = mondayOf(asOf)
  const doneRow = state.weeks.find((w) => w.weekStart === currentMonday)
  const doneThisWeek = (weekStart: string) =>
    weekStart === currentMonday && doneRow !== undefined ? doneRow.runMin : 0
  const doneGain = gainVolume.get(currentMonday) ?? 0
  // With running logged for the current week, its sessions before today are in that log.
  const loggedWeek = (weekStart: string) => weekStart === currentMonday && doneRow !== undefined
  const ahead = (week: SessionSpec[]) => week.filter((s) => s.date >= asOf)
  const weekMinutes = (weekStart: string, week: SessionSpec[]) =>
    loggedWeek(weekStart)
      ? doneThisWeek(weekStart) + runningMinutes(ahead(week))
      : runningMinutes(week)
  const weekGain = (weekStart: string, week: SessionSpec[]) =>
    loggedWeek(weekStart) ? doneGain + runningGain(ahead(week)) : runningGain(week)

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
      if (s === null || s === undefined) continue
      if (fixedSet.has(s)) {
        if (MUTABLE_KINDS.has(s.kind) && s.date >= asOf) {
          records.push(recordOf(s))
          if (!isProgramme(s)) plain.push(recordOf(s))
        }
        continue
      }
      if (!modifiable(s)) continue
      let current: SessionSpec = s
      if (current.flags.includes('b2b-day1')) {
        current = pairChecks(i)
      }
      const outcome = spikeCheck(current)
      items[i] = outcome
      if (outcome !== null && !outcome.flags.includes('override-required')) {
        records.push(recordOf(outcome))
        if (!isProgramme(outcome)) plain.push(recordOf(outcome))
      }
    }

    const final = indicesOf(weekStart).map((i) => items[i]!)
    volume.set(weekStart, weekMinutes(weekStart, final))
    gainVolume.set(weekStart, weekGain(weekStart, final))
    gainRamp(weekStart)
  }

  return {
    sessions: items.filter((s): s is SessionSpec => s !== null && !fixedSet.has(s)),
    warnings,
  }

  // ---- weekly ramp ----

  /** What the first week of a start path says about itself; no word of falling behind. */
  function startMessage(weekStart: string, start: { minutes: number; kind?: StartKind }): string {
    if (start.kind === 'ladder') {
      return `The week of ${weekStart} starts the run-walk steps: ${start.minutes} min of short runs and walking breaks, above the usual weekly step. The steps rise one at a time, and a step can be repeated.`
    }
    if (start.kind === 'injury-return') {
      return `The week of ${weekStart} starts the return to running: ${start.minutes} min of easy running across the runs of the first level, above the usual weekly step. The levels rise one at a time, with a rest day between runs.`
    }
    return `The week of ${weekStart} starts at ${start.minutes} min, ${P.restartFloor.sessions.value} sessions of at least ${P.restartFloor.sessionMin.value} min, above the usual weekly step. Growth from it follows the weekly ramp.`
  }

  function rampWeek(weekStart: string): void {
    if (exemptWeeks.has(weekStart)) return
    const indices = indicesOf(weekStart)
    const week = indices.map((i) => items[i]!)
    const total = weekMinutes(weekStart, week)
    if (total <= 0) return
    if (floor !== null && floor.weekStart === weekStart) {
      // The first week of a start path is exempt from G-2 up to its minutes; it is not exempt from
      // anything else. Where it starts from, the plan says so.
      warn(`floor|${weekStart}`, {
        code: 'restart-floor',
        severity: 'info',
        message: startMessage(weekStart, floor),
        rules: ['g-2', 'E6', ...(floor.kind === 'injury-return' ? ['g-3'] : ['A9'])],
      })
    }
    const limits = rampLimits(rampCtx, weekStart)
    if (limits === null) return
    const { allowed } = limits
    const baselineWeeks = P.g2.baselineWeeks.value
    if (total > allowed + 1e-6) {
      // Runs before the plan starts are already in `doneThisWeek`.
      const fixedMin = week
        .filter(
          (s) =>
            VOLUME_KINDS.has(s.kind) && !modifiable(s) && !(loggedWeek(weekStart) && s.date < asOf),
        )
        .reduce((sum, s) => sum + s.durationMin, 0)
      shortenWeek(indices, Math.max(0, allowed - fixedMin - doneThisWeek(weekStart)), weekStart)
      warn(`ramp|${weekStart}`, {
        code: limits.tightened ? 'ramp-tightened' : 'ramp-ceiling',
        severity: 'warn',
        message: limits.tightened
          ? `Running time in the week of ${weekStart} is held to ${Math.round(allowed)} min, a ramp of ${Math.round((limits.tightRamp ?? 0) * 100)}% on the highest of the previous ${baselineWeeks} weeks, for the injury profile.`
          : `Running time in the week of ${weekStart} is held to ${Math.round(allowed)} min, ${Math.round(P.g2.rampCeilingTwoWeeks.value * 100)}% above the week ${P.g2.ceilingWindowWeeks.value} weeks earlier.`,
        rules: limits.tightened ? ['g-2', 'g-3'] : ['g-2'],
      })
    } else if (!limits.exempt && total > limits.soft + 1e-6) {
      // in the rebuild zone the soft limit is the zone's step, up to its ceiling
      const step =
        limits.rebuild === null
          ? `a ${Math.round(P.g2.rampSoft.value * 100)}% step`
          : `the ${Math.round(limits.rebuild.step * 100)}% rebuild step toward ${Math.round(limits.rebuild.ceilingMin)} min`
      warn(`ramp|${weekStart}`, {
        code: 'ramp-soft',
        severity: 'warn',
        message: `Running time in the week of ${weekStart} is ${Math.round(total)} min, above ${step} on the highest of the previous ${baselineWeeks} weeks (${Math.round(limits.base)} min). Keep it if it feels right.`,
        rules: limits.rebuild === null ? ['g-2'] : ['g-2', 'g-8'],
      })
    }
  }

  /**
   * Brings the movable runs of a week down to `budget` minutes. Runs shrink in proportion but not
   * below the session minimum; when even the minimums do not fit, the shortest easy run goes first,
   * then the shortest other run, except that a quality run goes first when the easy run is what
   * keeps the week under the F2 cap on the share above zone 1. A long run (or either day of a pair) is scaled, never removed
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
    // The share of the week above zone 1 if `replace` were applied: a run mapped to null is gone.
    const hardShare = (replace: Map<number, SessionSpec | null>): number => {
      let hard = 0
      let all = 0
      for (const i of indices) {
        const s = replace.has(i) ? replace.get(i) : items[i]
        if (s === null || s === undefined || !VOLUME_KINDS.has(s.kind)) continue
        hard += intensityMinutes(s)
        all += s.durationMin
      }
      return all > 0 ? (hard / all) * 100 : 0
    }
    const overCap = (replace: Map<number, SessionSpec | null>) =>
      hardShare(replace) > P.f2.z2z3ShareMax.value + EPS
    const dropRun = (i: number) => {
      const gone = items[i]!
      items[i] = null
      warn(`drop|${gone.date}|${gone.kind}`, {
        code: 'ramp-run-dropped',
        severity: 'info',
        message: `The ${gone.kind} run of ${gone.durationMin} min on ${gone.date} is left out so the week of ${weekStart} stays within its weekly ramp.`,
        rules: ['g-2'],
      })
    }
    for (;;) {
      const ids = indices.filter((i) => items[i] !== null && modifiable(items[i]!))
      if (ids.length === 0) return
      const sizes = ids.map((i) => items[i]!.durationMin)
      const mins = ids.map((i, k) => Math.min(sizes[k]!, minSize(items[i]!)))
      const total = sizes.reduce((a, b) => a + b, 0)
      if (total <= budget + EPS) return
      const minTotal = mins.reduce((a, b) => a + b, 0)
      // The quality run with the most hard minutes goes first when a cut would leave the week
      // above the F2 cap on the share above zone 1: shrinking keeps the work, so the week turns
      // mostly hard while the easy volume is the part that goes [rules F2].
      const quality = ids
        .filter(
          (i) => !isAnchor(items[i]!) && !isEasy(items[i]!) && intensityMinutes(items[i]!) > 0,
        )
        .sort(
          (a, b) => intensityMinutes(items[b]!) - intensityMinutes(items[a]!) || dropOrder(a, b),
        )
      if (minTotal <= budget + EPS) {
        const extra = budget - minTotal
        const above = total - minTotal
        const scaled = new Map<number, SessionSpec | null>()
        ids.forEach((i, k) => {
          const keep = mins[k]! + Math.floor((extra * (sizes[k]! - mins[k]!)) / above + EPS)
          scaled.set(i, scaleSession(items[i]!, keep / sizes[k]!, 0))
        })
        if (quality.length > 0 && overCap(scaled)) {
          dropRun(quality[0]!)
          continue
        }
        for (const [i, spec] of scaled) items[i] = spec
        return
      }
      // An easy run goes first, unless the week left would be over the cap even at the session
      // minimums: then the quality run goes instead.
      const easyDrop = [...ids]
        .filter((i) => !isAnchor(items[i]!) && isEasy(items[i]!))
        .sort(dropOrder)[0]
      let drop: number | undefined = easyDrop
      if (easyDrop !== undefined && quality.length > 0) {
        const atMinimum = new Map<number, SessionSpec | null>([[easyDrop, null]])
        ids.forEach((i, k) => {
          if (i !== easyDrop) atMinimum.set(i, scaleSession(items[i]!, mins[k]! / sizes[k]!, 0))
        })
        if (overCap(atMinimum)) drop = quality[0]
      }
      drop ??= [...ids].filter((i) => !isAnchor(items[i]!)).sort(dropOrder)[0]
      if (drop === undefined) {
        // Only long runs are left: scale them to the budget, and drop one only when the budget is
        // under the shortest run a day can hold.
        for (const i of ids) {
          items[i] = scaleSession(items[i]!, budget / total, P.fplace.minRunDayMin.value)
        }
        return
      }
      dropRun(drop)
    }
  }

  function gainRamp(weekStart: string): void {
    const gain = gainVolume.get(weekStart) ?? 0
    // A step within the minimum step of H4 (100 m) is never a warning on its own.
    const limit = gainLimit(gainVolume, rampCtx.skip, weekStart)
    if (limit === null || gain <= limit.allowed + EPS) return
    warn(`gain|${weekStart}`, {
      code: 'gain-ramp-soft',
      severity: 'warn',
      message: `Climbing in the week of ${weekStart} is ${Math.round(gain)} m, above a ${Math.round(P.h4.weeklyGainRamp.value * 100)}% step on the highest of the previous weeks (${Math.round(limit.base)} m).`,
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

    const cap =
      twoDayReference(records, completed.virtualTwoDay, day1.date) * P.h3.b2bTwoDayRatio.value
    if (cap > 0 && day1.durationMin + day2.durationMin > cap + EPS) {
      const fit = cap - day1.durationMin
      const scaled =
        fit >= P.fplace.minRunDayMin.value ? scaleSession(day2, fit / day2.durationMin) : null
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

  // ---- session spike guard (g-1, H4) ----

  function spikeCheck(s: SessionSpec): SessionSpec | null {
    const ref = referenceAt(isProgramme(s) ? plain : records, s.date)
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

    if (injuryTight(state)) {
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
    if (options.neverOverride === true) {
      // A generated plan is built inside the normal band (1.10x, or the minimum step); reaching
      // here means the planning missed it, and the run is shortened rather than flagged. The warn
      // band is reached only by an owner edit, which keeps its warning [rules g-1, G6].
      const factor = Math.min(...over.map((c) => c.warnLimit / c.d.value))
      const scaled = scaleSession(base, factor)
      if (scaled === null) {
        dropPartner(s)
        warn(`g1|${s.date}`, {
          code: 'spike-run-dropped',
          severity: 'info',
          message: `The run on ${s.date} would be ${text} of the ${where}, and a run that short is not worth scheduling, so it is left out. Generated runs stay within ${P.g1.spikeRatioWarn.value}x.`,
          rules: ['g-1'],
        })
        return null
      }
      warn(`g1|${s.date}`, {
        code: 'spike-shortened',
        severity: 'warn',
        message: `The run on ${s.date} would be ${text} of the ${where}, so it is shortened to ${P.g1.spikeRatioWarn.value}x. The minutes cut are not made up.`,
        rules: ['g-1'],
      })
      // rounding down keeps every dimension inside the limit; the check confirms it
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
}

// ---- helpers ----

function limits(d: Dim): { level: 0 | 1 | 2; warnLimit: number; overrideLimit: number } {
  const warnLimit = spikeWarnLimit(d.ref, d.minStep)
  const overrideLimit = spikeOverrideLimit(d.ref, d.minStep)
  const level = d.value > overrideLimit + EPS ? 2 : d.value > warnLimit + EPS ? 1 : 0
  return { level, warnLimit, overrideLimit }
}

/**
 * How far a planned run is above a 30-day reference on any dimension [rules g-1, H4]: 0 inside the
 * normal band, 1 above 1.10x (or the minimum step), 2 above 2.00x. 0 when the reference holds no
 * run. The session spike check of an owner edit (`adjustCheck`) reads the same numbers.
 */
export function spikeLevelOf(s: SessionSpec, ref: SpikeReference): 0 | 1 | 2 {
  return dimensionsOf(s, ref).reduce<0 | 1 | 2>((level, d) => {
    const next = limits(d).level
    return next > level ? next : level
  }, 0)
}

/** The dimensions to compare: a dimension is skipped only when the window holds no record of it. */
function dimensionsOf(s: SessionSpec, ref: SpikeReference): Dim[] {
  if (ref.min <= 0) return []
  const dims: Dim[] = [
    { name: 'duration', value: s.durationMin, ref: ref.min, minStep: P.g1.minStepMin.value },
  ]
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

function cloneSession(s: SessionSpec): SessionSpec {
  return structuredClone(s)
}

/** A session of a ladder week or an injury-return week: the programme sets its length [rules E6, g-3]. */
const isStartSession = (s: SessionSpec): boolean =>
  s.flags.includes('injury-return') || isLadderSession(s)

/**
 * The shortest a run may be made by a cut: the session minimum, the run day minimum for run-walk,
 * or, for a ladder or injury-return session, the shortest start session (5 minutes), which is
 * exempt from the run day minimum.
 */
function runMinimum(s: SessionSpec): number {
  if (isStartSession(s)) return startSessionMinMin()
  return s.flags.includes('run-walk') ? P.fplace.minRunDayMin.value : P.fplace.easyRunMinMin.value
}

/** The smallest size a guard cuts a run to; a run already under the session minimum may go to the run day minimum. */
export function minSize(s: SessionSpec): number {
  if (isStartSession(s)) return runMinimum(s)
  return s.durationMin >= runMinimum(s) ? runMinimum(s) : P.fplace.minRunDayMin.value
}

/**
 * Shortens a session to `factor` of its size, rounding down; null when it falls under `minMin`
 * (by default the session minimum of the run, or the run day minimum for a run already under it).
 */
export function scaleSession(s: SessionSpec, factor: number, minMin?: number): SessionSpec | null {
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

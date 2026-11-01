// Disruption windows [rule J9]: dated periods of rest or limited running that the runner reports
// (ill, a niggle, short on time, travelling). Pure and deterministic: dates are arguments, nothing
// reads a clock, and the only imports are Params, dates and types.
//
// Conventions fixed here:
// - A window has a first day, which may lie in the past, and an inclusive last day. Minutes that
//   fall inside it are lost and never added back [G-6].
// - Illness is rest only and follows n-3 exactly (`illnessGate`, the only implementation): rest
//   through the window and the symptom-free day, easy running for the next easy days, then
//   intensity. A niggle has no symptom-free gate and `j9.niggleEasyDays` easy days after it.
//   Short on time and travel hold running or cap the longest run of each day; quality stays
//   allowed where a run fits.
// - "Held" is a day with no running at all. The days a window holds are the layoff the J7 restart
//   counts, to the first day running is allowed again; windows that overlap or touch are one
//   layoff, so the restart is never applied twice to one break.
// - A window that holds running for `j7.tier1Days` or more restarts at the J7 fraction of the
//   reference week: the return week (prorated by its open days) and the first full week after it.
// - Every function takes plain data and returns plain data in a fixed order, so equal input gives
//   equal output.
import { addDays, daysBetween, isIsoDate, mondayOf } from '../dates.ts'
import type { DisruptionMode, DisruptionPhase, DisruptionReason } from '../types.ts'
import { P } from './params/index.ts'
import type { DisruptionWindow, EngineInput, SessionSpec } from './types.ts'

const DAYS_PER_WEEK = 7

/**
 * The most minutes a `limited` window may cap a day's longest run at. An input bound of the form,
 * not a rule: a longer cap would not limit a day. The lowest cap is `P.fplace.easyRunMinMin`.
 */
export const RUN_CAP_MAX_MIN = 240

/** The pain scale of a niggle report, 0 to 10. */
const PAIN_SCALE_MAX = 10

// ---------------------------------------------------------------------------------------------
// Illness gate [rule n-3]
// ---------------------------------------------------------------------------------------------

export type IllnessPhase = 'clear' | 'rest' | 'easy-only'
export interface IllnessGate {
  phase: IllnessPhase
  /** Days since the newest illness day on or before the date; null when there is none. */
  since: number | null
}

/** True for the two illness reasons. */
export function isIllness(reason: DisruptionReason): boolean {
  return reason === 'illness-above-neck' || reason === 'illness-below-neck'
}

/**
 * The days illness was reported or a window covers [rules n-3, J9]: the check-ins that report it
 * and every day of an illness window, whether or not the window lies in the past. This is the one
 * list `illnessGate` reads, so a window and a check-in make the same gate.
 */
export function illnessDays(input: Pick<EngineInput, 'wellness' | 'disruptions'>): string[] {
  const days = input.wellness.filter((row) => row.illness === true).map((row) => row.date)
  for (const w of input.disruptions ?? []) {
    if (!isIllness(w.reason) || !isUsable(w)) continue
    for (let day = w.startDate; day <= w.endDate; day = addDays(day, 1)) days.push(day)
  }
  return days
}

/** The last day of each part of the gate that follows an illness day [rules n-3]. */
function gateEnds(lastIllnessDay: string): { restThrough: string; easyThrough: string } {
  const free = P.n3.illnessSymptomFreeDays.value
  return {
    restThrough: addDays(lastIllnessDay, free),
    easyThrough: addDays(lastIllnessDay, free + P.n3.illnessEasyDaysBeforeIntensity.value),
  }
}

/**
 * Return-from-illness gate [rules n-3]: rest through the symptom-free day, easy running for the
 * next easy days, intensity after. `illnessDays` are the days illness was reported or a window
 * covers; a day after the date is ignored, and a day without a report counts as symptom-free.
 * Illness is never inferred from HRV or resting HR. This is the only implementation of n-3:
 * `illnessPhase` and the window geometry below both use it.
 */
export function illnessGate(illnessDays: Iterable<string>, date: string): IllnessGate {
  let last: string | null = null
  for (const day of illnessDays) {
    if (day <= date && (last === null || day > last)) last = day
  }
  if (last === null) return { phase: 'clear', since: null }
  const since = daysBetween(last, date)
  const { restThrough, easyThrough } = gateEnds(last)
  if (date <= restThrough) return { phase: 'rest', since }
  if (date <= easyThrough) return { phase: 'easy-only', since }
  return { phase: 'clear', since }
}

// ---------------------------------------------------------------------------------------------
// Restart after a long hold [rule J7]
// ---------------------------------------------------------------------------------------------

/**
 * The share of the reference week a restart after `layoffDays` days without running may hold
 * [rules J7]: 100% under `j7.tier1Days`, 90%, 75% and, over `j7.tier3Days`, 50%.
 */
export function restartFraction(layoffDays: number): number {
  if (layoffDays < P.j7.tier1Days.value) return P.j7.restartUnder7.value
  if (layoffDays <= P.j7.tier2Days.value) return P.j7.restart7to14.value
  if (layoffDays <= P.j7.tier3Days.value) return P.j7.restart15to28.value
  return P.j7.restartOver28.value
}

// ---------------------------------------------------------------------------------------------
// The plan of a set of windows
// ---------------------------------------------------------------------------------------------

/** The restart of a hold: the layoff, its J7 fraction and the two weeks it holds. */
export interface Restart {
  /** Days without running, counted to the first run day (the symptom-free day included). */
  layoffDays: number
  /** The J7 fraction of the reference week; 1 under `j7.tier1Days`. */
  fraction: number
  /** The Monday of the week that holds the first run day. */
  returnWeekStart: string
  /** The Monday of the first full week: the return week when the first run day is a Monday. */
  fullWeekStart: string
}

export interface WindowPlan {
  id: string
  reason: DisruptionReason
  /** `rest` for illness and for a limited window without a cap, which holds as the safer reading. */
  mode: DisruptionMode
  startDate: string
  endDate: string
  /** The longest run of a day in a `limited` window; null otherwise. */
  maxRunMin: number | null
  /** The last day no running is allowed (the window, and for illness the symptom-free wait); null when the window never holds running. */
  restThrough: string | null
  /** The last day of easy running only after the hold; null when the reason has no tail. */
  easyThrough: string | null
  /** The first day running is allowed: the day after the hold, or the first day of a limited window. */
  runFrom: string
  /** The first day quality sessions are allowed. */
  qualityFrom: string
  /** Set when the window holds running; null for a limited window. */
  restart: Restart | null
  /** The last day of the weeks held to the restart fraction; null when the fraction is 1. */
  returnThrough: string | null
}

/** What the windows allow on one date, merged with the strictest rule winning [G-6]. */
export interface DayRule {
  date: string
  /** No running at all. */
  held: boolean
  /** Only the symptom-free wait after an illness holds the day. */
  gate: boolean
  /** The longest run in minutes: 0 on a held day, null when no window caps the day. */
  maxRunMin: number | null
  /** False on a day quality sessions wait. */
  quality: boolean
  /** The reason the day reads under (the window that holds it, else caps it, else its tail). */
  reason: DisruptionReason
  windowIds: string[]
}

/** A maximal run of consecutive held days: one layoff, however many windows made it. */
export interface HoldRun extends Restart {
  from: string
  /** The last held day. */
  to: string
  /** The first day running is allowed again. */
  runFrom: string
  windowIds: string[]
}

/**
 * Niggle with pain at or above `pain.flagScore` or a gait change [rules J9, n-2]: the tightened
 * recent-injury profile (G-3) applies from `from` to `until`, both inclusive.
 */
export interface InjuryReport {
  windowId: string
  from: string
  until: string
}

export interface DisruptionPlan {
  /** The usable windows, in the order given. */
  windows: WindowPlan[]
  /** One rule per date any window touches, ascending. */
  days: DayRule[]
  /** The layoffs, ascending. */
  holds: HoldRun[]
  injuryReports: InjuryReport[]
}

function isUsable(w: DisruptionWindow): boolean {
  return isIsoDate(w.startDate) && isIsoDate(w.endDate) && w.startDate <= w.endDate
}

function planWindow(w: DisruptionWindow): WindowPlan {
  const illness = isIllness(w.reason)
  const capped = !illness && w.mode === 'limited' && w.maxRunMin !== null && w.maxRunMin > 0
  let restThrough: string | null = null
  let easyThrough: string | null = null
  if (illness) {
    const ends = gateEnds(w.endDate)
    restThrough = ends.restThrough
    easyThrough = ends.easyThrough
  } else {
    if (!capped) restThrough = w.endDate
    if (w.reason === 'niggle') easyThrough = addDays(w.endDate, P.j9.niggleEasyDays.value)
  }
  const runFrom = restThrough === null ? w.startDate : addDays(restThrough, 1)
  const qualityFrom =
    easyThrough !== null ? addDays(easyThrough, 1) : restThrough !== null ? runFrom : w.startDate
  return {
    id: w.id,
    reason: w.reason,
    mode: capped ? 'limited' : 'rest',
    startDate: w.startDate,
    endDate: w.endDate,
    maxRunMin: capped ? w.maxRunMin : null,
    restThrough,
    easyThrough,
    runFrom,
    qualityFrom,
    restart: null,
    returnThrough: null,
  }
}

/** What one window allows on a date; lower `rank` names the day for display. */
interface Applied {
  rank: number
  held: boolean
  gate: boolean
  cap: number | null
  quality: boolean
}

function appliedOn(w: WindowPlan, date: string): Applied | null {
  if (date < w.startDate) return null
  if (w.restThrough !== null && date <= w.restThrough) {
    const gate = date > w.endDate
    return { rank: gate ? 1 : 0, held: true, gate, cap: 0, quality: false }
  }
  if (date <= w.endDate) {
    return { rank: 2, held: false, gate: false, cap: w.maxRunMin, quality: date >= w.qualityFrom }
  }
  if (w.easyThrough !== null && date <= w.easyThrough) {
    return { rank: 3, held: false, gate: false, cap: null, quality: false }
  }
  return null
}

/** The last day any rule of the window applies. */
function lastDay(w: WindowPlan): string {
  return [w.endDate, w.restThrough, w.easyThrough].reduce<string>(
    (last, day) => (day !== null && day > last ? day : last),
    w.endDate,
  )
}

function byStartThenId(a: WindowPlan, b: WindowPlan): number {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function dayRules(windows: readonly WindowPlan[]): DayRule[] {
  const touched = new Set<string>()
  for (const w of windows) {
    for (let date = w.startDate, end = lastDay(w); date <= end; date = addDays(date, 1)) {
      touched.add(date)
    }
  }
  const ordered = [...windows].sort(byStartThenId)
  const rules: DayRule[] = []
  for (const date of [...touched].sort()) {
    let held = false
    let allGate = true
    let cap: number | null = null
    let quality = true
    let best: { rank: number; reason: DisruptionReason } | null = null
    const ids: string[] = []
    for (const w of ordered) {
      const applied = appliedOn(w, date)
      if (applied === null) continue
      ids.push(w.id)
      if (applied.held) {
        held = true
        if (!applied.gate) allGate = false
      }
      if (applied.cap !== null) cap = cap === null ? applied.cap : Math.min(cap, applied.cap)
      if (!applied.quality) quality = false
      if (best === null || applied.rank < best.rank) best = { rank: applied.rank, reason: w.reason }
    }
    if (best === null) continue
    rules.push({
      date,
      held,
      gate: held && allGate,
      maxRunMin: held ? 0 : cap,
      quality: held ? false : quality,
      reason: best.reason,
      windowIds: ids,
    })
  }
  return rules
}

function holdRuns(days: readonly DayRule[], windows: readonly WindowPlan[]): HoldRun[] {
  const runs: HoldRun[] = []
  let start: string | null = null
  let previous: string | null = null
  const close = () => {
    if (start === null || previous === null) return
    const runFrom = addDays(previous, 1)
    const layoffDays = daysBetween(start, previous) + 1
    const returnWeekStart = mondayOf(runFrom)
    const from = start
    const to = previous
    runs.push({
      from,
      to,
      runFrom,
      layoffDays,
      fraction: restartFraction(layoffDays),
      returnWeekStart,
      fullWeekStart:
        runFrom === returnWeekStart ? runFrom : addDays(returnWeekStart, DAYS_PER_WEEK),
      windowIds: [...windows]
        .sort(byStartThenId)
        .filter((w) => w.restThrough !== null && w.startDate <= to && w.restThrough >= from)
        .map((w) => w.id),
    })
  }
  for (const rule of days) {
    if (!rule.held) continue
    if (previous !== null && rule.date === addDays(previous, 1)) {
      previous = rule.date
      continue
    }
    close()
    start = rule.date
    previous = rule.date
  }
  close()
  return runs
}

/**
 * The injury report of a window [rules J9, n-2]: only a niggle with pain at or above
 * `pain.flagScore` or a gait change. The tightened profile lasts from the first day of the window
 * until the return plus the injury-return ladder, one week for each of its levels
 * (`injuryReturn.levelsMin`); the recovery cadence is unchanged.
 */
export function injuryReportOf(
  window: Pick<DisruptionWindow, 'id' | 'reason' | 'startDate' | 'endDate' | 'pain' | 'gaitChange'>,
): InjuryReport | null {
  if (window.reason !== 'niggle') return null
  const painful = window.pain !== null && window.pain >= P.pain.flagScore.value
  if (!painful && !window.gaitChange) return null
  const ladderWeeks = P.injuryReturn.levelsMin.value.length
  return {
    windowId: window.id,
    from: window.startDate,
    until: addDays(window.endDate, ladderWeeks * DAYS_PER_WEEK),
  }
}

/** The injury reports of the usable windows, in the order given [rules J9, n-2]. */
export function injuryReports(windows: readonly DisruptionWindow[]): InjuryReport[] {
  return windows.filter(isUsable).flatMap((w) => {
    const report = injuryReportOf(w)
    return report === null ? [] : [report]
  })
}

/**
 * Turns windows into per-day rules, layoffs and injury reports. Windows with a date that is not a
 * real calendar date, or a last day before the first, are left out; `validateDisruption` refuses
 * them before they are stored.
 */
export function disruptionPlan(windows: readonly DisruptionWindow[]): DisruptionPlan {
  const usable = windows.filter(isUsable)
  const planned = usable.map(planWindow)
  const days = dayRules(planned)
  const holds = holdRuns(days, planned)
  const withRestart = planned.map((w): WindowPlan => {
    const restThrough = w.restThrough
    if (restThrough === null) return w
    const run = holds.find((h) => h.from <= restThrough && restThrough <= h.to)
    if (run === undefined) return w
    return {
      ...w,
      restart: {
        layoffDays: run.layoffDays,
        fraction: run.fraction,
        returnWeekStart: run.returnWeekStart,
        fullWeekStart: run.fullWeekStart,
      },
      returnThrough: run.fraction < 1 ? addDays(run.fullWeekStart, DAYS_PER_WEEK - 1) : null,
    }
  })
  return {
    windows: withRestart,
    days,
    holds,
    injuryReports: injuryReports(usable),
  }
}

/** Where `date` lies against one window of a plan [rule J9]. */
export function windowPhase(window: WindowPlan, date: string): DisruptionPhase {
  if (date < window.startDate) return 'upcoming'
  if (window.restThrough !== null && date <= window.restThrough) {
    return date <= window.endDate ? 'resting' : 'rest-gate'
  }
  if (date <= window.endDate) return 'limited'
  if (window.easyThrough !== null && date <= window.easyThrough) return 'easy-only'
  if (window.returnThrough !== null && date <= window.returnThrough) return 'returning'
  return 'done'
}

/** The rule for one date, or null when no window touches it. */
export function dayRuleOn(plan: DisruptionPlan, date: string): DayRule | null {
  return plan.days.find((rule) => rule.date === date) ?? null
}

export interface DateRange {
  from?: string
  to?: string
}

function inRange(date: string, range: DateRange): boolean {
  return (
    (range.from === undefined || date >= range.from) && (range.to === undefined || date <= range.to)
  )
}

/**
 * The Mondays of the weeks a long hold sends back at the J7 fraction: each hold's return week and
 * first full week, ascending and without repeats. Empty when no hold reaches `j7.tier1Days`.
 */
export function returnWeeks(plan: DisruptionPlan): string[] {
  const weeks = plan.holds
    .filter((hold) => hold.fraction < 1)
    .flatMap((hold) => [hold.returnWeekStart, hold.fullWeekStart])
  return [...new Set(weeks)].sort()
}

/**
 * The Mondays of the weeks in which a window holds or caps a day, ascending: weeks that lost
 * running to it, and so part weeks [rules J9, g-2]. A week the window only keeps easy (the tail
 * after a niggle or an illness) loses no minute and is not one.
 */
export function windowedWeeks(plan: DisruptionPlan): string[] {
  const weeks = plan.days
    .filter((rule) => rule.held || rule.maxRunMin !== null)
    .map((rule) => mondayOf(rule.date))
  return [...new Set(weeks)].sort()
}

/**
 * The first full week after each hold sent back at the J7 fraction, by Monday, with the share of
 * the reference week it is held to: the J7 fraction of the reference (`holdReference`, read from
 * `volumeOf`), in whole minutes. A week that two holds send back takes the lesser share. A hold
 * whose reference week is unknown (0) has no share to hold the week to and gives 0 [rules J7, J9].
 */
export function restartShares(
  plan: DisruptionPlan,
  volumeOf: (weekStart: string) => number | undefined,
): Map<string, number> {
  const shares = new Map<string, number>()
  for (const hold of plan.holds) {
    if (hold.fraction >= 1) continue
    const share = wholeMin(holdReference(hold, volumeOf) * hold.fraction)
    const known = shares.get(hold.fullWeekStart)
    shares.set(hold.fullWeekStart, known === undefined ? share : Math.min(known, share))
  }
  return new Map([...shares].sort(([a], [b]) => (a < b ? -1 : 1)))
}

/**
 * The Mondays of the restart weeks that are a ramp baseline, ascending: a first full week after a
 * long hold (`restartShares`) that the J7 share holds, that is whose target `targetOf` is at the
 * share. It is the baseline of the weeks after it even when the cadence made it a recovery week, as
 * the post-race restart is [rules J7, J9, H12]. A restart week the cadence cuts below the share is
 * a recovery week like any other and sets no baseline, so the weeks after it ramp from the last
 * loading week, and so is one with no share to be held at [rule E3].
 */
export function holdRestartWeeks(
  plan: DisruptionPlan,
  volumeOf: (weekStart: string) => number | undefined,
  targetOf: (weekStart: string) => number | undefined,
): string[] {
  return [...restartShares(plan, volumeOf)]
    .filter(([weekStart, share]) => share > 0 && (targetOf(weekStart) ?? -1) >= share)
    .map(([weekStart]) => weekStart)
}

/**
 * The Mondays of the weeks that hold days of a hold sent back at the J7 fraction (`returnWeeks`),
 * ascending: the weeks of such a layoff, the return week among them when it holds one of its days.
 * The first full week after it is not one of them.
 */
export function longHoldWeeks(plan: DisruptionPlan): string[] {
  const weeks: string[] = []
  for (const hold of plan.holds) {
    if (hold.fraction >= 1) continue
    for (let monday = mondayOf(hold.from); monday <= hold.to; monday = addDays(monday, 7)) {
      weeks.push(monday)
    }
  }
  return [...new Set(weeks)].sort()
}

/** The rules of the dates in `range`, ascending; the days of a week to place. */
export function dayRulesIn(plan: DisruptionPlan, range: DateRange = {}): DayRule[] {
  return plan.days.filter((rule) => inRange(rule.date, range))
}

/** The dates on which no running is allowed, ascending; hold dates close their slots in the week. */
export function heldDates(plan: DisruptionPlan, range: DateRange = {}): string[] {
  return plan.days.filter((rule) => rule.held && inRange(rule.date, range)).map((rule) => rule.date)
}

// ---------------------------------------------------------------------------------------------
// Weekly caps
// ---------------------------------------------------------------------------------------------

/** What the caller knows about a week to cap it. */
export interface WeekBasis {
  /** The reference week in minutes: the week before the window, which a restart is sized from. */
  referenceMin: number
  /** The minutes the week holds without any window. */
  baselineMin: number
  /**
   * The same minutes by date, when known. A held day then costs what the plan had on it, and a
   * capped day what the plan had above its cap; without it, a held day costs an equal share of the
   * week and a capped day nothing.
   */
  minByDate?: Readonly<Record<string, number>>
}

export type WeekFlag = 'disrupted' | 'disruption-return'

/** True for a week a window touched or holds to the restart fraction (`WeekCap.flags`). */
export function isDisruptedWeek(flags: readonly string[]): boolean {
  return flags.includes('disrupted') || flags.includes('disruption-return')
}

const medianOf = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * The reference week of a hold [rule J7]: the week a restart is sized from. It is the typical week
 * before the one that holds the hold's first day, the median running minutes of up to
 * `a5.typicalWeekCount` earlier weeks with a run, as the athlete state counts it for a break.
 * `volumeOf` gives a week's minutes by Monday, or `undefined` for a week not known, which ends the
 * look back. 0 when no earlier week has a run; the caller then falls back to the week itself.
 */
export function holdReference(
  hold: Pick<HoldRun, 'from'>,
  volumeOf: (weekStart: string) => number | undefined,
): number {
  const wanted = P.a5.typicalWeekCount.value
  const limit = Math.ceil(P.a5.historyWindowDays.value / DAYS_PER_WEEK)
  const first = mondayOf(hold.from)
  const found: number[] = []
  for (let back = 1; back <= limit && found.length < wanted; back += 1) {
    const volume = volumeOf(addDays(first, -DAYS_PER_WEEK * back))
    if (volume === undefined) break
    if (volume > 0) found.push(volume)
  }
  return found.length === 0 ? 0 : Math.round(medianOf(found))
}

export interface WeekCap {
  weekStart: string
  /**
   * The most working minutes the week may hold, never negative; null when only day rules apply (a
   * capped day without the plan's minutes by date, or a quiet day).
   */
  capMin: number | null
  heldDays: number
  openDays: number
  /** The J7 fraction behind a return cap; 1 otherwise. */
  fraction: number
  /** `disrupted`: a window touches a day of the week. `disruption-return`: a restart cap applies. */
  flags: WeekFlag[]
}

const finiteMin = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0)
const wholeMin = (value: number): number => Math.max(0, Math.floor(value + 1e-9))

/**
 * The cap a week takes from the windows [rule J9], or null when no window touches it. Minutes are
 * lost, never moved [G-6]:
 * - a week with held days holds the plan's minutes on its open days, so the days a window holds
 *   cost what the plan had on them, and a capped day the minutes it had above its cap;
 * - the return week after a hold of `j7.tier1Days` or more holds the reference week times the J7
 *   fraction, prorated by its open days, and the first full week after it the whole fraction (a
 *   single low week would let the next return to 110% of the week before the window).
 * The smallest cap applies. The caps are whole minutes rounded down.
 */
export function disruptionWeekCap(
  plan: DisruptionPlan,
  weekStart: string,
  basis: WeekBasis,
): WeekCap | null {
  const dates = Array.from({ length: DAYS_PER_WEEK }, (_, k) => addDays(weekStart, k))
  const held = dates.filter((d) => dayRuleOn(plan, d)?.held === true)
  const touched = dates.some((d) => dayRuleOn(plan, d) !== null)
  const openDays = DAYS_PER_WEEK - held.length
  const baselineMin = finiteMin(basis.baselineMin)
  const referenceMin = finiteMin(basis.referenceMin)
  const caps: number[] = []
  let fraction = 1
  const flags: WeekFlag[] = []

  const byDate = basis.minByDate
  const limited = dates.flatMap((d) => {
    const rule = dayRuleOn(plan, d)
    return rule !== null && !rule.held && rule.maxRunMin !== null
      ? [{ date: d, maxRunMin: rule.maxRunMin }]
      : []
  })
  if (held.length > 0 || (byDate !== undefined && limited.length > 0)) {
    const heldLost =
      byDate === undefined
        ? (baselineMin * held.length) / DAYS_PER_WEEK
        : held.reduce((sum, d) => sum + finiteMin(byDate[d] ?? 0), 0)
    // minutes above the cap of a capped day are lost too, and never made up on another day [G-6]
    const cappedLost =
      byDate === undefined
        ? 0
        : limited.reduce(
            (sum, l) => sum + Math.max(0, finiteMin(byDate[l.date] ?? 0) - l.maxRunMin),
            0,
          )
    caps.push(wholeMin(baselineMin - heldLost - cappedLost))
  }
  for (const run of plan.holds) {
    if (run.fraction >= 1) continue
    if (weekStart === run.returnWeekStart) {
      caps.push(wholeMin((referenceMin * run.fraction * openDays) / DAYS_PER_WEEK))
    } else if (weekStart === run.fullWeekStart) {
      caps.push(wholeMin(referenceMin * run.fraction))
    } else {
      continue
    }
    fraction = Math.min(fraction, run.fraction)
    if (!flags.includes('disruption-return')) flags.push('disruption-return')
  }
  if (touched) flags.unshift('disrupted')
  if (caps.length === 0 && flags.length === 0) return null
  return {
    weekStart,
    capMin: caps.length === 0 ? null : Math.min(...caps),
    heldDays: held.length,
    openDays,
    fraction,
    flags,
  }
}

// ---------------------------------------------------------------------------------------------
// Rest sessions
// ---------------------------------------------------------------------------------------------

/** How a reason reads in a title: "Rest: illness". */
const REST_WORD: Record<DisruptionReason, string> = {
  'illness-above-neck': 'illness',
  'illness-below-neck': 'illness',
  niggle: 'niggle',
  'short-on-time': 'short on time',
  travel: 'travel',
}

/**
 * One rest session for each held date in `range`, ascending: kind `rest`, no minutes, the flag
 * `rest-window` and the rules of the window [rules J9, G-6]. The words carry no numbers; the
 * counts of n-3 are stated by the window copy, from the Params.
 */
export function restSessions(plan: DisruptionPlan, range: DateRange = {}): SessionSpec[] {
  return plan.days
    .filter((rule) => rule.held && inRange(rule.date, range))
    .map((rule): SessionSpec => {
      const illness = isIllness(rule.reason)
      return {
        date: rule.date,
        order: 0,
        kind: 'rest',
        title: `Rest: ${REST_WORD[rule.reason]}`,
        durationMin: 0,
        distanceM: null,
        gainM: null,
        structure: [],
        target: {
          zone: 'rest',
          rpe: [...P.expectedRpe.rest.value],
          hr: null,
          paceSecPerKm: null,
          heatNote: null,
        },
        purpose: rule.gate
          ? 'Rest through the first symptom-free day. Easy running follows before any hard session.'
          : 'A rest window you set covers this day. Minutes you rest are not added back later.',
        rules: illness ? ['J9', 'n-3', 'g-6'] : ['J9', 'g-6'],
        flags: ['rest-window'],
      }
    })
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/** What a request for a new or changed window carries. */
export interface DisruptionDraft {
  reason: DisruptionReason
  mode: DisruptionMode
  startDate: string
  endDate: string
  maxRunMin?: number | null
  area?: string | null
  pain?: number | null
  gaitChange?: boolean
}

export type DisruptionField =
  'startDate' | 'endDate' | 'mode' | 'maxRunMin' | 'area' | 'pain' | 'gaitChange'

export type DisruptionIssueCode =
  | 'start-invalid'
  | 'end-invalid'
  | 'end-before-start'
  | 'too-long'
  | 'start-too-old'
  | 'end-after-goal'
  | 'illness-rest-only'
  | 'cap-required'
  | 'cap-out-of-range'
  | 'cap-on-rest'
  | 'niggle-only'
  | 'pain-out-of-range'

/** One refused rule: a code and the field it names. The words are `describeIssue`'s. */
export interface DisruptionIssue {
  code: DisruptionIssueCode
  field: DisruptionField
}

/**
 * The body rules of a window [rule J9]: illness is rest only; `limited` needs a cap of
 * `P.fplace.easyRunMinMin` to `RUN_CAP_MAX_MIN` minutes and `rest` has none; only a niggle takes
 * area, pain and gait change; at most `j9.maxWindowDays` long; no earlier than
 * `j9.maxBackdateDays` before today; ending no later than the goal date. Returns every issue, in
 * the order of the fields; an empty list means the window is valid.
 */
export function validateDisruption(
  draft: DisruptionDraft,
  context: { today: string; goalDate: string | null },
): DisruptionIssue[] {
  const issues: DisruptionIssue[] = []
  const add = (code: DisruptionIssueCode, field: DisruptionField) => issues.push({ code, field })

  const startOk = isIsoDate(draft.startDate)
  const endOk = isIsoDate(draft.endDate)
  if (!startOk) add('start-invalid', 'startDate')
  if (!endOk) add('end-invalid', 'endDate')
  if (startOk && endOk) {
    if (draft.endDate < draft.startDate) add('end-before-start', 'endDate')
    else if (daysBetween(draft.startDate, draft.endDate) + 1 > P.j9.maxWindowDays.value) {
      add('too-long', 'endDate')
    }
  }
  if (startOk && draft.startDate < addDays(context.today, -P.j9.maxBackdateDays.value)) {
    add('start-too-old', 'startDate')
  }
  if (endOk && context.goalDate !== null && draft.endDate > context.goalDate) {
    add('end-after-goal', 'endDate')
  }

  if (isIllness(draft.reason) && draft.mode !== 'rest') add('illness-rest-only', 'mode')
  if (draft.mode === 'limited') {
    const cap = draft.maxRunMin
    if (cap === null || cap === undefined) add('cap-required', 'maxRunMin')
    else if (
      !Number.isInteger(cap) ||
      cap < P.fplace.easyRunMinMin.value ||
      cap > RUN_CAP_MAX_MIN
    ) {
      add('cap-out-of-range', 'maxRunMin')
    }
  } else if (draft.maxRunMin !== null && draft.maxRunMin !== undefined) {
    add('cap-on-rest', 'maxRunMin')
  }

  if (draft.reason === 'niggle') {
    const pain = draft.pain
    if (
      pain !== null &&
      pain !== undefined &&
      (!Number.isInteger(pain) || pain < 0 || pain > PAIN_SCALE_MAX)
    ) {
      add('pain-out-of-range', 'pain')
    }
  } else {
    if (typeof draft.area === 'string' && draft.area.trim() !== '') add('niggle-only', 'area')
    if (draft.pain !== null && draft.pain !== undefined) add('niggle-only', 'pain')
    if (draft.gaitChange === true) add('niggle-only', 'gaitChange')
  }
  return issues
}

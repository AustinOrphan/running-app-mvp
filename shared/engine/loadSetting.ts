// The load setting of a plan [rules g-8]: which position applies to a runner today, and why a
// requested one does not, the rebuild zone it sets, the mean of the weeks run that its response to
// weeks run above plan reads, plus the 3 x 30 start from a block of weeks (the second route of E6
// path 2). Pure: the same input gives the same answer. It reads the athlete state and the input's
// windows and imports no macro code, so the generator, the guards, the checklist and the
// explanations can all read it.
import { addDays, mondayOf } from '../dates.ts'
import { ageFlag, historyBlock, historyRowCount, weekRowsBetween } from './athlete.ts'
import { disruptionPlan, windowPhase } from './disruption.ts'
import { persistentHoldOf, type PersistentHold } from './holds.ts'
import {
  ceilingWeeklyRate,
  EPS,
  eligibleWeeks,
  plannedMinOf,
  recentRunMean,
  type RebuildZone,
  type ResponseBasis,
} from './limits.ts'
import { P } from './params/index.ts'
import { postRaceWindows } from './postRace.ts'
import {
  isLoadAppetite,
  type AthleteState,
  type EngineInput,
  type HistoryBlock,
  type LoadAppetite,
} from './types.ts'

/**
 * Why a requested position does not apply: the plan is held at steady for as long as it lasts, and
 * the setting returns when it ends. The first that applies is named, in this order.
 */
export type LoadHold = PersistentHold | 'rest-window' | 'post-race'

export interface LoadPosition {
  /** What the plan asks for (`options.loadAppetite`); steady when the option is absent. */
  requested: LoadAppetite
  /** What applies today. */
  position: LoadAppetite
  /** Why `requested` was held at steady; null when it was not, and always null for steady itself. */
  held: LoadHold | null
  /** Upper band was requested and is read as standard because of age (45 or over). */
  ageCapped: boolean
}

/** True while a reported rest or limited-running window has started and its return is not over. */
function restWindowActive(input: EngineInput): boolean {
  const plan = disruptionPlan(input.disruptions ?? [])
  return plan.windows.some((w) => {
    const phase = windowPhase(w, input.today)
    return phase !== 'upcoming' && phase !== 'done'
  })
}

/** The first reason that holds the setting at steady for this runner today, or null. */
function holdOf(input: EngineInput, state: AthleteState): LoadHold | null {
  const persistent = persistentHoldOf(input, state)
  if (persistent !== null) return persistent
  if (restWindowActive(input)) return 'rest-window'
  // a plan built inside the window of a past race: the goal race's own window is ahead of the plan
  if (postRaceWindows(input).past !== null) return 'post-race'
  return null
}

/**
 * The position that applies to this runner today [rules g-8]. Steady is today's engine. Standard
 * and upper are held at steady under a recent injury (or a window's injury report), an earlier
 * bone stress injury or two BSI factors, a REDs hold or focal bone pain, a rest window, and a plan
 * built inside the window of a past race. A low-frequency runner (A5) is not held: the flag keeps
 * the 2:1 cadence and the time-based step, and the zone, the 3 x 30 lift and the response each
 * ask for a block or eligible weeks of their own. At age 45 or over upper is read as standard.
 * Absent options, steady and a value that is no position give the same answer.
 */
export function loadPosition(input: EngineInput, state: AthleteState): LoadPosition {
  const requested = isLoadAppetite(input.options.loadAppetite)
    ? input.options.loadAppetite
    : 'steady'
  if (requested === 'steady') {
    return { requested, position: 'steady', held: null, ageCapped: false }
  }
  const held = holdOf(input, state)
  if (held !== null) return { requested, position: 'steady', held, ageCapped: false }
  const aged = state.age !== null && state.age >= P.a9.noviceFlagAgeMin.value
  const ageCapped = requested === 'upper' && aged
  return { requested, position: ageCapped ? 'standard' : requested, held: null, ageCapped }
}

/**
 * The most a week may add to the one before it at a position [rules g-8]: the soft step
 * (`g2.rampSoft`) at steady, `g8.stepStandard` at standard and the weekly rate at which two weeks
 * meet the hard ceiling at upper (`ceilingWeeklyRate`). The one place the three are named, for the
 * rebuild zone and for the copy that states them next to the choice.
 */
export function positionStep(position: LoadAppetite): number {
  if (position === 'upper') return ceilingWeeklyRate()
  return position === 'standard' ? P.g8.stepStandard.value : P.g2.rampSoft.value
}

/**
 * The Monday of the first week of the plan being continued [rules g-8], or null when the plan is
 * not continued: a new plan, or a re-plan whose stored plan lacks the current week, or one that
 * restarts after a break of `j7.tier1Days` or more. A continued plan is the one the runner is
 * following, so it has planned minutes to be run above (`responseBasis`) and a block it opened
 * with (`creditedBlock`). A re-plan keeps the weeks before the current one, so the first Monday is
 * the earliest week of the stored plan.
 */
function continuedSince(input: EngineInput, state: AthleteState): string | null {
  const weeks = input.existing?.weeks ?? []
  const currentMonday = mondayOf(input.today)
  if (!weeks.some((week) => week.weekStart === currentMonday)) return null
  if (state.layoffDays >= P.j7.tier1Days.value) return null
  return weeks.reduce(
    (first, week) => (week.weekStart < first ? week.weekStart : first),
    currentMonday,
  )
}

/** The history block the rebuild zone reads, and, for a continued plan, the Monday it was found at. */
export interface ZoneBlock {
  block: HistoryBlock
  /**
   * The first Monday of the plan, when the block is the one found there and kept (`weeksAgo` and
   * `taper` are those of that Monday); null when it is the block of the athlete state at today.
   */
  keptSince: string | null
}

/**
 * The block the rebuild zone reads [rules g-8]. For a plan that is being continued it is the block
 * found at the plan's first Monday, with its taper factor, until a complete week since that Monday
 * has run at or above R of that block (`credit` x taper x H); from then on, and for a new plan or
 * one that restarts after a break, it is the block of the athlete state at today. Reason: the
 * block leaves the credit window while the rebuild is under way (about six weeks in on the
 * appendix runner of the proposal), and the weeks run since form a new, lower block, so R would
 * fall while the runner follows the plan; the plan keeps the credit it opened with until the
 * rebuild has reached its ceiling, and the weeks run since are then the runner's new level. A plan
 * that found no block at its first Monday keeps nothing, and the block of the state applies. Null
 * without a block.
 *
 * The block at the first Monday is found by the one block finder (`historyBlock`) from the weekly
 * rows of the activities the snapshot already holds (ADR 0009). The input's activities reach back a
 * year (`a5.historyWindowDays`), so they hold the rows only of a plan younger than that year less
 * the weeks the finder reads before the first Monday; an older continued plan has no block in reach
 * and falls back to the block of the state, as does a plan that opens in the current week (the same
 * block). The one place the block of the zone is chosen: `rebuildZone` and the Why drawer read it
 * here.
 */
function creditedBlock(input: EngineInput, state: AthleteState, credit: number): ZoneBlock | null {
  const own = state.history === null ? null : { block: state.history, keptSince: null }
  const first = continuedSince(input, state)
  const currentMonday = mondayOf(input.today)
  if (first === null || first >= currentMonday) return own
  const from = addDays(first, -7 * (historyRowCount() - 1))
  if (from < addDays(input.today, -P.a5.historyWindowDays.value)) return own
  const rows = weekRowsBetween(input, from, currentMonday)
  const opened = historyBlock(rows, undefined, first)
  if (opened === null) return own
  const ceiling = credit * opened.taper * opened.blockMin
  const reached = rows.some(
    (row) => row.weekStart >= first && row.weekStart < currentMonday && row.runMin + EPS >= ceiling,
  )
  return reached ? own : { block: opened, keptSince: first }
}

/** The credit of a position that has a zone: `g8.creditUpper` at upper, else `g8.creditStandard`. */
const creditOf = (position: LoadAppetite): number =>
  position === 'upper' ? P.g8.creditUpper.value : P.g8.creditStandard.value

/**
 * The block the rebuild zone of this plan reads at standard and upper (`creditedBlock`). At steady
 * and wherever `loadPosition` holds the setting at steady no zone is built, and the block of the
 * athlete state is returned, as the figure the engine read. Null without a block.
 */
export function zoneBlock(input: EngineInput, state: AthleteState): ZoneBlock | null {
  const { position } = loadPosition(input, state)
  if (position !== 'standard' && position !== 'upper') {
    return state.history === null ? null : { block: state.history, keptSince: null }
  }
  return creditedBlock(input, state, creditOf(position))
}

/**
 * The rebuild zone of the plan [rules g-8]: the ceiling R = credit x taper x H and the position's
 * weekly step, or null when there is none. Null at steady, wherever `loadPosition` holds the
 * setting at steady, and without a history block. At standard the credit is `g8.creditStandard` and
 * the step `g8.stepStandard`; at upper the credit is `g8.creditUpper` and the step the weekly rate
 * at which two weeks meet the hard ceiling (`ceilingWeeklyRate`); upper read as standard because of
 * age takes the standard values. H is the score of the block and the taper its factor
 * (`HistoryBlock`), 1 for a block that ended within `g8.creditWindowWeeks`; a plan that is being
 * continued keeps the block it opened with until a week has reached R (`creditedBlock`). The one
 * place the zone is built: the macrocycle, the week placement, the guards, the checklist and the
 * weekly decision all receive it from here.
 */
export function rebuildZone(input: EngineInput, state: AthleteState): RebuildZone | null {
  const { position } = loadPosition(input, state)
  if (position !== 'standard' && position !== 'upper') return null
  const credit = creditOf(position)
  const credited = creditedBlock(input, state, credit)
  if (credited === null) return null
  return {
    ceilingMin: credit * credited.block.taper * credited.block.blockMin,
    step: positionStep(position),
  }
}

/**
 * The Mondays of the weeks a reported rest window touches [rules J9]: every week that holds a day of
 * a window (its rest, its limited running and the easy days after it) or of an injury report. The
 * windows of the input are read whether they lie in the past or ahead.
 */
function restWindowWeeks(input: EngineInput): Set<string> {
  const plan = disruptionPlan(input.disruptions ?? [])
  const weeks = new Set<string>()
  for (const day of plan.days) weeks.add(mondayOf(day.date))
  for (const report of plan.injuryReports) {
    for (let week = mondayOf(report.from); week <= report.until; week = addDays(week, 7)) {
      weeks.add(week)
    }
  }
  return weeks
}

/**
 * The response to weeks run above plan [rules g-8]: the mean of the minutes run over the last
 * `g8.responseWeeks` eligible complete weeks, or null when the response does not apply. It applies
 * to a plan that is being continued (`continuedSince`): a new plan, or one that restarts after a
 * break, starts from the weeks as run (E6, J7) and has no planned minutes to be run above. Null at
 * steady and wherever `loadPosition` holds the setting at steady (so a plan inside an active
 * window or a post-race window, or under a progression hold, has no response). Weeks that never
 * count: those that hold a race (`raceMin`) and those inside a rest window or an injury report,
 * skipped and not zeroed; the current week is not complete. It needs no history block.
 *
 * The response applies only when the newest eligible week, the first of the mean's window, was run
 * at or above the minutes the stored plan held for it (`plannedMinOf`: a week taken as run past its
 * target is held at the minutes it was planned at, not at the minutes run): a week run under its
 * target is missed training, which lowers the plan (G-2, G-6) and is never a reason to lift it,
 * and the hold decision that follows such a week keeps its effect. A newest week the stored plan
 * did not hold has no target to be run against and gives no response either. In both cases the
 * position applies and `meanMin` is null. The one place the response is built: the macrocycle, the
 * week placement, the guards and the checklist all receive it from here.
 */
export function responseBasis(input: EngineInput, state: AthleteState): ResponseBasis | null {
  if (continuedSince(input, state) === null) return null
  if (loadPosition(input, state).position === 'steady') return null
  const currentMonday = mondayOf(input.today)
  const excluded = restWindowWeeks(input)
  for (const row of state.weeks) if (row.raceMin > 0) excluded.add(row.weekStart)
  const newest = eligibleWeeks(state.weeks, excluded, currentMonday)[0]
  const stored = input.existing?.weeks.find((week) => week.weekStart === newest?.weekStart)
  if (newest === undefined || stored === undefined) return { meanMin: null }
  if (newest.runMin + EPS < plannedMinOf(stored)) return { meanMin: null }
  return { meanMin: recentRunMean(state.weeks, excluded, currentMonday) }
}

/**
 * The weekly minutes a history block must reach for the second route to a start of 3 x 30 minutes:
 * `restartFloor.sessions` x `restartFloor.sessionMaxMin`. The one place the threshold is written,
 * for the route (`blockLift`) and the sentence that states it.
 */
export const blockLiftMin = (): number =>
  P.restartFloor.sessions.value * P.restartFloor.sessionMaxMin.value

/**
 * The second route to a start of 3 x 30 minutes [rules E6, g-8]: a year of running and a block of
 * steady weeks whose mean without the highest (`g8.blockWeeksDropped`) is at least 3 x 30 minutes a
 * week and that ended within `g8.creditWindowWeeks` (`HistoryBlock.fullCreditMin`, whichever credit
 * window ships), at a position other than steady.
 * Soft start flags other than age hold it back, as do all the profiles `loadPosition` holds at
 * steady; at age 45 or over it stays open (the years route keeps its age rule). It lifts nothing
 * else: the start still takes the runner's own longest run of the last 30 days, and G-1 bounds it.
 */
export function blockLift(input: EngineInput, state: AthleteState): boolean {
  if (loadPosition(input, state).position === 'steady') return false
  if (state.yearsRunning === null || state.yearsRunning < P.a5.noviceMaxYears.value) return false
  if (state.risk.noviceFlags.some((flag) => flag !== ageFlag())) return false
  return state.history !== null && state.history.fullCreditMin >= blockLiftMin()
}

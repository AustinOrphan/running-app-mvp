// The load setting of a plan [rules g-8]: which position applies to a runner today, and why a
// requested one does not, the rebuild zone it sets, the mean of the weeks run that its response to
// weeks run above plan reads, plus the 3 x 30 start from a block of weeks (the second route of E6
// path 2). Pure: the same input gives the same answer. It reads the athlete state and the input's
// windows and imports no macro code, so the generator, the guards, the checklist and the
// explanations can all read it.
import { addDays, mondayOf } from '../dates.ts'
import { ageFlag } from './athlete.ts'
import { disruptionPlan, windowPhase } from './disruption.ts'
import {
  ceilingWeeklyRate,
  injuryTight,
  recentRunMean,
  type RebuildZone,
  type ResponseBasis,
} from './limits.ts'
import { P } from './params/index.ts'
import { postRaceWindows } from './postRace.ts'
import { focalBoneActive } from './readiness.ts'
import type { AthleteState, EngineInput, LoadAppetite } from './types.ts'

/**
 * Why a requested position does not apply: the plan is held at steady for as long as it lasts, and
 * the setting returns when it ends. The first that applies is named, in this order.
 */
export type LoadHold =
  | 'recent-injury'
  | 'bone-stress'
  | 'bsi-factors'
  | 'reds-hold'
  | 'bone-pain'
  | 'rest-window'
  | 'post-race'
  | 'low-frequency'

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
  if (injuryTight(state)) return 'recent-injury'
  if (state.risk.priorBsi) return 'bone-stress'
  if (state.risk.bsiFactors >= P.g3.bsiFactorsForCap.value) return 'bsi-factors'
  if (state.risk.redsFlags >= P.j5.redsHoldFlags.value) return 'reds-hold'
  if (focalBoneActive(input, input.today)) return 'bone-pain'
  if (restWindowActive(input)) return 'rest-window'
  // a plan built inside the window of a past race: the goal race's own window is ahead of the plan
  if (postRaceWindows(input).past !== null) return 'post-race'
  if (state.lowFrequency) return 'low-frequency'
  return null
}

/**
 * The position that applies to this runner today [rules g-8]. Steady is today's engine. Standard
 * and upper are held at steady under a recent injury (or a window's injury report), an earlier
 * bone stress injury or two BSI factors, a REDs hold or focal bone pain, a rest window, a plan
 * built inside the window of a past race, and a low-frequency runner. At age 45 or over upper is
 * read as standard. Absent options and steady give the same answer.
 */
export function loadPosition(input: EngineInput, state: AthleteState): LoadPosition {
  const requested = input.options.loadAppetite ?? 'steady'
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
 * The rebuild zone of the plan [rules g-8]: the ceiling R = credit x taper x H and the position's
 * weekly step, or null when there is none. Null at steady, wherever `loadPosition` holds the
 * setting at steady, and without a history block. At standard the credit is `g8.creditStandard` and
 * the step `g8.stepStandard`; at upper the credit is `g8.creditUpper` and the step the weekly rate
 * at which two weeks meet the hard ceiling (`ceilingWeeklyRate`); upper read as standard because of
 * age takes the standard values. H is the score of the winning block and the taper its factor
 * (`HistoryBlock`), 1 for a block that ended within `g8.creditWindowWeeks`. The one place the zone
 * is built: the macrocycle, the week placement, the guards, the checklist and the weekly decision
 * all receive it from here.
 */
export function rebuildZone(input: EngineInput, state: AthleteState): RebuildZone | null {
  const { position } = loadPosition(input, state)
  if ((position !== 'standard' && position !== 'upper') || state.history === null) return null
  const upper = position === 'upper'
  const credit = upper ? P.g8.creditUpper.value : P.g8.creditStandard.value
  return {
    ceilingMin: credit * state.history.taper * state.history.blockMin,
    step: upper ? ceilingWeeklyRate() : P.g8.stepStandard.value,
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
 * to a plan that is being continued, that is a re-plan whose stored plan holds the current week
 * after a break shorter than `j7.tier1Days`: a new plan, or one that restarts after a break,
 * starts from the weeks as run (E6, J7) and has no planned minutes to be run above. Null at steady
 * and wherever `loadPosition` holds the setting at steady (so a plan inside an active window or a
 * post-race window, under a progression hold or for a low-frequency runner has no response). Weeks
 * that never count: those that hold a race (`raceMin`) and those inside a rest window or an injury
 * report, skipped and not zeroed; the current week is not complete. It needs no history block. The
 * one place the response is built: the macrocycle, the week placement, the guards and the
 * checklist all receive it from here.
 */
export function responseBasis(input: EngineInput, state: AthleteState): ResponseBasis | null {
  const currentMonday = mondayOf(input.today)
  const continued = input.existing?.weeks.some((week) => week.weekStart === currentMonday)
  if (continued !== true || state.layoffDays >= P.j7.tier1Days.value) return null
  if (loadPosition(input, state).position === 'steady') return null
  const excluded = restWindowWeeks(input)
  for (const row of state.weeks) if (row.raceMin > 0) excluded.add(row.weekStart)
  return { meanMin: recentRunMean(state.weeks, excluded, currentMonday) }
}

/**
 * The second route to a start of 3 x 30 minutes [rules E6, g-8]: a year of running and a block of
 * steady weeks that averaged at least 3 x 30 minutes a week and ended within `g8.creditWindowWeeks`
 * (`HistoryBlock.fullCreditMin`, whichever credit window ships), at a position other than steady.
 * Soft start flags other than age hold it back, as do all the profiles `loadPosition` holds at
 * steady; at age 45 or over it stays open (the years route keeps its age rule). It lifts nothing
 * else: the start still takes the runner's own longest run of the last 30 days, and G-1 bounds it.
 */
export function blockLift(input: EngineInput, state: AthleteState): boolean {
  if (loadPosition(input, state).position === 'steady') return false
  if (state.yearsRunning === null || state.yearsRunning < P.a5.noviceMaxYears.value) return false
  if (state.risk.noviceFlags.some((flag) => flag !== ageFlag())) return false
  const needed = P.restartFloor.sessions.value * P.restartFloor.sessionMaxMin.value
  return state.history !== null && state.history.fullCreditMin >= needed
}

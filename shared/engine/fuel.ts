// The personal fuel ladder (phase 3a design, section 10.5; rule H7 and H8; ADR 0011). The fuel
// target is one rung of a ladder that `replayLadder` rebuilds from the runner's logs on every read:
// the floor (30-50 g/h), then 60, then steps of 10 g/h to 90 (opt-in), then up to 120 (a second
// opt-in, low certainty). The position on the ladder is never stored, so an edited activity, a late
// weather fill, a confirmed duplicate or a deleted log takes effect on the next read.
//
// The ladder changes the fuel line only, never a session, and a language model writes none of it
// (ADR 0005, 0011). Pure and deterministic: no clock, no I/O; the days and the weather arrive as
// data. Every number comes from the registry `P`.
import { mondayOf } from '../dates.ts'
import { fuelTotals, minutesOf, multiCarbShare, ratePerHour } from '../domain/fuel.ts'
import { isToRun } from '../domain/sessionStatus.ts'
import { eahText, fuelWatchText } from './fuelCopy.ts'
import { weatherIndex, type WeatherIndex } from './heat.ts'
import { P } from './params/index.ts'
import type {
  CountReason,
  EahCard,
  FuelBasis,
  FuelRung,
  FuelRungView,
  FuelRunInput,
  FuelSessionInput,
  FuelSettingsInput,
  FuelTarget,
  LadderBasis,
  LadderResult,
  LadderStep,
  RunWeather,
  RungRate,
  RungState,
  SessionFlag,
  SessionKind,
  StepOutcome,
} from './types.ts'

// ---------------------------------------------------------------------------------------------
// Rungs and the ceiling the settings open
// ---------------------------------------------------------------------------------------------

/**
 * The rungs, floor first: the floor (its low end is the rate a run must reach), the first higher
 * tier, then steps of `h7.gutStepGPerH` up to the top of the advanced range. Rungs up to the second
 * tier open with the first opt-in and the rungs above it with the second. The grade of a rung is
 * the grade of the Param that names it; the steps between are the step Param's grade.
 */
export function fuelRungs(): FuelRung[] {
  const [floorLow, floorHigh] = P.h7.carbFloorGPerH.value
  const tier1 = P.h7.carbTier1GPerH
  const tier2 = P.h7.carbTier2GPerH
  const top = P.h7.carbAdvancedGPerH.value[1]
  const step = P.h7.gutStepGPerH
  const higher = Math.floor((top - tier1.value) / step.value) + 1
  const rungs: FuelRung[] = [
    {
      index: 0,
      gPerH: floorLow,
      range: [floorLow, floorHigh],
      grade: P.h7.carbFloorGPerH.grade,
      lowCertainty: false,
      multiCarbRequired: false,
      opens: 'always',
    },
  ]
  for (let i = 0; i < higher; i++) {
    const gPerH = tier1.value + i * step.value
    rungs.push({
      index: rungs.length,
      gPerH,
      range: null,
      grade:
        gPerH === tier1.value
          ? tier1.grade
          : gPerH === tier2.value
            ? tier2.grade
            : gPerH === top
              ? P.h7.carbAdvancedGPerH.grade
              : step.grade,
      lowCertainty: true,
      multiCarbRequired: gPerH > tier1.value,
      opens:
        gPerH <= tier1.value ? 'always' : gPerH <= tier2.value ? 'first-opt-in' : 'second-opt-in',
    })
  }
  return rungs
}

function rungAt(rungs: readonly FuelRung[], index: number): FuelRung {
  const rung = rungs[index]
  if (rung === undefined) throw new RangeError(`There is no fuel rung ${String(index)}.`)
  return rung
}

const rateOf = (rung: FuelRung): RungRate => ({ gPerH: rung.gPerH, range: rung.range })

/**
 * The highest rung the settings open. A diagnosed gut condition keeps the floor; without an opt-in
 * the first higher tier is the top; the first opt-in opens up to the second tier and the second
 * opt-in, which needs the first, opens the rest. Opting out clamps the ladder at once, because the
 * replay always runs under the current settings.
 */
export function ceilingIndex(settings: FuelSettingsInput): number {
  const rungs = fuelRungs()
  if (settings.giDisease) return 0
  if (settings.optIn90 && settings.optInAdvanced) return rungs.length - 1
  const limit = settings.optIn90 ? P.h7.carbTier2GPerH.value : P.h7.carbTier1GPerH.value
  return rungs.findLastIndex((rung) => rung.gPerH <= limit)
}

// ---------------------------------------------------------------------------------------------
// One run: its score, whether it was a gut-training run, whether it was hot
// ---------------------------------------------------------------------------------------------

/**
 * A run's score: the higher of its gut and nausea scores on the 0-4 scale (rule H7 stops when any
 * symptom scores 2 or more). A score that is not a number counts as the worst, the cautious side.
 */
export function runScore(log: { gut: number; nausea: number | null }): number {
  const max = P.h7.gutSymptomScaleMax.value
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : max)
  return Math.max(clamp(log.gut), log.nausea === null ? 0 : clamp(log.nausea))
}

/**
 * Whether a run belongs to a gut-training block: a run linked to a plan session follows that
 * session's `fuel-practice` flag; a run the app did not link counts when its date falls in a week
 * with the `gut-training` flag (`gutTrainingWeeks` holds those weeks' Mondays).
 */
export function isBlockRun(
  run: { date: string; sessionFlags: readonly SessionFlag[] | null },
  gutTrainingWeeks: readonly string[],
): boolean {
  if (run.sessionFlags !== null) return run.sessionFlags.includes('fuel-practice')
  return gutTrainingWeeks.includes(mondayOf(run.date))
}

/**
 * Whether a day is hot for fuel: its warmest hour is a WBGT of `h7.hotDayWbgtC` or more, or, when
 * there is no WBGT, an air temperature of `h7.hotDayAirTempC` or more. This is not the heat-steering
 * threshold (`isHotForSteering`, `i9.warnWbgtC`): holding a fuel step on a warm day and dropping a
 * heart-rate ceiling are different questions, so a day can be hot for fuel and not for steering.
 */
export function isHotForFuel(peak: WeatherIndex | null): boolean {
  if (peak === null) return false
  const limit = peak.index === 'wbgt' ? P.h7.hotDayWbgtC.value : P.h7.hotDayAirTempC.value
  return peak.value >= limit
}

/**
 * Whether a run was hot, judged by the weather it has now and not by a flag fixed when the log was
 * saved, because the weather often loads after the log (ADR 0011). The runner's own yes or no wins.
 * With no weather the run is not hot; it is judged again when the weather arrives. WBGT uses the
 * run's temperature and humidity with the wind and the shade assumption of the execution model,
 * since activities store no solar radiation.
 */
export function runIsHot(weather: RunWeather | null, override: boolean | null): boolean {
  if (override !== null) return override
  if (weather === null || weather.tempC === null) return false
  return isHotForFuel(
    weatherIndex({
      tempC: weather.tempC,
      humidityPct: weather.humidityPct,
      windKph: weather.windKph ?? 0,
      shortwaveWm2: weather.shortwaveWm2 ?? P.conditions.assumedShortwaveWm2.value,
    }),
  )
}

/**
 * Whether a run of this many minutes can be logged and counted, or a planned run can carry a
 * target: `h7.logMinDurationMin` or more, or `h7.gutTrainingSessionMinMin` or more in a
 * gut-training block.
 */
export function fuelEligible(minutes: number, block: boolean): boolean {
  return minutes >= requiredMinutes(block)
}

function requiredMinutes(block: boolean): number {
  return block ? P.h7.gutTrainingSessionMinMin.value : P.h7.logMinDurationMin.value
}

// ---------------------------------------------------------------------------------------------
// The replay
// ---------------------------------------------------------------------------------------------

export interface LadderInput {
  settings: FuelSettingsInput
  /** Every logged run, in any order: the replay sorts them. */
  runs: readonly FuelRunInput[]
  /** The Mondays of the weeks that carry the `gut-training` flag. */
  gutTrainingWeeks: readonly string[]
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Oldest first; the date, then the time of day, then the activity id, so the order is total. */
function compareRuns(a: FuelRunInput, b: FuelRunInput): number {
  return (
    compareText(a.date, b.date) ||
    compareText(a.startTime ?? '', b.startTime ?? '') ||
    compareText(a.activityId, b.activityId)
  )
}

function rungStates(
  rungs: readonly FuelRung[],
  settings: FuelSettingsInput,
  position: { target: number; tolerated: number; held: boolean; ceiling: number },
): FuelRungView[] {
  const { target, tolerated, held, ceiling } = position
  const tier2Index = rungs.findLastIndex((rung) => rung.gPerH <= P.h7.carbTier2GPerH.value)
  return rungs.map((rung): FuelRungView => {
    let state: RungState
    if (settings.giDisease && rung.index > 0) state = 'gut-condition'
    else if (rung.index === target && held) state = 'repeat'
    else if (rung.index <= tolerated) state = 'tolerated'
    else if (rung.index === target) state = 'next-up'
    else if (rung.index <= ceiling) state = 'later'
    else if (rung.index <= tier2Index) state = 'opt-in'
    else state = tolerated >= tier2Index ? 'opt-in' : 'opens-after-second-tier'
    return { ...rung, state }
  })
}

/**
 * Replays the ladder from the logged runs, oldest first, under the current settings.
 *
 * A run counts when it is not skipped, is long enough (`fuelEligible`; shorter in a gut-training
 * block), reaches `h7.rungReachFraction` of the rung being tried at its carbohydrate rate over
 * elapsed time and, above the first higher tier, took `h7.multiCarbMinShare` of its carbohydrate
 * from multiple-source products. A run that does not count moves nothing, and its step says why.
 *
 * A counted run scoring below `h7.gutStopScore` is tolerated. After `h7.stepUpToleratedRuns` in a
 * row the rung is marked tolerated and the target steps up one rung, up to the ceiling; a
 * tolerated run also lifts a hold. On a hot day (`runIsHot`) a tolerated run changes nothing: it
 * does not step up, does not mark the rung tolerated and does not lift a hold or end a row of runs
 * scored `h7.gutStopScore` or more. A counted run scoring that or more holds the rung;
 * `h7.gutStopConsecutiveSessions` of them in a row, or one scoring `h7.immediateFallbackScore`,
 * return the target to the last tolerated rung (the floor when none). Such a run on a hot day counts
 * just the same. Nothing decays with time. The nausea plan comes forward after a counted run whose
 * nausea score reached `h7.nauseaContingencyScore`.
 *
 * The result does not depend on the order of `runs`.
 */
export function replayLadder(input: LadderInput): LadderResult {
  const { settings } = input
  const rungs = fuelRungs()
  const ceiling = ceilingIndex(settings)

  let target = 0
  let tolerated = -1
  let held = false
  let badRuns = 0
  let toleratedRuns = 0
  let fellBack = false
  let nauseaForward = false
  let countedRuns = 0
  const steps: LadderStep[] = []

  for (const run of [...input.runs].sort(compareRuns)) {
    const rung = rungAt(rungs, target)
    const block = isBlockRun(run, input.gutTrainingWeeks)
    const hot = runIsHot(run.weather, run.log.hotOverride)
    const score = runScore(run.log)
    const rate = ratePerHour(fuelTotals(run.log.items).carbsG, run.elapsedSec)
    const share = multiCarbShare(run.log.items)

    let reason: CountReason = 'counted'
    if (run.log.skipped) reason = 'skipped'
    else if (!fuelEligible(minutesOf(run.elapsedSec), block)) reason = 'too-short'
    else if (rate === null || rate < P.h7.rungReachFraction.value * rung.gPerH) {
      reason = 'below-target'
    } else if (rung.multiCarbRequired && share < P.h7.multiCarbMinShare.value) {
      reason = 'too-little-multi-carb'
    }

    let outcome: StepOutcome = 'not-counted'
    let toleratedLeft: number | null = null
    if (reason === 'counted') {
      countedRuns += 1
      nauseaForward = (run.log.nausea ?? 0) >= P.h7.nauseaContingencyScore.value
      if (score >= P.h7.gutStopScore.value) {
        badRuns += 1
        toleratedRuns = 0
        held = true
        fellBack = false
        outcome = 'hold'
        if (
          score >= P.h7.immediateFallbackScore.value ||
          badRuns >= P.h7.gutStopConsecutiveSessions.value
        ) {
          target = Math.max(tolerated, 0)
          held = false
          badRuns = 0
          fellBack = true
          outcome = 'fall-back'
        }
      } else if (hot) {
        outcome = 'warm-tolerated'
      } else {
        badRuns = 0
        held = false
        fellBack = false
        toleratedRuns += 1
        if (toleratedRuns >= P.h7.stepUpToleratedRuns.value) {
          toleratedRuns = 0
          tolerated = target
          if (target < ceiling) {
            target += 1
            outcome = 'step-up'
          } else {
            outcome = 'tolerated-top'
          }
        } else {
          outcome = 'tolerated-more'
          toleratedLeft = P.h7.stepUpToleratedRuns.value - toleratedRuns
        }
      }
    }

    steps.push({
      activityId: run.activityId,
      date: run.date,
      rungIndex: rung.index,
      rung: rateOf(rung),
      nextIndex: target,
      next: rateOf(rungAt(rungs, target)),
      rateGPerH: rate,
      multiCarbShare: share,
      score,
      hot,
      reason,
      outcome,
      requiredMin: requiredMinutes(block),
      toleratedLeft,
      held,
    })
  }

  let basis: LadderBasis
  if (settings.giDisease) basis = 'locked'
  else if (held) basis = 'repeat'
  else if (target > tolerated) basis = tolerated < 0 ? 'start' : 'next-up'
  else basis = fellBack ? 'fell-back' : 'at-ceiling'

  return {
    rungs: rungStates(rungs, settings, { target, tolerated, held, ceiling }),
    currentIndex: target,
    toleratedIndex: tolerated,
    held,
    locked: settings.giDisease,
    ceilingIndex: ceiling,
    basis,
    nauseaForward,
    countedRuns,
    steps,
  }
}

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

/**
 * Plain data loaded once per request: the settings, the replayed ladder and the forecast's warmest
 * hour by date (`trainingHeatAdvice(...).peak`, E2-2; a date without a peak is not hot).
 * `loadFuelContext` in the server builds it; the functions below only read it.
 */
export interface FuelContext {
  settings: FuelSettingsInput
  ladder: LadderResult
  peaks: Readonly<Record<string, WeatherIndex | null>>
}

/** Kinds that can carry a fuel target. Typed as a full record, so a new kind must be classified. */
const FUEL_KINDS: Record<SessionKind, boolean> = {
  easy: true,
  recovery: true,
  long: true,
  'long-fast-finish': true,
  threshold: true,
  intervals: true,
  'race-pace': true,
  strides: true,
  hills: true,
  hike: true,
  b2b: true,
  strength: false,
  mobility: false,
  rest: false,
  race: false,
  cross: false,
}

/**
 * The fuel target of a session still to be run (`isToRun`: planned, moved, downgraded, and
 * adjusted once it exists), or null: a settled session, a race, a session that is not a run and a
 * run too short to carry one (`fuelEligible` over the planned minutes, with the `fuel-practice`
 * flag as the gut-training block).
 *
 * The target is the rung the ladder stands on. On a hot forecast it stays at the last tolerated
 * rung and does not step up, and the nausea plan comes forward. An eased or moved session keeps its
 * target, because it follows the session's minutes and its day.
 */
export function fuelTargetFor(ctx: FuelContext, session: FuelSessionInput): FuelTarget | null {
  if (!isToRun(session.status) || !FUEL_KINDS[session.kind]) return null
  if (!fuelEligible(session.durationMin, session.flags.includes('fuel-practice'))) return null

  const { ladder } = ctx
  const hot = isHotForFuel(ctx.peaks[session.date] ?? null)
  const settled = Math.max(ladder.toleratedIndex, 0)
  let rungIndex = ladder.currentIndex
  let basis: FuelBasis = ladder.basis
  let heldBack: RungRate | null = null
  if (hot && !ladder.locked) {
    if (ladder.currentIndex > settled) {
      heldBack = rateOf(rungAt(ladder.rungs, ladder.currentIndex))
      rungIndex = settled
      basis = ladder.held ? 'warm-repeat' : 'warm-held'
    } else {
      basis = 'warm-steady'
    }
  }

  const rung = rungAt(ladder.rungs, rungIndex)
  const lastTolerated =
    ladder.toleratedIndex < 0 ? null : rateOf(rungAt(ladder.rungs, ladder.toleratedIndex))
  return {
    sessionId: session.id,
    date: session.date,
    rungIndex,
    gPerH: rung.gPerH,
    range: rung.range,
    lowCertainty: rung.lowCertainty,
    multiCarbRequired: rung.multiCarbRequired,
    basis,
    lastTolerated,
    heldBack,
    hot,
    nauseaPlanForward: hot || ladder.nauseaForward,
    locked: ladder.locked,
  }
}

/** The targets of the sessions that have one, in the order given. */
export function fuelTargetsFor(
  ctx: FuelContext,
  sessions: readonly FuelSessionInput[],
): FuelTarget[] {
  return sessions.flatMap((session) => {
    const target = fuelTargetFor(ctx, session)
    return target === null ? [] : [target]
  })
}

/**
 * The line for the watch and the calendar description: the rate and "Drink to thirst." in at most
 * 60 characters, with no symptom words.
 */
export function fuelWatchLine(target: Pick<FuelTarget, 'gPerH' | 'range'>): string {
  return fuelWatchText(target)
}

/**
 * The fuel line of a session, or null when it has no target. Synchronous and pure: the call the
 * publish channel makes (E1) once `loadFuelContext` has read the data.
 */
export function fuelLineForSession(ctx: FuelContext, session: FuelSessionInput): string | null {
  const target = fuelTargetFor(ctx, session)
  return target === null ? null : fuelWatchLine(target)
}

/**
 * The safety card about drinking too much. The stronger variant is for an event longer than
 * `n7.eahStrongerAlertHours` (`eventHours`) or in heat.
 */
export function eahCard(options: { eventHours: number | null; hot: boolean }): EahCard {
  const stronger =
    options.hot ||
    (options.eventHours !== null && options.eventHours > P.n7.eahStrongerAlertHours.value)
  return { stronger, ...eahText(stronger) }
}

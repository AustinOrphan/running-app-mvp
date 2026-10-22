// Macrocycle: phases built backwards from race day, weekly targets, intensity distribution and
// the fixed blocks [rules e, h, k]. Pure: the same input gives the same weeks.
//
// Week flags written here (WeekDraft.flags): 'recovery', 'peak', 'taper', 'race-week',
// 'post-race', 'strength-block', 'gut-training', 'heat-acclimation', 'night', 'downhill', 'b2b'.
// Race week is the last week with the race in it: its volume is the shake-out running around the
// race, not the race itself, and its long run is 0. The weeks after the race (H12) follow it.
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import { P } from './params/index.ts'
import type {
  AthleteState,
  EngineInput,
  Feasibility,
  GoalModel,
  PhaseV2,
  WeekDraft,
} from './types.ts'

type Tid = WeekDraft['tid']

/** Guards float noise (100 * 1.1 = 110.00000000000001) before rounding down. */
const EPS = 1e-9
const floorEps = (x: number) => Math.floor(x + EPS)
const floorTo10 = (x: number) => Math.floor((x + EPS) / 10) * 10

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const hi = sorted[mid] ?? 0
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? hi) + hi) / 2
}

/** Weekly ramp that applies to this athlete [rules G-2, G-3]. */
export function weeklyRamp(state: AthleteState): number {
  let ramp = P.g2.rampSoft.value
  if (state.risk.recentInjury) ramp = Math.min(ramp, P.g3.recentInjuryRamp.value[0])
  if (state.risk.priorBsi) ramp = Math.min(ramp, P.g3.priorBsiRampMax.value)
  if (state.risk.bsiFactors >= P.g3.bsiFactorsForCap.value) {
    ramp = Math.min(ramp, P.g2.rampSoft.value * P.g3.bsiRampFactor.value)
  }
  return ramp
}

/** Taper length in days [rules K1]; never above the 21-day maximum. */
export function taperDays(goal: GoalModel, state: AthleteState): number {
  let days: number
  switch (goal.distanceClass) {
    case '5k':
      days = P.k1.fiveKmDays.value
      break
    case '10k':
      days = P.k1.tenKmDays.value
      break
    case 'half':
      days = P.k1.halfMarathonDays.value
      break
    case 'marathon':
      days =
        state.typicalWeekMin < P.k1Design.lowVolumeWeeklyMin.value
          ? P.k1.marathonLowVolumeDays.value
          : P.k1.marathonDays.value
      break
    case 'ultra50':
    case 'ultra100k':
      days = P.k1.ultra50to100kDays.value
      break
    case 'ultra100mi':
      days = P.k1.ultra100miDays.value
      break
    case 'beyond':
      days = P.k1.ultra100miDays.range?.[1] ?? P.k1.ultra100miDays.value
      break
  }
  return Math.min(days, P.k1.maxDays.value)
}

/** Volume multipliers of the taper weeks against the reference week, race week last [rules K2]. */
export function taperMultipliers(weeks: number): number[] {
  const two = P.k2.twoWeekMultipliers.value
  if (weeks >= 3) return P.k2.threeWeekMultipliers.value
  if (weeks === 2) return two
  return [two[two.length - 1] ?? 0]
}

/** Average training pace in sec/km: recent weeks, else the goal pace slowed, else a default. */
function trainingPace(state: AthleteState, goal: GoalModel): number {
  const paces = state.weeks
    .slice(-4)
    .filter((w) => w.runM > 0 && w.runMin > 0)
    .map((w) => (w.runMin * 60) / (w.runM / 1000))
  if (paces.length > 0) return median(paces)
  if (goal.expectedDurationSec > 0 && goal.distanceM > 0) {
    return (
      (goal.expectedDurationSec / (goal.distanceM / 1000)) * P.macroDesign.trainingPaceFactor.value
    )
  }
  return P.macroDesign.defaultEasyPaceSecPerKm.value
}

/** Minutes of running that cover `km` at the training pace. */
const minutesFor = (km: number, paceSecPerKm: number) => Math.ceil((km * paceSecPerKm) / 60)

/** The weekly-minutes ceiling for the goal: the class peak, lifted to the D3 floor for time goals. */
function peakWeeklyMin(goal: GoalModel, pace: number): number {
  let peak = P.peakWeeklyMin[goal.distanceClass].value
  if (goal.goalType === 'time') {
    if (goal.distanceClass === 'half') {
      peak = Math.max(peak, minutesFor(P.d3.halfMinWeeklyKm.value, pace))
    } else if (goal.distanceClass === 'marathon') {
      peak = Math.max(peak, minutesFor(P.d3.marathonMinWeeklyKm.value, pace))
    }
  }
  return peak
}

/** Longest planned run in minutes; ultras are capped by the lesser of 6 h and 60% of the race [H2]. */
export function peakLongRunMin(goal: GoalModel, pace: number): number {
  let peak = P.peakLongRunMin[goal.distanceClass].value
  if (goal.goalType === 'time') {
    if (goal.distanceClass === 'half') {
      peak = Math.max(peak, minutesFor(P.d3.halfMinLongRunKm.value, pace))
    } else if (goal.distanceClass === 'marathon') {
      peak = Math.max(peak, minutesFor(P.d3.marathonMinLongRunKm.value, pace))
    }
  }
  if (goal.isUltra) {
    const cap = Math.min(
      P.h2.longestRunCapHours.value * 60,
      (P.h2.longestRunCapRaceFraction.value * goal.expectedDurationSec) / 60,
    )
    peak = Math.min(peak, floorEps(cap))
  }
  return peak
}

/** Z1/Z2/Z3 shares of running time [rules E4]; Z1 never below its floor, Z2 never above Z1. */
function tidFor(phase: PhaseV2, goal: GoalModel, polarized: boolean): Tid {
  let z1: number
  let z2: number
  let z3: number
  const shortRace = goal.distanceClass === '5k' || goal.distanceClass === '10k'
  if (goal.isUltra) {
    z1 = P.e4.ultraZ1Min.value
    z3 = P.e4.ultraZ3Max.value
    z2 = 100 - z1 - z3
  } else if (phase === 'base') {
    z3 = P.e4.baseZ3Share.value
    z2 = P.e4.z2CapBase.value
    z1 = 100 - z2 - z3
  } else if (phase === 'build' || (shortRace && !polarized)) {
    z1 = P.e4.z1Prior.value
    z2 = P.e4.z2Prior.value
    z3 = P.e4.z3Prior.value
  } else if (shortRace) {
    // polarized specific phase, offered on request for 5-10 km
    z2 = P.macroDesign.polarizedZ2Share.value
    z1 = 100 - P.f2.z2z3Share.value
    z3 = 100 - z1 - z2
  } else {
    // half-marathon and marathon specific, taper and race weeks: race pace moves into Z2
    z3 = P.e4.baseZ3Share.value
    z2 = Math.min(P.e4.specificHalfMarathonZ2Max.value, P.f2.z2z3Share.value - z3)
    z1 = 100 - z2 - z3
  }
  z1 = Math.max(z1, P.e4.z1Floor.value)
  z2 = Math.min(z2, z1)
  z3 = 100 - z1 - z2
  return { z1, z2, z3 }
}

const FOCUS: Record<PhaseV2, string> = {
  base: 'Aerobic base: easy running, strides and strength',
  build: 'Build: steady aerobic volume with quality work',
  specific: 'Race-specific: long runs and race-effort work',
  taper: 'Taper: volume down, intensity kept',
  race: 'Race week: short, sharp and rested',
}

interface PhasePlan {
  phase: PhaseV2
  isRecovery: boolean
}

/** Work weeks per recovery cycle [rules E3, G-3]. */
function cycleWorkWeeks(input: EngineInput, state: AthleteState): number {
  const flagged = P.e3.flaggedCycleWorkWeeks.value
  if (state.risk.recentInjury) return flagged
  if (input.options.recoveryCycle === '2:1') return flagged
  if (input.options.recoveryCycle === '3:1') return P.e3.defaultCycleWorkWeeks.value
  return state.experience === 'novice' ? flagged : P.e3.defaultCycleWorkWeeks.value
}

/** Phases built backwards: taper and race week, specific, build, base takes the remainder [E2]. */
function planPhases(
  weeksBeforeTaper: number,
  taperWeeks: number,
  workPerCycle: number,
  openingRecovery: boolean,
): PhasePlan[] {
  const specificMin = P.e2.specificWeeksMin.value
  const specific =
    weeksBeforeTaper >= specificMin ? Math.min(P.e2.specificWeeksMax.value, weeksBeforeTaper) : 0
  const remaining = weeksBeforeTaper - specific
  const build = Math.min(remaining, P.macroDesign.buildWeeks.value)
  const base = remaining - build
  const cycle = workPerCycle + 1
  const out: PhasePlan[] = []
  for (let i = 0; i < weeksBeforeTaper; i++) {
    const phase: PhaseV2 = i < base ? 'base' : i < base + build ? 'build' : 'specific'
    // counted back from the last pre-taper week, which is always a work week (the peak); a new
    // plan never opens with a recovery week, so its first cycle may run one work week longer. A
    // re-plan keeps the first week a recovery week when the plan it replaces had it so.
    const fromEnd = weeksBeforeTaper - 1 - i
    out.push({
      phase,
      isRecovery: (i > 0 || openingRecovery) && fromEnd % cycle === cycle - 1,
    })
  }
  for (let i = 0; i < taperWeeks; i++) {
    out.push({ phase: i === taperWeeks - 1 ? 'race' : 'taper', isRecovery: false })
  }
  return out
}

/** Quality sessions wanted in a pre-taper week before the run-day cap [rules F2, H1]. */
function wantedQuality(phase: PhaseV2, novice: boolean, goal: GoalModel): number {
  let q: number
  if (phase === 'base') q = novice ? 0 : P.k3.minQualitySessionsPerWeek.value
  else q = novice ? P.k3.minQualitySessionsPerWeek.value : P.f2.qualitySessionsPerWeek.value
  // 100 km and longer: grow weekly volume before adding pace work
  if (goal.distanceM >= P.h1.volumeFirstFromM.value) q = Math.min(q, 1)
  return q
}

/** Phase-specific share of the race's gain per km practised each week [rules H4]. */
function gainShare(phase: PhaseV2): number {
  if (phase === 'base') return P.macroDesign.gainShareBase.value
  if (phase === 'build') return P.macroDesign.gainShareBuild.value
  return P.macroDesign.gainShareSpecific.value
}

/**
 * Phases built backwards from race day, weekly targets, TID targets, fixed blocks and the
 * post-race weeks [rules e, h, k]. Feasibility labels the plan elsewhere; it never changes a limit.
 */
export function macroPlan(
  input: EngineInput,
  state: AthleteState,
  goal: GoalModel,
  _feasibility: Feasibility,
): WeekDraft[] {
  const firstMonday = mondayOf(input.today)
  const raceMonday = mondayOf(goal.date)
  if (goal.date < input.today) return []
  const total = daysBetween(firstMonday, raceMonday) / 7 + 1
  if (total < 1) return []

  const novice = state.experience === 'novice'
  const ramp = weeklyRamp(state)
  const pace = trainingPace(state, goal)
  const minStep = P.g2.noviceMinStepMin.value
  const share = goal.isUltra
    ? P.macroDesign.longRunShareOfWeekUltra.value
    : P.macroDesign.longRunShareOfWeek.value
  const cut = P.e3.recoveryWeekCutPct.value / 100

  // Phases
  const taperCount = Math.min(Math.ceil(taperDays(goal, state) / 7), total)
  const preCount = total - taperCount
  const openingRecovery =
    input.existing?.weeks.find((w) => w.weekStart === firstMonday)?.isRecovery === true
  const phases = planPhases(preCount, taperCount, cycleWorkWeeks(input, state), openingRecovery)
  const raceIdx = total - 1

  // Run days: novices keep the three-day rhythm, others follow the minutes, never above six
  const sessionMin = (P.d3.typicalSessionKm.value * pace) / 60
  const minDays = P.f5.noviceRunDays.value
  const maxDays = P.f5.mastersMaxRunDays.value
  const daysFor = (target: number) => {
    if (target <= 0) return 0
    if (novice) return minDays
    return Math.min(maxDays, Math.max(minDays, Math.round(target / sessionMin)))
  }

  // Weekly targets, long runs, run days and gain for the pre-taper weeks
  const start =
    state.typicalWeekMin > 0 ? state.typicalWeekMin : P.macroDesign.startFloorWeekMin.value
  const ceiling = Math.max(peakWeeklyMin(goal, pace), start)
  const peakLong = peakLongRunMin(goal, pace)
  const hasGain = goal.gainM > 0 && goal.distanceM > 0
  const gainPerKm = hasGain ? goal.gainM / (goal.distanceM / 1000) : 0
  const gainStep = P.h4.minStepGainM.value

  const target: number[] = []
  const longRun: number[] = []
  const runDays: number[] = []
  const gain: Array<number | null> = []
  let lastWork = start
  let haveWork = false
  let prevLong = floorEps(state.longest30d.durationSec / 60)
  let prevDays = 0
  let prevGain = Math.max(gainStep, floorTo10(state.longest30d.gainM))

  for (let i = 0; i < preCount; i++) {
    const ph = phases[i] as PhasePlan
    const rawLong = floorEps(start * share)
    if (ph.isRecovery) {
      const t = floorEps(lastWork * (1 - cut))
      target.push(t)
      longRun.push(
        Math.min(prevLong > 0 ? floorEps(prevLong * (1 - cut)) : rawLong, floorEps(t * share)),
      )
      runDays.push(prevDays > 0 ? prevDays : daysFor(t))
      gain.push(hasGain ? floorTo10(prevGain * (1 - cut)) : null)
      continue
    }
    const t = haveWork
      ? Math.min(ceiling, Math.max(floorEps(lastWork * (1 + ramp)), lastWork + minStep))
      : start
    haveWork = true
    lastWork = t
    target.push(t)

    const raw = floorEps(t * share)
    const progressive = prevLong > 0 ? Math.max(floorEps(prevLong * (1 + ramp)), prevLong + 1) : raw
    const long = Math.min(raw, progressive, peakLong)
    longRun.push(long)
    prevLong = long

    prevDays = Math.max(prevDays, daysFor(t))
    runDays.push(prevDays)

    if (hasGain) {
      const desired = floorTo10(gainPerKm * ((t * 60) / pace) * gainShare(ph.phase))
      prevGain = Math.min(
        desired,
        Math.max(floorEps(prevGain * (1 + P.h4.weeklyGainRamp.value)), prevGain + gainStep),
      )
      gain.push(prevGain)
    } else {
      gain.push(null)
    }
  }

  // The reference week for the taper and the post-race weeks is the peak before the taper
  const reference = preCount > 0 ? Math.max(...target) : start
  const refDays = preCount > 0 ? prevDays : daysFor(start)
  const refLong = prevLong
  const refGain = hasGain ? prevGain : null
  const mult = taperMultipliers(taperCount)
  let prevTarget = preCount > 0 ? (target[preCount - 1] as number) : start
  let prevTaperLong = refLong
  for (let k = 0; k < taperCount; k++) {
    const t = Math.max(0, Math.min(floorEps(reference * (mult[k] ?? 0)), prevTarget - 1))
    prevTarget = t
    target.push(t)
    const isRace = k === taperCount - 1
    const long = isRace ? 0 : Math.min(prevTaperLong, floorEps(t * share))
    longRun.push(long)
    prevTaperLong = isRace ? prevTaperLong : long
    const cutDays = (P.k3.runDaysMaxCutPct.value / 100) * ((k + 1) / taperCount)
    runDays.push(Math.ceil(refDays * (1 - cutDays) - EPS))
    gain.push(refGain === null ? null : floorTo10(refGain * (t / Math.max(reference, 1))))
  }

  // Strength: a heavy block in base and early build, then maintenance
  const requested =
    input.options.strengthSessions ??
    Math.min(P.flib.strengthPerWeek.value, input.profile.strengthPreference)
  const maintenance = Math.min(requested, P.e5.strengthMaintenancePerWeek.value)
  const nonSpecific = phases.filter((p, i) => i < preCount && p.phase !== 'specific').length
  const blockLen =
    nonSpecific >= P.e5.strengthBlockMinWeeks.value
      ? Math.min(P.e5.strengthBlockWeeks.value, nonSpecific)
      : 0

  // Flags for the fixed blocks
  const flagSets: Array<Set<string>> = phases.map(() => new Set<string>())
  const flag = (i: number, name: string) => {
    if (i >= 0 && i < total) flagSets[i]?.add(name)
  }
  for (let i = 0; i < total; i++) {
    const ph = phases[i] as PhasePlan
    if (ph.isRecovery) flag(i, 'recovery')
    if (ph.phase === 'taper') flag(i, 'taper')
    if (ph.phase === 'race') flag(i, 'race-week')
    if (i < blockLen) flag(i, 'strength-block')
  }
  if (preCount > 0) flag(preCount - 1, 'peak')

  const specificIdx = phases.map((p, i) => (p.phase === 'specific' ? i : -1)).filter((i) => i >= 0)
  if (goal.isUltra || goal.distanceClass === 'marathon') {
    for (const i of specificIdx.slice(-P.h7.gutTrainingWeeks.value)) flag(i, 'gut-training')
  }
  if (goal.raceWbgtC !== null && goal.raceWbgtC >= P.i8.triggerWbgtC.value) {
    const blockWeeks = Math.ceil(P.i8.blockDays.value / 7)
    for (let i = Math.max(0, raceIdx - blockWeeks); i < raceIdx; i++) flag(i, 'heat-acclimation')
  }
  if (goal.crossesDarkness) {
    const work = specificIdx.filter((i) => !(phases[i] as PhasePlan).isRecovery)
    const candidates = work.length > 1 ? work.slice(0, -1) : work
    for (const i of candidates.slice(-P.h6.headlampRehearsalRuns.value[1])) flag(i, 'night')
  }
  if (goal.lossM >= P.h4.minStepGainM.value) {
    for (
      let i = Math.max(0, raceIdx - P.h5.downhillStartWeeksBeforeRace.value);
      i < preCount;
      i++
    ) {
      flag(i, 'downhill')
    }
  }
  if (goal.isUltra) {
    let last = -Infinity
    for (let i = 0; i < preCount; i++) {
      const ph = phases[i] as PhasePlan
      const eligible =
        !ph.isRecovery &&
        (ph.phase === 'build' || ph.phase === 'specific') &&
        (longRun[i] ?? 0) >= P.flib.longRunMinMin.value
      if (eligible && i - last >= P.h3.b2bMinGapWeeks.value) {
        flag(i, 'b2b')
        last = i
      }
    }
  }

  // Assemble the weeks
  const weeks: WeekDraft[] = phases.map((ph, i) => {
    const t = target[i] as number
    const isTaperWeek = ph.phase === 'taper' || ph.phase === 'race'
    const days = runDays[i] as number
    let quality: number
    if (isTaperWeek) quality = P.k3.minQualitySessionsPerWeek.value
    else {
      quality = Math.min(wantedQuality(ph.phase, novice, goal), Math.max(days - 2, 0))
      if (ph.isRecovery) quality = Math.min(quality, 1)
    }
    let strength: number
    if (ph.phase === 'race') strength = 0
    else if (i < blockLen) strength = requested
    else strength = maintenance
    const long = longRun[i] as number
    return {
      weekStart: addDays(firstMonday, 7 * i),
      index: i,
      phase: ph.phase,
      focus: ph.isRecovery ? 'Recovery week: lighter volume, frequency kept' : FOCUS[ph.phase],
      targetRunMin: t,
      longRunMin: long,
      longRunM: long > 0 ? Math.round((((long * 60) / pace) * 1000) / 100) * 100 : null,
      gainTargetM: gain[i] ?? null,
      runDays: days,
      qualitySessions: quality,
      strengthSessions: strength,
      tid: tidFor(ph.phase, goal, input.options.tidModel === 'polarized'),
      flags: [...(flagSets[i] ?? [])],
      isRecovery: ph.isRecovery,
      isTaper: isTaperWeek,
    }
  })

  // After the race: 7 days without running for 100 km and longer, then reduced running [rules H12]
  const reduced = floorEps(reference * P.macroDesign.postRaceReducedFraction.value)
  const restFirst = goal.distanceM >= P.h12.thresholdKm.value * 1000
  const post = restFirst ? [0, reduced] : [reduced]
  post.forEach((minutes, k) => {
    weeks.push({
      weekStart: addDays(firstMonday, 7 * (total + k)),
      index: total + k,
      phase: 'race',
      focus: minutes === 0 ? 'After the race: rest' : 'After the race: easy running',
      targetRunMin: minutes,
      longRunMin: 0,
      longRunM: null,
      gainTargetM: null,
      runDays: minutes === 0 ? 0 : Math.min(refDays, minDays),
      qualitySessions: 0,
      strengthSessions: 0,
      tid: { z1: 100, z2: 0, z3: 0 },
      flags: ['post-race'],
      isRecovery: true,
      isTaper: false,
    })
  })
  return weeks
}

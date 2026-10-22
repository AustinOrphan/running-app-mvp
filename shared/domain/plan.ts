import { weekStartsBetween } from '../dates.ts'
import type { DistanceClass, Phase, PlanWeek, PlanPhase } from '../types.ts'

export const GENERATOR_VERSION = 1

export interface GeneratePlanInput {
  startDate: string
  raceDate: string
  distanceClass: DistanceClass
  baselineRunMin: number
  strengthPreference: 0 | 1 | 2
}

export type PlanWeekInput = Pick<
  PlanWeek,
  | 'weekStart'
  | 'index'
  | 'baselineRunMin'
  | 'longRunMin'
  | 'day2Min'
  | 'runDays'
  | 'strengthSessions'
> & { phase: Phase; focus: string }

/** Maps a stored week phase to the version-1 phase the version-1 review rules expect. */
export function toV1Phase(phase: PlanPhase): Phase {
  if (phase === 'base') return 'base1'
  if (phase === 'build') return 'endurance'
  return phase
}

export const BUILD_PHASES: readonly Phase[] = [
  'restart',
  'base1',
  'base2',
  'endurance',
  'specific',
  'peak',
]

/** Weekly run minutes at the top of the Peak phase, by distance class. Adjust here, per spec section 6. */
export const PEAK_MIN_BY_CLASS: Record<DistanceClass, number> = {
  short: 300,
  half: 360,
  marathon: 480,
  ultra50: 540,
  ultra100: 570,
}

type BuildPhase = 'restart' | 'base1' | 'base2' | 'endurance' | 'specific' | 'peak'

/** Share of the build weeks (restart 10 : base1 19 : base2 19 : endurance 19 : specific 12 : peak 14). */
const PHASE_SHARE: Record<BuildPhase, number> = {
  restart: 10,
  base1: 19,
  base2: 19,
  endurance: 19,
  specific: 12,
  peak: 14,
}

/** Weekly minutes at the end of each phase, as a percentage of the plan's peak. */
const PHASE_CEILING_PERCENT: Record<BuildPhase, number> = {
  restart: 40,
  base1: 55,
  base2: 70,
  endurance: 82,
  specific: 92,
  peak: 100,
}

const RUN_DAYS: Record<BuildPhase, number> = {
  restart: 3,
  base1: 3,
  base2: 4,
  endurance: 4,
  specific: 5,
  peak: 5,
}

const MAX_STRENGTH: Record<Phase, number> = {
  restart: 2,
  base1: 2,
  base2: 2,
  endurance: 2,
  specific: 2,
  peak: 1,
  taper: 0,
  race: 0,
}

const FOCUS: Record<Phase, string> = {
  restart: 'Ease back in with short, relaxed runs',
  base1: 'Build easy aerobic volume',
  base2: 'Extend easy volume and add a steady long run',
  endurance: 'Lengthen the long run and add a second long day',
  specific: 'Practise race effort on tired legs',
  peak: 'Hold peak volume and rehearse race day',
  taper: 'Cut volume, stay loose and sleep',
  race: 'Race week: stay fresh and go',
}

const PHASE_ORDER: readonly BuildPhase[] = [
  'restart',
  'base1',
  'base2',
  'endurance',
  'specific',
  'peak',
]

const FIRST_WEEK_PERCENT = 115
const RAMP_PERCENT = 110
const CUTBACK_PERCENT = 77.5
const TAPER_PERCENTS = [65, 45] as const
const RACE_WEEK_MIN = 90
const RESTART_SKIP_PERCENT = 40
const LONG_RUN_CAP_MIN = 240

function isBuildPhase(phase: Phase): phase is BuildPhase {
  return phase in PHASE_CEILING_PERCENT
}

export function distanceClassOf(distanceM: number): DistanceClass {
  if (distanceM <= 10_000) return 'short'
  if (distanceM <= 21_100) return 'half'
  if (distanceM <= 42_195) return 'marathon'
  if (distanceM <= 80_500) return 'ultra50'
  return 'ultra100'
}

/** Long run: about 27 minutes per weekly hour, never more than four hours. */
export function longRunMinutes(weekMin: number): number {
  return Math.min(Math.round((27 * weekMin) / 60), LONG_RUN_CAP_MIN)
}

/** Every 4th week of a build phase is a cutback. */
export function isCutbackIndex(index: number, phase: PlanPhase): boolean {
  return index % 4 === 3 && BUILD_PHASES.includes(toV1Phase(phase))
}

function percentOf(percent: number, value: number): number {
  return Math.round((percent * value) / 100)
}

/** Whole weeks per build phase: largest remainder, ties to the earlier phase. */
function allocateBuildWeeks(build: number, skipRestart: boolean): Map<BuildPhase, number> {
  const weeks = new Map<BuildPhase, number>()
  if (build <= 0) return weeks
  if (build < 6) {
    weeks.set('base1', Math.ceil(build / 2))
    if (Math.floor(build / 2) > 0) weeks.set('peak', Math.floor(build / 2))
    return weeks
  }
  const phases = PHASE_ORDER.filter((phase) => !(skipRestart && phase === 'restart'))
  const total = phases.reduce((sum, phase) => sum + PHASE_SHARE[phase], 0)
  let assigned = 0
  const remainders: Array<{ phase: BuildPhase; rest: number; order: number }> = []
  phases.forEach((phase, order) => {
    const numerator = build * PHASE_SHARE[phase]
    const whole = Math.floor(numerator / total)
    weeks.set(phase, whole)
    assigned += whole
    remainders.push({ phase, rest: numerator % total, order })
  })
  remainders.sort((a, b) => b.rest - a.rest || a.order - b.order)
  for (const { phase } of remainders.slice(0, build - assigned)) {
    weeks.set(phase, (weeks.get(phase) ?? 0) + 1)
  }
  // Every phase gets a week: take one from the longest phase, the later one on ties.
  for (const phase of phases) {
    if ((weeks.get(phase) ?? 0) > 0) continue
    let donor: BuildPhase | null = null
    for (const candidate of phases) {
      if (donor === null || (weeks.get(candidate) ?? 0) >= (weeks.get(donor) ?? 0))
        donor = candidate
    }
    if (donor !== null) weeks.set(donor, (weeks.get(donor) ?? 0) - 1)
    weeks.set(phase, 1)
  }
  return weeks
}

export function generatePlan(input: GeneratePlanInput): PlanWeekInput[] {
  const { distanceClass, strengthPreference } = input
  if (!Number.isFinite(input.baselineRunMin) || input.baselineRunMin < 1) {
    throw new RangeError('baselineRunMin must be at least 1')
  }
  const baseline = Math.round(input.baselineRunMin)
  const mondays = weekStartsBetween(input.startDate, input.raceDate)
  if (mondays.length === 0) {
    throw new RangeError('The race week precedes the start week')
  }

  const weekCount = mondays.length
  const taperWeeks = weekCount >= 24 ? 2 : weekCount >= 8 ? 1 : 0
  const buildWeeks = weekCount - 1 - taperWeeks
  const classPeak = PEAK_MIN_BY_CLASS[distanceClass]
  const peak = Math.max(
    baseline,
    Math.min(classPeak, Math.round(baseline * Math.pow(1.1, buildWeeks))),
  )
  const skipRestart = baseline > percentOf(RESTART_SKIP_PERCENT, classPeak)
  const allocation = allocateBuildWeeks(buildWeeks, skipRestart)

  // Phase of each week and the interpolated minutes for build weeks.
  const phases: Phase[] = []
  const interpolated: number[] = []
  let floor = baseline
  for (const phase of PHASE_ORDER) {
    const count = allocation.get(phase) ?? 0
    if (count === 0) continue
    const ceiling = Math.max((PHASE_CEILING_PERCENT[phase] * peak) / 100, floor)
    for (let k = 0; k < count; k += 1) {
      phases.push(phase)
      interpolated.push(Math.round(floor + ((ceiling - floor) * (k + 1)) / count))
    }
    floor = ceiling
  }
  for (let t = 0; t < taperWeeks; t += 1) phases.push('taper')
  phases.push('race')

  const minutes: number[] = []
  let reference: number | null = null // last non-cutback build week
  for (let index = 0; index < weekCount; index += 1) {
    const phase = phases[index] as Phase
    const previous = minutes[index - 1]
    let value: number
    if (phase === 'race') {
      value = RACE_WEEK_MIN
    } else if (phase === 'taper') {
      const taperIndex = index - buildWeeks
      value = percentOf(TAPER_PERCENTS[taperIndex] ?? 45, reference ?? baseline)
    } else if (isCutbackIndex(index, phase) && previous !== undefined) {
      value = percentOf(CUTBACK_PERCENT, previous)
    } else {
      value = interpolated[index] as number
      if (index === 0) value = Math.min(value, percentOf(FIRST_WEEK_PERCENT, baseline))
      else if (reference !== null) value = Math.min(value, percentOf(RAMP_PERCENT, reference))
      reference = value
    }
    minutes.push(value)
  }

  return phases.map((phase, index): PlanWeekInput => {
    const baselineRunMin = minutes[index] as number
    const cutback = isCutbackIndex(index, phase)
    const buildPhase = isBuildPhase(phase)
    let runDays: number
    if (phase === 'race') runDays = 2
    else if (phase === 'taper') runDays = index - buildWeeks === 0 ? 4 : 3
    else runDays = Math.max(RUN_DAYS[phase] - (cutback ? 1 : 0), 2)
    const longRunMin = phase === 'race' ? 0 : longRunMinutes(baselineRunMin)
    const hasDay2 = !cutback && (phase === 'endurance' || phase === 'specific' || phase === 'peak')
    return {
      weekStart: mondays[index] as string,
      index,
      phase,
      focus: FOCUS[phase],
      baselineRunMin,
      longRunMin,
      day2Min: hasDay2 && buildPhase ? Math.round(longRunMin / 2) : null,
      runDays,
      strengthSessions: Math.min(strengthPreference, MAX_STRENGTH[phase]),
    }
  })
}

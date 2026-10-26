// Session library and prescriptions [rules F session library, C5, C6, H3-H7]. Pure functions: a
// session comes back undated (date '', order 0); micro.ts places it on a day.
import { P } from './params/index.ts'
import {
  clipBlueprint,
  hasWalk,
  injuryLevel,
  ladderRung,
  rungCount,
  startKind,
} from './startWeeks.ts'
import type {
  SessionFlag,
  SessionKind,
  SessionSpec,
  Step,
  WeekDraft,
  ZoneKey,
  ZoneSet,
} from './types.ts'

export interface SessionTemplate {
  kind: SessionKind
  zone: ZoneKey
  purpose: string
  /** Rule ids that justify the session, resolved by explain.ts. */
  rules: string[]
  rpe: [number, number]
}

/** Optional facts that sharpen a prescription; every field has a rule-based default. */
export interface PrescribeContext {
  /** Goal pace in sec/km; anchors race-pace work and the race itself. */
  goalPaceSecPerKm?: number | null
  /** The athlete's D-prime in metres; the rep budget of C6 uses a default without it. */
  dPrimeM?: number | null
  /** Well-trained athletes use the smaller margin below critical speed [rules C5]. */
  wellTrained?: boolean
  /** Novices and restarts run in short run-walk units [rules F run-walk]. */
  runWalk?: boolean
  /**
   * A session of the run-walk ladder [rules E6]: run and walk minutes in order, starting with a
   * run. The session is cut to its `minutes` when that is shorter.
   */
  blueprint?: readonly number[]
  /** A strength session of an ultra goal also cites H10 [rules E5, H10]. */
  ultra?: boolean
  /** The week's place in its strength block, week k of n; null or absent outside a block. */
  blockPosition?: { week: number; of: number } | null
}

interface LibraryEntry {
  zone: ZoneKey
  purpose: string
  rules: string[]
}

const LIBRARY: Record<SessionKind, LibraryEntry> = {
  easy: {
    zone: 'z1',
    purpose: 'Easy running below the first threshold; the bulk of added volume goes here.',
    rules: ['F-lib', 'E4'],
  },
  recovery: {
    zone: 'z1',
    purpose: 'Very easy running that lets the previous hard days settle.',
    rules: ['F-lib', 'E3'],
  },
  long: {
    zone: 'z1',
    purpose: 'Long aerobic run for durability, mostly easy, away from the quality days.',
    rules: ['F-lib', 'F3'],
  },
  'long-fast-finish': {
    zone: 'z1',
    purpose: 'Long run that ends with the final fifth at race pace, to practise running tired.',
    rules: ['F-lib'],
  },
  threshold: {
    zone: 'z2',
    purpose: 'Steady work just below critical speed, as one bout or cruise intervals.',
    rules: ['F-lib', 'C5'],
  },
  intervals: {
    zone: 'z3',
    purpose: 'Repetitions above critical speed, each rep inside half the time to exhaustion.',
    rules: ['F-lib', 'C6'],
  },
  'race-pace': {
    zone: 'race-pace',
    purpose: 'Blocks at goal race pace, to rehearse the effort and the feel of it.',
    rules: ['F-lib'],
  },
  strides: {
    zone: 'strides',
    purpose: 'Easy run with a few short, relaxed fast strides for running economy.',
    rules: ['F-lib'],
  },
  hills: {
    zone: 'z3',
    purpose: 'Hill repeats for strength and economy, paced by effort rather than vertical speed.',
    rules: ['F-lib', 'H4'],
  },
  hike: {
    zone: 'z1',
    purpose: 'Power-hiking practice on climbs, paced by effort rather than speed.',
    rules: ['H4'],
  },
  b2b: {
    zone: 'z1',
    purpose: 'One day of a back-to-back pair: long, easy running, the second day on tired legs.',
    rules: ['H3'],
  },
  strength: {
    zone: 'strength',
    purpose: 'Heavy strength work.',
    rules: ['F-lib', 'F4', 'E5', 'F7'],
  },
  mobility: {
    zone: 'rest',
    purpose: 'Hip and core mobility work, no running.',
    rules: ['F-lib'],
  },
  rest: {
    zone: 'rest',
    purpose: 'Rest day: no training, so the week stays absorbable.',
    rules: [],
  },
  race: {
    zone: 'race-pace',
    purpose: 'Race day: run by effort, follow the fuel and pacing plan.',
    rules: ['K6'],
  },
  cross: {
    zone: 'z1',
    purpose: 'Easy cross-training that adds aerobic work without running impact.',
    rules: ['F-lib'],
  },
}

const TITLES: Record<SessionKind, string> = {
  easy: 'Easy run',
  recovery: 'Recovery run',
  long: 'Long run',
  'long-fast-finish': 'Long run, fast finish',
  threshold: 'Threshold run',
  intervals: 'Intervals',
  'race-pace': 'Race-pace run',
  strides: 'Easy run with strides',
  hills: 'Hill repeats',
  hike: 'Hike',
  b2b: 'Back-to-back run',
  strength: 'Strength',
  mobility: 'Mobility',
  rest: 'Rest',
  race: 'Race',
  cross: 'Cross-training',
}

/** The title a session of `kind` carries in the plan: "Long run, fast finish" for `long-fast-finish`. */
export function sessionTitle(kind: SessionKind): string {
  return TITLES[kind]
}

/** Kinds that are runs, so a distance and a gain share can be shown. */
export const RUN_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
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

/** The library entry for a session kind [rules F, session library]. */
export function sessionLibrary(kind: SessionKind): SessionTemplate {
  const entry = LIBRARY[kind]
  return {
    kind,
    zone: entry.zone,
    purpose: entry.purpose,
    rules: [...entry.rules],
    rpe: [...P.expectedRpe[kind].value] as [number, number],
  }
}

type PaceRange = [number, number]

const mid = (range: PaceRange | null | undefined) => (range ? (range[0] + range[1]) / 2 : null)
const roundTo = (value: number, step: number) => Math.round(value / step) * step

/** A pace range around one pace: the band is the default pace band of C7. */
function bandAround(pace: number): PaceRange {
  const band = P.c7.bandDefaultPacePct.value / 100
  return [pace * (1 + band), pace * (1 - band)]
}

const step = (kind: Step['kind'], reps: number, durationSec: number, zone: ZoneKey): Step => ({
  kind,
  reps,
  durationSec,
  distanceM: null,
  zone,
})

/** Warm-up and cool-down around the work, and the minutes left for it (negative: no room). */
function frame(minutes: number) {
  const warmSec = P.sessionDesign.warmupMin.value * 60
  const coolSec = P.sessionDesign.cooldownMin.value * 60
  return { warmSec, coolSec, workSec: minutes * 60 - warmSec - coolSec }
}

interface Built {
  structure: Step[]
  /** Steps before and after the session that are not part of its minutes (the ladder's walks). */
  before?: Step[]
  after?: Step[]
  /** Pace range of the work steps, when the session sets its own. */
  workPace: PaceRange | null
  rules: string[]
  margin?: number
}

/**
 * Threshold work: continuous or cruise intervals under critical speed [rules C5]. It is the top of
 * Z2 (LT1 up to the threshold pace), so it counts toward the Z2 threshold cap [rules E4]. Without
 * a critical speed the threshold pace of the zone set is the fastest pace allowed.
 */
function buildThreshold(minutes: number, zones: ZoneSet, ctx: PrescribeContext): Built {
  const margin = ctx.wellTrained
    ? P.c5.thresholdMarginWellTrainedKmh.value
    : P.c5.thresholdMarginOtherKmh.value
  const cs = zones.csMps?.value ?? null
  const band = P.c7.bandDefaultPacePct.value / 100
  const thresholdPace = zones.thresholdPaceSecPerKm?.value ?? null
  let workPace: PaceRange | null = zones.pace?.z2 ?? null
  if (cs !== null && cs > margin / 3.6) {
    const fast = 1000 / (cs - margin / 3.6)
    workPace = [fast * (1 + band), fast]
  } else if (thresholdPace !== null && thresholdPace > 0) {
    workPace = [thresholdPace * (1 + band), thresholdPace]
  }
  const { warmSec, coolSec, workSec } = frame(minutes)
  if (workSec < 60) return { structure: [], workPace, rules: ['C5'], margin }
  const recoverSec = P.sessionDesign.thresholdRecoverMin.value * 60
  const bouts = Math.ceil(workSec / (P.c5.wellTrainedBoutMaxMin.value * 60))
  const netSec = workSec - (bouts - 1) * recoverSec
  const boutSec = Math.floor(netSec / bouts)
  const structure = [
    step('warmup', 1, warmSec, 'z1'),
    step('work', bouts, boutSec, 'z2'),
    ...(bouts > 1 ? [step('recover', bouts - 1, recoverSec, 'z1')] : []),
    step('cooldown', 1, coolSec, 'z1'),
  ]
  return { structure, workPace, rules: ['C5'], margin }
}

/**
 * Intervals above critical speed, each rep within the D-prime budget [rules C6]. Without a critical
 * speed the work pace sits the same margin above the fast end of Z3 (the CS-equivalent pace).
 */
function buildIntervals(minutes: number, zones: ZoneSet, ctx: PrescribeContext): Built {
  const cs = zones.csMps?.value ?? null
  const band = P.c7.bandDefaultPacePct.value / 100
  const above = 1 + P.sessionDesign.intervalSpeedAboveCs.value
  const csEquivalentPace = zones.pace?.z3[1] ?? null
  let workPace: PaceRange | null =
    csEquivalentPace !== null && csEquivalentPace > 0
      ? [csEquivalentPace / above, (csEquivalentPace / above) * (1 - band)]
      : null
  let repSec: number = P.sessionDesign.intervalRepSec.value
  if (cs !== null && cs > 0) {
    const v = cs * above
    const dPrime = ctx.dPrimeM ?? P.sessionDesign.intervalDefaultDPrimeM.value
    const tte = dPrime / (v - cs)
    repSec = Math.min(repSec, Math.floor(P.c6.repFractionOfTte.value * tte))
    const pace = 1000 / v
    workPace = [pace, pace * (1 - band)]
  }
  const { warmSec, coolSec, workSec } = frame(minutes)
  const recoverSec = Math.round(repSec * P.sessionDesign.intervalRecoverFraction.value)
  const reps = repSec > 0 ? Math.floor(workSec / (repSec + recoverSec)) : 0
  if (reps < 1) return { structure: [], workPace, rules: ['C6'] }
  return {
    structure: [
      step('warmup', 1, warmSec, 'z1'),
      step('work', reps, repSec, 'z3'),
      step('recover', reps, recoverSec, 'z1'),
      step('cooldown', 1, coolSec, 'z1'),
    ],
    workPace,
    rules: ['C6'],
  }
}

/** Blocks at race pace with short recoveries. */
function buildRacePace(minutes: number, zones: ZoneSet, ctx: PrescribeContext): Built {
  const goal = ctx.goalPaceSecPerKm ?? null
  const workPace = goal !== null ? bandAround(goal) : (zones.pace?.z2 ?? null)
  const { warmSec, coolSec, workSec } = frame(minutes)
  if (workSec < 60) return { structure: [], workPace, rules: [] }
  const recoverSec = P.sessionDesign.racePaceRecoverMin.value * 60
  const bouts = Math.ceil(workSec / (P.sessionDesign.racePaceBoutMin.value * 60))
  const boutSec = Math.floor((workSec - (bouts - 1) * recoverSec) / bouts)
  return {
    structure: [
      step('warmup', 1, warmSec, 'z1'),
      step('work', bouts, boutSec, 'race-pace'),
      ...(bouts > 1 ? [step('recover', bouts - 1, recoverSec, 'z1')] : []),
      step('cooldown', 1, coolSec, 'z1'),
    ],
    workPace,
    rules: [],
  }
}

/** An easy run with the standard number of strides at the end [rules F strides]. */
function buildStrides(minutes: number): Built {
  const reps = P.flib.stridesCount.value
  const workSec = P.sessionDesign.stridesWorkSec.value
  const recoverSec = P.sessionDesign.stridesRecoverSec.value
  const mainSec = minutes * 60 - reps * (workSec + recoverSec)
  return {
    structure: [
      ...(mainSec > 0 ? [step('steady', 1, mainSec, 'z1')] : []),
      step('work', reps, workSec, 'strides'),
      step('recover', reps, recoverSec, 'z1'),
    ],
    workPace: null,
    rules: [],
  }
}

/** Hill repeats by effort: short reps, easy jog or walk down. */
function buildHills(minutes: number): Built {
  const { warmSec, coolSec, workSec } = frame(minutes)
  const repSec = P.sessionDesign.hillsRepSec.value
  const recoverSec = P.sessionDesign.hillsRecoverSec.value
  const reps = Math.floor(workSec / (repSec + recoverSec))
  if (reps < 1) return { structure: [], workPace: null, rules: [] }
  return {
    structure: [
      step('warmup', 1, warmSec, 'z1'),
      step('work', reps, repSec, 'z3'),
      step('recover', reps, recoverSec, 'z1'),
      step('cooldown', 1, coolSec, 'z1'),
    ],
    workPace: null,
    rules: [],
  }
}

/** A long run whose final fifth is at race pace [rules F long run with fast finish]. */
function buildFastFinish(minutes: number): Built {
  const totalSec = Math.round(minutes * 60)
  const finishSec = Math.round(totalSec * P.flib.fastFinishFraction.value)
  return {
    structure: [
      step('steady', 1, totalSec - finishSec, 'z1'),
      step('work', 1, finishSec, 'race-pace'),
    ],
    workPace: null,
    rules: [],
  }
}

/** Short run and walk units for novices and restarts. */
function buildRunWalk(minutes: number): Built {
  const run = P.flib.runWalkRunUnits.value
  const walk = P.flib.runWalkWalkUnits.value
  const reps = Math.floor(minutes / (run + walk))
  if (reps < 1) return { structure: [], workPace: null, rules: [] }
  return {
    structure: [step('work', reps, run * 60, 'z1'), step('recover', reps, walk * 60, 'z1')],
    workPace: null,
    rules: [],
  }
}

const secondsOf = (minutes: number) => Math.round(minutes * 60)

/**
 * A session of the run-walk ladder from its blueprint [rules E6]: the runs and the walking breaks
 * in order, between a walk before and a walk after that are outside the session minutes. Equal
 * run/walk pairs in a row become one pair of steps with a repeat count.
 */
function buildLadderSession(blueprint: readonly number[], minutes: number): Built {
  const bp = clipBlueprint(blueprint, minutes)
  const structure: Step[] = []
  if (bp.length === 1) {
    structure.push(step('steady', 1, secondsOf(bp[0]!), 'z1'))
  } else {
    let i = 0
    while (i < bp.length) {
      const run = bp[i]!
      const walk = bp[i + 1]
      if (walk === undefined) {
        structure.push(step('work', 1, secondsOf(run), 'z1'))
        break
      }
      let reps = 1
      while (bp[i + 2 * reps] === run && bp[i + 2 * reps + 1] === walk) reps += 1
      structure.push(
        step('work', reps, secondsOf(run), 'z1'),
        step('recover', reps, secondsOf(walk), 'z1'),
      )
      i += 2 * reps
    }
  }
  const frame = secondsOf(P.noviceLadder.walkFrameMin.value)
  return {
    structure,
    before: [step('warmup', 1, frame, 'z1')],
    after: [step('cooldown', 1, frame, 'z1')],
    workPace: null,
    rules: [],
  }
}

/** A blueprint in words: "run 1 min and walk 2 min, 7 times", or the steps in order. */
function describeBlueprint(blueprint: readonly number[]): string {
  if (!hasWalk(blueprint)) return `run ${String(blueprint[0] ?? 0)} minutes without stopping`
  const pairs: Array<[number, number | undefined]> = []
  for (let i = 0; i < blueprint.length; i += 2) pairs.push([blueprint[i]!, blueprint[i + 1]])
  const [first, firstWalk] = pairs[0]!
  if (pairs.length > 1 && pairs.every(([r, w]) => r === first && w === firstWalk)) {
    return `run ${String(first)} min and walk ${String(firstWalk)} min, ${String(pairs.length)} times`
  }
  return blueprint
    .map((v, i) => `${i % 2 === 0 ? 'run' : 'walk'} ${String(v)}`)
    .join(', ')
    .concat(' minutes')
}

/**
 * The one sentence of a strength session: the block week it is, or the maintenance. It names no
 * dose, which the week's template sets in the workout (a ramp-in or return week lifts lighter and
 * jumps not at all), and restates no Param [rules E5, F7].
 */
function strengthPurpose(week: WeekDraft, ctx: PrescribeContext): string {
  if (!week.flags.includes('strength-block')) {
    return 'Strength maintenance: a short session that keeps the strength of the legs and trunk while the running builds.'
  }
  const at = ctx.blockPosition
  const where =
    at === undefined || at === null
      ? 'Strength block'
      : `Strength block, week ${String(at.week)} of ${String(at.of)}`
  return `${where}: lifts for the legs and trunk, kept apart from the key runs.`
}

/** Distance of a session from its steps and paces; null without a pace to work from. */
function distanceFor(
  kind: SessionKind,
  minutes: number,
  structure: Step[],
  zones: ZoneSet,
  workPace: PaceRange | null,
  racePace: PaceRange | null,
): number | null {
  if (!RUN_KINDS.has(kind) && kind !== 'race') return null
  const easy = mid(zones.pace?.z1)
  const paceOfStep = (s: Step): number | null => {
    if (s.zone === 'race-pace') return mid(racePace ?? zones.pace?.z2)
    if (s.zone === 'strides') return mid(zones.pace?.z3)
    if (s.kind === 'work') {
      const zone = s.zone === 'z1' ? 'z1' : s.zone === 'z2' ? 'z2' : 'z3'
      return mid(workPace ?? zones.pace?.[zone])
    }
    return easy
  }
  let meters = 0
  if (structure.length === 0) {
    const pace = kind === 'race' || kind === 'race-pace' ? mid(racePace) : easy
    if (pace === null) return null
    meters = ((minutes * 60) / pace) * 1000
  } else {
    for (const s of structure) {
      const pace = paceOfStep(s)
      if (pace === null) return null
      meters += (((s.durationSec ?? 0) * s.reps) / pace) * 1000
    }
  }
  return roundTo(meters, 100)
}

/** What a ladder session asks for, in words; the walks around it are outside its minutes. */
function ladderPurpose(blueprint: readonly number[], week: WeekDraft): string {
  const rung = ladderRung(week.flags)
  const where =
    rung === null ? 'Run-walk session' : `Run-walk step ${String(rung)} of ${String(rungCount())}`
  const frame = P.noviceLadder.walkFrameMin.value
  return `${where}: ${describeBlueprint(blueprint)}, at an easy, talking pace. Walk ${String(frame)} minutes before and after; those walks are not counted in the session or the week.`
}

/** A session for a week, not yet dated: structure, targets, purpose and rules. */
export function prescribe(
  kind: SessionKind,
  minutes: number,
  zones: ZoneSet,
  week: WeekDraft,
  ctx: PrescribeContext = {},
): SessionSpec {
  const lib = sessionLibrary(kind)
  const duration = kind === 'rest' ? 0 : Math.round(minutes)
  const flags: SessionFlag[] = []
  const rules = [...lib.rules]
  let purpose = lib.purpose
  let title = TITLES[kind]
  let built: Built = { structure: [], workPace: null, rules: [] }

  switch (kind) {
    case 'threshold':
      built = buildThreshold(duration, zones, ctx)
      purpose = `Threshold work at or below critical speed minus ${built.margin ?? 0} km/h, as one bout or cruise intervals.`
      break
    case 'intervals':
      built = buildIntervals(duration, zones, ctx)
      break
    case 'race-pace':
      built = buildRacePace(duration, zones, ctx)
      break
    case 'strides':
      built = buildStrides(duration)
      break
    case 'hills':
      built = buildHills(duration)
      break
    case 'long-fast-finish':
      built = buildFastFinish(duration)
      break
    case 'strength':
      purpose = strengthPurpose(week, ctx)
      if (ctx.ultra === true) rules.push('H10')
      break
    default:
      if (ctx.blueprint !== undefined && kind === 'easy') {
        built = buildLadderSession(ctx.blueprint, duration)
        purpose = ladderPurpose(ctx.blueprint, week)
        const rung = ladderRung(week.flags)
        // only a session with a walking break is a run-walk session; a continuous run of 20 to
        // 30 minutes is an easy run, titled by its rung
        if (hasWalk(clipBlueprint(ctx.blueprint, duration))) {
          flags.push('run-walk')
          title = rung === null ? 'Run-walk' : `Run-walk, step ${String(rung)}`
        } else {
          title =
            rung === null ? 'Easy run' : `Ladder step ${String(rung)}: ${String(duration)} min easy`
        }
      } else if (ctx.runWalk && (kind === 'easy' || kind === 'recovery' || kind === 'long')) {
        built = buildRunWalk(duration)
        flags.push('run-walk')
      }
  }

  // The start paths [rules E6, G-3]: the weeks that begin a plan say which rules they rest on.
  const start =
    kind === 'easy' || kind === 'recovery' || kind === 'long' ? startKind(week.flags) : null
  if (start !== null) {
    rules.push('E6', 'A9')
    if (week.flags.includes('injury-return')) {
      flags.push('injury-return')
      rules.push('g-3')
      title = `Return to running, level ${String((injuryLevel(week.flags) ?? 0) + 1)}`
      purpose = `Return to running: ${String(duration)} minutes of continuous easy running with a rest day between runs. Stop and rest if pain returns; the next level waits until the run, the hours after it and the next day are symptom-free.`
    } else if (ctx.blueprint === undefined) {
      purpose = `Starting week: an easy run of ${String(duration)} minutes, ${String(P.restartFloor.sessions.value)} days a week and never longer than the longest recent run allows.`
    }
  }

  const has = (flag: string) => week.flags.includes(flag)
  let heatNote: string | null = null
  if (has('night') && kind === 'long') {
    flags.push('night')
    rules.push('H6')
  }
  if (has('downhill') && (kind === 'long' || kind === 'hills')) {
    flags.push('downhill')
    rules.push('H5')
  }
  if (has('heat-acclimation') && (kind === 'easy' || kind === 'recovery')) {
    flags.push('heat')
    rules.push('I8')
    heatNote =
      'Heat acclimation week: run this one easy and in the warm part of the day; effort, not pace, sets the limit.'
  }
  // 'b2b-day1' and 'b2b-day2' are set by micro.ts, which knows which day of the pair this is;
  // 'fuel-practice' is set there too, because the cap of rule H7 counts the runs of the week

  // Targets from the zone set; pace and HR recompute for display when the zones change
  const zoneKey = lib.zone
  const racePace: PaceRange | null =
    kind === 'race-pace' || kind === 'race'
      ? ctx.goalPaceSecPerKm != null
        ? bandAround(ctx.goalPaceSecPerKm)
        : kind === 'race-pace'
          ? (zones.pace?.z2 ?? null)
          : null
      : null
  let pace: PaceRange | null = null
  let hr: [number, number] | null = null
  if (zoneKey === 'z1' || zoneKey === 'z2' || zoneKey === 'z3') {
    hr = zones.hr?.[zoneKey] ?? null
    pace = zones.pace?.[zoneKey] ?? null
  }
  if (kind === 'threshold' || kind === 'intervals') {
    pace = built.workPace
    hr = kind === 'threshold' ? (zones.hr?.z2 ?? null) : null
  } else if (kind === 'race-pace') {
    pace = racePace
    hr = zones.hr?.z2 ?? null
  } else if (kind === 'race') {
    pace = racePace
  } else if (kind === 'hills' || kind === 'hike') {
    pace = null
    hr = kind === 'hike' ? (zones.hr?.z1 ?? null) : null
  } else if (kind === 'cross') {
    pace = null
  }

  const runDistance =
    kind === 'hike' || kind === 'cross'
      ? null
      : distanceFor(kind, duration, built.structure, zones, built.workPace, racePace)
  const gainM =
    RUN_KINDS.has(kind) && week.gainTargetM !== null && week.targetRunMin > 0
      ? roundTo((week.gainTargetM * duration) / week.targetRunMin, 10)
      : null

  return {
    date: '',
    order: 0,
    kind,
    title,
    durationMin: duration,
    distanceM: runDistance,
    gainM,
    structure: [...(built.before ?? []), ...built.structure, ...(built.after ?? [])],
    target: { zone: zoneKey, rpe: lib.rpe, hr, paceSecPerKm: pace, heatNote },
    purpose,
    rules: [...new Set([...rules, ...built.rules])],
    flags,
  }
}

// The weeks of a start path [rules E6, G-3]: the run-walk ladder, the 3 x N floor and the
// injury-return ladder, as data that the macrocycle, the week placement, the session builder, the
// guards and the checklist share. Pure and light on imports: only the parameters and types, so the
// modules that place and check weeks can read it without a cycle.
//
// A start week is told apart by its flags, which survive the stored plan (`PlanWeek.flags`):
//   restart-floor        the first week of any start path
//   run-walk, ladder-<n> a week of the run-walk ladder at rung n (1-based)
//   injury-return, injury-level-<n>  a week of the injury-return ladder at level index n (0-based)
// and by the flags of its sessions: `run-walk` on a ladder session that holds a walking break,
// `injury-return` on the sessions of an injury-return week (`isLadderSession` tells a continuous
// ladder run).
import { P } from './params/index.ts'
import type { RampExemption } from './limits.ts'
import type { SessionSpec, WeekDraft } from './types.ts'

/** Where a runner starts: the result of the start-path rules (macro.ts `startPath`). */
export type StartPath =
  | { kind: 'ladder'; rung: number; bmiHold: boolean }
  | { kind: 'floor'; sessionMin: number }
  | { kind: 'injury-return'; level: number }

export type StartKind = StartPath['kind']

/** The flag of a ladder week at `rung`. */
export const ladderFlag = (rung: number): string => `ladder-${String(rung)}`
/** The flag of an injury-return week at level index `level`. */
export const injuryLevelFlag = (level: number): string => `injury-level-${String(level)}`

function numberedFlag(flags: readonly string[], prefix: string): number | null {
  for (const flag of flags) {
    if (!flag.startsWith(prefix)) continue
    const n = Number(flag.slice(prefix.length))
    if (Number.isInteger(n) && n >= 0) return n
  }
  return null
}

/** The rung of a ladder week (1-based), or null for any other week. */
export const ladderRung = (flags: readonly string[]): number | null =>
  numberedFlag(flags, 'ladder-')

/** The level index of an injury-return week (0-based), or null for any other week. */
export const injuryLevel = (flags: readonly string[]): number | null =>
  numberedFlag(flags, 'injury-level-')

/** A week whose sessions a programme sets: a ladder week or an injury-return week. */
export const isProgrammeWeek = (flags: readonly string[]): boolean =>
  ladderRung(flags) !== null || flags.includes('injury-return')

/** The kind of start path a week belongs to; the floor week is the first week of a 3 x N start. */
export function startKind(flags: readonly string[]): StartKind | null {
  if (ladderRung(flags) !== null) return 'ladder'
  if (flags.includes('injury-return')) return 'injury-return'
  if (flags.includes('restart-floor')) return 'floor'
  return null
}

/** How many rungs the ladder has. */
export const rungCount = (): number => P.noviceLadder.rungs.value.length

/** Minutes of a blueprint: its runs and its walks. */
export const blueprintMin = (blueprint: readonly number[]): number =>
  blueprint.reduce((sum, v) => sum + v, 0)

/** The minutes a session of this blueprint is planned and counted at: whole minutes. */
export const sessionMin = (blueprint: readonly number[]): number =>
  Math.round(blueprintMin(blueprint))

/**
 * The blueprint cut to at most `maxMin`: the leading steps stay and the step that crosses the
 * limit is shortened. A session is the lesser of the rung and the G-1 bound [rules E6, g-1].
 */
export function clipBlueprint(blueprint: readonly number[], maxMin: number): number[] {
  if (!Number.isFinite(maxMin)) return [...blueprint]
  const out: number[] = []
  let used = 0
  for (const v of blueprint) {
    if (used + v <= maxMin + 1e-9) {
      out.push(v)
      used += v
      continue
    }
    const left = maxMin - used
    if (left > 1e-9) out.push(left)
    break
  }
  return out
}

/**
 * The blueprints cut together to at most `maxMin` minutes in all, each keeping its share: a start
 * week never holds more than the 2-week ceiling of G-2 lets it [rules E6, g-2]. The whole minutes
 * of the budget are all used (the largest remainders round up, the later and longer session first),
 * so fitting the sessions of a week to the minutes it came out at gives the same sessions again.
 */
export function fitBlueprints(blueprints: number[][], maxMin: number): number[][] {
  const lengths = blueprints.map(sessionMin)
  const total = lengths.reduce((a, b) => a + b, 0)
  if (!Number.isFinite(maxMin) || total <= maxMin + 1e-9) return blueprints
  const budget = Math.floor(Math.max(0, maxMin) + 1e-9)
  const raw = lengths.map((len) => (len * budget) / total)
  const sizes = raw.map((r) => Math.floor(r + 1e-9))
  let left = budget - sizes.reduce((a, b) => a + b, 0)
  const order = raw
    .map((_, i) => i)
    .sort((a, b) => raw[b]! - sizes[b]! - (raw[a]! - sizes[a]!) || b - a)
  for (const i of order) {
    if (left <= 0) break
    if (sizes[i]! < lengths[i]!) {
      sizes[i]! += 1
      left -= 1
    }
  }
  return blueprints.map((bp, i) => clipBlueprint(bp, sizes[i]!))
}

/** The three sessions of a rung: a rung with fewer blueprints repeats them. */
export function rungSessions(rung: number): number[][] {
  const rungs = P.noviceLadder.rungs.value
  const sessions = rungs[Math.min(Math.max(rung, 1), rungs.length) - 1] ?? []
  const wanted = P.restartFloor.sessions.value
  return Array.from({ length: wanted }, (_, i) => [...sessions[i % sessions.length]!])
}

/**
 * Whether a session belongs to the run-walk ladder, a continuous run of the upper rungs included:
 * among easy runs only the ladder opens with the framing walk, a warm-up step of walking. The
 * `run-walk` flag marks only the sessions that hold a walking break, so it cannot tell.
 */
export const isLadderSession = (s: Pick<SessionSpec, 'kind' | 'structure'>): boolean =>
  s.kind === 'easy' && s.structure[0]?.kind === 'warmup'

/** Whether the blueprint holds a walk (it is a run-walk session, not a continuous run). */
export const hasWalk = (blueprint: readonly number[]): boolean => blueprint.length > 1

/** The longest running bout of a blueprint, in minutes. */
export function longestBout(blueprint: readonly number[]): number {
  return blueprint.reduce((m, v, i) => (i % 2 === 0 ? Math.max(m, v) : m), 0)
}

/** One planned week of a start path. */
export interface StartWeek {
  kind: StartKind
  /** Ladder rung (1-based), floor session length in minutes, or injury-return level index. */
  step: number
  /** The sessions of the week, as run/walk minutes in order (a continuous run is one number). */
  sessions: number[][]
  /** Minutes of the week: the sessions as planned, walks within them included. */
  minutes: number
  /** The longest session, which enters the 30-day reference of the runs after it. */
  longest: number
  /** Minutes of the step's own week, its sessions at full length. */
  fullMinutes: number
  /** True when a limit left a session shorter than its step, or left one out. */
  clipped: boolean
  /** Week flags: `run-walk`/`ladder-<n>`, `injury-return`/`injury-level-<n>`; `restart-floor` is added by the caller for the first week. */
  flags: string[]
  focus: string
}

const DAY_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']

/**
 * What a start week says about itself, from the sessions it holds: the days, the longest session
 * and, where a limit cut it short of the step, the length it works toward. No word of falling
 * behind. `repeat` words a step that is repeated.
 */
export function startFocus(
  kind: StartKind,
  step: number,
  held: { days: number; longest: number; fullLongest: number; repeat: boolean },
): string {
  const cut = held.longest < held.fullLongest
  const days = DAY_WORDS[held.days] ?? String(held.days)
  const toward = `${String(held.longest)} min this week, working toward ${String(held.fullLongest)} min`
  if (kind === 'ladder') {
    const where = `Run-walk step ${String(step)} of ${String(rungCount())}`
    const tail = cut ? `; sessions of up to ${toward}` : ''
    return held.repeat
      ? `${where}: repeating the step before moving on${tail}`
      : `${where}: short runs with walking breaks, ${days} days a week${tail}`
  }
  if (kind === 'injury-return') {
    const levels = P.injuryReturn.levelsMin.value
    const where = `Return to running, level ${String(step + 1)} of ${String(levels.length)}`
    if (held.repeat) return `${where}: repeating the level${cut ? `, ${toward}` : ''}`
    return cut
      ? `${where}: ${toward} of easy running, with a rest day between runs`
      : `${where}: ${String(levels[step])} minutes of easy running, with a rest day between runs`
  }
  const runs = held.days > 0 ? held.days : P.restartFloor.sessions.value
  return `Starting week: ${String(runs)} easy runs of ${String(held.longest > 0 ? held.longest : step)} minutes`
}

/**
 * The focus of a start week from the sessions placed in it, which can be fewer or shorter than the
 * programme drew (too few open days, a limit): the words of `startFocus` with the placed days and
 * longest session. A week that is no start week keeps its focus.
 */
export function placedFocus(
  week: Pick<WeekDraft, 'flags' | 'focus'>,
  placed: { days: number; longest: number },
): string {
  const kind = startKind(week.flags)
  if (kind === null) return week.focus
  const repeat = week.focus.includes('repeating')
  if (kind === 'ladder') {
    const rung = ladderRung(week.flags)!
    const fullLongest = Math.max(...rungSessions(rung).map(sessionMin))
    return startFocus(kind, rung, { ...placed, fullLongest, repeat })
  }
  if (kind === 'injury-return') {
    const level = injuryLevel(week.flags) ?? 0
    const fullLongest = P.injuryReturn.levelsMin.value[level] ?? placed.longest
    return startFocus(kind, level, { ...placed, fullLongest, repeat })
  }
  return startFocus(kind, placed.longest, { ...placed, fullLongest: placed.longest, repeat })
}

/**
 * The shortest session of the ladders: the first level of the injury-return ladder, 5 minutes. A
 * ladder or injury-return session is set by its programme and held to the G-1 bound, so it is
 * exempt from the 15-minute run day minimum and is placed at the bound instead of being dropped.
 */
export const startSessionMinMin = (): number => P.injuryReturn.levelsMin.value[0] ?? 0

/** The shortest session each kind of start week keeps; a session cut under it is left out. */
export function minSession(kind: StartKind): number {
  if (kind === 'floor') return P.fplace.easyRunMinMin.value
  return startSessionMinMin()
}

/**
 * The week of a start path at `step`, with every session held to `capMin`, the longest a session
 * may be against the 30-day reference (G-1 is a hard limit in a start path), and the week to
 * `weekMaxMin` in all (the 2-week ceiling of G-2). `repeat` words the focus for a rung that is
 * repeated. A session the limit cuts is placed at the limit, never under the shortest start
 * session (5 minutes), and the focus says what the week works toward.
 */
export function startWeek(
  kind: StartKind,
  step: number,
  capMin = Infinity,
  repeat = false,
  weekMaxMin = Infinity,
): StartWeek {
  let blueprints: number[][]
  let flags: string[]
  let at = step
  if (kind === 'ladder') {
    blueprints = rungSessions(step)
    flags = ['run-walk', ladderFlag(step)]
  } else if (kind === 'injury-return') {
    const levels = P.injuryReturn.levelsMin.value
    at = Math.min(Math.max(step, 0), levels.length - 1)
    blueprints = Array.from({ length: P.injuryReturn.repeatsPerLevel.value }, () => [levels[at]!])
    flags = ['injury-return', injuryLevelFlag(at)]
  } else {
    blueprints = Array.from({ length: P.restartFloor.sessions.value }, () => [step])
    flags = []
  }
  const floorMin = minSession(kind)
  const sessions = fitBlueprints(
    blueprints.map((bp) => clipBlueprint(bp, capMin)),
    weekMaxMin,
  ).filter((bp) => sessionMin(bp) >= floorMin)
  const lengths = sessions.map(sessionMin)
  const full = blueprints.map(sessionMin)
  const minutes = lengths.reduce((a, b) => a + b, 0)
  const longest = Math.max(0, ...lengths)
  return {
    kind,
    step: at,
    sessions,
    minutes,
    longest,
    fullMinutes: full.reduce((a, b) => a + b, 0),
    clipped: minutes < full.reduce((a, b) => a + b, 0),
    flags,
    focus: startFocus(kind, at, {
      days: sessions.length,
      longest,
      fullLongest: Math.max(0, ...full),
      repeat,
    }),
  }
}

/** The last step of a programme: the last rung, the last level index, or the floor's one step. */
function lastStep(kind: StartKind, step: number): number {
  if (kind === 'ladder') return rungCount()
  if (kind === 'injury-return') return P.injuryReturn.levelsMin.value.length - 1
  return step
}

/** The shape of a start path that its weeks are counted from. */
export interface StepPath {
  kind: StartKind
  step: number
  /** Weeks still held at `step` by the BMI rule, counting the first. */
  holdWeeks?: number
  /** A progression hold: the step never rises and the floor repeats [rules n-1, n-4, J5]. */
  frozen?: boolean
}

/**
 * The steps of the weeks of a start path, one per week up to `weeks`: a ladder rung or injury
 * level week by week from `path.step` (held for `holdWeeks` weeks first), the floor for its one
 * week. A step rises only when the week drawn at it ran at its own length: `clipped(i, step)` says
 * that week `i` at `step` was held short of the step by a limit, and the step then repeats, so the
 * programme ends only after its last step has been run at its own length [rules E6, G-3]. A
 * frozen path repeats its step in every week. `finished` is true when the programme ends before
 * `weeks` run out.
 */
export function stepSchedule(
  path: StepPath,
  weeks: number,
  clipped: (i: number, step: number) => boolean = () => false,
): { steps: number[]; finished: boolean } {
  const steps: number[] = []
  const last = lastStep(path.kind, path.step)
  let step = path.step
  let hold = path.holdWeeks ?? 0
  while (steps.length < weeks) {
    if (step > last) return { steps, finished: true }
    const i = steps.length
    steps.push(step)
    if (path.frozen === true) continue
    if (hold > 1) hold -= 1
    else if (!clipped(i, step)) step += 1
  }
  return { steps, finished: step > last }
}

/**
 * The step of the `i`-th week of a start path (0-based), counting on to the end of the programme
 * with no limit to hold a step short: a ladder week by week from `rung` (held at `rung` for
 * `holdWeeks` weeks first), the floor for its one week, an injury-return level week by week. Null
 * past the end.
 */
export function stepAt(path: StepPath, i: number): number | null {
  return stepSchedule(path, i + 1).steps[i] ?? null
}

/** The weeks of a start path that follow a fixed programme, and what each is exempt from. */
export function startExemptions(weeks: readonly WeekDraft[]): Map<string, RampExemption> {
  const out = new Map<string, RampExemption>()
  for (const w of weeks) {
    if (ladderRung(w.flags) !== null) out.set(w.weekStart, 'soft')
    else if (w.flags.includes('injury-return')) out.set(w.weekStart, 'ramp')
  }
  return out
}

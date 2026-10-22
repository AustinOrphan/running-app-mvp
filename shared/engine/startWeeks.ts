// The weeks of a start path [rules E6, G-3]: the run-walk ladder, the 3 x N floor and the
// injury-return ladder, as data that the macrocycle, the week placement, the session builder, the
// guards and the checklist share. Pure and light on imports: only the parameters and types, so the
// modules that place and check weeks can read it without a cycle.
//
// A start week is told apart by its flags, which survive the stored plan (`PlanWeek.flags`):
//   restart-floor        the first week of any start path
//   run-walk, ladder-<n> a week of the run-walk ladder at rung n (1-based)
//   injury-return, injury-level-<n>  a week of the injury-return ladder at level index n (0-based)
import { P } from './params/index.ts'
import type { RampExemption } from './limits.ts'
import type { WeekDraft } from './types.ts'

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
 * week never holds more than the 2-week ceiling of G-2 lets it [rules E6, g-2].
 */
export function fitBlueprints(blueprints: number[][], maxMin: number): number[][] {
  const lengths = blueprints.map(sessionMin)
  const total = lengths.reduce((a, b) => a + b, 0)
  if (!Number.isFinite(maxMin) || total <= maxMin + 1e-9) return blueprints
  const factor = Math.max(0, maxMin) / total
  return blueprints.map((bp, i) => clipBlueprint(bp, Math.floor(lengths[i]! * factor + 1e-9)))
}

/** The three sessions of a rung: a rung with fewer blueprints repeats them. */
export function rungSessions(rung: number): number[][] {
  const rungs = P.noviceLadder.rungs.value
  const sessions = rungs[Math.min(Math.max(rung, 1), rungs.length) - 1] ?? []
  const wanted = P.restartFloor.sessions.value
  return Array.from({ length: wanted }, (_, i) => [...sessions[i % sessions.length]!])
}

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
  /** Week flags: `run-walk`/`ladder-<n>`, `injury-return`/`injury-level-<n>`; `restart-floor` is added by the caller for the first week. */
  flags: string[]
  focus: string
}

/** The shortest session each kind of start week keeps; a session cut under it is left out. */
export function minSession(kind: StartKind): number {
  if (kind === 'ladder') return P.fplace.minRunDayMin.value
  if (kind === 'injury-return') return P.injuryReturn.levelsMin.value[0] ?? 0
  return P.fplace.easyRunMinMin.value
}

/**
 * The week of a start path at `step`, with every session held to `capMin`, the longest a session
 * may be against the 30-day reference (G-1 is a hard limit in a start path), and the week to
 * `weekMaxMin` in all (the 2-week ceiling of G-2). `repeat` words the focus for a rung that is
 * repeated.
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
  let focus: string
  if (kind === 'ladder') {
    const total = rungCount()
    blueprints = rungSessions(step)
    flags = ['run-walk', ladderFlag(step)]
    focus = repeat
      ? `Run-walk step ${String(step)} of ${String(total)}: repeating the step before moving on`
      : `Run-walk step ${String(step)} of ${String(total)}: short runs with walking breaks, three days a week`
  } else if (kind === 'injury-return') {
    const levels = P.injuryReturn.levelsMin.value
    const level = Math.min(Math.max(step, 0), levels.length - 1)
    blueprints = Array.from({ length: P.injuryReturn.repeatsPerLevel.value }, () => [
      levels[level]!,
    ])
    flags = ['injury-return', injuryLevelFlag(level)]
    focus = repeat
      ? `Return to running, level ${String(level + 1)} of ${String(levels.length)}: repeating the level`
      : `Return to running, level ${String(level + 1)} of ${String(levels.length)}: ${String(levels[level])} minutes of easy running, with a rest day between runs`
  } else {
    blueprints = Array.from({ length: P.restartFloor.sessions.value }, () => [step])
    flags = []
    focus = `Starting week: ${String(P.restartFloor.sessions.value)} easy runs of ${String(step)} minutes`
  }
  const floorMin = minSession(kind)
  const sessions = fitBlueprints(
    blueprints.map((bp) => clipBlueprint(bp, capMin)),
    weekMaxMin,
  ).filter((bp) => sessionMin(bp) >= floorMin)
  const lengths = sessions.map(sessionMin)
  return {
    kind,
    step,
    sessions,
    minutes: lengths.reduce((a, b) => a + b, 0),
    longest: Math.max(0, ...lengths),
    flags,
    focus,
  }
}

/**
 * The step of the `i`-th week of a start path (0-based), counting on to the end of the programme:
 * a ladder week by week from `rung` (held at `rung` for `holdWeeks` weeks first), the floor for
 * its one week, an injury-return level week by week. Null past the end.
 */
export function stepAt(
  path: { kind: StartKind; step: number; holdWeeks?: number },
  i: number,
): number | null {
  if (path.kind === 'floor') return i === 0 ? path.step : null
  const held = Math.max((path.holdWeeks ?? 0) - 1, 0)
  const step = path.step + Math.max(0, i - held)
  const last = path.kind === 'ladder' ? rungCount() : P.injuryReturn.levelsMin.value.length - 1
  return step <= last ? step : null
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

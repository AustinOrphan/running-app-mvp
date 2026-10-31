// Synthetic fixtures of the strength engine tests (E14-4): a plan of Mondays, a runner with
// equipment and logs, and the logged sets of a lift. No real history, equipment or names.
import { addDays } from '../../../shared/dates.ts'
import { toGrams } from '../../../shared/domain/weight.ts'
import type {
  LoggedSet,
  StrengthContext,
  StrengthLogEntry,
  StrengthPlannedSession,
  StrengthSessionRef,
  StrengthWeek,
} from '../../../shared/engine/types.ts'
import type { EquipmentConfig, EquipmentKind } from '../../../shared/types.ts'

/** Whole pounds as grams, the way a stored load is. */
export const lb = (pounds: number): number => toGrams(pounds, 'lb')

/** A Monday. Week `i` of the synthetic plan starts `i` weeks after it. */
export const FIRST_MONDAY = '2026-01-05'
export const monday = (i: number): string => addDays(FIRST_MONDAY, 7 * i)

export function week(i: number, over: Partial<StrengthWeek> = {}): StrengthWeek {
  return {
    weekStart: monday(i),
    flags: [],
    phase: 'base',
    isRecovery: false,
    plannedRunMin: 300,
    runMin: 300,
    ...over,
  }
}

/** A plan of `count` weeks whose first `block` weeks carry the block flag. */
export function plan(count: number, block: number): StrengthWeek[] {
  return Array.from({ length: count }, (_, i) =>
    week(i, { flags: i < block ? ['strength-block'] : [] }),
  )
}

/** Two sessions a week, on the second and fifth day, for the first `count` weeks. */
export function sessionsOf(count: number): StrengthPlannedSession[] {
  return Array.from({ length: count }, (_, i) => [
    { id: `s${String(i)}a`, date: addDays(monday(i), 1), order: 1 },
    { id: `s${String(i)}b`, date: addDays(monday(i), 4), order: 1 },
  ]).flat()
}

/** Session A (`rank` 0) or B (`rank` 1) of week `i`, with the rules a planned session carries. */
export function sessionRef(
  i: number,
  rank: 0 | 1 = 0,
  over: Partial<StrengthSessionRef> = {},
): StrengthSessionRef {
  return {
    id: `s${String(i)}${rank === 0 ? 'a' : 'b'}`,
    date: addDays(monday(i), rank === 0 ? 1 : 4),
    order: 1,
    durationMin: 40,
    rules: ['F-lib', 'F4', 'E5', 'F7'],
    ...over,
  }
}

/** One item of each kind of equipment, in pounds. */
export const ITEM: Readonly<Record<EquipmentKind, EquipmentConfig>> = {
  barbell: { kind: 'barbell', barG: lb(45), jumpG: lb(5) },
  dumbbells: {
    kind: 'dumbbells',
    loads: { loadsG: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60].map(lb) },
  },
  kettlebells: { kind: 'kettlebells', loads: { loadsG: [18, 26, 35, 44].map(lb) } },
  bands: { kind: 'bands' },
  step: { kind: 'step' },
  'leg-press': { kind: 'leg-press', stepG: lb(10), maxG: lb(300) },
  'calf-machine': { kind: 'calf-machine', stepG: lb(10), maxG: lb(200) },
  'leg-curl': { kind: 'leg-curl', stepG: lb(10), maxG: lb(150) },
}
export const ALL_KINDS = Object.keys(ITEM) as EquipmentKind[]
export const have = (...kinds: EquipmentKind[]): EquipmentConfig[] =>
  kinds.map((kind) => ITEM[kind])

/** A runner in week 6 of a 12-week block, setup saved, 70 kg, no equipment, nothing logged. */
export function context(over: Partial<StrengthContext> = {}): StrengthContext {
  return {
    today: addDays(monday(5), 2),
    weightUnit: 'lb',
    setup: {
      saved: true,
      equipment: [],
      level: 'some',
      currentlyLifting: false,
      avoid: [],
      pinned: {},
    },
    anchors: [],
    logs: [],
    weeks: plan(30, 12),
    sessions: sessionsOf(30),
    athlete: { age: 35, weightKg: 70, risk: { priorBsi: false, recentInjury: false } },
    goal: { paceKmh: null },
    readiness: null,
    ...over,
  }
}

/** A context with the setup changed and the rest as `context` makes it. */
export function withSetup(
  setup: Partial<StrengthContext['setup']>,
  over: Partial<StrengthContext> = {},
): StrengthContext {
  const base = context()
  return { ...base, ...over, setup: { ...base.setup, ...setup } }
}

export function log(
  id: string,
  date: string,
  over: Partial<StrengthLogEntry> = {},
): StrengthLogEntry {
  return { id, date, mode: 'normal', template: null, sets: [], lifts: [], ...over }
}

/** One row of a lift: the load in pounds (null for none), the count and the reps left (or null). */
export type Row = readonly [pounds: number | null, count: number, rir: number | null]

/** The logged sets of one exercise, in the order of the rows. */
export function setsOf(exerciseId: string, rows: readonly Row[], from = 0): LoggedSet[] {
  return rows.map(([pounds, count, rir], i) => ({
    exerciseId,
    position: from + i,
    loadG: pounds === null ? null : lb(pounds),
    count,
    rir,
  }))
}

/**
 * A log of one lift. With `implement` given, the snapshot of the lift is recorded too, as the
 * sheet records it; without it the log carries no snapshot, which the engine reads as "any
 * implement".
 */
export function liftLog(
  id: string,
  date: string,
  exerciseId: string,
  rows: readonly Row[],
  over: Partial<StrengthLogEntry> & {
    implement?: EquipmentKind | null
    baseLb?: number | null
  } = {},
): StrengthLogEntry {
  const { implement, baseLb, ...entry } = over
  return log(id, date, {
    sets: setsOf(exerciseId, rows),
    lifts:
      implement === undefined
        ? []
        : [
            {
              exerciseId,
              implement,
              baseLoadG: baseLb === undefined || baseLb === null ? null : lb(baseLb),
            },
          ],
    ...entry,
  })
}

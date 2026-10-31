// What the strength logging sheet holds between taps, and the plain functions that turn it into a
// request: what "As suggested" and "Same as last time" fill, what a stepper press does, what a swap
// puts in a lift's place, and the log the sheet sends. No React and no requests here, so the rules
// are readable on their own (the draft kept on the device is `strengthDraft.ts`).
//
// A load is typed in the runner's weight unit and kept in grams. The text is what the field holds
// (a half-typed number is not lost); `exactG` is the gram count the text was made from, so a load
// that came from the rules, from a button or from the last session is sent as the very gram it is,
// and only a load typed over is read from its text (`shared/domain/weight.ts` does the conversion).
import { STRENGTH_TEMPLATES } from '../../../shared/copy/strengthTemplates.ts'
import {
  exerciseById,
  loadMeaning,
  substitutes,
  usableImplements,
  type ExerciseId,
  type Measure,
} from '../../../shared/domain/strengthLibrary.ts'
import {
  fromGrams,
  lightestLoad,
  stepFrom,
  stepsFor,
  toGrams,
} from '../../../shared/domain/weight.ts'
import { barbellAllowed, modeOf, structuresFor } from '../../../shared/engine/strength.ts'
import {
  STRENGTH_COUNT_MAX,
  STRENGTH_DURATION_MAX_MIN,
  STRENGTH_LOAD_MAX_G,
  STRENGTH_SETS_MAX,
} from '../../../shared/limits.ts'
import type {
  EquipmentConfig,
  EquipmentKind,
  LiftEvidence,
  StrengthLog,
  StrengthSet,
  StrengthSnapshot,
  StrengthSnapshotLift,
  StrengthWorkout,
  WeightUnit,
  WorkoutLift,
} from '../../../shared/types.ts'
import type { ActivityInput } from '../../api/activities.ts'
import type { StrengthLogBody, StrengthSetBody } from '../../api/strength.ts'
import type { OutboxEntry } from '../../pwa/outbox.ts'
import { usualLoadOf } from './workoutRows.ts'

/** How far a count stepper moves in one press: by one rep, five seconds, ten ground contacts. */
export const COUNT_STEP: Readonly<Record<Measure, number>> = { reps: 1, seconds: 5, contacts: 10 }

/** The top of the reps-left scale (0 to this, where this means this many or more). */
export const REPS_LEFT_MAX = 5
/** The effort and pain scales of the footer. */
export const EFFORT_SCALE = { min: 1, max: 10 } as const
export const PAIN_SCALE = { min: 0, max: 10 } as const

// ---- State -------------------------------------------------------------------------------------

/** One set of the sheet. */
export interface SetRow {
  /** The load as typed, in the runner's unit; empty is none. */
  load: string
  /** The grams `load` shows when it was set by the rules, a button or the last session. */
  exactG?: number | null
  /** The count as typed: reps, seconds or contacts. */
  count: string
  /** Reps left, 0 to `REPS_LEFT_MAX`; null when not recorded. */
  rir: number | null
}

export type BlockKind = 'lift' | 'plyo' | 'trunk'

/** One exercise of the sheet and its sets. */
export interface Block {
  /** The exercise the workout held here: stable across a swap, and the key of the draft. */
  key: string
  kind: BlockKind
  /** The lift as shown: the workout's, or the one a swap put in its place. */
  shown: WorkoutLift
  /** The workout's own lift, which a swap can return to. */
  original: WorkoutLift
  rows: SetRow[]
}

/** Everything the runner has entered. */
export interface FormState {
  blocks: Block[]
  /** The minutes as typed. */
  minutes: string
  effort: number | null
  pain: number | null
  notes: string
}

// ---- Loads and counts as text ------------------------------------------------------------------

/** A load as the field holds it: "115", "47.5", or nothing for no load. */
export function loadText(grams: number | null, unit: WeightUnit): string {
  return grams === null ? '' : String(fromGrams(grams, unit))
}

/**
 * The grams a typed load means: null for an empty field or a zero (no added load), `'invalid'` for
 * anything that is not a number from zero up to the heaviest load the API stores.
 */
export function parseLoad(text: string, unit: WeightUnit): number | null | 'invalid' {
  const typed = text.trim().replace(',', '.')
  if (typed === '') return null
  if (!/^\d+(?:\.\d+)?$/.test(typed)) return 'invalid'
  const grams = toGrams(Number(typed), unit)
  if (!Number.isFinite(grams) || grams > STRENGTH_LOAD_MAX_G) return 'invalid'
  return grams === 0 ? null : grams
}

/** The grams of a row's load: the exact ones while the text is still what they were made into. */
export function rowLoadG(row: SetRow, unit: WeightUnit): number | null | 'invalid' {
  if (row.exactG !== undefined && row.load === loadText(row.exactG, unit)) {
    return row.exactG === 0 ? null : row.exactG
  }
  return parseLoad(row.load, unit)
}

/**
 * A row whose load was typed in `from`, as the same grams shown in `to`. A load that was not a number
 * is left as typed. The row's exact grams stay what they were.
 */
export function inUnit(row: SetRow, from: WeightUnit, to: WeightUnit): SetRow {
  if (from === to) return row
  const grams = rowLoadG(row, from)
  if (grams === 'invalid') return row
  return { ...row, load: loadText(grams, to), exactG: grams }
}

/** A count typed as a whole number from one up to the largest the API stores; null otherwise. */
export function parseCount(text: string): number | null {
  const typed = text.trim()
  if (!/^\d+$/.test(typed)) return null
  const n = Number(typed)
  return n >= 1 && n <= STRENGTH_COUNT_MAX ? n : null
}

/** Minutes typed as a whole number the API accepts; null otherwise. */
export function parseMinutes(text: string): number | null {
  const typed = text.trim()
  if (!/^\d+$/.test(typed)) return null
  const n = Number(typed)
  return n >= 1 && n <= STRENGTH_DURATION_MAX_MIN ? n : null
}

// ---- Building the sheet ------------------------------------------------------------------------

/** The count to aim at in set `index` of a lift: its target, else the last one, else the range's start. */
function targetOf(lift: WorkoutLift, index: number): number {
  return lift.targets[index] ?? lift.targets.at(-1) ?? lift.range.min
}

function rowOf(lift: WorkoutLift, index: number, unit: WeightUnit, rir: number | null): SetRow {
  return {
    load: loadText(lift.loadG, unit),
    exactG: lift.loadG,
    count: String(targetOf(lift, index)),
    rir,
  }
}

/** The sets a lift suggests: its load, its target in each set, and `rir` reps left in all. */
export function rowsOf(lift: WorkoutLift, unit: WeightUnit, rir: number | null): SetRow[] {
  return Array.from({ length: lift.sets }, (_, index) => rowOf(lift, index, unit, rir))
}

/**
 * The history behind a load that the sheet itself made: none. A jump dose and a swapped lift were
 * not read from the logs here, so the sheet names no session for them (the server's explanation
 * of a swapped lift reads its own).
 */
const NO_EVIDENCE: LiftEvidence = { latest: null, judged: null, estimateG: null }

/**
 * The jump dose as a lift of one set: the count is the contacts of the dose, and there is no load
 * and no effort target. Only the sheet reads it; a log snapshot holds no jumps.
 */
function jumpLift(movement: string, contacts: number): WorkoutLift {
  return {
    exerciseId: movement,
    slot: 'plyo',
    implement: null,
    sets: 1,
    range: { min: contacts, max: contacts },
    targets: [contacts],
    loadG: null,
    steps: null,
    rir: null,
    change: 'hold',
    usualLoadG: null,
    basis: { rule: 'F7', facts: [] },
    evidence: NO_EVIDENCE,
  }
}

function blockOf(kind: BlockKind, lift: WorkoutLift, unit: WeightUnit): Block {
  return {
    key: lift.exerciseId,
    kind,
    shown: lift,
    original: lift,
    // the reps left of a set the runner has not judged are not recorded (design 9.1)
    rows: rowsOf(lift, unit, null),
  }
}

/**
 * The sheet a workout opens as: the lifts, the jump dose and the trunk movements, each filled with
 * its suggested load and target in every set, and no reps left (that is what "As suggested" adds).
 */
export function blocksOf(workout: StrengthWorkout, unit: WeightUnit): Block[] {
  const jumps = workout.plyo
  return [
    ...workout.lifts.map((lift) => blockOf('lift', lift, unit)),
    ...(jumps === null
      ? []
      : jumps.movements.map((movement) =>
          blockOf('plyo', jumpLift(movement, jumps.contacts), unit),
        )),
    ...workout.trunk.map((lift) => blockOf('trunk', lift, unit)),
  ]
}

/** The sheet as it opens: the workout, the minutes it planned, and nothing else entered. */
export function initialState(workout: StrengthWorkout, unit: WeightUnit): FormState {
  return {
    blocks: blocksOf(workout, unit),
    minutes: String(workout.budgetMin),
    effort: null,
    pain: null,
    notes: '',
  }
}

// ---- Editing a saved log -----------------------------------------------------------------------

/** What kind of block an exercise of a saved log is: by the slot it fills in the catalogue. */
function blockKindOf(slot: WorkoutLift['slot']): BlockKind {
  return slot === 'plyo' ? 'plyo' : slot === 'trunk' ? 'trunk' : 'lift'
}

/**
 * The workout a saved log is edited as: the exercises of its sets, in the order they were logged,
 * each as the log's snapshot showed it (its implement, range, reps left and reason) with the steps
 * the saved equipment makes now, so a load stepper moves on the rungs the runner has. It stands for
 * no planned session (`sessionId` is the log's own id, which only the draft's key reads) and is
 * never saved: an edit sends the snapshot the log already holds.
 */
export function workoutOfLog(
  log: StrengthLog,
  equipment: readonly EquipmentConfig[] | null,
  unit: WeightUnit,
): StrengthWorkout {
  const logged = [...log.sets].sort((a, b) => a.position - b.position)
  const ids = [...new Set(logged.map((set) => set.exerciseId))]
  const lifts = ids.map((exerciseId): WorkoutLift => {
    const shown = log.prescribed.lifts.find((lift) => lift.exerciseId === exerciseId)
    const own = logged.filter((set) => set.exerciseId === exerciseId)
    const counts = own.map((set) => set.count)
    const implement = shown?.implement ?? null
    return {
      exerciseId,
      slot: exerciseById(exerciseId)?.slot ?? 'knee',
      implement,
      sets: shown?.sets ?? own.length,
      range: shown?.range ?? { min: Math.min(...counts), max: Math.max(...counts) },
      targets: counts,
      loadG: shown?.shownLoadG ?? own[0]?.loadG ?? null,
      steps: implement === null || equipment === null ? null : stepsFor(equipment, implement, unit),
      rir: shown?.rir ?? null,
      change: shown?.change ?? 'hold',
      usualLoadG:
        shown !== undefined && shown.baseLoadG !== shown.shownLoadG ? shown.baseLoadG : null,
      basis: shown?.basis ?? { rule: 'F8', facts: [] },
      evidence: NO_EVIDENCE,
    }
  })
  return {
    sessionId: log.id,
    date: log.date,
    template: log.prescribed.template,
    variant: log.prescribed.variant,
    block: null,
    budgetMin: log.durationMin,
    setupSaved: true,
    lifts,
    plyo: null,
    trunk: [],
    rules: [],
  }
}

/** The sheet as an edit opens it: the logged sets as they were, the minutes, the effort, the pain and the note. */
export function stateOfLog(
  workout: StrengthWorkout,
  log: StrengthLog,
  unit: WeightUnit,
): FormState {
  const logged = [...log.sets].sort((a, b) => a.position - b.position)
  return {
    blocks: workout.lifts.map((lift) => ({
      key: lift.exerciseId,
      kind: blockKindOf(lift.slot),
      shown: lift,
      original: lift,
      rows: logged
        .filter((set) => set.exerciseId === lift.exerciseId)
        .map((set): SetRow => ({
          load: loadText(set.loadG, unit),
          exactG: set.loadG,
          count: String(set.count),
          rir: set.rir,
        })),
    })),
    minutes: String(log.durationMin),
    effort: log.rpe,
    pain: log.pain,
    notes: log.notes ?? '',
  }
}

// ---- What the quiet buttons do -----------------------------------------------------------------

/**
 * "As suggested": every set of every lift gets the suggested load, the target count and the lowest
 * of the reps left to aim at, so the shortcut never claims more spare capacity than the plan asked
 * for (design 9.1). The number of sets is the suggested one, so it also undoes added and removed sets.
 */
export function asSuggested(blocks: readonly Block[], unit: WeightUnit): Block[] {
  return blocks.map((block) => ({
    ...block,
    rows: rowsOf(block.shown, unit, block.shown.rir?.min ?? null),
  }))
}

/**
 * The sets of the last logged session of an exercise in an implement, in order; none when it has
 * not been logged with it. A session whose snapshot shows another implement is not one (a load on a
 * calf machine is not a load on a dumbbell, and a change of equipment starts the lift again,
 * design 6.5), as the engine's `loggedSessions` reads it; a log with no snapshot of the lift counts
 * for any implement.
 */
export type LastSets = (exerciseId: string, implement: EquipmentKind | null) => StrengthSet[]

/** The last sets of each exercise in logs listed newest first (the page view's `recent`). */
export function lastSetsOf(logs: readonly StrengthLog[]): LastSets {
  interface Session {
    /** The implement the snapshot shows for the exercise; undefined when it shows none. */
    implement: EquipmentKind | null | undefined
    sets: StrengthSet[]
  }
  const sessions = new Map<string, Session[]>()
  for (const log of logs) {
    const byExercise = new Map<string, StrengthSet[]>()
    for (const set of log.sets) {
      byExercise.set(set.exerciseId, [...(byExercise.get(set.exerciseId) ?? []), set])
    }
    for (const [exerciseId, sets] of byExercise) {
      const shown = log.prescribed.lifts.find((lift) => lift.exerciseId === exerciseId)
      sessions.set(exerciseId, [
        ...(sessions.get(exerciseId) ?? []),
        { implement: shown?.implement, sets: sets.sort((a, b) => a.position - b.position) },
      ])
    }
  }
  return (exerciseId, implement) =>
    sessions
      .get(exerciseId)
      ?.find((session) => session.implement === undefined || session.implement === implement)
      ?.sets ?? []
}

/**
 * A set of the last session as a row. A lift with no load field (a bodyweight movement, a band) takes
 * no load, whatever the session held, so no hidden load is written into it.
 */
function rowOfLastSet(set: StrengthSet, unit: WeightUnit, loaded: boolean): SetRow {
  const loadG = loaded ? set.loadG : null
  // the reps left stay unset: they describe a different day (design 9.1)
  return { load: loadText(loadG, unit), exactG: loadG, count: String(set.count), rir: null }
}

/** The sets "Same as last time" would copy into a block: those of its exercise in its implement. */
function lastOfBlock(block: Block, lastOf: LastSets): StrengthSet[] {
  return block.kind === 'plyo' ? [] : lastOf(block.shown.exerciseId, block.shown.implement)
}

/** Whether "Same as last time" has anything to copy for a block (the jump dose has none). */
export function hasLast(block: Block, lastOf: LastSets): boolean {
  return lastOfBlock(block, lastOf).length > 0
}

/**
 * "Same as last time": the load and the count of each set of the last logged session of the lift in
 * the implement it is shown with, with the reps left unset. A lift that was never logged that way,
 * and the jump dose, stay as they are. With a `key` only that block is copied (the lift's own button).
 */
export function sameAsLast(
  blocks: readonly Block[],
  lastOf: LastSets,
  unit: WeightUnit,
  key?: string,
): Block[] {
  return blocks.map((block) => {
    if (key !== undefined && block.key !== key) return block
    const last = lastOfBlock(block, lastOf)
    if (last.length === 0) return block
    const loaded = block.shown.steps !== null
    return { ...block, rows: last.map((set) => rowOfLastSet(set, unit, loaded)) }
  })
}

/** "Use the usual load" on a lighter day: every set of the lift at the load the rules would have asked for. */
export function withUsualLoad(block: Block, unit: WeightUnit): Block {
  const usualLoadG = usualLoadOf(block.shown)
  if (usualLoadG === null) return block
  return {
    ...block,
    rows: block.rows.map((row) => ({
      ...row,
      load: loadText(usualLoadG, unit),
      exactG: usualLoadG,
    })),
  }
}

// ---- What a press does to a set ----------------------------------------------------------------

/**
 * One press of a load stepper: one step of the equipment up or down (design 5.2). The load stays on
 * the rungs the equipment makes, and a press at an end changes nothing and returns the row itself. A
 * movement that takes an added load only if any (its suggestion has none) steps down to no load.
 */
export function stepRowLoad(
  row: SetRow,
  lift: WorkoutLift,
  direction: 1 | -1,
  unit: WeightUnit,
): SetRow {
  const { steps } = lift
  const current = rowLoadG(row, unit)
  if (steps === null || current === 'invalid') return row
  const next = stepFrom(steps, current ?? 0, direction, unit)
  if (next !== null) return { ...row, load: loadText(next, unit), exactG: next }
  if (direction === -1 && current !== null && lift.loadG === null) {
    return { ...row, load: '', exactG: null }
  }
  return row
}

/** One press of a count stepper: by one rep, five seconds or ten contacts, never below one. */
export function stepRowCount(row: SetRow, measure: Measure, direction: 1 | -1): SetRow {
  const current = parseCount(row.count)
  // an empty or half-typed field: a raise starts from nothing, and a lower has nothing to lower
  if (current === null && direction === -1) return row
  const next = Math.min(
    Math.max((current ?? 0) + direction * COUNT_STEP[measure], 1),
    STRENGTH_COUNT_MAX,
  )
  return next === current ? row : { ...row, count: String(next) }
}

/** The reps left of one set, null to clear it. */
export function withRir(row: SetRow, rir: number | null): SetRow {
  return row.rir === rir ? row : { ...row, rir }
}

/** The one value of reps left that every set of a block shares; null when they differ or none is set. */
export function commonRir(rows: readonly SetRow[]): number | null {
  const [first] = rows
  if (first === undefined || first.rir === null) return null
  return rows.every((row) => row.rir === first.rir) ? first.rir : null
}

/** "All sets": the same reps left in every set of a block, null to clear them all. */
export function withAllRir(block: Block, rir: number | null): Block {
  return { ...block, rows: block.rows.map((row) => withRir(row, rir)) }
}

/** The sets in the sheet, all blocks together. */
export function totalSets(blocks: readonly Block[]): number {
  return blocks.reduce((sum, block) => sum + block.rows.length, 0)
}

/** Whether another set fits: a log holds at most `STRENGTH_SETS_MAX`. */
export function canAddSet(blocks: readonly Block[]): boolean {
  return totalSets(blocks) < STRENGTH_SETS_MAX
}

/**
 * "Add a set": a copy of the last one with its reps left unset, or the suggestion's first set when
 * the block has none.
 */
export function withAddedSet(block: Block, unit: WeightUnit): Block {
  const last = block.rows.at(-1)
  const added = last === undefined ? rowOf(block.shown, 0, unit, null) : { ...last, rir: null }
  return { ...block, rows: [...block.rows, added] }
}

/** "Remove": the set at `index` leaves; a block may be left with none. */
export function withoutSet(block: Block, index: number): Block {
  return { ...block, rows: block.rows.filter((_, at) => at !== index) }
}

// ---- Swap --------------------------------------------------------------------------------------

/** Whether the barbell may be an implement in this workout (the ramp-in and the return use none). */
export function barbellOf(workout: Pick<StrengthWorkout, 'template' | 'block'>): boolean {
  return barbellAllowed(workout.template, workout.block)
}

/**
 * The exercises a lift can be swapped for: the one the workout held (to return to), then the slot's
 * feasible substitutes with the saved equipment (design 7.3), without the one now shown.
 */
export function swapChoices(
  block: Block,
  equipment: readonly EquipmentConfig[],
  barbell: boolean,
): ExerciseId[] {
  const original = exerciseById(block.original.exerciseId)
  if (original === undefined) return []
  const others = substitutes(original.id, equipment, { barbell })
  return [original.id, ...others].filter((id) => id !== block.shown.exerciseId)
}

/**
 * The lift a swap puts in a lift's place, as far as the sheet can say. The server derives the real
 * suggestion for an exercise with no sets in this session (`liftFor`), but no read gives it to the
 * sheet yet (E14-10 owns it), so the swapped lift is a first session of the exercise (design 10.3):
 * the first-session structure of `structuresFor` (the ramp-in sets, the ramp-in repetitions or the
 * bodyweight range of a movement with no load, and at least `f7.easyRir` reps left, whatever the
 * template of the week) at the lightest load the saved equipment makes, or with no load for a
 * movement with nothing added (G6). It says so as its reason. Null for an exercise the equipment
 * cannot do.
 */
export function swappedLift(
  workout: Pick<StrengthWorkout, 'template' | 'block'>,
  exerciseId: ExerciseId,
  equipment: readonly EquipmentConfig[],
  unit: WeightUnit,
): WorkoutLift | null {
  const exercise = exerciseById(exerciseId)
  if (exercise === undefined) return null
  let chosen: { implement: WorkoutLift['implement']; steps: WorkoutLift['steps'] } | null = null
  for (const implement of usableImplements(exerciseId, equipment, {
    barbell: barbellOf(workout),
  })) {
    const steps = implement === null ? null : stepsFor(equipment, implement, unit)
    // an implement that carries a load but makes none is no way to do it; the bodyweight form is last
    if (implement !== null && steps === null && loadMeaning(exerciseId, implement) !== 'none') {
      continue
    }
    chosen = { implement, steps }
    break
  }
  if (chosen === null) return null
  const { implement, steps } = chosen
  const loaded = steps !== null && loadMeaning(exerciseId, implement) !== 'added'
  const loadG = loaded ? lightestLoad(steps, unit) : null
  // the first session of an exercise is the same in every template and for every role
  const first = structuresFor(workout.template, 'other', workout.block?.week ?? null).first
  const shape = loadG === null ? first.unloaded : first.loaded
  const template =
    loadG === null ? 'strength.sheet.swap-start-unloaded' : 'strength.sheet.swap-start'
  return {
    exerciseId,
    slot: exercise.slot,
    implement,
    sets: shape.sets,
    range: shape.range,
    targets: Array.from({ length: shape.sets }, () => shape.range.min),
    loadG,
    steps,
    rir: shape.rir,
    change: 'start',
    usualLoadG: null,
    basis: {
      rule: 'F8',
      facts: [{ template, slots: { exercise: STRENGTH_TEMPLATES[exercise.name].text } }],
    },
    evidence: NO_EVIDENCE,
  }
}

/** The block with `lift` in place of what it showed, its sets filled from it and no reps left. */
export function withLift(block: Block, lift: WorkoutLift, unit: WeightUnit): Block {
  return { ...block, shown: lift, rows: rowsOf(lift, unit, null) }
}

// ---- The log -----------------------------------------------------------------------------------

/** A set field the save found wrong. */
export interface SetIssue {
  key: string
  row: number
  field: 'load' | 'count'
}

/** What the sheet checks before it sends: the fields that are wrong, the minutes, and an empty sheet. */
export interface LogIssues {
  sets: SetIssue[]
  minutes: boolean
  empty: boolean
}

/** The fields of the sets that are not numbers the API takes. */
export function setIssues(blocks: readonly Block[], unit: WeightUnit): SetIssue[] {
  return blocks.flatMap((block) =>
    block.rows.flatMap((row, index): SetIssue[] => [
      ...(rowLoadG(row, unit) === 'invalid'
        ? [{ key: block.key, row: index, field: 'load' as const }]
        : []),
      ...(parseCount(row.count) === null
        ? [{ key: block.key, row: index, field: 'count' as const }]
        : []),
    ]),
  )
}

/** What the sheet showed, as the log keeps it (design 9.3): the lifts as shown, jumps left out. */
export function snapshotOf(workout: StrengthWorkout, blocks: readonly Block[]): StrengthSnapshot {
  return {
    template: workout.template,
    variant: workout.variant,
    week: workout.block?.week ?? null,
    mode: modeOf(workout),
    lifts: blocks
      .filter((block) => block.kind !== 'plyo')
      .map(({ shown }) => ({
        exerciseId: shown.exerciseId,
        implement: shown.implement,
        sets: shown.sets,
        range: shown.range,
        rir: shown.rir,
        // the load the rules asked for before a lighter day changed it, and the one shown
        baseLoadG: shown.usualLoadG ?? shown.loadG,
        shownLoadG: shown.loadG,
        change: shown.change,
        basis: shown.basis,
      })),
  }
}

/** What the sheet is saving, besides the sets. */
export interface LogInput {
  workout: StrengthWorkout
  /** The day the session is logged on. */
  date: string
  /** The planned session the log links to; none for an off-plan day or a past session. */
  sessionId: string | null
  /** An owned strength activity with no log, which the sets attach to. */
  activityId: string | null
  state: FormState
  unit: WeightUnit
  /**
   * An edit of a saved log: an emptied effort, pain or note is sent as `null`, which clears what the
   * activity holds. Left out (the default) it is sent as no key, which keeps what an attached
   * import brought, and is what a first save of a session does.
   */
  clearEmpty?: boolean
}

/** The request for the sheet, or what is wrong with it. */
export function buildLogBody(
  input: LogInput,
): { ok: true; body: StrengthLogBody } | { ok: false; issues: LogIssues } {
  const { workout, state, unit } = input
  const durationMin = parseMinutes(state.minutes)
  const issues: LogIssues = {
    sets: setIssues(state.blocks, unit),
    minutes: durationMin === null,
    empty: totalSets(state.blocks) === 0,
  }
  if (issues.sets.length > 0 || issues.minutes || issues.empty || durationMin === null) {
    return { ok: false, issues }
  }
  const sets: StrengthSetBody[] = state.blocks.flatMap((block) =>
    block.rows.map((row) => {
      const loadG = rowLoadG(row, unit)
      return {
        exerciseId: block.shown.exerciseId,
        loadG: loadG === 'invalid' ? null : loadG,
        count: parseCount(row.count) ?? 1,
        rir: row.rir,
      }
    }),
  )
  const notes = state.notes.trim()
  return {
    ok: true,
    body: {
      date: input.date,
      ...(input.sessionId === null ? {} : { sessionId: input.sessionId }),
      ...(input.activityId === null ? {} : { activityId: input.activityId }),
      durationMin,
      // left out, not null: an attached import keeps the effort, pain and note it brought; an edit
      // of a saved log has them in its form, so an emptied field is the runner clearing it
      ...(input.clearEmpty === true
        ? { rpe: state.effort, pain: state.pain, notes: notes === '' ? null : notes }
        : {
            ...(state.effort === null ? {} : { rpe: state.effort }),
            ...(state.pain === null ? {} : { pain: state.pain }),
            ...(notes === '' ? {} : { notes }),
          }),
      prescribed: snapshotOf(workout, state.blocks),
      sets,
    },
  }
}

// ---- A save that is still on the phone ---------------------------------------------------------

/** A save kept in the outbox, with the id it was queued under (the key of its entry's URL). */
export interface QueuedLog {
  logId: string
  body: StrengthLogBody
}

const LOG_URL = /^\/api\/strength\/logs\/([\w-]{8,64})$/

function isSetBody(value: unknown): value is StrengthSetBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'exerciseId' in value &&
    typeof value.exerciseId === 'string' &&
    'count' in value &&
    typeof value.count === 'number' &&
    (!('loadG' in value) || value.loadG === null || typeof value.loadG === 'number') &&
    (!('rir' in value) || value.rir === null || typeof value.rir === 'number')
  )
}

/**
 * The save in the outbox that is for this session: the strength log entry whose body has the same
 * session, day and activity (a log of no session has none, and matches none). A second save made
 * under its id replaces it, so one session replays as one log; under any other id it would be a
 * second activity. The newest entry when there are several.
 */
export function queuedLogOf(
  entries: readonly OutboxEntry[],
  match: { sessionId: string | null; date: string; activityId: string | null },
): QueuedLog | null {
  let found: { log: QueuedLog; seq: number } | null = null
  for (const entry of entries) {
    const logId = LOG_URL.exec(entry.url)?.[1]
    const { body } = entry
    if (
      logId === undefined ||
      body['date'] !== match.date ||
      ((body['sessionId'] as string | undefined) ?? null) !== match.sessionId ||
      ((body['activityId'] as string | undefined) ?? null) !== match.activityId ||
      typeof body['durationMin'] !== 'number' ||
      typeof body['prescribed'] !== 'object' ||
      !Array.isArray(body['sets'])
    ) {
      continue
    }
    if (found === null || entry.seq > found.seq) {
      const sets: unknown[] = body['sets']
      found = {
        log: {
          logId,
          body: { ...(body as unknown as StrengthLogBody), sets: sets.filter(isSetBody) },
        },
        seq: entry.seq,
      }
    }
  }
  return found === null ? null : found.log
}

function rowOfSet(set: StrengthSetBody, unit: WeightUnit): SetRow {
  const loadG = set.loadG
  return { load: loadText(loadG, unit), exactG: loadG, count: String(set.count), rir: set.rir }
}

/**
 * The lift a kept save shows for a swapped exercise, rebuilt from its snapshot: what was shown, and
 * the steps of the lift it replaced when the implement is the same. A swap to another implement has
 * no steps here (the saved equipment is not read yet), so its field keeps the loads and its steppers
 * stay at their ends until the sheet is opened with the page view.
 */
function liftOfSnapshot(
  original: WorkoutLift,
  exerciseId: string,
  snapshot: StrengthSnapshotLift | undefined,
): WorkoutLift {
  const slot = exerciseById(exerciseId)?.slot ?? original.slot
  if (snapshot === undefined) {
    return {
      ...original,
      exerciseId,
      slot,
      implement: null,
      steps: null,
      loadG: null,
      usualLoadG: null,
      change: 'start',
      basis: { rule: 'F8', facts: [] },
      evidence: NO_EVIDENCE,
    }
  }
  return {
    exerciseId,
    slot,
    implement: snapshot.implement,
    sets: snapshot.sets,
    range: snapshot.range,
    targets: Array.from({ length: snapshot.sets }, () => snapshot.range.min),
    loadG: snapshot.shownLoadG,
    steps:
      snapshot.implement !== null && snapshot.implement === original.implement
        ? original.steps
        : null,
    rir: snapshot.rir,
    change: snapshot.change,
    usualLoadG: snapshot.baseLoadG !== snapshot.shownLoadG ? snapshot.baseLoadG : null,
    basis: snapshot.basis,
    evidence: NO_EVIDENCE,
  }
}

/**
 * The sheet a kept save puts back over the sheet a workout opens as: its sets, its minutes, effort,
 * pain and note. A block with no sets in the save had them taken out; sets under an exercise the
 * workout does not hold are a swap of the block of their slot.
 */
export function stateFromBody(
  fresh: FormState,
  body: StrengthLogBody,
  unit: WeightUnit,
): FormState {
  const byExercise = new Map<string, StrengthSetBody[]>()
  for (const set of body.sets) {
    byExercise.set(set.exerciseId, [...(byExercise.get(set.exerciseId) ?? []), set])
  }
  const held = new Set(fresh.blocks.map((block) => block.key))
  const strays = [...byExercise.keys()].filter((id) => !held.has(id))
  return {
    blocks: fresh.blocks.map((block): Block => {
      const own = byExercise.get(block.key)
      if (own !== undefined) return { ...block, rows: own.map((set) => rowOfSet(set, unit)) }
      const stray = strays.find((id) => exerciseById(id)?.slot === block.original.slot)
      const swapped = stray === undefined ? undefined : byExercise.get(stray)
      if (stray === undefined || swapped === undefined) return { ...block, rows: [] }
      strays.splice(strays.indexOf(stray), 1)
      const snapshot = body.prescribed.lifts.find((lift) => lift.exerciseId === stray)
      return {
        ...block,
        shown: liftOfSnapshot(block.original, stray, snapshot),
        rows: swapped.map((set) => rowOfSet(set, unit)),
      }
    }),
    minutes: String(body.durationMin),
    effort: body.rpe ?? null,
    pain: body.pain ?? null,
    notes: body.notes ?? '',
  }
}

/**
 * "Save without sets": a strength activity of the minutes, the effort, the pain and the note, which
 * is what the Done sheet records, so that path stays. Null when the minutes are not a number the
 * API takes.
 */
export function bareActivity(state: FormState, date: string): ActivityInput | null {
  const minutes = parseMinutes(state.minutes)
  if (minutes === null) return null
  const notes = state.notes.trim()
  return {
    date,
    type: 'strength',
    durationSec: minutes * 60,
    ...(state.effort === null ? {} : { rpe: state.effort }),
    ...(state.pain === null ? {} : { pain: state.pain }),
    ...(notes === '' ? {} : { notes }),
  }
}

/** A fresh id for a log: a UUID, or an id of the same shape where the browser has no `randomUUID`. */
export function newLogId(): string {
  // `randomUUID` exists only in a secure context, and a self-hosted page may be served over HTTP.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

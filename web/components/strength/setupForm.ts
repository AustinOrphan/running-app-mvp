// What the strength setup sheets hold between taps, and the plain functions that turn it into the
// bodies of `PUT /api/strength/settings` and `PUT /api/strength/lifts/:exerciseId` (strength design
// 6.2 and 6.3). No React and no requests here, so the rules are readable on their own.
//
// A weight is typed in the runner's unit and kept in grams, as in the logging sheet: the text is what
// the field holds, `exactG` the gram count the text was made from, so equipment saved in the other
// unit (a 5 lb jump shown in kilograms) is sent back as the very gram it is unless the field is typed
// over. Loads are only ever converted by `shared/domain/weight.ts`.
import {
  EXERCISES,
  exerciseById,
  exercisesOfSlot,
  isFeasible,
  ladderFor,
  type ExerciseId,
} from '../../../shared/domain/strengthLibrary.ts'
import { stepsFor } from '../../../shared/domain/weight.ts'
import { anchorEstimate } from '../../../shared/engine/strength.ts'
import { MAX_NOTES, STRENGTH_COUNT_MAX, STRENGTH_LOAD_LIST_MAX } from '../../../shared/limits.ts'
import type {
  EquipmentConfig,
  EquipmentKind,
  LoadSteps,
  PinnedSlot,
  StrengthLift,
  StrengthSettings,
  WeightUnit,
} from '../../../shared/types.ts'
import type { StrengthLiftBody, StrengthSettingsBody } from '../../api/strength.ts'
import { loadText, parseLoad } from './strengthForm.ts'

/** The five parts of the setup (design 6.2), each its own short sheet. */
export type SetupPart = 'unit' | 'equipment' | 'history' | 'exercises' | 'anchors'

// ---- A weight as typed -------------------------------------------------------------------------

/** One weight field: the text, and the grams the text was made from while it is still that text. */
export interface Amount {
  text: string
  exactG?: number
}

/** A field filled from grams. */
export const amountOf = (grams: number, unit: WeightUnit): Amount => ({
  text: loadText(grams, unit),
  exactG: grams,
})

const BLANK: Amount = { text: '' }

/**
 * The grams a field means: null for an empty field or a zero, `'invalid'` for anything that is not
 * a number from zero up to the heaviest load the API stores.
 */
export function readAmount(amount: Amount, unit: WeightUnit): number | null | 'invalid' {
  if (amount.exactG !== undefined && amount.text === loadText(amount.exactG, unit)) {
    return amount.exactG
  }
  return parseLoad(amount.text, unit)
}

/** The weights of a list as the field holds them: "10, 15, 20". */
const listText = (loadsG: readonly number[], unit: WeightUnit): string =>
  loadsG.map((grams) => loadText(grams, unit)).join(', ')

// ---- Equipment (design 6.2, part 2) ------------------------------------------------------------

/** Every item of the checklist, in the order the sheet lists them. */
export const EQUIPMENT_KINDS: readonly EquipmentKind[] = [
  'barbell',
  'dumbbells',
  'kettlebells',
  'bands',
  'step',
  'leg-press',
  'calf-machine',
  'leg-curl',
]

/** A bar and the smallest pair of plates: 45 lb and 5 lb, or 20 kg and 2.5 kg (design 6.2). */
const BARBELL_DEFAULT: Readonly<Record<WeightUnit, { bar: string; jump: string }>> = {
  lb: { bar: '45', jump: '5' },
  kg: { bar: '20', jump: '2.5' },
}

export type LoadsMode = 'range' | 'list'

/** The weights of a set of dumbbells or kettlebells, as a range and a step or as a list. */
export interface LoadsDraft {
  on: boolean
  mode: LoadsMode
  first: Amount
  /** Empty means no top. */
  last: Amount
  step: Amount
  list: { text: string; exactG?: number[] }
}

export interface BarbellDraft {
  on: boolean
  bar: Amount
  jump: Amount
}

export interface MachineDraft {
  on: boolean
  step: Amount
  max: Amount
}

export interface SwitchDraft {
  on: boolean
}

export interface EquipmentForm {
  barbell: BarbellDraft
  dumbbells: LoadsDraft
  kettlebells: LoadsDraft
  bands: SwitchDraft
  step: SwitchDraft
  'leg-press': MachineDraft
  'calf-machine': MachineDraft
  'leg-curl': MachineDraft
}

function loadsDraft(
  item: Extract<EquipmentConfig, { loads: LoadSteps }> | undefined,
  mode: LoadsMode,
  unit: WeightUnit,
): LoadsDraft {
  const empty: LoadsDraft = {
    on: item !== undefined,
    mode,
    first: BLANK,
    last: BLANK,
    step: BLANK,
    list: { text: '' },
  }
  if (item === undefined) return empty
  if ('loadsG' in item.loads) {
    return {
      ...empty,
      mode: 'list',
      list: { text: listText(item.loads.loadsG, unit), exactG: [...item.loads.loadsG] },
    }
  }
  const { minG, stepG, maxG } = item.loads
  return {
    ...empty,
    mode: 'range',
    first: amountOf(minG, unit),
    step: amountOf(stepG, unit),
    last: maxG === null ? BLANK : amountOf(maxG, unit),
  }
}

function machineDraft(
  item: Extract<EquipmentConfig, { stepG: number }> | undefined,
  unit: WeightUnit,
): MachineDraft {
  return item === undefined
    ? { on: false, step: BLANK, max: BLANK }
    : { on: true, step: amountOf(item.stepG, unit), max: amountOf(item.maxG, unit) }
}

/** The sheet as it opens: what is saved, ticked and filled; the rest empty, with a bar's usual weights. */
export function formOfEquipment(
  equipment: readonly EquipmentConfig[],
  unit: WeightUnit,
): EquipmentForm {
  const find = <K extends EquipmentKind>(kind: K) =>
    equipment.find((item): item is Extract<EquipmentConfig, { kind: K }> => item.kind === kind)
  const bar = find('barbell')
  return {
    barbell:
      bar === undefined
        ? {
            on: false,
            bar: { text: BARBELL_DEFAULT[unit].bar },
            jump: { text: BARBELL_DEFAULT[unit].jump },
          }
        : { on: true, bar: amountOf(bar.barG, unit), jump: amountOf(bar.jumpG, unit) },
    dumbbells: loadsDraft(find('dumbbells'), 'range', unit),
    kettlebells: loadsDraft(find('kettlebells'), 'list', unit),
    bands: { on: find('bands') !== undefined },
    step: { on: find('step') !== undefined },
    'leg-press': machineDraft(find('leg-press'), unit),
    'calf-machine': machineDraft(find('calf-machine'), unit),
    'leg-curl': machineDraft(find('leg-curl'), unit),
  }
}

/** What is wrong with a field of the equipment sheet. */
export type EquipmentProblem =
  'weight' | 'top' | 'machine-top' | 'list' | 'list-long' | 'step' | 'unusable'

/** The problems of a save, by field: `barbell.bar`, `dumbbells.first`, `leg-press.max`, and so on. */
export type EquipmentProblems = Partial<Record<string, EquipmentProblem>>

/** The weights typed in a list: entries separated by commas, spaces or semicolons. */
function parseList(
  draft: LoadsDraft['list'],
  unit: WeightUnit,
): number[] | 'invalid' | 'empty' | 'long' {
  if (draft.exactG !== undefined && draft.text === listText(draft.exactG, unit)) {
    return draft.exactG.length === 0 ? 'empty' : [...draft.exactG]
  }
  const entries = draft.text.split(/[\s,;]+/).filter((entry) => entry !== '')
  if (entries.length === 0) return 'empty'
  if (entries.length > STRENGTH_LOAD_LIST_MAX) return 'long'
  const grams: number[] = []
  for (const entry of entries) {
    const value = parseLoad(entry, unit)
    if (value === null || value === 'invalid') return 'invalid'
    grams.push(value)
  }
  return grams
}

type Built = { ok: true; item: EquipmentConfig } | { ok: false; problems: EquipmentProblems }

/** A ladder or list of weights the equipment makes, or what is wrong with the fields. */
function buildLoads(kind: 'dumbbells' | 'kettlebells', draft: LoadsDraft, unit: WeightUnit): Built {
  const problems: EquipmentProblems = {}
  let loads: LoadSteps | null = null
  if (draft.mode === 'list') {
    const list = parseList(draft.list, unit)
    if (list === 'long') problems[kind + '.list'] = 'list-long'
    else if (list === 'invalid' || list === 'empty') problems[kind + '.list'] = 'list'
    else loads = { loadsG: [...new Set(list)].sort((a, b) => a - b) }
  } else {
    const first = readAmount(draft.first, unit)
    const step = readAmount(draft.step, unit)
    const last = readAmount(draft.last, unit)
    if (first === null || first === 'invalid') problems[kind + '.first'] = 'weight'
    if (step === null || step === 'invalid') problems[kind + '.step'] = 'weight'
    if (last === 'invalid') problems[kind + '.last'] = 'weight'
    else if (typeof first === 'number' && last !== null && last < first) {
      problems[kind + '.last'] = 'top'
    }
    if (typeof first === 'number' && typeof step === 'number' && last !== 'invalid') {
      loads = { minG: first, stepG: step, maxG: last }
    }
  }
  if (Object.keys(problems).length > 0 || loads === null) return { ok: false, problems }
  const item: EquipmentConfig = { kind, loads }
  // a ladder finer than one display step, or a list that makes no load, is no equipment
  if (stepsFor([item], kind, unit) === null) {
    const field = draft.mode === 'list' ? kind + '.list' : kind + '.step'
    return { ok: false, problems: { [field]: draft.mode === 'list' ? 'unusable' : 'step' } }
  }
  return { ok: true, item }
}

function buildMachine(
  kind: 'leg-press' | 'calf-machine' | 'leg-curl',
  draft: MachineDraft,
  unit: WeightUnit,
): Built {
  const problems: EquipmentProblems = {}
  const step = readAmount(draft.step, unit)
  const max = readAmount(draft.max, unit)
  if (step === null || step === 'invalid') problems[kind + '.step'] = 'weight'
  if (max === null || max === 'invalid') problems[kind + '.max'] = 'weight'
  else if (typeof step === 'number' && max < step) problems[kind + '.max'] = 'machine-top'
  if (typeof step !== 'number' || typeof max !== 'number' || Object.keys(problems).length > 0) {
    return { ok: false, problems }
  }
  const item: EquipmentConfig = { kind, stepG: step, maxG: max }
  if (stepsFor([item], kind, unit) === null) {
    return { ok: false, problems: { [kind + '.step']: 'step' } }
  }
  return { ok: true, item }
}

function buildBarbell(draft: BarbellDraft, unit: WeightUnit): Built {
  const problems: EquipmentProblems = {}
  const bar = readAmount(draft.bar, unit)
  const jump = readAmount(draft.jump, unit)
  if (bar === null || bar === 'invalid') problems['barbell.bar'] = 'weight'
  if (jump === null || jump === 'invalid') problems['barbell.jump'] = 'weight'
  if (typeof bar !== 'number' || typeof jump !== 'number') return { ok: false, problems }
  const item: EquipmentConfig = { kind: 'barbell', barG: bar, jumpG: jump }
  if (stepsFor([item], 'barbell', unit) === null) {
    return { ok: false, problems: { 'barbell.jump': 'step' } }
  }
  return { ok: true, item }
}

/** The equipment the sheet saves, in the order of the checklist, or what is wrong with it. */
export function equipmentOfForm(
  form: EquipmentForm,
  unit: WeightUnit,
): { ok: true; equipment: EquipmentConfig[] } | { ok: false; problems: EquipmentProblems } {
  const built: Built[] = []
  for (const kind of EQUIPMENT_KINDS) {
    switch (kind) {
      case 'barbell':
        if (form.barbell.on) built.push(buildBarbell(form.barbell, unit))
        break
      case 'dumbbells':
      case 'kettlebells':
        if (form[kind].on) built.push(buildLoads(kind, form[kind], unit))
        break
      case 'leg-press':
      case 'calf-machine':
      case 'leg-curl':
        if (form[kind].on) built.push(buildMachine(kind, form[kind], unit))
        break
      case 'bands':
      case 'step':
        if (form[kind].on) built.push({ ok: true, item: { kind } })
        break
    }
  }
  const problems: EquipmentProblems = {}
  for (const entry of built) if (!entry.ok) Object.assign(problems, entry.problems)
  if (Object.keys(problems).length > 0) return { ok: false, problems }
  return {
    ok: true,
    equipment: built.flatMap((entry) => (entry.ok ? [entry.item] : [])),
  }
}

// ---- Exercises left out and always used (design 6.2, part 4) -----------------------------------

export interface ExercisesForm {
  avoid: ReadonlySet<string>
  pinned: Partial<Record<PinnedSlot, string>>
  note: string
}

/** The slots a runner can pin an exercise in. */
export const PIN_SLOTS: readonly PinnedSlot[] = ['knee', 'hip', 'calf']

export function formOfExercises(settings: StrengthSettings): ExercisesForm {
  return {
    avoid: new Set(settings.avoid),
    pinned: { ...settings.pinned },
    note: settings.note ?? '',
  }
}

/** The catalogue as the leave-out list shows it, in catalogue order; a retired lift only while left out. */
export function leaveOutChoices(form: ExercisesForm): ExerciseId[] {
  return EXERCISES.filter(
    (exercise) => exercise.retired !== true || form.avoid.has(exercise.id),
  ).map((exercise) => exercise.id)
}

/** One exercise left out or taken back in. An exercise that is left out cannot also be always used. */
export function toggleAvoid(form: ExercisesForm, id: string): ExercisesForm {
  const avoid = new Set(form.avoid)
  if (avoid.has(id)) {
    avoid.delete(id)
    return { ...form, avoid }
  }
  avoid.add(id)
  const pinned = Object.fromEntries(
    Object.entries(form.pinned).filter(([, pinnedId]) => pinnedId !== id),
  ) as Partial<Record<PinnedSlot, string>>
  return { ...form, avoid, pinned }
}

/** The exercise always used in a slot, or none (`undefined`). */
export function withPin(
  form: ExercisesForm,
  slot: PinnedSlot,
  id: string | undefined,
): ExercisesForm {
  const pinned = { ...form.pinned }
  if (id === undefined) delete pinned[slot]
  else pinned[slot] = id
  return { ...form, pinned }
}

/**
 * What a slot can be pinned to: the exercises of the slot the saved equipment can do, the ladder
 * first and the harder movements after it, without those left out; the one pinned now stays
 * listed, so a saved choice is never hidden.
 */
export function pinChoices(
  slot: PinnedSlot,
  equipment: readonly EquipmentConfig[],
  form: ExercisesForm,
): ExerciseId[] {
  const ladder = ladderFor(slot)
  const others = exercisesOfSlot(slot)
    .map((exercise) => exercise.id)
    .filter((id) => !ladder.includes(id))
  const current = form.pinned[slot]
  return [...ladder, ...others].filter(
    (id) => id === current || (!form.avoid.has(id) && isFeasible(id, equipment)),
  )
}

/** The part of the settings the exercises sheet saves; an empty note clears it. */
export function bodyOfExercises(form: ExercisesForm): StrengthSettingsBody {
  const note = form.note.trim()
  return {
    avoid: [...form.avoid],
    pinned: form.pinned,
    note: note === '' ? null : note.slice(0, MAX_NOTES),
  }
}

/** The longest note the API stores, for the field's own limit. */
export const NOTE_MAX = MAX_NOTES

// ---- Starting points (design 6.2 part 5, 6.3) --------------------------------------------------

/** What the runner knows about an exercise. */
export interface AnchorForm {
  exerciseId: string
  kind: StrengthLift['kind']
  load: string
  reps: string
  /** Reps left, 0 to 5; null when not known. */
  rir: number | null
}

export const EMPTY_ANCHOR: AnchorForm = {
  exerciseId: '',
  kind: 'set',
  load: '',
  reps: '',
  rir: null,
}

/** The exercises that carry a load, which a starting point can be for (not bodyweight or a band). */
export function anchorExercises(): ExerciseId[] {
  return EXERCISES.filter(
    (exercise) =>
      exercise.retired !== true && exercise.basis !== 'bodyweight' && exercise.basis !== 'band',
  ).map((exercise) => exercise.id)
}

export type AnchorField = 'exercise' | 'load' | 'reps'
export type AnchorProblems = Partial<Record<AnchorField, true>>

/** A whole number of reps the API takes: from one up to the largest count of a set. */
function parseReps(text: string): number | null {
  const typed = text.trim()
  if (!/^\d+$/.test(typed)) return null
  const n = Number(typed)
  return n >= 1 && n <= STRENGTH_COUNT_MAX ? n : null
}

/** The request for a starting point, or the fields that are wrong. */
export function anchorBody(
  form: AnchorForm,
  unit: WeightUnit,
):
  | { ok: true; exerciseId: string; body: StrengthLiftBody }
  | { ok: false; problems: AnchorProblems } {
  const problems: AnchorProblems = {}
  if (exerciseById(form.exerciseId) === undefined) problems.exercise = true
  const loadG = parseLoad(form.load, unit)
  if (loadG === null || loadG === 'invalid') problems.load = true
  const reps = form.kind === 'set' ? parseReps(form.reps) : 1
  if (reps === null) problems.reps = true
  if (Object.keys(problems).length > 0 || typeof loadG !== 'number' || reps === null) {
    return { ok: false, problems }
  }
  return {
    ok: true,
    exerciseId: form.exerciseId,
    body:
      form.kind === 'max' ? { kind: 'max', loadG } : { kind: 'set', loadG, reps, rir: form.rir },
  }
}

/**
 * The estimated maximum a starting point gives, as the engine reads it: a known maximum stands as
 * it is, a set is estimated from its reps and reps left. `none` when the set is too many reps from
 * the limit to estimate; null while the fields cannot be read yet.
 */
export function anchorEstimateOf(
  form: AnchorForm,
  unit: WeightUnit,
): { estimateG: number } | 'none' | null {
  const built = anchorBody(form, unit)
  if (!built.ok) return null
  const { kind, loadG, reps = 1, rir = null } = built.body
  const estimateG = anchorEstimate({
    exerciseId: built.exerciseId,
    kind,
    loadG,
    reps,
    rir,
    asOf: '',
  })
  return estimateG === null ? 'none' : { estimateG }
}

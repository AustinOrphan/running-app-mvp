import { describe, expect, test } from 'vitest'
import { EXERCISES } from '../../shared/domain/strengthLibrary.ts'
import { fromGrams, stepsFor, toGrams } from '../../shared/domain/weight.ts'
import { estimateOneRm } from '../../shared/engine/strength.ts'
import { STRENGTH_LOAD_LIST_MAX } from '../../shared/limits.ts'
import type { EquipmentConfig, StrengthSettings } from '../../shared/types.ts'
import {
  EMPTY_ANCHOR,
  NOTE_MAX,
  PIN_SLOTS,
  amountOf,
  anchorBody,
  anchorEstimateOf,
  anchorExercises,
  bodyOfExercises,
  equipmentOfForm,
  formOfEquipment,
  formOfExercises,
  leaveOutChoices,
  pinChoices,
  readAmount,
  toggleAvoid,
  withPin,
  type AnchorForm,
  type EquipmentForm,
} from '../../web/components/strength/setupForm.ts'
import { ALL_KINDS, ITEM, have } from '../unit/engine/strength-fixtures.ts'
import { STRENGTH_SETTINGS, lb } from './strength-fixtures.ts'

const everything = have(...ALL_KINDS)

/** The sheet's form for equipment, with a few fields typed over. */
function typed(form: EquipmentForm, change: (draft: EquipmentForm) => void): EquipmentForm {
  const copy = structuredClone(form)
  change(copy)
  return copy
}

describe('a weight as typed', () => {
  test('is the grams it was made from while the text is unchanged, and what the text says once it is typed over', () => {
    const amount = amountOf(lb(5), 'kg')
    // 5 lb on the display grid of kilograms (a quarter) is 2.25 kg, which is not 5 lb
    expect(amount.text).toBe('2.25')
    expect(readAmount(amount, 'kg')).toBe(lb(5))
    expect(readAmount({ ...amount, text: '2.5' }, 'kg')).toBe(toGrams(2.5, 'kg'))
    expect(readAmount({ text: '' }, 'lb')).toBeNull()
    expect(readAmount({ text: '0' }, 'lb')).toBeNull()
    expect(readAmount({ text: 'heavy' }, 'lb')).toBe('invalid')
    expect(readAmount({ text: '47,5' }, 'lb')).toBe(toGrams(47.5, 'lb'))
  })
})

describe('the equipment form (design 6.2)', () => {
  test('opens with nothing ticked and a bar of the usual weights in the unit the runner reads', () => {
    for (const [unit, bar, jump] of [
      ['lb', '45', '5'],
      ['kg', '20', '2.5'],
    ] as const) {
      const form = formOfEquipment([], unit)
      expect(form.barbell).toEqual({ on: false, bar: { text: bar }, jump: { text: jump } })
      expect(form.dumbbells.on).toBe(false)
      // dumbbells start as a range and a step, kettlebells as a list
      expect(form.dumbbells.mode).toBe('range')
      expect(form.kettlebells.mode).toBe('list')
      expect(equipmentOfForm(form, unit)).toEqual({ ok: true, equipment: [] })
    }
  })

  test.each(['lb', 'kg'] as const)(
    'gives back the saved equipment gram for gram in %s, whichever unit it was entered in',
    (unit) => {
      const saved: EquipmentConfig[] = [
        ...everything.filter((item) => item.kind !== 'dumbbells'),
        { kind: 'dumbbells', loads: { minG: lb(5), stepG: lb(5), maxG: lb(50) } },
      ]
      const form = formOfEquipment(saved, unit)
      const built = equipmentOfForm(form, unit)
      expect(built.ok).toBe(true)
      if (!built.ok) return
      // checklist order, not the order they were saved in
      expect(built.equipment.map((item) => item.kind)).toEqual(ALL_KINDS)
      for (const item of saved) {
        expect(
          built.equipment.find((other) => other.kind === item.kind),
          item.kind,
        ).toEqual(item)
      }
    },
  )

  test('reads a field that was typed over from its text, and keeps the others as saved', () => {
    const form = typed(formOfEquipment(have('barbell'), 'kg'), (draft) => {
      draft.barbell.bar = { text: '15' }
    })
    expect(equipmentOfForm(form, 'kg')).toEqual({
      ok: true,
      equipment: [{ kind: 'barbell', barG: toGrams(15, 'kg'), jumpG: lb(5) }],
    })
  })

  test('leaves out what is not ticked, even when its fields hold something', () => {
    const form = typed(formOfEquipment(everything, 'lb'), (draft) => {
      draft.barbell.on = false
      draft.kettlebells.on = false
      draft['leg-press'].on = false
      draft['calf-machine'].on = false
      draft['leg-curl'].on = false
    })
    const built = equipmentOfForm(form, 'lb')
    expect(built.ok && built.equipment.map((item) => item.kind)).toEqual([
      'dumbbells',
      'bands',
      'step',
    ])
  })

  test('takes a range with no top, and a list in any order with repeats taken out', () => {
    const form = typed(formOfEquipment([], 'lb'), (draft) => {
      draft.dumbbells = {
        on: true,
        mode: 'range',
        first: { text: '10' },
        last: { text: '' },
        step: { text: '5' },
        list: { text: '' },
      }
      draft.kettlebells = {
        on: true,
        mode: 'list',
        first: { text: '' },
        last: { text: '' },
        step: { text: '' },
        list: { text: '35, 18; 26 18' },
      }
    })
    expect(equipmentOfForm(form, 'lb')).toEqual({
      ok: true,
      equipment: [
        { kind: 'dumbbells', loads: { minG: lb(10), stepG: lb(5), maxG: null } },
        { kind: 'kettlebells', loads: { loadsG: [lb(18), lb(26), lb(35)] } },
      ],
    })
  })

  test('names each field that is wrong, and no other', () => {
    const on = (draft: EquipmentForm) => {
      draft.barbell.on = true
      draft.dumbbells.on = true
      draft.kettlebells.on = true
      draft['leg-press'].on = true
      draft['calf-machine'].on = true
    }
    const form = typed(formOfEquipment([], 'lb'), (draft) => {
      on(draft)
      draft.barbell.bar = { text: '' }
      draft.dumbbells.first = { text: '50' }
      draft.dumbbells.last = { text: '10' }
      draft.dumbbells.step = { text: 'five' }
      draft.kettlebells.list = { text: '' }
      draft['leg-press'].step = { text: '20' }
      draft['leg-press'].max = { text: '10' }
      draft['calf-machine'].step = { text: '10' }
      draft['calf-machine'].max = { text: '0' }
    })
    expect(equipmentOfForm(form, 'lb')).toEqual({
      ok: false,
      problems: {
        'barbell.bar': 'weight',
        'dumbbells.step': 'weight',
        'dumbbells.last': 'top',
        'kettlebells.list': 'list',
        'leg-press.max': 'machine-top',
        'calf-machine.max': 'weight',
      },
    })
  })

  test('refuses a step that two neighbouring loads could not tell apart, in each unit', () => {
    // half a pound and a quarter of a kilogram are the finest the page can show
    const fine = (unit: 'lb' | 'kg', step: string) =>
      typed(formOfEquipment([], unit), (draft) => {
        draft.dumbbells.on = true
        draft.dumbbells.first = { text: '10' }
        draft.dumbbells.step = { text: step }
        draft.barbell.on = true
        draft.barbell.jump = { text: step }
      })
    expect(equipmentOfForm(fine('lb', '0.5'), 'lb').ok).toBe(true)
    expect(equipmentOfForm(fine('kg', '0.25'), 'kg').ok).toBe(true)
    for (const [unit, step] of [
      ['lb', '0.1'],
      ['kg', '0.1'],
    ] as const) {
      expect(equipmentOfForm(fine(unit, step), unit)).toEqual({
        ok: false,
        problems: { 'dumbbells.step': 'step', 'barbell.jump': 'step' },
      })
    }
  })

  test('refuses a list that makes no load, and one that is longer than the API takes', () => {
    const list = (text: string) =>
      typed(formOfEquipment([], 'lb'), (draft) => {
        draft.kettlebells.on = true
        draft.kettlebells.list = { text }
      })
    expect(equipmentOfForm(list('10, ten'), 'lb')).toEqual({
      ok: false,
      problems: { 'kettlebells.list': 'list' },
    })
    const many = Array.from({ length: STRENGTH_LOAD_LIST_MAX + 1 }, (_, i) => String(i + 1)).join(
      ' ',
    )
    expect(equipmentOfForm(list(many), 'lb')).toEqual({
      ok: false,
      problems: { 'kettlebells.list': 'list-long' },
    })
    expect(
      equipmentOfForm(list(many.split(' ').slice(0, STRENGTH_LOAD_LIST_MAX).join(' ')), 'lb').ok,
    ).toBe(true)
  })

  test('only ever sends equipment that makes a load on the steps the sheet shows', () => {
    const built = equipmentOfForm(formOfEquipment(everything, 'lb'), 'lb')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    for (const item of built.equipment) {
      if (item.kind === 'bands' || item.kind === 'step') continue
      expect(stepsFor(built.equipment, item.kind, 'lb'), item.kind).not.toBeNull()
    }
  })
})

describe('the exercises form (design 6.2, part 4)', () => {
  const settings = (over: Partial<StrengthSettings> = {}): StrengthSettings => ({
    ...STRENGTH_SETTINGS,
    ...over,
  })

  test('lists the whole catalogue to leave out, and a retired lift only while it is left out', () => {
    const form = formOfExercises(settings())
    expect(leaveOutChoices(form)).toEqual(
      EXERCISES.filter((exercise) => exercise.retired !== true).map((exercise) => exercise.id),
    )
    expect(leaveOutChoices(form)).toHaveLength(25)
  })

  test('opens as saved, and a note that is blank or only spaces clears it', () => {
    const form = formOfExercises(
      settings({ avoid: ['leg-curl'], pinned: { knee: 'goblet-squat' }, note: 'A note' }),
    )
    expect([...form.avoid]).toEqual(['leg-curl'])
    expect(form.pinned).toEqual({ knee: 'goblet-squat' })
    expect(bodyOfExercises(form)).toEqual({
      avoid: ['leg-curl'],
      pinned: { knee: 'goblet-squat' },
      note: 'A note',
    })
    expect(bodyOfExercises({ ...form, note: '   ' }).note).toBeNull()
    expect(bodyOfExercises({ ...form, note: '  kept  ' }).note).toBe('kept')
    expect(bodyOfExercises({ ...form, note: 'x'.repeat(NOTE_MAX + 5) }).note).toHaveLength(NOTE_MAX)
  })

  test('an exercise left out is taken back in by a second toggle, and cannot stay pinned', () => {
    let form = formOfExercises(settings({ pinned: { knee: 'back-squat', hip: 'dumbbell-rdl' } }))
    form = toggleAvoid(form, 'back-squat')
    expect([...form.avoid]).toEqual(['back-squat'])
    expect(form.pinned).toEqual({ hip: 'dumbbell-rdl' })
    form = toggleAvoid(form, 'back-squat')
    expect([...form.avoid]).toEqual([])
  })

  test('pins and unpins one slot at a time', () => {
    let form = formOfExercises(settings())
    form = withPin(form, 'knee', 'goblet-squat')
    form = withPin(form, 'calf', 'seated-calf-raise')
    expect(form.pinned).toEqual({ knee: 'goblet-squat', calf: 'seated-calf-raise' })
    form = withPin(form, 'knee', undefined)
    expect(form.pinned).toEqual({ calf: 'seated-calf-raise' })
    expect(PIN_SLOTS).toEqual(['knee', 'hip', 'calf'])
  })

  test('offers a slot the exercises the saved equipment can do: the ladder first, the harder movements after it', () => {
    const form = formOfExercises(settings())
    // a split squat can be done with nothing, so it is offered whatever the equipment
    expect(pinChoices('knee', have('barbell', 'step'), form)).toEqual([
      'back-squat',
      'tempo-squat',
      'split-squat',
      'step-up',
      'single-leg-box-squat',
    ])
    expect(pinChoices('knee', [], form)).toEqual(['tempo-squat', 'split-squat'])
    // what is left out is not offered
    expect(pinChoices('knee', have('barbell'), toggleAvoid(form, 'back-squat'))).toEqual([
      'tempo-squat',
      'split-squat',
    ])
  })

  test('keeps listed the exercise that is pinned now, so a saved choice is never hidden', () => {
    const form = formOfExercises(settings({ pinned: { knee: 'leg-press' } }))
    expect(pinChoices('knee', have('barbell'), form)).toContain('leg-press')
  })
})

describe('the starting points form (design 6.2 part 5, 6.3)', () => {
  const set = (over: Partial<AnchorForm> = {}): AnchorForm => ({
    ...EMPTY_ANCHOR,
    exerciseId: 'back-squat',
    load: '135',
    reps: '5',
    rir: 2,
    ...over,
  })

  test('offers the exercises that carry a load, and none that is bodyweight or a band', () => {
    const ids = anchorExercises()
    for (const id of [
      'back-squat',
      'leg-press',
      'dumbbell-rdl',
      'standing-calf-raise',
      'farmer-carry',
    ]) {
      expect(ids, id).toContain(id)
    }
    for (const id of ['tempo-squat', 'pogo-hop', 'side-plank', 'banded-lateral-walk', 'dead-bug']) {
      expect(ids, id).not.toContain(id)
    }
  })

  test('sends a recent set with its reps and reps left, and a maximum as one rep with nothing left', () => {
    expect(anchorBody(set(), 'lb')).toEqual({
      ok: true,
      exerciseId: 'back-squat',
      body: { kind: 'set', loadG: lb(135), reps: 5, rir: 2 },
    })
    expect(anchorBody(set({ rir: null }), 'lb')).toMatchObject({ body: { rir: null } })
    // a maximum has no reps to type and no count of reps left, whatever the form still holds
    expect(anchorBody(set({ kind: 'max', load: '185', reps: '', rir: 3 }), 'lb')).toEqual({
      ok: true,
      exerciseId: 'back-squat',
      body: { kind: 'max', loadG: lb(185) },
    })
    expect(anchorBody(set({ load: '60' }), 'kg')).toMatchObject({
      body: { loadG: toGrams(60, 'kg') },
    })
  })

  test('names each field that is wrong', () => {
    expect(anchorBody(EMPTY_ANCHOR, 'lb')).toEqual({
      ok: false,
      problems: { exercise: true, load: true, reps: true },
    })
    expect(anchorBody(set({ exerciseId: 'free-weights' }), 'lb')).toEqual({
      ok: false,
      problems: { exercise: true },
    })
    expect(anchorBody(set({ reps: '0' }), 'lb')).toEqual({ ok: false, problems: { reps: true } })
    expect(anchorBody(set({ reps: '2.5' }), 'lb')).toEqual({ ok: false, problems: { reps: true } })
    expect(anchorBody(set({ load: '0' }), 'lb')).toEqual({ ok: false, problems: { load: true } })
    // a maximum needs no reps
    expect(anchorBody(set({ kind: 'max', reps: 'many' }), 'lb').ok).toBe(true)
  })

  test('shows the estimate the engine gives: a set is estimated, a maximum stands, a long set gives none', () => {
    expect(anchorEstimateOf(set(), 'lb')).toEqual({ estimateG: estimateOneRm(lb(135), 5, 2) })
    // no count of reps left is read as none left, the lowest estimate
    expect(anchorEstimateOf(set({ rir: null }), 'lb')).toEqual({
      estimateG: estimateOneRm(lb(135), 5, 0),
    })
    expect(estimateOneRm(lb(135), 5, 0)).toBeLessThan(estimateOneRm(lb(135), 5, 2) ?? 0)
    expect(anchorEstimateOf(set({ kind: 'max', load: '185' }), 'lb')).toEqual({
      estimateG: lb(185),
    })
    expect(anchorEstimateOf(set({ reps: '12' }), 'lb')).toBe('none')
    expect(anchorEstimateOf(EMPTY_ANCHOR, 'lb')).toBeNull()
    expect(anchorEstimateOf(set({ load: '' }), 'lb')).toBeNull()
  })

  test('shows the estimate in the unit the runner reads, from the same grams', () => {
    const estimate = anchorEstimateOf(set({ load: '60' }), 'kg')
    expect(estimate).not.toBeNull()
    expect(estimate).not.toBe('none')
    const grams = estimate === null || estimate === 'none' ? 0 : estimate.estimateG
    expect(fromGrams(grams, 'kg')).toBeGreaterThan(60)
    expect(grams).toBe(estimateOneRm(toGrams(60, 'kg'), 5, 2))
  })
})

describe('the saved equipment of the fixtures', () => {
  test('is every kind once', () => {
    expect(everything.map((item) => item.kind)).toEqual(ALL_KINDS)
    expect(Object.keys(ITEM)).toEqual(ALL_KINDS)
  })
})

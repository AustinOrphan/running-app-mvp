import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import {
  EXERCISES,
  FLOOR_EXERCISE,
  PLYO_LADDER,
  SLOT_LADDERS,
  exerciseById,
  exercisesOfSlot,
  isExerciseId,
  isFeasible,
  ladderFor,
  loadMeaning,
  substitutes,
  usableImplements,
  type ExerciseId,
  type LadderSlot,
  type FeasibilityOptions,
} from '../../../shared/domain/strengthLibrary.ts'
import { toGrams } from '../../../shared/domain/weight.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EquipmentConfig, EquipmentKind, Slot } from '../../../shared/types.ts'

/** Synthetic equipment, one item of each kind, in pounds. */
const ITEM: Readonly<Record<EquipmentKind, EquipmentConfig>> = {
  barbell: { kind: 'barbell', barG: toGrams(45, 'lb'), jumpG: toGrams(5, 'lb') },
  dumbbells: { kind: 'dumbbells', loads: { loadsG: [10, 20, 30].map((p) => toGrams(p, 'lb')) } },
  kettlebells: { kind: 'kettlebells', loads: { loadsG: [18, 35].map((p) => toGrams(p, 'lb')) } },
  bands: { kind: 'bands' },
  step: { kind: 'step' },
  'leg-press': { kind: 'leg-press', stepG: toGrams(10, 'lb'), maxG: toGrams(300, 'lb') },
  'calf-machine': { kind: 'calf-machine', stepG: toGrams(10, 'lb'), maxG: toGrams(200, 'lb') },
  'leg-curl': { kind: 'leg-curl', stepG: toGrams(10, 'lb'), maxG: toGrams(150, 'lb') },
}
const have = (...kinds: EquipmentKind[]): EquipmentConfig[] => kinds.map((kind) => ITEM[kind])
const ALL_KINDS = Object.keys(ITEM) as EquipmentKind[]

/** The table of design 7.1, transcribed: one row per exercise, in the spec's order. */
interface Row {
  id: ExerciseId
  slot: Slot
  implements: EquipmentKind[]
  bodyweight: boolean
  needs: EquipmentKind[]
  optionalNeeds: EquipmentKind[]
  measure: 'reps' | 'seconds' | 'contacts'
  basis: string
  harder: ExerciseId | null
  serves: string[]
}
const LIFT = ['F-lib', 'F7', 'H10', 'H5']
const HINGE = ['F-lib', 'F7', 'H5', 'm-age']
const POSTERIOR = ['F-lib', 'F7', 'm-age']
const CALF = ['F-lib', 'F7', 'H10', 'm-age']
const JUMP = ['F-lib', 'F7', 'H10']
const TRUNK = ['F-lib', 'F7']
const TABLE: Row[] = [
  {
    id: 'back-squat',
    slot: 'knee',
    implements: ['barbell'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'total-with-bar',
    harder: null,
    serves: LIFT,
  },
  {
    id: 'leg-press',
    slot: 'knee',
    implements: ['leg-press'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'stack',
    harder: null,
    serves: LIFT,
  },
  {
    id: 'goblet-squat',
    slot: 'knee',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'one-implement',
    harder: 'split-squat',
    serves: LIFT,
  },
  {
    id: 'split-squat',
    slot: 'knee',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: true,
    needs: [],
    optionalNeeds: ['step'],
    measure: 'reps',
    basis: 'one-implement-a-hand',
    harder: 'step-up',
    serves: LIFT,
  },
  {
    id: 'step-up',
    slot: 'knee',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: true,
    needs: ['step'],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'one-implement-a-hand',
    harder: 'single-leg-box-squat',
    serves: LIFT,
  },
  {
    id: 'tempo-squat',
    slot: 'knee',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'bodyweight',
    harder: 'split-squat',
    serves: LIFT,
  },
  {
    id: 'single-leg-box-squat',
    slot: 'knee',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: true,
    needs: ['step'],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'added',
    harder: null,
    serves: LIFT,
  },
  {
    id: 'romanian-deadlift',
    slot: 'hip',
    implements: ['barbell'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'total-with-bar',
    harder: null,
    serves: HINGE,
  },
  {
    id: 'dumbbell-rdl',
    slot: 'hip',
    implements: ['dumbbells'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'one-implement-a-hand',
    harder: 'single-leg-rdl',
    serves: HINGE,
  },
  {
    id: 'kettlebell-rdl',
    slot: 'hip',
    implements: ['kettlebells'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'one-implement',
    harder: 'single-leg-rdl',
    serves: HINGE,
  },
  {
    id: 'leg-curl',
    slot: 'hip',
    implements: ['leg-curl'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'stack',
    harder: null,
    serves: POSTERIOR,
  },
  {
    id: 'hip-thrust',
    slot: 'hip',
    implements: ['barbell', 'dumbbells'],
    bodyweight: true,
    needs: [],
    optionalNeeds: ['step'],
    measure: 'reps',
    basis: 'total-or-one-implement',
    harder: 'single-leg-rdl',
    serves: POSTERIOR,
  },
  {
    id: 'single-leg-rdl',
    slot: 'hip',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'one-implement',
    harder: null,
    serves: HINGE,
  },
  {
    id: 'standing-calf-raise',
    slot: 'calf',
    implements: ['calf-machine', 'barbell', 'dumbbells'],
    bodyweight: true,
    needs: [],
    optionalNeeds: ['step'],
    measure: 'reps',
    basis: 'by-implement',
    harder: 'single-leg-calf-raise',
    serves: CALF,
  },
  {
    id: 'seated-calf-raise',
    slot: 'calf',
    implements: ['calf-machine', 'dumbbells'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'by-implement',
    harder: 'single-leg-calf-raise',
    serves: CALF,
  },
  {
    id: 'single-leg-calf-raise',
    slot: 'calf',
    implements: ['dumbbells'],
    bodyweight: true,
    needs: ['step'],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'added',
    harder: null,
    serves: CALF,
  },
  {
    id: 'pogo-hop',
    slot: 'plyo',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'contacts',
    basis: 'bodyweight',
    harder: 'line-hop',
    serves: JUMP,
  },
  {
    id: 'line-hop',
    slot: 'plyo',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'contacts',
    basis: 'bodyweight',
    harder: 'squat-jump',
    serves: JUMP,
  },
  {
    id: 'squat-jump',
    slot: 'plyo',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'contacts',
    basis: 'bodyweight',
    harder: 'single-leg-hop',
    serves: JUMP,
  },
  {
    id: 'single-leg-hop',
    slot: 'plyo',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'contacts',
    basis: 'bodyweight',
    harder: null,
    serves: JUMP,
  },
  {
    id: 'side-plank',
    slot: 'trunk',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'seconds',
    basis: 'bodyweight',
    harder: null,
    serves: TRUNK,
  },
  {
    id: 'dead-bug',
    slot: 'trunk',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'bodyweight',
    harder: null,
    serves: TRUNK,
  },
  {
    id: 'banded-lateral-walk',
    slot: 'trunk',
    implements: ['bands'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'band',
    harder: null,
    serves: TRUNK,
  },
  {
    id: 'pallof-press',
    slot: 'trunk',
    implements: ['bands'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'band',
    harder: null,
    serves: TRUNK,
  },
  {
    id: 'farmer-carry',
    slot: 'trunk',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'seconds',
    basis: 'one-implement-a-hand',
    harder: null,
    serves: TRUNK,
  },
]

describe('the catalogue of design 7.1', () => {
  it('holds the 25 exercises of the table, in its order, with every column', () => {
    expect(EXERCISES).toHaveLength(25)
    expect(TABLE).toHaveLength(25)
    expect(EXERCISES.map((e) => e.id)).toEqual(TABLE.map((row) => row.id))
    for (const row of TABLE) {
      const exercise = exerciseById(row.id)
      expect(exercise, row.id).toBeDefined()
      expect(
        {
          slot: exercise?.slot,
          implements: exercise?.implements,
          bodyweight: exercise?.bodyweight,
          needs: exercise?.needs,
          optionalNeeds: exercise?.optionalNeeds,
          measure: exercise?.measure,
          basis: exercise?.basis,
          harder: exercise?.harder,
          serves: exercise?.serves,
        },
        row.id,
      ).toEqual({
        slot: row.slot,
        implements: row.implements,
        bodyweight: row.bodyweight,
        needs: row.needs,
        optionalNeeds: row.optionalNeeds,
        measure: row.measure,
        basis: row.basis,
        harder: row.harder,
        serves: row.serves,
      })
    }
  })

  it('has the slot counts of the table: 7 knee, 6 hip, 3 calf, 4 plyo, 5 trunk', () => {
    const counts = (slot: Slot) => exercisesOfSlot(slot).length
    expect([
      counts('knee'),
      counts('hip'),
      counts('calf'),
      counts('plyo'),
      counts('trunk'),
    ]).toEqual([7, 6, 3, 4, 5])
  })

  it('has unique, kebab-case ids that are never reused, and no retired exercise yet', () => {
    const ids = EXERCISES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id, id).toMatch(/^[a-z]+(-[a-z]+)*$/)
    expect(EXERCISES.filter((e) => e.retired === true)).toEqual([])
  })

  it('looks an exercise up by id, and says no to an id it has never held', () => {
    expect(exerciseById('back-squat')?.slot).toBe('knee')
    expect(exerciseById('bench-press')).toBeUndefined()
    expect(isExerciseId('farmer-carry')).toBe(true)
    expect(isExerciseId('bench-press')).toBe(false)
    expect(isExerciseId('')).toBe(false)
  })

  it('serves F-lib and F7 everywhere', () => {
    for (const e of EXERCISES) {
      expect(e.serves, e.id).toContain('F-lib')
      expect(e.serves, e.id).toContain('F7')
    }
  })

  it('counts jumps as contacts, holds as seconds and the rest as reps', () => {
    for (const e of EXERCISES) {
      if (e.slot === 'plyo') expect(e.measure, e.id).toBe('contacts')
      else if (e.id === 'side-plank' || e.id === 'farmer-carry') {
        expect(e.measure, e.id).toBe('seconds')
      } else expect(e.measure, e.id).toBe('reps')
    }
  })

  it('links each exercise to a harder movement that exists, never to itself or back', () => {
    for (const e of EXERCISES) {
      const seen = new Set<string>([e.id])
      let next = e.harder
      while (next !== null) {
        expect(isExerciseId(next), `${e.id} -> ${next}`).toBe(true)
        expect(seen.has(next), `${e.id} loops through ${next}`).toBe(false)
        seen.add(next)
        next = exerciseById(next)?.harder ?? null
      }
    }
    // the four harder movements the ladders do not reach
    for (const id of [
      'split-squat',
      'step-up',
      'single-leg-box-squat',
      'single-leg-rdl',
    ] as const) {
      for (const slot of ['knee', 'hip', 'calf'] as const) {
        expect(SLOT_LADDERS[slot], `${id} in ${slot}`).not.toContain(id)
      }
    }
    // a harder movement stays in the slot of the movement it follows
    for (const e of EXERCISES) {
      if (e.harder !== null) {
        const harder = exerciseById(e.harder)
        expect(harder?.slot, `${e.id} -> ${e.harder}`).toBe(e.slot)
      }
    }
  })
})

describe('the slot ladders of design 7.2', () => {
  it('are the three ordered lists of the design', () => {
    expect(SLOT_LADDERS).toEqual({
      knee: ['back-squat', 'leg-press', 'goblet-squat', 'tempo-squat'],
      hip: ['romanian-deadlift', 'dumbbell-rdl', 'kettlebell-rdl', 'leg-curl', 'hip-thrust'],
      calf: ['standing-calf-raise', 'seated-calf-raise', 'single-leg-calf-raise'],
    })
    expect(ladderFor('knee')).toBe(SLOT_LADDERS.knee)
    expect(ladderFor('plyo')).toEqual([])
    expect(ladderFor('trunk')).toEqual([])
  })

  it('hold only exercises of their own slot, and none that is retired', () => {
    for (const slot of ['knee', 'hip', 'calf'] as const) {
      for (const id of SLOT_LADDERS[slot]) {
        const exercise = exerciseById(id)
        expect(exercise?.slot, id).toBe(slot)
        expect(exercise?.retired, id).toBeUndefined()
      }
    }
  })

  it('end in the floor exercise, which needs no equipment, so every slot has an answer', () => {
    expect(FLOOR_EXERCISE).toEqual({
      knee: 'tempo-squat',
      hip: 'hip-thrust',
      calf: 'standing-calf-raise',
    })
    for (const slot of ['knee', 'hip', 'calf'] as const) {
      expect(SLOT_LADDERS[slot], slot).toContain(FLOOR_EXERCISE[slot])
      expect(isFeasible(FLOOR_EXERCISE[slot], []), slot).toBe(true)
      expect(usableImplements(FLOOR_EXERCISE[slot], [])).toEqual([null])
    }
  })

  it('make the plyometric ladder of four movements from the harder links', () => {
    expect(PLYO_LADDER).toEqual(['pogo-hop', 'line-hop', 'squat-jump', 'single-leg-hop'])
    const chain: ExerciseId[] = []
    let next: ExerciseId | null = 'pogo-hop'
    while (next !== null) {
      chain.push(next)
      next = exerciseById(next)?.harder ?? null
    }
    expect(chain).toEqual([...PLYO_LADDER])
    expect(exercisesOfSlot('plyo').map((e) => e.id)).toEqual([...PLYO_LADDER])
  })
})

/** The first feasible entry of a ladder: the core of `pickLift` (E14-4), reduced to its first step. */
function firstFeasible(
  slot: LadderSlot,
  equipment: EquipmentConfig[],
  options?: FeasibilityOptions,
): ExerciseId | undefined {
  return SLOT_LADDERS[slot].find((id) => isFeasible(id, equipment, options))
}

describe('isFeasible and usableImplements', () => {
  it('needs the implement: the bar, the machine, the dumbbells or the kettlebells', () => {
    expect(isFeasible('back-squat', [])).toBe(false)
    expect(isFeasible('back-squat', have('barbell'))).toBe(true)
    expect(isFeasible('back-squat', have('dumbbells', 'kettlebells', 'leg-press'))).toBe(false)
    expect(isFeasible('leg-press', have('leg-press'))).toBe(true)
    expect(isFeasible('leg-curl', have('leg-press'))).toBe(false)
    expect(isFeasible('goblet-squat', have('dumbbells'))).toBe(true)
    expect(isFeasible('goblet-squat', have('kettlebells'))).toBe(true)
    expect(isFeasible('goblet-squat', have('barbell', 'step'))).toBe(false)
    expect(isFeasible('dumbbell-rdl', have('kettlebells'))).toBe(false)
    expect(isFeasible('kettlebell-rdl', have('kettlebells'))).toBe(true)
    expect(isFeasible('romanian-deadlift', have('dumbbells'))).toBe(false)
    expect(isFeasible('seated-calf-raise', [])).toBe(false)
    expect(isFeasible('seated-calf-raise', have('dumbbells'))).toBe(true)
    expect(isFeasible('seated-calf-raise', have('calf-machine'))).toBe(true)
    expect(isFeasible('banded-lateral-walk', [])).toBe(false)
    expect(isFeasible('pallof-press', have('bands'))).toBe(true)
    expect(isFeasible('farmer-carry', have('step', 'bands'))).toBe(false)
    expect(isFeasible('farmer-carry', have('kettlebells'))).toBe(true)
  })

  it('needs the step for the exercises that name it, and only for those', () => {
    expect(isFeasible('step-up', [])).toBe(false)
    expect(isFeasible('step-up', have('dumbbells'))).toBe(false)
    expect(isFeasible('step-up', have('step'))).toBe(true)
    expect(isFeasible('single-leg-box-squat', have('kettlebells'))).toBe(false)
    expect(isFeasible('single-leg-box-squat', have('step', 'kettlebells'))).toBe(true)
    expect(isFeasible('single-leg-calf-raise', [])).toBe(false)
    expect(isFeasible('single-leg-calf-raise', have('step'))).toBe(true)
    // optional: a split squat, a hip thrust and a standing calf raise work on the floor
    for (const id of ['split-squat', 'hip-thrust', 'standing-calf-raise'] as const) {
      expect(isFeasible(id, []), id).toBe(true)
    }
  })

  it('lets bodyweight exercises through with no equipment at all', () => {
    for (const id of [
      'tempo-squat',
      'pogo-hop',
      'line-hop',
      'squat-jump',
      'single-leg-hop',
      'side-plank',
      'dead-bug',
    ] as const) {
      expect(isFeasible(id, []), id).toBe(true)
    }
  })

  it('answers false for an exercise it does not know', () => {
    expect(usableImplements('bench-press' as ExerciseId, have(...ALL_KINDS))).toEqual([])
    expect(isFeasible('bench-press' as ExerciseId, have(...ALL_KINDS))).toBe(false)
  })

  it('lists the implements in the table order, the equipment the runner has, then bodyweight', () => {
    expect(usableImplements('split-squat', have('kettlebells', 'dumbbells'))).toEqual([
      'dumbbells',
      'kettlebells',
      null,
    ])
    expect(usableImplements('split-squat', have('kettlebells'))).toEqual(['kettlebells', null])
    expect(usableImplements('split-squat', [])).toEqual([null])
    expect(usableImplements('standing-calf-raise', have('barbell', 'calf-machine'))).toEqual([
      'calf-machine',
      'barbell',
      null,
    ])
    expect(usableImplements('hip-thrust', have('dumbbells', 'barbell'))).toEqual([
      'barbell',
      'dumbbells',
      null,
    ])
    expect(usableImplements('back-squat', have('barbell'))).toEqual(['barbell'])
    expect(usableImplements('tempo-squat', have(...ALL_KINDS))).toEqual([null])
  })

  it('leaves the barbell out as an implement when asked: the ramp-in and return templates', () => {
    const noBar = { barbell: false }
    expect(isFeasible('back-squat', have('barbell'), noBar)).toBe(false)
    expect(isFeasible('romanian-deadlift', have('barbell', 'dumbbells'), noBar)).toBe(false)
    expect(usableImplements('standing-calf-raise', have('barbell', 'calf-machine'), noBar)).toEqual(
      ['calf-machine', null],
    )
    expect(usableImplements('hip-thrust', have('barbell'), noBar)).toEqual([null])
    expect(usableImplements('hip-thrust', have('barbell'), { barbell: true })).toEqual([
      'barbell',
      null,
    ])
  })

  it('picks the lead lift of design 7.2 from what a runner has', () => {
    // with no equipment: the floor of each slot
    expect(firstFeasible('knee', [])).toBe('tempo-squat')
    expect(firstFeasible('hip', [])).toBe('hip-thrust')
    expect(firstFeasible('calf', [])).toBe('standing-calf-raise')
    // dumbbells: a goblet squat leads the knee slot, the dumbbell hinge the hip slot
    expect(firstFeasible('knee', have('dumbbells'))).toBe('goblet-squat')
    expect(firstFeasible('hip', have('dumbbells'))).toBe('dumbbell-rdl')
    expect(firstFeasible('hip', have('kettlebells'))).toBe('kettlebell-rdl')
    // a bar leads once it is allowed, and the dumbbells lead before that
    const gear = have('barbell', 'dumbbells')
    expect(firstFeasible('knee', gear)).toBe('back-squat')
    expect(firstFeasible('hip', gear)).toBe('romanian-deadlift')
    expect(firstFeasible('knee', gear, { barbell: false })).toBe('goblet-squat')
    expect(firstFeasible('hip', gear, { barbell: false })).toBe('dumbbell-rdl')
    // a gym: the leg press follows the bar
    expect(firstFeasible('knee', have('leg-press'))).toBe('leg-press')
    expect(firstFeasible('hip', have('leg-curl'))).toBe('leg-curl')
    expect(firstFeasible('calf', have('calf-machine'))).toBe('standing-calf-raise')
  })
})

describe('substitutes', () => {
  it("is the slot's feasible ladder entries, then its feasible harder movements, without the exercise", () => {
    // knee: the ladder in order, then the split squat, the step-up and the single-leg box squat
    expect(substitutes('back-squat', have('barbell', 'leg-press', 'dumbbells'))).toEqual([
      'leg-press',
      'goblet-squat',
      'tempo-squat',
      'split-squat',
    ])
    expect(substitutes('back-squat', [])).toEqual(['tempo-squat', 'split-squat'])
    expect(substitutes('back-squat', have('step'))).toEqual([
      'tempo-squat',
      'split-squat',
      'step-up',
      'single-leg-box-squat',
    ])
    expect(substitutes('tempo-squat', have('dumbbells'))).toEqual(['goblet-squat', 'split-squat'])
    expect(substitutes('goblet-squat', have('dumbbells', 'barbell'))).toEqual([
      'back-squat',
      'tempo-squat',
      'split-squat',
    ])
    // hip: the single-leg Romanian deadlift follows the ladder
    expect(substitutes('romanian-deadlift', have('barbell', 'kettlebells'))).toEqual([
      'kettlebell-rdl',
      'hip-thrust',
      'single-leg-rdl',
    ])
    expect(substitutes('hip-thrust', [])).toEqual(['single-leg-rdl'])
    // calf: the ladder holds all three, so there is no harder movement to add
    expect(substitutes('standing-calf-raise', have('step'))).toEqual(['single-leg-calf-raise'])
    expect(substitutes('standing-calf-raise', have('dumbbells', 'step'))).toEqual([
      'seated-calf-raise',
      'single-leg-calf-raise',
    ])
    expect(substitutes('standing-calf-raise', [])).toEqual([])
  })

  it('lets a swap or a pin reach the harder movements, which the ladders do not (design 7.2)', () => {
    const everything = have(...ALL_KINDS)
    const harder = {
      knee: ['split-squat', 'step-up', 'single-leg-box-squat'],
      hip: ['single-leg-rdl'],
    } as const
    for (const slot of ['knee', 'hip'] as const) {
      for (const id of SLOT_LADDERS[slot]) {
        const list = substitutes(id, everything)
        for (const move of harder[slot]) {
          expect(list, `${id} -> ${move}`).toContain(move)
        }
        // ladder entries first, in ladder order, then the harder movements in catalogue order
        const onLadder = SLOT_LADDERS[slot].filter((other) => other !== id)
        expect(list, id).toEqual([...onLadder, ...harder[slot]])
      }
    }
    // a harder movement is swapped for the ladder and for the other harder movements
    expect(substitutes('split-squat', have('dumbbells', 'barbell', 'step'))).toEqual([
      'back-squat',
      'goblet-squat',
      'tempo-squat',
      'step-up',
      'single-leg-box-squat',
    ])
    expect(substitutes('single-leg-rdl', have('kettlebells'))).toEqual([
      'kettlebell-rdl',
      'hip-thrust',
    ])
    // none of them is offered without the equipment it needs
    expect(substitutes('back-squat', have('dumbbells'))).not.toContain('step-up')
    expect(substitutes('back-squat', have('dumbbells'))).not.toContain('single-leg-box-squat')
  })

  it('has no ladder for the jumps and the trunk movements, and none for an unknown id', () => {
    expect(substitutes('pogo-hop', have(...ALL_KINDS))).toEqual([])
    expect(substitutes('side-plank', have(...ALL_KINDS))).toEqual([])
    expect(substitutes('bench-press' as ExerciseId, have(...ALL_KINDS))).toEqual([])
  })

  it('follows the barbell option', () => {
    const gear = have('barbell', 'dumbbells')
    expect(substitutes('goblet-squat', gear)).toEqual(['back-squat', 'tempo-squat', 'split-squat'])
    expect(substitutes('goblet-squat', gear, { barbell: false })).toEqual([
      'tempo-squat',
      'split-squat',
    ])
  })

  it('never offers the exercise itself or a candidate the equipment cannot do', () => {
    const everything = have(...ALL_KINDS)
    for (const e of EXERCISES) {
      const list = substitutes(e.id, everything)
      expect(list, e.id).not.toContain(e.id)
      for (const other of list)
        expect(isFeasible(other, everything), `${e.id}: ${other}`).toBe(true)
    }
  })
})

describe('what a load means (design 5.2)', () => {
  it('follows the implement', () => {
    expect(loadMeaning('back-squat', 'barbell')).toBe('total-with-bar')
    expect(loadMeaning('romanian-deadlift', 'barbell')).toBe('total-with-bar')
    expect(loadMeaning('leg-press', 'leg-press')).toBe('stack')
    expect(loadMeaning('leg-curl', 'leg-curl')).toBe('stack')
    expect(loadMeaning('standing-calf-raise', 'calf-machine')).toBe('stack')
    expect(loadMeaning('goblet-squat', 'kettlebells')).toBe('one-implement')
    expect(loadMeaning('split-squat', 'dumbbells')).toBe('one-implement')
    expect(loadMeaning('dumbbell-rdl', 'dumbbells')).toBe('one-implement')
    expect(loadMeaning('farmer-carry', 'kettlebells')).toBe('one-implement')
    // a bar or a dumbbell on a hip thrust, a barbell on a calf raise
    expect(loadMeaning('hip-thrust', 'barbell')).toBe('total-with-bar')
    expect(loadMeaning('hip-thrust', 'dumbbells')).toBe('one-implement')
    expect(loadMeaning('standing-calf-raise', 'barbell')).toBe('total-with-bar')
    expect(loadMeaning('standing-calf-raise', 'dumbbells')).toBe('one-implement')
    // a weight added to a bodyweight movement is the extra weight
    expect(loadMeaning('single-leg-box-squat', 'dumbbells')).toBe('added')
    expect(loadMeaning('single-leg-calf-raise', 'dumbbells')).toBe('added')
  })

  it('is none where nothing is tracked: bodyweight, a band, or nothing added', () => {
    expect(loadMeaning('hip-thrust', null)).toBe('none')
    expect(loadMeaning('split-squat', null)).toBe('none')
    expect(loadMeaning('single-leg-box-squat', null)).toBe('none')
    expect(loadMeaning('tempo-squat', null)).toBe('none')
    expect(loadMeaning('pogo-hop', null)).toBe('none')
    expect(loadMeaning('side-plank', null)).toBe('none')
    expect(loadMeaning('banded-lateral-walk', 'bands')).toBe('none')
    expect(loadMeaning('pallof-press', 'bands')).toBe('none')
    expect(loadMeaning('step-up', 'step')).toBe('none')
    expect(loadMeaning('bench-press' as ExerciseId, 'barbell')).toBe('none')
  })

  it('has a meaning for every implement of every exercise that tracks a load', () => {
    for (const e of EXERCISES) {
      for (const implement of e.implements) {
        const meaning = loadMeaning(e.id, implement)
        if (e.basis === 'band' || e.basis === 'bodyweight') expect(meaning, e.id).toBe('none')
        else expect(meaning, `${e.id} with ${implement}`).not.toBe('none')
      }
    }
  })
})

describe('the catalogue and the Params', () => {
  it('has a starting fraction of body weight for exactly the exercises whose load is a weight', () => {
    const loaded = EXERCISES.filter((e) => e.basis !== 'bodyweight' && e.basis !== 'band').map(
      (e) => e.id,
    )
    expect(loaded).toHaveLength(16)
    expect(Object.keys(P.f8.startFractionBodyweight.value).sort()).toEqual([...loaded].sort())
  })

  it('starts the movements of "added, if any" with no added load', () => {
    for (const e of EXERCISES.filter((x) => x.basis === 'added')) {
      expect(P.f8.startFractionBodyweight.value[e.id], e.id).toBe(0)
    }
  })
})

describe('the catalogue and the copy', () => {
  it('points every exercise at a name, a cue and a note that are registered templates', () => {
    for (const e of EXERCISES) {
      expect(e.name, e.id).toBe(`strength.name.${e.id}`)
      expect(e.cue, e.id).toBe(`strength.cue.${e.id}`)
      expect(Object.hasOwn(TEMPLATES, e.name), e.name).toBe(true)
      expect(Object.hasOwn(TEMPLATES, e.cue), e.cue).toBe(true)
      expect(Object.hasOwn(TEMPLATES, e.note), e.note).toBe(true)
      expect(e.note, e.id).toMatch(/^strength\.note\./)
    }
  })

  it('leaves no name or cue template without an exercise', () => {
    const ids = new Set<string>(EXERCISES.map((e) => e.id))
    for (const key of Object.keys(TEMPLATES)) {
      const match = /^strength\.(?:name|cue)\.(.+)$/.exec(key)
      if (match !== null) expect(ids.has(match[1] ?? ''), key).toBe(true)
    }
  })

  it('gives a lowering note to the lifts, a calf note to the calf raises and a landing note to jumps', () => {
    for (const e of EXERCISES) {
      if (e.slot === 'plyo') expect(e.note, e.id).toBe('strength.note.plyo')
      if (e.slot === 'calf') expect(e.note, e.id).toBe('strength.note.calf')
      if (e.slot === 'trunk') expect(e.note, e.id).toBe('strength.note.controlled')
      if (e.slot === 'knee' || e.id.endsWith('rdl') || e.id === 'romanian-deadlift') {
        expect(e.note, e.id).toMatch(/^strength\.note\.lower-/)
      }
    }
  })
})

describe('shared/domain/strengthLibrary.ts', () => {
  /** The source with its comments removed, so a figure in a comment is not counted. */
  const code = readFileSync(
    join(import.meta.dirname, '../../../shared/domain/strengthLibrary.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

  it('has no numeric literal: every number is a Param', () => {
    expect(code.length).toBeGreaterThan(5000)
    expect(code.match(/(?<![\w$.-])\d+(?:\.\d+)?(?![\w$])/g)).toBeNull()
    // outside the rule tags in quotes ('F7', 'H10') the code holds no digit at all
    expect(code.replace(/'[^'\n]*'/g, "''")).not.toMatch(/\d/)
  })

  it('reads no clock, does no I/O and imports only types and the shared contract', () => {
    expect(code).not.toMatch(/\bDate\b|Math\.random|\bprocess\b|\bfetch\(|\bnode:/)
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '').sort()
    expect(imports).toEqual(['../copy/strengthTemplates.ts', '../types.ts'])
    expect(code).toMatch(/import type \{ StrengthTemplateId \}/)
    expect(code).toMatch(/import type \{ EquipmentConfig, EquipmentKind, Slot \}/)
  })
})

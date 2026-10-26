// The strength engine (E14-4): the template of a week, the block position and the ramp-in, the
// lift of each slot, the load of each lift (rules F8.1 to F8.7, F9), the estimated maximum, the
// derived workout and the history behind it. Every figure comes from a synthetic runner: no
// real history, equipment or names.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import {
  SLOT_LADDERS,
  exerciseById,
  isFeasible,
  type ExerciseId,
} from '../../../shared/domain/strengthLibrary.ts'
import { STRENGTH_TEMPLATES } from '../../../shared/copy/strengthTemplates.ts'
import {
  fromGrams,
  lightestLoad,
  roundDownToStep,
  stepFrom,
  toGrams,
} from '../../../shared/domain/weight.ts'
import {
  anchorEstimate,
  blockPosition,
  estimateOneRm,
  percentOfMax,
  pickLift,
  rampInWeeks,
  sessionVariant,
  strengthTemplate,
  structuresFor,
  suggestLoad,
  waysFor,
  type BlockPosition,
  type LoadRequest,
  type LoadSuggestion,
} from '../../../shared/engine/strength.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  LiftingLevel,
  StrengthContext,
  StrengthLogEntry,
  StrengthWeek,
} from '../../../shared/engine/types.ts'
import type {
  EquipmentConfig,
  EquipmentKind,
  LoadSteps,
  StrengthTemplate,
} from '../../../shared/types.ts'
import {
  ALL_KINDS,
  context,
  have,
  lb,
  liftLog,
  log,
  monday,
  plan,
  week,
  withSetup,
  type Row,
} from './strength-fixtures.ts'

// ---------------------------------------------------------------------------------------------
// The block position, the ramp-in and the template (rules F7, E5)
// ---------------------------------------------------------------------------------------------

describe('blockPosition', () => {
  const ctx = context()

  it('is week k of n of the stored plan, counted by the one block counter', () => {
    expect(blockPosition(ctx, monday(0))).toEqual({ week: 1, of: 12, rampInWeeks: 3 })
    expect(blockPosition(ctx, monday(5))).toEqual({ week: 6, of: 12, rampInWeeks: 3 })
    expect(blockPosition(ctx, monday(11))).toEqual({ week: 12, of: 12, rampInWeeks: 3 })
  })

  it('is null outside the block', () => {
    expect(blockPosition(ctx, monday(12))).toBeNull()
    expect(blockPosition(ctx, monday(20))).toBeNull()
    expect(blockPosition(ctx, addDays(monday(0), -7))).toBeNull()
  })

  it('does not depend on the order of the weeks', () => {
    const shuffled = context({ weeks: [...plan(30, 12)].reverse() })
    expect(blockPosition(shuffled, monday(5))).toEqual(blockPosition(ctx, monday(5)))
  })

  it('counts the run of flagged weeks that holds the week, so a block under way is not restarted', () => {
    // a re-plan keeps the weeks already flagged: the stored plan alone says week 6 of 12
    const stored = context({ weeks: plan(30, 12).slice(2) })
    expect(blockPosition(stored, monday(5))).toEqual({ week: 4, of: 10, rampInWeeks: 3 })
  })
})

describe('rampInWeeks', () => {
  const [shortest, longest] = P.flib.heavyRampInWeeks.range ?? [0, 0]
  const fallback = P.flib.heavyRampInWeeks.value

  const cases: Array<[string, LiftingLevel, boolean, number | null, number]> = [
    ['new, not lifting', 'new', false, 30, longest],
    ['new, lifting now', 'new', true, 30, longest],
    ['some, not lifting (the owner)', 'some', false, 30, fallback],
    ['some, lifting now', 'some', true, 30, fallback],
    ['experienced, not lifting', 'experienced', false, 30, fallback],
    ['experienced, lifting now', 'experienced', true, 30, shortest],
    ['experienced, lifting now, age unknown', 'experienced', true, null, shortest],
    ['some, at the masters age', 'some', false, P.f5.mastersMinAge.value, longest],
    ['some, one year under it', 'some', false, P.f5.mastersMinAge.value - 1, fallback],
    ['experienced, lifting now, at the masters age', 'experienced', true, 50, longest],
  ]
  it.each(cases)('%s', (_name, level, currentlyLifting, age, expected) => {
    const ctx = withSetup({ level, currentlyLifting }, { athlete: { ...context().athlete, age } })
    expect(rampInWeeks(ctx)).toBe(expected)
  })

  it('is 2 to 4 weeks around the default of 3', () => {
    expect([shortest, fallback, longest]).toEqual([2, 3, 4])
  })

  it('is the default until the setup is saved, whatever the level or the age', () => {
    const ctx = withSetup(
      { saved: false, level: 'new' },
      { athlete: { ...context().athlete, age: 55 } },
    )
    expect(rampInWeeks(ctx)).toBe(fallback)
    expect(blockPosition(ctx, monday(0))?.rampInWeeks).toBe(fallback)
  })

  describe('after a regenerate (design 8.3)', () => {
    const block = monday(10)
    const logged = (weeksBack: number[], template: StrengthTemplate = 'heavy') =>
      weeksBack.map((back) => log(`l${String(back)}`, addDays(block, -7 * back + 1), { template }))
    const regenerated = (logs: StrengthLogEntry[]) =>
      context({
        weeks: plan(40, 12).map((w, i) => ({
          ...w,
          flags: i >= 10 && i < 22 ? ['strength-block'] : [],
        })),
        logs,
      })

    it('skips the ramp-in when block sessions were logged in each of the last 4 weeks', () => {
      expect(P.f7.blockCreditWeeks.value).toBe(4)
      const ctx = regenerated(logged([1, 2, 3, 4]))
      expect(rampInWeeks(ctx, block)).toBe(0)
      expect(blockPosition(ctx, block)).toEqual({ week: 1, of: 12, rampInWeeks: 0 })
      expect(
        strengthTemplate(week(10, { flags: ['strength-block'] }), blockPosition(ctx, block)),
      ).toBe('heavy')
    })

    it('counts a ramp-in session as a block session, whatever its mode', () => {
      const ctx = regenerated([
        ...logged([1, 2], 'ramp-in'),
        ...logged([3, 4]).map((entry) => ({ ...entry, mode: 'lighter-day' as const })),
      ])
      expect(rampInWeeks(ctx, block)).toBe(0)
    })

    it('does not skip it when one of the 4 weeks has none, or its session was not a block session', () => {
      expect(rampInWeeks(regenerated(logged([1, 2, 3])), block)).toBe(3)
      expect(rampInWeeks(regenerated(logged([1, 2, 4])), block)).toBe(3)
      expect(rampInWeeks(regenerated(logged([1, 2, 3, 4], 'maintenance')), block)).toBe(3)
      expect(rampInWeeks(regenerated(logged([1, 2, 3, 4], 'lighter-week')), block)).toBe(3)
    })

    it('looks at the weeks before the block only, so logs inside it never change its ramp-in', () => {
      const inside = [1, 2, 3, 4].map((ahead) =>
        log(`in${String(ahead)}`, addDays(block, 7 * ahead), { template: 'heavy' }),
      )
      expect(rampInWeeks(regenerated(inside), block)).toBe(3)
    })

    it('leaves the length by level alone when no block start is given', () => {
      expect(rampInWeeks(regenerated(logged([1, 2, 3, 4])))).toBe(3)
    })
  })
})

describe('strengthTemplate', () => {
  const inBlock = (weekNumber: number, rampIn = 3): BlockPosition => ({
    week: weekNumber,
    of: 12,
    rampInWeeks: rampIn,
  })
  const flagged = (flags: string[], over: Partial<StrengthWeek> = {}) => week(0, { flags, ...over })

  it('is the ramp-in for the first weeks of the block and heavy after them', () => {
    const blockWeek = flagged(['strength-block'])
    const templates = Array.from({ length: 12 }, (_, i) =>
      strengthTemplate(blockWeek, inBlock(i + 1)),
    )
    expect(templates).toEqual([
      'ramp-in',
      'ramp-in',
      'ramp-in',
      ...Array.from({ length: 9 }, () => 'heavy'),
    ])
  })

  it.each([2, 3, 4])('is heavy from the week after a ramp-in of %i weeks', (rampIn) => {
    const blockWeek = flagged(['strength-block'])
    expect(strengthTemplate(blockWeek, inBlock(rampIn, rampIn))).toBe('ramp-in')
    expect(strengthTemplate(blockWeek, inBlock(rampIn + 1, rampIn))).toBe('heavy')
  })

  it('is heavy from the first week when a regenerate skipped the ramp-in', () => {
    expect(strengthTemplate(flagged(['strength-block']), inBlock(1, 0))).toBe('heavy')
  })

  it('is a lighter week for a running recovery week inside the block, by flag or by the stored boolean', () => {
    expect(strengthTemplate(flagged(['strength-block', 'recovery']), inBlock(7))).toBe(
      'lighter-week',
    )
    expect(strengthTemplate(flagged(['strength-block'], { isRecovery: true }), inBlock(7))).toBe(
      'lighter-week',
    )
    // inside the ramp-in as well: the load is kept either way, and the sets are fewer
    expect(strengthTemplate(flagged(['strength-block', 'recovery']), inBlock(2))).toBe(
      'lighter-week',
    )
  })

  it('is maintenance after the block and before the taper, recovery week or not', () => {
    expect(strengthTemplate(flagged([], { phase: 'specific' }), null)).toBe('maintenance')
    expect(strengthTemplate(flagged([], { phase: 'build' }), null)).toBe('maintenance')
    expect(strengthTemplate(flagged(['recovery'], { phase: 'specific' }), null)).toBe('maintenance')
  })

  it('is the taper in a taper week, by flag or by phase, and in a race week', () => {
    expect(strengthTemplate(flagged(['taper'], { phase: 'specific' }), null)).toBe('taper')
    expect(strengthTemplate(flagged([], { phase: 'taper' }), null)).toBe('taper')
    expect(strengthTemplate(flagged(['race-week']), null)).toBe('taper')
    expect(strengthTemplate(flagged([], { phase: 'race' }), null)).toBe('taper')
  })

  it.each([
    'injury-return',
    'injury-level-2',
    'restart-floor',
    'run-walk',
    'ladder-3',
    'post-race',
  ])('is the return template in a %s week, in the block or out of it', (flag) => {
    expect(strengthTemplate(flagged([flag, 'strength-block']), inBlock(8))).toBe('return')
    expect(strengthTemplate(flagged([flag, 'strength-block']), inBlock(1))).toBe('return')
    expect(strengthTemplate(flagged([flag, 'recovery']), inBlock(8))).toBe('return')
    expect(strengthTemplate(flagged([flag]), null)).toBe('return')
    expect(strengthTemplate(flagged([flag, 'taper']), null)).toBe('return')
  })

  it('does not read a flag it does not know', () => {
    expect(strengthTemplate(flagged(['gut-training', 'b2b', 'disrupted']), null)).toBe(
      'maintenance',
    )
    expect(strengthTemplate(flagged(['strength-block', 'peak']), inBlock(9))).toBe('heavy')
  })

  it('names every template once across the cases above', () => {
    const seen = new Set<StrengthTemplate>([
      strengthTemplate(flagged([]), inBlock(1)),
      strengthTemplate(flagged([]), inBlock(9)),
      strengthTemplate(flagged(['recovery']), inBlock(9)),
      strengthTemplate(flagged([]), null),
      strengthTemplate(flagged(['taper']), null),
      strengthTemplate(flagged(['restart-floor']), null),
    ])
    expect([...seen].sort()).toEqual(
      ['heavy', 'lighter-week', 'maintenance', 'ramp-in', 'return', 'taper'].sort(),
    )
  })
})

describe('sessionVariant', () => {
  it('alternates A and B in the order of a week with two sessions', () => {
    const ctx = context()
    const [a, b] = [
      { id: 's6a', date: addDays(monday(6), 1), order: 1 },
      { id: 's6b', date: addDays(monday(6), 4), order: 1 },
    ]
    expect(sessionVariant(ctx, a)).toBe('A')
    expect(sessionVariant(ctx, b)).toBe('B')
  })

  it('orders two sessions on one day by their order, then their id', () => {
    const ctx = context({
      sessions: [
        { id: 'x2', date: monday(2), order: 2 },
        { id: 'x1', date: monday(2), order: 1 },
      ],
    })
    expect(sessionVariant(ctx, { id: 'x1', date: monday(2), order: 1 })).toBe('A')
    expect(sessionVariant(ctx, { id: 'x2', date: monday(2), order: 2 })).toBe('B')
  })

  it('alternates the weeks when a week holds one session', () => {
    const ctx = context({
      sessions: Array.from({ length: 6 }, (_, i) => ({
        id: `m${String(i)}`,
        date: addDays(monday(12 + i), 2),
        order: 1,
      })),
    })
    const variants = ctx.sessions.map((s) => sessionVariant(ctx, s))
    expect(variants).toEqual(['A', 'B', 'A', 'B', 'A', 'B'])
  })

  it('reads the session itself even when the plan does not list it', () => {
    const ctx = context({ sessions: [] })
    const offPlan = { id: 'extra', date: addDays(monday(13), 2), order: 1 }
    expect(sessionVariant(ctx, offPlan)).toBe('B')
    expect(sessionVariant(ctx, { ...offPlan, date: addDays(monday(14), 2) })).toBe('A')
  })

  it('does not depend on the order of the planned sessions', () => {
    const ctx = context()
    const reversed = context({ sessions: [...ctx.sessions].reverse() })
    for (const s of ctx.sessions) expect(sessionVariant(reversed, s)).toBe(sessionVariant(ctx, s))
  })

  it('belongs to the Monday of the date', () => {
    expect(mondayOf(addDays(monday(6), 4))).toBe(monday(6))
  })
})

// ---------------------------------------------------------------------------------------------
// The lift of each slot (rule F7, design 7.2)
// ---------------------------------------------------------------------------------------------

describe('pickLift', () => {
  const ids = (
    kinds: EquipmentKind[],
    options: { barbell?: boolean; variant?: 'A' | 'B' } = {},
    setup: Partial<StrengthContext['setup']> = {},
  ) => {
    const ctx = withSetup({ equipment: have(...kinds), ...setup })
    return {
      knee: pickLift('knee', ctx, options),
      hip: pickLift('hip', ctx, options),
      calf: pickLift('calf', ctx, options),
      calfB: pickLift('calf', ctx, { ...options, variant: 'B' }),
    }
  }
  const names = (r: ReturnType<typeof ids>) => [
    r.knee.exerciseId,
    r.hip.exerciseId,
    r.calf.exerciseId,
    r.calfB.exerciseId,
  ]

  it('gives a bodyweight workout with no equipment', () => {
    const r = ids([])
    expect(names(r)).toEqual([
      'tempo-squat',
      'hip-thrust',
      'standing-calf-raise',
      'standing-calf-raise',
    ])
    for (const choice of [r.knee, r.hip, r.calf, r.calfB]) {
      expect(choice.implement).toBeNull()
      expect(choice.steps).toBeNull()
      expect(choice.floor).toBe(false)
    }
  })

  it('leads with the barbell lifts for anyone with a bar after the ramp-in', () => {
    const r = ids(['barbell'])
    expect(names(r)).toEqual([
      'back-squat',
      'romanian-deadlift',
      'standing-calf-raise',
      'standing-calf-raise',
    ])
    expect(r.knee.implement).toBe('barbell')
    expect(r.hip.implement).toBe('barbell')
    expect(r.knee.steps).toEqual({ minG: lb(45), stepG: lb(5), maxG: null })
  })

  it('leaves the barbell out in the ramp-in and the return, at any lifting level', () => {
    for (const level of ['new', 'some', 'experienced'] as const) {
      const r = ids(['barbell'], { barbell: false }, { level, currentlyLifting: true })
      expect(names(r)).toEqual([
        'tempo-squat',
        'hip-thrust',
        'standing-calf-raise',
        'standing-calf-raise',
      ])
      for (const choice of [r.knee, r.hip, r.calf]) expect(choice.implement).not.toBe('barbell')
    }
    expect(names(ids(['barbell', 'dumbbells'], { barbell: false }))).toEqual([
      'goblet-squat',
      'dumbbell-rdl',
      'standing-calf-raise',
      'seated-calf-raise',
    ])
  })

  it('moves from the dumbbell lifts to the barbell ones at the end of the ramp-in', () => {
    const kinds: EquipmentKind[] = ['barbell', 'dumbbells']
    expect(ids(kinds, { barbell: false }).knee.exerciseId).toBe('goblet-squat')
    expect(ids(kinds, { barbell: true }).knee.exerciseId).toBe('back-squat')
    expect(ids(kinds, { barbell: true }).hip.exerciseId).toBe('romanian-deadlift')
  })

  it('picks the dumbbell, kettlebell and machine lifts from the ladder', () => {
    expect(names(ids(['dumbbells']))).toEqual([
      'goblet-squat',
      'dumbbell-rdl',
      'standing-calf-raise',
      'seated-calf-raise',
    ])
    expect(names(ids(['kettlebells']))).toEqual([
      'goblet-squat',
      'kettlebell-rdl',
      'standing-calf-raise',
      'standing-calf-raise',
    ])
    expect(ids(['dumbbells', 'kettlebells']).knee.implement).toBe('dumbbells')
    expect(names(ids(['leg-press', 'leg-curl', 'calf-machine']))).toEqual([
      'leg-press',
      'leg-curl',
      'standing-calf-raise',
      'seated-calf-raise',
    ])
    expect(ids(['calf-machine']).calf.implement).toBe('calf-machine')
  })

  it('does a bodyweight movement when a step is the only equipment, and the single-leg raise on B', () => {
    expect(names(ids(['step']))).toEqual([
      'tempo-squat',
      'hip-thrust',
      'standing-calf-raise',
      'single-leg-calf-raise',
    ])
    expect(names(ids(['bands']))).toEqual(names(ids([])))
  })

  it('takes the first feasible calf entry on A and the second on B, the first again when only one is feasible', () => {
    const dumbbells = ids(['dumbbells'])
    expect(dumbbells.calf.exerciseId).toBe('standing-calf-raise')
    expect(dumbbells.calfB.exerciseId).toBe('seated-calf-raise')
    const nothing = ids([])
    expect(nothing.calfB.exerciseId).toBe(nothing.calf.exerciseId)
    // the knee and hip lifts are the same on both sessions
    expect(pickLift('knee', withSetup({ equipment: have('dumbbells') }), { variant: 'B' })).toEqual(
      dumbbells.knee,
    )
  })

  it('uses the pinned exercise when it is feasible, on both sessions', () => {
    const equipment = have('dumbbells', 'step')
    const ctx = withSetup({ equipment, pinned: { knee: 'step-up', calf: 'single-leg-calf-raise' } })
    expect(pickLift('knee', ctx).exerciseId).toBe('step-up')
    expect(pickLift('knee', ctx, { variant: 'B' }).exerciseId).toBe('step-up')
    expect(pickLift('calf', ctx, { variant: 'B' }).exerciseId).toBe('single-leg-calf-raise')
    expect(pickLift('calf', ctx).implement).toBe('dumbbells')
  })

  it('reaches a harder movement through a pin, which the ladder does not list', () => {
    const ctx = withSetup({ equipment: have('dumbbells'), pinned: { hip: 'single-leg-rdl' } })
    expect(pickLift('hip', ctx).exerciseId).toBe('single-leg-rdl')
    expect(SLOT_LADDERS.hip).not.toContain('single-leg-rdl')
  })

  it('ignores a pin that is not feasible, not in the slot, unknown or left out', () => {
    const equipment = have('dumbbells')
    const first = (pinned: Record<string, string>, avoid: string[] = []) =>
      pickLift('knee', withSetup({ equipment, pinned, avoid })).exerciseId
    expect(first({ knee: 'back-squat' })).toBe('goblet-squat') // no bar
    expect(first({ knee: 'dumbbell-rdl' })).toBe('goblet-squat') // a hip lift
    expect(first({ knee: 'not-a-lift' })).toBe('goblet-squat')
    expect(first({ knee: 'split-squat' }, ['split-squat'])).toBe('goblet-squat')
    expect(first({ hip: 'single-leg-rdl' })).toBe('goblet-squat') // another slot's pin
  })

  it('does not honour a pinned barbell lift in the ramp-in or the return', () => {
    const ctx = withSetup({ equipment: have('barbell'), pinned: { knee: 'back-squat' } })
    expect(pickLift('knee', ctx).exerciseId).toBe('back-squat')
    expect(pickLift('knee', ctx, { barbell: false }).exerciseId).toBe('tempo-squat')
  })

  it('skips an exercise the runner left out and takes the next on the ladder', () => {
    const equipment = have('barbell', 'dumbbells', 'leg-press')
    const pick = (avoid: string[]) => pickLift('knee', withSetup({ equipment, avoid })).exerciseId
    expect(pick([])).toBe('back-squat')
    expect(pick(['back-squat'])).toBe('leg-press')
    expect(pick(['back-squat', 'leg-press'])).toBe('goblet-squat')
    expect(pick(['back-squat', 'leg-press', 'goblet-squat'])).toBe('tempo-squat')
  })

  it('falls to the floor exercise of the slot when every feasible one was left out, and says so', () => {
    const equipment = have('dumbbells')
    const left = withSetup({
      equipment,
      avoid: [
        'goblet-squat',
        'tempo-squat',
        'dumbbell-rdl',
        'hip-thrust',
        'standing-calf-raise',
        'seated-calf-raise',
      ],
    })
    const knee = pickLift('knee', left)
    expect(knee).toMatchObject({ exerciseId: 'tempo-squat', floor: true, implement: null })
    expect(pickLift('hip', left)).toMatchObject({ exerciseId: 'hip-thrust', floor: true })
    expect(pickLift('calf', left)).toMatchObject({ exerciseId: 'standing-calf-raise', floor: true })
  })

  it('is bodyweight only, with nothing left out or pinned, until the setup is saved', () => {
    const ctx = withSetup({
      saved: false,
      equipment: have('barbell', 'dumbbells'),
      avoid: ['tempo-squat'],
      pinned: { knee: 'goblet-squat' },
    })
    expect(pickLift('knee', ctx)).toMatchObject({ exerciseId: 'tempo-squat', implement: null })
    expect(pickLift('hip', ctx).exerciseId).toBe('hip-thrust')
  })

  it('skips an implement that makes no load', () => {
    const empty: EquipmentConfig = { kind: 'dumbbells', loads: { loadsG: [] } }
    const ctx = withSetup({ equipment: [empty] })
    expect(pickLift('knee', ctx).exerciseId).toBe('tempo-squat')
    expect(pickLift('hip', ctx).exerciseId).toBe('hip-thrust')
    // an exercise with a bodyweight form is done in that form, not skipped
    expect(waysFor(ctx, 'split-squat')).toEqual([{ implement: null, steps: null }])
  })

  it('does a banded movement with a band that carries no load', () => {
    const ctx = withSetup({ equipment: have('bands') })
    expect(waysFor(ctx, 'pallof-press')).toEqual([{ implement: 'bands', steps: null }])
  })

  it('yields a lift in every slot for each of the 256 subsets of the eight kinds of equipment', () => {
    expect(ALL_KINDS).toHaveLength(8)
    let counted = 0
    for (let mask = 0; mask < 1 << ALL_KINDS.length; mask += 1) {
      const kinds = ALL_KINDS.filter((_, bit) => (mask >> bit) & 1)
      const equipment = have(...kinds)
      const ctx = withSetup({ equipment })
      for (const barbell of [true, false]) {
        for (const variant of ['A', 'B'] as const) {
          for (const slot of ['knee', 'hip', 'calf'] as const) {
            const choice = pickLift(slot, ctx, { barbell, variant })
            const label = `${kinds.join('+') || 'none'} ${slot} ${String(barbell)} ${variant}`
            expect(choice.floor, label).toBe(false)
            expect(isFeasible(choice.exerciseId, equipment, { barbell }), label).toBe(true)
            expect(exerciseById(choice.exerciseId)?.slot, label).toBe(slot)
            // the barbell is only ever used after the ramp-in, and only with a bar
            if (choice.implement === 'barbell') {
              expect(barbell, label).toBe(true)
              expect(kinds, label).toContain('barbell')
            }
            // an implement is one the runner has, and a loaded one has loads to step through
            if (choice.implement !== null) expect(kinds, label).toContain(choice.implement)
            if (choice.steps !== null) expect(choice.implement, label).not.toBeNull()
            counted += 1
          }
        }
      }
    }
    expect(counted).toBe(256 * 2 * 2 * 3)
  })
})

// ---------------------------------------------------------------------------------------------
// The estimated maximum (rule F8, design 6.3)
// ---------------------------------------------------------------------------------------------

describe('estimateOneRm', () => {
  const divisor = P.f8.e1rmDivisor.value

  it('is load x (1 + (reps + reps left) / divisor), in whole grams', () => {
    expect(estimateOneRm(lb(110), 6, 2)).toBe(Math.round(lb(110) * (1 + 8 / divisor)))
    expect(estimateOneRm(lb(110), 6, 2)).toBe(63200)
    expect(estimateOneRm(lb(200), 1, 0)).toBe(Math.round(lb(200) * (1 + 1 / divisor)))
    expect(Number.isInteger(estimateOneRm(lb(47.5), 7, 3))).toBe(true)
  })

  it('reads a missing count of reps left as none left, the lowest estimate', () => {
    const none = estimateOneRm(lb(100), 5, null)
    expect(none).toBe(estimateOneRm(lb(100), 5, 0))
    expect(none).toBeLessThan(estimateOneRm(lb(100), 5, 1) ?? 0)
    expect(estimateOneRm(lb(100), 5, -2)).toBe(none)
    expect(estimateOneRm(lb(100), 5, Number.NaN)).toBe(none)
  })

  it('rises with the reps and with the reps left', () => {
    let last = 0
    for (let reps = 1; reps <= 12; reps += 1) {
      const estimate = estimateOneRm(lb(100), reps, 0) ?? 0
      expect(estimate).toBeGreaterThan(last)
      last = estimate
    }
    expect(estimateOneRm(lb(100), 5, 3) ?? 0).toBeGreaterThan(estimateOneRm(lb(100), 5, 2) ?? 0)
  })

  it('gives the labelled estimate at 10 reps and above, since the registry holds no cutoff', () => {
    // rule F8 advises the linear form to 10 reps; the cutoff would be a Param (`f8.e1rmMaxReps`,
    // E14-4 report) and none exists, so the label alone covers a longer set
    for (const reps of [10, 11, 12, 15]) {
      expect(estimateOneRm(lb(100), reps, 0), String(reps)).toBe(
        Math.round(lb(100) * (1 + reps / divisor)),
      )
    }
  })

  it('gives none for a set that cannot be estimated', () => {
    expect(estimateOneRm(0, 5, 0)).toBeNull()
    expect(estimateOneRm(-5, 5, 0)).toBeNull()
    expect(estimateOneRm(Number.NaN, 5, 0)).toBeNull()
    expect(estimateOneRm(lb(100), 0, 0)).toBeNull()
    expect(estimateOneRm(lb(100), 2.5, 0)).toBeNull()
  })

  it('takes a known maximum as it is and estimates a recent set', () => {
    const base = { exerciseId: 'back-squat', loadG: lb(200), reps: 1, rir: null, asOf: ago(30) }
    expect(anchorEstimate({ ...base, kind: 'max' })).toBe(lb(200))
    expect(anchorEstimate({ ...base, kind: 'set', loadG: lb(100), reps: 6, rir: 2 })).toBe(
      estimateOneRm(lb(100), 6, 2),
    )
    expect(anchorEstimate({ ...base, kind: 'max', loadG: 0 })).toBeNull()
  })

  it('shows a load as a whole percent of the estimate', () => {
    expect(percentOfMax(lb(115), lb(139))).toBe(83)
    expect(percentOfMax(0, lb(139))).toBeNull()
    expect(percentOfMax(lb(115), 0)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// The structure of a lift (rule F7, design 8.1, 10.3)
// ---------------------------------------------------------------------------------------------

describe('structuresFor', () => {
  const heavyReps = P.flib.heavyReps.range ?? [0, 0]
  const heavySets = P.flib.heavySets.range ?? [0, 0]
  const [rampLo, rampHi] = P.f7.rampInReps.value
  const [bodyLo, bodyHi] = P.f7.bodyweightReps.value
  const [firstSets, laterSets] = P.f7.rampInSets.value
  const [rirLo, rirHi] = P.f7.heavyRir.value
  const easy = P.f7.easyRir.value
  const shape = (min: number, max: number, sets: number, lo: number, hi: number) => ({
    range: { min, max },
    sets,
    rir: { min: lo, max: hi },
  })

  it('gives the lead lift of a heavy session the top of the sets and the others the bottom', () => {
    const lead = structuresFor('heavy', 'lead', 6).template.loaded
    const other = structuresFor('heavy', 'other', 6).template.loaded
    expect(lead).toEqual(shape(heavyReps[0], heavyReps[1], heavySets[1], rirLo, rirHi))
    expect(other).toEqual(shape(heavyReps[0], heavyReps[1], heavySets[0], rirLo, rirHi))
  })

  it('gives the ramp-in fewer sets in its first week and reps left of three or more', () => {
    const week = (n: number) => structuresFor('ramp-in', 'lead', n).template.loaded
    expect(week(1)).toEqual(shape(rampLo, rampHi, firstSets, easy, easy))
    expect(week(2)).toEqual(shape(rampLo, rampHi, laterSets, easy, easy))
    expect(week(3)).toEqual(week(2))
  })

  it('keeps the ramp-in structure in the return template, with the fewest sets', () => {
    expect(structuresFor('return', 'lead', null).template.loaded).toEqual(
      shape(rampLo, rampHi, firstSets, easy, easy),
    )
  })

  it('gives a lighter week and maintenance the maintenance sets at the heavy range', () => {
    for (const template of ['lighter-week', 'maintenance'] as const) {
      expect(structuresFor(template, 'lead', null).template.loaded, template).toEqual(
        shape(heavyReps[0], heavyReps[1], P.f7.maintenanceSets.value, rirLo, rirHi),
      )
    }
  })

  it('gives the taper the maintenance sets and three or more reps left', () => {
    expect(structuresFor('taper', 'lead', null).template.loaded).toEqual(
      shape(heavyReps[0], heavyReps[1], P.f7.maintenanceSets.value, easy, easy),
    )
  })

  it('takes the bodyweight range for a movement with no added load, with the same reps left', () => {
    expect(structuresFor('heavy', 'other', 8).template.unloaded).toEqual(
      shape(bodyLo, bodyHi, heavySets[0], rirLo, rirHi),
    )
    expect(structuresFor('taper', 'lead', null).template.unloaded.rir).toEqual({
      min: easy,
      max: easy,
    })
  })

  it('makes the first session of any exercise a ramp-in session whatever the template', () => {
    for (const template of ['heavy', 'lighter-week', 'maintenance', 'taper', 'return'] as const) {
      const { first } = structuresFor(template, 'lead', 8)
      expect(first.loaded, template).toEqual(shape(rampLo, rampHi, firstSets, easy, easy))
      expect(first.unloaded, template).toEqual(shape(bodyLo, bodyHi, firstSets, easy, easy))
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The load of a lift (rules F8.1 to F8.7)
// ---------------------------------------------------------------------------------------------

const TODAY = context().today
const ago = (days: number): string => addDays(TODAY, -days)

/** What a lift log may be given beyond its sets (see `liftLog`). */
type LogOver = Parameters<typeof liftLog>[4]

/** A back squat session `daysAgo` days back. */
const squat = (id: string, daysAgo: number, rows: Row[], over: LogOver = {}) =>
  liftLog(id, ago(daysAgo), 'back-squat', rows, over)

/** A runner with a barbell (45 lb bar, 5 lb jump), 70 kg, and these logs. */
const barbellRunner = (logs: StrengthLogEntry[] = [], over: Partial<StrengthContext> = {}) =>
  withSetup({ equipment: have('barbell') }, { logs, ...over })

/** The load suggested for the back squat of a heavy session A today. */
function ask(ctx: StrengthContext, over: Partial<LoadRequest> = {}): LoadSuggestion {
  return suggestLoad(ctx, {
    exerciseId: 'back-squat',
    implement: 'barbell',
    date: TODAY,
    ...structuresFor('heavy', 'lead', 6),
    ...over,
  })
}

/** Dumbbells of exactly these weights, in pounds. */
const dumbbellsOf = (...pounds: number[]): EquipmentConfig => ({
  kind: 'dumbbells',
  loads: { loadsG: pounds.map(lb) },
})

/** A goblet squat of a heavy session (not the lead lift) with these dumbbells and logs. */
function gobletAsk(
  pounds: number[],
  logs: StrengthLogEntry[],
  over: Partial<LoadRequest> = {},
): LoadSuggestion {
  const ctx = withSetup({ equipment: [dumbbellsOf(...pounds)] }, { logs })
  return suggestLoad(ctx, {
    exerciseId: 'goblet-squat',
    implement: 'dumbbells',
    date: TODAY,
    ...structuresFor('heavy', 'other', 6),
    ...over,
  })
}
const goblet = (id: string, daysAgo: number, rows: Row[], over: LogOver = {}) =>
  liftLog(id, ago(daysAgo), 'goblet-squat', rows, over)

const rows = (pounds: number, counts: number[], rirs: Array<number | null>): Row[] =>
  counts.map((count, i) => [pounds, count, rirs[i] ?? null] as const)

describe('F8.1: the first load of an exercise', () => {
  it('starts a lifter with nothing logged at the table fraction of body weight, rounded down to a step', () => {
    const s = ask(barbellRunner())
    // 70 kg x 0.35 = 24.5 kg = 54 lb: the 50 lb rung of a bar that starts at 45 lb
    expect(P.f8.startFractionBodyweight.value['back-squat']).toBe(0.35)
    expect(s).toMatchObject({ rule: 'F8.1', change: 'start', loadG: lb(50), structure: 'first' })
    expect(s.facts).toEqual([
      { template: 'strength.reason.start-bodyweight', slots: { exercise: 'Back squat' } },
    ])
  })

  it('asks for the ramp-in structure, with the low end of the range in every set', () => {
    const s = ask(barbellRunner())
    const [firstSets] = P.f7.rampInSets.value
    const [rampLo, rampHi] = P.f7.rampInReps.value
    expect(s.sets).toBe(firstSets)
    expect(s.range).toEqual({ min: rampLo, max: rampHi })
    expect(s.targets).toEqual(Array.from({ length: firstSets }, () => rampLo))
    expect(s.rir).toEqual({ min: P.f7.easyRir.value, max: P.f7.easyRir.value })
  })

  it('uses the lightest load the equipment makes where the product is lighter, or no weight is on the Profile', () => {
    const light = ask(barbellRunner([], { athlete: { ...context().athlete, weightKg: 40 } }))
    // 40 kg x 0.35 = 14 kg, under the 45 lb bar
    expect(light).toMatchObject({ loadG: lb(45), change: 'start' })
    expect(light.facts[0]?.template).toBe('strength.reason.start-lightest')
    const unknown = ask(barbellRunner([], { athlete: { ...context().athlete, weightKg: null } }))
    expect(unknown.loadG).toBe(lb(45))
    expect(unknown.facts[0]?.template).toBe('strength.reason.start-lightest')
  })

  it('starts at 70% of the estimated maximum of an anchor the runner entered, rounded down', () => {
    const anchor = {
      exerciseId: 'back-squat',
      kind: 'set',
      loadG: lb(100),
      reps: 6,
      rir: 2,
      asOf: ago(20),
    } as const
    const s = ask(barbellRunner([], { anchors: [anchor] }))
    // 100 lb for 6 with 2 left is an estimated maximum of 126.7 lb; 70% is 88.7 lb: the 85 lb rung
    expect(s.loadG).toBe(lb(85))
    expect(s.facts).toEqual([
      {
        template: 'strength.reason.start-anchor',
        slots: { exercise: 'Back squat', pct: { kind: 'percent', pct: P.f8.startPctOf1rm.value } },
      },
    ])
    const known = ask(
      barbellRunner([], { anchors: [{ ...anchor, kind: 'max', loadG: lb(200), reps: 1 }] }),
    )
    expect(known.loadG).toBe(lb(140))
  })

  it('uses the lightest load where 70% of the estimate is under it', () => {
    const anchor = {
      exerciseId: 'back-squat',
      kind: 'max',
      loadG: lb(50),
      reps: 1,
      rir: null,
      asOf: ago(9),
    } as const
    const s = ask(barbellRunner([], { anchors: [anchor] }))
    expect(s.loadG).toBe(lb(45))
    expect(s.facts[0]?.template).toBe('strength.reason.start-lightest')
  })

  it('prefers the anchor to the table, and starts with the anchor only until the first log', () => {
    const anchor = {
      exerciseId: 'back-squat',
      kind: 'max',
      loadG: lb(300),
      reps: 1,
      rir: null,
      asOf: ago(40),
    } as const
    const logged = squat('a', 9, rows(100, [6, 6], [2, 2]))
    const s = ask(barbellRunner([logged], { anchors: [anchor] }))
    expect(s.rule).not.toBe('F8.1')
  })

  it('starts a movement with no added load without one, with the bodyweight range', () => {
    const s = suggestLoad(context(), {
      exerciseId: 'tempo-squat',
      implement: null,
      date: TODAY,
      ...structuresFor('heavy', 'lead', 6),
    })
    expect(s).toMatchObject({ rule: 'F8.1', change: 'start', loadG: null, steps: null })
    expect(s.range).toEqual({
      min: P.f7.bodyweightReps.value[0],
      max: P.f7.bodyweightReps.value[1],
    })
    expect(s.facts).toEqual([
      { template: 'strength.reason.start-unloaded', slots: { exercise: 'Tempo squat' } },
    ])
  })

  it('starts a movement the table gives no weight with none, and keeps the steps for a runner who adds one', () => {
    const ctx = withSetup({ equipment: have('dumbbells', 'step') })
    const s = suggestLoad(ctx, {
      exerciseId: 'single-leg-calf-raise',
      implement: 'dumbbells',
      date: TODAY,
      ...structuresFor('heavy', 'other', 6),
    })
    expect(P.f8.startFractionBodyweight.value['single-leg-calf-raise']).toBe(0)
    expect(s).toMatchObject({ rule: 'F8.1', loadG: null })
    expect(s.steps).not.toBeNull()
    expect(s.range.min).toBe(P.f7.bodyweightReps.value[0])
  })

  describe('for every loaded exercise of the body-weight table', () => {
    const everything = withSetup({ equipment: have(...ALL_KINDS) })
    const loaded = Object.keys(P.f8.startFractionBodyweight.value)

    it('has an entry for the 16 exercises that carry a weight', () => {
      expect(loaded).toHaveLength(16)
      for (const id of loaded) expect(exerciseById(id), id).toBeDefined()
    })

    it.each(loaded)(
      '%s starts at its fraction of body weight, on a rung the equipment makes',
      (id) => {
        const way = waysFor(everything, id as ExerciseId)[0]
        expect(way, id).toBeDefined()
        const s = suggestLoad(everything, {
          exerciseId: id as ExerciseId,
          implement: way?.implement ?? null,
          date: TODAY,
          ...structuresFor('heavy', 'other', 6),
        })
        const fraction = P.f8.startFractionBodyweight.value[id] ?? 0
        expect(s.rule).toBe('F8.1')
        if (fraction === 0) {
          expect(s.loadG, id).toBeNull()
          return
        }
        const steps = way?.steps ?? null
        expect(steps, id).not.toBeNull()
        const target = Math.round(70 * 1000 * fraction)
        const lightest = lightestLoad(steps as LoadSteps, 'lb') ?? 0
        expect(s.loadG, id).not.toBeNull()
        // never above the product, never below the lightest, and on a rung
        expect(s.loadG ?? 0, id).toBeGreaterThanOrEqual(lightest)
        // the display grid may round the product up by less than half a step
        expect(s.loadG ?? 0, id).toBeLessThanOrEqual(Math.max(target, lightest) + 250)
        expect(roundDownToStep(steps as LoadSteps, s.loadG ?? 0, 'lb'), id).toBe(s.loadG)
      },
    )

    it.each(loaded)('%s starts at the lightest load for a body weight under it', (id) => {
      const ctx = withSetup(
        { equipment: have(...ALL_KINDS) },
        { athlete: { ...context().athlete, weightKg: 5 } },
      )
      const way = waysFor(ctx, id as ExerciseId)[0]
      const s = suggestLoad(ctx, {
        exerciseId: id as ExerciseId,
        implement: way?.implement ?? null,
        date: TODAY,
        ...structuresFor('heavy', 'other', 6),
      })
      if ((P.f8.startFractionBodyweight.value[id] ?? 0) === 0) {
        expect(s.loadG, id).toBeNull()
      } else {
        expect(s.loadG, id).toBe(lightestLoad(way?.steps as LoadSteps, 'lb'))
      }
    })
  })

  it('does not convert the history of a related exercise', () => {
    const ctx = withSetup(
      { equipment: have('dumbbells') },
      { logs: [goblet('g', 7, rows(35, [6, 6, 6], [2, 2, 2]))] },
    )
    const s = suggestLoad(ctx, {
      exerciseId: 'split-squat',
      implement: 'dumbbells',
      date: TODAY,
      ...structuresFor('heavy', 'other', 6),
    })
    expect(s.rule).toBe('F8.1')
  })

  it('reads the history of the implement it is for, so a change of equipment starts the lift again', () => {
    const logs = [
      liftLog('c', ago(7), 'standing-calf-raise', rows(80, [6, 6, 6], [2, 2, 2]), {
        implement: 'calf-machine',
      }),
    ]
    const ctx = withSetup({ equipment: have('calf-machine', 'dumbbells') }, { logs })
    const ask2 = (implement: EquipmentKind) =>
      suggestLoad(ctx, {
        exerciseId: 'standing-calf-raise',
        implement,
        date: TODAY,
        ...structuresFor('heavy', 'other', 6),
      })
    expect(ask2('calf-machine').rule).not.toBe('F8.1')
    expect(ask2('dumbbells').rule).toBe('F8.1')
  })
})

describe('F8.2: the return after a gap', () => {
  const sessions = (daysAgo: number) => [squat('a', daysAgo, rows(110, [6, 6, 6, 6], [2, 2, 2, 2]))]

  it('comes back at 90% of the last working load, rounded down to a step, at the low end of the range', () => {
    const s = ask(barbellRunner(sessions(P.f8.layoffDays.value)))
    // 90% of 110 lb is 99 lb: the 95 lb rung
    expect(P.f8.layoffLoadFraction.value).toBe(0.9)
    expect(s).toMatchObject({ rule: 'F8.2', change: 'return', loadG: lb(95), structure: 'return' })
    expect(s.targets).toEqual([3, 3, 3, 3])
    expect(s.rir).toEqual({ min: P.f7.easyRir.value, max: P.f7.easyRir.value })
    expect(s.facts).toEqual([
      {
        template: 'strength.reason.return',
        slots: {
          exercise: 'Back squat',
          days: { kind: 'count', n: P.f8.layoffDays.value },
          share: { kind: 'share', fraction: P.f8.layoffLoadFraction.value },
        },
      },
    ])
  })

  it('applies at 28 days and not at 27', () => {
    expect(P.f8.layoffDays.value).toBe(28)
    expect(ask(barbellRunner(sessions(27))).rule).not.toBe('F8.2')
    expect(ask(barbellRunner(sessions(28))).rule).toBe('F8.2')
    expect(ask(barbellRunner(sessions(90))).facts[0]?.slots['days']).toEqual({
      kind: 'count',
      n: 90,
    })
  })

  it('counts the gap from the latest session of any mode, and the load from the latest normal one', () => {
    const lighter = squat('b', 10, rows(100, [6, 6], [3, 3]), { mode: 'lighter-day' })
    const s = ask(barbellRunner([...sessions(40), lighter]))
    expect(s.rule).not.toBe('F8.2')
    // the base is still the normal session's 110 lb, and every set at the top earns a step
    expect(s.loadG).toBe(lb(115))
  })

  it('applies to a lift of a template that keeps the load as well', () => {
    const s = ask(barbellRunner(sessions(40)), {
      keepLoad: true,
      ...structuresFor('maintenance', 'lead', null),
    })
    expect(s).toMatchObject({ rule: 'F8.2', loadG: lb(95) })
  })

  it('has no load to bring back for a movement with no added load, and says nothing of one', () => {
    const logs = [
      liftLog('t', ago(40), 'tempo-squat', [
        [null, 12, 2],
        [null, 12, 2],
      ]),
    ]
    const s = suggestLoad(context({ logs }), {
      exerciseId: 'tempo-squat',
      implement: null,
      date: TODAY,
      ...structuresFor('heavy', 'lead', 6),
    })
    expect(s).toMatchObject({ rule: 'F8.2', change: 'return', loadG: null, facts: [] })
  })

  it('rounds down on the rungs of the other unit', () => {
    const bar: EquipmentConfig = {
      kind: 'barbell',
      barG: toGrams(20, 'kg'),
      jumpG: toGrams(2.5, 'kg'),
    }
    const logs = [
      log('k', ago(35), {
        sets: [
          { exerciseId: 'back-squat', position: 0, loadG: toGrams(100, 'kg'), count: 5, rir: 2 },
        ],
      }),
    ]
    const ctx = withSetup({ equipment: [bar] }, { weightUnit: 'kg', logs })
    // 90% of 100 kg is 90 kg, and the rungs are 20 kg and 2.5 kg steps: 90 kg is one of them
    expect(ask(ctx).loadG).toBe(toGrams(90, 'kg'))
  })
})

describe('F8.3: a set short of the range', () => {
  it('lowers 110 lb by 5% rounded down to a step: sets of 6, 6, 2 give 105 lb', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 2], [2, 2, 0]))]))
    expect(s).toMatchObject({
      rule: 'F8.3',
      change: 'reduce',
      loadG: lb(105),
      structure: 'template',
    })
    expect(s.targets).toEqual([3, 3, 3, 3])
    expect(s.facts).toEqual([
      {
        template: 'strength.reason.reduce',
        slots: {
          set: { kind: 'count', n: 3 },
          exercise: 'Back squat',
          count: { kind: 'count', n: 2 },
          lo: { kind: 'count', n: 3 },
          hi: { kind: 'count', n: 6 },
        },
      },
    ])
  })

  it('applies to a set one rep short and not to one at the low end of the range', () => {
    expect(ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 2], [null, null, null]))])).rule).toBe(
      'F8.3',
    )
    expect(ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 3], [null, null, null]))])).rule).toBe(
      'F8.6',
    )
  })

  it('names the lowest set, the first of equals, and a set that ended at one rep has its own sentence', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(110, [6, 1, 2, 1], [null, null, null, null]))]))
    expect(s.facts[0]?.template).toBe('strength.reason.reduce-one')
    expect(s.facts[0]?.slots['set']).toEqual({ kind: 'count', n: 2 })
    const none = ask(barbellRunner([squat('a', 5, rows(110, [6, 0], [null, null]))]))
    expect(none.facts[0]?.template).toBe('strength.reason.reduce')
    expect(none.facts[0]?.slots['count']).toEqual({ kind: 'count', n: 0 })
  })

  it('lowers by at least one step, and by the 5% where that is more steps', () => {
    // 45 lb bar, 5 lb jump: 5% of 300 lb is 15 lb, three steps; 5% of 50 lb is under one step
    expect(ask(barbellRunner([squat('a', 5, rows(300, [2], [null]))])).loadG).toBe(lb(285))
    expect(ask(barbellRunner([squat('a', 5, rows(50, [2], [null]))])).loadG).toBe(lb(45))
  })

  it('lowers by one step on an uneven list of dumbbells', () => {
    // 5% of 40 lb is 2 lb: the rung at or above 38 lb is 40 lb itself, so one step down is 35 lb
    const s = gobletAsk([30, 35, 40, 45], [goblet('g', 5, rows(40, [2, 2], [null, null]))])
    expect(s).toMatchObject({ rule: 'F8.3', change: 'reduce', loadG: lb(35) })
  })

  it('holds at the lightest load, which cannot come down, and says nothing of a step', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(45, [2, 2], [null, null]))]))
    expect(s).toMatchObject({ rule: 'F8.3', change: 'hold', loadG: lb(45), facts: [] })
  })

  it('judges a movement with no added load against the bodyweight range, and holds', () => {
    const logs = [
      liftLog('t', ago(5), 'tempo-squat', [
        [null, 5, 2],
        [null, 6, 2],
      ]),
    ]
    const s = suggestLoad(context({ logs }), {
      exerciseId: 'tempo-squat',
      implement: null,
      date: TODAY,
      ...structuresFor('heavy', 'lead', 6),
    })
    expect(s).toMatchObject({ rule: 'F8.3', change: 'hold', loadG: null })
    expect(s.targets.every((t) => t === P.f7.bodyweightReps.value[0])).toBe(true)
  })
})

describe('F8.4 and F8.5: a step up', () => {
  it('adds one step when every set is at the top with a rep left: 110 lb becomes 115 lb', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 6, 6], [2, 2, 1, 1]))]))
    expect(s).toMatchObject({ rule: 'F8.5', change: 'increase', loadG: lb(115) })
    expect(s.targets).toEqual([3, 3, 3, 3])
    expect(s.facts).toEqual([
      {
        template: 'strength.reason.increase',
        slots: { exercise: 'Back squat', top: { kind: 'count', n: 6 } },
      },
    ])
  })

  it('adds two steps when every set had four or more left: 110 lb becomes 120 lb', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 6, 6], [4, 4, 4, 4]))]))
    expect(s).toMatchObject({ rule: 'F8.4', change: 'increase', loadG: lb(120) })
    expect(s.facts[0]).toEqual({
      template: 'strength.reason.increase-two',
      slots: {
        exercise: 'Back squat',
        top: { kind: 'count', n: 6 },
        rir: { kind: 'count', n: P.f8.bigStepRir.value },
      },
    })
  })

  it('takes the reps left exactly at their thresholds', () => {
    const at = (rirs: number[]) =>
      ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 6, 6], rirs))]))
    expect(P.f8.progressMinRir.value).toBe(1)
    expect(P.f8.bigStepRir.value).toBe(4)
    expect(at([1, 1, 1, 1])).toMatchObject({ rule: 'F8.5', loadG: lb(115) })
    expect(at([0, 1, 1, 1])).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(110) })
    expect(at([4, 4, 4, 4])).toMatchObject({ rule: 'F8.4', loadG: lb(120) })
    expect(at([4, 4, 4, 3])).toMatchObject({ rule: 'F8.5', loadG: lb(115) })
    expect(at([5, 5, 5, 5])).toMatchObject({ rule: 'F8.4', loadG: lb(120) })
  })

  it('needs every set at the top: one rep short of it holds', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 6, 5], [2, 2, 2, 2]))]))
    expect(s).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(110) })
    expect(ask(barbellRunner([squat('a', 5, rows(110, [7, 8, 6, 6], [2, 2, 2, 2]))])).rule).toBe(
      'F8.5',
    )
  })

  it('needs every count of reps left recorded: one missing count holds', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 6, 6], [2, 2, 2, null]))]))
    expect(s).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(110) })
    expect(s.facts).toEqual([{ template: 'strength.reason.hold-unrecorded', slots: {} }])
    expect(
      ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 6, 6], [null, null, null, null]))]))
        .facts[0]?.template,
    ).toBe('strength.reason.hold-unrecorded')
  })

  it('says a set with no reps left held the load when every set was at the top', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 6, 6], [2, 2, 0, 2]))]))
    expect(s.facts).toEqual([
      {
        template: 'strength.reason.hold-effort',
        slots: {
          exercise: 'Back squat',
          top: { kind: 'count', n: 6 },
          reps: 'one rep',
        },
      },
    ])
  })

  it('offers a step within the cap and not past it: 15% is usable and 16% is not', () => {
    expect(P.f8.maxStepPct.value).toBe(15)
    const logs = (from: number) => [goblet('g', 5, rows(from, [6, 6, 6], [3, 3, 3]))]
    const exact = gobletAsk([100, 115, 130], logs(100))
    expect(exact).toMatchObject({ rule: 'F8.5', change: 'increase', loadG: lb(115) })
    const over = gobletAsk([100, 116, 130], logs(100))
    expect(over).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(100) })
    expect(over.facts).toEqual([
      {
        template: 'strength.reason.hold-step',
        slots: { load: { kind: 'load', g: lb(100) }, pct: { kind: 'percent', pct: 15 } },
      },
    ])
  })

  it('offers one step when the second step is past the cap', () => {
    // 100 to 110 is 10%; 110 to 130 is 20% of the base
    const s = gobletAsk([100, 110, 130], [goblet('g', 5, rows(100, [6, 6, 6], [4, 4, 4]))])
    expect(s).toMatchObject({ rule: 'F8.5', loadG: lb(110) })
  })

  it('offers no step above the top of the equipment', () => {
    const s = gobletAsk([30, 35, 40], [goblet('g', 5, rows(40, [6, 6, 6], [2, 2, 2]))])
    expect(s).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(40), facts: [] })
  })

  it('holds where the next step would pass 90% of the estimated maximum, and says so', () => {
    expect(P.flib.heavyMinPct1rm.range?.[1]).toBe(90)
    // 100 lb for 6 with 1 left is an estimate of 123 lb and a ceiling of 111 lb: 113 lb is past it
    const near = gobletAsk([100, 113], [goblet('g', 5, rows(100, [6, 6, 6], [1, 1, 1]))])
    expect(near).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(100) })
    expect(near.facts).toEqual([
      { template: 'strength.reason.hold-ceiling', slots: { pct: { kind: 'percent', pct: 90 } } },
    ])
    // with 3 left the estimate is 130 lb and the ceiling 117 lb, so the same step is allowed
    const room = gobletAsk([100, 113], [goblet('g', 5, rows(100, [6, 6, 6], [3, 3, 3]))])
    expect(room).toMatchObject({ rule: 'F8.5', loadG: lb(113) })
  })

  it('keeps the load in a template that keeps it, and gives the same load with no reason of its own', () => {
    const logs = [squat('a', 5, rows(110, [6, 6, 6, 6], [4, 4, 4, 4]))]
    const s = ask(barbellRunner(logs), {
      keepLoad: true,
      ...structuresFor('maintenance', 'lead', null),
    })
    expect(s).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(110), facts: [] })
  })
})

describe('F8.6: the load holds', () => {
  it('holds sets of 6, 5, 4, 3 at 110 lb and aims each set one rep higher', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(110, [6, 5, 4, 3], [2, 2, 2, 2]))]))
    expect(s).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(110), structure: 'template' })
    expect(s.targets).toEqual([6, 6, 5, 4])
    expect(s.facts).toEqual([
      {
        template: 'strength.reason.hold-range',
        slots: { exercise: 'Back squat', top: { kind: 'count', n: 6 } },
      },
    ])
  })

  it('aims at the top and no higher', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(110, [6, 6, 6, 6], [null, null, null, null]))]))
    expect(s.targets).toEqual([6, 6, 6, 6])
  })

  it('aims the sets the last session did not have at the count of its last set', () => {
    const s = ask(barbellRunner([squat('a', 5, rows(110, [4, 4], [null, null]))]))
    expect(s.targets).toEqual([5, 5, 5, 5])
  })

  it('reads the working load as the load used in most sets, the lower on a tie', () => {
    const at = (loads: number[]) => {
      const sets = loads.map((pounds) => [pounds, 5, null] as const)
      return ask(barbellRunner([squat('a', 5, sets)])).loadG
    }
    expect(at([110, 110, 115, 110])).toBe(lb(110))
    expect(at([110, 110, 115, 115])).toBe(lb(110))
    expect(at([110, 115, 115, 115])).toBe(lb(115))
    expect(at([115, 115, 110, 110])).toBe(lb(110))
  })

  it('judges the load that was lifted, not the load that was suggested', () => {
    // the sheet suggested 100 lb and the runner lifted 120 lb for the top of the range
    const logs = [
      squat('a', 5, rows(120, [6, 6, 6, 6], [2, 2, 2, 2]), { implement: 'barbell', baseLb: 100 }),
    ]
    expect(ask(barbellRunner(logs)).loadG).toBe(lb(125))
  })

  it('puts a load that is not on the rungs of the equipment on the rung at or below it', () => {
    expect(ask(barbellRunner([squat('a', 5, rows(112, [5, 5], [null, null]))])).loadG).toBe(lb(110))
  })

  it('does not give a load below the lightest the equipment makes', () => {
    expect(ask(barbellRunner([squat('a', 5, rows(30, [5, 5], [null, null]))])).loadG).toBe(lb(45))
  })
})

describe('F8.7: the next movement', () => {
  const top = (id: string, daysAgo: number, pounds = 50, rirs = [1, 1, 1]) =>
    goblet(id, daysAgo, rows(pounds, [6, 6, 6], rirs))
  const row = (daysAgo: number, id = String(daysAgo)) => top(id, daysAgo)

  it('moves to the harder movement after 3 sessions at the top with no usable step', () => {
    expect(P.f8.ceilingSessions.value).toBe(3)
    // 50 lb to 60 lb is 20% of the load: no usable step
    const s = gobletAsk([40, 50, 60], [row(15), row(8), row(2)], { canVary: true })
    expect(s).toMatchObject({
      rule: 'F8.7',
      change: 'variation',
      moveTo: 'split-squat',
      structure: 'first',
    })
    expect(s.facts).toEqual([
      {
        template: 'strength.reason.variation',
        slots: {
          exercise: 'Goblet squat',
          sessions: { kind: 'count', n: 3 },
          next: 'Split squat',
        },
      },
    ])
    expect(s.sets).toBe(P.f7.rampInSets.value[0])
  })

  it('waits for the third session', () => {
    const s = gobletAsk([40, 50, 60], [row(8), row(2)], { canVary: true })
    expect(s).toMatchObject({ rule: 'F8.6', change: 'hold', moveTo: null })
  })

  it('needs the sessions in a row: a session short of the top or without reps left breaks the run', () => {
    const short = goblet('s', 8, rows(50, [6, 5, 6], [1, 1, 1]))
    expect(gobletAsk([40, 50, 60], [row(15), short, row(2)], { canVary: true }).rule).toBe('F8.6')
    const tired = goblet('t', 8, rows(50, [6, 6, 6], [1, 0, 1]))
    expect(gobletAsk([40, 50, 60], [row(15), tired, row(2)], { canVary: true }).rule).toBe('F8.6')
  })

  it('does not count a lighter session, which neither breaks the run nor joins it', () => {
    const lighter = goblet('l', 5, rows(40, [6, 6, 6], [3, 3, 3]), { mode: 'lighter-day' })
    const s = gobletAsk([40, 50, 60], [row(15), row(8), lighter, row(2)], { canVary: true })
    expect(s.rule).toBe('F8.7')
  })

  it('moves on when the step is blocked by the ceiling as well', () => {
    // 100 lb to 113 lb is within the cap but past 90% of the estimate with a rep left
    const logs = [15, 8, 2].map((d) => goblet(`c${String(d)}`, d, rows(100, [6, 6, 6], [1, 1, 1])))
    expect(gobletAsk([100, 113], logs, { canVary: true }).rule).toBe('F8.7')
  })

  it('stays when the harder movement is not offered, the exercise is pinned, or the template keeps the load', () => {
    const logs = [row(15), row(8), row(2)]
    expect(gobletAsk([40, 50, 60], logs, { canVary: false }).rule).toBe('F8.6')
    expect(gobletAsk([40, 50, 60], logs).rule).toBe('F8.6')
    expect(
      gobletAsk([40, 50, 60], logs, {
        canVary: true,
        keepLoad: true,
        ...structuresFor('maintenance', 'other', null),
      }).rule,
    ).toBe('F8.6')
  })

  it('does not move while a usable step remains', () => {
    const logs = [row(15), row(8), row(2)]
    const s = gobletAsk([40, 50, 55], logs, { canVary: true })
    expect(s).toMatchObject({ rule: 'F8.5', change: 'increase', loadG: lb(55) })
  })

  it('moves a bodyweight movement to the next one at the top of the range, 3 sessions in a row', () => {
    const at = (daysAgo: number) =>
      liftLog(`b${String(daysAgo)}`, ago(daysAgo), 'tempo-squat', [
        [null, 15, 1],
        [null, 15, 2],
      ])
    const ask3 = (days: number[]) =>
      suggestLoad(context({ logs: days.map(at) }), {
        exerciseId: 'tempo-squat',
        implement: null,
        date: TODAY,
        canVary: true,
        ...structuresFor('heavy', 'lead', 6),
      })
    expect(ask3([14, 7, 2])).toMatchObject({ rule: 'F8.7', moveTo: 'split-squat' })
    expect(ask3([7, 2])).toMatchObject({ rule: 'F8.6', loadG: null })
    // below the top it climbs by reps: each set aims one rep higher
    const climbing = suggestLoad(
      context({
        logs: [
          liftLog('c', ago(3), 'tempo-squat', [
            [null, 10, 2],
            [null, 11, 2],
          ]),
        ],
      }),
      {
        exerciseId: 'tempo-squat',
        implement: null,
        date: TODAY,
        ...structuresFor('heavy', 'lead', 6),
      },
    )
    expect(climbing.targets.slice(0, 2)).toEqual([11, 12])
  })
})

describe('the history a suggestion reads', () => {
  const sets = rows(110, [6, 6, 6, 6], [2, 2, 2, 2])

  it('judges the latest normal session, whatever a later lighter one did', () => {
    const later = squat('b', 2, rows(100, [5, 5], [3, 3]), { mode: 'lighter-day' })
    const s = ask(barbellRunner([squat('a', 6, sets), later]))
    expect(s).toMatchObject({ rule: 'F8.5', loadG: lb(115) })
    for (const mode of ['lighter-week', 'taper', 'return'] as const) {
      const other = squat('b', 2, rows(95, [3, 3], [5, 5]), { mode })
      expect(ask(barbellRunner([squat('a', 6, sets), other])).loadG, mode).toBe(lb(115))
    }
  })

  it('holds a first session done on a lighter day at the load the snapshot recorded', () => {
    const only = squat('a', 4, rows(100, [6, 6], [3, 3]), {
      mode: 'lighter-day',
      implement: 'barbell',
      baseLb: 110,
    })
    const s = ask(barbellRunner([only]))
    expect(s).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(110), structure: 'first' })
  })

  it('reads the sessions before the day of the session, not the one logged on it', () => {
    const today = squat('a', 0, sets)
    expect(ask(barbellRunner([today])).rule).toBe('F8.1')
    const yesterday = squat('a', 1, sets)
    expect(ask(barbellRunner([yesterday])).rule).toBe('F8.5')
  })

  it('shows a session ahead as it would be now, on every session through today', () => {
    const logged = squat('a', 0, sets)
    const ahead = ask(barbellRunner([logged]), { date: addDays(TODAY, 3) })
    expect(ahead).toMatchObject({ rule: 'F8.5', loadG: lb(115) })
    // the gap counts to today for a session ahead, so a week away does not read as a gap
    const old = squat('a', 20, sets)
    expect(ask(barbellRunner([old]), { date: addDays(TODAY, 20) }).rule).toBe('F8.5')
  })

  it('shows a past session as the rules said then', () => {
    const logs = [squat('a', 20, sets), squat('b', 5, rows(110, [6, 6, 2], [null, null, null]))]
    expect(ask(barbellRunner(logs), { date: ago(10) }).rule).toBe('F8.5')
    expect(ask(barbellRunner(logs)).rule).toBe('F8.3')
  })

  it('does not depend on the order of the logs or of the sets', () => {
    const logs = [
      squat('a', 20, sets),
      squat('b', 13, rows(115, [6, 6, 5, 6], [2, 2, 2, 2])),
      squat('c', 6, rows(115, [6, 6, 6, 6], [1, 2, 2, 2])),
    ]
    const reference = ask(barbellRunner(logs))
    const scrambled = [logs[2], logs[0], logs[1]].map((entry) => ({
      ...entry!,
      sets: [...entry!.sets].reverse(),
    }))
    expect(ask(barbellRunner(scrambled))).toEqual(reference)
    expect(ask(barbellRunner([...logs].reverse()))).toEqual(reference)
  })

  it('gives the same answer twice and leaves a frozen context alone', () => {
    const ctx = barbellRunner([squat('a', 6, sets), squat('b', 13, sets)])
    const frozen = deepFreeze(structuredClone(ctx))
    expect(ask(frozen)).toEqual(ask(ctx))
    expect(ask(frozen)).toEqual(ask(frozen))
  })
})

/** Freezes a value and everything inside it. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

// ---------------------------------------------------------------------------------------------
// Properties of every suggestion (design 5.2, 10.2)
// ---------------------------------------------------------------------------------------------

/** A small seeded generator, so the properties replay the same cases on every run. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('a suggestion asks only for a load the equipment can make and passes no cap', () => {
  const CASES = 600

  it('holds over random equipment, histories, templates and units', () => {
    let steps = 0
    let increases = 0
    let reductions = 0
    for (let seed = 1; seed <= CASES; seed += 1) {
      const next = seeded(seed)
      const between = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
      const unit = next() < 0.5 ? 'lb' : 'kg'
      const unitG = (n: number) => toGrams(n, unit)

      // one of three kinds of equipment, with random rungs
      const kind = between(0, 2)
      const barUnits = (unit === 'lb' ? [35, 45] : [15, 20])[between(0, 1)] ?? 45
      const jumpUnits = (unit === 'lb' ? [1.5, 2.5, 5, 10] : [1.25, 2.5, 5])[between(0, 2)] ?? 5
      const exerciseId: ExerciseId =
        kind === 0 ? 'back-squat' : kind === 1 ? 'goblet-squat' : 'leg-press'
      const implement: EquipmentKind =
        kind === 0 ? 'barbell' : kind === 1 ? 'dumbbells' : 'leg-press'
      // the rungs of the equipment, in the runner's unit: the loads a runner would have used
      const rungs: number[] = []
      if (kind === 1) {
        let rung = between(2, 20)
        const count = between(3, 12)
        for (let i = 0; i < count; i += 1) {
          rungs.push(rung)
          rung += between(1, 12)
        }
      } else {
        const first = kind === 0 ? barUnits : jumpUnits
        for (let i = 0; i < 24; i += 1) rungs.push(first + i * jumpUnits)
      }
      const equipment: EquipmentConfig =
        kind === 0
          ? { kind: 'barbell', barG: unitG(barUnits), jumpG: unitG(jumpUnits) }
          : kind === 1
            ? { kind: 'dumbbells', loads: { loadsG: rungs.map(unitG) } }
            : { kind: 'leg-press', stepG: unitG(jumpUnits), maxG: unitG(400) }

      // a random history: loads on the rungs or off them, counts and reps left, and modes
      const logs: StrengthLogEntry[] = []
      // half the cases aim at a step up: recent normal sessions, all at the top with reps left
      const aimed = next() < 0.5
      const sessions = aimed ? between(1, 3) : between(0, 6)
      for (let i = 0; i < sessions; i += 1) {
        const loadUnits =
          next() < 0.7 ? (rungs[between(0, rungs.length - 1)] ?? 50) : between(5, 300) / 2
        // half the sessions finish at the top of the range with reps left, so steps up are reached
        const strong = aimed || next() < 0.5
        const sets = Array.from({ length: between(1, 5) }, (_, position) => ({
          exerciseId,
          position,
          loadG: unitG(Math.max(1, next() < 0.8 ? loadUnits : loadUnits + between(-10, 10))),
          count: strong ? between(6, 8) : between(0, 9),
          rir: strong ? between(1, 5) : next() < 0.2 ? null : between(0, 5),
        }))
        const modes = [
          'normal',
          'normal',
          'normal',
          'lighter-day',
          'lighter-week',
          'taper',
          'return',
        ] as const
        logs.push(
          log(`l${String(i)}`, ago(aimed ? between(1, 20) : between(1, 80)), {
            sets,
            mode: aimed ? 'normal' : (modes[between(0, modes.length - 1)] ?? 'normal'),
          }),
        )
      }
      const anchors =
        next() < 0.3
          ? [
              {
                exerciseId,
                kind: 'set' as const,
                loadG: unitG(between(20, 200)),
                reps: between(1, 10),
                rir: null,
                asOf: ago(90),
              },
            ]
          : []
      const weightKg = next() < 0.8 ? between(35, 110) : null
      const ctx = withSetup(
        { equipment: [equipment] },
        { weightUnit: unit, logs, anchors, athlete: { ...context().athlete, weightKg } },
      )
      const template = aimed
        ? 'heavy'
        : ((['ramp-in', 'heavy', 'lighter-week', 'maintenance', 'taper', 'return'] as const)[
            between(0, 5)
          ] ?? 'heavy')
      const shapes = structuresFor(template, next() < 0.5 ? 'lead' : 'other', between(1, 6))
      const keepLoad = template !== 'ramp-in' && template !== 'heavy'
      const s = suggestLoad(ctx, {
        exerciseId,
        implement,
        date: TODAY,
        keepLoad,
        canVary: next() < 0.5,
        ...shapes,
      })
      const label = `seed ${String(seed)} ${exerciseId} ${s.rule} ${s.change}`

      // 1. a load the equipment cannot make is never asked for: it sits on a rung
      const ladder = s.steps
      expect(ladder, label).not.toBeNull()
      if (s.loadG !== null && ladder !== null) {
        expect(roundDownToStep(ladder, s.loadG, unit), label).toBe(s.loadG)
        steps += 1
      }
      // 2. the targets fill the sets and stay inside the range
      expect(s.targets, label).toHaveLength(s.sets)
      for (const target of s.targets) {
        expect(target, label).toBeGreaterThanOrEqual(s.range.min)
        expect(target, label).toBeLessThanOrEqual(s.range.max)
      }
      // 3. every fact names a registered template
      for (const fact of s.facts)
        expect(Object.keys(STRENGTH_TEMPLATES), label).toContain(fact.template)

      // 4. an increase is within the step cap and under 90% of the estimated maximum
      if (s.change === 'increase') {
        increases += 1
        const normal = logs
          .filter((entry) => entry.mode === 'normal' && entry.sets.length > 0)
          .sort((a, b) => a.date.localeCompare(b.date))
        const judged = normal.at(-1)
        expect(judged, label).toBeDefined()
        const tally = new Map<number, number>()
        for (const set of judged?.sets ?? [])
          tally.set(set.loadG ?? 0, (tally.get(set.loadG ?? 0) ?? 0) + 1)
        const base = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0
        const first = stepFrom(ladder as LoadSteps, base, 1, unit)
        const shown = (g: number) => fromGrams(g, unit)
        expect(first, label).not.toBeNull()
        expect(shown(first ?? 0) - shown(base), label).toBeLessThanOrEqual(
          (P.f8.maxStepPct.value / 100) * shown(base),
        )
        expect(s.loadG ?? 0, label).toBeGreaterThan(base)
        const second = stepFrom(ladder as LoadSteps, base, 2, unit)
        expect(s.loadG === first || s.loadG === second, label).toBe(true)
        if (s.loadG === second) {
          expect(shown(second ?? 0) - shown(first ?? 0), label).toBeLessThanOrEqual(
            (P.f8.maxStepPct.value / 100) * shown(base),
          )
        }
        const best = Math.max(
          ...(judged?.sets ?? []).map(
            (set) => estimateOneRm(set.loadG ?? 0, set.count, set.rir) ?? 0,
          ),
        )
        const top = P.flib.heavyMinPct1rm.range?.[1] ?? 0
        expect(s.loadG ?? 0, label).toBeLessThanOrEqual((best * top) / 100 + 1)
        // a template that keeps the load never raises it
        expect(keepLoad, label).toBe(false)
      }
      if (s.change === 'reduce') reductions += 1
    }
    // the cases do reach a step up, a reduction and a load
    expect(steps).toBeGreaterThan(CASES / 2)
    expect(increases).toBeGreaterThan(5)
    expect(reductions).toBeGreaterThan(5)
  })
})

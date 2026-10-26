// The strength engine (E14-4): the template of a week, the block position and the ramp-in, the
// lift of each slot, the load of each lift (rules F8.1 to F8.7, F9), the estimated maximum, the
// derived workout and the history behind it. Every figure comes from a synthetic runner: no
// real history, equipment or names.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { SLOT_LADDERS, exerciseById, isFeasible } from '../../../shared/domain/strengthLibrary.ts'
import {
  blockPosition,
  pickLift,
  rampInWeeks,
  sessionVariant,
  strengthTemplate,
  waysFor,
  type BlockPosition,
} from '../../../shared/engine/strength.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  LiftingLevel,
  StrengthContext,
  StrengthLogEntry,
  StrengthWeek,
} from '../../../shared/engine/types.ts'
import type { EquipmentConfig, EquipmentKind, StrengthTemplate } from '../../../shared/types.ts'
import {
  ALL_KINDS,
  context,
  have,
  lb,
  log,
  monday,
  plan,
  week,
  withSetup,
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

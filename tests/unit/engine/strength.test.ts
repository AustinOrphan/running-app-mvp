// The strength engine (E14-4): the template of a week, the block position and the ramp-in, the
// lift of each slot, the load of each lift (rules F8.1 to F8.7, F9), the estimated maximum, the
// derived workout and the history behind it. Every figure comes from a synthetic runner: no
// real history, equipment or names.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import type { Template } from '../../../shared/copy/template.ts'
import { renderFact } from '../../../shared/copy/templates.ts'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import {
  EXERCISES,
  PLYO_LADDER,
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
  barbellAllowed,
  blockPosition,
  estimateOneRm,
  liftFor,
  liftTexts,
  modeOf,
  percentOfMax,
  pickLift,
  rampInWeeks,
  sessionVariant,
  strengthTemplate,
  structuresFor,
  suggestLoad,
  summariseHistory,
  waysFor,
  workoutFor,
  type BlockPosition,
  type LoadRequest,
  type LoadSuggestion,
} from '../../../shared/engine/strength.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  LiftingLevel,
  StrengthContext,
  StrengthLogEntry,
  StrengthReadiness,
  StrengthSessionRef,
  StrengthWeek,
} from '../../../shared/engine/types.ts'
import type {
  EquipmentConfig,
  EquipmentKind,
  LoadSteps,
  StrengthTemplate,
  StrengthWorkout,
  WorkoutLift,
} from '../../../shared/types.ts'
import {
  ALL_KINDS,
  ITEM,
  context,
  have,
  lb,
  liftLog,
  log,
  monday,
  plan,
  sessionRef,
  sessionsOf,
  setsOf,
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
      expect(rampInWeeks(regenerated(logged([1, 2, 3, 4], 'return')), block)).toBe(3)
      expect(rampInWeeks(regenerated(logged([1, 2, 3, 4], 'taper')), block)).toBe(3)
    })

    it('counts the lighter week of a 3 to 1 cycle as a block week, so the cycle still earns the credit', () => {
      // three heavy weeks and a recovery week before the block: the week with a lighter-week session
      // carries the block flag as the others do
      const cycle = [...logged([4, 3, 2], 'heavy'), ...logged([1], 'lighter-week')]
      const ctx = regenerated(cycle)
      expect(rampInWeeks(ctx, block)).toBe(0)
      expect(blockPosition(ctx, block)).toEqual({ week: 1, of: 12, rampInWeeks: 0 })
      // and a lighter week in each of the weeks counts too, as the ramp-in and heavy ones do
      expect(rampInWeeks(regenerated(logged([1, 2, 3, 4], 'lighter-week')), block)).toBe(0)
      // a week with only a maintenance session is not a block week
      expect(
        rampInWeeks(
          regenerated([...logged([4, 3, 2], 'heavy'), ...logged([1], 'maintenance')]),
          block,
        ),
      ).toBe(3)
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
    // inside the ramp-in a recovery week stays a ramp-in, with fewer sets (see the describe below)
    expect(strengthTemplate(flagged(['strength-block', 'recovery']), inBlock(2))).toBe('ramp-in')
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

  it('rises with the reps and with the reps left, up to the limit', () => {
    let last = 0
    for (let reps = 1; reps <= P.f8.e1rmMaxReps.value; reps += 1) {
      const estimate = estimateOneRm(lb(100), reps, 0) ?? 0
      expect(estimate).toBeGreaterThan(last)
      last = estimate
    }
    expect(estimateOneRm(lb(100), 5, 3) ?? 0).toBeGreaterThan(estimateOneRm(lb(100), 5, 2) ?? 0)
  })

  it('gives an estimate at 10 repetitions to the limit and none at 11 (rule F8, amended 2026-10-25)', () => {
    expect(P.f8.e1rmMaxReps.value).toBe(10)
    expect(estimateOneRm(lb(100), 10, 0)).toBe(Math.round(lb(100) * (1 + 10 / divisor)))
    expect(estimateOneRm(lb(100), 11, 0)).toBeNull()
    for (const reps of [12, 15, 20]) {
      expect(estimateOneRm(lb(100), reps, 0), String(reps)).toBeNull()
    }
  })

  it('counts the reps left toward the limit: 7 and 3 left is 10, 8 and 3 left is 11', () => {
    expect(estimateOneRm(lb(100), 7, 3)).toBe(Math.round(lb(100) * (1 + 10 / divisor)))
    expect(estimateOneRm(lb(100), 8, 3)).toBeNull()
    expect(estimateOneRm(lb(100), 6, 4)).not.toBeNull()
    expect(estimateOneRm(lb(100), 6, 5)).toBeNull()
    // a missing count is none left: 10 repetitions is within the limit and 11 is not
    expect(estimateOneRm(lb(100), 10, null)).not.toBeNull()
    expect(estimateOneRm(lb(100), 11, null)).toBeNull()
  })

  it('gives a block set an estimate and the top of the ramp-in range with the easy reps left none', () => {
    const [, blockTop] = P.flib.heavyReps.range ?? [0, 0]
    expect(estimateOneRm(lb(100), blockTop, P.f7.heavyRir.value[1])).not.toBeNull()
    expect(estimateOneRm(lb(100), P.f7.rampInReps.value[1], P.f7.easyRir.value)).toBeNull()
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
    // a set over the limit gives none, a known maximum stands whatever the reps
    expect(anchorEstimate({ ...base, kind: 'set', loadG: lb(100), reps: 12, rir: null })).toBeNull()
    expect(anchorEstimate({ ...base, kind: 'max', reps: 12 })).toBe(lb(200))
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

  it('starts from the table when the anchor is a set over the limit of the estimate', () => {
    // 12 repetitions give no estimate (f8.e1rmMaxReps), so the 70% of it is not made
    const anchor = {
      exerciseId: 'back-squat',
      kind: 'set',
      loadG: lb(120),
      reps: 12,
      rir: null,
      asOf: ago(9),
    } as const
    const s = ask(barbellRunner([], { anchors: [anchor] }))
    expect(s.loadG).toBe(lb(50))
    expect(s.facts[0]?.template).toBe('strength.reason.start-bodyweight')
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
    const over = gobletAsk([95, 100, 116], logs(100))
    expect(over).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(100) })
    expect(over.facts).toEqual([
      {
        template: 'strength.reason.hold-step',
        slots: { load: { kind: 'load', g: lb(100) }, pct: { kind: 'percent', pct: 15 } },
      },
    ])
  })

  it('always offers the smallest step the equipment makes, however light the load (rule F8.5)', () => {
    expect(P.f8.maxStepPct.value).toBe(15)
    const press = (pounds: number, counts: number[], rirs: number[]) =>
      suggestLoad(
        withSetup(
          { equipment: have('leg-press') },
          { logs: [liftLog('p', ago(5), 'leg-press', rows(pounds, counts, rirs))] },
        ),
        {
          exerciseId: 'leg-press',
          implement: 'leg-press',
          date: TODAY,
          ...structuresFor('heavy', 'lead', 6),
        },
      )
    // a 10 lb stack on a 50 lb load is 20%, over the cap, and the one step the stack makes; 8 reps
    // with 3 left is 11 repetitions to the limit, so the set gives no estimate and no ceiling
    expect(press(50, [8, 8, 8], [3, 3, 3])).toMatchObject({
      rule: 'F8.5',
      change: 'increase',
      loadG: lb(60),
    })
    expect(press(60, [8, 8, 8], [3, 3, 3])).toMatchObject({ rule: 'F8.5', loadG: lb(70) })
    // with 5 left on every set that is two smallest steps, each usable
    expect(press(50, [6, 6, 6], [5, 5, 5])).toMatchObject({ rule: 'F8.4', loadG: lb(70) })
    // 10 lb at a time from 50 lb, until 15% of the load is a step (from 67 lb the cap allows it)
    for (let pounds = 50; pounds < 150; pounds += 10) {
      expect(press(pounds, [8, 8, 8], [3, 3, 3]).loadG, String(pounds)).toBe(lb(pounds + 10))
    }
    // a barbell with a 10 lb jump from the 45 lb bar is a step of 22%
    const bar = withSetup(
      { equipment: [{ kind: 'barbell', barG: lb(45), jumpG: lb(10) }] },
      { logs: [squat('b', 5, rows(45, [8, 8, 8, 8], [3, 3, 3, 3]))] },
    )
    expect(ask(bar)).toMatchObject({ rule: 'F8.5', loadG: lb(55) })
  })

  it('offers the smallest gap of a list of weights and not a larger jump (rule F8.5)', () => {
    const weights = [10, 15, 20, 25, 30, 35, 40, 50, 60]
    const at = (pounds: number) =>
      gobletAsk(weights, [goblet('g', 5, rows(pounds, [8, 8, 8], [3, 3, 3]))])
    // 25 lb to 30 lb is 20% of the load and the 5 lb the set goes up in
    expect(at(25)).toMatchObject({ rule: 'F8.5', change: 'increase', loadG: lb(30) })
    expect(at(10)).toMatchObject({ rule: 'F8.5', loadG: lb(15) })
    // 40 lb to 50 lb is 25% and a 10 lb jump in a set that also has 5 lb gaps
    const jump = at(40)
    expect(jump).toMatchObject({ rule: 'F8.6', change: 'hold', loadG: lb(40) })
    expect(jump.facts[0]?.template).toBe('strength.reason.hold-step')
    // 50 lb to 60 lb is 20% and a 10 lb jump
    expect(at(50)).toMatchObject({ rule: 'F8.6', change: 'hold' })
  })

  it('keeps the ceiling of the latest earlier estimate when a session gives none, and has none for a lift with no estimate yet', () => {
    // 100 lb to 125 lb is the only step of the list, so it is usable; the ceiling decides
    const at = (logs: StrengthLogEntry[], anchors: StrengthContext['anchors'] = []) =>
      suggestLoad(withSetup({ equipment: [dumbbellsOf(100, 125)] }, { logs, anchors }), {
        exerciseId: 'goblet-squat',
        implement: 'dumbbells',
        date: TODAY,
        ...structuresFor('heavy', 'other', 6),
      })
    // 6 reps and 1 left is an estimate of 123 lb and a ceiling of 111 lb
    const within = goblet('w', 12, rows(100, [6, 6, 6], [1, 1, 1]))
    expect(at([within])).toMatchObject({ rule: 'F8.6', change: 'hold' })
    expect(at([within]).facts[0]?.template).toBe('strength.reason.hold-ceiling')
    // 8 reps and 3 left is 11 repetitions to the limit: the session gives no estimate
    const over = goblet('o', 5, rows(100, [8, 8, 8], [3, 3, 3]))
    expect(estimateOneRm(lb(100), 8, 3)).toBeNull()
    // a lift with no estimate yet has no ceiling
    expect(at([over])).toMatchObject({ rule: 'F8.5', change: 'increase', loadG: lb(125) })
    // the session over the limit does not lift the ceiling of the one before it
    expect(at([within, over])).toMatchObject({ rule: 'F8.6', change: 'hold' })
    expect(at([within, over]).facts[0]?.template).toBe('strength.reason.hold-ceiling')
    // and neither does a lighter session, or a session that is not the latest
    const lighter = goblet('l', 3, rows(80, [5, 5], [3, 3]), { mode: 'lighter-day' })
    expect(at([within, over, lighter]).facts[0]?.template).toBe('strength.reason.hold-ceiling')
    // an anchor stands in for the estimate until a session gives one
    const anchor = {
      exerciseId: 'goblet-squat',
      kind: 'set',
      loadG: lb(100),
      reps: 6,
      rir: 1,
      asOf: ago(40),
    } as const
    expect(at([over], [anchor]).facts[0]?.template).toBe('strength.reason.hold-ceiling')
    expect(at([over], [anchor])).toMatchObject({ rule: 'F8.6', loadG: lb(100) })
  })

  it('reads the most recent estimate, not the best or the oldest', () => {
    const at = (logs: StrengthLogEntry[]) =>
      gobletAsk([100, 112], [...logs, goblet('o', 2, rows(100, [8, 8, 8], [3, 3, 3]))])
    // 80 lb for 6 with 1 left: a ceiling of 89 lb, under the 112 lb step; 100 lb for 6 with 3 left:
    // a ceiling of 117 lb, over it
    const low = (days: number) => goblet('a', days, rows(80, [6, 6, 6], [1, 1, 1]))
    const high = (days: number) => goblet('b', days, rows(100, [6, 6, 6], [3, 3, 3]))
    expect(at([low(20), high(10)])).toMatchObject({
      rule: 'F8.5',
      change: 'increase',
      loadG: lb(112),
    })
    expect(at([high(20), low(10)]).facts[0]?.template).toBe('strength.reason.hold-ceiling')
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
    // 50 lb to 60 lb is 20% of the load and a 10 lb jump in a set that also has 5 lb gaps
    const s = gobletAsk([40, 45, 50, 60], [row(15), row(8), row(2)], { canVary: true })
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
    const s = gobletAsk([40, 45, 50, 60], [row(8), row(2)], { canVary: true })
    expect(s).toMatchObject({ rule: 'F8.6', change: 'hold', moveTo: null })
  })

  it('needs the sessions in a row: a session short of the top or without reps left breaks the run', () => {
    const short = goblet('s', 8, rows(50, [6, 5, 6], [1, 1, 1]))
    expect(gobletAsk([40, 45, 50, 60], [row(15), short, row(2)], { canVary: true }).rule).toBe(
      'F8.6',
    )
    const tired = goblet('t', 8, rows(50, [6, 6, 6], [1, 0, 1]))
    expect(gobletAsk([40, 45, 50, 60], [row(15), tired, row(2)], { canVary: true }).rule).toBe(
      'F8.6',
    )
  })

  it('does not count a lighter session, which neither breaks the run nor joins it', () => {
    const lighter = goblet('l', 5, rows(40, [6, 6, 6], [3, 3, 3]), { mode: 'lighter-day' })
    const s = gobletAsk([40, 45, 50, 60], [row(15), row(8), lighter, row(2)], { canVary: true })
    expect(s.rule).toBe('F8.7')
  })

  it('moves on when the step is blocked by the ceiling as well', () => {
    // 100 lb to 113 lb is within the cap but past 90% of the estimate with a rep left
    const logs = [15, 8, 2].map((d) => goblet(`c${String(d)}`, d, rows(100, [6, 6, 6], [1, 1, 1])))
    expect(gobletAsk([100, 113], logs, { canVary: true }).rule).toBe('F8.7')
  })

  it('counts a session over the limit of the estimate with the ceiling of the one before it', () => {
    // 100 lb to 125 lb is the only step of the list; 6 reps with 1 left gives a ceiling of 111 lb,
    // and the two sessions of 8 reps with 3 left give no estimate of their own
    const logs = [
      goblet('a', 14, rows(100, [6, 6, 6], [1, 1, 1])),
      goblet('b', 8, rows(100, [8, 8, 8], [3, 3, 3])),
      goblet('c', 3, rows(100, [8, 8, 8], [3, 3, 3])),
    ]
    expect(gobletAsk([100, 125], logs, { canVary: true })).toMatchObject({
      rule: 'F8.7',
      change: 'variation',
      moveTo: 'split-squat',
    })
  })

  it('stays when the harder movement is not offered, the exercise is pinned, or the template keeps the load', () => {
    const logs = [row(15), row(8), row(2)]
    expect(gobletAsk([40, 45, 50, 60], logs, { canVary: false }).rule).toBe('F8.6')
    expect(gobletAsk([40, 45, 50, 60], logs).rule).toBe('F8.6')
    expect(
      gobletAsk([40, 45, 50, 60], logs, {
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
    let pastTheCap = 0
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

      // 4. an increase is within the larger of the step cap and the smallest step the equipment
      // makes, and under 90% of the estimated maximum
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
        // a ladder or a stack has one step; a list of weights has its smallest gap
        const smallest =
          kind === 1 ? Math.min(...rungs.slice(1).map((r, i) => r - (rungs[i] ?? 0))) : Infinity
        const room = Math.max((P.f8.maxStepPct.value / 100) * shown(base), smallest)
        expect(first, label).not.toBeNull()
        expect(shown(first ?? 0) - shown(base), label).toBeLessThanOrEqual(room)
        if (shown(first ?? 0) - shown(base) > (P.f8.maxStepPct.value / 100) * shown(base)) {
          pastTheCap += 1
        }
        expect(s.loadG ?? 0, label).toBeGreaterThan(base)
        const second = stepFrom(ladder as LoadSteps, first ?? 0, 1, unit)
        expect(s.loadG === first || s.loadG === second, label).toBe(true)
        if (s.loadG === second) {
          expect(shown(second ?? 0) - shown(first ?? 0), label).toBeLessThanOrEqual(room)
        }
        // the ceiling reads the best set of the latest normal session that gave an estimate, else
        // the anchor's, and there is none for a lift with no estimate at all
        const bestOf = (entry: StrengthLogEntry) =>
          Math.max(
            0,
            ...entry.sets.map((set) => estimateOneRm(set.loadG ?? 0, set.count, set.rir) ?? 0),
          )
        let best = 0
        for (const entry of [...normal].reverse()) {
          best = bestOf(entry)
          if (best > 0) break
        }
        const anchor = anchors[0]
        if (best === 0 && anchor !== undefined) best = anchorEstimate(anchor) ?? 0
        const top = P.flib.heavyMinPct1rm.range?.[1] ?? 0
        if (best > 0) expect(s.loadG ?? 0, label).toBeLessThanOrEqual((best * top) / 100 + 1)
        // a template that keeps the load never raises it
        expect(keepLoad, label).toBe(false)
      }
      if (s.change === 'reduce') reductions += 1
    }
    // the cases do reach a step up, a reduction and a load
    expect(steps).toBeGreaterThan(CASES / 2)
    expect(increases).toBeGreaterThan(5)
    expect(reductions).toBeGreaterThan(5)
    // and a step over the cap that is the smallest step of its equipment
    expect(pastTheCap).toBeGreaterThan(5)
  })
})

// ---------------------------------------------------------------------------------------------
// The derived workout (design 5.1, 8, 10)
// ---------------------------------------------------------------------------------------------

/** The session A (or B) of week `i`, the way the planner stores it. */
const sessionOf = (i: number, rank: 0 | 1 = 0, over: Partial<StrengthSessionRef> = {}) =>
  sessionRef(i, rank, over)

/** A context whose today is the day of session A of week `i`, as the sheet opens it. */
const onDayOf = (
  i: number,
  setup: Partial<StrengthContext['setup']>,
  over: Partial<StrengthContext> = {},
) => withSetup(setup, { today: sessionRef(i).date, ...over })

const liftOf = (workout: StrengthWorkout, exerciseId: string) =>
  workout.lifts.find((lift) => lift.exerciseId === exerciseId)

describe('workoutFor: a dumbbell runner in week 3 of the block', () => {
  // weeks 1 and 2 of the ramp-in were logged: the first session of each lift (2 sets) and a second
  // with every set at the top of the ramp-in range and 2 reps left; the steps of this ladder are
  // within the cap from 35 lb up (a 15 lb to 20 lb dumbbell is a third more load)
  const first = (id: string, pounds: number) => setsOf(id, rows(pounds, [6, 6], [3, 3]))
  const second = (id: string, pounds: number) => setsOf(id, rows(pounds, [8, 8, 8], [2, 2, 2]))
  const logs = [
    log('w1', sessionRef(0).date, {
      sets: [
        ...first('goblet-squat', 35),
        ...first('dumbbell-rdl', 35),
        ...first('standing-calf-raise', 40),
      ],
    }),
    log('w2', sessionRef(1).date, {
      sets: [
        ...second('goblet-squat', 35),
        ...second('dumbbell-rdl', 35),
        ...second('standing-calf-raise', 40),
      ],
    }),
  ]
  const ctx = onDayOf(2, { equipment: have('dumbbells', 'step') }, { logs })
  const workout = workoutFor(ctx, sessionOf(2))

  it('is the ramp-in of week 3 of 12 with the planned minutes as its budget', () => {
    expect(workout).toMatchObject({
      sessionId: 's2a',
      template: 'ramp-in',
      variant: 'A',
      block: { week: 3, of: 12, rampInWeeks: 3 },
      budgetMin: 40,
      setupSaved: true,
      rules: ['F-lib', 'F4', 'E5', 'F7'],
    })
  })

  it('has the knee, hip and calf lifts of the dumbbell ladder, 3 sets of 6 to 8 leaving 3', () => {
    expect(workout.lifts.map((lift) => [lift.exerciseId, lift.slot, lift.implement])).toEqual([
      ['goblet-squat', 'knee', 'dumbbells'],
      ['dumbbell-rdl', 'hip', 'dumbbells'],
      ['standing-calf-raise', 'calf', 'dumbbells'],
    ])
    for (const lift of workout.lifts) {
      expect(lift.sets).toBe(3)
      expect(lift.range).toEqual({ min: 6, max: 8 })
      expect(lift.targets).toEqual([6, 6, 6])
      expect(lift.rir).toEqual({ min: 3, max: 3 })
      expect(lift.steps).toEqual({ loadsG: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60].map(lb) })
    }
  })

  it('steps each load up once, with the reason as a template and its slots', () => {
    expect(workout.lifts.map((lift) => [lift.loadG, lift.change])).toEqual([
      [lb(40), 'increase'],
      [lb(40), 'increase'],
      [lb(45), 'increase'],
    ])
    expect(liftOf(workout, 'goblet-squat')?.basis).toEqual({
      rule: 'F8',
      facts: [
        {
          template: 'strength.reason.increase',
          slots: { exercise: 'Goblet squat', top: { kind: 'count', n: 8 } },
        },
      ],
    })
  })

  it('holds the first rung of the jump ladder at 40 contacts and two trunk movements', () => {
    expect(workout.plyo).toEqual({ contacts: 40, movements: ['pogo-hop'] })
    expect(workout.trunk.map((lift) => [lift.exerciseId, lift.sets, lift.range])).toEqual([
      ['side-plank', 2, { min: 30, max: 45 }],
      ['dead-bug', 2, { min: 8, max: 12 }],
    ])
    expect(workout.trunk.every((lift) => lift.loadG === null && lift.rir === null)).toBe(true)
  })
})

describe('workoutFor: a bar runner in week 6, after the ramp-in', () => {
  const day = (rank: 0 | 1) => sessionRef(4, rank).date
  const logs = [
    log('a', day(0), {
      sets: [
        ...setsOf('back-squat', rows(110, [6, 6, 6, 6], [2, 2, 1, 1])),
        ...setsOf('romanian-deadlift', rows(95, [6, 6, 6], [2, 2, 2])),
        ...setsOf('standing-calf-raise', rows(80, [6, 6, 6], [null, null, null])),
      ],
    }),
  ]
  const ctx = onDayOf(5, { equipment: have('barbell') }, { logs })
  const workout = workoutFor(ctx, sessionOf(5))

  it('is a heavy session A in week 6 of 12', () => {
    expect(workout).toMatchObject({
      template: 'heavy',
      variant: 'A',
      block: { week: 6, of: 12, rampInWeeks: 3 },
      budgetMin: 40,
    })
  })

  it('leads with the back squat for 4 sets of 3 to 6 leaving 1 to 3, then the hinge and the calf raise for 3', () => {
    expect(workout.lifts.map((lift) => [lift.exerciseId, lift.implement, lift.sets])).toEqual([
      ['back-squat', 'barbell', 4],
      ['romanian-deadlift', 'barbell', 3],
      ['standing-calf-raise', 'barbell', 3],
    ])
    for (const lift of workout.lifts) {
      expect(lift.range).toEqual({ min: 3, max: 6 })
      expect(lift.rir).toEqual({ min: 1, max: 3 })
    }
  })

  it('steps the squat and the hinge up and holds the calf raise, whose reps left were not recorded', () => {
    expect(workout.lifts.map((lift) => [lift.loadG, lift.change])).toEqual([
      [lb(115), 'increase'],
      [lb(100), 'increase'],
      [lb(80), 'hold'],
    ])
    expect(liftOf(workout, 'standing-calf-raise')?.basis.facts).toEqual([
      { template: 'strength.reason.hold-unrecorded', slots: {} },
    ])
    expect(liftOf(workout, 'back-squat')?.targets).toEqual([3, 3, 3, 3])
  })

  it('gives 60 contacts of pogo hops in the third heavy week, after one step', () => {
    expect(workout.plyo).toEqual({ contacts: 60, movements: ['pogo-hop'] })
  })

  it('finishes with the side plank and the dead bug, 2 sets each', () => {
    expect(workout.trunk.map((lift) => [lift.exerciseId, lift.sets])).toEqual([
      ['side-plank', 2],
      ['dead-bug', 2],
    ])
  })

  it('leads session B with the hinge for 4 sets, the squat for 3', () => {
    const b = workoutFor(ctx, sessionOf(5, 1))
    expect(b.variant).toBe('B')
    expect(b.lifts.map((lift) => [lift.exerciseId, lift.sets])).toEqual([
      ['romanian-deadlift', 4],
      ['back-squat', 3],
      ['standing-calf-raise', 3],
    ])
  })
})

describe('the templates of a workout', () => {
  /** Every exercise a runner with a bar and dumbbells could be given has a working load of 50 lb. */
  const seasoned = (at: string): StrengthLogEntry =>
    log('seasoned', at, {
      sets: [
        'back-squat',
        'romanian-deadlift',
        'goblet-squat',
        'dumbbell-rdl',
        'standing-calf-raise',
      ].flatMap((id, i) => setsOf(id, rows(50, [6, 6, 6, 6], [null, null, null, null]), i * 10)),
    })
  const base = plan(30, 12)
  const withFlags = (index: number, flags: string[], over: Partial<StrengthWeek> = {}) =>
    base.map((w, i) => (i === index ? { ...w, flags: [...w.flags, ...flags], ...over } : w))

  interface Case {
    name: string
    week: number
    weeks: StrengthWeek[]
    template: StrengthTemplate
    lifts: number
    leadSets: number
    otherSets: number
    plyo: number | null
    trunk: number
  }
  const [rampFirst, rampLater] = P.f7.rampInSets.value
  const cases: Case[] = [
    {
      name: 'ramp-in, first week',
      week: 0,
      weeks: base,
      template: 'ramp-in',
      lifts: 3,
      leadSets: rampFirst,
      otherSets: rampFirst,
      plyo: 40,
      trunk: 2,
    },
    {
      name: 'ramp-in, later week',
      week: 1,
      weeks: base,
      template: 'ramp-in',
      lifts: 3,
      leadSets: rampLater,
      otherSets: rampLater,
      plyo: 40,
      trunk: 2,
    },
    {
      name: 'heavy',
      week: 6,
      weeks: base,
      template: 'heavy',
      lifts: 3,
      leadSets: 4,
      otherSets: 3,
      plyo: 60,
      trunk: 2,
    },
    {
      name: 'lighter week',
      week: 6,
      weeks: withFlags(6, ['recovery']),
      template: 'lighter-week',
      lifts: 3,
      leadSets: 2,
      otherSets: 2,
      plyo: 30,
      trunk: 2,
    },
    {
      name: 'maintenance',
      week: 14,
      weeks: base,
      template: 'maintenance',
      lifts: 3,
      leadSets: 2,
      otherSets: 2,
      plyo: 60,
      trunk: 2,
    },
    {
      name: 'taper',
      week: 25,
      weeks: withFlags(25, ['taper']),
      template: 'taper',
      lifts: 2,
      leadSets: 2,
      otherSets: 2,
      plyo: null,
      trunk: 1,
    },
    {
      name: 'return',
      week: 6,
      weeks: withFlags(6, ['injury-return']),
      template: 'return',
      lifts: 3,
      leadSets: rampFirst,
      otherSets: rampFirst,
      plyo: null,
      trunk: 2,
    },
  ]
  it.each(cases)('$name', (c) => {
    const session = sessionOf(c.week, 0, { durationMin: c.template === 'heavy' ? 40 : 25 })
    const ctx = withSetup(
      { equipment: have('barbell', 'dumbbells') },
      { today: session.date, weeks: c.weeks, logs: [seasoned(addDays(session.date, -3))] },
    )
    const workout = workoutFor(ctx, session)
    expect(workout.template).toBe(c.template)
    expect(workout.lifts).toHaveLength(c.lifts)
    expect(workout.lifts[0]?.sets).toBe(c.leadSets)
    if (c.lifts > 1) expect(workout.lifts[1]?.sets).toBe(c.otherSets)
    expect(workout.trunk).toHaveLength(c.trunk)
    expect(workout.plyo?.contacts ?? null).toBe(c.plyo)
    expect(workout.budgetMin).toBe(session.durationMin)
  })

  it('leaves the barbell out of the ramp-in and the return and brings it in after them', () => {
    const implementsOf = (index: number, flags: string[] = []) => {
      const session = sessionOf(index)
      const ctx = withSetup(
        { equipment: have('barbell') },
        { today: session.date, weeks: flags.length > 0 ? withFlags(index, flags) : base },
      )
      return workoutFor(ctx, session).lifts.map((lift) => lift.implement)
    }
    expect(implementsOf(0)).not.toContain('barbell')
    expect(implementsOf(2)).not.toContain('barbell')
    expect(implementsOf(3)).toContain('barbell')
    expect(implementsOf(8)).toContain('barbell')
    expect(implementsOf(8, ['injury-return'])).not.toContain('barbell')
    expect(implementsOf(8, ['recovery'])).toContain('barbell')
    expect(implementsOf(14)).toContain('barbell')
    expect(implementsOf(25, ['taper'])).toContain('barbell')
  })

  it('keeps the load of a lighter week, maintenance and the taper, however well the last session went', () => {
    const great = (at: string) =>
      log('great', at, {
        sets: setsOf('back-squat', rows(110, [6, 6, 6, 6], [4, 4, 4, 4])),
      })
    const loadIn = (index: number, flags: string[]) => {
      const session = sessionOf(index)
      const ctx = withSetup(
        { equipment: have('barbell') },
        {
          today: session.date,
          weeks: withFlags(index, flags),
          logs: [great(addDays(session.date, -3))],
        },
      )
      return liftOf(workoutFor(ctx, session), 'back-squat')
    }
    // the heavy week earns two steps; the three that keep the load stay at 110 lb
    expect(loadIn(6, [])?.loadG).toBe(lb(120))
    for (const [index, flags, template] of [
      [6, ['recovery'], 'strength.reason.lighter-week'],
      [14, [], 'strength.reason.maintenance'],
      [25, ['taper'], 'strength.reason.taper'],
    ] as const) {
      const lift = loadIn(index, [...flags])
      expect(lift?.loadG, template).toBe(lb(110))
      expect(lift?.change, template).toBe('hold')
      expect(lift?.basis, template).toEqual({
        rule: 'F9',
        facts: [{ template, slots: { sets: 'two sets' } }],
      })
    }
  })

  it('gives a taper session the lead lift and the calf raise, two sets leaving 3 or more, and no jumps', () => {
    const session = sessionOf(25, 0, { durationMin: 25 })
    const ctx = withSetup(
      { equipment: have('dumbbells') },
      { today: session.date, weeks: withFlags(25, ['taper']) },
    )
    const a = workoutFor(ctx, session)
    expect(a.lifts.map((lift) => lift.slot)).toEqual(['knee', 'calf'])
    expect(a.plyo).toBeNull()
    for (const lift of a.lifts) {
      expect(lift.sets).toBe(P.f7.maintenanceSets.value)
      expect(lift.rir?.min).toBeGreaterThanOrEqual(P.f7.easyRir.value)
    }
    const bSession = sessionOf(25, 1, { durationMin: 25 })
    expect(
      workoutFor({ ...ctx, today: bSession.date }, bSession).lifts.map((lift) => lift.slot),
    ).toEqual(['hip', 'calf'])
  })

  it('starts the heavy template in the first block week after a regenerate that follows 4 logged weeks', () => {
    const block = 10
    const weeks = plan(40, 12).map((w, i) => ({
      ...w,
      flags: i >= block && i < block + 12 ? ['strength-block'] : [],
    }))
    const logs = [1, 2, 3, 4].map((back) =>
      log(`c${String(back)}`, addDays(monday(block), -7 * back + 1), { template: 'ramp-in' }),
    )
    const session = sessionOf(block)
    const ctx = withSetup({ equipment: have('dumbbells') }, { today: session.date, weeks, logs })
    expect(workoutFor(ctx, session)).toMatchObject({
      template: 'heavy',
      block: { week: 1, of: 12, rampInWeeks: 0 },
    })
    expect(workoutFor({ ...ctx, logs: [] }, session).template).toBe('ramp-in')
  })

  it('follows the ramp-in length of the runner: 2 weeks when experienced and lifting, 4 when new', () => {
    const templateAt = (setup: Partial<StrengthContext['setup']>, index: number) => {
      const session = sessionOf(index)
      return workoutFor(withSetup(setup, { today: session.date }), session).template
    }
    const experienced = { level: 'experienced', currentlyLifting: true } as const
    expect([0, 1, 2].map((i) => templateAt(experienced, i))).toEqual([
      'ramp-in',
      'ramp-in',
      'heavy',
    ])
    expect([2, 3, 4].map((i) => templateAt({ level: 'new' }, i))).toEqual([
      'ramp-in',
      'ramp-in',
      'heavy',
    ])
    expect([2, 3].map((i) => templateAt({ level: 'some' }, i))).toEqual(['ramp-in', 'heavy'])
  })
})

describe('workoutFor: before the setup is saved and when it changes', () => {
  it('is a bodyweight workout, with no load and the default ramp-in, until the setup is saved', () => {
    const session = sessionOf(1)
    const ctx = withSetup(
      { saved: false, equipment: have('barbell', 'dumbbells'), level: 'new' },
      { today: session.date },
    )
    const workout = workoutFor(ctx, session)
    expect(workout.setupSaved).toBe(false)
    expect(workout.block?.rampInWeeks).toBe(P.flib.heavyRampInWeeks.value)
    expect(
      workout.lifts.map((lift) => [lift.exerciseId, lift.implement, lift.loadG, lift.steps]),
    ).toEqual([
      ['tempo-squat', null, null, null],
      ['hip-thrust', null, null, null],
      ['standing-calf-raise', null, null, null],
    ])
    for (const lift of workout.lifts) {
      expect(lift.range).toEqual({
        min: P.f7.bodyweightReps.value[0],
        max: P.f7.bodyweightReps.value[1],
      })
      expect(lift.basis.facts[0]?.template).toBe('strength.reason.start-unloaded')
    }
  })

  it('follows a change of equipment on the next read and leaves the block position alone', () => {
    const session = sessionOf(7)
    const before = withSetup({ equipment: have('dumbbells') }, { today: session.date })
    const after = withSetup(
      { equipment: have('dumbbells', 'barbell', 'leg-press') },
      { today: session.date },
    )
    const one = workoutFor(before, session)
    const two = workoutFor(after, session)
    expect(one.lifts.map((lift) => lift.exerciseId)).toEqual([
      'goblet-squat',
      'dumbbell-rdl',
      'standing-calf-raise',
    ])
    expect(two.lifts.map((lift) => lift.exerciseId)).toEqual([
      'back-squat',
      'romanian-deadlift',
      'standing-calf-raise',
    ])
    expect(two.block).toEqual(one.block)
    expect(two.template).toBe(one.template)
    expect(two.plyo).toEqual(one.plyo)
    // the exercise with no history starts again, as a ramp-in session at a conservative load
    expect(two.lifts[0]).toMatchObject({ change: 'start', sets: P.f7.rampInSets.value[0] })
  })

  it('starts the exercise that replaces one the runner left out from its first load', () => {
    const session = sessionOf(7)
    const logs = [
      log('a', addDays(session.date, -3), {
        sets: setsOf('goblet-squat', rows(40, [5, 5, 5], [null, null, null])),
      }),
    ]
    const ctx = withSetup(
      { equipment: have('dumbbells'), avoid: ['goblet-squat'] },
      { today: session.date, logs },
    )
    const lift = workoutFor(ctx, session).lifts[0]
    expect(lift?.exerciseId).toBe('tempo-squat')
    expect(lift?.change).toBe('start')
  })
})

describe('workoutFor: the harder movement (rule F8.7)', () => {
  const heavy = (index: number) => sessionOf(index)
  const logsAt = (ids: string[], pounds: number, dates: string[], exercise = 'goblet-squat') =>
    ids.map((id, i) =>
      log(id, dates[i] ?? dates[0] ?? '', {
        sets: setsOf(exercise, rows(pounds, [6, 6, 6], [1, 1, 1])),
      }),
    )
  const session = heavy(8)
  const days = [14, 8, 3].map((n) => addDays(session.date, -n))
  // 50 lb to 60 lb is 20% of the load and a 10 lb jump in a set that also has a 5 lb gap
  const equipment = [dumbbellsOf(30, 35, 50, 60), ITEM.step]
  const goblet3 = logsAt(['a', 'b', 'c'], 50, days)

  it('takes the harder movement after 3 sessions at the top with no usable step, as a first session', () => {
    const ctx = withSetup({ equipment }, { today: session.date, logs: goblet3 })
    const knee = workoutFor(ctx, session).lifts[0]
    expect(knee).toMatchObject({
      exerciseId: 'split-squat',
      slot: 'knee',
      change: 'variation',
      sets: P.f7.rampInSets.value[0],
      rir: { min: P.f7.easyRir.value, max: P.f7.easyRir.value },
    })
    expect(knee?.basis.facts.map((f) => f.template)).toEqual([
      'strength.reason.variation',
      'strength.reason.start-lightest',
    ])
    expect(knee?.basis.facts[0]?.slots).toMatchObject({
      exercise: 'Goblet squat',
      next: 'Split squat',
    })
  })

  it('shows the harder movement by its own history once it has been logged', () => {
    const split = log('d', addDays(session.date, -1), {
      sets: setsOf('split-squat', rows(20, [6, 6, 6], [3, 3, 3])),
    })
    const ctx = withSetup({ equipment }, { today: session.date, logs: [...goblet3, split] })
    const knee = workoutFor(ctx, session).lifts[0]
    expect(knee?.exerciseId).toBe('split-squat')
    expect(knee?.change).toBe('hold')
  })

  it('stays on an exercise the runner pinned, and where the harder movement was left out', () => {
    const pinned = withSetup(
      { equipment, pinned: { knee: 'goblet-squat' } },
      { today: session.date, logs: goblet3 },
    )
    expect(workoutFor(pinned, session).lifts[0]?.exerciseId).toBe('goblet-squat')
    const left = withSetup(
      { equipment, avoid: ['split-squat'] },
      { today: session.date, logs: goblet3 },
    )
    expect(workoutFor(left, session).lifts[0]?.exerciseId).toBe('goblet-squat')
  })

  it('does not change the exercise in a template that keeps the load', () => {
    const maintenance = sessionOf(14)
    const logs = logsAt(
      ['a', 'b', 'c'],
      50,
      [14, 8, 3].map((n) => addDays(maintenance.date, -n)),
    )
    const ctx = withSetup({ equipment }, { today: maintenance.date, logs })
    expect(workoutFor(ctx, maintenance).lifts[0]?.exerciseId).toBe('goblet-squat')
  })
})

describe('workoutFor: the jump dose (rule F7)', () => {
  const index = 9
  const session = sessionOf(index)
  /** Heavy weeks are weeks 4 to 12; week 10 has week 4 to 9 behind it, six heavy weeks. */
  const runner = (
    weeks: StrengthWeek[],
    over: Partial<StrengthContext> = {},
    setup: Partial<StrengthContext['setup']> = {},
  ) => withSetup(setup, { today: session.date, weeks, ...over })
  const dose = (
    weeks: StrengthWeek[],
    over: Partial<StrengthContext> = {},
    setup: Partial<StrengthContext['setup']> = {},
  ) => workoutFor(runner(weeks, over, setup), session).plyo
  const ran = (share: Record<number, number>, flags: Record<number, string[]> = {}) =>
    plan(30, 12).map((w, i) => ({
      ...w,
      plannedRunMin: 100,
      runMin: share[i] ?? 100,
      flags: [...w.flags, ...(flags[i] ?? [])],
    }))

  it('steps up 20 contacts every second heavy week and a rung every third, after completed weeks', () => {
    // weeks 4 to 9 all run: steps after the 2nd, 4th and 6th, rungs after the 3rd and 6th
    expect(dose(ran({}))).toEqual({ contacts: 100, movements: ['squat-jump'] })
  })

  it('counts a week at exactly 80% of its planned run minutes as completed and one at 79% as not', () => {
    expect(P.j5.completionHoldShare.value).toBe(0.8)
    expect(dose(ran({ 4: 80 }))).toEqual(dose(ran({})))
    // week 5 at 79% holds the dose; the step is taken at the first completed week after it
    expect(dose(ran({ 4: 79 }))).toEqual({ contacts: 80, movements: ['squat-jump'] })
  })

  it('does not step in a week a rest window touched, and holds through a run of incomplete weeks', () => {
    expect(dose(ran({}, { 4: ['disrupted'] }))).toEqual({ contacts: 80, movements: ['squat-jump'] })
    expect(dose(ran({}, { 4: ['disruption-return'] }))).toEqual({
      contacts: 80,
      movements: ['squat-jump'],
    })
    const poor = Object.fromEntries([3, 4, 5, 6, 7, 8].map((i) => [i, 50]))
    expect(dose(ran(poor))).toEqual({ contacts: 40, movements: ['pogo-hop'] })
  })

  it('takes the step at the first completed week after a poor one, not all that were missed', () => {
    // weeks 4 to 7 poor, 8 and 9 run: week 8 completes the step that was due, week 9 does not
    const poor = Object.fromEntries([3, 4, 5, 6].map((i) => [i, 50]))
    expect(dose(ran(poor))).toEqual({ contacts: 60, movements: ['line-hop'] })
  })

  it('holds the dose with no run minutes planned', () => {
    const none = plan(30, 12).map((w) => ({ ...w, plannedRunMin: 0, runMin: 0 }))
    expect(dose(none)).toEqual({ contacts: 40, movements: ['pogo-hop'] })
  })

  it('reads a session ahead as of today: a week still in progress or ahead counts for nothing', () => {
    const weeks = ran({})
    // on the Wednesday of week 9 the finished weeks are 1 to 8, whichever week the session is in
    const asOf = { today: addDays(monday(8), 2) }
    const expected = { contacts: 80, movements: ['line-hop'] }
    expect(workoutFor(runner(weeks, asOf), session).plyo).toEqual(expected)
    expect(workoutFor(runner(weeks, asOf), sessionOf(index + 2)).plyo).toEqual(expected)
  })

  it('holds 40 contacts on the first rung through the whole ramp-in', () => {
    for (const i of [0, 1, 2]) {
      const s = sessionOf(i)
      const ctx = withSetup({}, { today: s.date, weeks: ran({}) })
      expect(workoutFor(ctx, s).plyo).toEqual({ contacts: 40, movements: ['pogo-hop'] })
    }
  })

  it('ends a 12-week block of completed weeks at 120 contacts, under the cap of 200', () => {
    const s = sessionOf(11)
    const ctx = withSetup({}, { today: s.date, weeks: ran({}) })
    expect(workoutFor(ctx, s).plyo?.contacts).toBe(120)
    expect(P.flib.plyoContactsMax.value).toBe(200)
  })

  it('stops at the cap and at the last rung in a longer block', () => {
    const weeks = plan(40, 32).map((w) => ({ ...w, plannedRunMin: 100, runMin: 100 }))
    const s = sessionOf(31)
    const ctx = withSetup({}, { today: s.date, weeks })
    expect(workoutFor(ctx, s).plyo).toEqual({ contacts: 200, movements: ['single-leg-hop'] })
  })

  it('halves the dose for a goal pace faster than 12 km/h, and only above it', () => {
    const at = (paceKmh: number | null) => dose(ran({}), { goal: { paceKmh } })?.contacts
    expect(P.flib.plyoEmphasisPaceKmh.value).toBe(12)
    expect(at(null)).toBe(100)
    expect(at(8)).toBe(100)
    expect(at(12)).toBe(100)
    expect(at(12.5)).toBe(50)
    expect(at(16)).toBe(50)
  })

  it('halves the dose and stops at the second rung for a bone stress history or a recent injury', () => {
    for (const risk of [
      { priorBsi: true, recentInjury: false },
      { priorBsi: false, recentInjury: true },
      { priorBsi: true, recentInjury: true },
    ]) {
      expect(dose(ran({}), { athlete: { ...context().athlete, risk } })).toEqual({
        contacts: 50,
        movements: ['line-hop'],
      })
    }
  })

  it('halves the dose of a lighter week, and once only when several cases apply', () => {
    const weeks = ran({}, { 9: ['recovery'] })
    expect(dose(weeks)).toEqual({ contacts: 50, movements: ['squat-jump'] })
    const everything = dose(weeks, {
      goal: { paceKmh: 15 },
      athlete: { ...context().athlete, risk: { priorBsi: true, recentInjury: true } },
    })
    expect(everything).toEqual({ contacts: 50, movements: ['line-hop'] })
  })

  it('gives maintenance 60 contacts on the rung reached, halved where a case applies', () => {
    const s = sessionOf(14)
    const maintenance = (over: Partial<StrengthContext> = {}) =>
      workoutFor(withSetup({}, { today: s.date, weeks: ran({}), ...over }), s).plyo
    // nine heavy weeks of the block, a rung every third: the last of the four movements
    expect(maintenance()).toEqual({ contacts: 60, movements: ['single-leg-hop'] })
    expect(maintenance({ goal: { paceKmh: 14 } })).toEqual({
      contacts: 30,
      movements: ['single-leg-hop'],
    })
  })

  it('gives no jumps in the taper or a return week', () => {
    const taper = withSetup({}, { today: sessionOf(25).date, weeks: ran({}, { 25: ['taper'] }) })
    expect(workoutFor(taper, sessionOf(25)).plyo).toBeNull()
    const back = withSetup({}, { today: session.date, weeks: ran({}, { 9: ['restart-floor'] }) })
    expect(workoutFor(back, session).plyo).toBeNull()
  })

  it('takes the nearest easier movement when the one on the rung was left out, else a harder one', () => {
    const without = (avoid: string[]) => dose(ran({}), {}, { avoid })
    expect(without(['squat-jump'])?.movements).toEqual(['line-hop'])
    expect(without(['squat-jump', 'line-hop', 'pogo-hop'])?.movements).toEqual(['single-leg-hop'])
    expect(without([...PLYO_LADDER])).toBeNull()
  })

  it('does not depend on the order of the weeks', () => {
    const weeks = ran({ 4: 79 })
    expect(dose([...weeks].reverse())).toEqual(dose(weeks))
  })
})

describe('workoutFor: the trunk finisher', () => {
  const trunkOf = (
    kinds: EquipmentKind[],
    rank: 0 | 1,
    over: Partial<StrengthContext['setup']> = {},
  ) => {
    const session = sessionOf(6, rank)
    return workoutFor(
      withSetup({ equipment: have(...kinds), ...over }, { today: session.date }),
      session,
    ).trunk
  }

  it('is the side plank and the dead bug on A, whatever the equipment', () => {
    for (const kinds of [[], ['bands'], ['dumbbells', 'bands']] as EquipmentKind[][]) {
      expect(trunkOf(kinds, 0).map((lift) => lift.exerciseId)).toEqual(['side-plank', 'dead-bug'])
    }
  })

  it('is the banded walk and the Pallof press on B with bands, the carry and the plank with dumbbells', () => {
    expect(trunkOf(['bands'], 1).map((lift) => lift.exerciseId)).toEqual([
      'banded-lateral-walk',
      'pallof-press',
    ])
    expect(trunkOf(['dumbbells'], 1).map((lift) => lift.exerciseId)).toEqual([
      'farmer-carry',
      'side-plank',
    ])
    expect(trunkOf([], 1).map((lift) => lift.exerciseId)).toEqual(['side-plank', 'dead-bug'])
  })

  it('counts a hold in seconds and a movement in reps, in the sets and ranges of the Params', () => {
    const [plank, bug] = trunkOf([], 0)
    expect(plank).toMatchObject({
      sets: P.f7.trunkSets.value,
      range: { min: 30, max: 45 },
      targets: [30, 30],
    })
    expect(bug).toMatchObject({
      sets: P.f7.trunkSets.value,
      range: { min: 8, max: 12 },
      targets: [8, 8],
    })
  })

  it('loads the carry from the table and keeps the load, which has no reps left to read', () => {
    const [carry] = trunkOf(['dumbbells'], 1)
    // 70 kg x 0.15 = 10.5 kg = 23 lb: the 20 lb dumbbell
    expect(carry).toMatchObject({
      exerciseId: 'farmer-carry',
      loadG: lb(20),
      change: 'start',
      rir: null,
    })
    expect(carry?.steps).not.toBeNull()
  })

  it('skips a movement the runner left out and takes the next of the order', () => {
    expect(trunkOf([], 0, { avoid: ['side-plank'] }).map((lift) => lift.exerciseId)).toEqual([
      'dead-bug',
    ])
    expect(trunkOf([], 0, { avoid: ['side-plank', 'dead-bug'] })).toEqual([])
  })
})

describe('workoutFor: a lower-readiness day (rule F9)', () => {
  const session = sessionOf(5)
  const logs = [
    log('a', addDays(session.date, -3), {
      sets: [
        ...setsOf('back-squat', rows(110, [6, 6, 6, 5], [2, 2, 2, 2])),
        ...setsOf('romanian-deadlift', rows(95, [6, 6, 6], [2, 2, 2]), 10),
        ...setsOf('standing-calf-raise', rows(80, [5, 5, 5], [2, 2, 2]), 20),
      ],
    }),
  ]
  const readiness = (over: Partial<StrengthReadiness> = {}): StrengthReadiness => ({
    date: session.date,
    state: 'possible-fatigue',
    pain: null,
    illness: 'clear',
    ...over,
  })
  const run = (r: StrengthReadiness | null, date = session.date) =>
    workoutFor(
      withSetup({ equipment: have('barbell') }, { today: session.date, logs, readiness: r }),
      { ...session, date },
    )

  it('takes one set from each lift and 10% from each load, rounded down to a step, and keeps the usual load', () => {
    const usual = run(null)
    const lighter = run(readiness())
    expect(usual.lifts.map((lift) => [lift.sets, lift.loadG])).toEqual([
      [4, lb(110)],
      [3, lb(100)],
      [3, lb(80)],
    ])
    // 110 lb less 10% is 99 lb: the 95 lb rung; 100 lb less 10% is 90 lb; 80 lb less 10% is 72 lb: 70 lb
    expect(
      lighter.lifts.map((lift) => [lift.sets, lift.loadG, lift.usualLoadG, lift.change]),
    ).toEqual([
      [3, lb(95), lb(110), 'lighter-day'],
      [2, lb(90), lb(100), 'lighter-day'],
      [2, lb(70), lb(80), 'lighter-day'],
    ])
    expect(P.f9.lowReadinessLoadPct.value).toBe(10)
    expect(P.f9.lowReadinessSetsCut.value).toBe(1)
    for (const lift of lighter.lifts) expect(lift.targets).toHaveLength(lift.sets)
  })

  it('states the F9 reason first and keeps the F8 reason for the usual load', () => {
    const lift = run(readiness()).lifts[0]
    expect(lift?.basis.rule).toBe('F9')
    expect(lift?.basis.facts.map((f) => f.template)).toEqual([
      'strength.reason.lighter-day',
      'strength.reason.hold-range',
    ])
    expect(lift?.basis.facts[0]?.slots).toEqual({ sets: 'one set' })
  })

  it('never adds load or sets: the usual workout is the ceiling', () => {
    const usual = run(null)
    const lighter = run(readiness())
    lighter.lifts.forEach((lift, i) => {
      expect(lift.loadG ?? 0).toBeLessThanOrEqual(usual.lifts[i]?.loadG ?? 0)
      expect(lift.sets).toBeLessThanOrEqual(usual.lifts[i]?.sets ?? 0)
    })
  })

  it('leaves the jumps and the trunk movements as they are', () => {
    const usual = run(null)
    const lighter = run(readiness())
    expect(lighter.plyo).toEqual(usual.plyo)
    expect(lighter.trunk).toEqual(usual.trunk)
    expect(lighter.template).toBe(usual.template)
  })

  it.each([
    ['possible fatigue', readiness({ state: 'possible-fatigue' })],
    ['persistent suppression', readiness({ state: 'persistent-suppression' })],
    ['pain at the flag score', readiness({ state: 'normal', pain: P.pain.flagScore.value })],
    ['pain above it', readiness({ state: 'normal', pain: P.pain.flagScore.value + 3 })],
    ['illness in its easy-only phase', readiness({ state: 'normal', illness: 'easy-only' })],
    ['illness in its rest phase', readiness({ state: 'normal', illness: 'rest' })],
  ])('applies on %s', (_name, r) => {
    expect(run(r).lifts.every((lift) => lift.change === 'lighter-day')).toBe(true)
  })

  it('does not apply to a normal read, pain under the flag score, or a clear illness', () => {
    expect(run(readiness({ state: 'normal' })).lifts.some((l) => l.change === 'lighter-day')).toBe(
      false,
    )
    expect(
      run(readiness({ state: 'normal', pain: P.pain.flagScore.value - 1 })).lifts[0]?.change,
    ).not.toBe('lighter-day')
    expect(run(null).lifts[0]?.change).not.toBe('lighter-day')
  })

  it('applies to the viewed day only: a preview or a past day has no read', () => {
    const tomorrow = addDays(session.date, 1)
    expect(run(readiness(), tomorrow).lifts.some((l) => l.change === 'lighter-day')).toBe(false)
    expect(run(readiness({ date: tomorrow })).lifts.some((l) => l.change === 'lighter-day')).toBe(
      false,
    )
  })

  it('keeps at least the fewest sets of a template, and lightens a lift that already has them', () => {
    const maintenance = sessionOf(14)
    const ctx = withSetup(
      { equipment: have('barbell') },
      {
        today: maintenance.date,
        logs: [
          log('m', addDays(maintenance.date, -3), {
            sets: setsOf('back-squat', rows(110, [5, 5], [null, null])),
          }),
        ],
        readiness: { ...readiness(), date: maintenance.date },
      },
    )
    const lift = workoutFor(ctx, maintenance).lifts[0]
    expect(lift).toMatchObject({
      sets: P.f7.maintenanceSets.value,
      loadG: lb(95),
      usualLoadG: lb(110),
    })
  })

  it('cuts the sets of a movement with no added load and has no load to lower', () => {
    const ctx = withSetup(
      {},
      {
        today: session.date,
        readiness: readiness(),
        logs: [
          log('t', addDays(session.date, -3), {
            sets: setsOf('tempo-squat', [
              [null, 10, 2],
              [null, 10, 2],
              [null, 10, 2],
              [null, 10, 2],
            ]),
          }),
        ],
      },
    )
    const knee = workoutFor(ctx, session).lifts[0]
    expect(knee).toMatchObject({
      exerciseId: 'tempo-squat',
      sets: 3,
      loadG: null,
      usualLoadG: null,
      change: 'lighter-day',
    })
  })

  it('shows the lighter day for a first session as well, which cannot go lower than the lightest load', () => {
    const ctx = withSetup(
      { equipment: have('barbell') },
      { today: session.date, readiness: readiness() },
    )
    const squat = workoutFor(ctx, session).lifts[0]
    // the first load is 50 lb, two sets, which a lighter day cannot cut; the load comes to the 45 lb bar
    expect(squat).toMatchObject({
      exerciseId: 'back-squat',
      loadG: lb(45),
      usualLoadG: lb(50),
      sets: 2,
    })
  })

  it('is logged as a lighter day, and modeOf names every mode', () => {
    expect(modeOf(run(readiness()))).toBe('lighter-day')
    expect(modeOf(run(null))).toBe('normal')
    const w = (template: StrengthTemplate, changes: WorkoutLift['change'][] = ['hold']) => ({
      template,
      lifts: changes.map((change) => ({ ...run(null).lifts[0]!, change })),
    })
    expect(modeOf(w('heavy'))).toBe('normal')
    expect(modeOf(w('ramp-in'))).toBe('normal')
    expect(modeOf(w('maintenance'))).toBe('normal')
    expect(modeOf(w('lighter-week'))).toBe('lighter-week')
    expect(modeOf(w('taper'))).toBe('taper')
    expect(modeOf(w('return'))).toBe('return')
    expect(modeOf(w('heavy', ['hold', 'return']))).toBe('return')
    expect(modeOf(w('heavy', ['hold', 'lighter-day']))).toBe('lighter-day')
    expect(modeOf(w('taper', ['lighter-day']))).toBe('lighter-day')
  })
})

describe('workoutFor: a gap (rule F9, F8.2)', () => {
  it('comes back lighter after 4 weeks without a session, and is logged as a return', () => {
    const session = sessionOf(8)
    const logs = [
      log('a', addDays(session.date, -P.f8.layoffDays.value), {
        sets: setsOf('back-squat', rows(110, [6, 6, 6, 6], [2, 2, 2, 2])),
      }),
    ]
    const ctx = withSetup({ equipment: have('barbell') }, { today: session.date, logs })
    const workout = workoutFor(ctx, session)
    const squat = liftOf(workout, 'back-squat')
    expect(squat).toMatchObject({ change: 'return', loadG: lb(95), targets: [3, 3, 3, 3] })
    expect(squat?.rir).toEqual({ min: P.f7.easyRir.value, max: P.f7.easyRir.value })
    expect(modeOf(workout)).toBe('return')
  })
})

describe('liftFor and liftTexts', () => {
  const session = sessionOf(7)
  const ctx = withSetup(
    { equipment: have('barbell', 'dumbbells', 'leg-press', 'step') },
    { today: session.date },
  )

  it('builds a lift for a swap: the exercise of the catalogue in the place of the session', () => {
    const goblet = liftFor(ctx, session, 'goblet-squat')
    expect(goblet).toMatchObject({
      exerciseId: 'goblet-squat',
      slot: 'knee',
      implement: 'dumbbells',
      change: 'start',
    })
    expect(goblet?.sets).toBe(P.f7.rampInSets.value[0])
    // the lead lift of session A has the sets of a lead lift once it has a history
    const logs = [
      log('g', addDays(session.date, -3), {
        sets: setsOf('goblet-squat', rows(40, [4, 4, 4, 4], [null, null, null, null])),
      }),
    ]
    expect(liftFor({ ...ctx, logs }, session, 'goblet-squat')?.sets).toBe(4)
    expect(liftFor({ ...ctx, logs }, sessionOf(7, 1), 'goblet-squat')?.sets).toBe(3)
  })

  it('reaches a harder movement and a trunk movement, and no jump', () => {
    expect(liftFor(ctx, session, 'step-up')?.slot).toBe('knee')
    expect(liftFor(ctx, session, 'farmer-carry')?.slot).toBe('trunk')
    expect(liftFor(ctx, session, 'pogo-hop')).toBeNull()
  })

  it('gives none for an exercise the runner cannot do, or one the catalogue does not know', () => {
    expect(
      liftFor(
        withSetup({ equipment: have('dumbbells') }, { today: session.date }),
        session,
        'back-squat',
      ),
    ).toBeNull()
    expect(liftFor(ctx, session, 'not-a-lift' as ExerciseId)).toBeNull()
    // no barbell in the ramp-in
    const ramp = sessionOf(1)
    expect(liftFor({ ...ctx, today: ramp.date }, ramp, 'back-squat')).toBeNull()
  })

  it('names an exercise, its cue and its note as templates and slots', () => {
    const squat = liftTexts('back-squat')
    expect(squat?.name).toEqual({ template: 'strength.name.back-squat', slots: {} })
    expect(squat?.cue).toEqual({ template: 'strength.cue.back-squat', slots: {} })
    expect(squat?.note).toEqual({
      template: 'strength.note.lower-stand',
      slots: { seconds: { kind: 'count', n: P.f7.lowerSeconds.value } },
    })
    expect(liftTexts('pogo-hop')?.note).toEqual({ template: 'strength.note.plyo', slots: {} })
    expect(liftTexts('side-plank')?.note).toEqual({
      template: 'strength.note.controlled',
      slots: {},
    })
    expect(liftTexts('nothing')).toBeNull()
  })

  it('has a registered template behind every name, cue and note', () => {
    for (const exercise of EXERCISES) {
      const texts = liftTexts(exercise.id)
      for (const part of [texts?.name, texts?.cue, texts?.note]) {
        expect(Object.keys(STRENGTH_TEMPLATES), exercise.id).toContain(part?.template)
      }
    }
  })
})

describe('every workout', () => {
  it('exists for each of the 256 subsets of the eight kinds of equipment, in every template', () => {
    let counted = 0
    for (let mask = 0; mask < 1 << ALL_KINDS.length; mask += 1) {
      const kinds = ALL_KINDS.filter((_, bit) => (mask >> bit) & 1)
      const equipment = have(...kinds)
      for (const [index, flags] of [
        [0, []],
        [2, []],
        [6, []],
        [6, ['recovery']],
        [14, []],
        [25, ['taper']],
        [6, ['injury-return']],
      ] as Array<[number, string[]]>) {
        const session = sessionOf(index)
        const weeks = plan(30, 12).map((w, i) =>
          i === index ? { ...w, flags: [...w.flags, ...flags] } : w,
        )
        const workout = workoutFor(
          withSetup({ equipment }, { today: session.date, weeks }),
          session,
        )
        const label = `${kinds.join('+') || 'none'} ${workout.template}`
        expect(workout.lifts.length, label).toBeGreaterThan(0)
        for (const lift of [...workout.lifts, ...workout.trunk]) {
          // an implement is one the runner has, the barbell only with a bar and after the ramp-in
          if (lift.implement !== null) expect(kinds, label).toContain(lift.implement)
          if (lift.implement === 'barbell') {
            expect(['ramp-in', 'return'], label).not.toContain(workout.template)
          }
          // a load is on a rung of the equipment
          if (lift.loadG !== null) {
            expect(lift.steps, label).not.toBeNull()
            expect(roundDownToStep(lift.steps as LoadSteps, lift.loadG, 'lb'), label).toBe(
              lift.loadG,
            )
          }
          expect(lift.targets, label).toHaveLength(lift.sets)
          expect(lift.sets, label).toBeGreaterThan(0)
        }
        counted += 1
      }
    }
    expect(counted).toBe(256 * 7)
  })

  it('gives the same workout twice, from a frozen context, in any order of its rows', () => {
    const session = sessionOf(7)
    const logs = [
      log('a', addDays(session.date, -10), {
        sets: setsOf('back-squat', rows(105, [6, 6, 6, 6], [2, 2, 2, 2])),
      }),
      log('b', addDays(session.date, -3), {
        sets: [
          ...setsOf('back-squat', rows(110, [6, 6, 6, 6], [2, 2, 1, 1])),
          ...setsOf('standing-calf-raise', rows(60, [4, 4, 4], [null, null, null]), 10),
        ],
      }),
    ]
    const ctx = withSetup(
      { equipment: have('barbell', 'dumbbells') },
      { today: session.date, logs },
    )
    const reference = workoutFor(ctx, session)
    expect(workoutFor(ctx, session)).toEqual(reference)
    expect(workoutFor(deepFreeze(structuredClone(ctx)), session)).toEqual(reference)
    const scrambled: StrengthContext = {
      ...ctx,
      logs: [...logs].reverse().map((entry) => ({ ...entry, sets: [...entry.sets].reverse() })),
      weeks: [...ctx.weeks].reverse(),
      sessions: [...ctx.sessions].reverse(),
    }
    expect(workoutFor(scrambled, session)).toEqual(reference)
  })
})

// ---------------------------------------------------------------------------------------------
// History and the tracking behind it (design 6.4, 12)
// ---------------------------------------------------------------------------------------------

describe('summariseHistory', () => {
  // back squat: three normal sessions rising, then a lighter day; one goblet squat session
  const a = squat('a', 20, rows(100, [5, 5, 5, 5], [null, null, null, null]))
  const b = squat('b', 13, rows(105, [6, 6, 5, 5], [2, 2, 2, 2]))
  const c = squat('c', 6, rows(110, [6, 6, 6, 6], [2, 2, 1, 1]))
  const d = squat('d', 2, rows(100, [5, 5], [3, 3]), { mode: 'lighter-day' })
  const g = goblet('g', 9, rows(40, [5, 5, 5], [null, null, null]))
  const ctx = barbellRunner([a, b, c, d, g])
  const summary = summariseHistory(ctx)
  const squats = summary.lifts.find((lift) => lift.exerciseId === 'back-squat')

  it('lists the exercises with a logged set, the latest first', () => {
    expect(summary.lifts.map((lift) => lift.exerciseId)).toEqual(['back-squat', 'goblet-squat'])
  })

  it('gives the sessions of an exercise newest first, with the sets, mode and heaviest set', () => {
    expect(squats?.sessions.map((s) => [s.logId, s.mode, s.sets.length])).toEqual([
      ['d', 'lighter-day', 2],
      ['c', 'normal', 4],
      ['b', 'normal', 4],
      ['a', 'normal', 4],
    ])
    expect(squats?.sessions[1]?.heaviest).toEqual({ loadG: lb(110), count: 6 })
    expect(squats?.sessions[1]?.sets[2]).toEqual({ position: 2, loadG: lb(110), count: 6, rir: 1 })
    expect(squats?.sessions[1]?.workingLoadG).toBe(lb(110))
    expect(squats?.sessions[1]?.estimateG).toBe(estimateOneRm(lb(110), 6, 2))
  })

  it('takes the heaviest set as the greatest load and, of equals, the most reps', () => {
    const mixed = log('m', ago(3), {
      sets: [
        { exerciseId: 'back-squat', position: 0, loadG: lb(100), count: 8, rir: null },
        { exerciseId: 'back-squat', position: 1, loadG: lb(115), count: 3, rir: null },
        { exerciseId: 'back-squat', position: 2, loadG: lb(115), count: 5, rir: null },
        { exerciseId: 'back-squat', position: 3, loadG: lb(110), count: 9, rir: null },
      ],
    })
    const lift = summariseHistory(barbellRunner([mixed])).lifts[0]
    expect(lift?.sessions[0]?.heaviest).toEqual({ loadG: lb(115), count: 5 })
    const bodyweight = log('t', ago(3), { sets: setsOf('tempo-squat', [[null, 10, 2]]) })
    expect(
      summariseHistory(context({ logs: [bodyweight] })).lifts[0]?.sessions[0]?.heaviest,
    ).toBeNull()
  })

  it('reads the estimated maximum from the best set of the latest session, with a label and never a test', () => {
    // the lighter day is the latest session: 100 lb for 5 with 3 left
    expect(squats?.estimateG).toBe(estimateOneRm(lb(100), 5, 3))
    expect(summary.lifts[1]?.estimateG).toBe(estimateOneRm(lb(40), 5, null))
  })

  it('names the working load of the latest normal session, and the last move of it', () => {
    expect(squats?.workingLoadG).toBe(lb(110))
    expect(squats?.lastChange).toEqual({ fromG: lb(105), toG: lb(110), date: ago(6) })
    // an exercise with one session, or one that has not moved, has none
    expect(summary.lifts[1]?.lastChange).toBeNull()
    const flat = summariseHistory(
      barbellRunner([a, squat('e', 5, rows(100, [5, 5], [null, null]))]),
    )
    expect(flat.lifts[0]?.lastChange).toBeNull()
  })

  it('counts the days since the latest session of any mode', () => {
    expect(squats?.gapDays).toBe(2)
    expect(squats?.lastDate).toBe(ago(2))
    expect(summary.lifts[1]?.gapDays).toBe(9)
  })

  it('does not depend on the order of the logs or of the sets', () => {
    const scrambled = [g, d, b, a, c].map((entry) => ({
      ...entry,
      sets: [...entry.sets].reverse(),
    }))
    expect(summariseHistory(barbellRunner(scrambled))).toEqual(summary)
  })

  it('leaves a frozen context alone', () => {
    expect(summariseHistory(deepFreeze(structuredClone(ctx)))).toEqual(summary)
  })

  describe('by week', () => {
    const week = (monday: string) => summary.weeks.find((w) => w.weekStart === monday)

    it('counts the sessions planned and logged and the sets of each week', () => {
      const cWeek = week(mondayOf(c.date))
      expect(cWeek).toMatchObject({ planned: 2, logged: 2, sets: 7 })
      // the squat of the week and the goblet squat are the week's two logs
      const logged = summary.weeks.reduce((total, w) => total + w.logged, 0)
      expect(logged).toBe(5)
    })

    it('names the lifts whose working load moved from the one before the week', () => {
      expect(week(mondayOf(c.date))?.moved).toEqual([
        { exerciseId: 'back-squat', fromG: lb(105), toG: lb(110) },
      ])
      expect(week(mondayOf(b.date))?.moved).toEqual([
        { exerciseId: 'back-squat', fromG: lb(100), toG: lb(105) },
      ])
      // the first session of an exercise has nothing to move from, and a lighter day moves nothing
      expect(week(mondayOf(a.date))?.moved).toEqual([])
      expect(week(mondayOf(d.date))?.moved ?? []).toEqual([])
    })

    it('lists the weeks oldest first, planned or logged', () => {
      const starts = summary.weeks.map((w) => w.weekStart)
      expect([...starts].sort()).toEqual(starts)
      expect(starts).toContain(mondayOf(a.date))
    })
  })

  describe('the count prompt (design 12.4)', () => {
    // two sessions a week are planned in every week of the fixture plan; today is in week 6
    const full = (i: number) => [
      log(`f${String(i)}a`, sessionRef(i, 0).date),
      log(`f${String(i)}b`, sessionRef(i, 1).date),
    ]
    const one = (i: number) => [log(`o${String(i)}`, sessionRef(i, 0).date)]
    const read = (logs: StrengthLogEntry[]) => summariseHistory(context({ logs }))

    it('asks after 3 finished weeks in a row with fewer sessions logged than planned', () => {
      expect(P.f9.countPromptWeeks.value).toBe(3)
      const three = read([...full(0), ...full(1), ...one(2), ...one(3), ...one(4)])
      expect(three).toMatchObject({ lowCountWeeks: 3, countPrompt: true })
    })

    it('does not ask after 2, or when a full week comes between', () => {
      expect(read([...full(0), ...full(1), ...full(2), ...one(3), ...one(4)])).toMatchObject({
        lowCountWeeks: 2,
        countPrompt: false,
      })
      expect(read([...one(0), ...one(1), ...full(2), ...one(3), ...one(4)])).toMatchObject({
        lowCountWeeks: 2,
        countPrompt: false,
      })
    })

    it('counts a week with no session at all as one fewer than planned', () => {
      expect(read([...full(0), ...full(1), ...one(2)]).lowCountWeeks).toBe(3)
    })

    it('does not count the week in progress, and a week with nothing planned ends the run', () => {
      // today is a Wednesday of week 6: week 6 is not finished
      expect(read(full(0)).lowCountWeeks).toBe(4)
      const none = context({ sessions: sessionsOf(30).filter((s) => !s.id.startsWith('s4')) })
      expect(summariseHistory(none).lowCountWeeks).toBe(0)
    })

    it('counts a session saved without sets, which is a log with none', () => {
      const without = [0, 1, 2, 3, 4].flatMap((i) => full(i))
      expect(read(without).lowCountWeeks).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------------------------
// The replay of a light start (design 10.3)
// ---------------------------------------------------------------------------------------------

describe('a light start over the weeks of a block', () => {
  /**
   * A synthetic lifter on a leg-press stack (10 lb steps to 500 lb) who works every set to the low
   * end of the reps left the workout asks for, up to the top of the range, and so stops short of
   * what the rules ask for only when the load is nearly too heavy. His capacity at a load is
   * 30 x (maximum / load - 1) repetitions to the limit. Returns, per session, the share of the
   * true maximum the suggested load was.
   */
  function replay(trueMaxLb: number, weightKg: number, weeks: number): number[] {
    const equipment: EquipmentConfig = { kind: 'leg-press', stepG: lb(10), maxG: lb(500) }
    const logs: StrengthLogEntry[] = []
    const shares: number[] = []
    for (let i = 0; i < weeks; i += 1) {
      for (const rank of [0, 1] as const) {
        const session = sessionRef(i, rank)
        const ctx = withSetup(
          { equipment: [equipment] },
          { today: session.date, logs, athlete: { ...context().athlete, weightKg } },
        )
        const workout = workoutFor(ctx, session)
        const lift = workout.lifts.find((l) => l.exerciseId === 'leg-press')
        expect(lift?.loadG).not.toBeNull()
        const pounds = fromGrams(lift?.loadG ?? 0, 'lb')
        const capacity = Math.floor(30 * (trueMaxLb / pounds - 1))
        const sets = (lift?.targets ?? []).map((_, position) => {
          const count = Math.max(
            0,
            Math.min(lift?.range.max ?? 0, capacity - (lift?.rir?.min ?? 0)),
          )
          return {
            exerciseId: 'leg-press',
            position,
            loadG: lift?.loadG ?? null,
            count,
            rir: Math.max(0, Math.min(5, capacity - count)),
          }
        })
        logs.push(
          log(`r${String(i)}${String(rank)}`, session.date, { sets, template: workout.template }),
        )
        shares.push(pounds / trueMaxLb)
      }
    }
    return shares
  }
  const floor = P.flib.heavyMinPct1rm.value / 100
  const ceiling = (P.flib.heavyMinPct1rm.range?.[1] ?? 0) / 100
  /** The 1-based number of the first session at or over the heavy floor, or null. */
  const firstHeavy = (shares: number[]) => {
    const at = shares.findIndex((share) => share >= floor)
    return at < 0 ? null : at + 1
  }

  it('reaches the heavy range in the 11th session for a 70 kg lifter with a 320 lb leg press', () => {
    const shares = replay(320, 70, 12)
    // recorded 2026-10-25: 22% of the maximum at the start, 81% at session 11 (week 6, session A)
    expect(shares[0]).toBeCloseTo(70 / 320, 5)
    expect(firstHeavy(shares)).toBe(11)
    expect(firstHeavy(shares.slice(0, 12))).toBe(11)
  })

  it('reaches it in the 15th session for a 90 kg lifter with a 450 lb leg press', () => {
    expect(firstHeavy(replay(450, 90, 12))).toBe(15)
  })

  it('never asks for more than 90% of the true maximum, and never takes a step down on the way up', () => {
    for (const [max, kg] of [
      [320, 70],
      [450, 90],
      [260, 80],
    ] as const) {
      const shares = replay(max, kg, 12)
      expect(Math.max(...shares), `${String(max)} lb`).toBeLessThanOrEqual(ceiling)
      shares.forEach((share, i) => {
        if (i > 0)
          expect(share, `${String(max)} lb session ${String(i + 1)}`).toBeGreaterThanOrEqual(
            shares[i - 1] ?? 0,
          )
      })
    }
  })

  it('moves the lifters a 10 lb step used to stall, now that the smallest step is always usable', () => {
    // recorded 2026-10-25. Before the amendment of rule F8.5 both held at their first load for all
    // 12 weeks (60 lb and 50 lb): 10 lb is over 15% of a load under 67 lb.
    const slight = replay(200, 55, 12)
    expect((slight[0] ?? 0) * 200).toBeCloseTo(60, 5)
    expect(firstHeavy(slight)).toBe(6)
    const light = replay(150, 50, 12)
    // two smallest steps a session while every set has 5 left, then single steps
    expect(light.slice(0, 4).map((share) => Math.round(share * 150))).toEqual([50, 70, 90, 110])
    expect(firstHeavy(light)).toBe(7)
    expect(Math.max(...light)).toBeLessThanOrEqual(ceiling)
  })
})

// ---------------------------------------------------------------------------------------------
// The words (ADR 0010) and the source (design 3)
// ---------------------------------------------------------------------------------------------

describe('the reasons the engine gives', () => {
  const factsOf = (suggestions: LoadSuggestion[]) => suggestions.flatMap((s) => s.facts)
  const squatRun = (sets: Row[], over: Partial<LoadRequest> = {}, extra: StrengthLogEntry[] = []) =>
    ask(barbellRunner([squat('a', 5, sets), ...extra]), over)

  /** A suggestion that reaches each reason of the registry, and the workouts of the F9 cases. */
  const reached = (): Array<{ template: string; slots: Record<string, unknown> }> => {
    const session = sessionOf(5)
    const suggestions = [
      squatRun(rows(110, [6, 6, 6, 6], [1, 1, 1, 1])),
      squatRun(rows(110, [6, 6, 6, 6], [4, 4, 4, 4])),
      squatRun(rows(110, [6, 6, 6, 6], [null, null, null, null])),
      squatRun(rows(110, [6, 5, 6, 6], [2, 2, 2, 2])),
      squatRun(rows(110, [6, 6, 6, 6], [2, 0, 2, 2])),
      squatRun(rows(110, [6, 6, 2], [null, null, null])),
      squatRun(rows(110, [6, 1], [null, null])),
      ask(barbellRunner()),
      ask(barbellRunner([], { athlete: { ...context().athlete, weightKg: null } })),
      ask(barbellRunner([squat('a', 40, rows(110, [6, 6], [2, 2]))])),
      ask(
        barbellRunner([], {
          anchors: [
            {
              exerciseId: 'back-squat',
              kind: 'max',
              loadG: lb(200),
              reps: 1,
              rir: null,
              asOf: ago(5),
            },
          ],
        }),
      ),
      suggestLoad(context(), {
        exerciseId: 'tempo-squat',
        implement: null,
        date: TODAY,
        ...structuresFor('heavy', 'lead', 6),
      }),
      gobletAsk([95, 100, 116], [goblet('g', 5, rows(100, [6, 6, 6], [3, 3, 3]))]),
      gobletAsk([100, 113], [goblet('g', 5, rows(100, [6, 6, 6], [1, 1, 1]))]),
      gobletAsk(
        [40, 50, 60],
        [15, 8, 2].map((d) => goblet(`v${String(d)}`, d, rows(50, [6, 6, 6], [1, 1, 1]))),
        { canVary: true },
      ),
    ]
    const workouts = [
      workoutFor(
        withSetup(
          { equipment: have('barbell') },
          {
            today: session.date,
            logs: [squat('a', 20, rows(110, [6, 6, 6, 6], [2, 2, 2, 2]))],
            readiness: {
              date: session.date,
              state: 'possible-fatigue',
              pain: null,
              illness: 'clear',
            },
          },
        ),
        session,
      ),
      ...(
        [
          { index: 6, flags: ['recovery'] },
          { index: 14, flags: [] },
          { index: 25, flags: ['taper'] },
        ] as const
      ).map(({ index, flags }) => {
        const s = sessionOf(index)
        const weeks = plan(30, 12).map((w, i) =>
          i === index ? { ...w, flags: [...w.flags, ...flags] } : w,
        )
        const logs = [
          log('k', addDays(s.date, -3), {
            sets: setsOf('back-squat', rows(110, [6, 6, 6, 6], [2, 2, 2, 2])),
          }),
        ]
        return workoutFor(
          withSetup({ equipment: have('barbell') }, { today: s.date, weeks, logs }),
          s,
        )
      }),
    ]
    return [
      ...factsOf(suggestions),
      ...workouts.flatMap((w) => w.lifts.flatMap((lift) => lift.basis.facts)),
    ]
  }

  it('reaches every reason template of the registry', () => {
    const used = new Set(reached().map((f) => f.template))
    const registered = Object.keys(STRENGTH_TEMPLATES).filter((id) =>
      id.startsWith('strength.reason.'),
    )
    expect([...used].filter((id) => id.startsWith('strength.reason.')).sort()).toEqual(
      registered.sort(),
    )
  })

  it('names only registered templates, with the slots each declares', () => {
    for (const fact of reached()) {
      const template = (STRENGTH_TEMPLATES as Record<string, Template | undefined>)[fact.template]
      expect(template, fact.template).toBeDefined()
      expect(Object.keys(fact.slots).sort(), fact.template).toEqual(
        Object.keys(template?.slots ?? {}).sort(),
      )
    }
  })

  it('renders every fact in both distance units and both weight units, clean and finished', () => {
    for (const fact of reached()) {
      for (const units of ['km', 'mi'] as const) {
        for (const weightUnit of ['lb', 'kg'] as const) {
          const text = renderFact(fact as never, units, weightUnit)
          expect(lintText(text), text).toEqual([])
          expect(text.length, text).toBeLessThanOrEqual(COPY_MAX_CHARS)
          expect(text, text).toMatch(/\.$/)
          expect(text, text).not.toMatch(/\{|\}|NaN|undefined|null|This could not be shown/)
        }
      }
    }
  })

  it('writes the same grams in the runner’s unit, so a change of unit reaches an old reason', () => {
    const cap = reached().find((f) => f.template === 'strength.reason.hold-step')
    expect(renderFact(cap as never, 'km', 'lb')).toContain('from 100 lb')
    expect(renderFact(cap as never, 'km', 'kg')).toContain('from 45.25 kg')
  })
})

describe('shared/engine/strength.ts', () => {
  const dir = join(import.meta.dirname, '../../../shared')

  /** The source with its comments removed, so a figure in a comment is not counted. */
  function code(name: string): string {
    return readFileSync(join(dir, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  }

  it('has no hard-coded value of the f7, f8 and f9 groups', () => {
    const values = new Set<number>()
    const collect = (value: unknown): void => {
      if (typeof value === 'number') values.add(value)
      else if (Array.isArray(value)) value.forEach(collect)
      else if (typeof value === 'object' && value !== null) Object.values(value).forEach(collect)
    }
    for (const group of [P.f7, P.f8, P.f9]) {
      for (const param of Object.values(group) as Array<{ value: unknown }>) collect(param.value)
    }
    // 0 and 1 are counting, not rules: the first, the next, the one before
    values.delete(0)
    values.delete(1)
    expect(values.size).toBeGreaterThan(20)
    const found: string[] = []
    for (const match of code('engine/strength.ts').matchAll(/(?<![\w$.])\d+(?:\.\d+)?(?![\w$])/g)) {
      if (values.has(Number(match[0]))) found.push(match[0])
    }
    expect(found).toEqual([])
  })

  it('has no figure inside a string of the strength copy', () => {
    const literals = [
      ...code('copy/strengthTemplates.ts').matchAll(
        /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
      ),
    ].map((match) => match[0])
    expect(literals.length).toBeGreaterThan(100)
    expect(literals.filter((literal) => /\d/.test(literal))).toEqual([])
  })

  it('reads no clock, does no I/O and imports nothing from Node', () => {
    const text = code('engine/strength.ts')
    expect(text).not.toMatch(/\bDate\b|Math\.random|performance\.now|\bprocess\b|\bfetch\(/)
    expect(text).not.toMatch(/\bnode:|\brequire\(|\bfs\b|\bsetTimeout\b|\bawait\b|\basync\b/)
  })

  it('imports the registry, the catalogue, the weight helpers, the block counter and types only', () => {
    const imports = [...code('engine/strength.ts').matchAll(/from '([^']+)'/g)]
      .map((m) => m[1] ?? '')
      .sort()
    expect(imports).toEqual(
      [
        '../copy/quantity.ts',
        '../copy/strengthTemplates.ts',
        '../dates.ts',
        '../domain/strengthLibrary.ts',
        '../domain/weight.ts',
        '../types.ts',
        './macro.ts',
        './params/index.ts',
        './types.ts',
      ].sort(),
    )
  })

  it('counts the block with the one counter and writes no second', () => {
    const text = code('engine/strength.ts')
    expect(text).toContain('strengthBlockPosition(')
    expect(text).not.toMatch(/strength-block/)
  })
})

describe('every function of the engine leaves a frozen context alone', () => {
  it('reads a deep-frozen snapshot without writing to it', () => {
    const session = sessionOf(7)
    const logs = [
      log('a', addDays(session.date, -10), {
        sets: setsOf('back-squat', rows(105, [6, 6, 6, 6], [2, 2, 2, 2])),
      }),
      log('b', addDays(session.date, -3), {
        sets: setsOf('goblet-squat', rows(40, [5, 5, 5], [null, null, null])),
      }),
    ]
    const ctx = withSetup(
      { equipment: have(...ALL_KINDS), pinned: { calf: 'seated-calf-raise' }, avoid: ['pogo-hop'] },
      {
        today: session.date,
        logs,
        anchors: [
          {
            exerciseId: 'leg-press',
            kind: 'max',
            loadG: lb(300),
            reps: 1,
            rir: null,
            asOf: ago(40),
          },
        ],
        readiness: { date: session.date, state: 'possible-fatigue', pain: 5, illness: 'easy-only' },
      },
    )
    const frozen = deepFreeze(structuredClone(ctx))
    expect(() => {
      blockPosition(frozen, monday(7))
      rampInWeeks(frozen, monday(7))
      sessionVariant(frozen, session)
      for (const slot of ['knee', 'hip', 'calf'] as const) pickLift(slot, frozen)
      waysFor(frozen, 'goblet-squat')
      workoutFor(frozen, session)
      workoutFor(frozen, sessionOf(7, 1))
      liftFor(frozen, session, 'step-up')
      summariseHistory(frozen)
      suggestLoad(frozen, {
        exerciseId: 'back-squat',
        implement: 'barbell',
        date: session.date,
        ...structuresFor('heavy', 'lead', 8),
      })
    }).not.toThrow()
    // and the answer is the one the unfrozen context gives
    expect(workoutFor(frozen, session)).toEqual(workoutFor(ctx, session))
    expect(summariseHistory(frozen)).toEqual(summariseHistory(ctx))
  })
})

describe('workoutFor: a harder movement that has stalled as well (rule F8.7)', () => {
  it('passes on along the links and carries every reason for the move', () => {
    const session = sessionOf(8)
    const equipment = [dumbbellsOf(30, 35, 50, 60), ITEM.step]
    const stuck = (exerciseId: string, tag: string, daysAgo: number[]) =>
      daysAgo.map((d) =>
        log(`${tag}${String(d)}`, addDays(session.date, -d), {
          sets: setsOf(exerciseId, rows(50, [6, 6, 6, 6], [1, 1, 1, 1])),
        }),
      )
    const logs = [
      ...stuck('goblet-squat', 'g', [14, 12, 10]),
      ...stuck('split-squat', 's', [8, 6, 3]),
    ]
    const knee = workoutFor(withSetup({ equipment }, { today: session.date, logs }), session)
      .lifts[0]
    // goblet squat to split squat to step-up, each after three sessions at the top with no usable step
    expect(knee).toMatchObject({ exerciseId: 'step-up', slot: 'knee', change: 'variation' })
    expect(knee?.basis.facts.map((f) => f.template)).toEqual([
      'strength.reason.variation',
      'strength.reason.variation',
      'strength.reason.start-lightest',
    ])
    expect(knee?.basis.facts.map((f) => f.slots['next'] ?? null)).toEqual([
      'Split squat',
      'Step-up',
      null,
    ])
  })
})

describe('a running recovery week inside the ramp-in (rule F7)', () => {
  const index = 1 // block week 2 of 3
  const recoveryWeeks = plan(30, 12).map((w, i) =>
    i === index ? { ...w, flags: [...w.flags, 'recovery'] } : w,
  )
  const session = sessionOf(index)
  const seasoned = (pounds: number) =>
    log('seed', addDays(session.date, -4), {
      sets: [
        ...setsOf('goblet-squat', rows(pounds, [6, 6, 6], [3, 3, 3])),
        ...setsOf('dumbbell-rdl', rows(pounds, [6, 6, 6], [3, 3, 3]), 10),
        ...setsOf('standing-calf-raise', rows(pounds, [6, 6, 6], [3, 3, 3]), 20),
      ],
    })
  const run = (weeks: StrengthWeek[], kinds: EquipmentKind[] = ['barbell', 'dumbbells']) =>
    workoutFor(
      withSetup(
        { equipment: have(...kinds) },
        { today: session.date, weeks, logs: [seasoned(40)] },
      ),
      session,
    )

  it('stays a ramp-in: 6 to 8 reps leaving 3, no barbell, with the sets of a recovery week', () => {
    const workout = run(recoveryWeeks)
    expect(workout.template).toBe('ramp-in')
    expect(workout.block).toEqual({ week: 2, of: 12, rampInWeeks: 3 })
    expect(workout.lifts.map((lift) => lift.exerciseId)).toEqual([
      'goblet-squat',
      'dumbbell-rdl',
      'standing-calf-raise',
    ])
    for (const lift of workout.lifts) {
      expect(lift.implement, lift.exerciseId).not.toBe('barbell')
      expect(lift.range).toEqual({ min: 6, max: 8 })
      expect(lift.rir).toEqual({ min: P.f7.easyRir.value, max: P.f7.easyRir.value })
      expect(lift.sets).toBe(P.f7.maintenanceSets.value)
    }
    // the same week without the flag has the sets of a later ramp-in week
    const usual = run(plan(30, 12))
    expect(usual.lifts.map((lift) => lift.sets)).toEqual([3, 3, 3])
  })

  it('keeps the load, halves the jumps, and is logged as a lighter week', () => {
    const workout = run(recoveryWeeks)
    // every set was at the bottom of the range, so the usual week would hold: the load is the same
    expect(workout.lifts.map((lift) => lift.loadG)).toEqual([lb(40), lb(40), lb(40)])
    expect(workout.plyo).toEqual({
      contacts: Math.round(P.f7.plyoStartContacts.value * P.f7.reducedPlyoShare.value),
      movements: ['pogo-hop'],
    })
    expect(modeOf(workout)).toBe('lighter-week')
    // a load that would have risen is kept in a recovery week
    const risen = withSetup(
      { equipment: have('dumbbells') },
      {
        today: session.date,
        weeks: recoveryWeeks,
        logs: [
          log('top', addDays(session.date, -4), {
            sets: setsOf('goblet-squat', rows(40, [8, 8, 8], [3, 3, 3])),
          }),
        ],
      },
    )
    const knee = workoutFor(risen, session).lifts[0]
    expect(knee).toMatchObject({ exerciseId: 'goblet-squat', loadG: lb(40), change: 'hold' })
    expect(knee?.basis.facts.map((f) => f.template)).toEqual(['strength.reason.lighter-week'])
  })

  it('gives a runner with a bar the bodyweight lifts of the ramp-in, not the squat', () => {
    const workout = run(recoveryWeeks, ['barbell'])
    expect(workout.template).toBe('ramp-in')
    expect(workout.lifts.map((lift) => lift.exerciseId)).toEqual([
      'tempo-squat',
      'hip-thrust',
      'standing-calf-raise',
    ])
    expect(workout.lifts.every((lift) => lift.implement !== 'barbell')).toBe(true)
  })

  it('lets the barbell in from the first week after the ramp-in, recovery week or not', () => {
    const after = sessionOf(3)
    const weeks = plan(30, 12).map((w, i) =>
      i === 3 ? { ...w, flags: [...w.flags, 'recovery'] } : w,
    )
    const ctx = withSetup({ equipment: have('barbell') }, { today: after.date, weeks })
    const workout = workoutFor(ctx, after)
    expect(workout.template).toBe('lighter-week')
    expect(workout.lifts[0]?.implement).toBe('barbell')
  })

  it('decides the barbell by the place in the block as well as by the template', () => {
    const inside = { week: 2, of: 12, rampInWeeks: 3 }
    const outside = { week: 4, of: 12, rampInWeeks: 3 }
    expect(barbellAllowed('lighter-week', inside)).toBe(false)
    expect(barbellAllowed('heavy', inside)).toBe(false)
    expect(barbellAllowed('lighter-week', outside)).toBe(true)
    expect(barbellAllowed('heavy', outside)).toBe(true)
    expect(barbellAllowed('lighter-week', null)).toBe(true)
    expect(barbellAllowed('ramp-in', null)).toBe(false)
    expect(barbellAllowed('return', outside)).toBe(false)
    // a regenerate that skipped the ramp-in has no weeks inside it
    expect(barbellAllowed('heavy', { week: 1, of: 12, rampInWeeks: 0 })).toBe(true)
  })

  it('names the ramp-in template for the first weeks whatever the recovery flag', () => {
    const inBlock = (week: number): BlockPosition => ({ week, of: 12, rampInWeeks: 3 })
    const flagged = { flags: ['strength-block', 'recovery'], phase: 'base', isRecovery: true }
    expect(strengthTemplate(flagged, inBlock(1))).toBe('ramp-in')
    expect(strengthTemplate(flagged, inBlock(3))).toBe('ramp-in')
    expect(strengthTemplate(flagged, inBlock(4))).toBe('lighter-week')
    expect(strengthTemplate(flagged, null)).toBe('maintenance')
  })
})

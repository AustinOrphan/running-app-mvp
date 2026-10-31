import { describe, expect, test } from 'vitest'
import { lintText } from '../../shared/copy/lint.ts'
import { COPY_MAX_CHARS } from '../../shared/copy/limits.ts'
import type { Units, WeightUnit } from '../../shared/types.ts'
import { blocksOf, withUsualLoad } from '../../web/components/strength/strengthForm.ts'
import {
  WORKOUT_ROWS_MAX,
  minutesPhrase,
  usualLoadOf,
  workoutRows,
} from '../../web/components/strength/workoutRows.ts'
import {
  bodyweightWorkout,
  calf,
  engineWorkout,
  lb,
  lighterDayWorkout,
  lightestRungWorkout,
  makeWorkout,
  plank,
  rdl,
  squat,
} from './strength-fixtures.ts'

// The rows of a workout are what the Today hero and the session sheet say about it (design 11.1,
// 11.2). `tests/unit/engine/strengthSurfaces.test.ts` reads the lift rows back against the engine's
// workouts; this file holds what that test does not: the order, the cap of five, the jumps and the
// trunk movements, the usual load and the plain sentences of a row.

const texts = (rows: ReturnType<typeof workoutRows>) => rows.map((row) => row.text)

describe('workoutRows', () => {
  test('lists the lifts, then the jumps, then the trunk movements as one row each', () => {
    const rows = workoutRows(makeWorkout(), 'mi', 'lb')
    expect(texts(rows)).toEqual([
      'Back squat: 4 x 3 to 6, 110 lb, leave 1 to 3.',
      'Dumbbell Romanian deadlift: 3 x 3 to 6, 40 lb, leave 2 or more.',
      'Standing calf raise: 3 x 8 to 15, leave 1 to 3.',
      'Pogo hops, 40 contacts.',
      'Side plank, 2 sets.',
    ])
    expect(rows.map((row) => row.key)).toEqual([
      'lift-back-squat',
      'lift-dumbbell-rdl',
      'lift-standing-calf-raise',
      'plyo',
      'trunk',
    ])
    // a lift row says which exercise and rule it is, so a surface can ask why; the others do not
    expect(rows.map((row) => [row.exerciseId, row.rule])).toEqual([
      ['back-squat', 'F8'],
      ['dumbbell-rdl', 'F8'],
      ['standing-calf-raise', 'F8'],
      [null, null],
      [null, null],
    ])
  })

  test('reads a load in the weight unit and leaves the distance unit out of it', () => {
    const pounds = workoutRows(makeWorkout(), 'km', 'lb')[0]?.text
    const kilograms = workoutRows(makeWorkout(), 'mi', 'kg')[0]?.text
    expect(pounds).toBe('Back squat: 4 x 3 to 6, 110 lb, leave 1 to 3.')
    expect(kilograms).toBe('Back squat: 4 x 3 to 6, 50 kg, leave 1 to 3.')
  })

  test('has no load part for a bodyweight lift, and none of the other rows without a dose or trunk work', () => {
    const rows = workoutRows(bodyweightWorkout(), 'km', 'lb')
    expect(texts(rows)).toEqual([
      'Tempo squat: 3 x 8 to 15, leave 1 to 3.',
      'Hip thrust (glute bridge): 3 x 8 to 15, leave 1 to 3.',
      'Standing calf raise: 3 x 8 to 15, leave 1 to 3.',
    ])
  })

  test('names several jump movements and several trunk movements in one row each', () => {
    const workout = makeWorkout({
      plyo: { contacts: 60, movements: ['pogo-hop', 'line-hop'] },
      trunk: [plank(), plank({ exerciseId: 'dead-bug' }), plank({ exerciseId: 'pallof-press' })],
    })
    expect(texts(workoutRows(workout, 'km', 'lb')).slice(-2)).toEqual([
      'Pogo hops and line hops, 60 contacts.',
      'Side plank, dead bug and pallof press, 2 sets.',
    ])
  })

  test(`is never more than ${String(WORKOUT_ROWS_MAX)} rows: a lift gives way to the jumps and the trunk work`, () => {
    const lifts = [
      squat(),
      rdl(),
      rdl({ exerciseId: 'goblet-squat', slot: 'knee' }),
      calf(),
      calf({ exerciseId: 'single-leg-calf-raise' }),
    ]
    const full = workoutRows(makeWorkout({ lifts }), 'km', 'lb')
    expect(full).toHaveLength(WORKOUT_ROWS_MAX)
    expect(full.slice(-2).map((row) => row.key)).toEqual(['plyo', 'trunk'])
    expect(full.slice(0, 3).map((row) => row.exerciseId)).toEqual([
      'back-squat',
      'dumbbell-rdl',
      'goblet-squat',
    ])
    // without the jumps there is room for one more lift
    const noJumps = workoutRows(makeWorkout({ lifts, plyo: null }), 'km', 'lb')
    expect(noJumps).toHaveLength(WORKOUT_ROWS_MAX)
    expect(noJumps.map((row) => row.key).at(-1)).toBe('trunk')
    expect(noJumps.filter((row) => row.exerciseId !== null)).toHaveLength(4)
    // and with neither, five lifts
    const only = workoutRows(makeWorkout({ lifts, plyo: null, trunk: [] }), 'km', 'lb')
    expect(only.filter((row) => row.exerciseId !== null)).toHaveLength(5)
  })

  test('shows the usual load of a lighter day only when asked, and only for the lifts that have one', () => {
    const lighter = lighterDayWorkout()
    expect(texts(workoutRows(lighter, 'km', 'lb'))).toEqual([
      'Back squat: 3 x 3 to 6, 100 lb, leave 1 to 3.',
      'Dumbbell Romanian deadlift: 2 x 3 to 6, 40 lb, leave 2 or more.',
    ])
    expect(texts(workoutRows(lighter, 'km', 'lb', { usual: true }))).toEqual([
      // the set count is still the lighter day's: only the load is the usual one
      'Back squat: 3 x 3 to 6, 110 lb, leave 1 to 3.',
      'Dumbbell Romanian deadlift: 2 x 3 to 6, 40 lb, leave 2 or more.',
    ])
    // the workout it was given is not touched
    expect(lighter.lifts[0]?.loadG).toBe(lb(100))
    expect(lighter.lifts[0]?.usualLoadG).toBe(lb(110))
  })

  test('words a lift with no effort target as the trunk movements are worded', () => {
    const workout = makeWorkout({ lifts: [plank({ exerciseId: 'farmer-carry' })], trunk: [] })
    expect(texts(workoutRows(workout, 'km', 'lb'))[0]).toBe('Farmer carry, 2 sets.')
  })

  test('says nothing of the estimated maximum, whatever the lift read for it', () => {
    const workout = makeWorkout({
      lifts: [squat({ evidence: { latest: null, judged: null, estimateG: 90_000 } })],
    })
    const all = texts(workoutRows(workout, 'km', 'lb')).join(' ')
    expect(all).not.toMatch(/maximum|estimate|%|1RM/i)
  })

  describe.each([
    ['ramp-in', 0],
    ['heavy A', 1],
  ] as const)('the rows of the engine workout, %s', (_name, variant) => {
    const workout = engineWorkout(variant === 0 ? 0 : 1)
    for (const units of ['km', 'mi'] as const satisfies readonly Units[]) {
      for (const weightUnit of ['lb', 'kg'] as const satisfies readonly WeightUnit[]) {
        test(`are short, clean sentences (${units}, ${weightUnit})`, () => {
          const rows = workoutRows(workout, units, weightUnit)
          expect(rows.length).toBeGreaterThan(0)
          expect(rows.length).toBeLessThanOrEqual(WORKOUT_ROWS_MAX)
          for (const row of rows) {
            expect(lintText(row.text), row.text).toEqual([])
            expect(row.text.length, row.text).toBeLessThanOrEqual(COPY_MAX_CHARS)
            expect(row.text, row.text).toMatch(/\.$/)
            expect(row.text, row.text).not.toMatch(/NaN|undefined|null|\{|\}/)
          }
        })
      }
    }
  })
})

// The engine keeps the load it started from in `usualLoadG` whenever a lighter day changed anything,
// so a cut that took sets and no load (a lift already at the lightest load the equipment makes) has
// `usualLoadG` equal to `loadG`. This is the engine's own output for that day, not a hand-made one.
describe('a lighter day with no load to lower', () => {
  const workout = lightestRungWorkout()

  test('is what the engine derives at the lightest rung: lighter-day lifts whose usual load is their load', () => {
    expect(workout.lifts.length).toBeGreaterThan(0)
    for (const lift of workout.lifts) {
      expect(lift.change, lift.exerciseId).toBe('lighter-day')
      expect(lift.loadG, lift.exerciseId).toBe(lb(10))
      expect(lift.usualLoadG, lift.exerciseId).toBe(lift.loadG)
    }
  })

  test('offers no usual load for any lift, and the rows do not change when it is asked for', () => {
    for (const lift of workout.lifts) expect(usualLoadOf(lift), lift.exerciseId).toBeNull()
    expect(texts(workoutRows(workout, 'km', 'lb', { usual: true }))).toEqual(
      texts(workoutRows(workout, 'km', 'lb')),
    )
  })

  test('leaves the sheet as it was when the usual load is taken', () => {
    for (const block of blocksOf(workout, 'lb')) {
      expect(withUsualLoad(block, 'lb'), block.key).toBe(block)
    }
  })

  test('a lift that did lower its load has one', () => {
    const [lowered] = lighterDayWorkout().lifts
    expect(lowered && usualLoadOf(lowered)).toBe(lb(110))
    expect(usualLoadOf({ loadG: null, usualLoadG: null })).toBeNull()
  })
})

describe('minutesPhrase', () => {
  test('is the planned time in words, for an accessible name', () => {
    expect(minutesPhrase(40)).toBe('40 minutes')
    expect(minutesPhrase(25)).toBe('25 minutes')
    expect(minutesPhrase(1)).toBe('one minute')
    expect(minutesPhrase(10)).toBe('ten minutes')
  })
})

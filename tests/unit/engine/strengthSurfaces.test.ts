// The cross-surface workout test [design 5.1, 13]. Every place that shows a strength session reads
// it from the one `StrengthWorkout` that `workoutFor` derives, so the lifts, the sets, the loads and
// the efforts are the same everywhere. Each surface registers one adapter in `SURFACES` below: it
// renders the workout the way the surface does and reads the figures back out of that rendering.
// The test runs every adapter over a set of workouts (a ramp-in, a heavy week, a lighter day, the
// taper, a bodyweight runner, a runner in kilograms), in both distance units and both weight units,
// and compares what comes back with the workout. A second implementation of the rules, or a number
// typed into a surface, fails here.
//
// Registered now:  the workout rows of the Today hero and the session sheet (E14-8, `workoutRows`,
// the real builder), the logging sheet of "As suggested" (E14-7, the real builder and the line it
// shows) and the snapshot a log stores (E14-5).
// To add one: write a `SurfaceAdapter` whose `read` renders from the workout (or from the shared
// builder that reads it) and parses the figures back, then append it to `SURFACES`.
import { describe, expect, it } from 'vitest'
import {
  STRENGTH_TEMPLATES,
  type StrengthTemplateId,
} from '../../../shared/copy/strengthTemplates.ts'
import { render, type Template } from '../../../shared/copy/template.ts'
import { addDays } from '../../../shared/dates.ts'
import { formatLoad } from '../../../shared/domain/weight.ts'
import { modeOf, workoutFor } from '../../../shared/engine/strength.ts'
import type { Quantity, StrengthContext } from '../../../shared/engine/types.ts'
import type { StrengthWorkout, Units, WeightUnit, WorkoutLift } from '../../../shared/types.ts'
import { asSuggested, blocksOf } from '../../../web/components/strength/strengthForm.ts'
import { strengthWords } from '../../../web/components/strength/strengthText.ts'
import { workoutRows } from '../../../web/components/strength/workoutRows.ts'
import {
  have,
  lb,
  log,
  plan,
  sessionRef,
  setsOf,
  withSetup,
  type Row,
} from './strength-fixtures.ts'

/** What every surface shows of a lift, in the runner's units. */
interface SurfaceLift {
  exercise: string
  sets: number
  lo: number
  hi: number
  /** "115 lb", "52.25 kg", or null for a movement with no added load. */
  load: string | null
  rirLo: number | null
  rirHi: number | null
  /** The count to aim at in each set. */
  targets: number[]
}

interface SurfaceAdapter {
  name: string
  /** The lifts the surface shows, in the order it shows them, read back from its rendering. */
  read(workout: StrengthWorkout, units: Units, weightUnit: WeightUnit): SurfaceLift[]
}

const say = (
  id: StrengthTemplateId,
  slots: Record<string, Quantity | string>,
  units: Units,
  weightUnit: WeightUnit,
): string => render(STRENGTH_TEMPLATES[id] as Template, slots as never, units, weightUnit)

const nameOf = (id: string): string => {
  const key = `strength.name.${id}` as StrengthTemplateId
  return STRENGTH_TEMPLATES[key].text
}
const count = (n: number): Quantity => ({ kind: 'count', n })

// ---- the Today hero: one row a lift, in the sentences of design 11.6 ------------------------------

// A range of reps left reads "leave 1 to 3"; an easy template asks for the same count in every set,
// and a range "2 to 2" reads "leave 2 or more" (E14-6).
const ROW = /^(.+): (\d+) x (\d+) to (\d+), (?:(.+), )?leave (?:(\d+) to (\d+)|(\d+) or more)\.$/

/**
 * The Today hero as E14-8 builds it (`workoutRows`, also the rows of the session sheet's Strength
 * section): the lift rows, read back out of the sentences the hero shows. The jumps and the trunk
 * movements are rows of their own, which `tests/web/workout-rows.test.ts` reads.
 */
const hero: SurfaceAdapter = {
  name: 'Today hero',
  read(workout, units, weightUnit) {
    const rows = workoutRows(workout, units, weightUnit).filter((row) => row.exerciseId !== null)
    expect(rows.length).toBe(workout.lifts.length)
    return rows.map((row, index) => {
      const lift = workout.lifts[index] as WorkoutLift
      const match = ROW.exec(row.text)
      expect(match, row.text).not.toBeNull()
      const [, exercise, sets, lo, hi, load, rirLo, rirHi, rirMin] = match ?? []
      return {
        exercise: exercise ?? '',
        sets: Number(sets),
        lo: Number(lo),
        hi: Number(hi),
        load: load ?? null,
        rirLo: Number(rirLo ?? rirMin),
        rirHi: Number(rirHi ?? rirMin),
        // the hero names the range and the sets; the aim of each set is the sheet's
        targets: lift.targets,
      }
    })
  },
}

// ---- the sheet: the one-line suggestion, and the sets "As suggested" fills ------------------------

// The suggestion line of a lift in the sheet: "Suggested 110 lb, four sets of 3 to 6 reps, leave 1 to 3
// in reserve." A lift with no load has no load part and one with no effort target no effort part;
// an easy template reads "leave 2 or more in reserve", and a count that does not vary one number.
const SUGGESTION =
  /^Suggested (?:(.+?), )?(\w+) sets? of (\d+)(?: to (\d+))? (?:reps|seconds|contacts)(?:, leave (\d+)(?: to (\d+))?(?: or more)? in reserve)?\.$/
const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]

/**
 * The sheet as E14-7 builds it (`web/components/strength/`): `blocksOf` fills each lift from the
 * workout and `asSuggested` puts the load, the target and the lowest reps left in every set. The
 * figures are read back from the suggestion line it shows and from the sets it holds.
 */
const sheet: SurfaceAdapter = {
  name: 'logging sheet',
  read(workout, units, weightUnit) {
    const words = strengthWords(units, weightUnit)
    return asSuggested(blocksOf(workout, weightUnit), weightUnit)
      .filter((block) => block.kind === 'lift')
      .map((block) => {
        const lift = block.shown
        const line = words.suggestion(lift)
        const match = SUGGESTION.exec(line)
        expect(match, line).not.toBeNull()
        const [, load, sets, lo, hi, rirLo, rirHi] = match ?? []
        const first = block.rows[0]
        // the sets the sheet holds carry the load the line states, in the field's own text
        expect(first?.load === '' ? null : `${first?.load ?? ''} ${weightUnit}`, line).toBe(
          load ?? null,
        )
        // the line names as many sets as the sheet holds
        const spoken = NUMBER_WORDS.indexOf(sets ?? '')
        expect(block.rows.length, line).toBe(spoken)
        return {
          exercise: words.name(lift.exerciseId),
          sets: spoken,
          lo: Number(lo),
          hi: Number(hi ?? lo),
          load: load ?? null,
          rirLo: first?.rir ?? null,
          rirHi: rirHi === undefined ? (rirLo === undefined ? null : Number(rirLo)) : Number(rirHi),
          targets: block.rows.map((row) => Number(row.count)),
        }
      })
  },
}

// ---- the snapshot a log stores (design 9.3): what was shown, as JSON ------------------------------

interface Snapshot {
  template: string
  variant: string
  week: number | null
  mode: string
  lifts: Array<{
    exerciseId: string
    implement: string | null
    sets: number
    range: { min: number; max: number }
    rir: { min: number; max: number } | null
    targets: number[]
    baseLoadG: number | null
    shownLoadG: number | null
    change: string
  }>
}

/** The snapshot of the workout the sheet showed: the load the rules asked for and the one shown. */
function snapshotOf(workout: StrengthWorkout): Snapshot {
  return {
    template: workout.template,
    variant: workout.variant,
    week: workout.block?.week ?? null,
    mode: modeOf(workout),
    lifts: workout.lifts.map((lift) => ({
      exerciseId: lift.exerciseId,
      implement: lift.implement,
      sets: lift.sets,
      range: lift.range,
      rir: lift.rir,
      targets: lift.targets,
      baseLoadG: lift.usualLoadG ?? lift.loadG,
      shownLoadG: lift.loadG,
      change: lift.change,
    })),
  }
}

const snapshot: SurfaceAdapter = {
  name: 'log snapshot',
  read(workout, _units, weightUnit) {
    const stored = JSON.parse(JSON.stringify(snapshotOf(workout))) as Snapshot
    return stored.lifts.map((lift) => ({
      exercise: nameOf(lift.exerciseId),
      sets: lift.sets,
      lo: lift.range.min,
      hi: lift.range.max,
      load: lift.shownLoadG === null ? null : formatLoad(lift.shownLoadG, weightUnit),
      rirLo: lift.rir?.min ?? null,
      rirHi: lift.rir?.max ?? null,
      targets: lift.targets,
    }))
  },
}

const SURFACES: SurfaceAdapter[] = [hero, sheet, snapshot]

// ---- the workouts ----------------------------------------------------------------------------------

function squatLogs(at: string): ReturnType<typeof log>[] {
  const rows = (pounds: number, counts: number[], rirs: number[]): Row[] =>
    counts.map((c, i) => [pounds, c, rirs[i] ?? null] as const)
  return [
    log('seed', at, {
      sets: [
        ...setsOf('back-squat', rows(110, [6, 6, 6, 6], [2, 2, 1, 1])),
        ...setsOf('romanian-deadlift', rows(95, [6, 6, 6], [2, 2, 2]), 10),
        ...setsOf('standing-calf-raise', rows(80, [6, 6, 6], [2, 2, 2]), 20),
      ],
    }),
  ]
}

interface Case {
  name: string
  workout: StrengthWorkout
  weightUnit: WeightUnit
}

function cases(): Case[] {
  const heavy = sessionRef(5)
  const bar = withSetup(
    { equipment: have('barbell', 'dumbbells', 'bands') },
    { today: heavy.date, logs: squatLogs(addDays(heavy.date, -3)) },
  )
  const out: Array<[string, StrengthContext, ReturnType<typeof sessionRef>, WeightUnit]> = [
    [
      'ramp-in on dumbbells',
      withSetup({ equipment: have('dumbbells', 'step') }, { today: sessionRef(1).date }),
      sessionRef(1),
      'lb',
    ],
    ['heavy week on a bar', bar, heavy, 'lb'],
    ['heavy week B on a bar, in kilograms', { ...bar, weightUnit: 'kg' }, sessionRef(5, 1), 'kg'],
    [
      'lighter day',
      {
        ...bar,
        readiness: { date: heavy.date, state: 'possible-fatigue', pain: null, illness: 'clear' },
      },
      heavy,
      'lb',
    ],
    [
      'bodyweight only',
      withSetup({ saved: false }, { today: sessionRef(1).date }),
      sessionRef(1),
      'lb',
    ],
    [
      'taper',
      withSetup(
        { equipment: have('barbell') },
        {
          today: sessionRef(25).date,
          weeks: plan(30, 12).map((w, i) => (i === 25 ? { ...w, flags: ['taper'] } : w)),
        },
      ),
      sessionRef(25, 0, { durationMin: 25 }),
      'lb',
    ],
    [
      'maintenance with machines',
      withSetup(
        { equipment: have('leg-press', 'leg-curl', 'calf-machine') },
        { today: sessionRef(14).date },
      ),
      sessionRef(14, 0, { durationMin: 25 }),
      'kg',
    ],
  ]
  return out.map(([name, ctx, session, weightUnit]) => ({
    name,
    workout: workoutFor({ ...ctx, weightUnit }, session),
    weightUnit,
  }))
}

/** What the workout says, read straight from its lifts, with the load shown the way the app shows it. */
function expected(lift: WorkoutLift, weightUnit: WeightUnit): SurfaceLift {
  return {
    exercise: nameOf(lift.exerciseId),
    sets: lift.sets,
    lo: lift.range.min,
    hi: lift.range.max,
    load: lift.loadG === null ? null : formatLoad(lift.loadG, weightUnit),
    rirLo: lift.rir?.min ?? null,
    rirHi: lift.rir?.max ?? null,
    targets: lift.targets,
  }
}

describe('one workout on every surface', () => {
  const all = cases()

  it('reads an easy template as "leave n or more", and a range of reps left as a range', () => {
    const rows = all.flatMap((c) => c.workout.lifts.map((lift) => lift.rir))
    expect(rows.some((rir) => rir !== null && rir.min === rir.max)).toBe(true)
    expect(rows.some((rir) => rir !== null && rir.min !== rir.max)).toBe(true)
    const ramp = all.find((c) => c.name === 'ramp-in on dumbbells')?.workout.lifts[0]
    expect(ramp?.rir?.min).toBe(ramp?.rir?.max)
    expect(
      say(
        'strength.hero.workout-row-leave-min',
        {
          exercise: 'Goblet squat',
          sets: count(3),
          lo: count(6),
          hi: count(8),
          load: { kind: 'load', g: lb(25) },
          rir: count(2),
        },
        'km',
        'lb',
      ),
    ).toBe('Goblet squat: 3 x 6 to 8, 25 lb, leave 2 or more.')
    expect(
      say(
        'strength.hero.workout-row-bodyweight-leave-min',
        { exercise: 'Split squat', sets: count(2), lo: count(6), hi: count(8), rir: count(2) },
        'mi',
        'kg',
      ),
    ).toBe('Split squat: 2 x 6 to 8, leave 2 or more.')
  })

  it('registers the surfaces that show a workout today', () => {
    expect(SURFACES.map((s) => s.name)).toEqual(['Today hero', 'logging sheet', 'log snapshot'])
  })

  it('has workouts to read: lifts in each, a load on most, and a bodyweight one without', () => {
    expect(all).toHaveLength(7)
    for (const c of all) expect(c.workout.lifts.length, c.name).toBeGreaterThan(0)
    expect(all.some((c) => c.workout.lifts.some((l) => l.loadG !== null))).toBe(true)
    expect(
      all.find((c) => c.name === 'bodyweight only')?.workout.lifts.every((l) => l.loadG === null),
    ).toBe(true)
    expect(all.some((c) => c.workout.lifts.some((l) => l.change === 'lighter-day'))).toBe(true)
  })

  for (const surface of SURFACES) {
    describe(surface.name, () => {
      for (const c of all) {
        for (const units of ['km', 'mi'] as const) {
          it(`shows the lifts, sets, loads and efforts of the ${c.name} (${units})`, () => {
            const read = surface.read(c.workout, units, c.weightUnit)
            expect(read).toEqual(c.workout.lifts.map((lift) => expected(lift, c.weightUnit)))
          })
        }
      }

      it('shows the same load in either weight unit from the same grams', () => {
        const bar = all.find((c) => c.name === 'heavy week on a bar')
        expect(bar).toBeDefined()
        const inPounds = surface.read(bar?.workout as StrengthWorkout, 'km', 'lb')
        const inKilos = surface.read(bar?.workout as StrengthWorkout, 'km', 'kg')
        expect(inPounds[0]?.load).toBe(formatLoad(lb(115), 'lb'))
        expect(inKilos[0]?.load).toBe(formatLoad(lb(115), 'kg'))
        // everything else is the same figure in either
        expect(inPounds.map(({ load: _a, ...rest }) => rest)).toEqual(
          inKilos.map(({ load: _b, ...rest }) => rest),
        )
      })
    })
  }

  it('shows the same lifts, sets, loads and efforts on every surface', () => {
    for (const c of all) {
      const reads = SURFACES.map((s) => s.read(c.workout, 'km', c.weightUnit))
      for (const read of reads.slice(1)) expect(read, c.name).toEqual(reads[0])
    }
  })

  it('shows a lighter day with the usual load kept for the tap that restores it', () => {
    const day = all.find((c) => c.name === 'lighter day')?.workout
    const usual = all.find((c) => c.name === 'heavy week on a bar')?.workout
    expect(day?.lifts.map((l) => l.usualLoadG)).toEqual(usual?.lifts.map((l) => l.loadG))
    const stored = snapshotOf(day as StrengthWorkout)
    // the snapshot keeps the load the rules asked for, apart from the one shown
    expect(stored.mode).toBe('lighter-day')
    expect(stored.lifts.map((l) => l.baseLoadG)).toEqual(usual?.lifts.map((l) => l.loadG))
    expect(stored.lifts[0]?.shownLoadG).toBeLessThan(stored.lifts[0]?.baseLoadG ?? 0)
  })

  it('is the same workout on every read of the same inputs', () => {
    const again = cases()
    expect(again.map((c) => c.workout)).toEqual(all.map((c) => c.workout))
  })

  it('names the week of the block in the snapshot and none outside it', () => {
    expect(snapshotOf(all[1]?.workout as StrengthWorkout).week).toBe(6)
    expect(
      snapshotOf(
        all.find((c) => c.name === 'maintenance with machines')?.workout as StrengthWorkout,
      ).week,
    ).toBeNull()
  })
})

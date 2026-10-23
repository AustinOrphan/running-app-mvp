import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FitEncoder, FitMessageReaderError, readFitMessages } from 'fit-file-parser'
import { describe, expect, it } from 'vitest'
import { P } from '../../../shared/engine/params/index.ts'
import { easedSession } from '../../../shared/engine/readiness.ts'
import { prescribe, type PrescribeContext } from '../../../shared/engine/sessions.ts'
import { rungSessions, sessionMin } from '../../../shared/engine/startWeeks.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type { SessionKind, SessionSpec, ZoneSet } from '../../../shared/engine/types.ts'
import { PUBLIC_TITLES, publishable } from '../../../shared/workouts/labels.ts'
import { toWorkoutPlan } from '../../../shared/workouts/plan.ts'
import type {
  StepIntent,
  StepTarget,
  WorkoutPlan,
  WorkoutStep,
} from '../../../shared/workouts/types.ts'
import {
  encodeWorkoutFit,
  fitText,
  FIT_NAME_MAX_BYTES,
  FIT_NOTES_MAX_BYTES,
  type WorkoutFitOptions,
} from '../../../server/services/workoutFit.ts'
import {
  expandWorkout,
  readWorkout,
  type ExpandedStep,
  type ReadTarget,
} from '../../fixtures/fit/readWorkout.ts'
import {
  EASY_RUN,
  GOLDEN_OPTIONS,
  GOLDEN_WORKOUTS,
  INTERVALS,
  LONG_RUN,
} from '../../fixtures/fit/workouts/plans.ts'
import { SESSION_KINDS, weekFixture, zoneSetFixture } from '../engine/fixtures.ts'

const zones = zoneSetFixture()
const CREATED = new Date('2026-07-10T06:30:00Z')
const OPTIONS = { createdAt: CREATED, serial: 1234 }
const PUBLISHABLE = SESSION_KINDS.filter(publishable)
const MINUTES = [30, 60, 120]

function make(
  kind: SessionKind,
  minutes: number,
  ctx: PrescribeContext = { goalPaceSecPerKm: 330 },
  flags: string[] = [],
): SessionSpec {
  return {
    ...prescribe(kind, minutes, zones, weekFixture({ flags }), ctx),
    date: '2026-07-10',
    order: 1,
  }
}

function planOf(
  session: SessionSpec,
  v: { z?: ZoneSet; hot?: boolean; eased?: boolean; fuelLine?: string | null } = {},
): WorkoutPlan {
  const z = v.z ?? zones
  const source = v.eased ? easedSession(session, z) : session
  return toWorkoutPlan(source, resolveTargets(source, z, { hot: v.hot ?? false }), {
    eased: v.eased ?? false,
    fuelLine: v.fuelLine ?? null,
    units: 'km',
  })
}

const stepsOf = (plan: WorkoutPlan): WorkoutStep[] =>
  plan.nodes.flatMap((node) =>
    node.type === 'step' ? [node] : Array.from({ length: node.count }, () => node.steps).flat(),
  )

// The SDK's conventions, restated from the profile: how a plan's figures read in the file.
const INTENSITY: Record<StepIntent, string> = {
  steady: 'active',
  warmup: 'warmup',
  cooldown: 'cooldown',
  recover: 'recovery',
  work: 'interval',
}

function expectedTarget(target: StepTarget): ReadTarget {
  switch (target.kind) {
    case 'open':
      return { type: 'open' }
    case 'hr-ceiling':
      return { type: 'heart_rate', lowBpm: target.floorBpm, highBpm: target.ceilingBpm }
    case 'hr-band':
      return { type: 'heart_rate', lowBpm: target.lowBpm, highBpm: target.highBpm }
    case 'pace':
      return {
        type: 'speed',
        lowMmPerSec: Math.round(1_000_000 / target.slowSecPerKm),
        highMmPerSec: Math.round(1_000_000 / target.fastSecPerKm),
      }
  }
}

/** What the file must hold for a plan, step by step, notes aside. */
function expectedSteps(plan: WorkoutPlan): Array<Omit<ExpandedStep, 'notes'>> {
  return stepsOf(plan).map((step) => ({
    name: step.label,
    durationSec: step.durationSec,
    target: expectedTarget(step.target),
    intensity: INTENSITY[step.intent],
  }))
}

const withoutNotes = ({ notes: _notes, ...rest }: ExpandedStep) => rest

function roundTrip(plan: WorkoutPlan, options: WorkoutFitOptions = OPTIONS) {
  const read = readWorkout(encodeWorkoutFit(plan, options))
  return { read, steps: expandWorkout(read) }
}

describe('encodeWorkoutFit: the messages', () => {
  it('writes file_id, workout and one workout_step per step and per repeat', () => {
    const { read } = roundTrip(INTERVALS)
    expect(read.counts).toEqual({ fileIds: 1, workouts: 1, steps: 5 })
    expect(read.file).toEqual({
      type: 'workout',
      manufacturer: 'development',
      product: 0,
      serial: 1234,
      timeCreated: CREATED,
    })
    expect(read.workout).toEqual({ sport: 'running', name: 'Intervals, 1 h', numValidSteps: 5 })
    expect(read.steps.map((step) => step.index)).toEqual([0, 1, 2, 3, 4])
    expect(read.steps.map((step) => step.type)).toEqual(['time', 'time', 'time', 'repeat', 'time'])
  })

  it('counts the repeat steps among the valid steps', () => {
    for (const kind of PUBLISHABLE) {
      const plan = planOf(make(kind, 75))
      const { read } = roundTrip(plan)
      const nodes = plan.nodes.reduce(
        (sum, node) => sum + (node.type === 'step' ? 1 : node.steps.length + 1),
        0,
      )
      expect(read.workout.numValidSteps, kind).toBe(nodes)
      expect(read.steps, kind).toHaveLength(nodes)
    }
  })

  it('writes the running sport for every publishable kind, a hike included', () => {
    for (const kind of PUBLISHABLE) {
      const { read } = roundTrip(planOf(make(kind, 60)))
      expect(read.workout.sport, kind).toBe('running')
    }
  })

  it('leaves the serial out when none is given', () => {
    const { read } = roundTrip(EASY_RUN, { createdAt: CREATED })
    expect(read.file.serial).toBeNull()
  })
})

describe('encodeWorkoutFit: the messages on the wire', () => {
  const wire = (plan: WorkoutPlan) =>
    readFitMessages(encodeWorkoutFit(plan, OPTIONS)).messages.map((message) => ({
      mesg: message.globalMessageNumber,
      fields: message.fields.map((field) => field.fieldNumber),
    }))

  it('writes the field numbers of the SDK profile', () => {
    expect(wire(INTERVALS)).toEqual([
      // file_id: type, manufacturer, product, serial_number, time_created
      { mesg: 0, fields: [0, 1, 2, 3, 4] },
      // workout: sport, num_valid_steps, wkt_name
      { mesg: 26, fields: [4, 6, 8] },
      // workout_step: wkt_step_name, duration_type, duration_value, target_type, target_value,
      // intensity, message_index
      { mesg: 27, fields: [0, 1, 2, 3, 4, 7, 254] },
      // the same with custom_target_value_low and _high
      { mesg: 27, fields: [0, 1, 2, 3, 4, 5, 6, 7, 254] },
      { mesg: 27, fields: [0, 1, 2, 3, 4, 7, 254] },
      // a repeat: duration_type, duration_value (first step), target_type, target_value (count)
      { mesg: 27, fields: [1, 2, 3, 4, 254] },
      { mesg: 27, fields: [0, 1, 2, 3, 4, 7, 254] },
    ])
  })

  it('writes notes as field 8 of a step, before its index', () => {
    const eased = wire({ ...EASY_RUN, eased: true })
    expect(eased.at(-1)).toEqual({ mesg: 27, fields: [0, 1, 2, 3, 4, 5, 6, 7, 8, 254] })
  })

  it('writes a valid header and CRC, which the strict reader checks', () => {
    const bytes = encodeWorkoutFit(INTERVALS, OPTIONS)
    // a 14-byte header of protocol 2.0 (the version byte holds the major version in its high nibble)
    expect(bytes[0]).toBe(14)
    expect(bytes[1]).toBe(0x20)
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('.FIT')
    expect(() => readFitMessages(bytes)).not.toThrow()
    const damaged = new Uint8Array(bytes)
    damaged[damaged.length - 3] = (damaged[damaged.length - 3]! + 1) & 0xff
    expect(() => readFitMessages(damaged)).toThrow(FitMessageReaderError)
  })
})

describe('encodeWorkoutFit: the units of the SDK', () => {
  it('writes durations in milliseconds', () => {
    const { read } = roundTrip(INTERVALS)
    const times = read.steps.flatMap((step) => (step.type === 'time' ? [step.durationMs] : []))
    expect(times).toEqual([600_000, 240_000, 240_000, 600_000])
  })

  it('writes a pace as a speed range in mm/s with the slow pace as the low edge', () => {
    // 272 s/km is 3676 mm/s and 258 s/km is 3876 mm/s
    const { read } = roundTrip(INTERVALS)
    const fast = read.steps[1]
    expect(fast?.type === 'time' && fast.target).toEqual({
      type: 'speed',
      lowMmPerSec: 3676,
      highMmPerSec: 3876,
    })
  })

  it('writes a heart-rate ceiling from the floor, as bpm + 100', () => {
    const { read } = roundTrip(EASY_RUN)
    const only = read.steps[0]
    expect(only?.type === 'time' && only.target).toEqual({
      type: 'heart_rate',
      lowBpm: P.o1.hrFloorBpm.value,
      highBpm: 142,
    })
    // the reader refuses a heart rate that the SDK would read as a percentage
    expect(P.o1.hrFloorBpm.value).toBeGreaterThan(0)
  })

  it('writes a repeat as the first step of its block and a count', () => {
    const { read } = roundTrip(INTERVALS)
    expect(read.steps[3]).toEqual({ type: 'repeat', index: 3, fromIndex: 1, count: 5 })
    expect(expandWorkout(read).map((step) => step.name)).toEqual([
      'Warm up',
      ...Array.from({ length: 5 }, () => ['Fast', 'Recover']).flat(),
      'Cool down',
    ])
  })

  it('writes a step with no target as open', () => {
    const { read } = roundTrip(INTERVALS)
    const targets = read.steps.flatMap((step) => (step.type === 'time' ? [step.target.type] : []))
    expect(targets).toEqual(['open', 'speed', 'open', 'open'])
  })
})

describe('encodeWorkoutFit: the library', () => {
  it('decodes to the steps, durations and targets of every publishable plan', () => {
    let checked = 0
    for (const kind of PUBLISHABLE) {
      for (const minutes of MINUTES) {
        for (const eased of [false, true]) {
          for (const hot of [false, true]) {
            const plan = planOf(make(kind, minutes), { eased, hot })
            const { steps } = roundTrip(plan)
            expect(steps.map(withoutNotes), `${kind} ${minutes} eased=${eased} hot=${hot}`).toEqual(
              expectedSteps(plan),
            )
            const total = steps.reduce((sum, step) => sum + step.durationSec, 0)
            expect(total, `${kind} ${minutes}`).toBe(plan.totalSec)
            checked += 1
          }
        }
      }
    }
    expect(checked).toBe(PUBLISHABLE.length * MINUTES.length * 4)
  })

  it('decodes the run-walk ladder, whose pairs repeat', () => {
    let repeats = 0
    for (let rung = 1; rung <= 9; rung += 1) {
      for (const blueprint of rungSessions(rung)) {
        const session = make('easy', sessionMin(blueprint), { blueprint }, [
          'restart-floor',
          'run-walk',
          `ladder-${String(rung)}`,
        ])
        const plan = planOf(session)
        const { read, steps } = roundTrip(plan)
        expect(steps.map(withoutNotes), `rung ${rung}`).toEqual(expectedSteps(plan))
        expect(steps.reduce((sum, step) => sum + step.durationSec, 0)).toBe(plan.totalSec)
        repeats += read.steps.filter((step) => step.type === 'repeat').length
      }
    }
    expect(repeats).toBeGreaterThan(0)
  })

  it('decodes bouts - 1 recoveries as a repeat and a trailing work step', () => {
    let seen = 0
    for (const kind of ['threshold', 'race-pace'] as const) {
      for (const minutes of [90, 120, 150, 180]) {
        const plan = planOf(make(kind, minutes))
        const repeat = plan.nodes.find((node) => node.type === 'repeat')
        if (repeat === undefined) continue
        const { steps } = roundTrip(plan)
        expect(steps.map(withoutNotes), `${kind} ${minutes}`).toEqual(expectedSteps(plan))
        seen += 1
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('never writes a heart-rate target on a step under the minimum length', () => {
    let short = 0
    for (const kind of PUBLISHABLE) {
      const { steps } = roundTrip(planOf(make(kind, 60)))
      for (const step of steps) {
        if (step.durationSec >= P.o1.hrTargetMinStepSec.value) continue
        short += 1
        expect(step.target.type, `${kind} ${step.name}`).not.toBe('heart_rate')
      }
    }
    expect(short).toBeGreaterThan(0)
  })
})

describe('encodeWorkoutFit: notes', () => {
  const noteOf = (plan: WorkoutPlan, index: number): string | null => {
    const { steps } = roundTrip(plan)
    return steps[index]?.notes ?? null
  }

  it('says that the day was eased on the first step, and not the reason', () => {
    const plan = planOf(make('intervals', 60), { eased: true })
    expect(plan.eased).toBe(true)
    expect(noteOf(plan, 0)).toBe('Eased for today')
    expect(noteOf(plan, 1)).toBeNull()
    expect(noteOf(planOf(make('intervals', 60)), 0)).toBeNull()
  })

  it('marks the steps run by effort when no figure leads', () => {
    const hot = planOf(make('long', 120), { hot: true })
    const { steps } = roundTrip(hot)
    expect(steps.map((step) => step.target.type)).toEqual(['open'])
    expect(steps[0]?.notes).toBe('By effort')

    const hills = roundTrip(planOf(make('hills', 60)))
    const worked = hills.steps.filter((step) => step.intensity === 'interval')
    expect(worked.length).toBeGreaterThan(0)
    expect(worked.every((step) => step.notes === 'By effort')).toBe(true)
    const rest = hills.steps.filter((step) => step.intensity !== 'interval')
    expect(rest.every((step) => step.notes === null)).toBe(true)
  })

  it('keeps the effort mark beside a hike’s heart-rate ceiling', () => {
    const { steps } = roundTrip(planOf(make('hike', 90)))
    expect(steps[0]?.target.type).toBe('heart_rate')
    expect(steps[0]?.notes).toBe('By effort')
  })

  it('carries the fuel line when it fits and leaves it out when it does not', () => {
    const fits = planOf(make('long', 150), { fuelLine: 'Fuel 60 g/h carbs. Drink to thirst.' })
    expect(noteOf(fits, 0)).toBe('Fuel 60 g/h carbs. Drink to thirst.')

    const long = 'Fuel 60 g/h carbs and drink to thirst, with a gel every thirty minutes.'
    expect(new TextEncoder().encode(long).length).toBeGreaterThan(FIT_NOTES_MAX_BYTES)
    expect(noteOf(planOf(make('long', 150), { fuelLine: long }), 0)).toBeNull()
  })

  it('keeps whole sentences, in order, when several notes compete', () => {
    const plan = planOf(make('long', 150), {
      eased: true,
      hot: true,
      fuelLine: 'Fuel 60 g/h carbs. Drink to thirst.',
    })
    const note = noteOf(plan, 0)
    expect(note).toBe('Eased for today. By effort')
    expect(new TextEncoder().encode(note ?? '').length).toBeLessThanOrEqual(FIT_NOTES_MAX_BYTES)
  })
})

describe('fitText', () => {
  const sizeOf = (text: string, max = FIT_NAME_MAX_BYTES) => {
    const field = fitText(0, text, max)
    return { size: field.size, bytes: (field.value as Uint8Array).length, field }
  }

  it('sizes an ASCII string as its length plus the terminator', () => {
    expect(sizeOf('Easy run').size).toBe(9)
    expect(sizeOf('').size).toBe(1)
    const field = sizeOf('Warm up').field
    expect((field.value as Uint8Array).at(-1)).toBe(0)
  })

  it('sizes a non-ASCII string by its bytes, not its characters', () => {
    // "é" is two bytes, "ß" two, "走" three, "🏃" four
    expect(sizeOf('Café').size).toBe(6)
    expect(sizeOf('Straße').size).toBe(8)
    expect(sizeOf('走る').size).toBe(7)
    expect(sizeOf('🏃').size).toBe(5)
    for (const text of ['Café', 'Straße', '走る', '🏃', 'ab']) {
      const { size, bytes } = sizeOf(text)
      expect(bytes, text).toBe(size)
    }
  })

  it('is accepted by the encoder for any of them', () => {
    for (const text of ['Café', 'Straße', '走る', '🏃', '', 'a'.repeat(300)]) {
      const fit = new FitEncoder()
      expect(
        () => fit.writeMessage(27, [fitText(0, text, FIT_NAME_MAX_BYTES)], 0),
        text,
      ).not.toThrow()
    }
  })

  it('cuts at the byte cap without splitting a character', () => {
    const cut = sizeOf('ÀÀÀÀÀÀÀÀÀ', FIT_NAME_MAX_BYTES) // nine two-byte characters
    expect(cut.size).toBe(15) // seven characters (14 bytes) and the terminator
    const decoded = new TextDecoder().decode((cut.field.value as Uint8Array).slice(0, -1))
    expect(decoded).toBe('ÀÀÀÀÀÀÀ')
    expect(decoded).not.toContain('�')
    expect(sizeOf('🏃🏃🏃🏃🏃').size).toBe(13) // three runners (12 bytes), never half of the fourth
  })

  it('drops the length of a title before it cuts a word', () => {
    const text = (value: string) =>
      new TextDecoder().decode((fitText(0, value, 15).value as Uint8Array).slice(0, -1))
    expect(text('Easy run, 45 min')).toBe('Easy run')
    expect(text('Threshold run, 40 min')).toBe('Threshold run')
    expect(text('Marathon pace run, 2 h')).toBe('Marathon pace')
    expect(text('Long run, 2 h')).toBe('Long run, 2 h')
    expect(text('Intervals, 1 h')).toBe('Intervals, 1 h')
  })

  it('names every publishable kind in full, with the short form the closed list gives where the title is over the cap', () => {
    for (const kind of PUBLISHABLE) {
      for (const minutes of MINUTES) {
        const plan = planOf(make(kind, minutes))
        const written = roundTrip(plan).read.workout.name ?? ''
        const { title, short } = PUBLIC_TITLES[kind]
        const name = short ?? title
        expect(Buffer.byteLength(name), `${kind} name`).toBeLessThanOrEqual(FIT_NAME_MAX_BYTES)
        // the name, with the length after it where that fits
        expect(written === name || written.startsWith(`${name}, `), `${kind}: ${written}`).toBe(
          true,
        )
      }
    }
    expect(roundTrip(planOf(make('strides', 45))).read.workout.name).toBe('Easy + strides')
    expect(roundTrip(planOf(make('b2b', 90))).read.workout.name).toBe('Back-to-back')
  })

  it('writes one line without control characters', () => {
    const text = new TextDecoder().decode(
      (fitText(8, 'a\n\tb\u0000c', 49).value as Uint8Array).slice(0, -1),
    )
    expect(text).toBe('a b c')
  })

  it('round-trips a non-ASCII workout name through the parser', () => {
    // fourteen bytes in nine characters
    const plan: WorkoutPlan = { ...EASY_RUN, title: 'Läufer 走る' }
    const { read } = roundTrip(plan)
    expect(read.workout.name).toBe('Läufer 走る')
    expect(read.workout.numValidSteps).toBe(1)
  })
})

describe('encodeWorkoutFit: determinism and errors', () => {
  it('writes identical bytes for identical input', () => {
    const plan = planOf(make('intervals', 60), { eased: true })
    const first = encodeWorkoutFit(plan, OPTIONS)
    const second = encodeWorkoutFit(structuredClone(plan), { ...OPTIONS })
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
  })

  it('changes the bytes with the time and with the serial', () => {
    const a = Buffer.from(encodeWorkoutFit(EASY_RUN, OPTIONS))
    expect(a.equals(Buffer.from(encodeWorkoutFit(EASY_RUN, { ...OPTIONS, serial: 1235 })))).toBe(
      false,
    )
    const later = new Date(CREATED.getTime() + 1000)
    expect(
      a.equals(Buffer.from(encodeWorkoutFit(EASY_RUN, { ...OPTIONS, createdAt: later }))),
    ).toBe(false)
  })

  it('refuses a step with no length, a heart rate below 1 and a pace that is not positive', () => {
    const step = (over: Partial<WorkoutStep>): WorkoutPlan => ({
      ...EASY_RUN,
      nodes: [{ ...(EASY_RUN.nodes[0] as WorkoutStep), ...over }],
    })
    expect(() => encodeWorkoutFit(step({ durationSec: 0 }), OPTIONS)).toThrow(RangeError)
    expect(() =>
      encodeWorkoutFit(
        step({ target: { kind: 'hr-ceiling', floorBpm: 0, ceilingBpm: 142 } }),
        OPTIONS,
      ),
    ).toThrow(RangeError)
    expect(() =>
      encodeWorkoutFit(
        step({ target: { kind: 'pace', slowSecPerKm: 0, fastSecPerKm: 250 } }),
        OPTIONS,
      ),
    ).toThrow(RangeError)
  })

  it('refuses a time that a FIT file cannot hold', () => {
    expect(() => encodeWorkoutFit(EASY_RUN, { createdAt: new Date('1970-01-01') })).toThrow(
      RangeError,
    )
    expect(() => encodeWorkoutFit(EASY_RUN, { createdAt: new Date('nope') })).toThrow(TypeError)
  })
})

describe('the golden files', () => {
  const dir = join(import.meta.dirname, '../../fixtures/fit/workouts')

  it.each(GOLDEN_WORKOUTS.map(([name, plan]) => [name, plan] as const))(
    '%s is what the encoder writes, byte for byte',
    (name, plan) => {
      const committed = readFileSync(join(dir, name))
      const written = Buffer.from(encodeWorkoutFit(plan, GOLDEN_OPTIONS))
      expect(written.equals(committed), `${name}: run tests/fixtures/fit/workouts/write.ts`).toBe(
        true,
      )
      const read = readWorkout(new Uint8Array(committed))
      expect(read.file.type).toBe('workout')
      expect(expandWorkout(read).map(withoutNotes)).toEqual(expectedSteps(plan))
    },
  )

  it('holds an easy run, an interval session and a long run', () => {
    expect(GOLDEN_WORKOUTS.map(([, plan]) => plan.kind)).toEqual(['easy', 'intervals', 'long'])
    expect(GOLDEN_WORKOUTS.map(([, plan]) => plan)).toEqual([EASY_RUN, INTERVALS, LONG_RUN])
    const long = readWorkout(new Uint8Array(readFileSync(join(dir, 'long-run-2h.fit'))))
    expect(long.steps[0]).toMatchObject({ notes: 'Fuel 60 g/h carbs. Drink to thirst.' })
  })
})

import { describe, expect, it } from 'vitest'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { formatQuantity } from '../../../shared/copy/quantity.ts'
import { WORKOUT_TEMPLATES } from '../../../shared/copy/workouts.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { easedSession } from '../../../shared/engine/readiness.ts'
import { prescribe, type PrescribeContext } from '../../../shared/engine/sessions.ts'
import { rungSessions, sessionMin } from '../../../shared/engine/startWeeks.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type { SessionKind, SessionSpec, Step, ZoneSet } from '../../../shared/engine/types.ts'
import type { Units } from '../../../shared/types.ts'
import { formatPace } from '../../../shared/units.ts'
import { publicTitle, publishable } from '../../../shared/workouts/labels.ts'
import {
  easedLine,
  effortPhrase,
  targetPhrase,
  toWorkoutPlan,
} from '../../../shared/workouts/plan.ts'
import type {
  StepTarget,
  WorkoutNode,
  WorkoutPlan,
  WorkoutStep,
} from '../../../shared/workouts/types.ts'
import { SESSION_KINDS, weekFixture, zoneSetFixture } from '../engine/fixtures.ts'

const zones = zoneSetFixture()
const PUBLISHABLE = SESSION_KINDS.filter(publishable)
const MINUTES = [20, 30, 45, 60, 75, 90, 120, 180, 240]
const UNITS: readonly Units[] = ['km', 'mi']

function make(
  kind: SessionKind,
  minutes: number,
  z: ZoneSet = zones,
  ctx: PrescribeContext = { goalPaceSecPerKm: 330 },
  flags: string[] = [],
): SessionSpec {
  return {
    ...prescribe(kind, minutes, z, weekFixture({ flags }), ctx),
    date: '2026-07-10',
    order: 1,
  }
}

function ladder(rung: number, blueprint: readonly number[]): SessionSpec {
  return make('easy', sessionMin(blueprint), zones, { blueprint }, [
    'restart-floor',
    'run-walk',
    `ladder-${String(rung)}`,
  ])
}

interface Variant {
  z?: ZoneSet
  hot?: boolean
  eased?: boolean
  units?: Units
  fuelLine?: string | null
}

function planOf(session: SessionSpec, v: Variant = {}): WorkoutPlan {
  const z = v.z ?? zones
  const source = v.eased ? easedSession(session, z) : session
  const targets = resolveTargets(source, z, { hot: v.hot ?? false })
  return toWorkoutPlan(source, targets, {
    eased: v.eased ?? false,
    fuelLine: v.fuelLine ?? null,
    units: v.units ?? 'km',
  })
}

const stepsOf = (node: WorkoutNode): WorkoutStep[] => (node.type === 'step' ? [node] : node.steps)
const allSteps = (plan: WorkoutPlan): WorkoutStep[] => plan.nodes.flatMap(stepsOf)
const secondsOf = (steps: readonly Step[]) =>
  steps.reduce((sum, s) => sum + (s.durationSec ?? 0) * s.reps, 0)
const isHr = (t: StepTarget) => t.kind === 'hr-ceiling' || t.kind === 'hr-band'

describe('toWorkoutPlan: the library', () => {
  it('lasts the planned minutes for every publishable kind and length', () => {
    let checked = 0
    for (const kind of PUBLISHABLE) {
      for (const minutes of MINUTES) {
        const session = make(kind, minutes)
        const plan = planOf(session)
        expect(plan.totalSec, `${kind} ${minutes}`).toBe(session.durationMin * 60)
        expect(plan.kind).toBe(kind)
        expect(plan.title).toBe(publicTitle(session))
        checked += 1
      }
    }
    expect(checked).toBe(PUBLISHABLE.length * MINUTES.length)
  })

  it('gives the steps of the engine their seconds, repeats expanded', () => {
    for (const kind of ['threshold', 'intervals', 'race-pace', 'hills', 'strides'] as const) {
      const session = make(kind, 60)
      const plan = planOf(session)
      // the engine's steps may fall a few seconds short of the minutes; only the last cool-down grows
      const gap = plan.totalSec - secondsOf(session.structure)
      expect(gap, kind).toBeGreaterThanOrEqual(0)
      expect(gap, kind).toBeLessThan(P.sessionDesign.warmupMin.value * 60)
    }
  })

  it('makes one step of a session the engine leaves without structure', () => {
    for (const kind of ['easy', 'recovery', 'long', 'b2b', 'hike'] as const) {
      const session = make(kind, 75)
      expect(session.structure).toEqual([])
      const plan = planOf(session)
      expect(plan.nodes).toHaveLength(1)
      const [only] = allSteps(plan)
      expect(only?.durationSec).toBe(75 * 60)
      expect(only?.walk).toBe(false)
    }
  })

  it('writes interval work and its recovery as one repeat', () => {
    const session = make('intervals', 60)
    const work = session.structure.find((s) => s.kind === 'work')!
    const recover = session.structure.find((s) => s.kind === 'recover')!
    expect(work.reps).toBe(recover.reps)
    expect(work.reps).toBeGreaterThan(1)
    const plan = planOf(session)
    expect(plan.nodes.map((n) => n.type)).toEqual(['step', 'repeat', 'step'])
    const repeat = plan.nodes[1]!
    expect(repeat.type).toBe('repeat')
    if (repeat.type !== 'repeat') return
    expect(repeat.count).toBe(work.reps)
    expect(repeat.steps.map((s) => [s.intent, s.durationSec])).toEqual([
      ['work', work.durationSec],
      ['recover', recover.durationSec],
    ])
    expect(allSteps(plan)[0]?.intent).toBe('warmup')
    expect(allSteps(plan).at(-1)?.intent).toBe('cooldown')
  })

  it('writes bouts - 1 recoveries as repeat(n - 1) and a trailing work step', () => {
    let seen = 0
    for (const kind of ['threshold', 'race-pace'] as const) {
      for (const minutes of [60, 75, 90, 120, 150, 180, 240]) {
        const session = make(kind, minutes)
        const work = session.structure.find((s) => s.kind === 'work')
        const recover = session.structure.find((s) => s.kind === 'recover')
        if (work === undefined || recover === undefined) continue
        expect(work.reps, `${kind} ${minutes}`).toBe(recover.reps + 1)
        const nodes = planOf(session).nodes
        const labels = nodes.map((n) => (n.type === 'step' ? n.intent : `repeat ${n.count}`))
        if (recover.reps === 1) {
          expect(labels, `${kind} ${minutes}`).toEqual([
            'warmup',
            'work',
            'recover',
            'work',
            'cooldown',
          ])
        } else {
          expect(labels, `${kind} ${minutes}`).toEqual([
            'warmup',
            `repeat ${String(recover.reps)}`,
            'work',
            'cooldown',
          ])
          const repeat = nodes[1]!
          expect(repeat.type === 'repeat' && repeat.steps.map((s) => s.intent)).toEqual([
            'work',
            'recover',
          ])
          seen += 1
        }
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('writes strides as a repeat after the easy part', () => {
    const plan = planOf(make('strides', 45))
    expect(plan.nodes.map((n) => n.type)).toEqual(['step', 'repeat'])
    const repeat = plan.nodes[1]!
    expect(repeat.type === 'repeat' && repeat.count).toBe(P.flib.stridesCount.value)
    expect(plan.description).toContain(`${String(P.flib.stridesCount.value)} x: Stride 20 s`)
  })

  it('puts the minutes the engine could not fit into the last cool-down', () => {
    // 4-minute reps with 1-minute recoveries leave time over in a 47-minute session
    const session = make('intervals', 47)
    const engineEnd = session.structure.at(-1)!
    const plan = planOf(session)
    const last = allSteps(plan).at(-1)!
    expect(last.intent).toBe('cooldown')
    expect(last.durationSec).toBeGreaterThanOrEqual(engineEnd.durationSec!)
    expect(plan.totalSec).toBe(47 * 60)
  })

  it('adds a cool-down for the minutes a run-walk block leaves over', () => {
    const session = make('easy', 50, zones, { runWalk: true })
    const plan = planOf(session)
    const last = allSteps(plan).at(-1)!
    expect(plan.totalSec).toBe(50 * 60)
    expect(plan.nodes[0]?.type).toBe('repeat')
    expect(last.intent).toBe('cooldown')
    expect(last.walk).toBe(false)
  })
})

describe('toWorkoutPlan: the run-walk ladder', () => {
  it('adds the two framing walks to the session minutes, and no more', () => {
    const frameSec = P.noviceLadder.walkFrameMin.value * 60
    for (let rung = 1; rung <= 9; rung += 1) {
      for (const blueprint of rungSessions(rung)) {
        const session = ladder(rung, blueprint)
        const plan = planOf(session)
        const bpSec = blueprint.reduce((sum, v) => sum + Math.round(v * 60), 0)
        expect(plan.totalSec, `rung ${rung} ${blueprint.join()}`).toBe(bpSec + 2 * frameSec)
        expect(plan.totalSec - 2 * frameSec).toBe(secondsOf(session.structure) - 2 * frameSec)
        expect(plan.title).toBe('Easy run')
        const steps = allSteps(plan)
        expect(steps[0]).toMatchObject({ intent: 'warmup', walk: true, durationSec: frameSec })
        expect(steps.at(-1)).toMatchObject({
          intent: 'cooldown',
          walk: true,
          durationSec: frameSec,
        })
      }
    }
  })

  it('writes rung 1 as a walk, seven run-walk pairs and a walk', () => {
    const plan = planOf(ladder(1, rungSessions(1)[0]!))
    expect(plan.nodes).toHaveLength(3)
    const repeat = plan.nodes[1]!
    expect(repeat.type).toBe('repeat')
    if (repeat.type !== 'repeat') return
    expect(repeat.count).toBe(7)
    expect(repeat.steps.map((s) => [s.label, s.walk, s.durationSec])).toEqual([
      ['Run', false, 60],
      ['Walk', true, 120],
    ])
    expect(plan.description.split('\n')).toEqual([
      'Walk 5 min',
      '7 x: Run 1 min; Walk 2 min',
      'Walk 5 min',
    ])
  })

  it('keeps the unequal pairs of a middle rung in order, ending on a run', () => {
    const blueprint = [3, 1.5, 5, 2.5, 3, 1.5, 5]
    const plan = planOf(ladder(4, blueprint))
    const steps = allSteps(plan)
    expect(steps.map((s) => s.durationSec)).toEqual([300, 180, 90, 300, 150, 180, 90, 300, 300])
    expect(steps.map((s) => s.walk)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ])
  })

  it('runs a continuous top rung between two walks, under one heart-rate ceiling', () => {
    const plan = planOf(ladder(9, [30]))
    const steps = allSteps(plan)
    expect(steps.map((s) => [s.walk, s.durationSec])).toEqual([
      [true, 300],
      [false, 1800],
      [true, 300],
    ])
    expect(steps[1]?.target).toEqual({
      kind: 'hr-ceiling',
      floorBpm: P.o1.hrFloorBpm.value,
      ceilingBpm: zones.hr!.z1[1],
    })
    expect(steps[0]?.target).toEqual({ kind: 'open' })
  })

  it('gives a run under three minutes no heart-rate target', () => {
    for (let rung = 1; rung <= 4; rung += 1) {
      const plan = planOf(ladder(rung, rungSessions(rung)[0]!))
      for (const step of allSteps(plan)) {
        if (step.durationSec < P.o1.hrTargetMinStepSec.value) {
          expect(isHr(step.target), `rung ${rung} ${step.label} ${step.durationSec}`).toBe(false)
        }
      }
    }
  })
})

describe('toWorkoutPlan: targets by step [rule O1]', () => {
  const ceilingOf = (z: ZoneSet) => z.hr!.z1[1]

  it.each(['easy', 'recovery', 'long', 'b2b', 'hike'] as const)(
    '%s carries one heart-rate ceiling from the floor to the top of Z1',
    (kind) => {
      const plan = planOf(make(kind, 75))
      expect(plan.targets).toEqual(resolveTargets(make(kind, 75), zones, { hot: false }))
      expect(allSteps(plan).map((s) => s.target)).toEqual([
        { kind: 'hr-ceiling', floorBpm: P.o1.hrFloorBpm.value, ceilingBpm: ceilingOf(zones) },
      ])
    },
  )

  it('takes the ceiling from the current zones, not from the stored target', () => {
    const session = make('easy', 60)
    const faster = zoneSetFixture({ hr: { z1: [125, 148], z2: [148, 160], z3: [160, 172] } })
    const plan = planOf(session, { z: faster })
    expect(allSteps(plan)[0]?.target).toMatchObject({ kind: 'hr-ceiling', ceilingBpm: 148 })
  })

  it('leaves the fast finish of a long run open and the steady part under the ceiling', () => {
    const plan = planOf(make('long-fast-finish', 120))
    const [steady, finish] = allSteps(plan)
    expect(steady?.target).toMatchObject({ kind: 'hr-ceiling', ceilingBpm: ceilingOf(zones) })
    expect(finish?.label).toBe('Race pace')
    expect(finish?.target).toEqual({ kind: 'open' })
  })

  it.each(['threshold', 'intervals', 'race-pace'] as const)(
    '%s carries the pace band on its work and nothing on warm-up, recovery or cool-down',
    (kind) => {
      const session = make(kind, 75)
      const plan = planOf(session)
      const pace = plan.targets.paceSecPerKm!
      expect(plan.targets.mode).toBe('pace')
      const work = allSteps(plan).filter((s) => s.intent === 'work')
      expect(work.length).toBeGreaterThan(0)
      for (const step of work) {
        expect(step.target).toEqual({ kind: 'pace', slowSecPerKm: pace[0], fastSecPerKm: pace[1] })
      }
      for (const step of allSteps(plan).filter((s) => s.intent !== 'work')) {
        expect(step.target, `${kind} ${step.intent}`).toEqual({ kind: 'open' })
      }
    },
  )

  it('keeps the pace band of the stored work, not a second derivation from the zones', () => {
    const session = make('intervals', 60)
    const plan = planOf(session)
    expect(plan.targets.paceSecPerKm).toEqual(session.target.paceSecPerKm)
    const first = allSteps(plan).find((s) => s.intent === 'work')!
    expect(first.target).toMatchObject({
      kind: 'pace',
      slowSecPerKm: session.target.paceSecPerKm![0],
    })
  })

  it('leaves recoveries, strides and hill repeats open', () => {
    for (const kind of ['strides', 'hills'] as const) {
      const plan = planOf(make(kind, 60))
      for (const step of allSteps(plan)) {
        expect(step.target, `${kind} ${step.label}`).toEqual({ kind: 'open' })
      }
    }
    expect(planOf(make('hills', 60)).description).toContain('Hill')
    expect(planOf(make('hills', 60)).description).toContain('by effort')
  })

  it('uses the heart-rate band where a threshold session has no pace', () => {
    const noPace = zoneSetFixture({ pace: null, csMps: null })
    const session = make('threshold', 75, noPace)
    expect(session.target.paceSecPerKm).toBeNull()
    const plan = planOf(session, { z: noPace })
    expect(plan.targets.mode).toBe('hr-band')
    const work = allSteps(plan).filter((s) => s.intent === 'work')
    expect(work.length).toBeGreaterThan(0)
    for (const step of work) {
      expect(step.target).toEqual({
        kind: 'hr-band',
        lowBpm: noPace.hr!.z2[0],
        highBpm: noPace.hr!.z2[1],
      })
    }
  })

  it('holds a short step back from a heart-rate target and not from a pace band', () => {
    const base = make('easy', 10)
    const withSteady = (sec: number): SessionSpec => ({
      ...base,
      durationMin: sec / 60,
      structure: [{ kind: 'steady', reps: 1, durationSec: sec, distanceM: null, zone: 'z1' }],
    })
    const min = P.o1.hrTargetMinStepSec.value
    expect(allSteps(planOf(withSteady(min - 1)))[0]?.target).toEqual({ kind: 'open' })
    expect(allSteps(planOf(withSteady(min)))[0]?.target.kind).toBe('hr-ceiling')

    // threshold work in 150 s pieces still carries pace
    const quick: SessionSpec = {
      ...make('threshold', 30),
      structure: [
        { kind: 'work', reps: 3, durationSec: 150, distanceM: null, zone: 'z2' },
        { kind: 'recover', reps: 2, durationSec: 60, distanceM: null, zone: 'z1' },
      ],
      durationMin: 10,
    }
    expect(allSteps(planOf(quick)).find((s) => s.intent === 'work')?.target.kind).toBe('pace')
  })

  it('never puts a heart-rate target on a step under the minimum length', () => {
    let short = 0
    for (const kind of PUBLISHABLE) {
      for (const minutes of MINUTES) {
        for (const eased of [false, true]) {
          for (const hot of [false, true]) {
            const plan = planOf(make(kind, minutes), { eased, hot })
            for (const step of allSteps(plan)) {
              if (step.durationSec >= P.o1.hrTargetMinStepSec.value) continue
              short += 1
              expect(isHr(step.target), `${kind} ${minutes} ${step.label}`).toBe(false)
            }
          }
        }
      }
    }
    expect(short).toBeGreaterThan(0)
  })

  it('carries a floor under every ceiling and a ceiling above every floor', () => {
    for (const kind of PUBLISHABLE) {
      for (const step of allSteps(planOf(make(kind, 90)))) {
        if (step.target.kind !== 'hr-ceiling') continue
        expect(step.target.floorBpm).toBe(P.o1.hrFloorBpm.value)
        expect(step.target.ceilingBpm).toBeGreaterThan(step.target.floorBpm)
      }
    }
  })
})

describe('toWorkoutPlan: heat and the eased day', () => {
  it('carries no figure on a hot day and says so', () => {
    for (const kind of PUBLISHABLE) {
      const plan = planOf(make(kind, 75), { hot: true })
      expect(plan.targets.mode, kind).toBe('effort')
      for (const step of allSteps(plan)) {
        expect(step.target, `${kind} ${step.label}`).toEqual({ kind: 'open' })
      }
      expect(plan.description.split('\n')[0], kind).toBe(plan.targets.hotNote)
      expect(plan.description, kind).not.toMatch(/under \d+ bpm|pace \d+:\d{2}/)
    }
  })

  it('shows an eased day as one easy ceiling under "Eased for today", with no reason', () => {
    const planned = make('intervals', 60)
    const plan = planOf(planned, { eased: true })
    expect(plan.eased).toBe(true)
    expect(plan.kind).toBe('easy')
    expect(plan.title).toBe('Easy run, 1 h')
    expect(allSteps(plan)).toHaveLength(1)
    expect(allSteps(plan)[0]?.target).toEqual({
      kind: 'hr-ceiling',
      floorBpm: P.o1.hrFloorBpm.value,
      ceilingBpm: zones.hr!.z1[1],
    })
    expect(plan.description.split('\n')).toEqual([
      'Eased for today',
      `Run 1 h, heart rate under ${String(zones.hr!.z1[1])} bpm`,
    ])
    expect(plan.description).not.toMatch(/readiness|injur|illness|pain|interval|signals|tired/i)
    expect(planOf(planned).eased).toBe(false)
  })

  it('keeps the hot note and the eased line apart, eased first', () => {
    const plan = planOf(make('threshold', 60), { eased: true, hot: true })
    const lines = plan.description.split('\n')
    expect(lines[0]).toBe('Eased for today')
    expect(lines[1]).toBe(plan.targets.hotNote)
    expect(lines[2]).toBe('Run 1 h, by effort')
  })
})

describe('toWorkoutPlan: the description', () => {
  /** The numbers of a text: durations and counts, pace as m:ss. */
  const numbersOf = (text: string) => text.match(/\d+:\d{2}|\d+/g) ?? []

  function expectedNumbers(plan: WorkoutPlan): string[] {
    const units = plan.units
    const time = (sec: number) => numbersOf(formatQuantity({ kind: 'duration', sec }, units))
    const pace = (secPerKm: number) => numbersOf(formatPace(secPerKm, 1000, units).split(' ')[0]!)
    const targetNumbers = (t: StepTarget): string[] => {
      switch (t.kind) {
        case 'hr-ceiling':
          return [String(t.ceilingBpm)]
        case 'hr-band':
          return [String(t.lowBpm), String(t.highBpm)]
        case 'pace':
          return [...pace(t.slowSecPerKm), ...pace(t.fastSecPerKm)]
        case 'open':
          return []
      }
    }
    const stepNumbers = (s: WorkoutStep) => [...time(s.durationSec), ...targetNumbers(s.target)]
    return plan.nodes.flatMap((n) =>
      n.type === 'step' ? stepNumbers(n) : [String(n.count), ...n.steps.flatMap(stepNumbers)],
    )
  }

  it('holds exactly the numbers of the steps, in km and in miles', () => {
    let checked = 0
    for (const kind of PUBLISHABLE) {
      for (const minutes of MINUTES) {
        for (const units of UNITS) {
          for (const eased of [false, true]) {
            for (const hot of [false, true]) {
              const plan = planOf(make(kind, minutes), { units, eased, hot })
              // the eased line and the hot note carry no number; the rest is the steps
              const lines = plan.description.split('\n')
              const stepLines = lines.slice(
                (eased ? 1 : 0) + (hot && plan.targets.hotNote !== null ? 1 : 0),
              )
              expect(numbersOf(stepLines.join('\n')), `${kind} ${minutes} ${units}`).toEqual(
                expectedNumbers(plan),
              )
              checked += 1
            }
          }
        }
      }
    }
    expect(checked).toBe(PUBLISHABLE.length * MINUTES.length * 8)
  })

  it('holds the numbers of every ladder rung', () => {
    for (let rung = 1; rung <= 9; rung += 1) {
      for (const blueprint of rungSessions(rung)) {
        const plan = planOf(ladder(rung, blueprint))
        expect(numbersOf(plan.description), `rung ${rung}`).toEqual(expectedNumbers(plan))
      }
    }
  })

  it('writes paces in the runner’s units', () => {
    const km = planOf(make('intervals', 60), { units: 'km' })
    const mi = planOf(make('intervals', 60), { units: 'mi' })
    const pace = km.targets.paceSecPerKm!
    expect(km.description).toContain(
      `pace ${formatPace(pace[0], 1000, 'km').split(' ')[0]!} to ${formatPace(pace[1], 1000, 'km')}`,
    )
    expect(mi.description).toContain(
      `pace ${formatPace(pace[0], 1000, 'mi').split(' ')[0]!} to ${formatPace(pace[1], 1000, 'mi')}`,
    )
    expect(km.description).toContain('/km')
    expect(km.description).not.toContain('/mi')
    expect(mi.description).toContain('/mi')
    expect(mi.description).not.toContain('/km')
    expect(km.units).toBe('km')
    expect(mi.units).toBe('mi')
    // the same seconds per kilometre, a slower number per mile
    expect(mi.nodes).toEqual(km.nodes)
  })

  it('reads a threshold session as warm-up, work, recoveries and cool-down', () => {
    const plan = planOf(make('threshold', 60))
    const lines = plan.description.split('\n')
    expect(lines[0]).toBe('Warm up 10 min')
    expect(lines.at(-1)).toMatch(/^Cool down \d+ min$/)
    expect(lines.slice(1, -1).join(' ')).toMatch(
      /Threshold \d+ min, pace \d+:\d{2} to \d+:\d{2} \/km/,
    )
  })

  it('appends the fuel line as it is, on its own line, and nothing without one', () => {
    const line = 'Tonight: 60 g of carbohydrate an hour.'
    const long = make('long', 150)
    const withFuel = planOf(long, { fuelLine: `  ${line}  ` })
    expect(withFuel.fuelLine).toBe(line)
    expect(withFuel.description.split('\n').at(-1)).toBe(line)
    expect(withFuel.description.split('\n')).toHaveLength(2)
    for (const none of [null, '', '   ']) {
      const plain = planOf(long, { fuelLine: none })
      expect(plain.fuelLine).toBeNull()
      expect(plain.description).toBe(planOf(long).description)
      expect(plain.description.split('\n')).toHaveLength(1)
    }
  })

  it('passes the shared lint for every kind, length, unit, eased and hot day', () => {
    for (const kind of PUBLISHABLE) {
      for (const minutes of MINUTES) {
        for (const units of UNITS) {
          for (const eased of [false, true]) {
            for (const hot of [false, true]) {
              const plan = planOf(make(kind, minutes), { units, eased, hot })
              assertCleanCopy(plan.description, `${kind} ${minutes} description`)
              assertCleanCopy(plan.title, `${kind} ${minutes} title`)
            }
          }
        }
      }
    }
    for (let rung = 1; rung <= 9; rung += 1) {
      for (const blueprint of rungSessions(rung)) {
        assertCleanCopy(planOf(ladder(rung, blueprint)).description, `rung ${rung}`)
      }
    }
  })
})

describe('toWorkoutPlan: contract', () => {
  it('refuses a kind that is not a workout', () => {
    for (const kind of SESSION_KINDS.filter((k) => !publishable(k))) {
      const session = make(kind, 45)
      const targets = resolveTargets(session, zones, { hot: false })
      expect(() => toWorkoutPlan(session, targets, { units: 'km' }), kind).toThrow(/no workout/)
    }
  })

  it('is deterministic and leaves its input alone', () => {
    const session = make('intervals', 60)
    const targets = resolveTargets(session, zones, { hot: false })
    const before = JSON.stringify({ session, targets })
    const first = toWorkoutPlan(session, targets, { units: 'mi', fuelLine: null })
    const second = toWorkoutPlan(session, targets, { units: 'mi', fuelLine: null })
    expect(second).toEqual(first)
    expect(JSON.stringify({ session, targets })).toBe(before)
    expect(first.targets).toBe(targets)
  })

  it('defaults to a planned day without a fuel line', () => {
    const session = make('easy', 45)
    const plan = toWorkoutPlan(session, resolveTargets(session, zones, { hot: false }), {
      units: 'km',
    })
    expect(plan.eased).toBe(false)
    expect(plan.fuelLine).toBeNull()
  })
})

describe('the words of a workout', () => {
  it('words a figure once, for the description and the intervals.icu header', () => {
    expect(targetPhrase({ kind: 'hr-ceiling', floorBpm: 40, ceilingBpm: 142 }, 'km')).toBe(
      'heart rate under 142 bpm',
    )
    expect(targetPhrase({ kind: 'hr-band', lowBpm: 140, highBpm: 155 }, 'mi')).toBe(
      'heart rate 140 to 155 bpm',
    )
    expect(targetPhrase({ kind: 'pace', slowSecPerKm: 250, fastSecPerKm: 240 }, 'km')).toBe(
      'pace 4:10 to 4:00 /km',
    )
    expect(targetPhrase({ kind: 'pace', slowSecPerKm: 250, fastSecPerKm: 240 }, 'mi')).toBe(
      'pace 6:42 to 6:26 /mi',
    )
    expect(targetPhrase({ kind: 'open' }, 'km')).toBeNull()
  })

  it('takes the name of every step from the copy templates', () => {
    const names = new Set(
      Object.entries(WORKOUT_TEMPLATES)
        .filter(([id]) => id.startsWith('workout.step.'))
        .map(([, template]) => template.text),
    )
    let seen = 0
    for (const kind of PUBLISHABLE) {
      for (const step of allSteps(planOf(make(kind, 75)))) {
        expect(names.has(step.label), `${kind}: ${step.label}`).toBe(true)
        seen += 1
      }
    }
    for (const step of allSteps(planOf(ladder(2, rungSessions(2)[0]!)))) {
      expect(names.has(step.label), step.label).toBe(true)
    }
    expect(seen).toBeGreaterThan(PUBLISHABLE.length)
  })

  it('writes the eased line from the copy, with no reason', () => {
    expect(easedLine('km')).toBe('Eased for today')
    expect(easedLine('mi')).toBe(easedLine('km'))
    const eased = planOf(make('intervals', 60), { eased: true })
    expect(eased.description.split('\n')[0]).toBe(easedLine('km'))
  })

  it('words the effort cue once', () => {
    expect(effortPhrase('km')).toBe('by effort')
    expect(planOf(make('hills', 60)).description).toContain(`, ${effortPhrase('km')}`)
  })
})

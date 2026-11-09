import { describe, expect, test } from 'vitest'
import { withoutMinutesShare } from '../../../web/components/engineText.ts'
import { runChartContext, type ChartSession } from '../../../shared/domain/runChartContext.ts'
import type { Step, ZoneSet } from '../../../shared/engine/types.ts'

const ZONES = {
  hr: { z1: [100, 142], z2: [143, 158], z3: [159, 175] },
  pace: { z1: [420, 380], z2: [380, 340], z3: [340, 300] },
  rpe: { z1: [2, 3], z2: [4, 5], z3: [6, 7] },
} as unknown as ZoneSet

const steady: Step = { kind: 'steady', reps: 1, durationSec: 2400, distanceM: null, zone: 'z1' }

function session(over: Partial<ChartSession>): ChartSession {
  return {
    kind: 'easy',
    structure: [steady],
    flags: [],
    target: { zone: 'z1', rpe: [2, 3], hr: [100, 140], paceSecPerKm: [420, 380], heatNote: null },
    ...over,
  }
}

describe('runChartContext', () => {
  test('a run that filled no session gets the ceiling of the current zones and no band', () => {
    expect(runChartContext(undefined, ZONES)).toEqual({
      plannedPaceSecPerKm: null,
      easyCeilingBpm: 142,
    })
    expect(runChartContext(undefined, null).easyCeilingBpm).toBeNull()
  })

  test('an easy session is steered by the ceiling: the ceiling from the zones, no pace band', () => {
    expect(runChartContext(session({}), ZONES)).toEqual({
      plannedPaceSecPerKm: null,
      easyCeilingBpm: 142,
    })
  })

  test('a steady session steered by pace gets the band and no ceiling', () => {
    const pace = session({
      kind: 'race-pace',
      structure: [],
      target: {
        zone: 'race-pace',
        rpe: [6, 7],
        hr: null,
        paceSecPerKm: [345, 335],
        heatNote: null,
      },
    })
    expect(runChartContext(pace, ZONES)).toEqual({
      plannedPaceSecPerKm: [345, 335],
      easyCeilingBpm: null,
    })
  })

  test('work paced sessions have no band: the stored pace is the work pace alone', () => {
    const work: Step[] = [
      { kind: 'warmup', reps: 1, durationSec: 900, distanceM: null, zone: 'z1' },
      { kind: 'work', reps: 4, durationSec: 240, distanceM: null, zone: 'z3' },
      { kind: 'recover', reps: 4, durationSec: 120, distanceM: null, zone: 'z1' },
    ]
    for (const kind of ['threshold', 'intervals'] as const) {
      const s = session({
        kind,
        structure: work,
        target: {
          zone: 'z3',
          rpe: [6, 7],
          hr: [159, 170],
          paceSecPerKm: [330, 310],
          heatNote: null,
        },
      })
      expect(runChartContext(s, ZONES)).toEqual({
        plannedPaceSecPerKm: null,
        easyCeilingBpm: null,
      })
    }
  })

  test('a pace session with a work step, a run-walk or a fast finish has no one pace', () => {
    const target = {
      zone: 'race-pace' as const,
      rpe: [6, 7] as [number, number],
      hr: null,
      paceSecPerKm: [345, 335] as [number, number],
      heatNote: null,
    }
    const work: Step = {
      kind: 'work',
      reps: 1,
      durationSec: 1200,
      distanceM: null,
      zone: 'race-pace',
    }
    expect(
      runChartContext(session({ kind: 'race-pace', structure: [work], target }), ZONES)
        .plannedPaceSecPerKm,
    ).toBeNull()
    expect(
      runChartContext(
        session({ kind: 'race-pace', structure: [], flags: ['run-walk'], target }),
        ZONES,
      ).plannedPaceSecPerKm,
    ).toBeNull()
    expect(
      runChartContext(session({ kind: 'long-fast-finish', structure: [], target }), ZONES)
        .plannedPaceSecPerKm,
    ).toBeNull()
  })

  test('a session steered by a heart-rate band has neither: heart rate above Z1 is the plan', () => {
    const long = session({
      kind: 'long',
      target: { zone: 'z2', rpe: [4, 5], hr: [143, 158], paceSecPerKm: [380, 340], heatNote: null },
    })
    expect(runChartContext(long, ZONES)).toEqual({
      plannedPaceSecPerKm: null,
      easyCeilingBpm: null,
    })
  })
})

describe('runChartContext: edge sessions', () => {
  test('a long run with a fast finish gets no ceiling: the finish is planned above Z1', () => {
    const finish: Step = { kind: 'work', reps: 1, durationSec: 900, distanceM: null, zone: 'z2' }
    const s = session({ kind: 'long-fast-finish', structure: [steady, finish] })
    expect(runChartContext(s, ZONES)).toEqual({ plannedPaceSecPerKm: null, easyCeilingBpm: null })
  })

  test('a run-walk session with every step in Z1 keeps the ceiling and has no band', () => {
    const walk: Step = { kind: 'recover', reps: 6, durationSec: 60, distanceM: null, zone: 'z1' }
    const run: Step = { kind: 'work', reps: 6, durationSec: 120, distanceM: null, zone: 'z1' }
    const s = session({ structure: [run, walk], flags: ['run-walk'] })
    expect(runChartContext(s, ZONES)).toEqual({ plannedPaceSecPerKm: null, easyCeilingBpm: 142 })
  })

  test('an empty structure is one stretch only for race pace and race', () => {
    const target = {
      zone: 'z3' as const,
      rpe: [6, 7] as [number, number],
      hr: [159, 170] as [number, number],
      paceSecPerKm: [330, 310] as [number, number],
      heatNote: null,
    }
    for (const kind of ['threshold', 'intervals'] as const) {
      expect(runChartContext(session({ kind, structure: [], target }), ZONES)).toEqual({
        plannedPaceSecPerKm: null,
        easyCeilingBpm: null,
      })
    }
    const race = { ...target, zone: 'race-pace' as const, hr: null }
    for (const kind of ['race-pace', 'race'] as const) {
      expect(
        runChartContext(session({ kind, structure: [], target: race }), ZONES).plannedPaceSecPerKm,
      ).toEqual([330, 310])
    }
  })
})

describe('withoutMinutesShare', () => {
  test('drops the sentence that sets minutes against minutes as a share, and only it', () => {
    const lines = [
      '26 min against 23 min planned (112%).',
      'Intensity stayed in the target range.',
      'Longer than the usual step.',
    ]
    expect(withoutMinutesShare(lines)).toEqual(lines.slice(1))
    expect(withoutMinutesShare([])).toEqual([])
  })
})

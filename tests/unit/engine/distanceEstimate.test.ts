// The distance estimate beside a session's minutes (STATUS follow-up 17): which sessions get one,
// which pace the minutes are run at, and when there is none to give.
import { describe, expect, it } from 'vitest'
import {
  easyPaceSecPerKm,
  estimateDistance,
  type EstimateSource,
  weekDistanceEstimateM,
  withDistanceEstimate,
} from '../../../shared/engine/distanceEstimate.ts'
import { RUN_KINDS } from '../../../shared/engine/sessions.ts'
import type { SessionKind, SessionSpec, ZoneSet } from '../../../shared/engine/types.ts'
import { prescribed, SESSION_KINDS, zoneSetFixture } from './fixtures.ts'

/** The fixture's Z1 pace range is 390 to 340 s/km: an easy pace of 365 s/km. */
const EASY_SEC_PER_KM = 365

const NO_PACE: ZoneSet = zoneSetFixture({ pace: null, csMps: null })

/** A hand-built session, so each expectation is arithmetic a reader can follow. */
function run(over: Partial<EstimateSource> = {}): EstimateSource {
  return {
    kind: 'easy',
    durationMin: 60,
    structure: [],
    flags: [],
    target: { zone: 'z1', rpe: [3, 4], hr: [120, 140], paceSecPerKm: [390, 340], heatNote: null },
    ...over,
  }
}

/** A threshold session: 15 min easy, 30 min work at a stored pace band of 310 to 290, 15 min easy. */
function threshold(over: Partial<EstimateSource> = {}): EstimateSource {
  return run({
    kind: 'threshold',
    structure: [
      { kind: 'warmup', reps: 1, durationSec: 900, distanceM: null, zone: 'z1' },
      { kind: 'work', reps: 1, durationSec: 1800, distanceM: null, zone: 'z2' },
      { kind: 'cooldown', reps: 1, durationSec: 900, distanceM: null, zone: 'z1' },
    ],
    target: { zone: 'z2', rpe: [5, 6], hr: [140, 155], paceSecPerKm: [310, 290], heatNote: null },
    ...over,
  })
}

describe('easyPaceSecPerKm', () => {
  it('is the middle of the Z1 pace range of the zones', () => {
    expect(easyPaceSecPerKm(zoneSetFixture())).toBe(EASY_SEC_PER_KM)
  })

  it('is null without pace zones', () => {
    expect(easyPaceSecPerKm(null)).toBeNull()
    expect(easyPaceSecPerKm(NO_PACE)).toBeNull()
  })
})

describe('estimateDistance: a run led by heart rate or effort', () => {
  it('covers its minutes at the easy pace', () => {
    // 3600 s / 365 s per km = 9.863 km
    expect(estimateDistance(run(), zoneSetFixture())).toEqual({ distanceM: 9863, basis: 'easy' })
  })

  it('scales with the minutes', () => {
    const forty = estimateDistance(run({ durationMin: 40 }), zoneSetFixture())
    expect(forty).toEqual({ distanceM: 6575, basis: 'easy' })
  })

  it('reads the zones as they are now, not the pace stored with the session', () => {
    const faster = zoneSetFixture({ pace: { z1: [330, 290], z2: [290, 270], z3: [270, 250] } })
    // 3600 s / 310 s per km = 11.613 km, though the session holds 390 to 340
    expect(estimateDistance(run(), faster)).toEqual({ distanceM: 11_613, basis: 'easy' })
  })

  it('is the same on a hot day: heat makes effort lead but does not change the distance', () => {
    // `resolveTargets` with `hot: true` would lead with effort for a threshold session; the
    // estimate resolves the targets for a day that is not hot, so a paced session stays paced.
    expect(estimateDistance(threshold({ flags: ['heat'] }), zoneSetFixture())?.basis).toBe('pace')
  })

  it.each<SessionKind>(['easy', 'recovery', 'long', 'long-fast-finish', 'b2b', 'strides', 'hills'])(
    'gives the %s run an estimate at the easy pace',
    (kind) => {
      const session = prescribed(kind)
      expect(estimateDistance(session, zoneSetFixture())).toEqual({
        distanceM: 9863,
        basis: 'easy',
      })
    },
  )

  it('gives a run with no steps (a session too short to hold them) the whole of its minutes', () => {
    expect(estimateDistance(run({ kind: 'hills', structure: [] }), zoneSetFixture())).toEqual({
      distanceM: 9863,
      basis: 'easy',
    })
  })
})

describe('estimateDistance: a session with a pace target of its own', () => {
  it('runs its work minutes at the middle of the band and the rest at the easy pace', () => {
    // work: 1800 s / 300 s per km = 6.000 km; easy: 1800 s / 365 s per km = 4.932 km
    expect(estimateDistance(threshold(), zoneSetFixture())).toEqual({
      distanceM: 10_932,
      basis: 'pace',
    })
  })

  it('runs a session with no steps wholly at its pace, and needs no zones to do it', () => {
    // 3600 s / 300 s per km = 12 km
    expect(estimateDistance(threshold({ structure: [] }), null)).toEqual({
      distanceM: 12_000,
      basis: 'pace',
    })
  })

  it('adds the recoveries between reps to the easy minutes', () => {
    const intervals = run({
      kind: 'intervals',
      durationMin: 40,
      structure: [
        { kind: 'warmup', reps: 1, durationSec: 600, distanceM: null, zone: 'z1' },
        { kind: 'work', reps: 5, durationSec: 180, distanceM: null, zone: 'z3' },
        { kind: 'recover', reps: 5, durationSec: 120, distanceM: null, zone: 'z1' },
        { kind: 'cooldown', reps: 1, durationSec: 600, distanceM: null, zone: 'z1' },
      ],
      target: { zone: 'z3', rpe: [7, 8], hr: null, paceSecPerKm: [280, 260], heatNote: null },
    })
    // work: 900 s / 270 = 3.333 km; easy: (2400 - 900) s / 365 = 4.110 km
    expect(estimateDistance(intervals, zoneSetFixture())).toEqual({
      distanceM: 7443,
      basis: 'pace',
    })
  })

  it('has none when the minutes around the work need an easy pace that is not known', () => {
    expect(estimateDistance(threshold(), null)).toBeNull()
    expect(estimateDistance(threshold(), NO_PACE)).toBeNull()
  })

  it('never counts more work than the session has minutes', () => {
    const over = threshold({ durationMin: 20 })
    expect(estimateDistance(over, zoneSetFixture())).toEqual({ distanceM: 4000, basis: 'pace' })
  })
})

describe('estimateDistance: no estimate', () => {
  it('has none for a runner with no pace data, never a guess', () => {
    expect(estimateDistance(run(), null)).toBeNull()
    expect(estimateDistance(run(), NO_PACE)).toBeNull()
    expect(estimateDistance(prescribed('long'), NO_PACE)).toBeNull()
  })

  it.each<SessionKind>(['hike', 'strength', 'mobility', 'cross', 'rest'])(
    'has none for a %s session',
    (kind) => {
      expect(estimateDistance(prescribed(kind), zoneSetFixture())).toBeNull()
      expect(estimateDistance(run({ kind }), zoneSetFixture())).toBeNull()
    },
  )

  it('has none for the race: its distance is the goal’s', () => {
    expect(estimateDistance(prescribed('race'), zoneSetFixture())).toBeNull()
  })

  it('has none for a run-walk session, whose minutes mix walking and running', () => {
    expect(estimateDistance(run({ flags: ['run-walk'] }), zoneSetFixture())).toBeNull()
  })

  it('has none for a session of no minutes', () => {
    expect(estimateDistance(run({ durationMin: 0 }), zoneSetFixture())).toBeNull()
  })

  it('has none, and does not throw, when the stored target cannot be read', () => {
    const broken = run({ target: {} as EstimateSource['target'] })
    expect(estimateDistance(broken, zoneSetFixture())).toBeNull()
  })

  it('classifies every kind: a run has an estimate against zones, anything else has none', () => {
    for (const kind of SESSION_KINDS) {
      const estimate = estimateDistance(prescribed(kind), zoneSetFixture())
      const expected = RUN_KINDS.has(kind) ? 'number' : 'null'
      expect(estimate === null ? 'null' : typeof estimate.distanceM, kind).toBe(expected)
    }
  })
})

describe('estimateDistance: agreement with the plan’s own distance', () => {
  // The engine turns minutes into distance when it builds a session (`distanceFor`, kept as
  // `SessionSpec.distanceM`) with the same easy pace and the same split of work and easy minutes.
  // For a session built against the current zones the two agree to the 100 m it rounds to.
  it.each<SessionKind>(['easy', 'recovery', 'long', 'b2b', 'threshold', 'intervals', 'race-pace'])(
    'matches the distance the engine stored for a %s session',
    (kind) => {
      const session: SessionSpec = prescribed(kind)
      const estimate = estimateDistance(session, zoneSetFixture())
      expect(session.distanceM).not.toBeNull()
      expect(estimate).not.toBeNull()
      expect(Math.abs(estimate!.distanceM - session.distanceM!)).toBeLessThanOrEqual(50)
    },
  )
})

describe('withDistanceEstimate', () => {
  it('attaches the estimate and leaves the rest of the session as it is', () => {
    const session = { ...run(), id: 's1' }
    const served = withDistanceEstimate(session, zoneSetFixture())
    expect(served).toEqual({ ...session, distanceEstimate: { distanceM: 9863, basis: 'easy' } })
    expect(session).not.toHaveProperty('distanceEstimate')
  })

  it('attaches null when there is none', () => {
    expect(
      withDistanceEstimate(run({ kind: 'strength' }), zoneSetFixture()).distanceEstimate,
    ).toBeNull()
  })
})

describe('weekDistanceEstimateM', () => {
  const planned = (
    kind: SessionKind,
    distanceM: number | null,
    over: { status?: string; durationMin?: number } = {},
  ) => ({
    kind,
    durationMin: over.durationMin ?? 45,
    status: over.status ?? 'planned',
    distanceEstimate: distanceM === null ? null : { distanceM, basis: 'easy' as const },
  })

  it('adds up the estimates of the runs', () => {
    expect(
      weekDistanceEstimateM([
        planned('easy', 7000),
        planned('long', 16_000),
        planned('threshold', 9000),
      ]),
    ).toBe(32_000)
  })

  it('leaves out a skipped run but keeps a settled one', () => {
    const week = [
      planned('easy', 7000, { status: 'completed' }),
      planned('easy', 7000, { status: 'skipped' }),
      planned('long', 16_000, { status: 'partial' }),
    ]
    expect(weekDistanceEstimateM(week)).toBe(23_000)
  })

  it('lets sessions that are not runs, and runs of no minutes, add nothing', () => {
    const week = [
      planned('easy', 7000),
      planned('strength', null),
      planned('hike', null),
      planned('mobility', null),
      planned('rest', null, { durationMin: 0 }),
      planned('easy', null, { durationMin: 0 }),
    ]
    expect(weekDistanceEstimateM(week)).toBe(7000)
  })

  it('has none when a run of the week has none: a partial sum would read as the whole week', () => {
    expect(weekDistanceEstimateM([planned('easy', 7000), planned('long', null)])).toBeNull()
    expect(weekDistanceEstimateM([planned('easy', 7000), planned('race', null)])).toBeNull()
  })

  it('has none for a week with no run', () => {
    expect(weekDistanceEstimateM([])).toBeNull()
    expect(weekDistanceEstimateM([planned('strength', null), planned('rest', null)])).toBeNull()
  })
})

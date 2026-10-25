// The distance estimate beside a session's minutes (STATUS follow-up 17): which sessions get one,
// which pace the minutes are run at, and when there is none to give.
import { describe, expect, it } from 'vitest'
import {
  easyPaceSecPerKm,
  estimateDistance,
  type EstimatePaces,
  type EstimateSource,
  recentPaceSecPerKm,
  weekDistanceEstimateM,
  withDistanceEstimate,
} from '../../../shared/engine/distanceEstimate.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { RUN_KINDS } from '../../../shared/engine/sessions.ts'
import type { SessionKind, SessionSpec, ZoneSet } from '../../../shared/engine/types.ts'
import { makeActivity, makeWeekRow } from '../../factories.ts'
import { prescribed, SESSION_KINDS, zoneSetFixture } from './fixtures.ts'

/** The fixture's Z1 pace range is 390 to 340 s/km: an easy pace of 365 s/km. */
const EASY_SEC_PER_KM = 365

const NO_PACE: ZoneSet = zoneSetFixture({ pace: null, csMps: null })

/** The paces of a runner with zones and no logged pace to fall back on. */
const zonesOnly = (zones: ZoneSet | null): EstimatePaces => ({ zones, recentPaceSecPerKm: null })

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
    expect(estimateDistance(run(), zonesOnly(zoneSetFixture()))).toEqual({
      distanceM: 9863,
      basis: 'easy',
    })
  })

  it('scales with the minutes', () => {
    const forty = estimateDistance(run({ durationMin: 40 }), zonesOnly(zoneSetFixture()))
    expect(forty).toEqual({ distanceM: 6575, basis: 'easy' })
  })

  it('reads the zones as they are now, not the pace stored with the session', () => {
    const faster = zoneSetFixture({ pace: { z1: [330, 290], z2: [290, 270], z3: [270, 250] } })
    // 3600 s / 310 s per km = 11.613 km, though the session holds 390 to 340
    expect(estimateDistance(run(), zonesOnly(faster))).toEqual({ distanceM: 11_613, basis: 'easy' })
  })

  it('is the same on a hot day: heat makes effort lead but does not change the distance', () => {
    // `resolveTargets` with `hot: true` would lead with effort for a threshold session; the
    // estimate resolves the targets for a day that is not hot, so a paced session stays paced.
    expect(
      estimateDistance(threshold({ flags: ['heat'] }), zonesOnly(zoneSetFixture()))?.basis,
    ).toBe('pace')
  })

  it.each<SessionKind>(['easy', 'recovery', 'long', 'long-fast-finish', 'b2b', 'strides', 'hills'])(
    'gives the %s run an estimate at the easy pace',
    (kind) => {
      const session = prescribed(kind)
      expect(estimateDistance(session, zonesOnly(zoneSetFixture()))).toEqual({
        distanceM: 9863,
        basis: 'easy',
      })
    },
  )

  it('gives a run with no steps (a session too short to hold them) the whole of its minutes', () => {
    expect(
      estimateDistance(run({ kind: 'hills', structure: [] }), zonesOnly(zoneSetFixture())),
    ).toEqual({
      distanceM: 9863,
      basis: 'easy',
    })
  })
})

describe('estimateDistance: a session with a pace target of its own', () => {
  it('runs its work minutes at the middle of the band and the rest at the easy pace', () => {
    // work: 1800 s / 300 s per km = 6.000 km; easy: 1800 s / 365 s per km = 4.932 km
    expect(estimateDistance(threshold(), zonesOnly(zoneSetFixture()))).toEqual({
      distanceM: 10_932,
      basis: 'pace',
    })
  })

  it('runs a session with no steps wholly at its pace, and needs no zones to do it', () => {
    // 3600 s / 300 s per km = 12 km
    expect(estimateDistance(threshold({ structure: [] }), zonesOnly(null))).toEqual({
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
    expect(estimateDistance(intervals, zonesOnly(zoneSetFixture()))).toEqual({
      distanceM: 7443,
      basis: 'pace',
    })
  })

  it('has none when the minutes around the work need an easy pace that is not known', () => {
    expect(estimateDistance(threshold(), zonesOnly(null))).toBeNull()
    expect(estimateDistance(threshold(), zonesOnly(NO_PACE))).toBeNull()
  })

  it('never counts more work than the session has minutes', () => {
    const over = threshold({ durationMin: 20 })
    expect(estimateDistance(over, zonesOnly(zoneSetFixture()))).toEqual({
      distanceM: 4000,
      basis: 'pace',
    })
  })
})

describe('estimateDistance: no estimate', () => {
  it('has none for a runner with no pace data, never a guess', () => {
    expect(estimateDistance(run(), zonesOnly(null))).toBeNull()
    expect(estimateDistance(run(), zonesOnly(NO_PACE))).toBeNull()
    expect(estimateDistance(prescribed('long'), zonesOnly(NO_PACE))).toBeNull()
  })

  it.each<SessionKind>(['hike', 'strength', 'mobility', 'cross', 'rest'])(
    'has none for a %s session',
    (kind) => {
      expect(estimateDistance(prescribed(kind), zonesOnly(zoneSetFixture()))).toBeNull()
      expect(estimateDistance(run({ kind }), zonesOnly(zoneSetFixture()))).toBeNull()
    },
  )

  it('has none for the race: its distance is the goal’s', () => {
    expect(estimateDistance(prescribed('race'), zonesOnly(zoneSetFixture()))).toBeNull()
  })

  it('has none for a run-walk session, whose minutes mix walking and running', () => {
    expect(estimateDistance(run({ flags: ['run-walk'] }), zonesOnly(zoneSetFixture()))).toBeNull()
  })

  it('has none for a session of no minutes', () => {
    expect(estimateDistance(run({ durationMin: 0 }), zonesOnly(zoneSetFixture()))).toBeNull()
  })

  it('has none, and does not throw, when the stored target cannot be read', () => {
    const broken = run({ target: {} as EstimateSource['target'] })
    expect(estimateDistance(broken, zonesOnly(zoneSetFixture()))).toBeNull()
  })

  it('classifies every kind: a run has an estimate against zones, anything else has none', () => {
    for (const kind of SESSION_KINDS) {
      const estimate = estimateDistance(prescribed(kind), zonesOnly(zoneSetFixture()))
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
      const estimate = estimateDistance(session, zonesOnly(zoneSetFixture()))
      expect(session.distanceM).not.toBeNull()
      expect(estimate).not.toBeNull()
      expect(Math.abs(estimate!.distanceM - session.distanceM!)).toBeLessThanOrEqual(50)
    },
  )
})

describe('estimateDistance: the recent logged pace stands in when the zones hold none', () => {
  /** A runner whose zones hold no pace and whose recent runs average 400 s/km. */
  const recent: EstimatePaces = { zones: NO_PACE, recentPaceSecPerKm: 400 }

  it('covers the minutes of a run led by heart rate or effort at the recent pace, and says so', () => {
    // 3600 s / 400 s per km = 9 km
    expect(estimateDistance(run(), recent)).toEqual({ distanceM: 9000, basis: 'recent' })
    expect(estimateDistance(run(), { zones: null, recentPaceSecPerKm: 400 })).toEqual({
      distanceM: 9000,
      basis: 'recent',
    })
  })

  it('lets the zones win when they hold a pace, whatever the recent runs say', () => {
    expect(estimateDistance(run(), { zones: zoneSetFixture(), recentPaceSecPerKm: 400 })).toEqual({
      distanceM: 9863,
      basis: 'easy',
    })
  })

  it('has none when neither the zones nor the recent runs give a pace', () => {
    expect(estimateDistance(run(), { zones: NO_PACE, recentPaceSecPerKm: null })).toBeNull()
    expect(estimateDistance(run(), { zones: null, recentPaceSecPerKm: null })).toBeNull()
  })

  it('counts the minutes around the work of a paced session at the recent pace', () => {
    // work: 1800 s / 300 s per km = 6.000 km; around it: 1800 s / 400 s per km = 4.500 km
    expect(estimateDistance(threshold(), recent)).toEqual({ distanceM: 10_500, basis: 'pace' })
  })

  it('leaves the other kinds as they were: no estimate for a hike, the race or a run-walk session', () => {
    expect(estimateDistance(run({ kind: 'hike' }), recent)).toBeNull()
    expect(estimateDistance(prescribed('race'), recent)).toBeNull()
    expect(estimateDistance(run({ flags: ['run-walk'] }), recent)).toBeNull()
  })

  it('never takes a recent pace that is not a pace', () => {
    expect(estimateDistance(run(), { zones: null, recentPaceSecPerKm: 0 })).toBeNull()
  })
})

describe('recentPaceSecPerKm', () => {
  // Five Mondays; the pace window is the last `trainingPaceWeeks` of them, from 2026-09-28.
  const MONDAYS = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']
  /** Weekly rows that hold 100 min over 15 km: 400 s/km, the weekly median the fallback reads. */
  const weeks = MONDAYS.map((weekStart) => makeWeekRow({ weekStart, runMin: 100, runM: 15_000 }))
  const state = { weeks }
  const noPaceZones = zoneSetFixture({ pace: null })
  /** An easy-heart-rate limit of 140 bpm: the top of Z1. */
  const withLimit = zoneSetFixture({
    pace: null,
    lt1Hr: { value: 140, band: [135, 145], source: 'profile', asOf: '2026-10-21' },
  })

  /** A logged run of `min` minutes at `secPerKm`, on `date`. */
  const logged = (
    date: string,
    secPerKm: number,
    over: Partial<ReturnType<typeof makeActivity>> = {},
    min = 30,
  ) =>
    makeActivity({ date, durationSec: min * 60, distanceM: (min * 60 * 1000) / secPerKm, ...over })
  const pace = (
    activities: ReturnType<typeof makeActivity>[],
    zones: ZoneSet | null = noPaceZones,
  ) => recentPaceSecPerKm({ activities, state, zones })

  it('reads the same weeks as the training pace, and the Param names them', () => {
    expect(P.macroDesign.trainingPaceWeeks.value).toBe(4)
    // A run before the window (2026-09-21) does not count, however fast it was.
    const runs = [
      logged('2026-09-21', 200),
      logged('2026-09-28', 380),
      logged('2026-10-05', 390),
      logged('2026-10-12', 400),
      logged('2026-10-19', 410),
    ]
    // Four runs with no heart rate: the fastest quarter (380) is left out, the median of 390, 400
    // and 410 is 400.
    expect(pace(runs)).toBeCloseTo(400, 6)
  })

  it('leaves out the fastest quarter of the runs that have no heart rate to judge by', () => {
    expect(P.macroDesign.recentPaceFastestShare).toMatchObject({ value: 0.25, grade: 'D' })
    const runs = [
      logged('2026-09-30', 300),
      logged('2026-10-06', 360),
      logged('2026-10-09', 380),
      logged('2026-10-13', 400),
      logged('2026-10-16', 420),
      logged('2026-10-18', 440),
      logged('2026-10-20', 460),
      logged('2026-10-20', 480),
    ]
    // Eight runs: the fastest two (300, 360) go, the median of 380, 400, 420, 440, 460, 480 is 430.
    expect(pace(runs)).toBeCloseTo(430, 6)
  })

  it('leaves out races, flagged duplicates, runs without a distance and runs under the shortest session', () => {
    expect(P.restartFloor.sessionMin.value).toBe(20)
    const easy = [logged('2026-10-05', 390), logged('2026-10-08', 400), logged('2026-10-12', 410)]
    const noise = [
      logged('2026-10-14', 250, { type: 'race' }),
      logged('2026-10-15', 250, { duplicateStatus: 'possible' }),
      logged('2026-10-16', 250, { duplicateStatus: 'confirmed' }),
      logged('2026-10-17', 250, { distanceM: null }),
      logged('2026-10-17', 250, { distanceM: 0 }),
      logged('2026-10-18', 250, {}, 19),
      logged('2026-10-19', 250, { type: 'cross' }),
    ]
    // Three runs are left, so none of them is a "fastest quarter": the median stands.
    expect(pace([...easy, ...noise])).toBeCloseTo(400, 6)
    // A flagged duplicate that was dismissed is a run like any other: four runs, the fastest
    // quarter (390) goes, the median of 400, 410 and 420 is 410.
    expect(
      pace([...easy, logged('2026-10-15', 420, { duplicateStatus: 'dismissed' })]),
    ).toBeCloseTo(410, 6)
  })

  it('leaves out the runs above the easy heart-rate limit when the zones hold one', () => {
    const runs = [
      logged('2026-10-05', 400, { avgHr: 135 }),
      logged('2026-10-08', 410, { avgHr: 138 }),
      logged('2026-10-10', 420, { avgHr: 139 }),
      logged('2026-10-13', 350, { avgHr: 142 }),
      logged('2026-10-15', 330, { avgHr: 150 }),
    ]
    // The two runs above 140 bpm go; the median of the three easy ones is 410.
    expect(pace(runs, withLimit)).toBeCloseTo(410, 6)
    // With no limit to judge by (no heart-rate zones) the heart rate says nothing: five runs with
    // no judgement, the fastest quarter (one run, 330) goes, the median of 350, 400, 410, 420 is 405.
    expect(pace(runs, noPaceZones)).toBeCloseTo(405, 6)
  })

  it('judges a run with a heart rate by it and one without by its pace, in one window', () => {
    const runs = [
      logged('2026-10-05', 400, { avgHr: 130 }),
      logged('2026-10-08', 300, { avgHr: 160 }),
      logged('2026-10-12', 410),
      logged('2026-10-14', 420),
      logged('2026-10-16', 430),
      logged('2026-10-18', 340),
    ]
    // By heart rate: 400 stays, 300 goes. By pace among the four with none: 340 goes (one in four).
    // Left: 400, 410, 420, 430, median 415.
    expect(pace(runs, withLimit)).toBeCloseTo(415, 6)
  })

  it('falls back to the weekly median of the window when fewer than three runs are left', () => {
    expect(P.macroDesign.recentPaceMinRuns).toMatchObject({ value: 3, grade: 'D' })
    // Two runs, whose paces (350, 360) the weekly rows do not show: the weeks say 400.
    expect(pace([logged('2026-10-05', 350), logged('2026-10-12', 360)])).toBeCloseTo(400, 6)
    // No runs at all in the window: the same.
    expect(pace([])).toBeCloseTo(400, 6)
    // Three runs where the fastest quarter leaves two, with none above a limit: the same.
    expect(
      pace(
        [logged('2026-10-05', 350), logged('2026-10-12', 360), logged('2026-10-14', 370)],
        noPaceZones,
      ),
    ).toBeCloseTo(360, 6)
  })

  it('is null when nothing logged says anything', () => {
    expect(
      recentPaceSecPerKm({
        activities: [],
        state: { weeks: MONDAYS.map((weekStart) => makeWeekRow({ weekStart })) },
        zones: null,
      }),
    ).toBeNull()
    expect(recentPaceSecPerKm({ activities: [], state: { weeks: [] }, zones: null })).toBeNull()
  })
})

describe('withDistanceEstimate', () => {
  it('attaches the estimate and leaves the rest of the session as it is', () => {
    const session = { ...run(), id: 's1' }
    const served = withDistanceEstimate(session, zonesOnly(zoneSetFixture()))
    expect(served).toEqual({ ...session, distanceEstimate: { distanceM: 9863, basis: 'easy' } })
    expect(session).not.toHaveProperty('distanceEstimate')
  })

  it('attaches null when there is none', () => {
    expect(
      withDistanceEstimate(run({ kind: 'strength' }), zonesOnly(zoneSetFixture())).distanceEstimate,
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

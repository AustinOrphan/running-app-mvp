import { describe, expect, it } from 'vitest'
import { rehearsalFor, type RehearsalInput } from '../../../shared/engine/rehearsal.ts'
import { TERRAIN_BINS_VERSION, TERRAIN_EDGES_PCT } from '../../../shared/domain/terrainShape.ts'
import type { Activity, TerrainBins } from '../../../shared/types.ts'
import { makeActivity } from '../../factories.ts'

// Chicago-like home place; sunset on 2026-10-10 is about 18:10 CDT (23:10 UTC), civil twilight ends
// about 18:40 CDT (23:40 UTC), sunrise about 07:05 CDT (12:05 UTC).
const HOME = { homeLat: 41.88, homeLng: -87.63 }
const TODAY = '2026-10-12'

function bins(downSecByBand: number[], others = 0): TerrainBins {
  const n = TERRAIN_EDGES_PCT.length + 1
  const sec = new Array<number>(n).fill(0)
  downSecByBand.forEach((s, i) => (sec[i] = s))
  sec[4] = others
  return {
    v: TERRAIN_BINS_VERSION,
    windowM: 60,
    walkMps: 1,
    edgesPct: [...TERRAIN_EDGES_PCT],
    sec,
    m: sec.map((s) => s * 2),
    walkSec: new Array<number>(n).fill(0),
    flatCv: null,
  }
}

function runAt(id: string, date: string, startUtc: string | null, over: Partial<Activity> = {}) {
  return makeActivity({
    id,
    date,
    type: 'run',
    startUtc,
    durationSec: 3600,
    movingSec: 3600,
    ...over,
  })
}

function input(activities: Activity[], over: Partial<RehearsalInput> = {}): RehearsalInput {
  return { activities, ...HOME, today: TODAY, night: true, downhill: true, ...over }
}

describe('rehearsalFor', () => {
  it('is null when the plan asks for neither kind', () => {
    expect(rehearsalFor(input([], { night: false, downhill: false }))).toBeNull()
  })

  it('counts a run that is partly in the dark and sums its dark minutes', () => {
    // 22:40 to 23:40 UTC on 10-10: sunset at 23:10, civil twilight ends 23:40, so the whole hour is
    // light by the -6 degree rule; a run from 23:00 for 90 min is dark from about 23:40.
    const dusk = runAt('dusk', '2026-10-10', '2026-10-10T23:00:00Z', {
      durationSec: 5400,
      movingSec: 5400,
    })
    const day = runAt('day', '2026-10-11', '2026-10-11T16:00:00Z')
    const r = rehearsalFor(input([dusk, day]))!
    expect(r.night!.runs).toBe(1)
    expect(r.night!.darkMin).toBeGreaterThanOrEqual(45)
    expect(r.night!.darkMin).toBeLessThanOrEqual(55)
    expect(r.night!.unplaced).toBe(0)
    expect(r.runs).toBe(2)
  })

  it('does not count a run with fewer dark minutes than the threshold', () => {
    const edge = runAt('edge', '2026-10-10', '2026-10-10T22:55:00Z', {
      durationSec: 3000,
      movingSec: 3000,
    })
    expect(rehearsalFor(input([edge]))!.night!.runs).toBe(0)
  })

  it('uses the moving time, not the elapsed time', () => {
    const stopped = runAt('stopped', '2026-10-11', '2026-10-11T12:00:00Z', {
      durationSec: 7200,
      movingSec: 1500,
    })
    // Sunrise 12:05 UTC, civil dawn about 11:35: the first 25 moving minutes are mostly light.
    expect(rehearsalFor(input([stopped]))!.night!.runs).toBe(0)
  })

  it('reports runs it cannot place instead of calling them day', () => {
    const noStart = runAt('a', '2026-10-11', null)
    const r = rehearsalFor(input([noStart]))!
    expect(r.night).toMatchObject({ runs: 0, unplaced: 1 })
    const noHome = rehearsalFor(
      input([runAt('b', '2026-10-11', '2026-10-11T02:00:00Z')], { homeLat: null, homeLng: null }),
    )!
    expect(noHome.night!.unplaced).toBe(1)
    const ownStart = rehearsalFor(
      input(
        [runAt('c', '2026-10-11', '2026-10-11T02:00:00Z', { startLat: 41.9, startLng: -87.6 })],
        {
          homeLat: null,
          homeLng: null,
        },
      ),
    )!
    expect(ownStart.night).toMatchObject({ runs: 1, unplaced: 0 })
  })

  it('leaves out duplicates, treadmill runs, other types and days outside the window', () => {
    const at = '2026-10-11T02:00:00Z'
    const rows = [
      runAt('dup', '2026-10-10', at, { duplicateStatus: 'confirmed', duplicateOfId: 'x' }),
      runAt('tm', '2026-10-10', at, { subtype: 'treadmill' }),
      runAt('str', '2026-10-10', at, { type: 'strength' }),
      runAt('old', '2026-07-01', '2026-07-02T03:00:00Z'),
      runAt('in', '2026-10-10', at),
    ]
    const r = rehearsalFor(input(rows))!
    expect(r.runs).toBe(1)
    expect(r.night!.runs).toBe(1)
    expect(r.from).toBe('2026-07-21')
    expect(r.to).toBe(TODAY)
  })

  it('sums the minutes on bands of -6 percent and steeper, and counts long runs with sustained descent', () => {
    const long = runAt('long', '2026-10-05', null, {
      durationSec: 7200,
      terrainBins: bins([300, 300, 600], 5000),
    })
    const shortRun = runAt('short', '2026-10-06', null, {
      durationSec: 3000,
      terrainBins: bins([0, 0, 900], 2000),
    })
    const mildLong = runAt('mild', '2026-10-07', null, {
      durationSec: 7200,
      // Band 3 is -6 to -3: not counted.
      terrainBins: bins([0, 0, 120, 3000], 3000),
    })
    const r = rehearsalFor(input([long, shortRun, mildLong], { night: false }))!
    expect(r.night).toBeNull()
    expect(r.downhill).toMatchObject({
      bandMaxPct: -6,
      minutes: 20 + 15 + 2,
      longRuns: 1,
      runsWithBins: 3,
      runsWithoutBins: 0,
    })
  })

  it('counts runs without altitude or without bins apart from the downhill figure', () => {
    const flat = runAt('flat', '2026-10-05', null, { terrainBins: bins([], 0) })
    const none = runAt('none', '2026-10-06', null, { terrainBins: null })
    const r = rehearsalFor(input([flat, none], { night: false }))!
    expect(r.downhill).toMatchObject({ minutes: 0, runsWithBins: 0, runsWithoutBins: 2 })
  })

  it('names the rules of the kinds it counts', () => {
    expect(rehearsalFor(input([], { downhill: false }))!.rules).toEqual(['H6'])
    expect(rehearsalFor(input([], { night: false }))!.rules).toEqual(['H5'])
  })
})

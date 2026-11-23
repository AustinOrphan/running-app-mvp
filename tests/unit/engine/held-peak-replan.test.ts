// A re-plan with nothing new returns the weeks it stored, for a peak week the weekly decision held.
// The state comes from the simulated first-100-mile runner at a ragged level (`SimAthlete` output,
// synthetic, trimmed to the columns the engine reads; the JSON beside this test, kept out of
// Prettier): a recovery week of the plan being replaced that the peak rule makes the peak (the taper
// follows) and the weekly decision holds at 76 minutes, the week before it cut by a short window.
// Stored without its recovery flag, the peak week read three ways that the first draw did not: as a
// restart (76 under the 3 x 30 floor, though the loading weeks before it stood at 99 and 102), as the
// highest week of its sequence (the taper fell from 76 and not from the 102 of the week before, which
// the window had cut and the runner had run as asked) and as a week to draw from its cap, not to scale
// to it (a longer long run).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Activity } from '../../../shared/types.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { replanMonday, withStoredPlan } from './sim-athlete.ts'

type Row = [
  id: string,
  date: string,
  type: Activity['type'],
  durationSec: number,
  distanceM: number | null,
  source: Activity['source'],
  rpe: number | null,
  startTime: string | null,
]
type Stored = Omit<EngineInput, 'activities'> & { activities: Row[] }

const base = {
  userId: 'u1',
  avgHr: null,
  maxHr: null,
  elevationGainM: null,
  notes: null,
  providerKey: null,
  importBatchId: null,
  duplicateOfId: null,
  duplicateStatus: 'none',
  subtype: null,
  startUtc: null,
  utcOffsetMin: null,
  movingSec: null,
  elevationLossM: null,
  avgCadence: null,
  avgPowerW: null,
  deviceName: null,
  startLat: null,
  startLng: null,
  tempC: null,
  dewPointC: null,
  windKph: null,
  humidityPct: null,
  weatherSource: null,
  hrHistogram: null,
  terrainBins: null,
  surfaceBins: null,
  hrQuality: null,
  decouplingPct: null,
  gapDistanceM: null,
  feel: null,
  pain: null,
  heatExposure: null,
  createdAt: '2026-10-21T00:00:00Z',
  updatedAt: '2026-10-21T00:00:00Z',
} as const

function load(): EngineInput {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, 'held-peak-26.json'), 'utf8'),
  ) as Stored
  const activities = raw.activities.map(
    ([id, date, type, durationSec, distanceM, source, rpe, startTime]): Activity => ({
      ...base,
      id,
      date,
      type,
      durationSec,
      distanceM,
      source,
      rpe,
      startTime,
    }),
  )
  return { ...raw, activities }
}

const week = (d: PlanDraft, weekStart: string) => d.weeks.find((w) => w.weekStart === weekStart)!
const taper = (d: PlanDraft) => d.weeks.filter((w) => w.isTaper).map((w) => w.targetRunMin)

describe('a peak week that was a recovery week and is held', () => {
  it('draws the week from its cap, with no restart, and the taper from the loading week before', () => {
    const settled = load()
    const stored = replanMonday(settled).draft
    const peak = week(stored, settled.today)
    expect(peak.flags).toContain('peak')
    expect(peak.flags).not.toContain('restart-floor')
    expect(peak.targetRunMin).toBe(76)
    // the week before was planned at 102 and run as the window left it
    expect(taper(stored)).toEqual([66, 40])
  })

  it('is the plan it stored, with nothing new', () => {
    const settled = load()
    const stored = replanMonday(settled).draft
    const again = replanMonday(withStoredPlan({ settled, draft: stored })).draft
    expect(again).toEqual(stored)
  })
})

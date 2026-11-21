// A re-plan with nothing new returns the taper it stored. The state comes from the simulated
// first-100-mile runner at a ragged level (`SimAthlete` output, synthetic, trimmed to the columns the
// engine reads; the JSON beside this test, kept out of Prettier): a recovery week that the peak rule
// turned into the peak (the taper follows) keeps its recovery minutes. Stored without the recovery
// flag, the peak week read as the highest week of its sequence, and the taper fell from it a second
// time.
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
    readFileSync(join(import.meta.dirname, 'taper-reference-26.json'), 'utf8'),
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

const targets = (d: PlanDraft, from: string) =>
  d.weeks.filter((w) => w.weekStart >= from).map((w) => [w.weekStart, w.targetRunMin] as const)

describe('the taper of a peak that was a recovery week', () => {
  it('is the taper the plan stored, with nothing new', () => {
    const settled = load()
    const stored = replanMonday(settled).draft
    const again = replanMonday(withStoredPlan({ settled, draft: stored })).draft
    expect(targets(again, settled.today)).toEqual(targets(stored, settled.today))
  })
})

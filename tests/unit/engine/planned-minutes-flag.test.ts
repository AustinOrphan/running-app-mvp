// A re-plan with nothing new returns the weeks it stored. The state comes from the simulated
// first-100-mile runner at a ragged level (`SimAthlete` output, synthetic, trimmed to the columns the
// engine reads; the JSON beside this test, kept out of Prettier): the week in progress was planned at
// 99 and placed at 87, under the 3 x 30 restart floor (90), the week before it being the floor week.
// Stored with its placed figure alone, the re-plan read the week as a restart and drew the floor
// again. The week keeps `planned-99`, and the restart test reads that.
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
    readFileSync(join(import.meta.dirname, 'planned-minutes-13.json'), 'utf8'),
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
  d.weeks
    .filter((w) => w.weekStart >= from)
    .map((w) => [w.weekStart, w.targetRunMin, w.flags.includes('restart-floor')] as const)

describe('a week placed short of its plan', () => {
  it('keeps its planned minutes and is no restart at the next re-plan', () => {
    const settled = load()
    const stored = replanMonday(settled).draft
    expect(stored.weeks.find((w) => w.weekStart === settled.today)?.flags).toContain('planned-99')
    const again = replanMonday(withStoredPlan({ settled, draft: stored })).draft
    expect(targets(again, settled.today)).toEqual(targets(stored, settled.today))
  })

  it('reads a stored plan without the flag as before', () => {
    const settled = load()
    const stored = replanMonday(settled).draft
    const bare = {
      ...stored,
      weeks: stored.weeks.map((w) => ({
        ...w,
        flags: w.flags.filter((f) => !f.startsWith('planned-')),
      })),
    }
    const again = replanMonday(withStoredPlan({ settled, draft: bare })).draft
    expect(again.weeks.find((w) => w.weekStart === settled.today)?.flags).toContain('restart-floor')
  })
})

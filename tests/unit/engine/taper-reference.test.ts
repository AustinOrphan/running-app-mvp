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
  // The recorded week before the peak holds 35 of its 99 planned minutes; one more run brings it to
  // 85, a week that was run (the taper floor reads executed minutes, rule K2).
  const topUp: Activity = {
    ...base,
    id: 'top-up',
    date: '2027-04-14',
    type: 'run',
    durationSec: 50 * 60,
    distanceM: 9000,
    source: 'manual',
    rpe: 3,
    startTime: null,
  }
  return { ...raw, activities: [...activities, topUp] }
}

const targets = (d: PlanDraft, from: string) =>
  d.weeks.filter((w) => w.weekStart >= from).map((w) => [w.weekStart, w.targetRunMin] as const)

const taper = (d: PlanDraft) => d.weeks.filter((w) => w.isTaper).map((w) => w.targetRunMin)

describe('the taper of a peak that was a recovery week', () => {
  it('is the taper the plan stored, with nothing new', () => {
    const settled = load()
    const stored = replanMonday(settled).draft
    const again = replanMonday(withStoredPlan({ settled, draft: stored })).draft
    expect(targets(again, settled.today)).toEqual(targets(stored, settled.today))
  })
  it('keeps the stored taper of 64 and 39 minutes', () => {
    const settled = load()
    const stored = replanMonday(settled).draft
    const again = replanMonday(withStoredPlan({ settled, draft: stored })).draft
    expect(taper(again)).toEqual([64, 39])
  })
})

// The floor needs a build that was run: after a layoff the week before the peak was not, and the
// taper keeps the size the peak gives it (rules K2, G6). The ceilings are the figures the plan drew
// before the floor existed.
describe('the taper after a layoff before it', () => {
  it.each([
    ['2027-03-29', [39, 24]],
    ['2027-03-22', [40, 24]],
    ['2027-04-05', [48, 30]],
  ] as const)('a layoff from %s draws no taper above %j', (from, ceiling) => {
    const settled = load()
    const stored = replanMonday(settled).draft
    const st = withStoredPlan({ settled, draft: stored })
    const inp = { ...st, activities: st.activities.filter((a) => a.date < from) }
    const drawn = taper(replanMonday(inp).draft)
    expect(drawn).toHaveLength(ceiling.length)
    drawn.forEach((m, i) => expect(m).toBeLessThanOrEqual(ceiling[i] as number))
  })
})

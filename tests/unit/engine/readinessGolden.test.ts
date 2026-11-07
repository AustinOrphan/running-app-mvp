// A golden of Today's readiness read: the sentences of `readinessSignals` and the heart-rate
// variability and resting-heart-rate fields of `readinessSnapshot`, over fixed synthetic histories
// that cover the default profile, the cycle-aware (female) profile, gaps, a drop and a spike.
// The baseline selection of `hrvOn` and `restingHrEval` is shared with `recentRange` (rule T1),
// so a change there must leave every line of this file as it stands. Regenerate only on purpose:
// `UPDATE_READINESS_GOLDEN=1 npx vitest run --project server tests/unit/engine/readinessGolden.test.ts`.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderFact } from '../../../shared/copy/templates.ts'
import { addDays } from '../../../shared/dates.ts'
import { readinessSignals, readinessSnapshot } from '../../../shared/engine/readiness.ts'
import type { EngineInput } from '../../../shared/engine/types.ts'
import { input, profile, TODAY, wellnessDay } from './e8-fixtures.ts'

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'readinessGolden.json')

/** A small deterministic generator, so the histories never change between runs. */
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

interface Shape {
  /** Chance in [0, 1) that a day has no reading at all. */
  gap: number
  /** Days (counted back from today) whose heart-rate variability is cut to 70 percent. */
  dropDays: number[]
  /** Days whose resting heart rate is raised by 9 bpm. */
  spikeDays: number[]
  /** Days of history before today. */
  days: number
}

function history(seed: number, shape: Shape): EngineInput['wellness'] {
  const next = lcg(seed)
  const rows: EngineInput['wellness'] = []
  for (let back = shape.days; back >= 0; back--) {
    const date = addDays(TODAY, -back)
    if (next() < shape.gap) continue
    const hrv = 55 + next() * 14
    const rest = 49 + next() * 5
    rows.push(
      wellnessDay(date, {
        hrvRmssd: Math.round((shape.dropDays.includes(back) ? hrv * 0.7 : hrv) * 10) / 10,
        restingHr: Math.round(shape.spikeDays.includes(back) ? rest + 9 : rest),
        sleepSec: Math.round((6 + next() * 2.5) * 3600),
      }),
    )
  }
  return rows
}

const SCENARIOS: Array<{ name: string; sex: 'male' | 'female'; seed: number; shape: Shape }> = [
  {
    name: 'steady',
    sex: 'male',
    seed: 11,
    shape: { gap: 0, dropDays: [], spikeDays: [], days: 70 },
  },
  {
    name: 'gaps',
    sex: 'male',
    seed: 23,
    shape: { gap: 0.35, dropDays: [], spikeDays: [], days: 70 },
  },
  {
    name: 'drop and spike',
    sex: 'male',
    seed: 37,
    shape: { gap: 0.05, dropDays: [0, 1, 2, 9], spikeDays: [0, 1, 4], days: 70 },
  },
  {
    name: 'cycle steady',
    sex: 'female',
    seed: 41,
    shape: { gap: 0, dropDays: [], spikeDays: [], days: 70 },
  },
  {
    name: 'cycle gaps and drop',
    sex: 'female',
    seed: 53,
    shape: { gap: 0.25, dropDays: [0, 1, 3], spikeDays: [0], days: 70 },
  },
  {
    name: 'short history',
    sex: 'male',
    seed: 67,
    shape: { gap: 0.1, dropDays: [], spikeDays: [], days: 8 },
  },
]

function lines(): string[] {
  const out: string[] = []
  for (const scenario of SCENARIOS) {
    const wellness = history(scenario.seed, scenario.shape)
    const base = input({ profile: profile({ sex: scenario.sex }), wellness })
    for (let back = 40; back >= 0; back--) {
      const date = addDays(TODAY, -back)
      const signals = readinessSignals({ ...base, today: date }, date)
      const snap = readinessSnapshot({ ...base, today: date }, date)
      out.push(
        JSON.stringify({
          scenario: scenario.name,
          date,
          signals: signals.map((s) => `${s.code}|${s.noted}|${renderFact(s, 'km')}`),
          hrv: snap.hrv,
          restingHrFlag: snap.restingHrFlag,
          sleepAvgH: snap.sleepAvgH,
          state: snap.state,
        }),
      )
    }
  }
  return out
}

describe('readiness golden', () => {
  it('reads every synthetic day as the committed golden does', () => {
    const actual = lines()
    if (process.env.UPDATE_READINESS_GOLDEN === '1') {
      writeFileSync(GOLDEN, JSON.stringify(actual, null, 1) + '\n')
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as string[]
    expect(actual).toHaveLength(golden.length)
    expect(actual).toEqual(golden)
  })

  it('exercises both the low and the building sentences', () => {
    const all = lines().join('\n')
    expect(all).toContain('hrv|true|')
    expect(all).toContain('hrv|false|')
    expect(all).toContain('resting-hr|true|')
    expect(all).toContain('Building your usual HRV range')
  })
})

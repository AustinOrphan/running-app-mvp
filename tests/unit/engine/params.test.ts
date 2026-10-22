import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allParams,
  P,
  PARAM_SECTIONS,
  PARAMS_VERSION,
  paramsForRule,
  sectionParams,
} from '../../../shared/engine/params/index.ts'
import type { Param, SessionKind } from '../../../shared/engine/types.ts'

const RESEARCH = join(import.meta.dirname, '../../../research')
const papers = new Set(
  readdirSync(join(RESEARCH, 'papers'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, '')),
)
const engineRules = readFileSync(join(RESEARCH, 'engine-rules.md'), 'utf8')
const all = allParams()

/** Rule ids that are not headings of engine-rules.md. */
function isDocumentedRule(rule: string): boolean {
  return !/^(design-|F-lib$|m-|n-)/.test(rule)
}

describe('parameter registry', () => {
  it('has a dated version', () => {
    expect(PARAMS_VERSION).toBe('2026-10-22.1')
  })

  it('holds a few hundred parameters, every section non-empty', () => {
    expect(all.length).toBeGreaterThan(250)
    for (const section of Object.keys(PARAM_SECTIONS) as Array<keyof typeof PARAM_SECTIONS>) {
      expect(sectionParams(section).length, section).toBeGreaterThan(0)
    }
  })

  it('merges every section group into P without a name clash', () => {
    const groups = Object.values(PARAM_SECTIONS).reduce(
      (n, group) => n + Object.keys(group).length,
      0,
    )
    expect(Object.keys(P)).toHaveLength(groups)
  })

  it('gives each parameter the id <group>.<name> and keeps ids unique', () => {
    const ids = new Set<string>()
    for (const [group, members] of Object.entries(P)) {
      for (const [name, p] of Object.entries(members as Record<string, Param<unknown>>)) {
        expect(p.id).toBe(`${group}.${name}`)
        expect(ids.has(p.id), p.id).toBe(false)
        ids.add(p.id)
      }
    }
    expect(ids.size).toBe(all.length)
  })

  it('cites only papers that exist in research/papers', () => {
    const missing = all.flatMap((p) =>
      p.evidence.filter((id) => !papers.has(id)).map((id) => `${p.id}: ${id}`),
    )
    expect(missing).toEqual([])
  })

  it('gives every grade D parameter a note that says it is a default', () => {
    const bad = all
      .filter((p) => p.grade === 'D' && !/default/i.test(p.note ?? ''))
      .map((p) => p.id)
    expect(bad).toEqual([])
  })

  it('backs every grade A, B or C parameter with at least one paper', () => {
    const bare = all.filter((p) => p.grade !== 'D' && p.evidence.length === 0).map((p) => p.id)
    expect(bare).toEqual([])
  })

  it('has finite numeric values, ordered ranges and values inside their range', () => {
    for (const p of all) {
      const values = Array.isArray(p.value) ? (p.value as unknown[]) : [p.value]
      for (const v of values) expect(Number.isFinite(v), p.id).toBe(true)
      if (p.range) {
        expect(p.range[0], p.id).toBeLessThanOrEqual(p.range[1] as number)
        if (typeof p.value === 'number') {
          expect(p.value, p.id).toBeGreaterThanOrEqual(p.range[0] as number)
          expect(p.value, p.id).toBeLessThanOrEqual(p.range[1] as number)
        }
      }
      expect(['A', 'B', 'C', 'D']).toContain(p.grade)
      expect(p.rule.length, p.id).toBeGreaterThan(0)
    }
  })

  it('points every parameter at a rule heading of engine-rules.md', () => {
    const missing = [
      ...new Set(
        all
          .filter((p) => isDocumentedRule(p.rule))
          .filter((p) => !new RegExp(`\\*\\*${p.rule} `, 'i').test(engineRules))
          .map((p) => p.rule),
      ),
    ]
    expect(missing).toEqual([])
  })

  it('finds the parameters of a rule', () => {
    expect(paramsForRule('g-1').map((p) => p.id)).toContain('g1.spikeRatioWarn')
    expect(paramsForRule('G-1').map((p) => p.id)).not.toContain('global3.minObservations')
  })

  it('has an expected RPE range for every session kind', () => {
    const kinds: SessionKind[] = [
      'easy',
      'recovery',
      'long',
      'long-fast-finish',
      'threshold',
      'intervals',
      'race-pace',
      'strides',
      'hills',
      'hike',
      'b2b',
      'strength',
      'mobility',
      'rest',
      'race',
      'cross',
    ]
    for (const kind of kinds) {
      const [low, high] = P.expectedRpe[kind].value
      expect(low, kind).toBeLessThanOrEqual(high)
      expect(high, kind).toBeLessThanOrEqual(10)
    }
  })

  it('transcribes the numbers of the rules exactly', () => {
    expect([P.a2.acuteDays.value, P.a2.chronicDays.value]).toEqual([7, 42])
    expect([P.g1.spikeRatioWarn.value, P.g1.spikeRatioOverride.value]).toEqual([1.1, 2])
    expect(P.g1.spikeRatioWarn.grade).toBe('B')
    expect([P.g2.rampSoft.value, P.g2.rampCeilingTwoWeeks.value]).toEqual([0.1, 0.3])
    expect([P.c3.hrMaxIntercept.value, P.c3.hrMaxAgeSlope.value, P.c3.priorBandBpm.value]).toEqual([
      208, 0.7, 10.8,
    ])
    expect([P.b3.trimpExponentMale.value, P.b3.trimpExponentFemale.value]).toEqual([1.92, 1.67])
    expect(P.c4.lt1CsFraction.value).toBe(0.823)
    expect(P.k2.threeWeekMultipliers.value).toEqual([0.75, 0.55, 0.35])
    expect(P.k2.twoWeekMultipliers.value).toEqual([0.65, 0.4])
    expect(P.j7.restart15to28.value).toBe(0.75)
    expect(P.h2.longestRunCapHours.value).toBe(6)
    expect(P.h2.longestRunCapHours.evidence).toEqual([])
    expect(P.i11.costRatioMinus20.value).toBe(0.51)
    expect(P.i12.vo2maxDeclinePctPer1000m.range).toEqual([4.6, 7.5])
    expect(P.l6.minBandPct.value).toBe(3)
    expect(P.n1.bsiReturnDays.value).toEqual([44, 56, 107, 127])
  })
})

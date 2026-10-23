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
    expect(PARAMS_VERSION).toBe('2026-10-23.1')
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
    // a value is a number or a list of numbers, nested as deep as the data needs (the ladder rungs)
    const finite = (v: unknown): boolean =>
      Array.isArray(v) ? v.every(finite) : typeof v === 'number' && Number.isFinite(v)
    for (const p of all) {
      expect(finite(p.value), p.id).toBe(true)
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

  it('matches a rule id without regard to case, but not to hyphens', () => {
    const ids = (rule: string) => paramsForRule(rule).map((p) => p.id)
    // g-3 (tightened profiles) and G3 (priors, not optima) are different rules.
    expect(ids('g-3')).toContain('injuryReturn.levelsMin')
    expect(ids('g-3')).not.toContain('global3.minObservations')
    expect(ids('G3')).toContain('global3.minObservations')
    expect(ids('G3')).not.toContain('injuryReturn.levelsMin')
    expect(ids('G-3')).toEqual(ids('g-3'))
    expect(ids('h12')).toEqual(ids('H12'))
    // Without the hyphen it is another rule id, and no parameter carries that id.
    expect(ids('g1')).toEqual([])
    expect(ids('G1')).toEqual([])
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
    expect(P.h2.longestRunCapHours.grade).toBe('D')
    expect(P.i11.costRatioMinus20.value).toBe(0.51)
    expect(P.i12.vo2maxDeclinePctPer1000m.range).toEqual([4.6, 7.5])
    expect(P.l6.minBandPct.value).toBe(3)
    expect(P.n1.bsiReturnDays.value).toEqual([44, 56, 107, 127])
  })

  it('carries the climb-note threshold of rule H4 as a default, with its evidence', () => {
    const rate = P.h4.climbNoteGainPerHourM
    expect(rate.id).toBe('h4.climbNoteGainPerHourM')
    expect(rate.value).toBe(150)
    expect(rate.grade).toBe('D')
    expect(rate.rule).toBe('H4')
    expect(rate.unit).toBe('m/h')
    expect(rate.evidence).toEqual([
      'hingrand-2023-power-vs-ascent-speed',
      'jeker-2020-vertical-speed-ultra',
    ])
    expect(rate.note).toMatch(/default/i)
    // far below the reference for sustained ultra climbing, which is not a target
    expect(rate.value).toBeLessThan(P.h4.ultraClimbReferenceMh.value)
  })

  it('carries the personal fuel ladder of rule H7 with its grades and evidence', () => {
    const h7 = P.h7
    expect(
      [
        h7.logMinDurationMin,
        h7.rungReachFraction,
        h7.multiCarbMinShare,
        h7.stepUpToleratedRuns,
        h7.immediateFallbackScore,
        h7.nauseaContingencyScore,
        h7.hotDayWbgtC,
        h7.hotDayAirTempC,
        h7.gutBlockSessionsPerWeek,
      ].map((p) => [p.id, p.value, p.grade, p.rule]),
    ).toEqual([
      ['h7.logMinDurationMin', 120, 'A', 'H7'],
      ['h7.rungReachFraction', 0.9, 'D', 'H7'],
      ['h7.multiCarbMinShare', 0.5, 'D', 'H7'],
      ['h7.stepUpToleratedRuns', 1, 'D', 'H7'],
      ['h7.immediateFallbackScore', 4, 'D', 'H7'],
      ['h7.nauseaContingencyScore', 2, 'D', 'H7'],
      ['h7.hotDayWbgtC', 18, 'D', 'H7'],
      ['h7.hotDayAirTempC', 25, 'D', 'H7'],
      ['h7.gutBlockSessionsPerWeek', 3, 'D', 'H7'],
    ])
    expect(paramsForRule('H7')).toHaveLength(22)
    // the 2 h threshold is the one value taken from a study; the rest are labelled defaults
    expect(h7.logMinDurationMin.evidence).toEqual(['costa-2017-eigs-sr'])
    for (const p of [h7.hotDayWbgtC, h7.hotDayAirTempC]) {
      expect(p.evidence).toEqual(['costa-2017-eigs-sr', 'stuempfle-2015-gi-distress-wser'])
    }
    // the scores live on the scale the log records and the stop rule reads
    for (const p of [h7.immediateFallbackScore, h7.nauseaContingencyScore]) {
      expect(p.value, p.id).toBeLessThanOrEqual(h7.gutSymptomScaleMax.value)
    }
    expect(h7.immediateFallbackScore.value).toBeGreaterThan(h7.gutStopScore.value)
    // a run counts for less time in a gut-training week than in a normal week
    expect(h7.gutTrainingSessionMinMin.value).toBeLessThan(h7.logMinDurationMin.value)
  })

  it('names the difference between the fuel and the heat-steering thresholds', () => {
    // isHotForSteering uses i9.warnWbgtC; the fuel hold is lower on purpose (ADR 0011)
    expect(P.h7.hotDayWbgtC.value).toBeLessThan(P.i9.warnWbgtC.value)
    expect(P.h7.hotDayWbgtC.note).toMatch(/isHotForSteering/)
    expect(P.h7.hotDayWbgtC.note).toMatch(/i9\.warnWbgtC/)
    expect(P.h7.hotDayWbgtC.note).toMatch(/not the heat-steering threshold/i)
    expect(P.h7.hotDayAirTempC.note).toMatch(/isHotForSteering/)
  })

  it('cites every evidence id of the h7 ladder in the text of rule H7', () => {
    const start = engineRules.indexOf('- **H7 ')
    const end = engineRules.indexOf('- **H8 ')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const h7Text = engineRules.slice(start, end)
    const missing = paramsForRule('H7').flatMap((p) =>
      p.evidence.filter((id) => !h7Text.includes(id)).map((id) => `${p.id}: ${id}`),
    )
    expect(missing).toEqual([])
    // the hot-day numbers and the copy guard are stated in the rule, not only in the registry
    expect(h7Text).toContain('**Copy guard.**')
    expect(h7Text).toContain(`${P.h7.hotDayWbgtC.value} C or more`)
    expect(h7Text).toContain(`${P.h7.hotDayAirTempC.value} C or more`)
  })

  it('transcribes the post-race window of rule H12', () => {
    const hold = P.h12HoldDays
    expect(
      [hold.marathon, hold.ultra50, hold.ultra100k, hold.ultra100mi, hold.beyond].map(
        (p) => p.value,
      ),
    ).toEqual([2, 4, 7, 10, 14])
    expect(P.h12.reducedDays.value).toBe(7)
    expect([P.h12.step1RunMaxMin.value, P.h12.step1MaxRuns.value]).toEqual([40, 3])
    expect([P.h12.step2RunMaxMin.value, P.h12.laterStepLongRunMaxMin.value]).toEqual([60, 90])
    expect([P.h12.modifierMultiplier.value, P.h12.hillyDescentMPerKm.value]).toEqual([1.5, 30])
    expect([
      P.h12.advanceCleanCheckins.value,
      P.h12.ownBaselineMinCheckins.value,
      P.h12.gateEscalationDays.value,
      P.h12.gateStaleDays.value,
    ]).toEqual([2, 14, 14, 3])
    expect(P.macroDesign.postRaceMarathonFractions.value).toEqual([0.5, 0.75])
    expect(P.macroDesign.postRaceLongFractions.value).toEqual([0.25, 0.5, 0.75])
    expect(P.macroDesign.postRaceReducedFraction.value).toBe(0.5)
    // grade B only where one trial backs the value for every class it applies to; the first-step
    // caps are the marathon trial's dose but also bind the ultra classes, so they are defaults
    expect(hold.marathon.grade).toBe('B')
    expect(P.h12.step1RunMaxMin.grade).toBe('D')
    expect(P.h12.step1MaxRuns.grade).toBe('D')
    expect(P.h12.modifierMultiplier.grade).toBe('D')
    expect(P.h12.goalRaceDistanceTolerancePct.value).toBe(10)
    expect(paramsForRule('H12')).toHaveLength(20)
  })

  it('carries the back-test thresholds of rule L7 as defaults, with existing evidence', () => {
    const minRaces = P.l7.minRacesForSummary
    const tolerance = P.l7.courseTolerancePct
    expect([minRaces.id, minRaces.value, minRaces.grade, minRaces.rule]).toEqual([
      'l7.minRacesForSummary',
      3,
      'D',
      'L7',
    ])
    expect([tolerance.id, tolerance.value, tolerance.grade, tolerance.rule]).toEqual([
      'l7.courseTolerancePct',
      2,
      'D',
      'L7',
    ])
    expect(minRaces.evidence).toEqual([
      'hecksteden-2015-individual-response',
      'mann-2014-high-low-responders',
    ])
    expect(tolerance.evidence).toEqual(['blythe-2016-individual-prediction'])
    expect(minRaces.note).toMatch(/default/i)
    expect(tolerance.note).toMatch(/default/i)
    expect(paramsForRule('L7').map((p) => p.id)).toEqual([
      'l7.minRacesForSummary',
      'l7.courseTolerancePct',
    ])
    // the summary threshold is the same count of observations as the prior-shrinkage gate of G3
    expect(minRaces.value).toBe(P.global3.minObservations.value)
  })

  it('words rule L7 as four bullets and ties the L6 band to scored races', () => {
    const section = engineRules.slice(
      engineRules.indexOf('- **L7 '),
      engineRules.indexOf('## (m) Personalization verdicts'),
    )
    expect(section.match(/^ {2}- /gm)).toHaveLength(4)
    expect(engineRules).toMatch(
      /\*\*L6 Minimum band\.\*\*[^\n]*until at least 3 scored races exist \(L7\)/,
    )
    expect(engineRules).not.toMatch(/until running back-tests exist/)
  })

  it('carries the device rule O1 as two labelled defaults, with its evidence', () => {
    const floor = P.o1.hrFloorBpm
    expect([floor.id, floor.value, floor.unit, floor.grade, floor.rule]).toEqual([
      'o1.hrFloorBpm',
      40,
      'bpm',
      'D',
      'O1',
    ])
    expect(floor.note).toMatch(/default/i)
    const minStep = P.o1.hrTargetMinStepSec
    expect([minStep.id, minStep.value, minStep.unit, minStep.grade, minStep.rule]).toEqual([
      'o1.hrTargetMinStepSec',
      180,
      'sec',
      'D',
      'O1',
    ])
    expect(minStep.evidence).toEqual([
      'bent-2020-ppg-inaccuracy',
      'gillinov-2017-wearable-hr-aerobic',
    ])
    expect(minStep.note).toMatch(/default/i)
    expect(paramsForRule('O1').map((p) => p.id)).toEqual(['o1.hrFloorBpm', 'o1.hrTargetMinStepSec'])
    // the rule has its own heading in the document
    expect(engineRules).toMatch(/^## \(o\) Delivery to devices$/m)
    expect(engineRules).toMatch(/\*\*O1 Targets on the device\.\*\*/)
  })
})

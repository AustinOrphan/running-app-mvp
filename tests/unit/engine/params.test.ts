import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOOK_DESIGN, loadPaperFiles } from '../../../scripts/research-check.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import { ceilingWeeklyRate } from '../../../shared/engine/limits.ts'
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

/**
 * Practice sources: the records of design `book-or-guideline` (programme pages, columns, books,
 * clinical documents). README method step 7 and "Sources outside the journals" cap them at D.
 */
const practiceSources = new Set(
  loadPaperFiles()
    .map(({ data }) => data as { id: string; design: string })
    .filter((paper) => paper.design === BOOK_DESIGN)
    .map((paper) => paper.id),
)

/** Rule ids that are not headings of engine-rules.md. */
function isDocumentedRule(rule: string): boolean {
  return !/^(design-|F-lib$|m-|n-)/.test(rule)
}

describe('parameter registry', () => {
  it('has a dated version', () => {
    expect(PARAMS_VERSION).toBe('2026-10-31.1')
  })

  it('holds the undo window of the revision model as a grade D default of 7 days', () => {
    expect(P.revision.undoWindowDays).toMatchObject({
      id: 'revision.undoWindowDays',
      value: 7,
      grade: 'D',
      rule: 'design-revisions',
      unit: 'days',
      evidence: [],
    })
    expect(paramsForRule('design-revisions').map((p) => p.id)).toEqual(['revision.undoWindowDays'])
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

  it('gives a parameter that cites only practice sources grade D (README step 7)', () => {
    // A practice source may set a default and never raise a grade; a parameter with any other
    // paper among its evidence is graded by that paper.
    const practiceOnly = all.filter(
      (p) => p.evidence.length > 0 && p.evidence.every((id) => practiceSources.has(id)),
    )
    expect(practiceSources.size).toBeGreaterThan(0)
    expect(practiceOnly.length).toBeGreaterThan(0)
    expect(practiceOnly.filter((p) => p.grade !== 'D').map((p) => p.id)).toEqual([])
  })

  it('has finite numeric values, ordered ranges and values inside their range', () => {
    // a value is a number, a list of numbers or a record of numbers (the first loads by
    // exercise), nested as deep as the data needs (the ladder rungs)
    const finite = (v: unknown): boolean =>
      Array.isArray(v)
        ? v.every(finite)
        : v !== null && typeof v === 'object'
          ? Object.values(v).every(finite)
          : typeof v === 'number' && Number.isFinite(v)
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

  it('carries the disruption-window rule J9 as three labelled defaults, with its evidence', () => {
    const j9 = [P.j9.maxWindowDays, P.j9.maxBackdateDays, P.j9.niggleEasyDays]
    expect(j9.map((p) => [p.id, p.value, p.unit, p.grade, p.rule])).toEqual([
      ['j9.maxWindowDays', 28, 'days', 'D', 'J9'],
      ['j9.maxBackdateDays', 28, 'days', 'D', 'J9'],
      ['j9.niggleEasyDays', 3, 'days', 'D', 'J9'],
    ])
    expect(paramsForRule('J9').map((p) => p.id)).toEqual(j9.map((p) => p.id))
    expect(j9.map((p) => p.evidence)).toEqual([
      ['feely-2022-training-disruptions', 'mujika-2000-detraining-part1'],
      ['feely-2022-training-disruptions'],
      ['sanford-2024-return-to-running', 'snyders-2022-respiratory-illness-rts'],
    ])
    for (const p of j9) expect(p.note, p.id).toMatch(/default/i)
    // the longest window is the third J7 tier, so a longer break is a break under J7
    expect(P.j9.maxWindowDays.value).toBe(P.j7.tier3Days.value)
    expect(P.j9.maxWindowDays.note).toMatch(/j7\.tier3Days/)
    // a niggle gets the easy days an illness gets after its symptom-free day
    expect(P.j9.niggleEasyDays.value).toBe(P.n3.illnessEasyDaysBeforeIntensity.value)
  })

  it('states rule J9 in engine-rules.md with its parameters, evidence and table rows', () => {
    const start = engineRules.indexOf('- **J9 ')
    const end = engineRules.indexOf('## (k) Taper and race week')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const j9Text = engineRules.slice(start, end)
    for (const p of paramsForRule('J9')) {
      expect(j9Text, p.id).toContain(`\`${p.id}\``)
      const missing = p.evidence.filter((id) => !j9Text.includes(id))
      expect(missing, p.id).toEqual([])
    }
    expect(j9Text).toContain('`pain.flagScore`')
    expect(j9Text).toMatch(/Grade D as a whole|grade D as a whole/)
    for (const row of ['Disruption window length', 'Disruption back-dating', 'Niggle easy days']) {
      expect(engineRules, row).toMatch(new RegExp(`^\\| ${row} `, 'm'))
    }
  })

  it('carries the four standout thresholds under design-explain as labelled defaults', () => {
    const s = P.standout
    expect(
      [s.longestLookbackWeeks, s.gradeNoteMinPct, s.driftDeltaPp, s.hrDeltaMinBpm].map((p) => [
        p.id,
        p.value,
        p.unit,
        p.grade,
        p.rule,
      ]),
    ).toEqual([
      ['standout.longestLookbackWeeks', 12, 'weeks', 'D', 'design-explain'],
      ['standout.gradeNoteMinPct', 3, '% grade', 'D', 'design-explain'],
      ['standout.driftDeltaPp', 2, 'percentage points', 'D', 'design-explain'],
      ['standout.hrDeltaMinBpm', 3, 'bpm', 'D', 'design-explain'],
    ])
    expect(s.driftDeltaPp.evidence).toEqual(['nuuttila-2025-recreational-runners-durability'])
    expect(s.hrDeltaMinBpm.evidence).toEqual([
      'bent-2020-ppg-inaccuracy',
      'navalta-2020-trail-running-hr',
    ])
    expect(s.longestLookbackWeeks.evidence).toEqual([])
    expect(s.gradeNoteMinPct.evidence).toEqual([])
    for (const p of Object.values(s)) expect(p.note, p.id).toMatch(/^Default:/)
    expect(paramsForRule('design-explain').map((p) => p.id)).toEqual([
      'standout.longestLookbackWeeks',
      'standout.gradeNoteMinPct',
      'standout.driftDeltaPp',
      'standout.hrDeltaMinBpm',
    ])
    // the section is registered, and it adds no parameter to any other section
    expect(sectionParams('o-explain')).toHaveLength(4)
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

  it('carries the history-informed rebuild G-8 as nine labelled defaults, with its evidence', () => {
    const g8 = [
      P.g8.blockWeeks,
      P.g8.blockWeeksDropped,
      P.g8.creditWindowWeeks,
      P.g8.creditTaperEndWeeks,
      P.g8.creditTaperFloor,
      P.g8.creditStandard,
      P.g8.creditUpper,
      P.g8.stepStandard,
      P.g8.responseWeeks,
    ]
    expect(g8.map((p) => [p.id, p.value, p.unit, p.grade, p.rule])).toEqual([
      ['g8.blockWeeks', 4, 'weeks', 'D', 'g-8'],
      ['g8.blockWeeksDropped', 1, 'weeks', 'D', 'g-8'],
      ['g8.creditWindowWeeks', 12, 'weeks', 'D', 'g-8'],
      ['g8.creditTaperEndWeeks', 12, 'weeks', 'D', 'g-8'],
      ['g8.creditTaperFloor', 0.5, 'fraction', 'D', 'g-8'],
      ['g8.creditStandard', 0.7, 'fraction', 'D', 'g-8'],
      ['g8.creditUpper', 0.85, 'fraction', 'D', 'g-8'],
      ['g8.stepStandard', 0.12, 'fraction per week', 'D', 'g-8'],
      ['g8.responseWeeks', 4, 'weeks', 'D', 'g-8'],
    ])
    expect(paramsForRule('g-8').map((p) => p.id)).toEqual(g8.map((p) => p.id))
    for (const p of g8) expect(p.note, p.id).toMatch(/^Default:/)
    expect(P.g8.blockWeeks.evidence).toEqual([
      'mujika-2000-detraining-part1',
      'mujika-2000-detraining-part2',
      'bohm-2015-tendon-adaptation-meta',
    ])
    expect(P.g8.blockWeeksDropped.evidence).toEqual([])
    expect(P.g8.creditTaperFloor.evidence).toEqual([])
    for (const p of [P.g8.creditWindowWeeks, P.g8.creditTaperEndWeeks]) {
      expect(p.evidence, p.id).toEqual([
        'coyle-1984-detraining-time-course',
        'zheng-2022-detraining-vo2max',
        'feely-2022-training-disruptions',
        'deboer-2007-ulls-tendon-time-course',
        'kubo-2012-achilles-training-detraining',
      ])
    }
    // the rebuild ceiling and the zone's step are provisional until the replay on real history
    for (const p of [P.g8.creditStandard, P.g8.creditUpper, P.g8.stepStandard]) {
      expect(p.note, p.id).toMatch(/^Default: provisional until the replay on real history/)
      expect(lintText(p.note ?? ''), p.id).toEqual([])
    }
    expect(P.g8.creditStandard.evidence).toEqual([
      'coyle-1984-detraining-time-course',
      'mujika-2000-detraining-part2',
      'deboer-2007-ulls-tendon-time-course',
      'kubo-2012-achilles-training-detraining',
    ])
    expect(P.g8.creditUpper.evidence).toEqual([
      'coyle-1984-detraining-time-course',
      'zheng-2022-detraining-vo2max',
      'hickson-1981-reduced-frequency',
      'spiering-2021-minimal-dose',
    ])
    expect(P.g8.stepStandard.evidence).toEqual([
      'nielsen-2013-gps-progression',
      'damsted-2018-training-load-change',
      'buist-2008-graded-training',
      'fredette-2022-training-parameters-injury-review',
    ])
    // the response reads the weeks of a typical week; no study sets the length, and the note says
    // that it is a default and passes the G5 lint
    expect(P.g8.responseWeeks.evidence).toEqual([])
    expect(P.g8.responseWeeks.value).toBe(P.a5.typicalWeekCount.value)
    expect(P.g8.responseWeeks.note).toMatch(/^Default: /)
    expect(lintText(P.g8.responseWeeks.note ?? '')).toEqual([])
    // the credits are shares of the block, the upper above the standard; the standard step sits
    // between the soft step and the weekly rate at which two weeks meet the hard ceiling
    expect(P.g8.creditStandard.value).toBeLessThan(P.g8.creditUpper.value)
    expect(P.g8.creditUpper.value).toBeLessThan(1)
    expect(P.g8.stepStandard.value).toBeGreaterThan(P.g2.rampSoft.value)
    expect(P.g8.stepStandard.value).toBeLessThan(ceilingWeeklyRate())
    // the upper step is derived, not a number: two weeks at it meet the ceiling exactly
    expect(ceilingWeeklyRate()).toBeCloseTo(0.14, 3)
    expect((1 + ceilingWeeklyRate()) ** 2).toBeCloseTo(1 + P.g2.rampCeilingTwoWeeks.value, 12)
    // the two windows: 12 weeks, or 16 with the older four weeks on a taper
    expect(P.g8.creditTaperEndWeeks.range).toEqual([12, 16])
    expect(P.g8.creditTaperEndWeeks.value).toBe(P.g8.creditWindowWeeks.value)
    // the 12-week window fits the 16 weeks the athlete state shows
    expect(P.g8.creditWindowWeeks.value + P.g8.blockWeeks.value).toBeLessThanOrEqual(16)
    expect(P.g8.blockWeeksDropped.value).toBeLessThan(P.g8.blockWeeks.value)
    // the block is the weeks of a typical week, and the least runs a week is the low-frequency line
    expect(P.g8.blockWeeks.value).toBe(P.a5.typicalWeekCount.value)
    // the 3 x 30 start reads a block of 3 sessions of the longest floor session
    expect(P.restartFloor.sessions.value * P.restartFloor.sessionMaxMin.value).toBe(90)
  })

  it('states rule G-8 in engine-rules.md with its parameters, evidence and table rows', () => {
    const start = engineRules.indexOf('- **G-8 ')
    const end = engineRules.indexOf('## (h) Ultra-specific rules')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const g8Text = engineRules.slice(start, end)
    for (const p of paramsForRule('g-8')) {
      expect(g8Text, p.id).toContain(`\`${p.id}\``)
      expect(
        p.evidence.filter((id) => !g8Text.includes(id)),
        p.id,
      ).toEqual([])
    }
    expect(g8Text).toMatch(/Grade D as a whole/)
    // the values that wait for the replay are marked provisional; every part is built
    expect(g8Text).toContain('provisional')
    expect(g8Text).toContain('Rebuild ceiling and zone')
    expect(g8Text).toContain('**Response to weeks run above plan.**')
    expect(g8Text).toMatch(/applies to a plan the runner is following/)
    expect(g8Text).not.toMatch(/built in task L3/)
    // G-2 and G-6 no longer say that a week run above its plan lifts nothing, without the
    // qualification that standard and upper lift the baseline from the mean of the weeks run
    const g2 = engineRules.slice(engineRules.indexOf('- **G-2 '), engineRules.indexOf('- **G-3 '))
    const g6 = engineRules.slice(engineRules.indexOf('- **G-6 '), engineRules.indexOf('- **G-7 '))
    expect(g2).toMatch(/at steady one week above the ramp lifts nothing after it/)
    expect(g2).toMatch(/At standard and upper the trailing mean of the minutes run/)
    expect(g6).toMatch(/At steady a week run above its plan lifts nothing/)
    expect(g6).toMatch(/At standard and upper the mean of the minutes run/)
    for (const row of [
      'History block \\(G-8\\)',
      'History credit window \\(G-8\\)',
      'History credit taper floor \\(G-8\\)',
      '3 × 30 start from a block \\(E6, G-8\\)',
      'Rebuild ceiling, standard \\(G-8\\)',
      'Rebuild ceiling, upper \\(G-8\\)',
      'Rebuild step, standard \\(G-8\\)',
      'Rebuild step, upper \\(G-8\\)',
      'Response to weeks run above plan \\(G-8\\)',
    ]) {
      expect(engineRules, row).toMatch(new RegExp(`^\\| ${row} `, 'm'))
    }
    // E6 path 2 names the second route, and G-5 points at the rule that sets the ceiling
    const e6 = engineRules.slice(engineRules.indexOf('- **E6 '), engineRules.indexOf('## (f) '))
    expect(e6).toContain('**Block (G-8).**')
    expect(engineRules).toMatch(/rule G-8 sets it, with its Params/)
  })

  it('carries the strength structure F7 as labelled defaults and one grade A planning figure', () => {
    const f7 = P.f7
    expect(paramsForRule('F7').map((p) => p.id)).toEqual(Object.values(f7).map((p) => p.id))
    expect(Object.keys(f7)).toHaveLength(21)
    for (const p of Object.values(f7)) {
      expect(p.rule, p.id).toBe('F7')
      if (p === f7.expectedBenefitPct) continue
      expect(p.grade, p.id).toBe('D')
      expect(p.note, p.id).toMatch(/^Default: /)
      expect(lintText(p.note ?? ''), p.id).toEqual([])
    }
    expect(f7.expectedBenefitPct).toMatchObject({ value: [2, 4], grade: 'A', unit: '%' })
    expect(f7.expectedBenefitPct.evidence).toEqual([
      'denadai-2017-explosive-heavy-economy',
      'llanoslagos-2024-economy-speeds',
      'blagrove-2018-strength-determinants',
    ])
    expect(lintText(f7.expectedBenefitPct.note ?? '')).toEqual([])
    expect([f7.blockSessionMin.value, f7.maintenanceSessionMin.value]).toEqual([40, 25])
    expect([f7.rampInReps.value, f7.rampInSets.value, f7.easyRir.value, f7.heavyRir.value]).toEqual(
      [[6, 8], [2, 3], 3, [1, 3]],
    )
    expect(
      [
        f7.plyoStartContacts,
        f7.plyoStepContacts,
        f7.plyoStepEveryWeeks,
        f7.plyoRungWeeks,
        f7.maintenancePlyoContacts,
        f7.reducedPlyoShare,
        f7.blockCreditWeeks,
      ].map((p) => p.value),
    ).toEqual([40, 20, 2, 3, 60, 0.5, 4])
    expect([f7.trunkSets.value, f7.trunkReps.value, f7.trunkHoldSec.value]).toEqual([
      2,
      [8, 12],
      [30, 45],
    ])
    expect([f7.bodyweightReps.value, f7.lowerSeconds.value, f7.taperLifts.value]).toEqual([
      [8, 15],
      3,
      2,
    ])
    // the cap on the ladder is the highest dose observed (grade A) and the start sits well below it
    expect(P.flib.plyoContactsMax.grade).toBe('A')
    expect(f7.plyoStartContacts.value).toBeLessThan(P.flib.plyoContactsMax.value)
    // the ramp-in is lighter and higher in repetitions than the heavy block, and leaves more in reserve
    expect(f7.rampInReps.value[0]).toBeGreaterThanOrEqual(P.flib.heavyReps.range?.[1] ?? 0)
    expect(f7.rampInSets.value[1]).toBeLessThanOrEqual(P.flib.heavySets.range?.[0] ?? 0)
    expect(f7.easyRir.value).toBeGreaterThanOrEqual(f7.heavyRir.value[1])
    // a lighter, maintenance or taper session has fewer sets and lifts than the block
    expect(f7.maintenanceSets.value).toBeLessThan(P.flib.heavySets.range?.[0] ?? 0)
    expect(f7.taperLifts.value).toBeLessThanOrEqual(P.flib.heavyExercises.value)
    expect(f7.maintenanceSessionMin.value).toBeLessThan(f7.blockSessionMin.value)
    expect(f7.reducedPlyoShare.value).toBeGreaterThan(0)
    expect(f7.reducedPlyoShare.value).toBeLessThan(1)
    // block sets stay inside the repetitions up to which a linear estimate of a maximum was advised,
    // and a ramp-in set of the top of its range with the easy reps left does not (rule F8)
    const blockCount = (P.flib.heavyReps.range?.[1] ?? 0) + f7.heavyRir.value[1]
    expect(blockCount).toBeLessThanOrEqual(P.f8.e1rmMaxReps.value)
    expect(f7.rampInReps.value[1] + f7.easyRir.value).toBeGreaterThan(P.f8.e1rmMaxReps.value)
    // the budgets replaced the single placement default of 30 minutes, which is retired (E14-3)
    expect('strengthSessionMin' in P.fplace).toBe(false)
    expect(all.map((p) => p.id)).not.toContain('fplace.strengthSessionMin')
    expect(f7.blockSessionMin.value).toBeGreaterThan(30)
    expect(f7.maintenanceSessionMin.value).toBeLessThan(30)
    // the values the strength epic reads from rules E5 and H10 are the registered ones, and equal
    expect(P.h10.strengthBlockWeeks.value).toBe(P.e5.strengthBlockWeeks.value)
    expect(P.h10.strengthSessionsPerWeek.value).toBe(P.flib.strengthPerWeek.value)
    expect(P.h10.strengthBlockWeeks.evidence).toContain(
      'zanini-2025-strength-economy-durability-rct',
    )
    expect(P.e5.strengthMaintenancePerWeek.evidence).toEqual([
      'spiering-2021-minimal-dose',
      'bickel-2011-maintenance-dosing-retention',
    ])
  })

  it('carries the load progression F8 as labelled defaults with its evidence', () => {
    const f8 = P.f8
    expect(paramsForRule('F8').map((p) => p.id)).toEqual(Object.values(f8).map((p) => p.id))
    expect(Object.keys(f8)).toHaveLength(11)
    for (const p of Object.values(f8)) {
      expect(p.rule, p.id).toBe('F8')
      expect(p.grade, p.id).toBe('D')
      expect(p.note, p.id).toMatch(/^Default: /)
      expect(lintText(p.note ?? ''), p.id).toEqual([])
    }
    expect(
      [
        f8.progressMinRir,
        f8.bigStepRir,
        f8.maxStepPct,
        f8.reducePct,
        f8.ceilingSessions,
        f8.layoffDays,
        f8.layoffLoadFraction,
        f8.startPctOf1rm,
        f8.e1rmDivisor,
        f8.e1rmMaxReps,
      ].map((p) => p.value),
    ).toEqual([1, 4, 15, 5, 3, 28, 0.9, 70, 30, 10])
    expect(f8.maxStepPct.evidence).toEqual(['acsm-2009-progression-models-resistance'])
    expect(f8.e1rmDivisor.evidence).toEqual([
      'nuzzo-2023-reps-at-percent-1rm',
      'reynolds-2006-1rm-prediction',
    ])
    // the most repetitions to the limit a linear estimate is made from, taken from one study's advice
    expect(f8.e1rmMaxReps.evidence).toEqual(['reynolds-2006-1rm-prediction'])
    expect(f8.e1rmMaxReps.unit).toBe('reps')
    expect(f8.e1rmMaxReps.note).toMatch(/^Default: taken from the advice of one study/)
    expect(f8.layoffDays.evidence).toEqual(f8.layoffLoadFraction.evidence)
    expect(f8.layoffLoadFraction.evidence).toContain('mujika-2000-detraining-part2')
    // an increase needs fewer reps in reserve than a double step, and the larger step is the rarer
    expect(f8.progressMinRir.value).toBeLessThan(f8.bigStepRir.value)
    // a reduction is smaller than the largest step, and a return load is lighter than the last base
    expect(f8.reducePct.value).toBeLessThan(f8.maxStepPct.value)
    expect(f8.layoffLoadFraction.value).toBeLessThan(1)
    // the first load is a share of the maximum below the heavy floor, itself below the ceiling
    expect(f8.startPctOf1rm.value).toBeLessThan(P.flib.heavyMinPct1rm.value)
    expect(P.flib.heavyMinPct1rm.range?.[1]).toBe(90)
  })

  it('holds a light first load, as a fraction of body weight, for every loaded exercise', () => {
    const table = P.f8.startFractionBodyweight
    const NO_ADDED_LOAD: Record<string, true> = {
      'single-leg-box-squat': true,
      'single-leg-calf-raise': true,
    }
    // the exercises of the catalogue (design 7.1) whose load basis is a weight; the bodyweight
    // movements, the jumps, the trunk holds and the banded movements have no entry
    const loaded = [
      'back-squat',
      'dumbbell-rdl',
      'farmer-carry',
      'goblet-squat',
      'hip-thrust',
      'kettlebell-rdl',
      'leg-curl',
      'leg-press',
      'romanian-deadlift',
      'seated-calf-raise',
      'single-leg-box-squat',
      'single-leg-calf-raise',
      'single-leg-rdl',
      'split-squat',
      'standing-calf-raise',
      'step-up',
    ]
    expect(Object.keys(table.value).sort()).toEqual(loaded)
    for (const [exercise, fraction] of Object.entries(table.value)) {
      expect(fraction, exercise).toBeGreaterThanOrEqual(0)
      expect(fraction, exercise).toBeLessThanOrEqual(0.5)
    }
    // the two movements of "added load, if any" start with no added load
    for (const exercise of Object.keys(NO_ADDED_LOAD))
      expect(table.value[exercise], exercise).toBe(0)
    // every other entry is a real load
    for (const exercise of loaded.filter((e) => !(e in NO_ADDED_LOAD))) {
      expect(table.value[exercise], exercise).toBeGreaterThan(0)
    }
    expect(table.evidence).toEqual([])
    expect(table.note).toMatch(/^Default: /)
    expect(table.note).toMatch(/no paper gives a starting load/)
  })

  it('carries the lighter days F9 as three labelled defaults', () => {
    const f9 = P.f9
    expect(paramsForRule('F9').map((p) => p.id)).toEqual([
      'f9.lowReadinessLoadPct',
      'f9.lowReadinessSetsCut',
      'f9.countPromptWeeks',
    ])
    expect(
      [f9.lowReadinessLoadPct, f9.lowReadinessSetsCut, f9.countPromptWeeks].map((p) => [
        p.value,
        p.grade,
        p.rule,
      ]),
    ).toEqual([
      [10, 'D', 'F9'],
      [1, 'D', 'F9'],
      [3, 'D', 'F9'],
    ])
    for (const p of Object.values(f9)) {
      expect(p.note, p.id).toMatch(/^Default: /)
      expect(lintText(p.note ?? ''), p.id).toEqual([])
    }
    // a low-readiness day leaves at least two sets of the lift with the fewest block sets, and
    // lowers the load: readiness never adds any
    expect(
      (P.flib.heavySets.range?.[0] ?? 0) - f9.lowReadinessSetsCut.value,
    ).toBeGreaterThanOrEqual(2)
    expect(f9.lowReadinessLoadPct.value).toBeGreaterThan(0)
  })

  it('states rules F7 to F9 in engine-rules.md with every parameter, its evidence and the table rows', () => {
    const start = engineRules.indexOf('- **F7 ')
    const f8At = engineRules.indexOf('- **F8 ')
    const f9At = engineRules.indexOf('- **F9 ')
    const end = engineRules.indexOf('## (g) Progression and safety limits')
    expect(start).toBeGreaterThan(-1)
    expect(f8At).toBeGreaterThan(start)
    expect(f9At).toBeGreaterThan(f8At)
    expect(end).toBeGreaterThan(f9At)
    const texts = {
      F7: engineRules.slice(start, f8At),
      F8: engineRules.slice(f8At, f9At),
      F9: engineRules.slice(f9At, end),
    } as const
    const all = engineRules.slice(start, end)
    for (const rule of ['F7', 'F8', 'F9'] as const) {
      for (const p of paramsForRule(rule)) {
        expect(texts[rule], p.id).toContain(`\`${p.id}\``)
        expect(
          p.evidence.filter((id) => !all.includes(id)),
          p.id,
        ).toEqual([])
      }
    }
    // the grades are stated: the method is A, the doses are D, F8 and F9 are D throughout
    expect(texts.F7).toMatch(/Grade A for the method[^\n]*D for every dose/)
    expect(texts.F8).toMatch(/Grade D throughout/)
    expect(texts.F9).toMatch(/Grade D throughout/)
    // the benefit and injury sentences keep to their grade: no performance or prevention promise
    expect(texts.F7).toContain('says nothing about race time')
    expect(texts.F7).toContain('no running-specific reduction in injuries')
    expect(texts.F7).toContain('so no VO2max, threshold or pace change is ever projected')
    // the text passes the G5 lint once the paper ids, which can contain a banned word, are left out
    expect(lintText(all.replace(/\[[^\]\n]*\]/g, ''))).toEqual([])
    // the table has a row for every parameter group, and the amended rules are dated
    for (const row of [
      'Strength expected benefit \\(F7\\)',
      'Strength session budget \\(F7\\)',
      'Strength maintenance sets \\(F7, F9\\)',
      'Ramp-in reps and sets \\(F7\\)',
      'Reps in reserve, easy sessions \\(F7\\)',
      'Reps in reserve, block \\(F7\\)',
      'Bodyweight movement reps \\(F7\\)',
      'Slow lowering of a lift \\(F7, H5\\)',
      'Jump ladder start and step \\(F7\\)',
      'Maintenance jump contacts \\(F7\\)',
      'Reduced jump share \\(F7\\)',
      'Block credit \\(F7\\)',
      'Trunk finisher \\(F7\\)',
      'Taper lifts \\(F7, F9\\)',
      'Load step \\(F8\\)',
      'Largest single step \\(F8\\)',
      'Reduction after a short set \\(F8\\)',
      'Ceiling before a variation \\(F8\\)',
      'Gap and return load \\(F8\\)',
      'First load from an anchor \\(F8\\)',
      'First load without an anchor \\(F8\\)',
      'Estimated maximum \\(F8\\)',
      'Low-readiness day \\(F9\\)',
      'Count prompt \\(F9\\)',
    ]) {
      expect(engineRules, row).toMatch(new RegExp(`^\\| ${row} `, 'm'))
    }
    for (const [rule, next] of [
      ['E5', '- **E6 '],
      ['F4', '- **F5 '],
      ['H5', '- **H6 '],
      ['H10', '- **H11 '],
    ] as const) {
      const from = engineRules.indexOf(`- **${rule} `)
      const text = engineRules.slice(from, engineRules.indexOf(next, from))
      expect(text, rule).toContain('amended 2026-10-25')
    }
    // the strength gaps join the evidence-gap list, each with the default that stands
    const gaps = engineRules.slice(
      engineRules.indexOf('## Top evidence gaps'),
      engineRules.indexOf('## What would change these rules'),
    )
    for (let i = 1; i <= 12; i += 1) expect(gaps, `S${String(i)}`).toContain(`**S${String(i)} `)
    expect(gaps.match(/Default \(D\)/g)).toHaveLength(12)
  })
  it('carries the method presets P2 and P4 as two grade D defaults, cited in section (p)', () => {
    const section = engineRules.slice(
      engineRules.indexOf('## (p) Methods (presets)'),
      engineRules.indexOf('## Numeric parameter table'),
    )
    expect(section.length).toBeGreaterThan(0)
    expect(sectionParams('p-methods').map((p) => p.id)).toEqual(['p2.runDays', 'p4.buildWeeks'])
    for (const [p, rule] of [
      [P.p2.runDays, 'P2'],
      [P.p4.buildWeeks, 'P4'],
    ] as const) {
      expect(p.grade, p.id).toBe('D')
      expect(p.rule, p.id).toBe(rule)
      // the evidence is the papers the rule itself cites, and the rule says where the value is
      expect(
        p.evidence.filter((id) => !section.includes(id)),
        p.id,
      ).toEqual([])
      expect(section, p.id).toContain(`\`${p.id}\``)
    }
    expect(section).toContain('**Every preset is grade D: a choice, not a better plan.**')
    expect(engineRules).toMatch(/^\| Run days, three-run-days preset \(P2\) /m)
    expect(engineRules).toMatch(/^\| Build weeks, longer-base preset \(P4\) /m)
  })
})

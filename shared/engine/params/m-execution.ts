// Execution defaults: planned versus actual (design sections 4.1-4.3). Every value here is an
// engine default (grade D) because no study in the corpus sets execution thresholds; the
// anchors are the subjective-first rule (J2) and the perceived-effort anchors (C4). Task E7
// may add here. Rule ids starting with 'design-' point at the design section, not at
// research/engine-rules.md.
import type { SessionKind } from '../types.ts'
import { param, type ParamGroups } from './define.ts'

const RPE_EVIDENCE = ['bok-2022-subjective-intensity']
const SUBJECTIVE_EVIDENCE = [
  'saw-2016-subjective-vs-objective-monitoring',
  'bok-2022-subjective-intensity',
]
const CR10_NOTE =
  'Default: expected RPE on the CR-10 scale for this session kind. The perceived-effort anchors in the corpus are on the Borg 6-20 scale (VT1 10-11, RCP 13-15); the CR-10 mapping is an engine default, not a published conversion.'

function expectedRpe(kind: SessionKind, range: [number, number]) {
  return param<[number, number]>(`expectedRpe.${kind}`, range, 'D', 'C4', RPE_EVIDENCE, {
    unit: 'CR-10',
    note: CR10_NOTE,
  })
}

export const mExecution = {
  expectedRpe: {
    easy: expectedRpe('easy', [2, 3]),
    recovery: expectedRpe('recovery', [1, 2]),
    long: expectedRpe('long', [3, 4]),
    'long-fast-finish': expectedRpe('long-fast-finish', [4, 6]),
    threshold: expectedRpe('threshold', [5, 6]),
    intervals: expectedRpe('intervals', [7, 8]),
    'race-pace': expectedRpe('race-pace', [5, 6]),
    strides: expectedRpe('strides', [2, 4]),
    hills: expectedRpe('hills', [6, 7]),
    hike: expectedRpe('hike', [3, 5]),
    b2b: expectedRpe('b2b', [3, 5]),
    strength: expectedRpe('strength', [4, 6]),
    mobility: expectedRpe('mobility', [1, 2]),
    rest: expectedRpe('rest', [0, 0]),
    race: expectedRpe('race', [8, 9]),
    cross: expectedRpe('cross', [2, 4]),
  },
  completion: {
    partialBelow: param('completion.partialBelow', 0.8, 'D', 'design-4.2', SUBJECTIVE_EVIDENCE, {
      unit: 'ratio of actual to planned minutes',
      note: 'Default: below this ratio the session counts as partial (the same 80% that holds the weekly volume, j5.completionHoldShare).',
    }),
    extendedAbove: param('completion.extendedAbove', 1.2, 'D', 'design-4.2', SUBJECTIVE_EVIDENCE, {
      unit: 'ratio of actual to planned minutes',
      note: 'Default: above this ratio the session counts as extended.',
    }),
  },
  intensity: {
    onTargetMinShare: param('intensity.onTargetMinShare', 0.6, 'D', 'design-4.2', [], {
      unit: 'fraction of time in the target zone',
      note: 'Default: at or above this share of time in the target HR band (when HR qualifies) the intensity is on target; otherwise below or above by where the rest of the time sits.',
    }),
    paceBandTolerancePct: param('intensity.paceBandTolerancePct', 5, 'D', 'design-4.2', [], {
      unit: '% of pace',
      note: 'Default: grade-adjusted pace within this tolerance of the target band counts as on target when HR does not qualify (same as the default boundary band, c7.bandDefaultPacePct).',
    }),
  },
  effort: {
    weightRpe: param('effort.weightRpe', 0.4, 'D', 'J2', SUBJECTIVE_EVIDENCE, {
      unit: 'weight',
      note: 'Default: RPE against expectation carries the most weight (subjective first, J2).',
    }),
    weightFeel: param('effort.weightFeel', 0.3, 'D', 'J2', SUBJECTIVE_EVIDENCE, {
      unit: 'weight',
      note: 'Default: the owner feel rating is second.',
    }),
    weightHr: param('effort.weightHr', 0.2, 'D', 'J2', SUBJECTIVE_EVIDENCE, {
      unit: 'weight',
      note: 'Default: the HR residual counts only when HR qualifies (B2).',
    }),
    weightPace: param('effort.weightPace', 0.1, 'D', 'J2', SUBJECTIVE_EVIDENCE, {
      unit: 'weight',
      note: 'Default: the pace residual carries the least weight. Missing parts drop out and the weights renormalise.',
    }),
    rpePointsPerUnit: param('effort.rpePointsPerUnit', 1.5, 'D', 'J2', SUBJECTIVE_EVIDENCE, {
      unit: 'CR-10 points per effort unit',
      note: 'Default: an RPE this many points above the middle of the expected range is one effort unit.',
    }),
    hrResidualZPerUnit: param('effort.hrResidualZPerUnit', 1.0, 'D', 'J2', SUBJECTIVE_EVIDENCE, {
      unit: 'z-score per effort unit',
      note: 'Default: one standard deviation of the HR model residual is one effort unit.',
    }),
    paceResidualPctPerUnit: param(
      'effort.paceResidualPctPerUnit',
      3,
      'D',
      'J2',
      SUBJECTIVE_EVIDENCE,
      {
        unit: '% pace per effort unit',
        note: 'Default: a pace residual of this many percent is one effort unit.',
      },
    ),
    neutralHalfWidth: param('effort.neutralHalfWidth', 0.5, 'D', 'J2', SUBJECTIVE_EVIDENCE, {
      unit: 'effort units',
      note: 'Default band: a weighted effort under this in size scores 0.',
    }),
    strongFrom: param('effort.strongFrom', 1.5, 'D', 'J2', SUBJECTIVE_EVIDENCE, {
      unit: 'effort units',
      note: 'Default band: a weighted effort of this size or more scores +2 or -2; between the two bands it scores +1 or -1.',
    }),
    confidenceHighMinParts: param(
      'effort.confidenceHighMinParts',
      3,
      'D',
      'J2',
      SUBJECTIVE_EVIDENCE,
      {
        unit: 'parts',
        note: 'Default: confidence is high with at least this many parts, moderate with 2, low with 1.',
      },
    ),
    confidenceModerateMinParts: param(
      'effort.confidenceModerateMinParts',
      2,
      'D',
      'J2',
      SUBJECTIVE_EVIDENCE,
      {
        unit: 'parts',
        note: 'Default: confidence is moderate with at least this many parts.',
      },
    ),
  },
  hrModel: {
    windowWeeks: param(
      'hrModel.windowWeeks',
      8,
      'D',
      'A8',
      ['roete-2021-functional-overreaching-markers'],
      {
        unit: 'weeks',
        note: 'Default: steady runs of the last 8 weeks feed the athlete own HR-at-pace model (the efficiency index, A8).',
      },
    ),
    minQualifyingRuns: param(
      'hrModel.minQualifyingRuns',
      8,
      'D',
      'A8',
      ['roete-2021-functional-overreaching-markers'],
      {
        unit: 'runs',
        note: 'Default: fewer qualifying runs than this give no HR residual (null), never a guess.',
      },
    ),
    shrinkagePriorRuns: param(
      'hrModel.shrinkagePriorRuns',
      3,
      'D',
      'G3',
      ['hecksteden-2015-individual-response'],
      {
        unit: 'pseudo-runs',
        note: 'Default: weight of the population prior in the shrinkage estimate, equal to the 3 comparable observations of global3.minObservations.',
      },
    ),
    minDurationMin: param(
      'hrModel.minDurationMin',
      20,
      'D',
      'B2',
      ['navalta-2020-trail-running-hr'],
      {
        unit: 'min',
        note: 'Default: a run shorter than this is not used for the HR-at-pace model.',
      },
    ),
    maxGainPerKm: param(
      'hrModel.maxGainPerKm',
      15,
      'D',
      'B2',
      ['navalta-2020-trail-running-hr', 'bent-2020-ppg-inaccuracy'],
      {
        unit: 'm of climb per km',
        note: 'Default: a flat run for the HR model and for HR qualification; wrist HR on hills and trail is rejected (B2).',
      },
    ),
    steadyBandBpm: param(
      'hrModel.steadyBandBpm',
      10,
      'D',
      'A8',
      ['roete-2021-functional-overreaching-markers'],
      {
        unit: 'bpm either side of the average HR',
        note: 'Default: a run is steady when most of its time sits within this many bpm of its average HR.',
      },
    ),
    steadyMinShare: param(
      'hrModel.steadyMinShare',
      0.7,
      'D',
      'A8',
      ['roete-2021-functional-overreaching-markers'],
      {
        unit: 'fraction of time',
        note: 'Default: the share of time inside the steady band at or above which a run counts as steady.',
      },
    ),
    minHistogramCoverage: param(
      'hrModel.minHistogramCoverage',
      0.8,
      'D',
      'B2',
      ['navalta-2020-trail-running-hr', 'bent-2020-ppg-inaccuracy'],
      {
        unit: 'fraction of the duration',
        note: 'Default: HR qualifies only when the histogram covers at least this share of the run duration (sample check).',
      },
    ),
    minResidualSdBpm: param('hrModel.minResidualSdBpm', 2, 'D', 'G3', [], {
      unit: 'bpm',
      note: 'Default floor for the residual standard deviation so a tight fit does not inflate the z-score.',
    }),
    heatPriorPctPerC: param(
      'hrModel.heatPriorPctPerC',
      0.9,
      'D',
      'I7',
      ['wingo-2020-drift-vo2max-heat-running'],
      {
        unit: '% HR per C WBGT above 15 C',
        note: 'Default prior for the heat term: HR rose 17-19% at 35 C (i7.hrRiseAt35CPct), about 0.9% per C over the top of the optimum band; personalised by shrinkage.',
      },
    ),
  },
  matching: {
    adjacentDayPenalty: param('matching.adjacentDayPenalty', 0.5, 'D', 'design-4.1', [], {
      unit: 'score',
      note: 'Default: added to |ln(actual minutes / planned minutes)| for an adjacent-day match.',
    }),
    maxDayOffset: param('matching.maxDayOffset', 1, 'D', 'design-4.1', [], {
      unit: 'days',
      note: 'Default: candidates are the same date first, then this many days either side for sessions still planned.',
    }),
  },
  trim: {
    triggerScore: param('trim.triggerScore', 2, 'D', 'design-4.3', SUBJECTIVE_EVIDENCE, {
      unit: 'effort score',
      note: 'Default: an effort score of +2 on a quality session with no pain trims the next quality session.',
    }),
    repeatedScore: param('trim.repeatedScore', 1, 'D', 'design-4.3', SUBJECTIVE_EVIDENCE, {
      unit: 'effort score',
      note: 'Default: or an effort score of +1 on consecutive quality sessions.',
    }),
    repeatedCount: param('trim.repeatedCount', 2, 'D', 'design-4.3', SUBJECTIVE_EVIDENCE, {
      unit: 'quality sessions in a row',
      note: 'Default: how many consecutive quality sessions at the repeated score trigger a trim.',
    }),
    maxPerWeek: param('trim.maxPerWeek', 1, 'D', 'design-4.3', [], {
      unit: 'trims per week',
      note: 'Default: never more than one trim per week.',
    }),
    volumeFactor: param('trim.volumeFactor', 0.75, 'D', 'design-4.3', [], {
      unit: 'fraction of the planned quality volume',
      note: 'Default: a trimmed quality session keeps this share of its reps or duration.',
    }),
  },
  pain: {
    flagScore: param('pain.flagScore', 4, 'D', 'design-4.2', [], {
      unit: 'pain score 0-10',
      note: 'Default: a pain score at or above this raises the pain warning sign at once; focal bone pain raises it at any score.',
    }),
  },
  conditions: {
    assumedShortwaveWm2: param('conditions.assumedShortwaveWm2', 0, 'D', 'I1', [], {
      unit: 'W/m2',
      note: 'Default: activities store no solar radiation, so WBGT is computed for shade; the heat adjustment is therefore conservative.',
    }),
    heatAdjustAboveWbgtC: param(
      'conditions.heatAdjustAboveWbgtC',
      15,
      'D',
      'I2',
      ['mantzios-2022-weather-endurance'],
      {
        unit: 'C WBGT',
        note: 'Default: expectations are heat-adjusted above the top of the WBGT optimum band (i2.wbgtOptimumC).',
      },
    ),
  },
} satisfies ParamGroups

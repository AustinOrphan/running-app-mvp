// Section (g) Progression and safety limits. Source: research/engine-rules.md. Task E6 may add
// here. Rule ids keep the hyphen of the source ('g-1').
import { param, type ParamGroups } from './define.ts'

const SPIKE = ['frandsen-2025-session-spike']
const RAMP = [
  'buist-2008-graded-training',
  'nielsen-2014-weekly-progression',
  'damsted-2018-training-load-change',
]
const BSI = ['barrack-2014-bone-stress-triad', 'stennett-2025-bsi-female-offroad-runners']
const INJURY_FACTOR = [
  'hulme-2017-risk-protective',
  'vanderworp-2015-risk-factors',
  'vanpoppel-2021-overuse-risk-factors-review',
  'relph-2023-couch-to-5k-injury',
]

export const gLimits = {
  g1: {
    spikeRatioWarn: param('g1.spikeRatioWarn', 1.1, 'B', 'g-1', SPIKE, {
      unit: 'ratio to the 30-day longest completed run',
      note: 'Above this ratio the engine warns; at or below it is the reference band. Never describe the 30-100% band as safer than the 10-30% band.',
    }),
    spikeRatioOverride: param('g1.spikeRatioOverride', 2.0, 'B', 'g-1', SPIKE, {
      unit: 'ratio to the 30-day longest completed run',
      note: 'Above this ratio the generator never schedules the run without an explicit override.',
    }),
    hazardRatioWarnBand: param<[number, number]>(
      'g1.hazardRatioWarnBand',
      [1.5, 1.6],
      'B',
      'g-1',
      SPIKE,
      {
        unit: 'hazard ratio',
        note: 'Observed hazard ratio in the warn band (descriptive, from one observational cohort).',
      },
    ),
    hazardRatioOverride: param('g1.hazardRatioOverride', 2.3, 'B', 'g-1', SPIKE, {
      unit: 'hazard ratio',
      note: 'Observed hazard ratio above the override ratio (descriptive).',
    }),
    windowDays: param('g1.windowDays', 30, 'B', 'g-1', SPIKE, {
      unit: 'days',
      note: 'Window of the longest completed run that every planned run is compared with (also used for the largest 2-day total of h3).',
    }),
    referenceRaceMaxM: param(
      'g1.referenceRaceMaxM',
      42195,
      'D',
      'g-1',
      ['hoffman-2017-161km-recovery-determinants', 'millet-2011-ultramarathon-neuromuscular'],
      {
        unit: 'm',
        note: 'Default: a completed race of this distance or longer does not set the 30-day reference of the session spike guard, since 1.10 times a 100-mile race would allow training runs longer than any the return can take.',
      },
    ),
    minStepDistanceM: param('g1.minStepDistanceM', 500, 'D', 'g-1', SPIKE, {
      unit: 'm',
      note: 'Default: when the longest run is short the minimum step is 0.5 km (stored in metres).',
    }),
  },
  g2: {
    rampSoft: param(
      'g2.rampSoft',
      0.1,
      'D',
      'g-2',
      [
        'buist-2008-graded-training',
        'knopp-2024-marathon-plans',
        'fredette-2022-training-parameters-injury-review',
        'nielsen-2012-training-errors',
      ],
      {
        unit: 'fraction per week',
        note: 'Default: a convention matching published plans (5-9% average build); no study supports 10% as an injury threshold. Exceeding it gives a warning.',
      },
    ),
    rampCeilingTwoWeeks: param(
      'g2.rampCeilingTwoWeeks',
      0.3,
      'C',
      'g-2',
      [
        ...RAMP,
        'nielsen-2013-gps-progression',
        'damsted-2019-weekly-distance-change',
        'fredette-2022-training-parameters-injury-review',
      ],
      {
        unit: 'fraction over any 2-week window',
        note: 'Hard ceiling. Weak cohort signals sit at 20-30%; neither a tighter nor a looser ceiling is supported. The stricter 2-week window wins over a per-week 30% ceiling.',
      },
    ),
    baselineWeeks: param(
      'g2.baselineWeeks',
      2,
      'D',
      'g-2',
      [...RAMP, 'cloosterman-2024-acwr-methods'],
      {
        unit: 'weeks',
        note: 'Default: a week is compared with the highest of this many preceding weeks, so the week after a recovery week is not read as a jump. The calculation method changes which weeks are flagged (a weekly method flags about twice as many as rolling or EWMA methods).',
      },
    ),
    ceilingWindowWeeks: param('g2.ceilingWindowWeeks', 2, 'C', 'g-2', RAMP, {
      unit: 'weeks',
      note: 'The 30% ceiling spans 2 weeks: a week is compared with the highest of the weeks that ended this many weeks earlier (stricter than a per-week 30%).',
    }),
    ceilingLookbackWeeks: param('g2.ceilingLookbackWeeks', 6, 'D', 'g-2', RAMP, {
      unit: 'weeks',
      note: 'Default: the 2-week ceiling ignores recovery and taper weeks; when every week of its window is one, the window moves back up to this many weeks to the last loading week (for example the week after a race).',
    }),
    noviceMinStepMin: param('g2.noviceMinStepMin', 1, 'D', 'g-2', ['buist-2008-graded-training'], {
      unit: 'min of running per week',
      note: 'Default: novices progress by time with a minimum step of +1 min of running per week.',
    }),
  },
  g3: {
    recentInjuryRamp: param<[number, number]>(
      'g3.recentInjuryRamp',
      [0.05, 0.07],
      'D',
      'g-3',
      INJURY_FACTOR,
      {
        unit: 'fraction per week',
        note: 'Default: weekly ramp with the recent-injury flag; the 1.10x session limit becomes a hard limit. The factor is well supported (grade A: previous injury is the strongest marker, odds ratio 7.56 in a Couch-to-5K cohort); the values are unvalidated defaults.',
      },
    ),
    recentInjuryRecoveryEveryWeeks: param(
      'g3.recentInjuryRecoveryEveryWeeks',
      3,
      'D',
      'g-3',
      INJURY_FACTOR,
      {
        unit: 'weeks',
        note: 'Default: with the recent-injury flag a recovery week falls every 3rd week. The factor is well supported; the cadence is a default.',
      },
    ),
    priorBsiRampMax: param(
      'g3.priorBsiRampMax',
      0.05,
      'D',
      'g-3',
      ['wright-2015-stress-fracture-meta'],
      {
        unit: 'fraction per week',
        note: 'Default: ramp at or below 5% after a prior BSI, plus a clinician prompt. The factor is grade A, the value is a default.',
      },
    ),
    bsiFactorsForCap: param('g3.bsiFactorsForCap', 2, 'B', 'g-3', BSI, {
      unit: 'factors',
      note: 'Two or more BSI factors halve the default ramp.',
    }),
    bsiRampFactor: param('g3.bsiRampFactor', 0.5, 'D', 'g-3', BSI, {
      unit: 'fraction of the default ramp',
      note: 'Default: the cap at two or more BSI factors is an engine default; the factors are grade B.',
    }),
    bsiFactorTrainingHoursPerWeek: param('g3.bsiFactorTrainingHoursPerWeek', 12, 'B', 'g-3', BSI, {
      unit: 'h/week',
      note: 'BSI factor: 12 h/week or more of training.',
    }),
    bsiFactorBmiBelow: param('g3.bsiFactorBmiBelow', 21, 'B', 'g-3', BSI, {
      unit: 'kg/m2',
      note: 'BSI factor: BMI below 21, women only.',
    }),
  },
  g5: {
    acwrAcuteDays: param(
      'g5.acwrAcuteDays',
      7,
      'C',
      'g-5',
      ['nakaoka-2021-acwr-runners', 'impellizzeri-2020-acwr-pitfalls'],
      { unit: 'days', note: 'Window of the display-only 7:28 ratio. ACWR is never a gate.' },
    ),
    acwrChronicDays: param(
      'g5.acwrChronicDays',
      28,
      'C',
      'g-5',
      ['nakaoka-2021-acwr-runners', 'impellizzeri-2020-acwr-pitfalls'],
      { unit: 'days', note: 'Window of the display-only 7:28 ratio.' },
    ),
    displayOnlySoftCap: param(
      'g5.displayOnlySoftCap',
      1.5,
      'C',
      'g-5',
      ['toresdahl-2023-nyc-marathon-training-injury', 'craddock-2020-acwr-two-oceans'],
      {
        unit: 'ratio',
        note: 'Proposed by the volume and ultra topics and rejected as a gate: display only. A large runner cohort showed an inverse association.',
      },
    ),
    perDayOddsRatio: param(
      'g5.perDayOddsRatio',
      1.06,
      'C',
      'g-5',
      ['toresdahl-2023-nyc-marathon-training-injury'],
      {
        unit: 'odds ratio',
        note: 'Per-day OR for the 7:28 ratio, descriptive.',
      },
    ),
    lowRatioInfo: param(
      'g5.lowRatioInfo',
      0.7,
      'C',
      'g-5',
      ['nakaoka-2021-acwr-runners', 'wang-2020-acwr-lessons'],
      {
        unit: 'ratio',
        note: 'A ratio below this may be shown as information about a return from a break.',
      },
    ),
    displayWarmupWeeks: param('g5.displayWarmupWeeks', 4, 'D', 'g-5', ['wang-2020-acwr-lessons'], {
      unit: 'weeks',
      note: 'Default: 4 weeks of history are needed before any ratio is shown; hidden in taper and recovery weeks.',
    }),
  },
  g7: {
    reportedBeforeOveruseInjuryPct: param<[number, number]>(
      'g7.reportedBeforeOveruseInjuryPct',
      [6.9, 11.1],
      'C',
      'g-7',
      ['frandsen-2025-sudden-onset'],
      {
        unit: '% of overuse injuries',
        note: 'Share with a reported problem beforehand, so check-ins never replace load guards.',
      },
    ),
  },
} satisfies ParamGroups

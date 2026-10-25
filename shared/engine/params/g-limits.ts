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
// How long a reduction in running leaves the earlier weeks worth crediting: fitness fell slowly and
// levelled off, tendon stiffness fell faster under complete unloading (young non-runners), and a
// disruption is counted over 16 weeks. None of it dates a runner's own loss.
const CREDIT_WINDOW = [
  'coyle-1984-detraining-time-course',
  'zheng-2022-detraining-vo2max',
  'feely-2022-training-disruptions',
  'deboer-2007-ulls-tendon-time-course',
  'kubo-2012-achilles-training-detraining',
]
// The credit of the standard position: fitness after a stop, and the tissue side of complete unloading
// (young non-runners). None of it measures a runner who kept running a little.
const STANDARD_CREDIT = [
  'coyle-1984-detraining-time-course',
  'mujika-2000-detraining-part2',
  'deboer-2007-ulls-tendon-time-course',
  'kubo-2012-achilles-training-detraining',
]
// The credit of the upper position: fitness kept after a stop or a reduction in training.
const UPPER_CREDIT = [
  'coyle-1984-detraining-time-course',
  'zheng-2022-detraining-vo2max',
  'hickson-1981-reduced-frequency',
  'spiering-2021-minimal-dose',
]
// The weekly step of the standard position: cohorts and reviews of weekly increases, mostly in new
// runners, none of a return after a break.
const STANDARD_STEP = [
  'nielsen-2013-gps-progression',
  'damsted-2018-training-load-change',
  'buist-2008-graded-training',
  'fredette-2022-training-parameters-injury-review',
]
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
      42_195,
      'D',
      'g-1',
      ['hoffman-2017-161km-recovery-determinants', 'millet-2011-ultramarathon-neuromuscular'],
      {
        unit: 'm',
        note: 'Default: a completed race at or above this distance (the marathon) does not count toward the 30-day reference; shorter races count as runs. A 100-mile finish would otherwise allow training runs up to 1.10 times the race. Recovery after such races is long and measured in days to weeks; no study sets the cutoff.',
      },
    ),
    referenceRaceMaxHours: param(
      'g1.referenceRaceMaxHours',
      4,
      'D',
      'g-1',
      ['hoffman-2017-161km-recovery-determinants', 'millet-2011-ultramarathon-neuromuscular'],
      {
        unit: 'h',
        note: 'Default: a completed race with no distance counts as a run in the 30-day reference only when it lasted no longer than this (longer than any marathon the engine expects at the D1 marathon class), so a long ultra logged without a distance never becomes the reference run. No study sets the cutoff.',
      },
    ),
    minStepMin: param('g1.minStepMin', 3, 'D', 'g-1', SPIKE, {
      unit: 'min',
      note: 'Default: when the longest run is short the minimum step on duration is 3 min, about the time 0.5 km takes at an easy pace, so a return built on 5-minute runs can rise at all.',
    }),
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
  g8: {
    blockWeeks: param(
      'g8.blockWeeks',
      4,
      'D',
      'g-8',
      [
        'mujika-2000-detraining-part1',
        'mujika-2000-detraining-part2',
        'bohm-2015-tendon-adaptation-meta',
      ],
      {
        unit: 'weeks',
        note: 'Default: the history block is 4 consecutive complete weeks, the length of the typical week (a5.typicalWeekCount). The detraining reviews split short-term (under 4 weeks) from long-term reductions, and tendon adaptation is read over 8 weeks or more, so a block shows what the runner sustained and not that tissue adapted. No study sets the length.',
      },
    ),
    blockWeeksDropped: param('g8.blockWeeksDropped', 1, 'D', 'g-8', [], {
      unit: 'weeks',
      note: 'Default: the block is scored by the mean of its weeks without this many of the highest, so one big week cannot set it (the same idea as the start level of E6, where one big week alone does not set the level). No study sets the count.',
    }),
    creditWindowWeeks: param('g8.creditWindowWeeks', 12, 'D', 'g-8', CREDIT_WINDOW, {
      unit: 'weeks',
      note: 'Default: a block that ended within this many weeks of the current Monday counts in full. It sits between the plateau of fitness after a stop (about 8 weeks) and the 16 weeks over which a disruption is counted, and no study dates it for a runner who kept running a little.',
    }),
    creditTaperEndWeeks: param('g8.creditTaperEndWeeks', 12, 'D', 'g-8', CREDIT_WINDOW, {
      range: [12, 16],
      unit: 'weeks',
      note: 'Default: 12, the same as g8.creditWindowWeeks, so a block older than the window counts for nothing. 16 reaches blocks that ended 13 to 16 weeks ago, whose credit falls in a straight line from full at the window to g8.creditTaperFloor at this many weeks; the replay on real history chooses between the two. The lift to a start of 3 x 30 never reads a block older than the window.',
    }),
    creditTaperFloor: param('g8.creditTaperFloor', 0.5, 'D', 'g-8', [], {
      range: [0, 1],
      unit: 'fraction',
      note: 'Default: the share of its size that a block keeps at the end of the taper, a preference (taste, no claim that it is better). No study sets it.',
    }),
    creditStandard: param('g8.creditStandard', 0.7, 'D', 'g-8', STANDARD_CREDIT, {
      unit: 'fraction',
      note: 'Default: provisional until the replay on real history. At the standard position the rebuild ceiling is this share of the history block. It is about the fall in patellar tendon stiffness at day 23 of complete unloading and the cautious end of the J7 table, values for young non-runners who stopped running altogether, so no study sets it for a runner.',
    }),
    creditUpper: param('g8.creditUpper', 0.85, 'D', 'g-8', UPPER_CREDIT, {
      unit: 'fraction',
      note: 'Default: provisional until the replay on real history. At the upper position the rebuild ceiling is this share of the history block. It is the share of VO2max kept at day 56 of complete cessation (1 minus 0.16), a value for fitness and not for tissue, so no study sets it for a runner.',
    }),
    stepStandard: param('g8.stepStandard', 0.12, 'D', 'g-8', STANDARD_STEP, {
      unit: 'fraction per week',
      note: 'Default: provisional until the replay on real history, and a preference (taste, no claim that it is better). The weekly step below the rebuild ceiling at the standard position, between the soft step g2.rampSoft and the weekly rate at which two weeks meet g2.rampCeilingTwoWeeks. The upper position takes that rate itself, derived from the ceiling, so it is no Param of this group. No study compares weekly steps for a return after a break.',
    }),
  },
} satisfies ParamGroups

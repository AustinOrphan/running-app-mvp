// Section (a) Athlete state estimation, plus the global principles G1-G6 that carry a number.
// Source: research/engine-rules.md. Task E2 may add parameters here.
import { param, type ParamGroups } from './define.ts'

export const aState = {
  global3: {
    minObservations: param(
      'global3.minObservations',
      3,
      'D',
      'G3',
      ['hecksteden-2015-individual-response', 'mann-2014-high-low-responders'],
      {
        unit: 'observations',
        note: 'Default: individual values move toward the athlete data only after this many comparable observations; the rule is graded C/D and the count itself has no direct evidence.',
      },
    ),
  },
  a2: {
    acuteDays: param(
      'a2.acuteDays',
      7,
      'D',
      'A2',
      ['murray-2017-ewma-acwr', 'nakaoka-2021-acwr-runners'],
      {
        unit: 'days',
        note: 'Default: EWMA time constant is a user-adjustable convention shown as a descriptive trend.',
      },
    ),
    chronicDays: param(
      'a2.chronicDays',
      42,
      'D',
      'A2',
      ['murray-2017-ewma-acwr', 'nakaoka-2021-acwr-runners'],
      {
        unit: 'days',
        note: 'Default: EWMA time constant is a user-adjustable convention shown as a descriptive trend.',
      },
    ),
    dailyWindowDays: param('a2.dailyWindowDays', 90, 'D', 'A2', ['murray-2017-ewma-acwr'], {
      unit: 'days',
      note: 'Default: length of the daily load series that estimateState returns for display; the EWMA itself runs over the whole history.',
    }),
  },
  a3: {
    longestRunWindowDays: param(
      'a3.longestRunWindowDays',
      30,
      'B',
      'A3',
      ['frandsen-2025-session-spike'],
      {
        unit: 'days',
      },
    ),
  },
  a4: {
    gapMinDays: param('a4.gapMinDays', 7, 'B', 'A4', ['feely-2022-training-disruptions'], {
      unit: 'days',
      note: 'A gap is a run of this many days or more with no running.',
    }),
    gapWindowWeeks: param('a4.gapWindowWeeks', 16, 'B', 'A4', ['feely-2022-training-disruptions'], {
      unit: 'weeks',
    }),
    consistentShare: param(
      'a4.consistentShare',
      0.8,
      'D',
      'A4',
      ['lepers-2021-sub3-marathon-decades'],
      {
        unit: 'fraction',
        note: 'Default: a share of planned weeks completed above 80% counts as consistent; convention, not a tested cut-off.',
      },
    ),
  },
  a5: {
    noviceInjuryRatePer1000h: param(
      'a5.noviceInjuryRatePer1000h',
      17.8,
      'A',
      'A5',
      ['videbaek-2015-incidence'],
      {
        unit: 'injuries per 1000 h',
      },
    ),
    experiencedInjuryRatePer1000h: param(
      'a5.experiencedInjuryRatePer1000h',
      7.7,
      'A',
      'A5',
      ['videbaek-2015-incidence'],
      { unit: 'injuries per 1000 h' },
    ),
    noviceHazardRatio: param('a5.noviceHazardRatio', 2.3, 'A', 'A5', ['videbaek-2015-incidence'], {
      unit: 'ratio',
      note: 'Novices carry about 2.3 times the injury rate per hour.',
    }),
    historyWindowDays: param('a5.historyWindowDays', 365, 'D', 'A5', ['videbaek-2015-incidence'], {
      unit: 'days',
      note: 'Default: the history window the engine receives; the layoff of a runner with no logged run is set to this length.',
    }),
    noviceLayoffDays: param('a5.noviceLayoffDays', 120, 'D', 'A5', ['videbaek-2015-incidence'], {
      unit: 'days',
      note: 'Default: no running in about four months counts as novice; the rule leaves the exact definition to the engine.',
    }),
    returningLayoffDays: param(
      'a5.returningLayoffDays',
      28,
      'D',
      'A5',
      ['videbaek-2015-incidence'],
      {
        unit: 'days',
        note: 'Default: a layoff of four weeks or more, but shorter than the novice cut-off, counts as returning.',
      },
    ),
    noviceMinRunWeeks: param('a5.noviceMinRunWeeks', 4, 'D', 'A5', ['videbaek-2015-incidence'], {
      unit: 'weeks with a run (of the last 16)',
      note: 'Default: fewer weeks with a run than this, with under a year of running, counts as novice.',
    }),
    noviceMaxYears: param('a5.noviceMaxYears', 1, 'D', 'A5', ['videbaek-2015-incidence'], {
      unit: 'years',
      note: 'Default: under this many years of running, with few recent run weeks, counts as novice.',
    }),
    trainedMinYears: param('a5.trainedMinYears', 2, 'D', 'A5', ['videbaek-2015-incidence'], {
      unit: 'years',
      note: 'Default: trained needs at least this many years of regular running.',
    }),
    trainedMinWeeklyMin: param(
      'a5.trainedMinWeeklyMin',
      240,
      'D',
      'A5',
      ['videbaek-2015-incidence'],
      {
        unit: 'min per week (mean of the last 16 weeks)',
        note: 'Default: trained needs at least four hours of running per week on average.',
      },
    ),
    typicalWeekCount: param('a5.typicalWeekCount', 4, 'D', 'A5', ['videbaek-2015-incidence'], {
      unit: 'weeks',
      note: 'Default: the typical week is the median of this many recent complete weeks that contain a run.',
    }),
  },
  a6: {
    csMinEfforts: param('a6.csMinEfforts', 3, 'C', 'A6', ['smyth-2020-cs-training-data'], {
      unit: 'efforts',
    }),
    csMinDistanceM: param('a6.csMinDistanceM', 400, 'C', 'A6', ['smyth-2020-cs-training-data'], {
      unit: 'm',
    }),
    csMaxDistanceM: param('a6.csMaxDistanceM', 5000, 'C', 'A6', ['smyth-2020-cs-training-data'], {
      unit: 'm',
    }),
    csWindowDays: param('a6.csWindowDays', 90, 'D', 'A6', ['smyth-2020-cs-training-data'], {
      unit: 'days',
      note: 'Default: the 90-day window is an engine choice; the CS method itself is grade C.',
    }),
    exponentMinRaces: param(
      'a6.exponentMinRaces',
      2,
      'C',
      'A6',
      ['blythe-2016-individual-prediction', 'vickers-2016-race-times'],
      { unit: 'races at different distances' },
    ),
    csBandInnerEdgesM: param<number[]>(
      'a6.csBandInnerEdgesM',
      [1000, 2000, 3500],
      'D',
      'A6',
      ['smyth-2020-cs-training-data'],
      {
        unit: 'm',
        note: 'Default: inner edges of the distance bands (with 400 m and 5000 m as outer edges); the fastest effort of each band is a CS input, so one easy run cannot stand in for several distances.',
      },
    ),
    csMinTimeSpreadRatio: param(
      'a6.csMinTimeSpreadRatio',
      2,
      'D',
      'A6',
      ['smyth-2020-cs-training-data'],
      {
        unit: 'ratio of longest to shortest effort time',
        note: 'Default: the linear distance-time fit needs efforts whose durations differ by at least this ratio, or the slope is not identified.',
      },
    ),
    exponentMinDistanceRatio: param(
      'a6.exponentMinDistanceRatio',
      1.5,
      'D',
      'A6',
      ['blythe-2016-individual-prediction', 'vickers-2016-race-times'],
      {
        unit: 'ratio of longest to shortest race distance',
        note: 'Default: races count as different distances when the longest is at least this many times the shortest.',
      },
    ),
    exponentPlausible: param<[number, number]>(
      'a6.exponentPlausible',
      [1.0, 1.2],
      'D',
      'A6',
      ['blythe-2016-individual-prediction', 'vickers-2016-race-times'],
      {
        note: 'Default: a fitted personal exponent outside this range is treated as noise and not used.',
      },
    ),
    vo2maxWindowDays: param(
      'a6.vo2maxWindowDays',
      90,
      'D',
      'A6',
      ['molinagarcia-2022-wearable-vo2max'],
      {
        unit: 'days',
        note: 'Default: window of device VO2max readings used for the smoothed trend.',
      },
    ),
    vo2maxMinReadings: param(
      'a6.vo2maxMinReadings',
      4,
      'D',
      'A6',
      ['molinagarcia-2022-wearable-vo2max'],
      {
        unit: 'readings',
        note: 'Default: fewest device readings that give a trend.',
      },
    ),
    vo2maxTrendPerDays: param(
      'a6.vo2maxTrendPerDays',
      30,
      'D',
      'A6',
      ['molinagarcia-2022-wearable-vo2max'],
      {
        unit: 'days',
        note: 'Default: the trend is reported as ml/kg/min change per this many days.',
      },
    ),
    deviceVo2maxLimitsOfAgreement: param(
      'a6.deviceVo2maxLimitsOfAgreement',
      10,
      'A',
      'A6',
      ['molinagarcia-2022-wearable-vo2max'],
      {
        unit: 'ml/kg/min',
        note: 'Limits of agreement of about +/-10; device VO2max is a smoothed trend only.',
      },
    ),
  },
  a7: {
    thresholdDropPct90min: param(
      'a7.thresholdDropPct90min',
      5.5,
      'C',
      'A7',
      ['hunter-2025-marathoners-durability-slt', 'nuuttila-2025-recreational-runners-durability'],
      {
        unit: '%',
        range: [4, 6],
        note: 'Threshold speed fall after the reference duration; the spread across runners is large.',
      },
    ),
    thresholdDropAfterMin: param(
      'a7.thresholdDropAfterMin',
      90,
      'C',
      'A7',
      ['hunter-2025-marathoners-durability-slt', 'nuuttila-2025-recreational-runners-durability'],
      { unit: 'min' },
    ),
    easyHrDriftPct90min: param(
      'a7.easyHrDriftPct90min',
      5.5,
      'C',
      'A7',
      ['nuuttila-2025-recreational-runners-durability'],
      { unit: '%', note: 'HR drift at 90 min of easy running (numeric parameter table).' },
    ),
    minComparableRuns: param(
      'a7.minComparableRuns',
      3,
      'D',
      'A7',
      ['hunter-2025-durability-methods'],
      {
        unit: 'runs',
        note: 'Default: personalise the durability descriptor only after this many comparable long runs.',
      },
    ),
    comparableDurationTolerance: param(
      'a7.comparableDurationTolerance',
      0.2,
      'D',
      'A7',
      ['hunter-2025-durability-methods'],
      {
        unit: 'fraction',
        note: 'Default: runs are comparable when their durations are within 20%.',
      },
    ),
    comparableTempToleranceC: param(
      'a7.comparableTempToleranceC',
      5,
      'D',
      'A7',
      ['hunter-2025-durability-methods'],
      { unit: 'C', note: 'Default: runs are comparable when ambient temperatures are within 5 C.' },
    ),
    heatExcludeC: param(
      'a7.heatExcludeC',
      25,
      'D',
      'A7',
      [
        'wingo-2020-drift-vo2max-heat-running',
        'montain-1992-dehydration-drift',
        'ganio-2006-fluid-vo2peak-drift',
      ],
      {
        unit: 'C',
        note: 'Default: runs at this temperature or warmer are excluded from durability fits (rule graded C/D; the cut-off is a default).',
      },
    ),
    bodyMassLossExcludePct: param(
      'a7.bodyMassLossExcludePct',
      2,
      'C',
      'A7',
      [
        'wingo-2020-drift-vo2max-heat-running',
        'montain-1992-dehydration-drift',
        'ganio-2006-fluid-vo2peak-drift',
      ],
      { unit: '%', note: 'Hot runs with no fluid or more than this body-mass loss are excluded.' },
    ),
    driftInferenceLimitMin: param(
      'a7.driftInferenceLimitMin',
      180,
      'D',
      'A7',
      ['mattsson-2011-late-drift-ultra'],
      { unit: 'min', note: 'Default: no drift-based fitness inference beyond this duration.' },
    ),
  },
  a8: {
    recentWeeks: param(
      'a8.recentWeeks',
      4,
      'D',
      'A8',
      [
        'roete-2021-functional-overreaching-markers',
        'nuuttila-2021-intensity-vs-volume-monitoring',
      ],
      {
        unit: 'weeks',
        note: 'Default: the current efficiency is the median of qualifying runs in this many recent weeks.',
      },
    ),
    priorWeeks: param(
      'a8.priorWeeks',
      4,
      'D',
      'A8',
      [
        'roete-2021-functional-overreaching-markers',
        'nuuttila-2021-intensity-vs-volume-monitoring',
      ],
      {
        unit: 'weeks',
        note: 'Default: the trend compares the current window with this many weeks before it.',
      },
    ),
    minRunsPerWindow: param(
      'a8.minRunsPerWindow',
      3,
      'D',
      'A8',
      [
        'roete-2021-functional-overreaching-markers',
        'nuuttila-2021-intensity-vs-volume-monitoring',
      ],
      {
        unit: 'runs',
        note: 'Default: fewest qualifying runs in a window that give an efficiency value; no cut-off is validated.',
      },
    ),
    minDurationMin: param(
      'a8.minDurationMin',
      20,
      'D',
      'A8',
      ['roete-2021-functional-overreaching-markers'],
      {
        unit: 'min',
        note: 'Default: shorter runs are too brief for heart rate to settle.',
      },
    ),
    maxDurationMin: param(
      'a8.maxDurationMin',
      90,
      'D',
      'A8',
      ['nuuttila-2025-recreational-runners-durability'],
      {
        unit: 'min',
        note: 'Default: longer runs are left out so cardiac drift does not move the index (drift is about 5.5% at 90 min).',
      },
    ),
  },
  acclim: {
    exposureTempC: param('acclim.exposureTempC', 25, 'D', 'I8', ['racinais-2015-heat-consensus'], {
      unit: 'C',
      note: 'Default: a run at this air temperature or warmer counts as a heat exposure day (same cut-off as a7.heatExcludeC).',
    }),
    exposureMinDurationMin: param(
      'acclim.exposureMinDurationMin',
      30,
      'D',
      'I8',
      ['racinais-2015-heat-consensus'],
      {
        unit: 'min',
        note: 'Default: a hot run shorter than this does not count as a heat exposure day.',
      },
    ),
  },
  a9: {
    recentInjuryWindowMonths: param(
      'a9.recentInjuryWindowMonths',
      12,
      'D',
      'A9',
      ['hulme-2017-risk-protective', 'vanderworp-2015-risk-factors'],
      {
        unit: 'months',
        note: 'Default: the injury factor is grade A, the 12-month window is an engine default.',
      },
    ),
    priorBsiOddsRatio: param(
      'a9.priorBsiOddsRatio',
      5,
      'A',
      'A9',
      ['wright-2015-stress-fracture-meta'],
      {
        unit: 'ratio',
        note: 'Previous bone stress injury, OR about 5.',
      },
    ),
    noviceFlagAgeMin: param(
      'a9.noviceFlagAgeMin',
      45,
      'C',
      'A9',
      ['kluitenberg-2015-nlstart2run', 'nielsen-2013-novice-predictors'],
      { unit: 'years', note: 'Novice soft flag: age 45-65.' },
    ),
    noviceFlagAgeMax: param(
      'a9.noviceFlagAgeMax',
      65,
      'C',
      'A9',
      ['kluitenberg-2015-nlstart2run', 'nielsen-2013-novice-predictors'],
      { unit: 'years', note: 'Novice soft flag: age 45-65.' },
    ),
    bsiWeeklyHours: param('a9.bsiWeeklyHours', 12, 'B', 'A9', ['barrack-2014-bone-stress-triad'], {
      unit: 'h per week',
      note: 'Purposeful exercise of 12 h per week or more is one BSI factor.',
    }),
    bsiWeeklyWindowWeeks: param(
      'a9.bsiWeeklyWindowWeeks',
      4,
      'D',
      'A9',
      ['barrack-2014-bone-stress-triad'],
      {
        unit: 'weeks',
        note: 'Default: weekly hours are averaged over this many recent weeks of running.',
      },
    ),
    bsiBmiBelow: param('a9.bsiBmiBelow', 21, 'B', 'A9', ['barrack-2014-bone-stress-triad'], {
      unit: 'kg/m2',
      note: 'BMI below 21 is one BSI factor in female athletes; the source warns against applying it to males or older athletes.',
    }),
    noviceFlagBmiAbove: param(
      'a9.noviceFlagBmiAbove',
      30,
      'C',
      'A9',
      ['kluitenberg-2015-nlstart2run', 'nielsen-2013-novice-predictors'],
      { unit: 'kg/m2' },
    ),
  },
  a10: {
    ffmMinObservations: param(
      'a10.ffmMinObservations',
      20,
      'D',
      'A10',
      ['busso-2006-modeling-training-planning'],
      {
        unit: 'performance observations',
        note: 'Default: minimum data for fitting a fitness-fatigue model for monitoring views.',
      },
    ),
    ffmMinWeeks: param(
      'a10.ffmMinWeeks',
      12,
      'D',
      'A10',
      ['busso-2006-modeling-training-planning'],
      {
        unit: 'weeks',
        note: 'Default: the observations must span at least this many weeks.',
      },
    ),
    ffmIntervalWidthFlagDays: param(
      'a10.ffmIntervalWidthFlagDays',
      25,
      'C',
      'A10',
      ['hellard-2006-banister-limitations'],
      { unit: 'days', note: 'Flag fits whose time-constant intervals are wider than this.' },
    ),
  },
} satisfies ParamGroups

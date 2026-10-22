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

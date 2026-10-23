// Section (k) Taper and race week. Source: research/engine-rules.md. Task E5 may add here.
// Where the rules give a window the value is the end the engine starts from; heavier builds use
// the longer end (K2, K4).
import { param, type ParamGroups } from './define.ts'

const TAPER_LENGTH = [
  'bosquet-2007-taper-meta-analysis',
  'wang-2023-taper-endurance-sr-ma',
  'smyth-2021-marathon-taper-big-data',
]

export const kTaper = {
  k1: {
    maxDays: param('k1.maxDays', 21, 'A', 'K1', TAPER_LENGTH, {
      unit: 'days',
      note: 'Never longer than 21 days.',
    }),
    fiveKmDays: param<number>('k1.fiveKmDays', 7, 'C', 'K1', TAPER_LENGTH, {
      unit: 'days',
      range: [7, 10],
      note: '5K: 7-10 days; the short end is the starting value.',
    }),
    tenKmDays: param<number>('k1.tenKmDays', 10, 'C', 'K1', TAPER_LENGTH, {
      unit: 'days',
      range: [7, 14],
      note: '10K takes 10 days, the overlap point.',
    }),
    halfMarathonDays: param('k1.halfMarathonDays', 14, 'A', 'K1', TAPER_LENGTH, { unit: 'days' }),
    marathonDays: param('k1.marathonDays', 21, 'B', 'K1', TAPER_LENGTH, { unit: 'days' }),
    marathonLowVolumeDays: param('k1.marathonLowVolumeDays', 14, 'B', 'K1', TAPER_LENGTH, {
      unit: 'days',
      note: '14 days for low-volume marathon builds.',
    }),
    ultra50to100kDays: param('k1.ultra50to100kDays', 14, 'D', 'K1', TAPER_LENGTH, {
      unit: 'days',
      note: 'Default: no ultra taper trial evidence.',
    }),
    ultra100miDays: param<number>('k1.ultra100miDays', 14, 'D', 'K1', TAPER_LENGTH, {
      unit: 'days',
      range: [14, 21],
      note: 'Default: 100 miles, 14-21 days; the short end is the starting value.',
    }),
  },
  k2: {
    meanVolumeFraction: param<[number, number]>(
      'k2.meanVolumeFraction',
      [0.4, 0.59],
      'A',
      'K2',
      ['wang-2023-taper-endurance-sr-ma'],
      {
        unit: 'fraction of the pre-taper reference week',
        note: 'Mean taper volume; heavier builds use the longer, deeper end (grade C).',
      },
    ),
    threeWeekMultipliers: param<number[]>(
      'k2.threeWeekMultipliers',
      [0.75, 0.55, 0.35],
      'D',
      'K2',
      ['spilsbury-2015-elite-runner-taper-survey'],
      {
        unit: 'fraction of the pre-taper reference week',
        note: 'Default: weekly multipliers of a 3-week taper. Taper weeks decrease strictly.',
      },
    ),
    twoWeekMultipliers: param<number[]>(
      'k2.twoWeekMultipliers',
      [0.65, 0.4],
      'D',
      'K2',
      ['spilsbury-2015-elite-runner-taper-survey'],
      {
        unit: 'fraction of the pre-taper reference week',
        note: 'Default: weekly multipliers of a 2-week taper.',
      },
    ),
    stepTaperMaxDays: param(
      'k2.stepTaperMaxDays',
      10,
      'B',
      'K2',
      ['thomas-2005-taper-model-simulation'],
      {
        unit: 'days',
        note: 'Only tapers of 7-10 days may be step tapers.',
      },
    ),
  },
  k3: {
    minQualitySessionsPerWeek: param(
      'k3.minQualitySessionsPerWeek',
      1,
      'A',
      'K3',
      ['mujika-2010-intense-training-taper'],
      {
        unit: 'sessions per week',
        note: 'At pre-taper pace, with fewer reps.',
      },
    ),
    runDaysMaxCutPct: param(
      'k3.runDaysMaxCutPct',
      20,
      'B',
      'K3',
      ['mujika-2002-taper-frequency-middle-distance', 'mujika-2003-taper-scientific-bases'],
      {
        unit: '%',
        note: 'Run days fall by no more than this.',
      },
    ),
  },
  k6: {
    carbLoadGPerKgDay: param<[number, number]>(
      'k6.carbLoadGPerKgDay',
      [8, 10],
      'C',
      'K6',
      ['bussau-2002-carb-loading-one-day'],
      {
        unit: 'g/kg/day',
        note: 'In the final 24-48 h, with little running.',
      },
    ),
    carbLoadFinalHours: param<[number, number]>(
      'k6.carbLoadFinalHours',
      [24, 48],
      'C',
      'K6',
      ['bussau-2002-carb-loading-one-day'],
      {
        unit: 'h',
      },
    ),
    carbLoadMinRaceMin: param(
      'k6.carbLoadMinRaceMin',
      90,
      'C',
      'K6',
      ['bussau-2002-carb-loading-one-day'],
      {
        unit: 'min',
        note: 'For races of this duration or more.',
      },
    ),
    firstHalfWarningCsFraction: param(
      'k6.firstHalfWarningCsFraction',
      0.94,
      'C',
      'K6',
      ['smyth-2020-cs-training-data', 'smyth-2018-pacing-start-end'],
      {
        unit: 'fraction of CS',
        note: 'Marathon pacing warning when the first half is faster than this.',
      },
    ),
  },
  k7: {
    expectedBenefitPct: param<[number, number]>('k7.expectedBenefitPct', [0.5, 3], 'D', 'K7', [], {
      unit: '%',
      note: 'Default: describe the benefit as about 0.5-3%, as a sketch.',
    }),
    marathonCohortMedianPct: param(
      'k7.marathonCohortMedianPct',
      2.6,
      'D',
      'K7',
      ['smyth-2021-marathon-taper-big-data'],
      {
        unit: '%',
        note: 'Default: the marathon cohort median is an association, not a promise.',
      },
    ),
  },
  // Engine default where the rule names a condition but no number.
  k1Design: {
    lowVolumeWeeklyMin: param('k1Design.lowVolumeWeeklyMin', 240, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: a marathon build below this typical weekly running time counts as low volume for the shorter taper (K1).',
    }),
  },
} satisfies ParamGroups

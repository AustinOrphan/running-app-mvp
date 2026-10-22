// Section (d) Goal modelling and feasibility. Source: research/engine-rules.md. Task E4 may add here.
import { param, type ParamGroups } from './define.ts'

export const dGoal = {
  d1: {
    ultraAboveM: param(
      'd1.ultraAboveM',
      42200,
      'D',
      'D1',
      ['scheer-2020-defining-off-road-running'],
      {
        unit: 'm',
        note: 'Default: an ultra is any race longer than 42.2 km; rules branch on descriptors, not on distance alone.',
      },
    ),
  },
  d2: {
    finishFirstFromM: param(
      'd2.finishFirstFromM',
      160934,
      'C',
      'D2',
      ['knechtle-2018-ultra-physiology-review', 'coates-2021-physio-determinants-ultra'],
      {
        unit: 'm',
        note: '100 miles in metres; from this distance the goal type defaults to finish-first. Volume floors apply only to time goals.',
      },
    ),
  },
  d3: {
    halfMinWeeklyKm: param(
      'd3.halfMinWeeklyKm',
      32,
      'B',
      'D3',
      ['fokkema-2020-half-marathon-volume-long-run'],
      {
        unit: 'km/week',
        note: 'Half-marathon time goal: more than 32 km per week; a soft floor reached only within the section g limits.',
      },
    ),
    halfMinLongRunKm: param(
      'd3.halfMinLongRunKm',
      21,
      'B',
      'D3',
      ['fokkema-2020-half-marathon-volume-long-run'],
      {
        unit: 'km',
        note: 'Half-marathon time goal: longest run above 21 km.',
      },
    ),
    marathonMinWeeklyKm: param(
      'd3.marathonMinWeeklyKm',
      40,
      'B',
      'D3',
      ['fokkema-2020-half-marathon-volume-long-run'],
      {
        unit: 'km/week',
        note: 'Marathon time goal: at least 40 km per week in the build block (grade B, low confidence).',
      },
    ),
    marathonMinLongRunKm: param(
      'd3.marathonMinLongRunKm',
      25,
      'B',
      'D3',
      ['fokkema-2020-half-marathon-volume-long-run'],
      {
        unit: 'km',
        note: 'Marathon time goal: at least one long run of 25 km or more (grade B, low confidence).',
      },
    ),
    marathonPeakLongRunKm: param<[number, number]>(
      'd3.marathonPeakLongRunKm',
      [28, 32],
      'D',
      'D3',
      ['doherty-2020-marathon-training-meta'],
      {
        unit: 'km',
        note: 'Default: peak long run range, only for athletes already at about 50 km per week.',
      },
    ),
    marathonPeakLongRunMaxCount: param(
      'd3.marathonPeakLongRunMaxCount',
      3,
      'D',
      'D3',
      ['doherty-2020-marathon-training-meta'],
      {
        unit: 'runs',
        range: [1, 3],
        note: 'Default: peak-length long runs happen 1-3 times; 3 is the upper bound.',
      },
    ),
    marathonPeakLongRunMinWeeklyKm: param(
      'd3.marathonPeakLongRunMinWeeklyKm',
      50,
      'D',
      'D3',
      ['doherty-2020-marathon-training-meta'],
      {
        unit: 'km/week',
        note: 'Default: peak long runs of 28-32 km only for athletes already at about this weekly volume.',
      },
    ),
    typicalSessionKm: param(
      'd3.typicalSessionKm',
      10,
      'C',
      'D3',
      ['yamaguchi-2023-volume-frequency-run-distance'],
      {
        unit: 'km',
        note: 'Typical session length of about 10 km or more before weekly volume becomes the main lever.',
      },
    ),
  },
  d4: {
    weeklyGrowth: param('d4.weeklyGrowth', 1.1, 'D', 'D4', [], {
      unit: 'ratio per week',
      note: 'Default: feasibility check assumes 10% growth per week of the long run (the soft weekly ramp).',
    }),
    cutbackFactor: param('d4.cutbackFactor', 4 / 3, 'D', 'D4', [], {
      unit: 'ratio',
      note: 'Default: weeks needed are multiplied by 4/3 to allow for cutback weeks (3:1), plus the taper.',
    }),
  },
  d5: {
    lowWeeklyKm: param('d5.lowWeeklyKm', 30, 'D', 'D5', ['craddock-2020-acwr-two-oceans'], {
      unit: 'km/week',
      note: 'Default: ultra readiness note when the average over the window is under this.',
    }),
    lowWeeklyWindowWeeks: param(
      'd5.lowWeeklyWindowWeeks',
      12,
      'D',
      'D5',
      ['craddock-2020-acwr-two-oceans'],
      {
        unit: 'weeks',
        note: 'Default: window for the weekly distance note.',
      },
    ),
    minYearsRunning: param(
      'd5.minYearsRunning',
      3,
      'D',
      'D5',
      ['hoffman-2013-ultra-exercise-behavior'],
      {
        unit: 'years',
        note: 'Default: note when fewer than 3 years of regular running precede a first ultra; first-timer status alone is not a risk factor.',
      },
    ),
  },
  d6: {
    raceWbgtAcclimationC: param('d6.raceWbgtAcclimationC', 18, 'D', 'D6', [], {
      unit: 'C WBGT',
      note: 'Default: forecast or climatological race WBGT at or above this requires a heat acclimation block (same value as i8.triggerWbgtC).',
    }),
  },
} satisfies ParamGroups

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
  d1Class: {
    fiveKmUpperM: param('d1Class.fiveKmUpperM', 7500, 'D', 'D1', [], {
      unit: 'm',
      note: 'Default: goals up to this distance are classed 5K (the midpoint to the 10K class).',
    }),
    tenKmUpperM: param('d1Class.tenKmUpperM', 15000, 'D', 'D1', [], {
      unit: 'm',
      note: 'Default: goals up to this distance are classed 10K.',
    }),
    halfUpperM: param('d1Class.halfUpperM', 32000, 'D', 'D1', [], {
      unit: 'm',
      note: 'Default: goals up to this distance are classed half-marathon; longer road races up to the ultra threshold are classed marathon.',
    }),
    ultra50UpperM: param('d1Class.ultra50UpperM', 80467, 'D', 'D1', [], {
      unit: 'm',
      note: 'Default: 50 miles in metres; ultras above the ultra threshold up to this distance are classed 50K.',
    }),
    ultra100kUpperM: param('d1Class.ultra100kUpperM', 130000, 'D', 'D1', [], {
      unit: 'm',
      note: 'Default: goals above the 50 class up to this distance are classed 100K.',
    }),
    ultra100miUpperM: param('d1Class.ultra100miUpperM', 170000, 'D', 'D1', [], {
      unit: 'm',
      note: 'Default: goals above the 100K class up to this distance are classed 100 miles; longer goals are classed beyond.',
    }),
  },
  d1Dark: {
    dawnHour: param('d1Dark.dawnHour', 6, 'D', 'D1', [], {
      unit: 'hour of day',
      note: 'Default: a race that starts before this local hour is run partly in darkness. Season and latitude are not modelled.',
    }),
    duskHour: param('d1Dark.duskHour', 20, 'D', 'D1', [], {
      unit: 'hour of day',
      note: 'Default: a race still running after this local hour crosses darkness. Season and latitude are not modelled.',
    }),
  },
  d1Prior: {
    paceSecPerKm: param('d1Prior.paceSecPerKm', 420, 'D', 'D1', [], {
      unit: 'sec/km',
      note: 'Default pace prior (7:00 per km) for the expected duration of a race up to the ultra threshold when there is no prediction and no target time.',
    }),
    ultraPaceSecPerKm: param('d1Prior.ultraPaceSecPerKm', 600, 'D', 'D1', [], {
      unit: 'sec/km',
      note: 'Default pace prior (10:00 per km of effort-equivalent distance) for an ultra when there is no prediction and no target time.',
    }),
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
  d4LongRun: {
    ultra50: param(
      'd4LongRun.ultra50',
      180,
      'D',
      'D4',
      [
        'outside-2023-strava-western-states',
        'outside-2015-orton-koop-100-miles',
        'tan-2017-finishers-161km',
        'taksaudom-2017-66km-predictors',
      ],
      {
        unit: 'min',
        note: 'Default: longest single run the feasibility check works toward for a 50K ultra (about a marathon-length run, the common convention); back-to-back days (H3) add time on feet beyond it, and the H2 cap stays the ceiling. It sits at or below observed practice, and no study links any longest run to finishing.',
      },
    ),
    ultra100k: param(
      'd4LongRun.ultra100k',
      240,
      'D',
      'D4',
      [
        'outside-2023-strava-western-states',
        'outside-2023-strava-utmb',
        'tan-2017-finishers-161km',
      ],
      {
        unit: 'min',
        note: 'Default: longest single run the feasibility check works toward for 100K (about a 20-24 mile trail run); back-to-backs add time on feet, H2 caps it. It sits at or below observed practice, and no study links any longest run to finishing.',
      },
    ),
    ultra100mi: param(
      'd4LongRun.ultra100mi',
      240,
      'D',
      'D4',
      [
        'outside-2023-strava-western-states',
        'outside-2023-strava-utmb',
        'outside-2015-orton-koop-100-miles',
        'tan-2017-finishers-161km',
        'baldea-2009-leadville-training',
      ],
      {
        unit: 'min',
        note: 'Default: longest single run the feasibility check works toward for 100 miles; back-to-backs add time on feet, H2 caps it. UTMB finishers and non-finishers had nearly identical median longest runs, so no study ties a longest run to finishing; raising the target toward the 6-7 h coaching convention would add load on convention alone.',
      },
    ),
    beyond: param('d4LongRun.beyond', 270, 'D', 'D4', ['daniel-2024-217km-sleep-training'], {
      unit: 'min',
      note: 'Default: longest single run the feasibility check works toward beyond 100 miles; back-to-backs add time on feet, H2 caps it. One questionnaire study beyond 100 miles (217 km, n = 38) reports training frequency, which correlates with race time; no study there tests long-run size, so this is an extrapolation.',
    }),
  },
  d4Label: {
    comfortableMargin: param('d4Label.comfortableMargin', 1.25, 'D', 'D4', [], {
      unit: 'ratio of weeks available to weeks needed',
      note: 'Default: comfortable at or above this ratio, tight from 1.0 up to it, not reachable below 1.0. The rule names the labels, not the cut-offs.',
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

// Section (f) Microcycle and session library. Source: research/engine-rules.md. Task E6 may add
// here. `flib` holds the session library table; its rule id is 'F-lib'.
import { param, type ParamGroups } from './define.ts'

const HEAVY = [
  'llanoslagos-2024-economy-speeds',
  'storen-2008-maximal-strength-economy',
  'eihara-2024-middle-aged-pt-rt',
]

export const fMicro = {
  flib: {
    longRunMinMin: param(
      'flib.longRunMinMin',
      90,
      'C',
      'F-lib',
      ['zanini-2026-long-runs-economy-durability'],
      {
        unit: 'min',
        note: 'Long run of at least this length for half-marathon and longer, once the base allows. Mostly Z1.',
      },
    ),
    longRunEveryDays: param<number>(
      'flib.longRunEveryDays',
      14,
      'C',
      'F-lib',
      ['zanini-2026-long-runs-economy-durability'],
      {
        unit: 'days',
        range: [7, 14],
        note: 'A long run every 7-14 days; 14 is the longer end.',
      },
    ),
    fastFinishFraction: param(
      'flib.fastFinishFraction',
      0.2,
      'D',
      'F-lib',
      ['jones-2025-resilience-training'],
      {
        unit: 'fraction of duration',
        note: 'Default: final 20% of duration at goal marathon pace; never in heat-flagged or low-fluid conditions.',
      },
    ),
    fastFinishMinGapWeeks: param(
      'flib.fastFinishMinGapWeeks',
      2,
      'D',
      'F-lib',
      ['jones-2025-resilience-training'],
      {
        unit: 'weeks',
        note: 'Default: at most once every 2 weeks.',
      },
    ),
    stridesCount: param<number>(
      'flib.stridesCount',
      8,
      'A',
      'F-lib',
      ['balsalobre-2016-running-economy-highly-trained'],
      {
        unit: 'sprints',
        range: [5, 10],
        note: '5-10 short sprints inside the plyometric dose; 8 is the midpoint.',
      },
    ),
    heavyMinPct1rm: param('flib.heavyMinPct1rm', 80, 'A', 'F-lib', HEAVY, {
      unit: '% 1RM',
      range: [80, 90],
      note: 'At least 80% 1RM, 90% where tolerated. Include heavy calf raises. Method grade A, dose grade D.',
    }),
    heavyExercises: param<number>('flib.heavyExercises', 3, 'D', 'F-lib', HEAVY, {
      unit: 'exercises',
      range: [2, 4],
      note: 'Default: 2-4 exercises per session; 3 is the midpoint.',
    }),
    heavySets: param<number>('flib.heavySets', 3, 'D', 'F-lib', HEAVY, {
      unit: 'sets',
      range: [3, 4],
      note: 'Default: 3-4 sets per exercise.',
    }),
    heavyReps: param<number>('flib.heavyReps', 5, 'D', 'F-lib', HEAVY, {
      unit: 'reps',
      range: [3, 6],
      note: 'Default: 3-6 reps per set; 5 is the midpoint.',
    }),
    heavyRampInWeeks: param<number>('flib.heavyRampInWeeks', 3, 'D', 'F-lib', HEAVY, {
      unit: 'weeks',
      range: [2, 4],
      note: 'Default: 2-4 week ramp-in; 3 is the midpoint.',
    }),
    plyoContactsMax: param(
      'flib.plyoContactsMax',
      200,
      'A',
      'F-lib',
      ['llanoslagos-2024-economy-speeds'],
      {
        unit: 'contacts per session',
        note: 'The highest dose observed in trials.',
      },
    ),
    plyoEmphasisPaceKmh: param(
      'flib.plyoEmphasisPaceKmh',
      12,
      'A',
      'F-lib',
      ['llanoslagos-2024-economy-speeds'],
      {
        unit: 'km/h',
        note: 'Emphasise plyometrics when running pace is 12 km/h or slower.',
      },
    ),
    hipCoreSessionsPerWeek: param<number>(
      'flib.hipCoreSessionsPerWeek',
      2,
      'D',
      'F-lib',
      ['leppanen-2024-hip-core-novice'],
      {
        unit: 'sessions per week',
        range: [2, 3],
        note: 'Default: dose of the hip/core block before runs for novices (the block itself is grade B).',
      },
    ),
    strengthPerWeek: param(
      'flib.strengthPerWeek',
      2,
      'A',
      'F-lib',
      ['blagrove-2018-strength-determinants'],
      {
        unit: 'sessions per week',
        range: [2, 3],
      },
    ),
    runWalkDaysPerWeek: param(
      'flib.runWalkDaysPerWeek',
      3,
      'D',
      'F-lib',
      ['kluitenberg-2015-nlstart2run', 'hottenrott-2016-run-walk-marathon'],
      {
        unit: 'days per week',
        note: 'Default: novice run-walk programme runs 3 days per week.',
      },
    ),
    runWalkWeeks: param(
      'flib.runWalkWeeks',
      6,
      'D',
      'F-lib',
      ['kluitenberg-2015-nlstart2run', 'hottenrott-2016-run-walk-marathon'],
      {
        unit: 'weeks',
        note: 'Default: novice run-walk programme lasts 6 weeks.',
      },
    ),
    runWalkRunUnits: param(
      'flib.runWalkRunUnits',
      1,
      'D',
      'F-lib',
      ['kluitenberg-2015-nlstart2run', 'hottenrott-2016-run-walk-marathon'],
      {
        unit: 'parts run',
        note: 'Default: run:walk ratio 1:2, run part.',
      },
    ),
    runWalkWalkUnits: param(
      'flib.runWalkWalkUnits',
      2,
      'D',
      'F-lib',
      ['kluitenberg-2015-nlstart2run', 'hottenrott-2016-run-walk-marathon'],
      {
        unit: 'parts walk',
        note: 'Default: run:walk ratio 1:2, walk part.',
      },
    ),
  },
  f1: {
    hitSpacingHours: param(
      'f1.hitSpacingHours',
      48,
      'C',
      'F1',
      ['stanley-2013-parasympathetic-reactivation', 'casado-2022-elite-runners-review'],
      {
        unit: 'h',
        note: 'At least 48 h after high-intensity work before the next hard session. No consecutive hard days by default.',
      },
    ),
    thresholdSpacingHours: param<number>(
      'f1.thresholdSpacingHours',
      48,
      'C',
      'F1',
      ['stanley-2013-parasympathetic-reactivation', 'casado-2022-elite-runners-review'],
      {
        unit: 'h',
        range: [24, 48],
        note: '24-48 h after threshold work; 48 is the conservative end.',
      },
    ),
  },
  f2: {
    qualitySessionsPerWeek: param<number>(
      'f2.qualitySessionsPerWeek',
      2,
      'D',
      'F2',
      ['casado-2022-elite-runners-review'],
      {
        unit: 'sessions per week',
        range: [1, 2],
        note: 'Default: 1-2 quality sessions per week, sized from a minutes budget; 2 is the upper bound.',
      },
    ),
    z2z3Share: param(
      'f2.z2z3Share',
      20,
      'D',
      'F2',
      ['sylta-2014-tid-quantification', 'casado-2022-elite-runners-review'],
      {
        unit: '% of weekly time',
        note: 'Default: zone 2 and zone 3 together take about 20% of weekly time.',
      },
    ),
    z2z3ShareMax: param(
      'f2.z2z3ShareMax',
      25,
      'D',
      'F2',
      ['sylta-2014-tid-quantification', 'casado-2022-elite-runners-review'],
      {
        unit: '% of weekly time',
        note: 'Default: never more than 25%.',
      },
    ),
  },
  f4: {
    strengthSeparationHours: param(
      'f4.strengthSeparationHours',
      3,
      'A',
      'F4',
      ['schumann-2022-concurrent-compatibility', 'wilson-2012-concurrent-interference'],
      {
        unit: 'h',
        note: 'Strength sessions at least this far from key runs, never directly before the long run (grade A, low confidence).',
      },
    ),
  },
  f5: {
    noviceRunDays: param('f5.noviceRunDays', 3, 'D', 'F5', ['kluitenberg-2015-nlstart2run'], {
      unit: 'days per week',
      note: 'Default: novices run 3 non-consecutive days per week; the rule gives no grade.',
    }),
    fourDaysFromWeeklyMin: param('f5.fourDaysFromWeeklyMin', 180, 'D', 'F5', [], {
      unit: 'min per week',
      note: 'Default: from 3 h of weekly running at least 4 run days when the days are available.',
    }),
    fiveDaysFromWeeklyMin: param('f5.fiveDaysFromWeeklyMin', 300, 'D', 'F5', [], {
      unit: 'min per week',
      note: 'Default: from 5 h of weekly running at least 5 run days when the days are available.',
    }),
    sixDaysFromWeeklyMin: param('f5.sixDaysFromWeeklyMin', 420, 'D', 'F5', [], {
      unit: 'min per week',
      note: 'Default: from 7 h of weekly running at least 6 run days when the days are available.',
    }),
    mastersMinAge: param('f5.mastersMinAge', 40, 'D', 'F5', ['mckean-2006-masters-injury'], {
      unit: 'years',
      note: 'Default: the run-day cap applies from this age.',
    }),
    mastersMaxRunDays: param('f5.mastersMaxRunDays', 6, 'D', 'F5', ['mckean-2006-masters-injury'], {
      unit: 'days per week',
      note: 'Default: no more than 6 run days for runners 40 and over; overridable.',
    }),
  },
  fplace: {
    easyRunMinMin: param(
      'fplace.easyRunMinMin',
      20,
      'D',
      'F5',
      ['kluitenberg-2015-nlstart2run', 'buist-2008-graded-training'],
      {
        unit: 'min',
        note: "Default: easy and recovery runs last at least this long (novice and return programmes start at 20-30 minute sessions); run-walk sessions are exempt and keep the minimum run day. The long run is never shorter than this or than the week's other runs.",
      },
    ),
    minRunsPerWeek: param('fplace.minRunsPerWeek', 2, 'D', 'F5', [], {
      unit: 'runs per week',
      note: 'Default: outside taper, race and recovery weeks a week holds at least this many runs; when its minutes cannot fit the planned run days at the minimum, fewer runs are placed rather than shorter ones.',
    }),
    minRunDayMin: param('fplace.minRunDayMin', 15, 'D', 'F5', [], {
      unit: 'min',
      note: 'Default: a run day shorter than this is dropped and its minutes stay unplaced (never made up elsewhere); no study sets a minimum run length.',
    }),
    strengthSessionMin: param('fplace.strengthSessionMin', 30, 'D', 'F4', [], {
      unit: 'min',
      note: 'Default: length of a strength session when it is placed in the week; the dose itself is in flib.heavy*.',
    }),
    b2bDay2Fraction: param(
      'fplace.b2bDay2Fraction',
      0.6,
      'D',
      'H3',
      ['frandsen-2025-session-spike'],
      {
        unit: 'fraction of day 1',
        note: 'Default: day 2 of a back-to-back pair is this fraction of day 1, within the h3 limits (never longer than day 1).',
      },
    ),
  },
} satisfies ParamGroups

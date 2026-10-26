// Section (f) Microcycle and session library. Source: research/engine-rules.md. Task E6 may add
// here. `flib` holds the session library table; its rule id is 'F-lib'. `f7`, `f8` and `f9` hold
// the strength prescription (ADR 0014): session structure, load progression, lighter days.
import { param, type ParamGroups } from './define.ts'

const HEAVY = [
  'llanoslagos-2024-economy-speeds',
  'storen-2008-maximal-strength-economy',
  'eihara-2024-middle-aged-pt-rt',
]

/** The heavy method (grade A) also rests on the pooled analyses of heavy work and of strength training. */
const HEAVY_METHOD = [
  ...HEAVY,
  'eihara-2022-heavy-vs-plyo',
  'berryman-2018-strength-performance-meta',
]

/** The ramp-in length is also lengthened for masters runners, on low-confidence support. */
const RAMP_IN = [
  ...HEAVY,
  'piacentini-2013-masters-runners',
  'schumann-2022-concurrent-compatibility',
]

/** Where the effort target is a count of repetitions left, and how well people count them. */
const REPS_IN_RESERVE = ['zourdos-2016-rir-rpe-scale', 'halperin-2021-rir-prediction-accuracy']

/** What the maintenance, lighter-week and taper doses rest on: reduced doses and stopping. */
const MAINTENANCE = [
  'spiering-2021-minimal-dose',
  'bickel-2011-maintenance-dosing-retention',
  'androulakis-2019-minimum-effective-dose',
]

/** The progression convention and the one synthesis that compares ways of choosing a load. */
const PROGRESSION = ['acsm-2009-progression-models-resistance', 'hickmott-2022-autoregulation-meta']

/** How strength is kept and lost over a gap. */
const GAP = ['mujika-2000-detraining-part2', 'bickel-2011-maintenance-dosing-retention']

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
    heavyMinPct1rm: param('flib.heavyMinPct1rm', 80, 'A', 'F-lib', HEAVY_METHOD, {
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
    heavyRampInWeeks: param<number>('flib.heavyRampInWeeks', 3, 'D', 'F-lib', RAMP_IN, {
      unit: 'weeks',
      range: [2, 4],
      note: 'Default: 2-4 week ramp-in; 3 is the midpoint.',
    }),
    plyoContactsMax: param(
      'flib.plyoContactsMax',
      200,
      'A',
      'F-lib',
      ['llanoslagos-2024-economy-speeds', 'balsalobre-2016-running-economy-highly-trained'],
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
      ['blagrove-2018-strength-determinants', 'balsalobre-2016-running-economy-highly-trained'],
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
      9,
      'D',
      'F-lib',
      ['kluitenberg-2015-nlstart2run', 'hottenrott-2016-run-walk-marathon'],
      {
        unit: 'weeks',
        note: 'Default: the novice run-walk ladder (E6) has nine rungs, one plan week each; a repeated rung makes it longer.',
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
        note: 'Default: run:walk ratio 1:2, run part; the ratio of rung 1 of the novice ladder (E6), which holds the other rungs as data.',
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
        note: 'Default: run:walk ratio 1:2, walk part; the ratio of rung 1 of the novice ladder (E6), which holds the other rungs as data.',
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
    noviceRunDays: param(
      'f5.noviceRunDays',
      3,
      'D',
      'F5',
      [
        'kluitenberg-2015-nlstart2run',
        'pollock-1977-frequency-duration-injury',
        'kluitenberg-2016-nlstart2run-training-factors',
      ],
      {
        unit: 'days per week',
        note: 'Default: novices and runners in the start weeks run at most 3 non-consecutive days per week (2 by choice). The ceiling has trial direction (three days had fewer injuries than five in a 1977 trial; three versus two was not significant), so the grade stays D.',
      },
    ),
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
  // The strength prescription (ADR 0014): F7 the structure of a session and the choice of
  // exercises, F8 the load of each lift, F9 the lighter days. Every value is a default (grade D)
  // except the benefit figure; the gaps behind them are listed in research/engine-rules.md.
  f7: {
    blockSessionMin: param('f7.blockSessionMin', 40, 'D', 'F7', [], {
      unit: 'min',
      note: 'Default: the time budget of a strength session in a block week. The heavy sets with full rests and the jump dose take about this long; a workout that takes less is fine.',
    }),
    maintenanceSessionMin: param('f7.maintenanceSessionMin', 25, 'D', 'F7', [], {
      unit: 'min',
      note: 'Default: the time budget of a maintenance or taper strength session.',
    }),
    maintenanceSets: param('f7.maintenanceSets', 2, 'D', 'F7', MAINTENANCE, {
      unit: 'sets',
      note: 'Default: sets of each lift in a maintenance session, a lighter week and a taper session, at the kept load. A review of non-athletes found strength kept with one set at the kept load, and older adults may need more; no study of runners gives a dose.',
    }),
    rampInReps: param<[number, number]>('f7.rampInReps', [6, 8], 'D', 'F7', [], {
      unit: 'reps',
      note: 'Default: repetitions per set of a ramp-in lift, lighter than the heavy range, for a technique base before heavy work.',
    }),
    rampInSets: param<[number, number]>('f7.rampInSets', [2, 3], 'D', 'F7', [], {
      unit: 'sets',
      note: 'Default: sets of each ramp-in lift, the first value in the first week and the second in later weeks.',
    }),
    easyRir: param('f7.easyRir', 3, 'D', 'F7', REPS_IN_RESERVE, {
      unit: 'reps in reserve',
      note: 'Default: repetitions to leave in reserve in a ramp-in, a taper, a return and the first session of any exercise. The count of repetitions left is imprecise by about one repetition, so it is an effort sketch.',
    }),
    heavyRir: param<[number, number]>(
      'f7.heavyRir',
      [1, 3],
      'D',
      'F7',
      [...REPS_IN_RESERVE, 'robinson-2024-proximity-failure-meta'],
      {
        unit: 'reps in reserve',
        note: 'Default: repetitions to leave in reserve in a block session; no paper tests a target in runners. Strength gains did not depend on the repetitions left over a wide range in a pooled analysis of lifters.',
      },
    ),
    bodyweightReps: param<[number, number]>('f7.bodyweightReps', [8, 15], 'D', 'F7', [], {
      unit: 'reps',
      note: 'Default: repetition range of a movement done without added load and taken near the limit of a set; the heavy range cannot apply without added load.',
    }),
    lowerSeconds: param(
      'f7.lowerSeconds',
      3,
      'D',
      'F7',
      ['temesi-2015-female-neuromuscular-fatigue'],
      {
        unit: 's',
        note: 'Default: the lowering phase of a lift, the eccentric emphasis of rule H5. There is no dose evidence; the fall of knee-extensor force after a long race is the rationale only.',
      },
    ),
    plyoStartContacts: param('f7.plyoStartContacts', 40, 'D', 'F7', [], {
      unit: 'contacts',
      note: 'Default: the start of the ground-contact ladder; no trial gives a starting dose or a progression.',
    }),
    plyoStepContacts: param('f7.plyoStepContacts', 20, 'D', 'F7', [], {
      unit: 'contacts',
      note: 'Default: contacts added at each step of the ladder, taken only after a completed running week.',
    }),
    plyoStepEveryWeeks: param('f7.plyoStepEveryWeeks', 2, 'D', 'F7', [], {
      unit: 'weeks',
      note: 'Default: the earliest cadence of a step of contacts; a step is taken only after a completed running week, and the cap is the highest dose observed in trials (flib.plyoContactsMax).',
    }),
    plyoRungWeeks: param('f7.plyoRungWeeks', 3, 'D', 'F7', [], {
      unit: 'weeks',
      note: 'Default: weeks on one movement of the four-movement ladder, moving on only after a completed running week.',
    }),
    maintenancePlyoContacts: param('f7.maintenancePlyoContacts', 60, 'D', 'F7', [], {
      unit: 'contacts',
      note: 'Default: contacts in a maintenance session.',
    }),
    reducedPlyoShare: param(
      'f7.reducedPlyoShare',
      0.5,
      'D',
      'F7',
      ['llanoslagos-2024-economy-speeds'],
      {
        unit: 'fraction',
        note: 'Default: share of the ladder for a goal pace faster than the plyometric emphasis pace (flib.plyoEmphasisPaceKmh), a bone stress history, a recent injury or a lighter week.',
      },
    ),
    blockCreditWeeks: param('f7.blockCreditWeeks', 4, 'D', 'F7', [], {
      unit: 'weeks',
      note: 'Default: consecutive weeks with a logged block session that let a new block skip its ramp-in after a regenerate.',
    }),
    trunkSets: param('f7.trunkSets', 2, 'D', 'F7', ['leppanen-2024-hip-core-novice'], {
      unit: 'sets',
      note: 'Default: sets of each trunk and hip movement. The programme in the cited trial is grade B for novices; this dose is a default.',
    }),
    trunkReps: param<[number, number]>('f7.trunkReps', [8, 12], 'D', 'F7', [], {
      unit: 'reps',
      note: 'Default: repetitions of a counted trunk or hip movement.',
    }),
    trunkHoldSec: param<[number, number]>('f7.trunkHoldSec', [30, 45], 'D', 'F7', [], {
      unit: 'sec',
      note: 'Default: seconds of a held trunk movement.',
    }),
    taperLifts: param(
      'f7.taperLifts',
      2,
      'D',
      'F7',
      [
        'bosquet-2007-taper-meta-analysis',
        'berryman-2020-strength-cessation-runners',
        'ronnestad-2016-strength-cessation-cyclists',
      ],
      {
        unit: 'exercises',
        note: 'Default: lifts in a taper session, the lead lift and the calf raise. No trial tests resistance training in a taper; the taper meta-analysis concerns endurance training.',
      },
    ),
    expectedBenefitPct: param<[number, number]>(
      'f7.expectedBenefitPct',
      [2, 4],
      'A',
      'F7',
      [
        'denadai-2017-explosive-heavy-economy',
        'llanoslagos-2024-economy-speeds',
        'blagrove-2018-strength-determinants',
      ],
      {
        unit: '%',
        note: 'Planning figure for the lower oxygen cost of running after a full block; single studies report more. It is never a change in VO2max, threshold or pace.',
      },
    ),
  },
  f8: {
    progressMinRir: param('f8.progressMinRir', 1, 'D', 'F8', [...PROGRESSION, ...REPS_IN_RESERVE], {
      unit: 'reps in reserve',
      note: 'Default: repetitions in reserve on every set, at the top of the range, to add one step. No study in runners compares ways of choosing the next load.',
    }),
    bigStepRir: param('f8.bigStepRir', 4, 'D', 'F8', PROGRESSION, {
      unit: 'reps in reserve',
      note: 'Default: repetitions in reserve on every set, at the top of the range, that earn two steps.',
    }),
    maxStepPct: param('f8.maxStepPct', 15, 'D', 'F8', ['acsm-2009-progression-models-resistance'], {
      unit: '%',
      note: 'Default: the largest single step a suggestion makes, as a share of the load; a larger step is not offered. A consensus stand for healthy adults gives 2 to 10% per step, so this cap is looser only because equipment moves in whole steps.',
    }),
    reducePct: param('f8.reducePct', 5, 'D', 'F8', [], {
      unit: '%',
      note: 'Default: reduction after a set below the range, rounded down to a step and at least one step.',
    }),
    ceilingSessions: param('f8.ceilingSessions', 3, 'D', 'F8', [], {
      unit: 'sessions in a row',
      note: 'Default: sessions at the top of the range with no usable step before the next variation of the exercise.',
    }),
    layoffDays: param('f8.layoffDays', 28, 'D', 'F8', GAP, {
      unit: 'days',
      note: 'Default: a gap after which the return rule applies. Force production declines slowly, so this is a caution and not an estimate of lost strength.',
    }),
    layoffLoadFraction: param('f8.layoffLoadFraction', 0.9, 'D', 'F8', GAP, {
      unit: 'fraction',
      note: 'Default: the return load as a share of the last base load.',
    }),
    startPctOf1rm: param('f8.startPctOf1rm', 70, 'D', 'F8', [], {
      unit: '% 1RM',
      note: 'Default: the first ramp-in load as a share of an entered or estimated maximum.',
    }),
    e1rmDivisor: param(
      'f8.e1rmDivisor',
      30,
      'D',
      'F8',
      ['nuzzo-2023-reps-at-percent-1rm', 'reynolds-2006-1rm-prediction'],
      {
        note: 'Default: the divisor of the linear estimate, load x (1 + (reps + reps in reserve) / divisor). No paper validates it in runners; it is an estimate, never a test.',
      },
    ),
    e1rmMaxReps: param('f8.e1rmMaxReps', 10, 'D', 'F8', ['reynolds-2006-1rm-prediction'], {
      unit: 'reps',
      note: 'Default: taken from the advice of one study of the leg press and chest press that a linear equation use no more than 10 repetitions, the most repetitions to the limit (repetitions done plus repetitions left) in a set that gives an estimate. A set above it gives none. No paper validates the figure in runners.',
    }),
    startFractionBodyweight: param<Record<string, number>>(
      'f8.startFractionBodyweight',
      {
        // Fractions of the body weight on the Profile, for the load as the exercise counts it:
        // the total for a bar or a machine, one implement for a dumbbell or kettlebell. Light on
        // purpose, for a lifter new to the exercise; the lightest load the equipment makes is the
        // floor. 0 is a start with no added load.
        'back-squat': 0.35,
        'leg-press': 0.5,
        'goblet-squat': 0.12,
        'split-squat': 0.08,
        'step-up': 0.08,
        'single-leg-box-squat': 0,
        'romanian-deadlift': 0.35,
        'dumbbell-rdl': 0.12,
        'kettlebell-rdl': 0.15,
        'leg-curl': 0.2,
        'hip-thrust': 0.3,
        'single-leg-rdl': 0.08,
        'standing-calf-raise': 0.25,
        'seated-calf-raise': 0.2,
        'single-leg-calf-raise': 0,
        'farmer-carry': 0.15,
      },
      'D',
      'F8',
      [],
      {
        note: 'Default: a first load for each loaded exercise as a fraction of the body weight on the Profile, for an exercise with no history and no entered maximum. The fractions are light on purpose and no paper gives a starting load; a 0 means a start with no added load.',
      },
    ),
  },
  f9: {
    lowReadinessLoadPct: param('f9.lowReadinessLoadPct', 10, 'D', 'F9', [], {
      unit: '%',
      note: 'Default: load reduction on a low-readiness day. Readiness never adds load.',
    }),
    lowReadinessSetsCut: param('f9.lowReadinessSetsCut', 1, 'D', 'F9', [], {
      unit: 'sets',
      note: 'Default: sets removed from each lift on a low-readiness day; at least 2 remain.',
    }),
    countPromptWeeks: param('f9.countPromptWeeks', 3, 'D', 'F9', [], {
      unit: 'weeks',
      note: 'Default: finished weeks with fewer strength sessions than planned before the page asks about a lower weekly count.',
    }),
  },
} satisfies ParamGroups

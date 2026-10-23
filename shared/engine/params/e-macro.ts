// Section (e) Macrocycle. Source: research/engine-rules.md. Task E5 may add here.
// The gut training block (E5) lives in h7 and the heat acclimation block (E5) in i8, where the
// rules give their detail.
import { param, type ParamGroups } from './define.ts'

/**
 * One rung of the run-walk ladder: the sessions of a week, each a list of run and walk minutes in
 * order, starting with a run.
 */
export type Rung = number[][]

/** `unit` repeated `n` times, as one flat list. */
const times = (n: number, unit: number[]): number[] => Array.from({ length: n }, () => unit).flat()

const TID_PRIOR = ['esteve-lanao-2007-tid-runners', 'sperlich-2023-tid-phases']
const TID_FLOOR = [
  'haugen-2022-world-class-runners',
  'sperlich-2023-tid-phases',
  'esteve-lanao-2007-tid-runners',
  'campos-2022-tid-runners-review',
]

/** D7: the plans and coaches whose long runs the 5 km and 10 km caps follow (conventions, grade D). */
const SHORT_RACE_LONG_RUN = [
  'higdon-2024-advanced-5k',
  'higdon-2024-intermediate-5k',
  'higdon-2024-advanced-10k',
  'johnson-2018-long-runs-5k-10k',
  'runningmagazine-2023-daniels-long-run-limit',
]

/** D4: the studies behind the weekly path of the ultra feasibility label (the principle is grade C). */
const ULTRA_WEEKLY_PEAK = [
  'rust-2012-100km-vs-marathoners',
  'belinchon-2021-mountain-race-predictors',
  'tanda-2015-training-anthropometry-100km',
]

export const eMacro = {
  e2: {
    specificWeeksMin: param(
      'e2.specificWeeksMin',
      6,
      'D',
      'E2',
      ['filipas-2022-pyr-pol-periodization'],
      {
        unit: 'weeks',
        note: 'Default: the specific phase lasts 6-8 weeks; every length except 8 is an engine default.',
      },
    ),
    specificWeeksMax: param(
      'e2.specificWeeksMax',
      8,
      'D',
      'E2',
      ['filipas-2022-pyr-pol-periodization'],
      {
        unit: 'weeks',
        note: 'Default: the 8-week figure comes from a 5-10K RCT design; the rule does not grade it, so it is treated as a default.',
      },
    ),
    ultraPeakWeeksBeforeRace: param(
      'e2.ultraPeakWeeksBeforeRace',
      3,
      'D',
      'E2',
      ['byrne-2024-elite-24h-training'],
      {
        unit: 'weeks',
        note: 'Default: peak volume for an ultra falls about 3 weeks before the race (n = 1).',
      },
    ),
  },
  e3: {
    defaultCycleWorkWeeks: param(
      'e3.defaultCycleWorkWeeks',
      3,
      'D',
      'E3',
      ['kiely-2018-periodization-critique', 'foster-1998-monotony-strain'],
      { unit: 'weeks', note: 'Default: 3:1 recovery cycle (3 build weeks, then 1 recovery week).' },
    ),
    flaggedCycleWorkWeeks: param(
      'e3.flaggedCycleWorkWeeks',
      2,
      'D',
      'E3',
      ['kiely-2018-periodization-critique', 'foster-1998-monotony-strain'],
      {
        unit: 'weeks',
        note: 'Default: 2:1 for novices, post-injury athletes, the recent-injury flag and an active fatigue flag. Age alone does not select 2:1.',
      },
    ),
    recoveryWeekCutPct: param(
      'e3.recoveryWeekCutPct',
      25,
      'D',
      'E3',
      ['kiely-2018-periodization-critique', 'foster-1998-monotony-strain'],
      {
        unit: '% volume cut',
        range: [20, 30],
        note: 'Default: recovery-week volume drops 20-30% while keeping some intensity and frequency; 25 is the midpoint of the range.',
      },
    ),
  },
  e4: {
    z1Floor: param('e4.z1Floor', 70, 'B', 'E4', TID_FLOOR, {
      unit: '% of running time',
      note: 'Hard rule: Z1 never below this share. Z2 time never exceeds Z1 time.',
    }),
    z1Prior: param('e4.z1Prior', 80, 'B', 'E4', TID_FLOOR, {
      unit: '% of running time',
      note: 'Prior for base, build and half/marathon phases; Z1 is at least 80% in the base phase.',
    }),
    z2Prior: param('e4.z2Prior', 12, 'C', 'E4', TID_PRIOR, { unit: '% of running time' }),
    z3Prior: param('e4.z3Prior', 8, 'C', 'E4', TID_PRIOR, {
      unit: '% of running time',
      range: [5, 10],
      note: 'Z3 share 5-10%; ultra at most 5% (e4.ultraZ3Max).',
    }),
    priorTolerancePp: param('e4.priorTolerancePp', 5, 'C', 'E4', TID_PRIOR, {
      unit: 'percentage points',
      note: 'Build-phase prior of 80/12/8 holds within this tolerance.',
    }),
    baseZ3Share: param('e4.baseZ3Share', 5, 'C', 'E4', TID_PRIOR, {
      unit: '% of running time',
      note: 'Base phase for 5-10K and half/marathon: Z1 at least 80, Z2 at most 12, Z3 about 5.',
    }),
    z2CapBase: param('e4.z2CapBase', 12, 'B', 'E4', ['rosenblat-2019-pol-vs-thr'], {
      unit: '% of running time',
      note: 'Threshold cap in the base phase.',
    }),
    z2CapAnyPhase: param('e4.z2CapAnyPhase', 25, 'B', 'E4', ['rosenblat-2019-pol-vs-thr'], {
      unit: '% of running time',
      note: 'Threshold cap in any phase.',
    }),
    specificHalfMarathonZ2Max: param(
      'e4.specificHalfMarathonZ2Max',
      25,
      'C',
      'E4',
      ['casado-2022-elite-runners-review', 'kenneally-2021-race-pace-vs-physiological'],
      {
        unit: '% of running time',
        note: 'Specific phase for half/marathon: race pace moves into Z2, Z2 at most 25%.',
      },
    ),
    ultraZ1Min: param('e4.ultraZ1Min', 85, 'D', 'E4', ['fornasiero-2018-ultra-intensity'], {
      unit: '% of running time',
      note: 'Default: ultra column, Z1 at least 85% in every phase; no ultra trial evidence.',
    }),
    ultraZ3Max: param('e4.ultraZ3Max', 5, 'D', 'E4', ['fornasiero-2018-ultra-intensity'], {
      unit: '% of running time',
      note: 'Default: ultra column, Z3 at most 5% in the base phase.',
    }),
    polarizedBlockMaxWeeks: param(
      'e4.polarizedBlockMaxWeeks',
      12,
      'A',
      'E4',
      ['oliveira-2024-pol-meta', 'rosenblat-2025-tid-ipd-nma'],
      {
        unit: 'weeks',
        note: 'A polarized block is offered for competitive 5-10K athletes and lasts under this many weeks, with load held constant.',
      },
    ),
  },
  e5: {
    strengthBlockWeeks: param(
      'e5.strengthBlockWeeks',
      12,
      'A',
      'E5',
      ['eihara-2022-heavy-vs-plyo'],
      {
        unit: 'weeks',
        range: [10, 14],
        note: 'Heavy plus plyometric block in base and early build; 12 is the midpoint of 10-14.',
      },
    ),
    strengthBlockMinWeeks: param(
      'e5.strengthBlockMinWeeks',
      8,
      'A',
      'E5',
      ['eihara-2022-heavy-vs-plyo'],
      {
        unit: 'weeks',
      },
    ),
    strengthMaintenancePerWeek: param('e5.strengthMaintenancePerWeek', 1, 'D', 'E5', [], {
      unit: 'sessions per week',
      note: 'Default: one maintenance session per week after the strength block.',
    }),
  },
  // The start paths [E6]: the first weeks of a plan for a runner whose typical week is under
  // `sessions` x `sessionMin` minutes, or who has no logged run. The floor is 3 sessions of
  // 20-30 min; the run-walk ladder and the injury-return ladder follow.
  restartFloor: {
    sessions: param(
      'restartFloor.sessions',
      3,
      'D',
      'E6',
      [
        'kluitenberg-2015-nlstart2run',
        'buist-2008-graded-training',
        'pollock-1977-frequency-duration-injury',
        'kluitenberg-2016-nlstart2run-training-factors',
        'nhs-2026-couch-to-5k',
        'clark-2026-couch-to-5k-original',
      ],
      {
        unit: 'sessions per week',
        note: 'Default: novice and return programmes start at about three sessions of 20-30 minutes, and every published beginner plan uses three days. The ceiling has trial direction (three days a week had fewer injuries than five in a 1977 trial; three versus two was not significant), so the grade stays D. G-2 governs growth from an established weekly base, so the first week of a start path is exempt from G-2 up to its minutes; every session still obeys G-1.',
      },
    ),
    sessionMin: param(
      'restartFloor.sessionMin',
      20,
      'D',
      'E6',
      ['kluitenberg-2015-nlstart2run', 'buist-2008-graded-training'],
      {
        unit: 'min per session',
        note: 'Default: novice and return programmes start at about three sessions of 20-30 minutes; the low end is the floor, and a typical week under 3 x this length starts a start path.',
      },
    ),
    sessionMaxMin: param(
      'restartFloor.sessionMaxMin',
      30,
      'D',
      'E6',
      [
        'pollock-1977-frequency-duration-injury',
        'frandsen-2025-session-spike',
        'linton-2018-uk-novice-recreational-injury',
      ],
      {
        unit: 'min per session',
        note: 'Default: a returner with a continuous run of 20 minutes or more in the last 30 days restarts at 3 sessions of that run, rounded down to 5 minutes, up to this length. This is the only start rule that moves toward more load; the runner own completed run bounds it, and it needs at least 2 years of running, no soft flag and no recent injury. A 1977 trial found similar injury rates at 15 and 30 minutes three times a week (young men, hard jogging), so the grade stays D.',
      },
    ),
    sessionStepMin: param(
      'restartFloor.sessionStepMin',
      5,
      'D',
      'E6',
      ['frandsen-2025-session-spike'],
      {
        unit: 'min',
        note: 'Default: the longest continuous run is rounded down to a multiple of this before it sets the floor session length.',
      },
    ),
    lookbackDays: param(
      'restartFloor.lookbackDays',
      30,
      'D',
      'E6',
      ['frandsen-2025-session-spike'],
      {
        unit: 'days',
        note: 'Default: the floor follows the longest continuous run within this many days, the window of the session spike guard (G-1). It was 90 days before the second evidence pass.',
      },
    ),
    fallbackLookbackDays: param(
      'restartFloor.fallbackLookbackDays',
      90,
      'D',
      'E6',
      ['frandsen-2025-session-spike', 'coyle-1984-detraining-time-course'],
      {
        unit: 'days',
        note: 'Default: with no run in the 30-day window, G-1 has no reference, so the first week uses the J7 fraction times the longest run of this many days (E6 paths 3 and 4).',
      },
    ),
  },
  // The run-walk ladder for a true novice and for a returner whose longest run is under 20 min
  // [E6]. Each rung is the runs of one week: up to three sessions, each a list of run and walk
  // minutes in order, starting with a run (an odd-length list ends on a run, an even-length one
  // on a walk). A rung with fewer than three sessions repeats them.
  noviceLadder: {
    rungs: param<Rung[]>(
      'noviceLadder.rungs',
      [
        [times(7, [1, 2])],
        [times(6, [1.5, 2])],
        [times(2, [1.5, 1.5, 3, 3])],
        [[3, 1.5, 5, 2.5, 3, 1.5, 5]],
        [[5, 3, 5, 3, 5], [8, 5, 8], [20]],
        [[5, 3, 8, 3, 5], [10, 3, 10], [22]],
        [[25]],
        [[28]],
        [[30]],
      ],
      'D',
      'E6',
      [
        'nhs-2026-couch-to-5k',
        'clark-2026-couch-to-5k-original',
        'galloway-2026-beginner-run-walk',
        'linton-2018-uk-novice-recreational-injury',
      ],
      {
        unit: 'min of running and walking per session',
        note: 'Default: nine rungs, three non-consecutive days a week. The shape adapts the NHS and the original Couch-to-5K plans, with 1 min run and 2 min walk kept at rung 1 (slightly gentler than the NHS week 1) and 22 min at rung 6; 3 x 30 min of continuous running at rung 9. No study compares run-walk starts with continuous starts. Time on feet in a week: about 63, 63, 54, 64.5, 62, 69, 75, 84 and 90 min.',
      },
    ),
    walkFrameMin: param(
      'noviceLadder.walkFrameMin',
      5,
      'D',
      'E6',
      ['nhs-2026-couch-to-5k', 'clark-2026-couch-to-5k-original'],
      {
        unit: 'min',
        note: 'Default: a walk of this length before and after every ladder session, as in the published beginner plans; the walks are not counted in the session or the week.',
      },
    ),
    advanceMinCompletion: param(
      'noviceLadder.advanceMinCompletion',
      0.8,
      'D',
      'E6',
      [
        'relph-2023-couch-to-5k-injury',
        'fokkema-2019-discontinuation-start-to-run',
        'nhs-2026-couch-to-5k',
      ],
      {
        unit: 'fraction of planned minutes',
        note: 'Default: the ladder advances one rung only after a week with at least this share of the planned minutes and no pain; otherwise the rung repeats. It matches the weekly hold threshold of J5.',
      },
    ),
    holdRpe: param(
      'noviceLadder.holdRpe',
      5,
      'D',
      'E6',
      ['kluitenberg-2016-nlstart2run-training-factors'],
      {
        unit: 'RPE 0-10',
        note: 'Default: a mean session RPE at or above this holds the rung when sessions carry ratings. The direction (harder starts, more injuries) is grade C; the 5/10 cut-off is an engine default. Without ratings the ladder advances on completion and pain alone.',
      },
    ),
    bmiHoldWeeks: param(
      'noviceLadder.bmiHoldWeeks',
      3,
      'C',
      'E6',
      [
        'nielsen-2014-first-week-distance-obese',
        'bertelsen-2018-start-to-run-distance-rct',
        'bertelsen-2018-bmi-self-chosen-start',
      ],
      {
        unit: 'weeks',
        note: 'Weeks held at rung 1 for a runner with a BMI above 30 (height and weight in the profile); the ladder advances in the week after. It copies the tested arm of one trial; the intention-to-treat result of that trial was not significant, so confidence is low.',
      },
    ),
    quietWeeksAfter: param(
      'noviceLadder.quietWeeksAfter',
      2,
      'D',
      'E6',
      ['kluitenberg-2016-nlstart2run-training-factors'],
      {
        unit: 'weeks',
        note: 'Default: no quality sessions or strides during the ladder or the injury-return ladder and for this many weeks after either ends. The direction (harder training early, more injuries) is grade C; the length is an engine default.',
      },
    ),
  },
  // The injury-return ladder [G-3]: continuous easy running in levels, for a runner with the
  // recent-injury flag and a typical week under the floor or no runs.
  injuryReturn: {
    levelsMin: param<number[]>(
      'injuryReturn.levelsMin',
      [5, 10, 15, 20, 25, 30],
      'D',
      'g-3',
      [
        'sanford-2024-return-to-running',
        'bjsm-2019-bone-stress-return-to-run',
        'relph-2023-couch-to-5k-injury',
        'vanpoppel-2021-overuse-risk-factors-review',
      ],
      {
        unit: 'min of continuous easy running per run',
        note: 'Default: the levels are clinical conventions, and applying soft-tissue protocols to a generic injury flag is an extrapolation. Each run is the lesser of the level and the hard G-3 limit of 1.10x the longest run (G-1), so progress is slower than the source protocol.',
      },
    ),
    repeatsPerLevel: param(
      'injuryReturn.repeatsPerLevel',
      2,
      'D',
      'g-3',
      ['sanford-2024-return-to-running', 'bjsm-2019-bone-stress-return-to-run'],
      {
        unit: 'runs',
        note: 'Default: each level is run this many times, one week of runs per level, before the next level.',
      },
    ),
    restDaysBetween: param(
      'injuryReturn.restDaysBetween',
      1,
      'D',
      'g-3',
      ['sanford-2024-return-to-running', 'bjsm-2019-bone-stress-return-to-run'],
      {
        unit: 'days',
        note: 'Default: at least this many rest days between two runs of the ladder.',
      },
    ),
    advanceMaxPain: param(
      'injuryReturn.advanceMaxPain',
      0,
      'D',
      'g-3',
      ['sanford-2024-return-to-running'],
      {
        unit: 'pain score 0-10',
        note: 'Default: a level counts as symptom-free when the pain on the activity and on the next check-in is at most this score. Any more pain drops the ladder by one level.',
      },
    ),
  },
  // Engine defaults that the rules leave open. Every one is grade D, with no evidence except where
  // it follows published plans (D7): they size the plan around the rules' limits and are labelled
  // as defaults wherever they are shown.
  macroDesign: {
    buildWeeks: param('macroDesign.buildWeeks', 6, 'D', 'design-macro', [], {
      unit: 'weeks',
      note: 'Default: the build phase lasts up to this many weeks; base takes the remainder (E2).',
    }),
    startFloorWeekMin: param(
      'macroDesign.startFloorWeekMin',
      60,
      'D',
      'E6',
      ['nhs-2026-couch-to-5k', 'clark-2026-couch-to-5k-original'],
      {
        unit: 'min per week',
        note: 'Default: weekly running time to start from when no recent running exists and no start path applies (a progression hold or a tightened profile): about rung 1 of the ladder, 3 sessions of 20 min. It was 90 min (3 x 30) before the second evidence pass.',
      },
    ),
    startRecentWeeks: param('macroDesign.startRecentWeeks', 2, 'D', 'E6', [], {
      unit: 'weeks',
      note: 'Default: a step up held for this many complete weeks sets the start level above the four-week median; one big week alone does not.',
    }),
    longRunShareOfWeek: param(
      'macroDesign.longRunShareOfWeek',
      0.35,
      'D',
      'design-macro',
      [
        'runningmagazine-2023-daniels-long-run-limit',
        'higdon-2024-intermediate-5k',
        'knechtle-2023-nurmi-training-by-distance',
      ],
      {
        note: 'Default: the long run is about this share of the weekly running time. It sits within coach practice (Daniels 30% of weekly distance, Higdon intermediate 5K 35-47%; an easy long run is a larger share of time than of distance). It is a coaching convention, not an injury limit; G-1 is the single-session guard.',
      },
    ),
    longRunShareOfWeekUltra: param(
      'macroDesign.longRunShareOfWeekUltra',
      0.45,
      'D',
      'design-macro',
      ['outside-2023-strava-western-states', 'outside-2023-strava-utmb'],
      {
        note: 'Default: for ultras the long run is about this share of the weekly running time (H2 still caps it). The Western States peak week put about 40% of weekly distance in the long run (inferred from two medians); the time share is higher than the distance share because long runs are slower.',
      },
    ),
    longRunTierWeeklyMin: param<[number, number]>(
      'macroDesign.longRunTierWeeklyMin',
      [180, 360],
      'D',
      'D7',
      [],
      {
        unit: 'min per week',
        note: 'Default: the 5K and 10K long-run tier is the first below 180 min, the second from 180 to 360 min and the third above 360 min of the completed typical week (never the planned week). The boundaries keep run days times the cap at or above the week at every tier top.',
      },
    ),
    peakLongRunKmMax: param(
      'macroDesign.peakLongRunKmMax',
      16,
      'D',
      'D7',
      ['johnson-2018-long-runs-5k-10k', 'higdon-2024-advanced-10k'],
      {
        unit: 'km',
        note: 'Default: the long run of a 5K or 10K goal never exceeds this distance (10 miles, the longest long run of the cited plans for both distances), so a fast runner is capped below the minutes of the tier. A coaching convention, not an injury limit.',
      },
    ),
    trainingPaceFactor: param('macroDesign.trainingPaceFactor', 1.15, 'D', 'design-macro', [], {
      note: 'Default: average training pace is this multiple of the goal pace when no recent pace exists.',
    }),
    defaultEasyPaceSecPerKm: param(
      'macroDesign.defaultEasyPaceSecPerKm',
      360,
      'D',
      'design-macro',
      [],
      {
        unit: 'sec/km',
        note: 'Default: easy pace used to turn minutes into distance when neither history nor goal gives one.',
      },
    ),
    postRaceReducedFraction: param('macroDesign.postRaceReducedFraction', 0.5, 'D', 'H12', [], {
      note: 'Default: the single return step after a race of 5K to a half marathon is this fraction of the pre-taper reference week; no source covers recovery after races shorter than a marathon.',
    }),
    postRaceMarathonFractions: param<number[]>(
      'macroDesign.postRaceMarathonFractions',
      [0.5, 0.75],
      'D',
      'H12',
      [
        'bernat-adell-2021-marathon-biomarkers',
        'petersen-2007-marathon-muscle-mechanics',
        'takayama-2017-marathon-one-week',
      ],
      {
        note: 'Default: the 7-day return steps after a marathon or a 50K class race are these fractions of the pre-taper reference week; LDH normalises about day 8 and CRP is still raised then, and the fractions themselves are a convention.',
      },
    ),
    postRaceLongFractions: param<number[]>(
      'macroDesign.postRaceLongFractions',
      [0.25, 0.5, 0.75],
      'D',
      'H12',
      [
        'skurka-2017-roche-100-recovery',
        'cts-2025-koop-ultra-recovery',
        'irunfar-2016-powell-post-100-return',
        'millet-2011-ultramarathon-neuromuscular',
      ],
      {
        note: 'Default: the 7-day return steps after a race of 100K or longer are these fractions of the pre-taper reference week; coach plans stage the return over about four weeks and no study sets the fractions.',
      },
    ),
    polarizedZ2Share: param('macroDesign.polarizedZ2Share', 5, 'D', 'design-macro', [], {
      unit: '% of running time',
      note: 'Default: Z2 share of the optional polarized specific phase for 5-10K (E4).',
    }),
    gainShareBase: param('macroDesign.gainShareBase', 0.3, 'D', 'design-macro', [], {
      note: 'Default: share of the race gain per km practised in the base phase (H4).',
    }),
    gainShareBuild: param('macroDesign.gainShareBuild', 0.6, 'D', 'design-macro', [], {
      note: 'Default: share of the race gain per km practised in the build phase (H4).',
    }),
    gainShareSpecific: param('macroDesign.gainShareSpecific', 1, 'D', 'design-macro', [], {
      note: 'Default: in the specific phase the weekly gain works toward the full race gain per km (H4).',
    }),
    keepOwnerEditsDays: param('macroDesign.keepOwnerEditsDays', 14, 'D', 'design-macro', [], {
      unit: 'days',
      note: 'Default: a re-plan keeps the sessions the owner moved, swapped or skipped, and the trims of the next quality session, for this many days from today, and plans the rest of those weeks around them.',
    }),
  },
  peakWeeklyMin: {
    '5k': param('peakWeeklyMin.5k', 180, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: peak weekly running time for a 5K goal; never above what the ramp allows.',
    }),
    '10k': param('peakWeeklyMin.10k', 210, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: peak weekly running time for a 10K goal; never above what the ramp allows.',
    }),
    half: param('peakWeeklyMin.half', 270, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: peak weekly running time for a half-marathon; the D3 floor can raise it for a time goal.',
    }),
    marathon: param('peakWeeklyMin.marathon', 330, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: peak weekly running time for a marathon; the D3 floor can raise it for a time goal.',
    }),
    ultra50: param('peakWeeklyMin.ultra50', 390, 'D', 'D4', ULTRA_WEEKLY_PEAK, {
      unit: 'min per week',
      note: 'Default: peak weekly running time for a 50K ultra; never above what the ramp allows. The D4 feasibility label also grows the week to it at the weekly ramp (label only). Weekly volume and frequency, not the longest run, are what ultra studies associate with outcomes; no study sets this number.',
    }),
    ultra100k: param('peakWeeklyMin.ultra100k', 480, 'D', 'D4', ULTRA_WEEKLY_PEAK, {
      unit: 'min per week',
      note: 'Default: peak weekly running time for 100K; never above what the ramp allows. The D4 feasibility label also grows the week to it at the weekly ramp (label only). Weekly volume and frequency, not the longest run, are what ultra studies associate with outcomes; no study sets this number.',
    }),
    ultra100mi: param('peakWeeklyMin.ultra100mi', 600, 'D', 'D4', ULTRA_WEEKLY_PEAK, {
      unit: 'min per week',
      note: 'Default: peak weekly running time for 100 miles; never above what the ramp allows. The D4 feasibility label also grows the week to it at the weekly ramp (label only). Weekly volume and frequency, not the longest run, are what ultra studies associate with outcomes; no study sets this number.',
    }),
    beyond: param('peakWeeklyMin.beyond', 660, 'D', 'D4', ULTRA_WEEKLY_PEAK, {
      unit: 'min per week',
      note: 'Default: peak weekly running time for goals beyond 100 miles; never above what the ramp allows. The D4 feasibility label also grows the week to it at the weekly ramp (label only). Weekly volume and frequency, not the longest run, are what ultra studies associate with outcomes; no study sets this number.',
    }),
  },
  peakLongRunMin: {
    '5k': param<[number, number, number]>(
      'peakLongRunMin.5k',
      [60, 75, 90],
      'D',
      'D7',
      SHORT_RACE_LONG_RUN,
      {
        unit: 'min by tier',
        note: 'Default: peak long-run duration for a 5K goal by volume tier (typical week under 180, 180-360, over 360 min; macroDesign.longRunTierWeeklyMin), also capped at macroDesign.peakLongRunKmMax. The caps follow coaching conventions and published plans; they are not injury limits, and G-1 is the single-session guard.',
      },
    ),
    '10k': param<[number, number, number]>(
      'peakLongRunMin.10k',
      [75, 90, 100],
      'D',
      'D7',
      SHORT_RACE_LONG_RUN,
      {
        unit: 'min by tier',
        note: 'Default: peak long-run duration for a 10K goal by volume tier (typical week under 180, 180-360, over 360 min; macroDesign.longRunTierWeeklyMin), also capped at macroDesign.peakLongRunKmMax. The caps follow coaching conventions and published plans; they are not injury limits, and G-1 is the single-session guard.',
      },
    ),
    half: param('peakLongRunMin.half', 105, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration for a half-marathon; the D3 long-run floor can raise it.',
    }),
    marathon: param('peakLongRunMin.marathon', 180, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration for a marathon; the D3 long-run floor can raise it.',
    }),
    ultra50: param('peakLongRunMin.ultra50', 240, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration for a 50K ultra, capped by H2. With the default weekly ceiling the long-run share (175 min) binds first; no study sets this number.',
    }),
    ultra100k: param('peakLongRunMin.ultra100k', 300, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration for 100K, capped by H2. With the default weekly ceiling the long-run share (216 min) binds first; no study sets this number.',
    }),
    ultra100mi: param(
      'peakLongRunMin.ultra100mi',
      360,
      'D',
      'design-macro',
      ['outside-2015-orton-koop-100-miles'],
      {
        unit: 'min',
        note: "Default: peak long-run duration for 100 miles, capped by H2. It equals the 6 h cap and the low end of one coach's 6-7 h final long run; the default plan reaches about 270 min, and only high-volume runners approach 360.",
      },
    ),
    beyond: param(
      'peakLongRunMin.beyond',
      360,
      'D',
      'design-macro',
      ['daniel-2024-217km-sleep-training'],
      {
        unit: 'min',
        note: 'Default: peak long-run duration beyond 100 miles, capped by H2. One questionnaire study (daniel-2024-217km-sleep-training) reports training frequency beyond 100 miles; no study there tests long-run size, so no study sets this number.',
      },
    ),
  },
  // Session structure defaults (sessions.ts) where the rules give a method but not a size.
  sessionDesign: {
    warmupMin: param('sessionDesign.warmupMin', 10, 'D', 'design-sessions', [], {
      unit: 'min',
      note: 'Default: easy warm-up before quality work.',
    }),
    cooldownMin: param('sessionDesign.cooldownMin', 10, 'D', 'design-sessions', [], {
      unit: 'min',
      note: 'Default: easy cool-down after quality work.',
    }),
    stridesWorkSec: param('sessionDesign.stridesWorkSec', 20, 'D', 'design-sessions', [], {
      unit: 'sec',
      note: 'Default: length of one stride.',
    }),
    stridesRecoverSec: param('sessionDesign.stridesRecoverSec', 60, 'D', 'design-sessions', [], {
      unit: 'sec',
      note: 'Default: easy walk or jog between strides.',
    }),
    thresholdRecoverMin: param('sessionDesign.thresholdRecoverMin', 3, 'D', 'design-sessions', [], {
      unit: 'min',
      note: 'Default: easy recovery between cruise-interval bouts.',
    }),
    intervalSpeedAboveCs: param(
      'sessionDesign.intervalSpeedAboveCs',
      0.05,
      'D',
      'design-sessions',
      [],
      {
        note: 'Default: interval speed is this fraction above critical speed.',
      },
    ),
    intervalRepSec: param('sessionDesign.intervalRepSec', 240, 'D', 'design-sessions', [], {
      unit: 'sec',
      note: 'Default: intended interval length before the D-prime budget of C6 limits it.',
    }),
    intervalDefaultDPrimeM: param(
      'sessionDesign.intervalDefaultDPrimeM',
      200,
      'D',
      'design-sessions',
      [],
      {
        unit: 'm',
        note: 'Default: D-prime used for the rep budget when the athlete has no estimate.',
      },
    ),
    intervalRecoverFraction: param(
      'sessionDesign.intervalRecoverFraction',
      1,
      'D',
      'design-sessions',
      [],
      {
        note: 'Default: easy recovery between interval reps lasts this multiple of the rep.',
      },
    ),
    hillsRepSec: param('sessionDesign.hillsRepSec', 60, 'D', 'design-sessions', [], {
      unit: 'sec',
      note: 'Default: length of one hill repeat.',
    }),
    hillsRecoverSec: param('sessionDesign.hillsRecoverSec', 120, 'D', 'design-sessions', [], {
      unit: 'sec',
      note: 'Default: easy jog or walk down between hill repeats.',
    }),
    racePaceBoutMin: param('sessionDesign.racePaceBoutMin', 20, 'D', 'design-sessions', [], {
      unit: 'min',
      note: 'Default: longest single bout at race pace.',
    }),
    racePaceRecoverMin: param('sessionDesign.racePaceRecoverMin', 3, 'D', 'design-sessions', [], {
      unit: 'min',
      note: 'Default: easy recovery between race-pace bouts.',
    }),
  },
} satisfies ParamGroups

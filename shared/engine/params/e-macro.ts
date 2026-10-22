// Section (e) Macrocycle. Source: research/engine-rules.md. Task E5 may add here.
// The gut training block (E5) lives in h7 and the heat acclimation block (E5) in i8, where the
// rules give their detail.
import { param, type ParamGroups } from './define.ts'

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
        note: 'Default: the 8-week figure comes from a 5-10 km RCT design; the rule does not grade it, so it is treated as a default.',
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
      note: 'Base phase for 5-10 km and half/marathon: Z1 at least 80, Z2 at most 12, Z3 about 5.',
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
        note: 'A polarized block is offered for competitive 5-10 km athletes and lasts under this many weeks, with load held constant.',
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
  // The restart floor: the first week of a plan for a runner whose recent weeks are below it.
  restartFloor: {
    sessions: param(
      'restartFloor.sessions',
      3,
      'D',
      'design-macro',
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
        note: 'Default: novice and return programmes start at about three sessions of 20-30 minutes, and every published beginner plan uses three days. The ceiling has trial direction (three days a week had fewer injuries than five in a 1977 trial; three versus two was not significant), so the grade stays D. G-2 governs growth from an established weekly base, so the floor week itself is exempt from G-2; every session still obeys G-1.',
      },
    ),
    sessionMin: param(
      'restartFloor.sessionMin',
      20,
      'D',
      'design-macro',
      ['kluitenberg-2015-nlstart2run', 'buist-2008-graded-training'],
      {
        unit: 'min per session',
        note: 'Default: novice and return programmes start at about three sessions of 20-30 minutes; the low end is the floor.',
      },
    ),
    lookbackDays: param('restartFloor.lookbackDays', 90, 'D', 'design-macro', [], {
      unit: 'days',
      note: 'Default: the floor sessions are plain runs when the runner completed a run of at least the floor session length within this many days, and run-walk otherwise.',
    }),
  },
  // Engine defaults that the rules leave open. Every one is grade D, with no evidence except where
  // it follows published plans (D7): they size the plan around the rules' limits and are labelled
  // as defaults wherever they are shown.
  macroDesign: {
    buildWeeks: param('macroDesign.buildWeeks', 6, 'D', 'design-macro', [], {
      unit: 'weeks',
      note: 'Default: the build phase lasts up to this many weeks; base takes the remainder (E2).',
    }),
    startFloorWeekMin: param('macroDesign.startFloorWeekMin', 90, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: weekly running time to start from when no recent running exists (3 runs of 30 min).',
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
        note: 'Default: the 5 km and 10 km long-run tier is the first below 180 min, the second from 180 to 360 min and the third above 360 min of the completed typical week (never the planned week). The boundaries keep run days times the cap at or above the week at every tier top.',
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
        note: 'Default: the long run of a 5 km or 10 km goal never exceeds this distance (10 miles, the longest long run of the cited plans for both distances), so a fast runner is capped below the minutes of the tier. A coaching convention, not an injury limit.',
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
      note: 'Default: the single return step after a race of 5 km to a half marathon is this fraction of the pre-taper reference week; no source covers recovery after races shorter than a marathon.',
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
        note: 'Default: the 7-day return steps after a marathon or a 50 km class race are these fractions of the pre-taper reference week; LDH normalises about day 8 and CRP is still raised then, and the fractions themselves are a convention.',
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
        note: 'Default: the 7-day return steps after a race of 100 km or longer are these fractions of the pre-taper reference week; coach plans stage the return over about four weeks and no study sets the fractions.',
      },
    ),
    polarizedZ2Share: param('macroDesign.polarizedZ2Share', 5, 'D', 'design-macro', [], {
      unit: '% of running time',
      note: 'Default: Z2 share of the optional polarized specific phase for 5-10 km (E4).',
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
      note: 'Default: peak weekly running time for a 5 km goal; never above what the ramp allows.',
    }),
    '10k': param('peakWeeklyMin.10k', 210, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: peak weekly running time for a 10 km goal; never above what the ramp allows.',
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
      note: 'Default: peak weekly running time for a 50 km ultra; never above what the ramp allows. The D4 feasibility label also grows the week to it at the weekly ramp (label only). Weekly volume and frequency, not the longest run, are what ultra studies associate with outcomes; no study sets this number.',
    }),
    ultra100k: param('peakWeeklyMin.ultra100k', 480, 'D', 'D4', ULTRA_WEEKLY_PEAK, {
      unit: 'min per week',
      note: 'Default: peak weekly running time for 100 km; never above what the ramp allows. The D4 feasibility label also grows the week to it at the weekly ramp (label only). Weekly volume and frequency, not the longest run, are what ultra studies associate with outcomes; no study sets this number.',
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
        note: 'Default: peak long-run duration for a 5 km goal by volume tier (typical week under 180, 180-360, over 360 min; macroDesign.longRunTierWeeklyMin), also capped at macroDesign.peakLongRunKmMax. The caps follow coaching conventions and published plans; they are not injury limits, and G-1 is the single-session guard.',
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
        note: 'Default: peak long-run duration for a 10 km goal by volume tier (typical week under 180, 180-360, over 360 min; macroDesign.longRunTierWeeklyMin), also capped at macroDesign.peakLongRunKmMax. The caps follow coaching conventions and published plans; they are not injury limits, and G-1 is the single-session guard.',
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
      note: 'Default: peak long-run duration for a 50 km ultra, capped by H2. With the default weekly ceiling the long-run share (175 min) binds first; no study sets this number.',
    }),
    ultra100k: param('peakLongRunMin.ultra100k', 300, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration for 100 km, capped by H2. With the default weekly ceiling the long-run share (216 min) binds first; no study sets this number.',
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
    beyond: param('peakLongRunMin.beyond', 360, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration beyond 100 miles, capped by H2. No training data exist beyond 100 miles.',
    }),
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

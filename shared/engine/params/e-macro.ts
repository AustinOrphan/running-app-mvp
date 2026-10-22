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
  // Engine defaults that the rules leave open. Every one is grade D with no evidence: they size
  // the plan around the rules' limits and are labelled as defaults wherever they are shown.
  macroDesign: {
    buildWeeks: param('macroDesign.buildWeeks', 6, 'D', 'design-macro', [], {
      unit: 'weeks',
      note: 'Default: the build phase lasts up to this many weeks; base takes the remainder (E2).',
    }),
    startFloorWeekMin: param('macroDesign.startFloorWeekMin', 90, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: weekly running time to start from when no recent running exists (3 runs of 30 min).',
    }),
    longRunShareOfWeek: param('macroDesign.longRunShareOfWeek', 0.35, 'D', 'design-macro', [], {
      note: 'Default: the long run is about this share of the weekly running time.',
    }),
    longRunShareOfWeekUltra: param(
      'macroDesign.longRunShareOfWeekUltra',
      0.45,
      'D',
      'design-macro',
      [],
      {
        note: 'Default: for ultras the long run is about this share of the weekly running time (H2 still caps it).',
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
    postRaceReducedFraction: param(
      'macroDesign.postRaceReducedFraction',
      0.5,
      'D',
      'design-macro',
      [],
      {
        note: 'Default: reduced running after a race is this fraction of the pre-taper reference week (H12).',
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
    ultra50: param('peakWeeklyMin.ultra50', 390, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: peak weekly running time for a 50 km ultra; never above what the ramp allows.',
    }),
    ultra100k: param('peakWeeklyMin.ultra100k', 480, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: peak weekly running time for 100 km; never above what the ramp allows.',
    }),
    ultra100mi: param('peakWeeklyMin.ultra100mi', 600, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: peak weekly running time for 100 miles; never above what the ramp allows.',
    }),
    beyond: param('peakWeeklyMin.beyond', 660, 'D', 'design-macro', [], {
      unit: 'min per week',
      note: 'Default: peak weekly running time beyond 100 miles; never above what the ramp allows.',
    }),
  },
  peakLongRunMin: {
    '5k': param('peakLongRunMin.5k', 60, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration for a 5 km goal.',
    }),
    '10k': param('peakLongRunMin.10k', 75, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration for a 10 km goal.',
    }),
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
      note: 'Default: peak long-run duration for a 50 km ultra, capped by H2.',
    }),
    ultra100k: param('peakLongRunMin.ultra100k', 300, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration for 100 km, capped by H2.',
    }),
    ultra100mi: param('peakLongRunMin.ultra100mi', 360, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration for 100 miles, capped by H2.',
    }),
    beyond: param('peakLongRunMin.beyond', 360, 'D', 'design-macro', [], {
      unit: 'min',
      note: 'Default: peak long-run duration beyond 100 miles, capped by H2.',
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

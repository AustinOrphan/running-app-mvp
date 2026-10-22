// Section (h) Ultra-specific rules, including the terrain additions H4 and H5. Source:
// research/engine-rules.md. Almost nothing here has trial evidence; unless a rule cites evidence
// it is a labelled engine default. Task E5 may add here.
import { param, type ParamGroups } from './define.ts'

const TILLER = ['tiller-2019-issn-ultra-nutrition']
const HIKE = [
  'finiel-2026-uphill-walk-run',
  'giovanelli-2016-vk-energetics',
  'ortiz-2017-30deg-walk-run',
]
const RBE = [
  'khassetarash-2023-rbe-downhill',
  'mchugh-2003-repeated-bout',
  'bontemps-2020-downhill-review',
]
const GUT = ['costa-2017-gut-training', 'miall-2018-gut-challenge', 'martinez-2023-gut-training-sr']

export const hUltra = {
  h1: {
    volumeFirstFromM: param(
      'h1.volumeFirstFromM',
      100000,
      'C',
      'H1',
      ['tanda-2015-training-anthropometry-100km', 'coates-2021-physio-determinants-ultra'],
      {
        unit: 'm',
        note: 'For goals of 100 km or more, grow weekly volume before adding pace work.',
      },
    ),
    keepSpeedWorkAtM: param(
      'h1.keepSpeedWorkAtM',
      50000,
      'C',
      'H1',
      ['tanda-2015-training-anthropometry-100km', 'coates-2021-physio-determinants-ultra'],
      { unit: 'm', note: 'For 50 km, keep speed work.' },
    ),
    experiencedMedianWeeklyKm: param(
      'h1.experiencedMedianWeeklyKm',
      64,
      'C',
      'H1',
      ['hoffman-2013-ultra-exercise-behavior'],
      {
        unit: 'km/week',
        note: 'Experienced-ultrarunner median: a descriptive check only, never a target.',
      },
    ),
  },
  h2: {
    longestRunCapHours: param('h2.longestRunCapHours', 6, 'D', 'H2', [], {
      unit: 'h',
      note: 'Default: longest single training run is capped at the lesser of this and 60% of expected race duration. No study sets this number; it limits exposure without evidence of benefit.',
    }),
    longestRunCapRaceFraction: param('h2.longestRunCapRaceFraction', 0.6, 'D', 'H2', [], {
      unit: 'fraction of expected race duration',
      note: 'Default: no study sets this number.',
    }),
    raceSimulationMaxHours: param('h2.raceSimulationMaxHours', 8, 'D', 'H2', [], {
      unit: 'h',
      note: 'Default: one opt-in race simulation of up to this length is allowed, and only within G-1.',
    }),
  },
  h3: {
    b2bMinGapWeeks: param('h3.b2bMinGapWeeks', 2, 'D', 'H3', ['frandsen-2025-session-spike'], {
      unit: 'weeks',
      note: 'Default: at most one back-to-back pair every 2 weeks, in build or specific phases only, never in the taper.',
    }),
    b2bDay2MaxRatioOfDay1: param(
      'h3.b2bDay2MaxRatioOfDay1',
      1.0,
      'D',
      'H3',
      ['frandsen-2025-session-spike'],
      {
        unit: 'ratio',
        note: 'Default: day 2 is no longer than day 1.',
      },
    ),
    b2bTwoDayRatio: param('h3.b2bTwoDayRatio', 1.1, 'D', 'H3', ['frandsen-2025-session-spike'], {
      unit: 'ratio to the largest 2-day total in the last 30 days',
      note: 'Default: the pair is no more than 1.10x the largest 2-day total in the last 30 days; extends G-1 by analogy.',
    }),
  },
  h4: {
    minStepGainM: param('h4.minStepGainM', 100, 'D', 'H4', ['frandsen-2025-session-spike'], {
      unit: 'm',
      note: 'Default: per-session gain and descent follow G-1 against their own 30-day maxima with a minimum step of 100 m.',
    }),
    weeklyGainRamp: param('h4.weeklyGainRamp', 0.1, 'D', 'H4', [], {
      unit: 'fraction per week',
      note: 'Default: weekly gain follows the 10% soft ramp.',
    }),
    ascentSpeedGainPct: param(
      'h4.ascentSpeedGainPct',
      32,
      'C',
      'H4',
      ['hingrand-2023-power-vs-ascent-speed'],
      {
        unit: '%',
        note: 'Maximal ascent speed was about 32% higher at 25% slope than at 10% at similar VO2max, so climbing is prescribed by RPE, HR or grade-adjusted effort, never by vertical speed.',
      },
    ),
    hikeGradePct: param('h4.hikeGradePct', 28, 'C', 'H4', HIKE, {
      unit: '% grade',
      note: 'Power-hike on grades of about 28% and steeper.',
    }),
    walkCheaperGradePct: param('h4.walkCheaperGradePct', 12.6, 'C', 'H4', HIKE, {
      unit: '% grade',
      note: 'Between about 12.6% and 28% the faster gait depends on climbing rate; walking was cheaper above 12.6% at 800 m/h.',
    }),
    walkReferenceClimbRateMh: param('h4.walkReferenceClimbRateMh', 800, 'C', 'H4', HIKE, {
      unit: 'm/h',
    }),
    ultraClimbReferenceMh: param(
      'h4.ultraClimbReferenceMh',
      550,
      'C',
      'H4',
      ['jeker-2020-vertical-speed-ultra'],
      {
        unit: 'm/h',
        note: 'Reference for sustained ultra climbing only, not a target or a race-average figure.',
      },
    ),
  },
  h5: {
    downhillStartWeeksBeforeRace: param('h5.downhillStartWeeksBeforeRace', 8, 'D', 'H5', [], {
      unit: 'weeks',
      note: 'Default: start graded downhill running at least this many weeks before a hilly race, within the H4 descent limits.',
    }),
    repeatedBoutLeadWeeks: param('h5.repeatedBoutLeadWeeks', 3, 'C', 'H5', RBE, {
      unit: 'weeks',
      note: 'The first moderate downhill exposure comes at least this long before any heavy downhill session; protection beyond 3 weeks is untested.',
    }),
    damageProtocolSlopePct: param(
      'h5.damageProtocolSlopePct',
      -12,
      'D',
      'H5',
      ['bontemps-2020-downhill-review'],
      {
        unit: '% grade',
        note: 'Default: an unaccustomed session near the research damaging protocol (about -12% slope for 40 min) is a high-damage load; introduce descents progressively.',
      },
    ),
    damageProtocolMin: param(
      'h5.damageProtocolMin',
      40,
      'D',
      'H5',
      ['bontemps-2020-downhill-review'],
      {
        unit: 'min',
        note: 'Default: duration of the research damaging protocol.',
      },
    ),
    kneeExtensorStrengthGainPct: param<[number, number]>(
      'h5.kneeExtensorStrengthGainPct',
      [9, 24],
      'C',
      'H5',
      ['toyomura-2018-downhill-training'],
      {
        unit: '%',
        note: 'Downhill running builds knee-extensor strength but not aerobic capacity; keep aerobic work on level or uphill terrain.',
      },
    ),
    kneeExtensorForceLossPct: param<[number, number]>(
      'h5.kneeExtensorForceLossPct',
      [29, 38],
      'D',
      'H5',
      ['temesi-2015-female-neuromuscular-fatigue'],
      {
        unit: '%',
        note: 'Default rationale for eccentric-biased strength: knee-extensor force fell by this much after 110 km. There is no dose evidence for the block itself.',
      },
    ),
    kneeExtensorForceLossRaceKm: param(
      'h5.kneeExtensorForceLossRaceKm',
      110,
      'D',
      'H5',
      ['temesi-2015-female-neuromuscular-fatigue'],
      {
        unit: 'km',
        note: 'Default rationale: race distance after which the force loss was measured.',
      },
    ),
  },
  h6: {
    headlampRehearsalRuns: param<[number, number]>(
      'h6.headlampRehearsalRuns',
      [1, 2],
      'D',
      'H6',
      [],
      {
        unit: 'runs',
        note: 'Default: for races expected to cross darkness, 1-2 headlamp rehearsal runs in the specific phase. No sleep-deprivation training.',
      },
    ),
  },
  h7: {
    carbFloorGPerH: param<[number, number]>('h7.carbFloorGPerH', [30, 50], 'A', 'H7', TILLER, {
      unit: 'g/h',
      note: 'The tested floor is the default; ISSN range. Higher rates are gated by tolerance.',
    }),
    energyFloorKcalPerH: param<[number, number]>(
      'h7.energyFloorKcalPerH',
      [150, 400],
      'A',
      'H7',
      TILLER,
      {
        unit: 'kcal/h',
      },
    ),
    proteinGPerH: param<[number, number]>('h7.proteinGPerH', [5, 10], 'A', 'H7', TILLER, {
      unit: 'g/h',
      note: 'From varied foods.',
    }),
    carbTier1GPerH: param(
      'h7.carbTier1GPerH',
      60,
      'C',
      'H7',
      ['jeukendrup-2014-cho-intake', 'king-2022-high-cho-gut-training'],
      {
        unit: 'g/h',
        note: 'First higher tier, unlocked only after the previous tier was tolerated in training.',
      },
    ),
    carbTier2GPerH: param(
      'h7.carbTier2GPerH',
      90,
      'C',
      'H7',
      ['jeukendrup-2014-cho-intake', 'king-2022-high-cho-gut-training'],
      {
        unit: 'g/h',
        note: 'Second higher tier (multiple transportable carbohydrates), unlocked after tier 1 was tolerated.',
      },
    ),
    carbAdvancedGPerH: param<[number, number]>(
      'h7.carbAdvancedGPerH',
      [90, 120],
      'C',
      'H7',
      ['urdampilleta-2020-cho-120', 'norte-2026-graded-cho-cp'],
      {
        unit: 'g/h',
        note: 'Advanced opt-in, labelled low certainty.',
      },
    ),
    gutTrainingWeeks: param<number>('h7.gutTrainingWeeks', 3, 'B', 'H7', GUT, {
      unit: 'weeks',
      range: [2, 4],
      note: '2-4 weeks inside the specific phase, ending before the race; 3 is the midpoint.',
    }),
    gutTrainingSessionMinMin: param('h7.gutTrainingSessionMinMin', 60, 'B', 'H7', GUT, {
      unit: 'min',
      note: 'Sessions of at least 1 h at the target rate.',
    }),
    gutSymptomScaleMax: param('h7.gutSymptomScaleMax', 4, 'D', 'H7', GUT, {
      unit: 'score',
      note: 'Default: symptoms are logged on a 0-4 scale.',
    }),
    gutStopScore: param('h7.gutStopScore', 2, 'D', 'H7', GUT, {
      unit: 'score',
      note: 'Default: stop progressing when any symptom scores 2 or more...',
    }),
    gutStopConsecutiveSessions: param('h7.gutStopConsecutiveSessions', 2, 'D', 'H7', GUT, {
      unit: 'sessions in a row',
      note: 'Default: ...on two sessions in a row.',
    }),
    gutStepGPerH: param('h7.gutStepGPerH', 10, 'D', 'H7', ['costa-2017-gut-training'], {
      unit: 'g/h',
      note: 'Default: progression step during gut training (numeric parameter table, grade B/D).',
    }),
    giDnfSharePct: param('h7.giDnfSharePct', 35.6, 'C', 'H7', ['stuempfle-2015-gi-distress-wser'], {
      unit: '% of non-finishers',
      note: 'GI distress was the leading DNF cause among 161 km non-finishers (descriptive; the reason higher rates are tolerance-gated).',
    }),
  },
  h8: {
    fluidReferenceMlPerH: param<[number, number]>(
      'h8.fluidReferenceMlPerH',
      [450, 750],
      'B',
      'H8',
      ['hewbutler-2015-eah-consensus', 'hoffman-2015-sodium-supplementation-eah'],
      {
        unit: 'mL/h',
        note: 'Reference range only; drink to thirst and never produce fixed volumes beyond thirst.',
      },
    ),
    acsmLimitNotApplied: param(
      'h8.acsmLimitNotApplied',
      2,
      'B',
      'H8',
      ['hewbutler-2015-eah-consensus'],
      {
        unit: '% body mass',
        note: 'The ACSM 2% limit does not apply. Listed so it is not reintroduced; not an engine limit.',
      },
    ),
    sodiumComfortMgPerL: param('h8.sodiumComfortMgPerL', 575, 'C', 'H8', TILLER, {
      unit: 'mg/L',
      note: 'Sodium above this concentration is for comfort only, never framed as EAH prevention.',
    }),
    weightLossToleranceMaxPct: param(
      'h8.weightLossToleranceMaxPct',
      3,
      'B',
      'H8',
      ['hoffman-2013-eah-hydration-161km'],
      {
        unit: '% body mass',
        note: 'Weight loss up to 3% is fine; weight gain is a red flag.',
      },
    ),
  },
  h9: {
    carbGPerKgDay: param<[number, number]>(
      'h9.carbGPerKgDay',
      [5, 8],
      'A',
      'H9',
      [...TILLER, 'podlogar-2022-cho-new-horizons'],
      {
        unit: 'g/kg/day',
        note: 'Periodised.',
      },
    ),
    proteinGPerKgDay: param(
      'h9.proteinGPerKgDay',
      1.6,
      'A',
      'H9',
      [...TILLER, 'podlogar-2022-cho-new-horizons'],
      {
        unit: 'g/kg/day',
        range: [1.6, 2.5],
      },
    ),
  },
  h10: {
    strengthBlockWeeks: param(
      'h10.strengthBlockWeeks',
      12,
      'C',
      'H10',
      ['giovanelli-2017-ultra-sep', 'pastor-2022-trail-determinants-distances'],
      {
        unit: 'weeks',
        note: 'Ultra strength block: slow-speed plyometric emphasis plus knee-extensor and plantar-flexor work.',
      },
    ),
    strengthSessionsPerWeek: param(
      'h10.strengthSessionsPerWeek',
      2,
      'C',
      'H10',
      ['giovanelli-2017-ultra-sep', 'pastor-2022-trail-determinants-distances'],
      {
        unit: 'sessions per week',
      },
    ),
  },
  h11: {
    belowVt1Share: param('h11.belowVt1Share', 85, 'C', 'H11', ['fornasiero-2018-ultra-intensity'], {
      unit: '% of race time',
      note: 'Keep HR at or below VT1 for about this share of race time and flag any planned effort above VT2.',
    }),
  },
  h12: {
    thresholdKm: param('h12.thresholdKm', 100, 'D', 'H12', ['byrne-2024-elite-24h-training'], {
      unit: 'km',
      note: 'Default: the post-race recovery rule applies after a race of this distance or more.',
    }),
    restDays: param('h12.restDays', 7, 'D', 'H12', ['byrne-2024-elite-24h-training'], {
      unit: 'days',
      note: 'Default: days without running after the race.',
    }),
    reducedDays: param('h12.reducedDays', 7, 'D', 'H12', ['byrne-2024-elite-24h-training'], {
      unit: 'days',
      note: 'Default: at least this many days of reduced running afterwards, scaled up by race load.',
    }),
  },
} satisfies ParamGroups

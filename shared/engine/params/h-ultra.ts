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
        note: 'For goals of 100K or more, grow weekly volume before adding pace work.',
      },
    ),
    keepSpeedWorkAtM: param(
      'h1.keepSpeedWorkAtM',
      50000,
      'C',
      'H1',
      ['tanda-2015-training-anthropometry-100km', 'coates-2021-physio-determinants-ultra'],
      { unit: 'm', note: 'For 50K, keep speed work.' },
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
    longestRunCapHours: param(
      'h2.longestRunCapHours',
      6,
      'D',
      'H2',
      [
        'outside-2023-strava-utmb',
        'outside-2023-strava-western-states',
        'outside-2015-orton-koop-100-miles',
        'viljoen-2022-trail-risk-factors',
      ],
      {
        unit: 'h',
        note: "Default: longest single training run is capped at the lesser of this and 60% of expected race duration. No study sets this number and no study links any long-run length to injury; the cap lies inside the 3-5 h to 6-7 h range of named-coach conventions and below finishers' race-inclusive longest runs.",
      },
    ),
    longestRunCapRaceFraction: param(
      'h2.longestRunCapRaceFraction',
      0.6,
      'D',
      'H2',
      ['outside-2015-orton-koop-100-miles'],
      {
        unit: 'fraction of expected race duration',
        note: 'Default: no study sets this number. It binds only for races expected under 10 h (for example a 50K goal).',
      },
    ),
    raceSimulationMaxHours: param(
      'h2.raceSimulationMaxHours',
      8,
      'D',
      'H2',
      [
        'outside-2023-strava-western-states',
        'outside-2023-strava-utmb',
        'outside-2015-orton-koop-100-miles',
      ],
      {
        unit: 'h',
        note: 'Default: design intent for one race simulation of up to this length, within G-1 (an entered tune-up race could serve). Not read by any code yet, so the plan and the app do not offer the simulation.',
      },
    ),
  },
  h3: {
    b2bMinGapWeeks: param(
      'h3.b2bMinGapWeeks',
      2,
      'D',
      'H3',
      ['frandsen-2025-session-spike', 'viljoen-2022-trail-risk-factors'],
      {
        unit: 'weeks',
        note: "Default: at most one back-to-back pair every 2 weeks, in build or specific phases only, never in the taper. No study measures back-to-backs; the review's double-session factor is same-day doubles, which are a different structure.",
      },
    ),
    b2bDay2MaxRatioOfDay1: param(
      'h3.b2bDay2MaxRatioOfDay1',
      1.0,
      'D',
      'H3',
      ['frandsen-2025-session-spike'],
      {
        unit: 'ratio',
        note: 'Default: day 2 is no longer than day 1 (the micro-cycle default is 0.6 of day 1). No study measures back-to-backs.',
      },
    ),
    b2bTwoDayRatio: param('h3.b2bTwoDayRatio', 1.1, 'D', 'H3', ['frandsen-2025-session-spike'], {
      unit: 'ratio to the largest 2-day total in the last 30 days',
      note: 'Default: the pair is no more than 1.10x the largest 2-day total in the last 30 days; extends G-1 by analogy, which is the only basis.',
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
    climbNoteGainPerHourM: param(
      'h4.climbNoteGainPerHourM',
      150,
      'D',
      'H4',
      ['hingrand-2023-power-vs-ascent-speed', 'jeker-2020-vertical-speed-ultra'],
      {
        unit: 'm/h',
        note: 'Default: a session whose planned gain reaches this many metres per hour of running gets a climbing line (climb by effort, not by speed). No study sets this number; it sits well below the about 550 m/h reference for sustained ultra climbing.',
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
    // The personal fuel ladder (E6, ADR 0011). Counting, movement and heat are replayed from the
    // runner's own logs; only the 2 h threshold has a study behind it, the rest are labelled defaults.
    logMinDurationMin: param('h7.logMinDurationMin', 120, 'A', 'H7', ['costa-2017-eigs-sr'], {
      unit: 'min',
      note: 'A run of at least this long can be logged and counted toward the ladder (a run of at least h7.gutTrainingSessionMinMin counts in a gut-training week). The review puts the threshold for significant gut strain at 2 h at about 60% VO2max; the app judges by duration alone.',
    }),
    rungReachFraction: param('h7.rungReachFraction', 0.9, 'D', 'H7', [], {
      unit: 'fraction',
      note: 'Default: a run reaches a rung when its carbohydrate rate over elapsed time is at least this fraction of the rung, which allows for a gel taken a few minutes late. No study sets a tolerance.',
    }),
    multiCarbMinShare: param(
      'h7.multiCarbMinShare',
      0.5,
      'D',
      'H7',
      ['jeukendrup-2014-cho-intake'],
      {
        unit: 'fraction',
        note: 'Default: above the first higher tier at least this share of the carbohydrate eaten comes from products with more than one transportable carbohydrate for the run to count. The review asks for multiple transportable carbohydrates above about 60 g/h; no study sets a share.',
      },
    ),
    stepUpToleratedRuns: param(
      'h7.stepUpToleratedRuns',
      1,
      'D',
      'H7',
      ['martinez-2023-gut-training-sr'],
      {
        unit: 'runs',
        note: 'Default: one tolerated run opens the next step. The gut-training trials repeated the challenge for 2 weeks and the review found no established count, so the hold and fall-back rules carry the caution.',
      },
    ),
    immediateFallbackScore: param(
      'h7.immediateFallbackScore',
      4,
      'D',
      'H7',
      ['stuempfle-2015-gi-distress-wser'],
      {
        unit: 'score',
        note: 'Default: a run scored this high (very severe on the 0-4 scale) returns the target to the last tolerated rung at once, without waiting for a second run. GI symptoms were a reason for dropping out for 35.6% of 161 km non-finishers (descriptive).',
      },
    ),
    nauseaContingencyScore: param(
      'h7.nauseaContingencyScore',
      2,
      'D',
      'H7',
      ['stuempfle-2015-gi-distress-wser', 'costa-2017-eigs-sr'],
      {
        unit: 'score',
        note: 'Default: a nausea score this high on a counted run brings the nausea plan (simpler fuel, a slower pace) forward; the same cut-off as h7.gutStopScore. The sources name the plan, not the score.',
      },
    ),
    hotDayWbgtC: param(
      'h7.hotDayWbgtC',
      18,
      'D',
      'H7',
      ['costa-2017-eigs-sr', 'stuempfle-2015-gi-distress-wser'],
      {
        unit: 'C WBGT',
        note: 'Default: a run at or above this WBGT is a hot day for fuel, so the target does not step up. Gut strain and nausea rise with heat but no study sets a temperature. This is not the heat-steering threshold: isHotForSteering (shared/engine/heat.ts) uses i9.warnWbgtC, 25 C WBGT, to drop the heart-rate ceiling, a different question, so a day can be hot for fuel and not for steering.',
      },
    ),
    hotDayAirTempC: param(
      'h7.hotDayAirTempC',
      25,
      'D',
      'H7',
      ['costa-2017-eigs-sr', 'stuempfle-2015-gi-distress-wser'],
      {
        unit: 'C',
        note: 'Default: when a run has an air temperature but no WBGT, at or above this is a hot day for fuel. isHotForSteering never treats an air temperature alone as hot; the fuel hold errs the other way because stepping up on a hot day is the riskier mistake.',
      },
    ),
    gutBlockSessionsPerWeek: param('h7.gutBlockSessionsPerWeek', 3, 'D', 'H7', GUT, {
      unit: 'runs per week',
      note: 'Default: at most this many runs of h7.gutTrainingSessionMinMin or more carry the fuel-practice flag in a gut-training week. The trials used near-daily 1 h sessions for 2 weeks and no study sets a weekly count; the flag adds no session, so only runs already in the plan are marked.',
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
        note: 'Weight loss up to 3% is fine; weight gain is a warning sign.',
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
      [
        'giovanelli-2017-ultra-sep',
        'pastor-2022-trail-determinants-distances',
        'zanini-2025-strength-economy-durability-rct',
      ],
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
      [
        'giovanelli-2017-ultra-sep',
        'pastor-2022-trail-determinants-distances',
        'zanini-2025-strength-economy-durability-rct',
      ],
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
    reducedDays: param(
      'h12.reducedDays',
      7,
      'D',
      'H12',
      ['skurka-2017-roche-100-recovery', 'cts-2025-koop-ultra-recovery'],
      {
        unit: 'days',
        note: 'Default: each return step after the hold lasts this many days; coach plans describe weekly stages and the evidence has no finer resolution than the day-9 and day-16 milestones.',
      },
    ),
    step1RunMaxMin: param(
      'h12.step1RunMaxMin',
      40,
      'D',
      'H12',
      [
        'martinez-navarro-2021-marathon-week-rct',
        'irunfar-2016-powell-post-100-return',
        'cts-2025-koop-ultra-recovery',
      ],
      {
        unit: 'min per run',
        note: 'Default. The marathon first step is the dose of one small randomised trial of recreational runners (40 min at first-threshold heart rate), grade B there; the value is graded D because it also caps the first step after 50K and longer races, where it extrapolates to the 25-45 min jogs coaches describe.',
      },
    ),
    step1MaxRuns: param(
      'h12.step1MaxRuns',
      3,
      'D',
      'H12',
      [
        'martinez-navarro-2021-marathon-week-rct',
        'irunfar-2016-powell-post-100-return',
        'cts-2025-koop-ultra-recovery',
      ],
      {
        unit: 'runs',
        note: 'Default. The marathon first step is the schedule of one small randomised trial (days 2, 4 and 6, three runs on non-consecutive days), grade B there; the value is graded D because it also caps the first step after 50K and longer races, where it is an extrapolation.',
      },
    ),
    step2RunMaxMin: param(
      'h12.step2RunMaxMin',
      60,
      'D',
      'H12',
      ['cts-2025-koop-ultra-recovery', 'skurka-2017-roche-100-recovery'],
      {
        unit: 'min per run',
        note: 'Default: runs in the second step stay under an hour, the recovery-pace weeks a 100-mile coaching plan describes.',
      },
    ),
    laterStepLongRunMaxMin: param(
      'h12.laterStepLongRunMaxMin',
      90,
      'D',
      'H12',
      ['cts-2025-koop-ultra-recovery', 'skurka-2017-roche-100-recovery'],
      {
        unit: 'min',
        note: 'Default: from the third step on, the longest run of a week is at most this long; an engineering default that no study supports.',
      },
    ),
    modifierMultiplier: param(
      'h12.modifierMultiplier',
      1.5,
      'D',
      'H12',
      [
        'garciavaliente-2026-trail-damage-review',
        'easthope-2010-trail55km-masters',
        'irunfar-2014-uhan-ultra-recovery-rules',
        'skurka-2017-roche-100-recovery',
        'irunfar-2023-torrence-post-ultra-downtime',
      ],
      {
        note: 'Default: the hold is multiplied by this (rounded up), once, for a steep-descent race, a runner of 40 or older, or a first finish in the class. The direction follows the damage and masters data; the value is a convention.',
      },
    ),
    hillyDescentMPerKm: param(
      'h12.hillyDescentMPerKm',
      30,
      'D',
      'H12',
      ['garciavaliente-2026-trail-damage-review'],
      {
        unit: 'm of descent per km',
        note: 'Default: a race that descended at least this much per kilometre lengthens the hold; eccentric load drives the damage, and no study sets the threshold.',
      },
    ),
    advanceCleanCheckins: param(
      'h12.advanceCleanCheckins',
      2,
      'D',
      'H12',
      [
        'hoffman-2017-161km-recovery-determinants',
        'saw-2016-subjective-vs-objective-monitoring',
        'gaudino-2019-recovery-stress-ultra',
      ],
      {
        unit: 'check-ins',
        note: 'Default: a stage advances only when the last this-many check-ins before its boundary are not poor and report no pain or illness; the direction (check-ins can only delay) is graded B, the count mirrors j3.persistenceDays.',
      },
    ),
    ownBaselineMinCheckins: param(
      'h12.ownBaselineMinCheckins',
      14,
      'D',
      'H12',
      ['gaudino-2019-recovery-stress-ultra', 'saw-2016-subjective-vs-objective-monitoring'],
      {
        unit: 'check-ins in the 28 days before the race',
        note: 'Default: with this many check-ins before the race, a post-race check-in also counts as poor when it is worse than the own pre-race median by the J2 margin; the personal comparison only adds caution.',
      },
    ),
    gateStaleDays: param('h12.gateStaleDays', 3, 'D', 'H12', [], {
      unit: 'days',
      note: 'Default: a check-in older than this many days before a stage boundary neither delays nor releases it, so a poor rating followed by no ratings holds a step for at most this long; with no recent check-in the default schedule runs.',
    }),
    gateEscalationDays: param(
      'h12.gateEscalationDays',
      14,
      'D',
      'H12',
      ['meeusen-2013-overtraining-consensus'],
      {
        unit: 'days',
        note: 'Default: after the check-in gate has delayed the return this many days, the J8 clinician checklist is shown (the same 14 days as j8.deloadSuggestDays).',
      },
    ),
    goalRaceDistanceTolerancePct: param('h12.goalRaceDistanceTolerancePct', 10, 'D', 'H12', [], {
      unit: '% of the goal distance',
      note: 'Default: a race logged on the goal date is the goal race itself, and has no window of its own, when its distance is within this share of the goal distance; a GPS track seldom equals the entered distance.',
    }),
  },
  h12HoldDays: {
    marathon: param(
      'h12HoldDays.marathon',
      2,
      'B',
      'H12',
      [
        'martinez-navarro-2021-marathon-week-rct',
        'takayama-2017-marathon-one-week',
        'bernat-adell-2021-marathon-biomarkers',
      ],
      {
        unit: 'days',
        note: 'Grade B rests on one small randomised trial of recreational runners that started running 48 h after the finish; nothing supports a run at 24 h, and a longer full stop is not required by that evidence.',
      },
    ),
    ultra50: param(
      'h12HoldDays.ultra50',
      4,
      'D',
      'H12',
      [
        'irunfar-2014-uhan-ultra-recovery-rules',
        'easthope-2010-trail55km-masters',
        'garciavaliente-2026-trail-damage-review',
      ],
      {
        unit: 'days',
        note: 'Default: days without running after a race of 42.2 to 80.5 km; a coach rule of a day per 10 miles gives 3 to 5 days and 4 is the class middle.',
      },
    ),
    ultra100k: param(
      'h12HoldDays.ultra100k',
      7,
      'D',
      'H12',
      [
        'martinez-navarro-2021-118km-inflammation-activity',
        'martinez-navarro-2019-118km-cardiac-hrv',
        'irunfar-2014-uhan-ultra-recovery-rules',
        'skurka-2017-roche-100-recovery',
      ],
      {
        unit: 'days',
        note: 'Default: days without running after a race of 80.5 to 130 km; no 100K time course exists, and 118 km data show raised damage markers at days 3 and 7.',
      },
    ),
    ultra100mi: param(
      'h12HoldDays.ultra100mi',
      10,
      'D',
      'H12',
      [
        'millet-2011-ultramarathon-neuromuscular',
        'hoffman-2017-161km-recovery-determinants',
        'paech-2021-100mile-hrv',
        'irunfar-2014-uhan-ultra-recovery-rules',
      ],
      {
        unit: 'days',
        note: 'Default: days without running after a race of 130 to 170 km; after 166 km neuromuscular function was mostly back by day 9 and fully by day 16, and the coach rule of a day per 10 miles gives 10.',
      },
    ),
    beyond: param(
      'h12HoldDays.beyond',
      14,
      'D',
      'H12',
      [
        'saugy-2013-330km-neuromuscular',
        'besson-2020-single-vs-multistage-ultra',
        'irunfar-2014-uhan-ultra-recovery-rules',
      ],
      {
        unit: 'days',
        note: 'Default: a judgement cap for races above 170 km; damage did not scale with distance up to 330 km and no recovery data exist above 100 miles.',
      },
    ),
  },
} satisfies ParamGroups

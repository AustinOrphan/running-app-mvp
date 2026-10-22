// Section (l) Performance prediction, plus the numeric personalization verdicts of section (m)
// that prediction uses (`mAge`, `mSex`). Source: research/engine-rules.md. Task E4 may add here.
import { param, type ParamGroups } from './define.ts'

const SMYTH_DURABILITY = ['smyth-2022-durability-decoupling']

export const lPredict = {
  l1: {
    personalExponentMinRaces: param(
      'l1.personalExponentMinRaces',
      2,
      'C',
      'L1',
      ['blythe-2016-individual-prediction', 'emig-2020-big-data', 'peronnet-1989-running-model'],
      { unit: 'races at different distances' },
    ),
    riegelExponent: param('l1.riegelExponent', 1.06, 'C', 'L1', ['vickers-2016-race-times'], {
      note: 'Riegel exponent, only for targets up to 21.1 km.',
    }),
    riegelMaxTargetM: param('l1.riegelMaxTargetM', 21100, 'C', 'L1', ['vickers-2016-race-times'], {
      unit: 'm',
    }),
    csFitMinutes: param<[number, number]>(
      'l1.csFitMinutes',
      [3, 30],
      'C',
      'L1',
      ['ruizalias-2023-long-duration-power'],
      {
        unit: 'min',
        note: 'CP or CS fits only from efforts spanning this range.',
      },
    ),
    csExtrapolationMaxMin: param(
      'l1.csExtrapolationMaxMin',
      60,
      'C',
      'L1',
      ['ruizalias-2023-long-duration-power'],
      {
        unit: 'min',
        note: 'Validated extrapolation reaches 60 min.',
      },
    ),
    sameDistanceTolerancePct: param('l1.sameDistanceTolerancePct', 5, 'D', 'L1', [], {
      unit: '% of target distance',
      note: 'Default: a race within this much of the target distance anchors it directly at any distance, including a marathon or an ultra (L4 anchors on the marathon PB and prior ultra results).',
    }),
    refitWindowWeeks: param<[number, number]>(
      'l1.refitWindowWeeks',
      [8, 12],
      'D',
      'L1',
      ['emig-2020-big-data'],
      {
        unit: 'weeks',
        note: 'Default: refit on a rolling window of this length.',
      },
    ),
  },
  l2: {
    singleAnchorMaxM: param('l2.singleAnchorMaxM', 21100, 'D', 'L2', ['vickers-2016-race-times'], {
      unit: 'm',
      note: 'Default: a single anchor of 21.1 km or shorter gets the slowdown placeholder.',
    }),
    singleAnchorSlowdownPct: param(
      'l2.singleAnchorSlowdownPct',
      3,
      'D',
      'L2',
      ['vickers-2016-race-times'],
      {
        unit: '%',
        note: 'Default: 3% placeholder slowdown for a marathon predicted from a single shorter anchor.',
      },
    ),
    marathonMinHalfWidthPct: param(
      'l2.marathonMinHalfWidthPct',
      6,
      'C',
      'L2',
      ['oficial-casado-2026-valencia-vdot', 'smyth-2022-durability-decoupling'],
      {
        unit: '% of predicted time',
        note: 'Interval half-width is at least this.',
      },
    ),
    reportedErrorPct: param(
      'l2.reportedErrorPct',
      5.9,
      'C',
      'L2',
      ['oficial-casado-2026-valencia-vdot', 'smyth-2022-durability-decoupling'],
      {
        unit: '%',
        note: 'Reported marathon prediction error (descriptive).',
      },
    ),
    reportedErrorRangePct: param<[number, number]>(
      'l2.reportedErrorRangePct',
      [7.7, 8.0],
      'C',
      'L2',
      ['oficial-casado-2026-valencia-vdot', 'smyth-2022-durability-decoupling'],
      {
        unit: '%',
        note: 'Reported marathon prediction error (descriptive).',
      },
    ),
    reportedErrorWithDurabilityPct: param(
      'l2.reportedErrorWithDurabilityPct',
      5.2,
      'C',
      'L2',
      ['oficial-casado-2026-valencia-vdot', 'smyth-2022-durability-decoupling'],
      {
        unit: '%',
        note: 'Reported marathon prediction error with durability added (descriptive).',
      },
    ),
    csFractionAt150Min: param(
      'l2.csFractionAt150Min',
      0.93,
      'C',
      'L2',
      ['smyth-2020-cs-training-data'],
      {
        unit: 'fraction of CS',
        note: 'Target pace prior at a duration of 150 min; falls toward the 360 min value.',
      },
    ),
    csFractionAt360Min: param(
      'l2.csFractionAt360Min',
      0.79,
      'C',
      'L2',
      ['smyth-2020-cs-training-data'],
      {
        unit: 'fraction of CS',
        note: 'Target pace prior at a duration of 360 min.',
      },
    ),
    csFractionShortMin: param(
      'l2.csFractionShortMin',
      150,
      'C',
      'L2',
      ['smyth-2020-cs-training-data'],
      {
        unit: 'min',
        note: 'Duration at which the target pace prior is the 150 min fraction.',
      },
    ),
    csFractionLongMin: param(
      'l2.csFractionLongMin',
      360,
      'C',
      'L2',
      ['smyth-2020-cs-training-data'],
      {
        unit: 'min',
        note: 'Duration at which the target pace prior is the 360 min fraction.',
      },
    ),
    csFractionLowDecoupling: param(
      'l2.csFractionLowDecoupling',
      0.88,
      'C',
      'L2',
      SMYTH_DURABILITY,
      {
        unit: 'fraction of CS',
        note: 'Low-decoupling runners, about 0.88 of CS.',
      },
    ),
    csFractionHighDecoupling: param(
      'l2.csFractionHighDecoupling',
      0.82,
      'C',
      'L2',
      SMYTH_DURABILITY,
      {
        unit: 'fraction of CS',
        note: 'High-decoupling runners, about 0.82 of CS.',
      },
    ),
    decouplingLowBelow: param('l2.decouplingLowBelow', 1.1, 'C', 'L2', SMYTH_DURABILITY, {
      unit: 'ratio',
      note: 'Decoupling band: low below 1.1.',
    }),
    decouplingHighFrom: param('l2.decouplingHighFrom', 1.2, 'C', 'L2', SMYTH_DURABILITY, {
      unit: 'ratio',
      note: 'Decoupling band: high at 1.2 or more; moderate between.',
    }),
    marathonDistanceM: param('l2.marathonDistanceM', 42195, 'D', 'L2', [], {
      unit: 'm',
      note: 'Default reference: the marathon distance, used to express ability as a marathon time.',
    }),
    csFractionAt60Min: param('l2.csFractionAt60Min', 1.0, 'D', 'L2', [], {
      unit: 'fraction of CS',
      note: 'Default: the target pace prior joins the critical-speed fit at 60 min (the validated extrapolation limit) at 1.0 of CS and falls linearly to the 150 min value.',
    }),
    decouplingOnset: param('l2.decouplingOnset', 1.025, 'C', 'L2', SMYTH_DURABILITY, {
      unit: 'ratio',
    }),
  },
  l3: {
    singleSourceWideningPct: param('l3.singleSourceWideningPct', 50, 'D', 'L3', [], {
      unit: '%',
      note: 'Default: the interval half-width grows by this much when only one source supports the prediction (the rule asks for two or more).',
    }),
    minSources: param('l3.minSources', 2, 'C', 'L3', ['keogh-2019-marathon-prediction-equations'], {
      unit: 'sources',
      note: 'Use at least 2 sources for any prediction (grade A/C as stated; the lower grade is used).',
    }),
  },
  l4: {
    csFractionFloor: param('l4.csFractionFloor', 0.5, 'D', 'L4', [], {
      unit: 'fraction of CS',
      note: 'Default: the target pace prior keeps falling past 360 min at the 150-360 min slope, down to this floor.',
    }),
    ultraMinHalfWidthPct: param('l4.ultraMinHalfWidthPct', 15, 'D', 'L4', [], {
      unit: '% of predicted time',
      note: 'Default: ultra predictions show a wide range; the half-width is at least this.',
    }),
  },
  l5: {
    gainEquivalentM: param(
      'l5.gainEquivalentM',
      10,
      'D',
      'L5',
      ['dewaal-2021-trail-physiology-sr'],
      {
        unit: 'flat m per m of gain',
        note: 'Default: 100 m of gain counts as 1 km of flat distance (the km-effort convention); road CS and race anchors are flat-equivalent.',
      },
    ),
    gainWideningPctPerMPerKm: param(
      'l5.gainWideningPctPerMPerKm',
      1,
      'D',
      'L5',
      ['dewaal-2021-trail-physiology-sr'],
      {
        unit: '% per m of gain per km',
        note: 'Default: the trail widening grows by this much per metre of gain per kilometre.',
      },
    ),
    trailIntervalWideningPct: param(
      'l5.trailIntervalWideningPct',
      50,
      'D',
      'L5',
      ['dewaal-2021-trail-physiology-sr', 'ehrstrom-2018-short-trail'],
      {
        unit: '%',
        note: 'Default: widen the interval by 50% for trail targets and let it grow with gain per km. The widening is grade A; the amount is a default.',
      },
    ),
  },
  l6: {
    minBandPct: param('l6.minBandPct', 3, 'C', 'L6', ['busso-2023-impulse-response-validity'], {
      unit: '% of predicted time',
      note: 'Every model-based forecast carries at least +/- this until running back-tests exist.',
    }),
  },
  mAge: {
    declinePctPerYear: param(
      'mAge.declinePctPerYear',
      0.7,
      'C',
      'm-age',
      ['ganse-2020-longitudinal-masters', 'lepers-2021-sub3-marathon-decades'],
      {
        unit: '% per year after 35',
        range: [0.5, 1.0],
        note: 'Long-term projection only; never an age-based cut to volume, quality or ramp.',
      },
    ),
    declineFromAge: param(
      'mAge.declineFromAge',
      35,
      'C',
      'm-age',
      ['ganse-2020-longitudinal-masters', 'lepers-2021-sub3-marathon-decades'],
      {
        unit: 'years',
      },
    ),
    declineMultiplierAfter70: param(
      'mAge.declineMultiplierAfter70',
      1.5,
      'C',
      'm-age',
      ['ganse-2020-longitudinal-masters', 'lepers-2021-sub3-marathon-decades'],
      {
        unit: 'x',
        note: 'The decline rate is multiplied by this after age 70.',
      },
    ),
    declineMultiplierFromAge: param(
      'mAge.declineMultiplierFromAge',
      70,
      'C',
      'm-age',
      ['ganse-2020-longitudinal-masters', 'lepers-2021-sub3-marathon-decades'],
      {
        unit: 'years',
      },
    ),
    ultraAgeNeutralUntil: param(
      'mAge.ultraAgeNeutralUntil',
      50,
      'C',
      'm-age',
      ['knechtle-2012-100km-age'],
      {
        unit: 'years',
        note: 'Ultra performance is flat with age until about this age.',
      },
    ),
  },
  mSex: {
    womenDecouplingPriorOffset: param(
      'mSex.womenDecouplingPriorOffset',
      0.05,
      'D',
      'm-sex',
      SMYTH_DURABILITY,
      {
        unit: 'ratio lower',
        note: 'Default: weak durability prior, 0.05 lower for women (grade C/D as stated).',
      },
    ),
    cyclePhaseLoadMultiplier: param(
      'mSex.cyclePhaseLoadMultiplier',
      1.0,
      'A',
      'm-sex',
      ['mcnulty-2020-menstrual-cycle-performance'],
      {
        note: 'No cycle-phase or contraceptive multiplier on load or targets.',
      },
    ),
  },
} satisfies ParamGroups

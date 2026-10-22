// Section (i) Environment, including the terrain additions I11 and I12. Source:
// research/engine-rules.md. Task E3 may add here.
import { param, type ParamGroups } from './define.ts'

const HEAT_CONSENSUS = [
  'racinais-2015-heat-consensus',
  'tyler-2016-heat-adaptation-meta',
  'daanen-2018-acclimation-decay',
  'periard-2015-heat-acclimation-adaptations',
]
const MINETTI = ['minetti-2002-gradient-cost', 'vernillo-2017-graded-running-review']

export const iEnv = {
  i1: {
    airTempOptimumC: param<[number, number]>(
      'i1.airTempOptimumC',
      [10, 17.5],
      'C',
      'I1',
      [
        'liljegren-2008-wbgt-model',
        'mantzios-2022-weather-endurance',
        'elhelou-2012-environment-marathon',
      ],
      {
        unit: 'C',
        note: 'Air-temperature optimum used as the fallback when WBGT cannot be computed; label which index was used.',
      },
    ),
  },
  i2: {
    wbgtOptimumC: param<[number, number]>(
      'i2.wbgtOptimumC',
      [7.5, 15],
      'C',
      'I2',
      ['mantzios-2022-weather-endurance'],
      {
        unit: 'C WBGT',
        note: 'No penalty inside this band.',
      },
    ),
  },
  i3: {
    slopePctPerC: param('i3.slopePctPerC', 0.35, 'C', 'I3', ['mantzios-2022-weather-endurance'], {
      unit: '% per C WBGT above 15 C',
      range: [0.3, 0.4],
      note: 'Elite slope.',
    }),
    slopeStartC: param('i3.slopeStartC', 15, 'C', 'I3', ['mantzios-2022-weather-endurance'], {
      unit: 'C WBGT',
    }),
    marathonTable10to15Pct: param(
      'i3.marathonTable10to15Pct',
      0.8,
      'C',
      'I3',
      ['ely-2007-weather-marathon'],
      {
        unit: '% slower, relative to WBGT 5-10 C',
        note: 'Cross-check for marathon outputs, WBGT 10-15 C.',
      },
    ),
    marathonTable15to20Pct: param(
      'i3.marathonTable15to20Pct',
      1.6,
      'C',
      'I3',
      ['ely-2007-weather-marathon'],
      {
        unit: '% slower, relative to WBGT 5-10 C',
        note: 'Cross-check for marathon outputs, WBGT 15-20 C.',
      },
    ),
    marathonTable20to25Pct: param(
      'i3.marathonTable20to25Pct',
      2.8,
      'C',
      'I3',
      ['ely-2007-weather-marathon'],
      {
        unit: '% slower, relative to WBGT 5-10 C',
        note: 'Cross-check for marathon outputs, WBGT 20-25 C (the slope gives 2.6 in this band).',
      },
    ),
    slopeAgreementBand20to25Pct: param(
      'i3.slopeAgreementBand20to25Pct',
      2.6,
      'C',
      'I3',
      ['mantzios-2022-weather-endurance'],
      {
        unit: '%',
        note: 'Penalty the slope gives in the 20-25 C band, agreeing with the table value of 2.8.',
      },
    ),
    predictionTopicSlopePctPerC: param('i3.predictionTopicSlopePctPerC', 0.18, 'D', 'I3', [], {
      unit: '% per C',
      note: 'Default cross-check only: the prediction topic derived this slope; the engine uses i3.slopePctPerC.',
    }),
    noExtrapolationAboveC: param(
      'i3.noExtrapolationAboveC',
      25,
      'C',
      'I3',
      ['ely-2007-weather-marathon', 'mantzios-2022-weather-endurance'],
      {
        unit: 'C WBGT',
        note: 'Do not extrapolate the penalty above this WBGT; show a warning instead.',
      },
    ),
  },
  i4: {
    abilityMultiplierMin: param(
      'i4.abilityMultiplierMin',
      1.0,
      'D',
      'I4',
      ['ely-2007-weather-marathon', 'knechtle-2019-boston-weather'],
      {
        note: 'Default: heat multiplier at a 2:30 marathon-equivalent; calibrate from the athlete logs. No sex term.',
      },
    ),
    abilityMultiplierMax: param(
      'i4.abilityMultiplierMax',
      2.0,
      'D',
      'I4',
      ['ely-2007-weather-marathon', 'knechtle-2019-boston-weather'],
      {
        note: 'Default: heat multiplier at a 4:30 marathon-equivalent or slower.',
      },
    ),
    abilityFastSec: param(
      'i4.abilityFastSec',
      9000,
      'D',
      'I4',
      ['ely-2007-weather-marathon', 'knechtle-2019-boston-weather'],
      {
        unit: 's',
        note: 'Default: marathon-equivalent time (2:30) where the multiplier is 1.0.',
      },
    ),
    abilitySlowSec: param(
      'i4.abilitySlowSec',
      16200,
      'D',
      'I4',
      ['ely-2007-weather-marathon', 'knechtle-2019-boston-weather'],
      {
        unit: 's',
        note: 'Default: marathon-equivalent time (4:30) where the multiplier reaches 2.0; linear in between.',
      },
    ),
    predictionTopicPlaceholder: param('i4.predictionTopicPlaceholder', 1.5, 'D', 'I4', [], {
      note: 'Default placeholder the prediction topic used for runners over 4 h; it falls inside the ramp, which is the more conservative choice and is used instead.',
    }),
  },
  i6: {
    hotYearSlowdownPct: param(
      'i6.hotYearSlowdownPct',
      8,
      'C',
      'I6',
      ['parise-2011-161km-pacing-heat'],
      {
        unit: '% slower at 161 km in a hot year',
        note: 'Apply the penalty only to hours in daytime heat and relax it at night.',
      },
    ),
    lowConfidenceEventHours: param(
      'i6.lowConfidenceEventHours',
      6,
      'D',
      'I6',
      ['bouscaren-2019-marathon-vs-ultra-heat'],
      {
        unit: 'h',
        note: 'Default: label every heat adjustment for events over this duration as low confidence.',
      },
    ),
  },
  i7: {
    hrRiseAt35CPct: param<[number, number]>(
      'i7.hrRiseAt35CPct',
      [17, 19],
      'C',
      'I7',
      ['wingo-2020-drift-vo2max-heat-running'],
      {
        unit: '%',
        note: 'HR rose by this much at 35 C while capacity fell, so a fixed HR zone is never held in heat.',
      },
    ),
  },
  i8: {
    triggerWbgtC: param('i8.triggerWbgtC', 18, 'D', 'I8', HEAT_CONSENSUS, {
      unit: 'C WBGT',
      note: 'Default: race WBGT at or above this triggers an acclimation block.',
    }),
    blockDays: param<number>('i8.blockDays', 10, 'A', 'I8', HEAT_CONSENSUS, {
      unit: 'days',
      range: [7, 14],
      note: '7-14 days of daily heat exposure ending close to the race, longer if time allows; 10 is the midpoint.',
    }),
    blockMinDays: param('i8.blockMinDays', 5, 'A', 'I8', HEAT_CONSENSUS, { unit: 'days' }),
    decayPctPerDay: param('i8.decayPctPerDay', 2.5, 'A', 'I8', HEAT_CONSENSUS, {
      unit: '% of the adaptation per day',
    }),
    zeroCreditDays: param('i8.zeroCreditDays', 40, 'D', 'I8', ['daanen-2018-acclimation-decay'], {
      unit: 'days',
      note: 'Default: credit reaches zero at about 40 days; the 40 days is an extrapolation.',
    }),
    reacclimationSpeedup: param<[number, number]>(
      'i8.reacclimationSpeedup',
      [8, 12],
      'A',
      'I8',
      ['daanen-2018-acclimation-decay'],
      {
        unit: 'x faster than decay',
        note: 'Top up inside the taper; re-acclimation is this many times faster than decay.',
      },
    ),
    maxPenaltyReduction: param(
      'i8.maxPenaltyReduction',
      0.5,
      'D',
      'I8',
      ['periard-2015-heat-acclimation-adaptations'],
      {
        unit: 'fraction of the heat penalty',
        note: 'Default: acclimation may reduce the penalty by at most 50%.',
      },
    ),
  },
  i9: {
    warnWbgtC: param('i9.warnWbgtC', 25, 'C', 'I9', ['thorsson-2021-pet-vs-wbgt'], {
      unit: 'C WBGT',
      note: 'Warn above this WBGT. WBGT is a screening index, not a safety guarantee.',
    }),
  },
  i11: {
    levelCostJPerKgM: param('i11.levelCostJPerKgM', 3.4, 'C', 'I11', MINETTI, {
      unit: 'J/kg/m',
      note: 'Level running cost; costs are expressed as a ratio to it. The full polynomial comes from the paper text, which engine-rules.md does not reproduce.',
    }),
    costRatioPlus45: param('i11.costRatioPlus45', 5.6, 'C', 'I11', MINETTI, {
      unit: 'ratio to level cost',
      note: 'Cost ratio at +45% grade.',
    }),
    costRatioMinus20: param('i11.costRatioMinus20', 0.51, 'C', 'I11', MINETTI, {
      unit: 'ratio to level cost',
      note: 'Minimum of the curve at -20% grade; downhill credit is capped here.',
    }),
    costRatioMinus45: param('i11.costRatioMinus45', 1.15, 'C', 'I11', MINETTI, {
      unit: 'ratio to level cost',
      note: 'Cost ratio at -45% grade.',
    }),
    downhillCreditFloorGradePct: param(
      'i11.downhillCreditFloorGradePct',
      -20,
      'C',
      'I11',
      ['minetti-2002-gradient-cost', 'genitrini-2022-downhill-pacing'],
      {
        unit: '% grade',
        note: 'Cap downhill credit at the -20% minimum and treat the result as an upper bound on speed.',
      },
    ),
    lateDescentCostIncrease: param(
      'i11.lateDescentCostIncrease',
      0.13,
      'C',
      'I11',
      ['vernillo-2015-fatigue-energy-cost'],
      {
        unit: 'fraction',
        note: 'Late-race descent cost rise (+13% on descents), flagged low confidence.',
      },
    ),
    lateDescentEventHours: param(
      'i11.lateDescentEventHours',
      6,
      'C',
      'I11',
      ['vernillo-2015-fatigue-energy-cost'],
      {
        unit: 'h',
        note: 'The late-race term applies to events over this duration.',
      },
    ),
  },
  i12: {
    altitudeFromM: param('i12.altitudeFromM', 800, 'C', 'I12', ['wehrlin-2006-altitude-linear'], {
      unit: 'm',
      note: 'Courses above about 800 m; acclimatisation is not modelled.',
    }),
    vo2maxDeclinePctPer1000m: param(
      'i12.vo2maxDeclinePctPer1000m',
      6.3,
      'C',
      'I12',
      ['wehrlin-2006-altitude-linear'],
      {
        unit: '% per 1000 m',
        range: [4.6, 7.5],
      },
    ),
  },
} satisfies ParamGroups

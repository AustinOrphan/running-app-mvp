// Section (c) Zones and thresholds. Source: research/engine-rules.md. Task E3 may add here.
import { param, type ParamGroups } from './define.ts'

export const cZones = {
  c3: {
    hrMaxIntercept: param(
      'c3.hrMaxIntercept',
      208,
      'A',
      'C3',
      ['tanaka-2001-hrmax-equation', 'gellish-2007-longitudinal-hrmax', 'nes-2013-hunt-hrmax'],
      {
        unit: 'bpm',
        note: 'HRmax prior = 208 - 0.7 x age, flagged as approximate. 220 - age is never used.',
      },
    ),
    hrMaxAgeSlope: param(
      'c3.hrMaxAgeSlope',
      0.7,
      'A',
      'C3',
      ['tanaka-2001-hrmax-equation', 'gellish-2007-longitudinal-hrmax', 'nes-2013-hunt-hrmax'],
      { unit: 'bpm per year of age' },
    ),
    priorBandBpm: param(
      'c3.priorBandBpm',
      10.8,
      'A',
      'C3',
      ['tanaka-2001-hrmax-equation', 'gellish-2007-longitudinal-hrmax', 'nes-2013-hunt-hrmax'],
      { unit: 'bpm', note: 'Band half-width of the predicted HRmax (C7).' },
    ),
    observedAgeDriftBpmPerYear: param(
      'c3.observedAgeDriftBpmPerYear',
      0.7,
      'C',
      'C3',
      ['gellish-2007-longitudinal-hrmax', 'pollock-1997-older-track-athletes'],
      {
        unit: 'bpm per year',
        range: [0.5, 0.7],
        note: 'Age an old measurement down by this much per year (5-7 bpm per decade).',
      },
    ),
  },
  c4: {
    lt1CsFraction: param(
      'c4.lt1CsFraction',
      0.823,
      'C',
      'C4',
      ['muniz-pumares-2025-marathon-tid'],
      {
        unit: 'fraction of CS',
        note: 'Z1/Z2 boundary when untested: 82.3% of CS, a data-derived cut-off from one large cohort.',
      },
    ),
    dfaA1Vt1: param(
      'c4.dfaA1Vt1',
      0.75,
      'C',
      'C4',
      [
        'rogers-2021-dfa-a1-aerobic-threshold',
        'vanhooren-2023-dfa-a1-runners',
        'rogers-2022-dfa-a1-update',
      ],
      { note: 'HR at DFA a1 = 0.75; chest strap only, fresh state.' },
    ),
    dfaArtefactMaxPct: param(
      'c4.dfaArtefactMaxPct',
      3,
      'C',
      'C4',
      [
        'rogers-2021-dfa-a1-aerobic-threshold',
        'vanhooren-2023-dfa-a1-runners',
        'rogers-2022-dfa-a1-update',
      ],
      { unit: '%', note: 'Artefacts at or below this share of beats.' },
    ),
    dfaBandBpm: param(
      'c4.dfaBandBpm',
      11,
      'C',
      'C4',
      [
        'rogers-2021-dfa-a1-aerobic-threshold',
        'vanhooren-2023-dfa-a1-runners',
        'rogers-2022-dfa-a1-update',
      ],
      { unit: 'bpm', note: 'Band half-width of a DFA-derived HR boundary (C7).' },
    ),
    borgVt1: param<[number, number]>(
      'c4.borgVt1',
      [10, 11],
      'D',
      'C4',
      ['bok-2022-subjective-intensity'],
      {
        unit: 'Borg 6-20',
        note: 'Default: perceived-effort anchor for VT1 on the Borg 6-20 scale. The source gives no CR-10 equivalent; the CR-10 mapping used elsewhere is an engine default.',
      },
    ),
    borgRcp: param<[number, number]>(
      'c4.borgRcp',
      [13, 15],
      'D',
      'C4',
      ['bok-2022-subjective-intensity'],
      {
        unit: 'Borg 6-20',
        note: 'Default: perceived-effort anchor for the respiratory compensation point (numeric parameter table); not converted to CR-10 by the source.',
      },
    ),
  },
  c5: {
    thresholdMarginWellTrainedKmh: param(
      'c5.thresholdMarginWellTrainedKmh',
      0.5,
      'C',
      'C5',
      ['nixon-2021-cs-vs-mlss'],
      { unit: 'km/h below CS', note: 'Well-trained athletes, bouts of 30 min or less.' },
    ),
    wellTrainedBoutMaxMin: param(
      'c5.wellTrainedBoutMaxMin',
      30,
      'C',
      'C5',
      ['nixon-2021-cs-vs-mlss'],
      {
        unit: 'min',
      },
    ),
    thresholdMarginOtherKmh: param(
      'c5.thresholdMarginOtherKmh',
      1.0,
      'D',
      'C5',
      ['nixon-2021-cs-vs-mlss'],
      {
        unit: 'km/h below CS',
        note: 'Default: for everyone else; roughly matches MLSS, which sits about 1.2 km/h below CS.',
      },
    ),
    mlssBelowCsKmh: param('c5.mlssBelowCsKmh', 1.2, 'D', 'C5', ['nixon-2021-cs-vs-mlss'], {
      unit: 'km/h',
      note: 'Default: reference gap between MLSS and CS used to justify the 1.0 km/h margin; descriptive.',
    }),
    dfaA1SustainedNever: param(
      'c5.dfaA1SustainedNever',
      0.5,
      'C',
      'C5',
      ['gronwald-2024-dfa-a1-prolonged'],
      {
        note: 'Never schedule sustained work at the speed where DFA a1 = 0.5.',
      },
    ),
  },
  c6: {
    repFractionOfTte: param('c6.repFractionOfTte', 0.5, 'D', 'C6', ['poole-2016-critical-power'], {
      unit: 'fraction of time to exhaustion',
      note: 'Default: each rep above CS lasts at most half the estimated time to exhaustion at that speed (the D-prime budget).',
    }),
  },
  c7: {
    bandDefaultBpm: param('c7.bandDefaultBpm', 5, 'D', 'C7', ['faude-2009-lactate-thresholds'], {
      unit: 'bpm',
      note: 'Default: boundary band half-width when no better band is known.',
    }),
    bandDefaultPacePct: param(
      'c7.bandDefaultPacePct',
      5,
      'D',
      'C7',
      ['faude-2009-lactate-thresholds'],
      {
        unit: '% of pace',
        note: 'Default: boundary band half-width for pace boundaries.',
      },
    ),
  },
  c8: {
    minObservations: param(
      'c8.minObservations',
      3,
      'D',
      'C8',
      ['hecksteden-2015-individual-response'],
      {
        unit: 'concordant observations',
        note: 'Default: a boundary moves only after this many concordant observations.',
      },
    ),
    breakDays: param('c8.breakDays', 14, 'C', 'C8', ['coyle-1984-detraining-time-course'], {
      unit: 'days',
      note: 'Re-estimate paces from fresh data after any break of 2 weeks or more.',
    }),
    watchLtMapePct: param<[number, number]>(
      'c8.watchLtMapePct',
      [12.7, 25.8],
      'C',
      'C8',
      ['lu-2025-smartwatch-lactate-threshold'],
      {
        unit: '%',
        note: 'MAPE of watch-reported LT pace; it is never an anchor. Watch LT HR is advisory.',
      },
    ),
  },
} satisfies ParamGroups

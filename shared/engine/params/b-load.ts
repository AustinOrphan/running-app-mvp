// Section (b) Load metrics per session. Source: research/engine-rules.md. Task E2 may add here.
import { param, type ParamGroups } from './define.ts'

export const bLoad = {
  b1: {
    srpePromptDelayMin: param('b1.srpePromptDelayMin', 30, 'D', 'B1', ['foster-2001-session-rpe'], {
      unit: 'min',
      note: 'Default: ask for the session RPE about 30 min after the run; the rating stays editable.',
    }),
  },
  b2: {
    wristHrBiasBpm: param(
      'b2.wristHrBiasBpm',
      -0.5,
      'A',
      'B2',
      ['zhang-2020-wrist-ppg-meta', 'gillinov-2017-wearable-hr-aerobic'],
      {
        unit: 'bpm',
        note: 'Wrist bias on steady runs; wrist HR qualifies for TRIMP only on steady flat or treadmill runs that pass sample checks.',
      },
    ),
    trailWristMapePct: param(
      'b2.trailWristMapePct',
      13,
      'C',
      'B2',
      ['navalta-2020-trail-running-hr', 'bent-2020-ppg-inaccuracy'],
      {
        unit: '%',
        note: 'MAPE of one wrist device on a trail run; optical HR on hills, trail and intervals is rejected for TRIMP.',
      },
    ),
  },
  b3: {
    trimpExponentMale: param(
      'b3.trimpExponentMale',
      1.92,
      'D',
      'B3',
      ['wallace-2014-load-methods-runners', 'manzi-2009-individualized-trimp-marathon'],
      {
        note: 'Default: Banister constant, unverified (Banister 1991 is not indexed). Shown with the formula; used when sex is unspecified and the profile setting is male.',
      },
    ),
    trimpExponentFemale: param(
      'b3.trimpExponentFemale',
      1.67,
      'D',
      'B3',
      ['wallace-2014-load-methods-runners', 'manzi-2009-individualized-trimp-marathon'],
      { note: 'Default: Banister constant, unverified (Banister 1991 is not indexed).' },
    ),
    trimpWeightMale: param(
      'b3.trimpWeightMale',
      0.64,
      'D',
      'B3',
      ['wallace-2014-load-methods-runners', 'manzi-2009-individualized-trimp-marathon'],
      { note: 'Default: leading weight of the Banister formula, unverified.' },
    ),
    trimpWeightFemale: param(
      'b3.trimpWeightFemale',
      0.86,
      'D',
      'B3',
      ['wallace-2014-load-methods-runners', 'manzi-2009-individualized-trimp-marathon'],
      { note: 'Default: leading weight of the Banister formula, unverified.' },
    ),
  },
  b4: {
    metricTimingShiftDays: param(
      'b4.metricTimingShiftDays',
      19.6,
      'C',
      'B4',
      ['vermeire-2021-load-quantification'],
      {
        unit: 'days',
        note: 'Metric choice moved the implied timing of peak benefit by up to this many days; sRPE and TRIMP are never summed or converted.',
      },
    ),
  },
  b5: {
    divergenceSd: param('b5.divergenceSd', 1.5, 'D', 'B5', ['chen-2002-borg-rpe-meta'], {
      unit: 'SD',
      note: 'Default: a session is shown as divergent when the sRPE and HR-load z-scores differ by more than this; shown, never corrected.',
    }),
    divergenceMinSessions: param(
      'b5.divergenceMinSessions',
      8,
      'D',
      'B5',
      ['chen-2002-borg-rpe-meta'],
      {
        unit: 'prior sessions',
        note: 'Default: z-scores need at least this many prior sessions.',
      },
    ),
  },
} satisfies ParamGroups

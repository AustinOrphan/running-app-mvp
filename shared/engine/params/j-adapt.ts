// Section (j) Adaptation, plus the red flags of section (n). Source: research/engine-rules.md.
// Task E8 may add here.
import { param, type ParamGroups } from './define.ts'

const HRV_RCT = ['kiviniemi-2007-hrv-guided-rct']
const SUBJECTIVE = ['saw-2016-subjective-vs-objective-monitoring']
const RESTART = [
  'mujika-2000-detraining-part1',
  'coyle-1984-detraining-time-course',
  'zheng-2022-detraining-vo2max',
]

export const jAdapt = {
  j1: {
    easyRunLeavesZ1Pp: param(
      'j1.easyRunLeavesZ1Pp',
      5,
      'D',
      'J1',
      ['munoz-2014-polarized-recreational'],
      {
        unit: 'percentage points',
        note: 'Default: flag easy runs that leave Z1 by more than this.',
      },
    ),
  },
  j2: {
    normalScore: param('j2.normalScore', 3, 'D', 'design-3.2', SUBJECTIVE, {
      unit: 'check-in score',
      note: 'Default: the check-in scale runs 1-5 with 3 as normal (design 3.2). Fatigue, soreness and stress are worse when higher; sleep quality and mood are worse when lower.',
    }),
    poorItemBadness: param('j2.poorItemBadness', 2, 'D', 'J2', SUBJECTIVE, {
      unit: 'points from normal',
      note: 'Default: one check-in item this far from normal in the worse direction makes the subjective score poor.',
    }),
    poorTotalBadness: param('j2.poorTotalBadness', 3, 'D', 'J2', SUBJECTIVE, {
      unit: 'points from normal, summed',
      note: 'Default: the five items together this far from normal in the worse direction make the subjective score poor.',
    }),
  },
  j3: {
    persistenceDays: param(
      'j3.persistenceDays',
      2,
      'D',
      'J3',
      ['saw-2016-subjective-vs-objective-monitoring'],
      {
        unit: 'days',
        note: 'Default: a daily readiness flag counts only when it persists this long, or when 1 flagged day comes with a poor subjective score.',
      },
    ),
    flaggedDaysWithPoorSubjective: param(
      'j3.flaggedDaysWithPoorSubjective',
      1,
      'D',
      'J3',
      ['saw-2016-subjective-vs-objective-monitoring'],
      {
        unit: 'days',
        note: 'Default: one flagged day is enough when the subjective score is poor.',
      },
    ),
  },
  j4: {
    windowDays: param('j4.windowDays', 10, 'C', 'J4', HRV_RCT, {
      unit: 'days',
      note: 'ln RMSSD against a rolling 10-day mean; the RCT protocol wins over a 7-day window.',
    }),
    sdBelowMean: param('j4.sdBelowMean', 1, 'C', 'J4', HRV_RCT, {
      unit: 'SD',
      note: 'Flag below mean minus 1 SD.',
    }),
    declineDays: param('j4.declineDays', 2, 'C', 'J4', HRV_RCT, {
      unit: 'days',
      note: 'Or flag a decline lasting 2 days.',
    }),
    minReadings: param('j4.minReadings', 10, 'C', 'J4', HRV_RCT, { unit: 'valid readings' }),
    noiseFloorGarminPolarWhoopPct: param(
      'j4.noiseFloorGarminPolarWhoopPct',
      10,
      'C',
      'J4',
      ['dial-2025-nocturnal-wearables'],
      {
        unit: '%',
        note: 'The change must also exceed the device noise floor (Garmin, Polar and Whoop class), using 7-night averages.',
      },
    ),
    noiseFloorOuraPct: param(
      'j4.noiseFloorOuraPct',
      6,
      'C',
      'J4',
      ['dial-2025-nocturnal-wearables'],
      {
        unit: '%',
        note: 'Noise floor for Oura Gen 4 class devices, using 7-night averages.',
      },
    ),
    noiseFloorWindowNights: param(
      'j4.noiseFloorWindowNights',
      7,
      'C',
      'J4',
      ['dial-2025-nocturnal-wearables'],
      {
        unit: 'nights',
      },
    ),
    lookbackDays: param('j4.lookbackDays', 21, 'D', 'J4', HRV_RCT, {
      unit: 'days',
      note: 'Default: the most recent valid readings within this many days before the date form the baseline (35 days with a menstrual-cycle baseline).',
    }),
    restingHrAboveBpm: param('j4.restingHrAboveBpm', 5, 'D', 'J4', SUBJECTIVE, {
      unit: 'bpm above the baseline mean',
      note: 'Default: resting HR this far above its rolling mean is a corroborating flag. No study in the corpus sets a threshold; it never acts without a persistent or subjective signal (J2, J3).',
    }),
    cycleBaselineDays: param(
      'j4.cycleBaselineDays',
      35,
      'D',
      'J4',
      ['dejager-2026-wearable-hrv-menstrual'],
      {
        unit: 'days',
        note: 'Default: for users with menstrual cycles the baseline is about 35 days.',
      },
    ),
    cycleBandWidenPp: param(
      'j4.cycleBandWidenPp',
      9,
      'B',
      'J4',
      ['dejager-2026-wearable-hrv-menstrual'],
      {
        unit: 'percentage points',
        note: 'Widen the band by this much for users with menstrual cycles (grade B/D as stated; the window is the default part).',
      },
    ),
  },
  j5: {
    completionHoldShare: param('j5.completionHoldShare', 0.8, 'D', 'J5', [], {
      unit: 'fraction of planned minutes',
      note: 'Default: completing less than 80% of planned minutes holds the volume and trims the next hard session.',
    }),
    sleepWarnHours: param(
      'j5.sleepWarnHours',
      7,
      'C',
      'J5',
      ['walsh-2021-sleep-athlete-consensus'],
      {
        unit: 'h',
        note: 'Sleep warning: 7-night average under 7 h or under the stated need.',
      },
    ),
    sleepWarnNights: param(
      'j5.sleepWarnNights',
      7,
      'C',
      'J5',
      ['walsh-2021-sleep-athlete-consensus'],
      {
        unit: 'nights',
      },
    ),
    redsHoldFlags: param('j5.redsHoldFlags', 2, 'D', 'J5', ['mountjoy-2023-reds-consensus'], {
      unit: 'flags',
      note: 'Default: 2 or more REDs flags hold progression and show a clinician prompt.',
    }),
    sleepMinNights: param(
      'j5.sleepMinNights',
      4,
      'D',
      'J5',
      ['walsh-2021-sleep-athlete-consensus'],
      {
        unit: 'nights',
        note: 'Default: a sleep average needs at least this many recorded nights in the 7.',
      },
    ),
    efficiencyDeclinePct: param(
      'j5.efficiencyDeclinePct',
      2,
      'D',
      'J5',
      ['roete-2021-functional-overreaching-markers'],
      {
        unit: '% trend',
        note: 'Default: an efficiency-index trend this far below zero counts as an efficiency decline.',
      },
    ),
    subjectivePoorDays: param('j5.subjectivePoorDays', 4, 'D', 'J5', SUBJECTIVE, {
      unit: 'days in the week',
      note: 'Default: this many days with a poor subjective score in one week count as a subjective decline.',
    }),
    harderEffortSessions: param('j5.harderEffortSessions', 2, 'D', 'J5', SUBJECTIVE, {
      unit: 'sessions in the week',
      note: 'Default: this many sessions in a week with an effort score of +1 or more count as a subjective decline (design 4.3); only scores that rest on an RPE or feel rating count.',
    }),
    harderEffortScore: param('j5.harderEffortScore', 1, 'D', 'J5', SUBJECTIVE, {
      unit: 'effort score',
      note: 'Default: the effort score that counts as harder than expected.',
    }),
    reviewFatigueDecline: param('j5.reviewFatigueDecline', 6, 'D', 'J5', SUBJECTIVE, {
      unit: '0-10 review fatigue',
      note: 'Default: a weekly-review fatigue rating at or above this, or persistent symptoms, counts toward a subjective decline (same cut as the version 1 review).',
    }),
    reduceSignals: param(
      'j5.reduceSignals',
      2,
      'B',
      'J5',
      ['roete-2021-functional-overreaching-markers', 'murphy-2024-overreaching-sleep'],
      {
        unit: 'independent signals',
        note: 'Grade B, low confidence: two independent signals persisting insert a recovery week.',
      },
    ),
    reducePersistDays: param(
      'j5.reducePersistDays',
      7,
      'B',
      'J5',
      ['roete-2021-functional-overreaching-markers', 'murphy-2024-overreaching-sleep'],
      {
        unit: 'days',
        note: 'About 7 days; grade B, low confidence.',
      },
    ),
    sleepEfficiencyDropPp: param(
      'j5.sleepEfficiencyDropPp',
      2,
      'B',
      'J5',
      ['murphy-2024-overreaching-sleep'],
      {
        unit: 'percentage points',
        note: 'A sleep-efficiency drop of about 2 pp counts as one signal.',
      },
    ),
  },
  j6: {
    mastersAgeYears: param(
      'j6.mastersAgeYears',
      40,
      'D',
      'J6',
      ['borges-2018-masters-hiit-recovery'],
      {
        unit: 'years',
        note: 'Default: the masters recovery gate applies from this age.',
      },
    ),
    medianDays: param('j6.medianDays', 28, 'D', 'J6', ['borges-2018-masters-hiit-recovery'], {
      unit: 'days',
      note: 'Default: the own median of each check-in item is taken over this many days; at least 7 check-ins are needed.',
    }),
    medianMinCheckins: param(
      'j6.medianMinCheckins',
      7,
      'D',
      'J6',
      ['borges-2018-masters-hiit-recovery'],
      {
        unit: 'check-ins',
        note: 'Default: fewer check-ins than this give no own median, so the gate stays off.',
      },
    ),
    recoveryHours: param('j6.recoveryHours', 48, 'D', 'J6', ['borges-2018-masters-hiit-recovery'], {
      unit: 'h',
      note: 'Default: soreness, fatigue or motivation still worse than the own median this long after a hard session defers or converts the next quality session.',
    }),
    recoveryMultiplier: param(
      'j6.recoveryMultiplier',
      1.0,
      'D',
      'J6',
      ['borges-2018-masters-hiit-recovery'],
      {
        range: [1.0, 1.25],
        note: 'Default: 1.0, rising to at most 1.25 only from the athlete own data (grade C/D).',
      },
    ),
  },
  j7: {
    tier1Days: param('j7.tier1Days', 7, 'D', 'J7', RESTART, {
      unit: 'days',
      note: 'Default: under this many days, restart at 100%.',
    }),
    tier2Days: param('j7.tier2Days', 14, 'D', 'J7', RESTART, {
      unit: 'days',
      note: 'Default: 7-14 days restart at 90%.',
    }),
    tier3Days: param('j7.tier3Days', 28, 'D', 'J7', RESTART, {
      unit: 'days',
      note: 'Default: 15-28 days restart at 75%; over this restart at 50-60%.',
    }),
    restartUnder7: param('j7.restartUnder7', 1.0, 'D', 'J7', RESTART, {
      unit: 'fraction of pre-break week',
      note: 'Default: layoff under 7 days.',
    }),
    restart7to14: param('j7.restart7to14', 0.9, 'D', 'J7', RESTART, {
      unit: 'fraction of pre-break week',
      note: 'Default: layoff of 7-14 days; halving is not justified at this length (VO2max falls about 7% by 21 days).',
    }),
    restart15to28: param('j7.restart15to28', 0.75, 'D', 'J7', RESTART, {
      unit: 'fraction of pre-break week',
      note: 'Default: layoff of 15-28 days.',
    }),
    restartOver28: param('j7.restartOver28', 0.5, 'D', 'J7', RESTART, {
      unit: 'fraction of pre-break week',
      range: [0.5, 0.6],
      note: 'Default: layoff over 28 days, 50-60%; the lower end is the default.',
    }),
    runWalkIfConsistentUnderMonths: param(
      'j7.runWalkIfConsistentUnderMonths',
      6,
      'D',
      'J7',
      RESTART,
      {
        unit: 'months',
        note: 'Default: after a layoff over 28 days use run-walk if the athlete had under this many months of consistent running before the break.',
      },
    ),
    vo2maxFallDay21Pct: param(
      'j7.vo2maxFallDay21Pct',
      7,
      'C',
      'J7',
      ['coyle-1984-detraining-time-course', 'zheng-2022-detraining-vo2max'],
      {
        unit: '%',
        note: 'Detraining is modelled as saturating: 7% by day 21.',
      },
    ),
    vo2maxFallDay56Pct: param(
      'j7.vo2maxFallDay56Pct',
      16,
      'C',
      'J7',
      ['coyle-1984-detraining-time-course', 'zheng-2022-detraining-vo2max'],
      {
        unit: '%',
        note: '16% by day 56.',
      },
    ),
    detrainingCapPct: param(
      'j7.detrainingCapPct',
      20,
      'C',
      'J7',
      ['coyle-1984-detraining-time-course', 'zheng-2022-detraining-vo2max'],
      {
        unit: '%',
        range: [15, 20],
        note: 'Capped at 15-20%; the upper end is the value.',
      },
    ),
    gapProjectionWidenPct: param<[number, number]>(
      'j7.gapProjectionWidenPct',
      [5, 8],
      'B',
      'J7',
      ['feely-2022-training-disruptions'],
      {
        unit: '%',
        note: 'A gap of 7 days or more in the 16 weeks before a race widens and slows the projection by this much.',
      },
    ),
    maintenanceRunsPerWeek: param(
      'j7.maintenanceRunsPerWeek',
      2,
      'C',
      'J7',
      ['spiering-2021-minimal-dose', 'hickson-1981-reduced-frequency'],
      {
        unit: 'runs per week',
      },
    ),
    maintenanceVolumeCutPct: param<[number, number]>(
      'j7.maintenanceVolumeCutPct',
      [33, 66],
      'C',
      'J7',
      ['spiering-2021-minimal-dose', 'hickson-1981-reduced-frequency'],
      {
        unit: '%',
        note: 'Intensity is kept.',
      },
    ),
    maintenanceMaxWeeks: param(
      'j7.maintenanceMaxWeeks',
      15,
      'C',
      'J7',
      ['spiering-2021-minimal-dose', 'hickson-1981-reduced-frequency'],
      {
        unit: 'weeks',
      },
    ),
  },
  j8: {
    deloadSuggestDays: param(
      'j8.deloadSuggestDays',
      14,
      'D',
      'J8',
      ['meeusen-2013-overtraining-consensus', 'weakley-2022-ots-systematic-review'],
      {
        unit: 'days',
        note: 'Default: at this many days of unexplained decline suggest a deload and show a clinician checklist (energy intake, iron, illness, sleep).',
      },
    ),
    medicalReviewDays: param(
      'j8.medicalReviewDays',
      28,
      'D',
      'J8',
      ['meeusen-2013-overtraining-consensus', 'weakley-2022-ots-systematic-review'],
      {
        unit: 'days',
        note: 'Default: at this many days show a stronger medical-review prompt. OTS and NFOR are never diagnosed.',
      },
    ),
    maxDataGapDays: param(
      'j8.maxDataGapDays',
      2,
      'D',
      'J8',
      ['meeusen-2013-overtraining-consensus', 'weakley-2022-ots-systematic-review'],
      {
        unit: 'days',
        note: 'Default: a run of unexplained decline bridges at most this many consecutive days without check-in, HRV or resting HR data; a longer gap ends it.',
      },
    ),
  },
  n1: {
    bsiReturnDays: param<number[]>(
      'n1.bsiReturnDays',
      [44, 56, 107, 127],
      'A',
      'n-1',
      ['hoenig-2023-bsi-return-to-sport'],
      {
        unit: 'days',
        note: 'Earliest return to sport by site, in the order given in the rules table; high-risk sites need a clinician-entered date before running is generated.',
      },
    ),
  },
  n3: {
    illnessSymptomFreeDays: param(
      'n3.illnessSymptomFreeDays',
      1,
      'D',
      'n-3',
      ['snyders-2022-respiratory-illness-rts', 'schwellnus-2016-load-illness-ioc'],
      {
        unit: 'days',
        note: 'Default: 1 symptom-free day before easy running resumes. Illness is never inferred from HRV or resting HR alone.',
      },
    ),
    illnessEasyDaysBeforeIntensity: param(
      'n3.illnessEasyDaysBeforeIntensity',
      3,
      'D',
      'n-3',
      ['snyders-2022-respiratory-illness-rts', 'schwellnus-2016-load-illness-ioc'],
      {
        unit: 'days',
        note: 'Default: 3 easy days before any intensity.',
      },
    ),
  },
  n4: {
    rescreenWeeks: param(
      'n4.rescreenWeeks',
      12,
      'C',
      'n-4',
      ['mountjoy-2023-reds-consensus', 'melin-2014-leaf-q'],
      {
        unit: 'weeks',
        note: 'REDs screen at onboarding and this often.',
      },
    ),
  },
  n5: {
    ironFatigueWeeks: param(
      'n5.ironFatigueWeeks',
      2,
      'D',
      'n-5',
      ['sim-2019-iron-athlete', 'burden-2015-iron-treatment-meta'],
      {
        unit: 'weeks',
        note: 'Default: fatigue or underperformance for this long at stable load suggests blood testing through a clinician; no supplement advice.',
      },
    ),
  },
  n7: {
    eahStrongerAlertHours: param(
      'n7.eahStrongerAlertHours',
      17,
      'A',
      'n-7',
      ['hewbutler-2017-eah-update'],
      {
        unit: 'h',
        note: 'Show a stronger EAH alert for events over this duration or in heat.',
      },
    ),
  },
  zoneProposal: {
    windowDays: param(
      'zoneProposal.windowDays',
      56,
      'D',
      'C8',
      ['hecksteden-2015-individual-response'],
      {
        unit: 'days',
        note: 'Default: threshold and interval sessions this recent count as observations.',
      },
    ),
    paceStepPct: param(
      'zoneProposal.paceStepPct',
      2,
      'D',
      'C8',
      ['hecksteden-2015-individual-response'],
      {
        unit: '% of pace',
        note: 'Default: a proposed threshold-pace change moves the pace by this much; the owner confirms or declines.',
      },
    ),
  },
} satisfies ParamGroups

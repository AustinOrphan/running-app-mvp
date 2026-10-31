// Section (p) Methods (presets). Source: research/engine-rules.md, rules P1 to P4, and the methods
// proposal (docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md), sections 4.3
// to 4.5. A method preset is a named choice among four structural values; it overrides no guard, no
// ceiling and no option. Each numeric override is a grade D Param below, and `PRESET_OVERRIDES` is
// the one static record of what each preset overrides. `methods.ts` reads it; nothing else does.
//
// Every preset is a choice and not a better plan: no study compares the plans these methods
// describe. P1 (the default) has no Param, P3 (a shorter long run) is not offered and has none.
import type { Param, PresetId } from '../types.ts'
import { param, type ParamGroups } from './define.ts'

export const pMethods = {
  p2: {
    runDays: param(
      'p2.runDays',
      3,
      'D',
      'P2',
      [
        'furman-2023-first-three-quality-runs',
        'lydiardfoundation-2026-lydiard-principles',
        'pollock-1977-frequency-duration-injury',
        'kluitenberg-2016-nlstart2run-training-factors',
        'yamaguchi-2023-volume-frequency-run-distance',
        'festa-2019-polarized-vs-focused-recreational',
        'doherty-2020-marathon-training-meta',
      ],
      {
        range: [3, 6],
        unit: 'days per week',
        note: 'Default: the three-run-days preset caps the run days of a week at 3 for goals from 5 km to the half marathon; the default cap (`f5.mastersMaxRunDays`) is 6, and a preset may lower it to 3 and never raises it. A choice, not a better plan: no study holds volume equal and varies the run days in recreational runners over these distances, so the figure is extrapolated from direction (grade C) and from published three-day programmes (practice, grade D).',
      },
    ),
  },
  p4: {
    buildWeeks: param(
      'p4.buildWeeks',
      4,
      'D',
      'P4',
      [
        'lydiardfoundation-2026-lydiard-principles',
        'casado-2023-lactate-guided-threshold',
        'gonzalezrave-2022-reverse-periodization',
        'casado-2022-elite-runners-review',
        'filipas-2022-pyr-pol-periodization',
        'seiler-2010-best-practice-tid',
        'boullosa-2020-recreational-runners-review',
      ],
      {
        range: [4, 6],
        unit: 'weeks',
        note: 'Default: the longer-base preset ends the build phase after at most 4 weeks, where the default is 6 (`macroDesign.buildWeeks`), so base takes up to 2 weeks more of the weeks before the specific phase; a preset may shorten it to 4 and never lengthens it. A choice, not a better plan: nothing read shows a longer base to be better (reverse periodization is no more effective than traditional), so the figure follows the order of Lydiard as practice (grade D).',
      },
    ),
  },
} satisfies ParamGroups

/**
 * The Param ids a preset may override [methods proposal, section 4.4]. A rule outside this list is
 * never overridable: the limits of section (g), the class ceilings, the load setting, the E6 start
 * paths, the holds of section (n), the taper and the checklist. `methods.test.ts` asserts that the
 * record below holds no other key.
 */
export const NUMERIC_OVERRIDE_IDS = [
  'f5.mastersMaxRunDays',
  'macroDesign.longRunShareOfWeek',
  'macroDesign.buildWeeks',
] as const

/** The four overridable values: the three above and the table of quality kinds by phase. */
export const OVERRIDE_IDS = [...NUMERIC_OVERRIDE_IDS, 'qualityByPhase'] as const

export type NumericOverrideId = (typeof NUMERIC_OVERRIDE_IDS)[number]
export type OverrideId = (typeof OVERRIDE_IDS)[number]

/**
 * What one preset overrides. A numeric override is a grade D Param. `qualityByPhase` says that the
 * preset has its own row in the table of quality kinds (`QUALITY_BY_PRESET`, micro.ts), which holds
 * kinds and not numbers and so is not a Param.
 */
export type PresetOverrides = {
  readonly [K in NumericOverrideId]?: Param<number>
} & { readonly qualityByPhase?: true }

/**
 * The static record of overrides, keyed by preset. `default` overrides nothing. P3 (a shorter long
 * run, `macroDesign.longRunShareOfWeek` 0.30) is not offered, so no preset lowers that share; the
 * id stays in the type so that the readers of the share go through the resolver.
 */
export const PRESET_OVERRIDES: Readonly<Record<PresetId, PresetOverrides>> = {
  default: {},
  'three-run-days': { 'f5.mastersMaxRunDays': pMethods.p2.runDays },
  'longer-base': { 'macroDesign.buildWeeks': pMethods.p4.buildWeeks, qualityByPhase: true },
}

// The parameter registry: every number the engine uses, with its grade, rule and evidence.
// `P.<group>.<name>` is the `Param` whose id is `<group>.<name>`; a group is named after its rule
// ('g1' is rule g-1, 'h4' is H4, 'expectedRpe' holds one value per session kind).
import type { Param } from '../types.ts'
import { aState } from './a-state.ts'
import { bLoad } from './b-load.ts'
import { cZones } from './c-zones.ts'
import { dGoal } from './d-goal.ts'
import { eMacro } from './e-macro.ts'
import { fMicro } from './f-micro.ts'
import { gLimits } from './g-limits.ts'
import { hUltra } from './h-ultra.ts'
import { iEnv } from './i-env.ts'
import { jAdapt } from './j-adapt.ts'
import { kTaper } from './k-taper.ts'
import { lPredict } from './l-predict.ts'
import { mExecution } from './m-execution.ts'
import { nChecklist } from './n-checklist.ts'
import { oDelivery } from './o-delivery.ts'

/** Bump when any parameter value, grade or rule changes; stored with every generated plan. */
export const PARAMS_VERSION = '2026-10-23.1'

/** The section files in order; a task adds parameters only to its own file(s). */
export const PARAM_SECTIONS = {
  'a-state': aState,
  'b-load': bLoad,
  'c-zones': cZones,
  'd-goal': dGoal,
  'e-macro': eMacro,
  'f-micro': fMicro,
  'g-limits': gLimits,
  'h-ultra': hUltra,
  'i-env': iEnv,
  'j-adapt': jAdapt,
  'k-taper': kTaper,
  'l-predict': lPredict,
  'm-execution': mExecution,
  'n-checklist': nChecklist,
  'o-delivery': oDelivery,
} as const

export const P = {
  ...aState,
  ...bLoad,
  ...cZones,
  ...dGoal,
  ...eMacro,
  ...fMicro,
  ...gLimits,
  ...hUltra,
  ...iEnv,
  ...jAdapt,
  ...kTaper,
  ...lPredict,
  ...mExecution,
  ...nChecklist,
  ...oDelivery,
} as const

/** Every parameter of one section, in declaration order. */
export function sectionParams(section: keyof typeof PARAM_SECTIONS): Array<Param<unknown>> {
  return Object.values(PARAM_SECTIONS[section]).flatMap((group) =>
    Object.values(group as Record<string, Param<unknown>>),
  )
}

/** Every parameter in the registry. */
export function allParams(): Array<Param<unknown>> {
  return (Object.keys(PARAM_SECTIONS) as Array<keyof typeof PARAM_SECTIONS>).flatMap(sectionParams)
}

/**
 * The parameters that belong to a rule id, matched case-insensitively but not ignoring hyphens:
 * `g-3` (tightened profiles) and `G3` (priors, not optima) are different rules.
 */
export function paramsForRule(rule: string): Array<Param<unknown>> {
  const key = rule.toLowerCase()
  return allParams().filter((p) => p.rule.toLowerCase() === key)
}

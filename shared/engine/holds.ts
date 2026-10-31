// The persistent conditions of a runner that hold the load setting at steady [rule g-8] and a
// method preset at the default [rules P1 to P4]. Pure: the same input and state give the same
// answer. It imports no macro, post-race or load-setting code, so `loadSetting.ts` and `methods.ts`
// both read it, and neither imports the other.
import { injuryTight } from './limits.ts'
import { P } from './params/index.ts'
import { focalBoneActive } from './readiness.ts'
import type { AthleteState, EngineInput } from './types.ts'

/**
 * Why a plan is held while a condition of the runner lasts: a recent injury, an earlier bone stress
 * injury, two BSI factors, a RED-S hold or focal bone pain. The transient holds of the load setting
 * (a rest window, the window of a past race) open and close between weekly re-plans and are not
 * here: a preset following them would switch run days in the middle of a plan.
 */
export type PersistentHold =
  'recent-injury' | 'bone-stress' | 'bsi-factors' | 'reds-hold' | 'bone-pain'

/** The first persistent hold that applies to this runner today, or null. The order is the load setting's. */
export function persistentHoldOf(input: EngineInput, state: AthleteState): PersistentHold | null {
  if (injuryTight(state)) return 'recent-injury'
  if (state.risk.priorBsi) return 'bone-stress'
  if (state.risk.bsiFactors >= P.g3.bsiFactorsForCap.value) return 'bsi-factors'
  if (state.risk.redsFlags >= P.j5.redsHoldFlags.value) return 'reds-hold'
  if (focalBoneActive(input, input.today)) return 'bone-pain'
  return null
}

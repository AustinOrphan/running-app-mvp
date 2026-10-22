// Stub from the training-engine scaffold; Task E9 implements it.
import type { Param } from './types.ts'

/** Resolves rule ids to their parameters and the papers behind them. */
export function explain(
  _rules: string[],
): Array<{ rule: string; params: Array<Param<unknown>>; papers: string[] }> {
  throw new Error('Task E9: explain is not implemented')
}

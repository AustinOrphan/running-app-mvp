import type { StateInputs, StateView } from '../../shared/types.ts'

/** What the advice reads in the usual case: a year of activities and two months of wellness. */
export function makeInputs(over: Partial<StateInputs> = {}): StateInputs {
  return {
    activities: {
      windowDays: 365,
      count: 214,
      latest: '2026-10-21',
      flaggedDuplicates: 0,
      ...over.activities,
    },
    wellness: { windowDays: 60, count: 41, latest: '2026-10-22', ...over.wellness },
    reviews: { windowWeeks: 16, count: 12, ...over.reviews },
  }
}

/**
 * A state view for screens that read `inputs` only. The engine parts (state, zones, readiness)
 * are left empty: a page test that needs them builds them itself.
 */
export function makeStateView(inputs: StateInputs = makeInputs()): StateView {
  return {
    version: 'test.0.1',
    asOf: '2026-10-22',
    builtAt: '2026-10-22T08:00:00.000Z',
    paramsVersion: 'test',
    state: {} as StateView['state'],
    zones: {} as StateView['zones'],
    readiness: {} as StateView['readiness'],
    goal: null,
    plan: null,
    prediction: null,
    inputs,
  }
}

// The words of the "Reviewed weeks" list: for each finished week, the action the weekly decision
// suggested and the signals behind it, beside the runner's own decision (WH1, owner decision
// 2026-11-17). Nothing here counts weeks, compares them or grades a decision: an override is the
// runner's call, and the list states what each week held without a total.

/** The suggested action as the list names it. */
export const SUGGESTED_ACTION_LABEL = {
  progress: 'Progress',
  hold: 'Hold',
  reduce: 'Reduce',
} as const

export type ListedAction = keyof typeof SUGGESTED_ACTION_LABEL

export function isListedAction(value: string | null): value is ListedAction {
  return value !== null && Object.hasOwn(SUGGESTED_ACTION_LABEL, value)
}

/** The labels around the two values of a row. */
export const REVIEWED_ROW = {
  suggested: 'Suggested',
  decided: 'Decided',
  signals: 'Signals for the suggestion',
  noDecision: 'none yet',
} as const

/**
 * One short label for each signal code of the weekly decision (`shared/engine/adapt.ts`). The
 * wording describes the signal and never the runner; a test fails on a code with no label.
 */
export const SIGNAL_LABEL: Readonly<Record<string, string>> = {
  'completion-low': 'Fewer of the planned minutes run',
  'sleep-warning': 'Short sleep',
  reds: 'Energy-availability screen',
  heat: 'First hot days coming',
  'subjective-decline': 'Effort, fatigue or check-ins',
  'efficiency-decline': 'Pace at a given heart rate slower',
  'sleep-efficiency-drop': 'Sleep efficiency lower',
  illness: 'Illness reported',
  pain: 'Pain reported',
  'pain-mild': 'Mild pain reported',
  'persistent-suppression': 'Readiness lower than usual',
  'readiness-flag': 'Readiness flag',
  'hrv-suppressed': 'HRV lower than usual',
  disruption: 'Rest window',
  'post-race-stage': 'After a race',
  'post-race-delayed': 'After a race, return delayed',
  'break-recovery': 'Short week counted as recovery',
}

/** The labels of a week's signals, in the engine's order; a code with no label is left out. */
export function signalLabels(signals: ReadonlyArray<{ code: string }>): string[] {
  return signals.flatMap((signal) => {
    const label = SIGNAL_LABEL[signal.code]
    return label === undefined ? [] : [label]
  })
}

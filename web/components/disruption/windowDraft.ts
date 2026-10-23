import { describeIssue, describeWindow } from '../../../shared/copy/revision.ts'
import { addDays } from '../../../shared/dates.ts'
import {
  disruptionPlan,
  validateDisruption,
  type DisruptionField,
} from '../../../shared/engine/disruption.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { DisruptionWindow } from '../../../shared/engine/types.ts'
import type {
  DisruptionInput,
  DisruptionMode,
  DisruptionReason,
  DisruptionView,
  Units,
} from '../../../shared/types.ts'

/** The five reasons of step 1, in order, with the words of the sheet. */
export const REASON_CHOICES: ReadonlyArray<{
  value: DisruptionReason
  label: string
  hint?: string
}> = [
  {
    value: 'illness-above-neck',
    label: 'Ill, above the neck',
    hint: 'Cold, sore throat, blocked nose.',
  },
  {
    value: 'illness-below-neck',
    label: 'Ill, below the neck',
    hint: 'Chest, fever, aches, stomach.',
  },
  { value: 'niggle', label: 'A niggle or pain' },
  { value: 'short-on-time', label: 'Short on time' },
  { value: 'travel', label: 'Travelling' },
]

export function isIllness(reason: DisruptionReason): boolean {
  return reason === 'illness-above-neck' || reason === 'illness-below-neck'
}

/**
 * The longest runs offered for a window that allows short easy runs: the shortest run worth
 * scheduling (from the Params), then 30, 45 and 60 minutes. The server accepts any whole number up
 * to `RUN_CAP_MAX_MIN`; these are the quick choices.
 */
export const RUN_CAP_CHOICES: readonly number[] = [P.fplace.easyRunMinMin.value, 30, 45, 60]

/** What the runner has entered. An empty date means the default: the day the sheet opened. */
export interface WindowDraft {
  reason: DisruptionReason | null
  startDate: string
  endDate: string
  /** Null until chosen; the reason's default applies (illness is always rest). */
  mode: DisruptionMode | null
  maxRunMin: number
  area: string
  pain: number | null
  gaitChange: boolean
}

export const EMPTY_DRAFT: WindowDraft = {
  reason: null,
  startDate: '',
  endDate: '',
  mode: null,
  maxRunMin: 30,
  area: '',
  pain: null,
  gaitChange: false,
}

/** Illness rests; a niggle rests unless short runs are chosen; availability windows allow short runs. */
export function modeOf(draft: WindowDraft): DisruptionMode {
  const { reason } = draft
  if (reason === null || isIllness(reason)) return 'rest'
  return draft.mode ?? (reason === 'niggle' ? 'rest' : 'limited')
}

/** The first and last day of the window as entered, with the defaults filled in. */
export function datesOf(draft: WindowDraft, today: string): { from: string; until: string } {
  const from = draft.startDate === '' ? today : draft.startDate
  const until = draft.endDate === '' ? from : draft.endDate
  return { from, until }
}

/**
 * The earliest and latest day each date field offers, from the Params: a start up to
 * `j9.maxBackdateDays` back, a last day within `j9.maxWindowDays` of the start and no later than
 * the race.
 */
export function dateBounds(
  from: string,
  today: string,
  raceDate: string | null,
): { startMin: string; endMin: string; endMax: string } {
  const longest = addDays(from, P.j9.maxWindowDays.value - 1)
  return {
    startMin: addDays(today, -P.j9.maxBackdateDays.value),
    endMin: from,
    endMax: raceDate !== null && raceDate < longest ? raceDate : longest,
  }
}

/** The window as the server takes it: only the fields the reason and the mode use. */
export function inputOf(draft: WindowDraft, today: string): DisruptionInput | null {
  if (draft.reason === null) return null
  const { from, until } = datesOf(draft, today)
  const mode = modeOf(draft)
  const niggle = draft.reason === 'niggle'
  const area = draft.area.trim()
  return {
    reason: draft.reason,
    mode,
    startDate: from,
    endDate: until,
    ...(mode === 'limited' ? { maxRunMin: draft.maxRunMin } : {}),
    ...(niggle && area !== '' ? { area } : {}),
    ...(niggle && draft.pain !== null ? { pain: draft.pain } : {}),
    ...(niggle && draft.gaitChange ? { gaitChange: true } : {}),
  }
}

/**
 * What is wrong with the window before it is sent, one sentence for each field that needs it, from
 * the same rules the server applies (`validateDisruption`) and in the same words.
 */
export function draftErrors(
  input: DisruptionInput,
  context: { today: string; raceDate: string | null; units: Units },
): Partial<Record<DisruptionField, string>> {
  const errors: Partial<Record<DisruptionField, string>> = {}
  for (const issue of validateDisruption(input, {
    today: context.today,
    goalDate: context.raceDate,
  })) {
    errors[issue.field] ??= describeIssue(issue, context.units)
  }
  return errors
}

/** A stored window as the engine reads it. */
export function engineWindowOf(window: DisruptionView): DisruptionWindow {
  return {
    id: window.id,
    reason: window.reason,
    mode: window.mode,
    startDate: window.startDate,
    endDate: window.endDate,
    maxRunMin: window.maxRunMin,
    pain: window.pain,
    gaitChange: window.gaitChange,
  }
}

const NEW_WINDOW_ID = '~new'

/**
 * What a window does to the days around it, in order ("Rest from Wed 22 Oct to Fri 24 Oct. Easy
 * running only from ... Back to the planned week on ..."), from the same module the engine plans
 * with. The runner's other active windows are read with it, because windows that touch are one
 * layoff.
 */
export function windowSentences(
  input: DisruptionInput,
  others: readonly DisruptionView[],
  units: Units,
): string[] {
  const mine: DisruptionWindow = {
    id: NEW_WINDOW_ID,
    reason: input.reason,
    mode: input.mode,
    startDate: input.startDate,
    endDate: input.endDate,
    maxRunMin: input.maxRunMin ?? null,
    pain: input.pain ?? null,
    gaitChange: input.gaitChange === true,
  }
  const plan = disruptionPlan([
    ...others.filter((window) => window.status === 'active').map(engineWindowOf),
    mine,
  ])
  const planned = plan.windows.find((window) => window.id === NEW_WINDOW_ID)
  return planned === undefined ? [] : describeWindow(planned, units)
}

// What the Strength page and the Review page say about the weekly count of strength sessions
// (strength design 12.4): when they ask whether to plan fewer, and when more were logged than the
// plan asks for. The server counts the finished weeks with fewer sessions logged than planned
// (`f9.countPromptWeeks`, in `summariseHistory`) and sends the verdict as `countPrompt`; this module
// adds what only the page knows: what the plan asks for now, what the Profile says, and whether the
// runner chose "Not now" lately. Days are the server's (`asOf`), never the phone's.
import { addDays, mondayOf } from '../../../shared/dates.ts'
import type { StrengthView } from '../../../shared/types.ts'

/** The count the question offers, and so the Profile's strength choice the button saves. */
export const COUNT_PROMPT_FEWER = 1

/**
 * How long "Not now" keeps the question away: four weeks (design 12.4; the owner accepted the
 * default on 2026-10-24, question 16). It is a convenience of this browser and not a Param, because
 * no rule of the engine reads it.
 */
export const COUNT_QUIET_WEEKS = 4

/**
 * The count of strength sessions a week the plan asks for now: that of the latest week in the view
 * that has sessions planned (the current week when it has some, else the last finished one). Null
 * when no week in the view has a session planned.
 */
export function plannedPerWeek(view: StrengthView): number | null {
  for (let i = view.weeks.length - 1; i >= 0; i -= 1) {
    const week = view.weeks[i]
    if (week !== undefined && week.planned > 0) return week.planned
  }
  return null
}

/**
 * Whether "Not now" on `notNowOn` still holds on the server's day `asOf`: the question returns
 * `COUNT_QUIET_WEEKS` weeks after the day it was put off. A day in the future (a clock that moved
 * back) does not hold, so a wrong date cannot silence the question for long.
 */
export function isQuiet(asOf: string, notNowOn: string | null): boolean {
  return notNowOn !== null && notNowOn <= asOf && addDays(notNowOn, 7 * COUNT_QUIET_WEEKS) > asOf
}

/**
 * The count to name in the question ("Two a week is the plan"), or null when the question is not
 * asked: the server does not call for it, the plan or the Profile already asks for one a week or
 * none, or "Not now" still holds. The plan's count and the Profile's choice are both read, because
 * a saved choice shows at once in the Profile and in the plan only at the next weekly update.
 */
export function countToAsk(
  view: StrengthView,
  strengthPreference: number,
  notNowOn: string | null,
): number | null {
  if (!view.countPrompt) return null
  const planned = plannedPerWeek(view)
  if (planned === null || planned <= COUNT_PROMPT_FEWER) return null
  if (strengthPreference <= COUNT_PROMPT_FEWER) return null
  if (isQuiet(view.asOf, notNowOn)) return null
  return planned
}

/**
 * The latest of the current week and the one before it in which more sessions were logged than the
 * plan asked for, or null. An older week no longer says anything about now, and a week with no
 * session planned has no count to be over.
 */
export function overPlannedWeek(view: StrengthView): StrengthView['weeks'][number] | null {
  const since = addDays(mondayOf(view.asOf), -7)
  for (let i = view.weeks.length - 1; i >= 0; i -= 1) {
    const week = view.weeks[i]
    if (week === undefined || week.weekStart < since) break
    if (week.planned > 0 && week.logged > week.planned) return week
  }
  return null
}

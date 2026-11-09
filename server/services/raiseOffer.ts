// The offer to raise the plan to match recent weeks [rule E7]. The condition is `raiseToMatchCheck`
// (shared/engine/raise.ts); the figures are those of a re-plan decided with the raise and not
// written (`computeReplan`), so the offer shows exactly what a yes would write. The runner's answer
// is kept on the finished week's review row, so it holds across devices.
import { addDays, mondayOf } from '../../shared/dates.ts'
import type { RaiseOffer } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { HttpError, validationError } from '../errors.ts'
import { computeReplan } from './replan.ts'

export type RaiseAnswer = 'declined' | 'raised'

/** The finished week an offer made today belongs to: the week before the current one. */
export const raiseWeekOf = (today: string): string => addDays(mondayOf(today), -7)

/**
 * The offer for today, or null: no active re-plannable plan, the condition does not hold, the raise
 * lifts no week, or the runner already answered for the same weeks.
 */
export async function loadRaiseOffer(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<RaiseOffer | null> {
  const { userId, today } = args
  const weekStart = raiseWeekOf(today)
  const answered = await deps.prisma.weeklyReview.findUnique({
    where: { userId_weekStart: { userId, weekStart } },
    select: { raiseAnswer: true },
  })
  if (answered?.raiseAnswer != null) return null
  try {
    const result = await computeReplan(deps, {
      userId,
      reason: 'raise-to-match',
      today,
      raise: true,
    })
    const raise = result.raise
    if (raise === null || !raise.check.met || raise.rise === null) return null
    return {
      weekStart,
      fromWeek: raise.rise.weekStart,
      currentMin: raise.rise.fromMin,
      raisedMin: raise.rise.toMin,
    }
  } catch (error) {
    // No plan, a version-1 plan or a goal date in the past: there is nothing to offer.
    if (error instanceof HttpError) return null
    throw error
  }
}

/** Remembers the runner's answer for the finished week; the same answer again changes nothing. */
export async function saveRaiseAnswer(
  deps: Deps,
  args: { userId: string; weekStart: string; answer: RaiseAnswer; today: string },
): Promise<void> {
  const { userId, weekStart, answer, today } = args
  if (weekStart !== raiseWeekOf(today)) {
    throw validationError('The offer belongs to the last finished week.', [
      { path: 'weekStart', message: 'Not the last finished week.' },
    ])
  }
  await deps.prisma.weeklyReview.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: { userId, weekStart, raiseAnswer: answer },
    update: { raiseAnswer: answer },
  })
}

// The offer to raise the plan to match recent weeks [rule E7]. The condition is `raiseToMatchCheck`
// (shared/engine/raise.ts); the figures are those of a re-plan decided with the raise and not
// written (`computeReplan`), so the offer shows exactly what a yes would write, and only a draft that
// passes the quality checklist is offered. The runner's answer is kept on the finished week's review
// row, so it holds across devices, and it silences the offer for the whole look-back window.
import { addDays, mondayOf } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { RaiseOffer } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { conflict, HttpError, validationError } from '../errors.ts'
import { createLogger } from '../logger.ts'
import { memoByVersion } from './athleteState.ts'
import { failedChecklist } from './planEngine.ts'
import { computeReplan } from './replan.ts'
import { forecastStamp } from './weatherCache.ts'

export type RaiseAnswer = 'declined' | 'raised'

/** The finished week an offer made today belongs to: the week before the current one. */
export const raiseWeekOf = (today: string): string => addDays(mondayOf(today), -7)

/** The first Monday whose answer still silences the offer: the look-back window, ending last week. */
const windowStartOf = (today: string): string =>
  addDays(raiseWeekOf(today), -7 * (P.e7.raiseWeeksLooked.value - 1))

/** True when the runner answered the offer on any finished week of the look-back window. */
export async function raiseAnsweredWithin(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<boolean> {
  const row = await deps.prisma.weeklyReview.findFirst({
    where: {
      userId: args.userId,
      weekStart: { gte: windowStartOf(args.today), lte: raiseWeekOf(args.today) },
      raiseAnswer: { not: null },
    },
    select: { id: true },
  })
  return row !== null
}

/**
 * The offer for today, or null: no active re-plannable plan, the condition does not hold, the raise
 * lifts no week, its draft fails the checklist, the runner answered within the window, or the offer
 * could not be worked out. The optional offer never fails the reviews list: an error is logged and
 * the offer left out. Worked out once per data version and forecast.
 */
export async function loadRaiseOffer(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<RaiseOffer | null> {
  const { userId, today } = args
  try {
    if (await raiseAnsweredWithin(deps, args)) return null
    const stamp = await forecastStamp(deps.prisma, userId)
    return await memoByVersion(deps, { userId, name: `raise.offer:${stamp}`, today }, async () => {
      try {
        const result = await computeReplan(deps, {
          userId,
          reason: 'raise-to-match',
          today,
          raise: true,
        })
        const raise = result.raise
        if (raise === null || !raise.check.met || raise.rise === null) return null
        if (failedChecklist(result.draft.checklist) !== null) return null
        return {
          weekStart: raiseWeekOf(today),
          fromWeek: raise.rise.weekStart,
          currentMin: raise.rise.fromMin,
          raisedMin: raise.rise.toMin,
        }
      } catch (error) {
        // No plan, a version-1 plan or a goal date in the past: there is nothing to offer.
        if (error instanceof HttpError) return null
        throw error
      }
    })
  } catch (error) {
    createLogger(deps.config).warn({ err: error }, 'working out the offer to raise the plan failed')
    return null
  }
}

/**
 * Remembers the runner's answer for the finished week; the same answer again changes nothing. A
 * Not now after a yes (a second tab) is a 409: the plan was raised, and nothing is changed.
 */
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
  const stored = await deps.prisma.weeklyReview.findUnique({
    where: { userId_weekStart: { userId, weekStart } },
    select: { raiseAnswer: true },
  })
  if (stored?.raiseAnswer === 'raised' && answer !== 'raised') {
    throw conflict('The plan changed since this was shown; nothing was changed.')
  }
  await deps.prisma.weeklyReview.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: { userId, weekStart, raiseAnswer: answer },
    update: { raiseAnswer: answer },
  })
}

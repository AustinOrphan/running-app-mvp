import { Router } from 'express'
import { z } from 'zod'
import { addDays, isIsoDate, mondayOf, todayIso, weekStartsBetween } from '../../shared/dates.ts'
import { aggregateWeeks } from '../../shared/domain/weeks.ts'
import type { Deps } from '../app.ts'
import { parse, validationError } from '../errors.ts'
import { loadActivities } from '../serialize.ts'

export const MAX_WEEKS = 260
const DEFAULT_WEEKS = 12

const isoDate = z.string().refine(isIsoDate, 'Use a real date written YYYY-MM-DD.')
const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() })

/**
 * The Mondays covered by `?from&to`. Both ends snap to their week; `to` defaults to this week and
 * `from` to eleven weeks earlier. Throws a `validation` error for a reversed or oversized range.
 */
export function parseWeekRange(query: unknown): string[] {
  const { from, to } = parse(rangeQuery, query)
  const last = mondayOf(to ?? todayIso())
  const first = mondayOf(from ?? addDays(last, -7 * (DEFAULT_WEEKS - 1)))
  if (first > last) throw validationError('`from` must not be after `to`.')
  const weeks = weekStartsBetween(first, last)
  if (weeks.length > MAX_WEEKS) {
    throw validationError(`A range can span at most ${MAX_WEEKS} weeks.`)
  }
  return weeks
}

export function weeksRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const weekStarts = parseWeekRange(req.query)
    const last = weekStarts[weekStarts.length - 1] ?? mondayOf(todayIso())
    const activities = await loadActivities(deps.prisma, req.userId, { to: addDays(last, 6) })
    res.json(aggregateWeeks(activities, weekStarts))
  })

  return router
}

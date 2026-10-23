import { Router } from 'express'
import { z } from 'zod'
import { isIsoDate, mondayOf } from '../../shared/dates.ts'
import { EXPLAIN_MAX_RULES } from '../../shared/copy/limits.ts'
import type { ExplainRequest } from '../../shared/engine/types.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { explainView } from '../services/explain.ts'

/** A date, snapped to the Monday of its week as the weeks route does. */
const weekStart = z
  .string()
  .refine(isIsoDate, 'Use a real date written YYYY-MM-DD.')
  .transform(mondayOf)

/** A rule id as the engine spells it: `g-1`, `H4`, `F-lib`, `n-4`, `design-4.2`. */
const ruleId = z.string().regex(/^[A-Za-z][A-Za-z0-9.-]{0,31}$/, 'Use a rule id such as g-1 or H4.')

/** Rule ids as one comma-separated value: `?rules=g-1,C1`. */
const rules = z
  .string()
  .transform((value) => value.split(','))
  .pipe(z.array(ruleId).min(1).max(EXPLAIN_MAX_RULES))

const recordId = z.string().min(1).max(64)

/**
 * What the drawer is opened on. A discriminated union on `subject`, strict so a parameter that
 * belongs to another subject is a mistake worth a 400 and not a silent ignore.
 */
const query = z.discriminatedUnion('subject', [
  z.strictObject({ subject: z.literal('session'), id: recordId }),
  z.strictObject({ subject: z.literal('week'), weekStart }),
  z.strictObject({ subject: z.literal('decision'), weekStart }),
  z.strictObject({ subject: z.literal('readiness') }),
  z.strictObject({
    subject: z.literal('zone'),
    boundary: z.enum(['cs', 'lt1Pace', 'thresholdPace', 'lt1Hr', 'hrMax']).optional(),
  }),
  z.strictObject({ subject: z.literal('prediction'), goalId: recordId }),
  z.strictObject({ subject: z.literal('rules'), rules }),
  z.strictObject({ subject: z.literal('brief'), weekStart }),
  z.strictObject({ subject: z.literal('activity'), id: recordId }),
])

/**
 * GET /api/explain: the figures the engine read for a session, a week, a decision, readiness, the
 * zones, a prediction or a list of rules, as `ExplainView` (phase 3a design 8.4). Authentication
 * runs before the query is parsed. A record of another user answers 404, as an unknown one does.
 */
export function explainRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const request: ExplainRequest = parse(query, req.query)
    res.json(await explainView(deps, { userId: req.userId, request }))
  })

  return router
}

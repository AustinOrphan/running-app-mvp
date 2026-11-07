// The race API (rule H14, ADR 0018): the plan of the runner's current goal, derived on read, and
// the runner's table of course points. Mounted under `requireAuth` (`app.ts`), so an anonymous
// request is a 401 before any query or body is parsed. The plan is a private read: the tag follows
// the data version and the day, the answer is private and varies by cookie. Zod parses the query
// (an unknown parameter is a 400) and the body of the table.
//
// The table is private. Every message of its schema is fixed text: a rejected row is named by its
// index and its field in `details.issues[].path`, and no message carries a name, a distance or any
// other value. The body is never logged (`pino-http` logs the request line, not the body).
import { Router } from 'express'
import { z } from 'zod'
import { todayIso } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import {
  RACE_CHECKPOINT_CLIMB_MAX_M,
  RACE_CHECKPOINT_CUTOFF_MAX_SEC,
  RACE_CHECKPOINT_NAME_MAX,
} from '../../shared/limits.ts'
import type { Deps } from '../app.ts'
import { dataVersionKey } from '../dataVersion.ts'
import { parse } from '../errors.ts'
import { athleteKey } from '../services/athleteState.ts'
import { raceCheckpointsView, saveRaceCheckpoints } from '../services/raceCheckpoints.ts'
import { loadRacePlan } from '../services/racePlan.ts'

/** The plan takes no parameters; an unknown one is a mistake worth a 400, not a silent ignore. */
const noQuery = z.strictObject({})

/** A whole number in `[min, max]`; every failure carries the one fixed message. */
function wholeNumber(min: number, max: number, message: string) {
  return z.number({ error: message }).int(message).min(min, message).max(max, message)
}

const climb = wholeNumber(0, RACE_CHECKPOINT_CLIMB_MAX_M, 'Climb is out of range.').nullish()

/** A name is plain text of 1 to 60 characters: no control or format characters. */
const nameSchema = z
  .string({ error: 'Give the point a name.' })
  .trim()
  .min(1, 'Give the point a name.')
  .max(RACE_CHECKPOINT_NAME_MAX, 'The name is too long.')
  .refine((name) => !/[\p{Cc}\p{Cf}]/u.test(name), 'The name has a character that is not text.')

const rowSchema = z.strictObject(
  {
    name: nameSchema,
    distanceM: wholeNumber(1, 1_000_000, 'Distance is out of range.'),
    gainM: climb,
    lossM: climb,
    cutoffSec: wholeNumber(
      0,
      RACE_CHECKPOINT_CUTOFF_MAX_SEC,
      'The cutoff is out of range.',
    ).nullish(),
  },
  { error: 'A checkpoint has a field that is not known.' },
)

/** The table: at most `r1.maxCheckpoints` rows, distances strictly increasing from the start. */
const checkpointsBody = z.strictObject(
  {
    checkpoints: z
      .array(rowSchema, { error: 'Send the checkpoints as a list.' })
      .max(P.r1.maxCheckpoints.value, 'There are too many checkpoints.')
      .superRefine((rows, ctx) => {
        rows.forEach((row, index) => {
          const before = rows[index - 1]
          if (before !== undefined && row.distanceM <= before.distanceM) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'distanceM'],
              message: 'Distances must increase from the start.',
            })
          }
        })
      }),
  },
  { error: 'The request has a field that is not known.' },
)

/** The validator of one plan: the data version and the day, as the state view's. */
function etag(key: string): string {
  return `W/"race.${key}"`
}

/**
 * GET /api/race/plan: `{ plan, reason }`. The plan reads no forecast (the race climate is a cached
 * normal), so the tag needs the data version and the day only, and a request that sends the current
 * tag is answered 304 before the plan is built.
 */
export function raceRouter(deps: Deps): Router {
  const router = Router()

  router.get('/plan', async (req, res) => {
    parse(noQuery, req.query)
    const today = todayIso()
    res.vary('Cookie')
    res.set('Cache-Control', 'private, no-cache')
    res.set('ETag', etag(athleteKey(await dataVersionKey(deps.prisma), today)))
    if (req.fresh) {
      res.status(304).end()
      return
    }
    res.json(await loadRacePlan(deps, { userId: req.userId, today }))
  })

  router.get('/checkpoints', async (req, res) => {
    parse(noQuery, req.query)
    res.set('Cache-Control', 'private, no-store')
    res.json(await raceCheckpointsView(deps.prisma, req.userId))
  })

  router.put('/checkpoints', async (req, res) => {
    const body = parse(checkpointsBody, req.body)
    res.set('Cache-Control', 'private, no-store')
    res.json(
      await saveRaceCheckpoints(
        deps.prisma,
        req.userId,
        body.checkpoints.map((row) => ({
          name: row.name,
          distanceM: row.distanceM,
          gainM: row.gainM ?? null,
          lossM: row.lossM ?? null,
          cutoffSec: row.cutoffSec ?? null,
        })),
      ),
    )
  })

  return router
}

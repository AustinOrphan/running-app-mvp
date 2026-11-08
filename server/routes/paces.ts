// GET /api/paces (rule C9, ADR 0020): the easy pace, what the runner can run now at the standard
// distances and at one of their own, and the test the engine supports. Derived on read, stored
// nowhere. Mounted under `requireAuth` (`app.ts`), so an anonymous request is a 401 before the query
// is parsed. The tag follows the data version, the day and the custom course, so a request that
// sends the current tag is answered 304 before anything is built.
import { Router } from 'express'
import { z } from 'zod'
import { todayIso } from '../../shared/dates.ts'
import {
  PACES_CUSTOM_GAIN_MAX_M,
  PACES_CUSTOM_MAX_M,
  PACES_CUSTOM_MIN_M,
} from '../../shared/limits.ts'
import type { MyPacesView } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { dataVersionKey } from '../dataVersion.ts'
import { parse } from '../errors.ts'
import { athleteKey } from '../services/athleteState.ts'
import { loadCustomEvent, loadMyPaces } from '../services/myPaces.ts'

/** A whole number from the query string; every failure carries the one fixed message. */
function wholeNumber(min: number, max: number, message: string) {
  return z.coerce.number({ error: message }).int(message).min(min, message).max(max, message)
}

/** The custom course: a distance, and optionally the climb; a climb without a distance is a 400. */
const query = z
  .strictObject({
    distanceM: wholeNumber(
      PACES_CUSTOM_MIN_M,
      PACES_CUSTOM_MAX_M,
      'Distance is out of range.',
    ).optional(),
    gainM: wholeNumber(0, PACES_CUSTOM_GAIN_MAX_M, 'Climb is out of range.').optional(),
  })
  .refine((q) => q.gainM === undefined || q.distanceM !== undefined, {
    path: ['gainM'],
    message: 'Climb needs a distance.',
  })

function etag(key: string, distanceM: number | undefined, gainM: number | undefined): string {
  return `W/"paces.${key}.${String(distanceM ?? '-')}.${String(gainM ?? '-')}"`
}

export function pacesRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const { distanceM, gainM } = parse(query, req.query)
    const today = todayIso()
    res.vary('Cookie')
    res.set('Cache-Control', 'private, no-cache')
    res.set('ETag', etag(athleteKey(await dataVersionKey(deps.prisma), today), distanceM, gainM))
    if (req.fresh) {
      res.status(304).end()
      return
    }
    const { userId } = req
    const view: MyPacesView = {
      ...(await loadMyPaces(deps, { userId, today })),
      custom:
        distanceM === undefined
          ? null
          : await loadCustomEvent(deps, { userId, today, distanceM, gainM: gainM ?? 0 }),
    }
    res.json(view)
  })

  return router
}

// Setting a place without typing coordinates (PL1, ADR 0024): the search of a town or postcode, and
// the place a runner usually starts from.
//
// The search is the one request path that waits on Open-Meteo's geocoder (up to 5 s) and sends only
// the typed text. Nothing here logs, stores or puts the query into an error. The usual start reads
// the stored tracks of the runner's own runs and sends nothing out; only the rounded cell and the
// counts are returned.
import type { Deps } from '../app.ts'
import type { PrismaClient } from '../db.ts'
import { HttpError } from '../errors.ts'
import { searchPlaces as geocode, type PlaceMatch } from '../providers/openMeteo.ts'
import { loadRunnerDay } from '../runnerDay.ts'
import { PLACES_TEMPLATES } from '../../shared/copy/places.ts'
import { render } from '../../shared/copy/template.ts'
import { addDays } from '../../shared/dates.ts'
import {
  USUAL_START_DAYS,
  usualStart,
  type RunStart,
  type UsualStart,
} from '../../shared/domain/usualStart.ts'
import { decodePolyline } from '../../shared/importers/files/track.ts'
import { fetchOf } from './weatherCache.ts'

/** The most places one search answers with. */
export const PLACE_RESULTS_MAX = 8

/**
 * Places matching the typed text. A failed or slow geocoder is a 502 whose message is the app's own
 * sentence; the cause is dropped, since it could carry the request URL and so the query.
 */
export async function searchPlaces(
  deps: Pick<Deps, 'fetch'>,
  query: string,
): Promise<PlaceMatch[]> {
  try {
    return await geocode(fetchOf(deps), query, PLACE_RESULTS_MAX)
  } catch {
    throw new HttpError(
      502,
      'places.unavailable',
      render(PLACES_TEMPLATES['places.unavailable'], {}, 'km'),
    )
  }
}

/**
 * The most common 0.01-degree cell among the first recorded positions of the runner's runs and
 * races with a stored track over the last `USUAL_START_DAYS` days, or null when none has one. The
 * stored track is whole (the 200 m trim of the read route is for display), so its first point is the
 * recorded start; a track whose polyline is unreadable is not counted.
 */
export async function loadUsualStart(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<UsualStart | null> {
  const { today } = await loadRunnerDay(prisma, userId, now)
  const rows = await prisma.activityTrack.findMany({
    where: {
      activity: {
        userId,
        type: { in: ['run', 'race'] },
        date: { gte: addDays(today, -USUAL_START_DAYS) },
      },
    },
    select: { polyline: true, activity: { select: { date: true } } },
  })
  const starts: RunStart[] = []
  for (const row of rows) {
    const first = decodePolyline(row.polyline)[0]
    if (first) starts.push({ lat: first[0], lng: first[1], date: row.activity.date })
  }
  return usualStart(starts)
}

import type { PrismaClient } from '../db.ts'
import { routeGlyph } from '../../shared/domain/routeGlyph.ts'
import type { ActivityGlyphs } from '../../shared/types.ts'
import { toTrack } from './activityStore.ts'

/**
 * The route glyphs of the asked activities, for the rows of one list page. Only the caller's own
 * rows are read (the track is matched through its activity's `userId`), and each glyph is built
 * from the track as the map serves it: the first and last 200 m are cut unless the runner shows
 * the ends (`User.hideMapEnds`, on unless set to false), so a stored whole track never leaves the
 * server. An id with no track, no drawable route or another runner's is absent from the answer.
 */
export async function loadGlyphs(
  prisma: PrismaClient,
  userId: string,
  ids: readonly string[],
): Promise<ActivityGlyphs> {
  const glyphs: ActivityGlyphs['glyphs'] = {}
  if (ids.length === 0) return { glyphs }
  const [rows, account] = await Promise.all([
    prisma.activityTrack.findMany({
      where: { activityId: { in: [...ids] }, activity: { userId } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { hideMapEnds: true } }),
  ])
  const hide = account?.hideMapEnds !== false
  for (const row of rows) {
    const track = toTrack(row)
    const glyph = track ? routeGlyph(track, hide) : null
    if (glyph) glyphs[row.activityId] = glyph
  }
  return { glyphs }
}

// The hiking cue of a long or back-to-back session in the specific phase of a trail ultra (rule H4,
// HK1): words only, no distance, no height and no target; the minutes are the session's own. The
// grade is the `h4.walkCheaperGradePct` Param and the start is `h4.hikeCueFromMin`. Kept clear of
// the G5 words (`shared/copy/lint.ts`).
import { P } from '../engine/params/index.ts'
import type { SessionSpec } from '../engine/types.ts'

/** The cue for a session that carries the hiking flag; null for any other session. */
export function hikeCue(session: Pick<SessionSpec, 'flags'>): string | null {
  if (!session.flags.includes('hike-practice')) return null
  const grade = String(P.h4.walkCheaperGradePct.value)
  const from = String(P.h4.hikeCueFromMin.value)
  return `Hiking practice: walk the climbs steeper than about ${grade} percent from minute ${from}, not only when tired, with a steady, purposeful stride. The minutes stay the same.`
}

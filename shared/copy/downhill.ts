// The downhill cue of a hill or long session of the downhill window (rule H5, owner decision D5):
// words only, no distance, no height and no target. The grades are the `h5.cueGradePct` Param,
// the same in metres and in feet. Kept clear of the G5 words (`shared/copy/lint.ts`).
import { P } from '../engine/params/index.ts'
import type { SessionSpec } from '../engine/types.ts'

/** The cue for a session that carries a downhill flag; null for any other session. */
export function descentCue(session: Pick<SessionSpec, 'flags'>): string | null {
  const first = session.flags.includes('downhill-first')
  if (!first && !session.flags.includes('downhill')) return null
  const [low, high] = P.h5.cueGradePct.value
  const lead = first ? 'First downhill practice: keep it gentle. ' : 'Downhill practice: '
  return `${lead}On descents of ${String(low)} to ${String(high)} percent, run relaxed and in control, with short quick steps and your weight over your feet. Walk anything steeper or rougher.`
}

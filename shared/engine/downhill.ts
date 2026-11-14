// Downhill work, held back where the evidence asks for it [rule H5, owner decision D5]. The plan
// marks hill and long sessions of the downhill window with the `downhill` flag; this module takes
// the flag (and the H5 rule that comes with it) off a session in the last days before the race and
// off the days after a check-in that reports sore quads. It only removes: a held session keeps its
// minutes and its gain, so no week plans more than it did before. No gain is cut: a lower gain in
// one week would leave the next week above the soft ramp of rule H4. Pure: no I/O, and the only
// numbers are the `h5` Params.
import { addDays } from '../dates.ts'
import { painAreaKey } from '../domain/painArea.ts'
import { P } from './params/index.ts'
import type { Checkin, SessionFlag, SessionSpec } from './types.ts'

/** The downhill emphasis of a session: the moderate first exposure, then the emphasis proper. */
export const DOWNHILL_FLAGS: readonly SessionFlag[] = ['downhill-first', 'downhill']

/** The part of a check-in row the pause reads. */
type PauseCheckin = Partial<Pick<Checkin, 'date' | 'painScore' | 'painArea'>>

/**
 * The last day the downhill emphasis is paused, or null when it is not. The latest check-in of the
 * last `h5.quadPauseDays` days whose area names the quads and whose pain score reaches
 * `h5.quadPauseMinPain` starts the pause; it lasts `h5.quadPauseDays` days after that report. A
 * check-in dated after today is ignored.
 */
export function quadPauseThrough(checkins: readonly PauseCheckin[], today: string): string | null {
  const days = P.h5.quadPauseDays.value
  const earliest = addDays(today, -days)
  let latest: string | null = null
  for (const c of checkins) {
    if (c.date === undefined || c.date < earliest || c.date > today) continue
    if ((c.painScore ?? 0) < P.h5.quadPauseMinPain.value) continue
    if (painAreaKey(c.painArea)?.key !== 'quad') continue
    if (latest === null || c.date > latest) latest = c.date
  }
  return latest === null ? null : addDays(latest, days)
}

export interface DownhillHold {
  /** The race day. */
  raceDate: string
  /** The last day of the quad pause (`quadPauseThrough`), or null. */
  pausedThrough: string | null
  today: string
}

/** Whether the downhill emphasis is held on `date`: the last days before the race, or the pause. */
export function downhillHeld(date: string, hold: DownhillHold): boolean {
  if (date > addDays(hold.raceDate, -P.h5.taperExclusionDays.value)) return true
  return hold.pausedThrough !== null && date >= hold.today && date <= hold.pausedThrough
}

/** The sessions with a downhill flag and its rule taken off where `downhillHeld` says so. */
export function holdDownhill(sessions: SessionSpec[], hold: DownhillHold): SessionSpec[] {
  return sessions.map((s) =>
    DOWNHILL_FLAGS.some((f) => s.flags.includes(f)) && downhillHeld(s.date, hold)
      ? {
          ...s,
          flags: s.flags.filter((f) => !DOWNHILL_FLAGS.includes(f)),
          rules: s.rules.filter((r) => r !== 'H5'),
        }
      : s,
  )
}

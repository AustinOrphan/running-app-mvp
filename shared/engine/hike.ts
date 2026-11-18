// Hiking practice on long runs, held back near the race [rule H4, HK1]. The plan marks the long and
// back-to-back sessions of a trail or mixed ultra's specific phase with the `hike-practice` flag
// (`macro.ts`, `sessions.ts`); this module takes the flag and the H4 rule it added off a session in
// the last days before the race. It reuses the gate of the downhill cues (`downhillHeld`, the
// `h5.taperExclusionDays` Param) with no quad pause: walking the climbs loads the legs less than the
// run it replaces. It only removes: a session keeps its minutes and its gain. Pure: no I/O.
import { downhillHeld } from './downhill.ts'
import type { SessionSpec } from './types.ts'

/** The sessions with the hiking flag taken off where the race is within the taper exclusion. */
export function holdHike<T extends Pick<SessionSpec, 'date' | 'flags' | 'rules'>>(
  sessions: readonly T[],
  raceDate: string | null,
  today: string,
): T[] {
  const hold = { raceDate, pausedThrough: null, today }
  return sessions.map((s) =>
    s.flags.includes('hike-practice') && downhillHeld(s.date, hold)
      ? {
          ...s,
          flags: s.flags.filter((f) => f !== 'hike-practice'),
          // the long and back-to-back library entries carry no H4 of their own
          rules: s.rules.filter((r) => r !== 'H4'),
        }
      : s,
  )
}

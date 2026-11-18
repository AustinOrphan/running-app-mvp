// Downhill work, held back where the evidence asks for it [rule H5, owner decision D5]. The plan
// marks hill and long sessions of the downhill window with the `downhill` flag; this module takes
// the flag (and the H5 rule that comes with it) off a session in the last days before the race and
// off the days after a check-in that reports sore quads. It only removes: a held session keeps its
// minutes and its gain, so no week plans more than it did before. No gain is cut: a lower gain in
// one week would leave the next week above the soft ramp of rule H4. Pure: no I/O, and the only
// numbers are the `h5` Params. It also says where the lead of the rule began, from the weeks of the
// plan being replaced (`downhillLeadBegan`).
import { addDays, mondayOf } from '../dates.ts'
import { painAreaKey } from '../domain/painArea.ts'
import { P } from './params/index.ts'
import type { Checkin, SessionFlag, SessionSpec, WeekDraft } from './types.ts'

/** The downhill emphasis of a session: the moderate first exposure, then the emphasis proper. */
export const DOWNHILL_FLAGS: readonly SessionFlag[] = ['downhill-first', 'downhill']

/** The Monday the downhill window of a race on `raceDate` starts [rule H5]. */
export function downhillWindowStart(raceDate: string): string {
  return addDays(mondayOf(raceDate), -7 * P.h5.downhillStartWeeksBeforeRace.value)
}

/**
 * Where the lead of rule H5 began: the Monday of the earliest week of the plan being replaced that
 * starts in [windowStart, firstMonday) and carries a downhill flag. A week stored before DH1 carries
 * `downhill` alone and counts; a week with no downhill flag (a post-race week, a goal that did not
 * descend when it was drawn) does not. Null when no such week exists.
 */
export function downhillLeadBegan(
  weeks: ReadonlyArray<Pick<WeekDraft, 'weekStart' | 'flags'>>,
  windowStart: string,
  firstMonday: string,
): string | null {
  let began: string | null = null
  for (const w of weeks) {
    if (w.weekStart < windowStart || w.weekStart >= firstMonday) continue
    if (!DOWNHILL_FLAGS.some((f) => w.flags.includes(f))) continue
    if (began === null || w.weekStart < began) began = w.weekStart
  }
  return began
}

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
  /** The race day, or null on a read that applies the pause alone. */
  raceDate: string | null
  /** The last day of the quad pause (`quadPauseThrough`), or null. */
  pausedThrough: string | null
  today: string
}

/** Whether the downhill emphasis is held on `date`: the last days before the race, or the pause. */
export function downhillHeld(date: string, hold: DownhillHold): boolean {
  // The last `h5.taperExclusionDays` days before the race are the days from that many days out to
  // the day before: with 10, a session 10 days out is held and one 11 days out keeps the emphasis.
  if (hold.raceDate !== null && date >= addDays(hold.raceDate, -P.h5.taperExclusionDays.value)) {
    return true
  }
  return hold.pausedThrough !== null && date >= hold.today && date <= hold.pausedThrough
}

/** The sessions with a downhill flag and its rule taken off where `downhillHeld` says so. */
export function holdDownhill<T extends Pick<SessionSpec, 'date' | 'flags' | 'rules'>>(
  sessions: readonly T[],
  hold: DownhillHold,
): T[] {
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

/**
 * The stored sessions as a page shows them: the downhill flags and the cue are hidden inside the
 * quad pause of the latest check-ins. A check-in does not re-plan, so the pause is derived on every
 * read as well as when a plan is drawn (`holdDownhill` in `generate`); nothing is stored.
 */
export function pausedOnRead<T extends Pick<SessionSpec, 'date' | 'flags' | 'rules'>>(
  sessions: readonly T[],
  checkins: readonly PauseCheckin[],
  today: string,
): T[] {
  const pausedThrough = quadPauseThrough(checkins, today)
  return pausedThrough === null
    ? [...sessions]
    : holdDownhill(sessions, { raceDate: null, pausedThrough, today })
}

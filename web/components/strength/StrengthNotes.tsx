import { P } from '../../../shared/engine/params/index.ts'
import type { StrengthOffDay, StrengthView } from '../../../shared/types.ts'
import styles from './CountPrompt.module.css'
import type { PageWords } from './strengthPageText.ts'
import { overPlannedWeek } from './weeklyCount.ts'

export interface StrengthNotesProps {
  view: StrengthView
  words: PageWords
}

const count = (n: number) => ({ kind: 'count', n }) as const

/**
 * The off-day the note speaks of: that of the newest logged session, when it has one and was logged
 * on the server's day. The sentences are about that day ("The long run is tomorrow"), so a session
 * of an earlier day says nothing now, and a newer session without the flag takes the note's place:
 * a session is noted while it is the latest, and the note does not come back after another one. The
 * view is the only memory; nothing is kept in the browser.
 */
function offDayNow(view: StrengthView): StrengthOffDay | null {
  const newest = view.recent[0]
  if (newest === undefined || newest.date !== view.asOf) return null
  return newest.offDay ?? null
}

/**
 * The plain notes the Strength page keeps beside the recent sessions (design 12.4). Neither changes
 * anything.
 *
 * - The session just logged fell on a day the plan keeps heavy lifting off: the day before the long
 *   run, or a day with a hard run. One note, for that session only.
 * - A current or just-finished week has more sessions logged than the plan asks for: more do not add
 *   to the block, and the research range is the one of `flib.strengthPerWeek`.
 *
 * Nothing is shown with nothing to say.
 */
export function StrengthNotes({ view, words }: StrengthNotesProps) {
  const offDay = offDayNow(view)
  const week = overPlannedWeek(view)
  if (offDay === null && week === null) return null
  const { value, range } = P.flib.strengthPerWeek
  const [lo, hi] = range ?? [value, value]
  return (
    <>
      {offDay === null ? null : (
        <p role="note" className={styles.note}>
          {words.say(
            offDay === 'day-before-long-run'
              ? 'strength.off-day.long-run'
              : 'strength.off-day.hard-run',
          )}
        </p>
      )}
      {week === null ? null : (
        <p role="note" className={styles.note}>
          {words.say('strength.over.more', {
            logged: count(week.logged),
            planned: count(week.planned),
            lo: count(lo),
            hi: count(hi),
          })}
        </p>
      )}
    </>
  )
}

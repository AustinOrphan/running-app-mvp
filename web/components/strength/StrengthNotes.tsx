import { P } from '../../../shared/engine/params/index.ts'
import type { StrengthView } from '../../../shared/types.ts'
import styles from './CountPrompt.module.css'
import type { PageWords } from './strengthPageText.ts'
import { overPlannedWeek } from './weeklyCount.ts'

export interface StrengthNotesProps {
  view: StrengthView
  words: PageWords
}

const count = (n: number) => ({ kind: 'count', n }) as const

/**
 * The plain notes the Strength page keeps beside the recent sessions (design 12.4). Today there is
 * one: a current or just-finished week with more sessions logged than the plan asks for. It changes
 * nothing, and says so: more sessions do not add to the block, and the research range is the one of
 * `flib.strengthPerWeek`. Nothing is shown with nothing to say.
 *
 * The note for a session logged the day before a long run, or on a day with a hard run, is not here:
 * `StrengthView` does not say which days hold a long or a hard run, and the page does not read the
 * plan to find out.
 */
export function StrengthNotes({ view, words }: StrengthNotesProps) {
  const week = overPlannedWeek(view)
  if (week === null) return null
  const { value, range } = P.flib.strengthPerWeek
  const [lo, hi] = range ?? [value, value]
  return (
    <p role="note" className={styles.note}>
      {words.say('strength.over.more', {
        logged: count(week.logged),
        planned: count(week.planned),
        lo: count(lo),
        hi: count(hi),
      })}
    </p>
  )
}

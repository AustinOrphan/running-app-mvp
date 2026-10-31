import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStrengthUnits, useStrengthView } from '../../api/strength.ts'
import { CountPrompt } from './CountPrompt.tsx'
import styles from './ReviewStrength.module.css'
import { pageWords, type PageWords } from './strengthPageText.ts'

/** The words of the page in the runner's units, or null until both units are known. */
function useReviewWords(): PageWords | null {
  const known = useStrengthUnits().data
  const units = known?.units
  const weightUnit = known?.weightUnit
  return useMemo(
    () => (units === undefined || weightUnit === undefined ? null : pageWords(units, weightUnit)),
    [units, weightUnit],
  )
}

/**
 * Under a week of the Review page that has a logged strength session (design 12.2): one line for
 * each lift whose working load moved in the week ("Back squat 110 lb to 115 lb"), each with a link to
 * that lift's history on the Strength page (`/strength?lift=<id>`). The lines come from the `weeks` of the
 * Strength view, the one read the Strength page makes too; the review and its stored record are not
 * touched. With the read pending or failed (the view is not kept offline, ADR 0012), or with no lift
 * moved, nothing is shown.
 */
export function ReviewLifts({ weekStart }: { weekStart: string }) {
  const view = useStrengthView()
  const words = useReviewWords()
  const week = view.data?.weeks.find((candidate) => candidate.weekStart === weekStart)
  if (words === null || week === undefined || week.logged === 0 || week.moved.length === 0) {
    return null
  }
  return (
    <ul aria-label={words.say('strength.review.moved-list')} className={styles.lifts}>
      {week.moved.map((move) => {
        const exercise = words.name(move.exerciseId)
        return (
          <li key={move.exerciseId} className={styles.lift}>
            <span>
              {words.say('strength.review.moved', {
                exercise,
                from: words.load(move.fromG),
                to: words.load(move.toG),
              })}
            </span>
            <Link
              to={`/strength?lift=${encodeURIComponent(move.exerciseId)}`}
              className={styles.link}
              aria-label={words.say('strength.page.lift-history-for', { exercise })}
            >
              {words.say('strength.page.lift-history')}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The question about a lower weekly count on the Review page (design 12.4), the same one the
 * Strength page asks. Nothing is shown until the Strength view and the units are read.
 */
export function ReviewCountPrompt() {
  const view = useStrengthView()
  const words = useReviewWords()
  if (view.data === undefined || words === null) return null
  return <CountPrompt view={view.data} words={words} />
}

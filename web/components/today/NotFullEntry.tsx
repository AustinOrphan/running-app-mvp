import { notFullEntryWords } from '../../../shared/copy/windowView.ts'
import type { Units } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import styles from './NotFullEntry.module.css'

export interface NotFullEntryProps {
  units: Units
  /** "Not 100%" was tapped: the hero swaps the Not today sheet for the sheet that makes a window. */
  onOpen: () => void
}

/**
 * The way from "Not today" to "Not 100%": when the day is not one session to move or skip but an
 * illness, a niggle, a short week or a trip, the runner tells the plan once and it holds a window.
 * It sits in the Not today sheet's `children`, above the controls that change this one session.
 */
export function NotFullEntry({ units, onOpen }: NotFullEntryProps) {
  const words = notFullEntryWords(units)
  return (
    <div className={styles.entry}>
      <Button onClick={onOpen}>{words.label}</Button>
      <p className={styles.hint}>{words.hint}</p>
    </div>
  )
}

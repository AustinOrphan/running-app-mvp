import type { ReactNode } from 'react'
import styles from './ScrollTable.module.css'

export interface ScrollTableProps {
  id?: string
  /** The accessible name of the region: what the table is ("Monthly totals table"). */
  label: string
  /** Extra class for a box that also bounds the height or draws a frame. */
  className?: string
  children: ReactNode
}

/**
 * A table that scrolls sideways inside its own labelled region when it is wider than the screen.
 * The region takes focus, so a keyboard reaches every column, and an edge fade (a shadow where
 * more is hidden, no script) shows which side has more. The page itself never scrolls sideways.
 */
export function ScrollTable({ id, label, className, children }: ScrollTableProps) {
  return (
    <div
      id={id}
      role="region"
      aria-label={label}
      tabIndex={0}
      className={[styles.scroll, className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}

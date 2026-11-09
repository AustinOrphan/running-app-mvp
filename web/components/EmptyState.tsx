import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

export interface EmptyStateProps {
  title: string
  body?: string
  action?: ReactNode
  /** A faint preview of what will fill the space, drawn with the page's own shapes (`EmptyPreview`). */
  preview?: ReactNode
}

/**
 * One sentence, one muted line, one button, and no picture (visual design, section 18). Where it
 * helps, a muted preview of the shape to come sits below, hidden from assistive technology: the
 * sentence and the line carry the meaning.
 */
export function EmptyState({ title, body, action, preview }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.title}>{title}</p>
      {body !== undefined ? <p className={styles.body}>{body}</p> : null}
      {action !== undefined ? <div className={styles.action}>{action}</div> : null}
      {preview !== undefined ? (
        <div className={styles.preview} aria-hidden="true">
          {preview}
        </div>
      ) : null}
    </div>
  )
}

/** The column headings of the list to come and one muted placeholder row of dashes. */
export function EmptyPreview({ columns }: { columns: readonly string[] }) {
  const grid = { gridTemplateColumns: `repeat(${String(columns.length)}, minmax(0, 1fr))` }
  return (
    <div className={styles.table}>
      <div className={styles.head} style={grid}>
        {columns.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>
      <div className={styles.placeholder} style={grid}>
        {columns.map((column) => (
          <span key={column}>{'–'}</span>
        ))}
      </div>
    </div>
  )
}

/** A bare axis, for a chart panel with no weeks in range. */
export function EmptyAxis({ ticks }: { ticks: readonly string[] }) {
  return (
    <div className={styles.axis}>
      <div className={styles.axisLine} />
      <div className={styles.ticks}>
        {ticks.map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
    </div>
  )
}

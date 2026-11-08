import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'
import { Illustration, type ArtKey } from './illustrations/Illustration.tsx'

export interface EmptyStateProps {
  title: string
  body?: string
  action?: ReactNode
  /** A line drawing above the title, drawn only while the Illustrations switch is on. */
  art?: ArtKey
}

/**
 * One sentence, one muted line, one button. A drawing above them only when the page names one with
 * `art` and the runner has turned Illustrations on (visual design, section 5).
 */
export function EmptyState({ title, body, action, art }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <Illustration art={art} />
      <p className={styles.title}>{title}</p>
      {body !== undefined ? <p className={styles.body}>{body}</p> : null}
      {action !== undefined ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}

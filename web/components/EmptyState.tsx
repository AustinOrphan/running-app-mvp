import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

export interface EmptyStateProps {
  title: string
  body?: string
  action?: ReactNode
}

/** One sentence, one muted line, one button. No illustration. */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.title}>{title}</p>
      {body !== undefined ? <p className={styles.body}>{body}</p> : null}
      {action !== undefined ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}

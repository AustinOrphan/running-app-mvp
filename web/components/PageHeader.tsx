import type { ReactNode } from 'react'
import styles from './PageHeader.module.css'

export interface PageHeaderProps {
  title: string
  context?: string
  actions?: ReactNode
}

/** The page's h1 with one line of context under it; actions sit to the right from 900px. */
export function PageHeader({ title, context, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1>{title}</h1>
        {context !== undefined ? <p className={styles.context}>{context}</p> : null}
      </div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}

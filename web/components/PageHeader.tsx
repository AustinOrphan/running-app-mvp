import type { ReactNode } from 'react'
import styles from './PageHeader.module.css'

export interface PageHeaderProps {
  title: string
  context?: string
  actions?: ReactNode
  /** Keeps the actions beside the title on a phone too, where they would take a row of their own. */
  inlineActions?: boolean
}

/** The page's h1 with one line of context under it; actions sit to the right from 900px. */
export function PageHeader({ title, context, actions, inlineActions = false }: PageHeaderProps) {
  return (
    <header className={inlineActions ? `${styles.header} ${styles.inline}` : styles.header}>
      <div className={styles.text}>
        <h1>{title}</h1>
        {context !== undefined ? <p className={styles.context}>{context}</p> : null}
      </div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}

import type { ReactNode, Ref } from 'react'
import styles from './PageHeader.module.css'

export interface PageHeaderProps {
  title: string
  /** One line of words, which may end in a link (the Plan page's link to the race plan). */
  context?: ReactNode
  actions?: ReactNode
  /** Keeps the actions beside the title on a phone too, where they would take a row of their own. */
  inlineActions?: boolean
  /** The h1, for a page that moves focus to its title. */
  titleRef?: Ref<HTMLHeadingElement>
}

/** The page's h1 with one line of context under it; actions sit to the right from 900px. */
export function PageHeader({
  title,
  context,
  actions,
  inlineActions = false,
  titleRef,
}: PageHeaderProps) {
  return (
    <header className={inlineActions ? `${styles.header} ${styles.inline}` : styles.header}>
      <div className={styles.text}>
        <h1 ref={titleRef}>{title}</h1>
        {context !== undefined ? <p className={styles.context}>{context}</p> : null}
      </div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}

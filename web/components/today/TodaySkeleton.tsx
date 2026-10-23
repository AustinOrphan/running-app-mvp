import { useEffect, useState } from 'react'
import styles from './TodaySkeleton.module.css'

/**
 * Static blocks in the shape of the first screen (verdict, title, display figure, three targets,
 * three actions), shown only after 300 ms so a fast load does not flash. No shimmer.
 */
export function TodaySkeleton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true)
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [])

  if (!visible) return null
  return (
    <div className={styles.page} role="group" aria-busy="true" aria-label="Loading">
      <div className={`skeleton ${styles.verdict}`} />
      <div className={`skeleton ${styles.title}`} />
      <div className={`skeleton ${styles.figure}`} />
      <div className={styles.targets}>
        <div className={`skeleton ${styles.target}`} />
        <div className={`skeleton ${styles.target}`} />
        <div className={`skeleton ${styles.target}`} />
      </div>
      <div className={styles.actions}>
        <div className={`skeleton ${styles.action}`} />
        <div className={`skeleton ${styles.action}`} />
        <div className={`skeleton ${styles.action}`} />
      </div>
    </div>
  )
}

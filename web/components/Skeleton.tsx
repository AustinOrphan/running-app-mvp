import { useEffect, useState } from 'react'
import styles from './Skeleton.module.css'

export interface SkeletonProps {
  lines?: number
}

/** Static placeholder blocks, shown only after 300 ms so fast loads do not flash. */
export function Skeleton({ lines = 3 }: SkeletonProps) {
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
    <div className={styles.wrap} aria-busy="true" aria-label="Loading" role="group">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`skeleton ${styles.line}`} />
      ))}
    </div>
  )
}

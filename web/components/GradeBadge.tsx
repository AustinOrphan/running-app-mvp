import { gradeMeaning } from '../../shared/copy/grades.ts'
import styles from './GradeBadge.module.css'

export interface GradeBadgeProps {
  grade: 'A' | 'B' | 'C' | 'D'
  /** A rule or parameter has a grade; a paper has an evidence level by design. */
  kind?: 'grade' | 'level'
}

/**
 * The letter in words, so that colour never carries the grade, and its meaning as the tooltip. A
 * touch screen shows no tooltip: a page with badges says what the grades mean in a line of its own
 * (`gradeLegend` in `shared/copy/grades.ts`, the same words).
 */
export function GradeBadge({ grade, kind = 'grade' }: GradeBadgeProps) {
  const label = kind === 'grade' ? `Evidence grade ${grade}` : `Evidence level ${grade}`
  return (
    <span
      className={`${styles.badge} ${grade === 'D' ? styles.default : ''}`}
      title={gradeMeaning(grade)}
    >
      {label}
    </span>
  )
}

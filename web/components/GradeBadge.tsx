import styles from './GradeBadge.module.css'

export interface GradeBadgeProps {
  grade: 'A' | 'B' | 'C' | 'D'
  /** A rule or parameter has a grade; a paper has an evidence level by design. */
  kind?: 'grade' | 'level'
}

const meaning = {
  A: 'consistent meta-analyses or consensus statements',
  B: 'randomised trials or large prospective cohorts',
  C: 'small trials, observational data, or a reasonable extrapolation',
  D: 'a convention or engineering default; no direct evidence',
} as const

/** The letter in words, so that colour never carries the grade. The meaning is the tooltip. */
export function GradeBadge({ grade, kind = 'grade' }: GradeBadgeProps) {
  const label = kind === 'grade' ? `Evidence grade ${grade}` : `Evidence level ${grade}`
  return (
    <span
      className={`${styles.badge} ${grade === 'D' ? styles.default : ''}`}
      title={meaning[grade]}
    >
      {label}
    </span>
  )
}

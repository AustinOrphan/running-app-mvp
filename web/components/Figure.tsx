import styles from './Figure.module.css'

export interface FigureProps {
  /** What the figure is: the term of the pair, in muted small type above the value. */
  label: string
  value: string
  /** The unit, set smaller and muted beside the value; left out for a value that carries its own. */
  unit?: string
}

/**
 * One lead figure of a record page, such as an activity's duration or distance: a value at the
 * `--text-xl` step with its unit muted beside it. A `<dt>` and `<dd>` pair, so it stands inside a
 * `<dl>`; the space between the value and the unit is in the text, so a screen reader says
 * "17.46 mi" and not "17.46mi".
 */
export function Figure({ label, value, unit }: FigureProps) {
  return (
    <div className={styles.figure}>
      <dt>{label}</dt>
      <dd>
        <span className={`${styles.value} figure-type`}>{value}</span>
        {unit === undefined ? null : (
          <>
            {' '}
            <span className={styles.unit}>{unit}</span>
          </>
        )}
      </dd>
    </div>
  )
}

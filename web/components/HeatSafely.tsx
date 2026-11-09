import { HEAT_SAFETY_LINES } from '../../shared/copy/heatDays.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import type { Units } from '../../shared/types.ts'
import styles from './HeatSafely.module.css'

/**
 * "How to do it safely" (rule I8): what the trials did, then the safety lines, in a closed
 * disclosure. The one rendering behind Today's note about heat days and the Heat mark on a rating.
 */
export function HeatSafely({ units }: { units: Units }) {
  return (
    <details>
      <summary className={styles.summary}>
        {render(TEMPLATES['heat.note.safely'], {}, units)}
      </summary>
      <p className={styles.text}>{render(TEMPLATES['heat.dose'], {}, units)}</p>
      <ul className={styles.lines}>
        {HEAT_SAFETY_LINES.map((id) => (
          <li key={id}>{render(TEMPLATES[id], {}, units)}</li>
        ))}
      </ul>
    </details>
  )
}

import { rateText } from '../../../shared/engine/fuelCopy.ts'
import type { EahCard } from '../../../shared/engine/types.ts'
import type { FuelTargetView } from '../../../shared/types.ts'
import { FuelTargetDetails } from './FuelTargetDetails.tsx'
import { fuelText } from './fuelText.ts'
import styles from './FuelTargetLine.module.css'

export interface FuelTargetLineProps {
  view: FuelTargetView
  eah: EahCard
  /** The target belongs to tomorrow's run, shown because today's session has none. */
  tomorrow?: boolean
}

/**
 * The fuel target as one line in the `fuel` slot, beside the session's targets: "Fuel target: 60
 * g/h of carbohydrate". The line is the summary of a disclosure that closes up to its 26 px budget
 * and opens to the reason, the fluid and sodium wording, the nausea plan and the safety card, so
 * the fold stays where it was measured. The rate is the server's; nothing is worked out here.
 */
export function FuelTargetLine({ view, eah, tomorrow = false }: FuelTargetLineProps) {
  const heading = tomorrow ? fuelText.tomorrow(rateText(view.target)) : view.text.heading
  return (
    <details className={styles.line}>
      <summary className={styles.summary}>
        <span className={styles.heading}>{heading}</span>
      </summary>
      <FuelTargetDetails view={view} eah={eah} />
    </details>
  )
}

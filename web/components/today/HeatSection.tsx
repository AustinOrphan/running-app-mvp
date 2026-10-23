import { useId } from 'react'
import type { TodayView } from '../../../shared/types.ts'
import { rulesRef } from '../../api/explain.ts'
import { WhyButton } from './WhyButton.tsx'
import styles from './today.module.css'

// Training in heat and heat warnings, spelled as the Param registry spells them.
const HEAT_RULES = ['I7', 'I9']

export function HeatSection({
  heat,
}: {
  heat: TodayView['heat']
  /** Not read: the button owns its drawer. DashboardPage still passes it until E2-5. */
  onWhy?: unknown
}) {
  const headingId = useId()
  if (heat.note === null && heat.wbgtC === null) return null
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        Heat
      </h2>
      {heat.note === null ? null : <p className={styles.purpose}>{heat.note}</p>}
      <p className={styles.counts}>
        {heat.wbgtC === null ? null : <span>{`WBGT ${heat.wbgtC.toFixed(1)} °C`}</span>}
        {heat.coolerHour === null ? null : <span>{`Cooler hour: ${heat.coolerHour}`}</span>}
      </p>
      <div className={styles.cardActions}>
        <WhyButton label="Why this heat note" rules={HEAT_RULES} explain={rulesRef(HEAT_RULES)} />
      </div>
    </section>
  )
}

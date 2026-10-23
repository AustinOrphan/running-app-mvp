import { useId } from 'react'
import type { TodayView } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import styles from './today.module.css'

export function HeatSection({
  heat,
  onWhy,
}: {
  heat: TodayView['heat']
  onWhy: (rules: string[]) => void
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
        <Button
          variant="quiet"
          onClick={() => {
            onWhy(['i-7', 'i-9'])
          }}
        >
          Why this heat note
        </Button>
      </div>
    </section>
  )
}

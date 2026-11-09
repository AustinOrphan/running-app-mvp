import { useId } from 'react'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { TodayHeat, Units } from '../../../shared/types.ts'
import { rulesRef } from '../../api/explain.ts'
import { ExplainButton } from '../ExplainButton.tsx'
import { HeatSafely } from '../HeatSafely.tsx'
import styles from './HeatDaysNote.module.css'

/** Heat acclimation, spelled as the Param registry spells it. */
const HEAT_DAYS_RULES = ['I8']

/**
 * What counts as a heat day, when the race is expected warm and the heat block is open and short
 * of days (`TodayHeat.heatDays`, rule I8). An option with safety lines behind a disclosure, never a
 * target: it states no count of days and none missing. Nothing renders otherwise.
 */
export function HeatDaysNote({ heat, units }: { heat: TodayHeat; units: Units }) {
  const headingId = useId()
  if (!heat.heatDays) return null
  return (
    <section className={styles.note} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.heading}>
          {render(TEMPLATES['heat.note.heading'], {}, units)}
        </h2>
        <ExplainButton
          subject="the heat days"
          rules={HEAT_DAYS_RULES}
          explain={rulesRef(HEAT_DAYS_RULES)}
          icon
        />
      </div>
      <p className={styles.text}>
        {render(
          TEMPLATES['heat.note.counts'],
          { temp: { kind: 'temp', c: P.acclim.exposureTempC.value } },
          units,
        )}
      </p>
      <p className={styles.text}>{render(TEMPLATES['heat.note.option'], {}, units)}</p>
      <HeatSafely units={units} />
    </section>
  )
}

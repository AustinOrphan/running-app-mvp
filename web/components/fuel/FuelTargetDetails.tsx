import type { EahCard as EahCardData } from '../../../shared/engine/types.ts'
import type { FuelTargetView } from '../../../shared/types.ts'
import { rulesRef } from '../../api/explain.ts'
import { ExplainButton } from '../ExplainButton.tsx'
import { EahCard } from './EahCard.tsx'
import styles from './FuelTargetDetails.module.css'

/** The fuelling practice and fluid rules, spelled as the Param registry spells them. */
const FUEL_RULES = ['H7', 'H8']

export interface FuelTargetDetailsProps {
  view: FuelTargetView
  /** The safety card; shown with the target whenever the page has it. */
  eah: EahCardData | null
}

/**
 * Everything the words of one fuel target say beyond its heading: why this rate, the low-certainty
 * and several-carbohydrate lines, thirst-led fluid wording, sodium, the gut-condition lock, the
 * nausea plan in a disclosure (open when a warm day or a hard run brings it forward) and the Why.
 * The sentences are the server's, written from templates; this lays them out.
 */
export function FuelTargetDetails({ view, eah }: FuelTargetDetailsProps) {
  const { text } = view
  return (
    <div className={styles.body}>
      <p className={styles.basis}>{text.basis}</p>
      {text.certainty === null ? null : <p className={styles.note}>{text.certainty}</p>}
      {text.multiCarb === null ? null : <p className={styles.note}>{text.multiCarb}</p>}
      <p className={styles.note}>{text.fluid}</p>
      <p className={styles.note}>{text.sodium}</p>
      {text.lock === null ? null : <p className={styles.note}>{text.lock}</p>}
      <details className={styles.nausea} open={text.nausea.open}>
        <summary className={styles.summary}>{text.nausea.heading}</summary>
        <ul className={styles.plan}>
          {text.nausea.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <div>
        <ExplainButton
          subject="the fuel target"
          rules={FUEL_RULES}
          explain={rulesRef(FUEL_RULES)}
        />
      </div>
      {eah === null ? null : <EahCard card={eah} />}
    </div>
  )
}

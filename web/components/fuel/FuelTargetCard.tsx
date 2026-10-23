import { useId } from 'react'
import type { FuelTargetView } from '../../../shared/types.ts'
import { FuelTargetDetails } from './FuelTargetDetails.tsx'
import { labText } from './fuelText.ts'
import styles from './FuelLab.module.css'

export interface FuelTargetCardProps {
  /** The target of the next planned run that can carry one; null when no such run is planned. */
  next: FuelTargetView | null
}

/**
 * The first card of the Fuel lab: "Fuel target: 60 g/h of carbohydrate" for the next planned long
 * run, with why this rate, the fluid and sodium wording, the nausea plan and the Why. The words are
 * the server's, written from templates; the safety card has a section of its own further down, so
 * it is not repeated here.
 */
export function FuelTargetCard({ next }: FuelTargetCardProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {next === null ? labText.targetHeading() : next.text.heading}
      </h2>
      {next === null ? (
        <p className={styles.lead}>{labText.targetEmpty()}</p>
      ) : (
        <>
          <p className={styles.run}>{labText.targetRun(next.session)}</p>
          <FuelTargetDetails view={next} eah={null} />
        </>
      )}
    </section>
  )
}

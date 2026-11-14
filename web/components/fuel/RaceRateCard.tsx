import { useId } from 'react'
import { rateText } from '../../../shared/engine/fuelCopy.ts'
import type { RaceRateHold } from '../../../shared/engine/types.ts'
import { labText } from './fuelText.ts'
import labStyles from './FuelLab.module.css'

export interface RaceRateCardProps {
  hold: RaceRateHold
}

/**
 * How long the race rate has held, as two facts from the log (rule H7, FT1): the longest run on
 * which it was tolerated and the latest day 2 of a back-to-back on which it was. Facts only: no
 * target, no verdict, and a plain "none logged yet" when nothing qualifies. The ladder, the plan,
 * the watch and the race plan do not read it.
 */
export function RaceRateCard({ hold }: RaceRateCardProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={labStyles.section}>
      <h2 id={headingId} className={labStyles.heading}>
        {labText.holdHeading()}
      </h2>
      <p className={labStyles.note}>{labText.holdIntro(rateText(hold.rate))}</p>
      <ul className={labStyles.list}>
        <li className={`${labStyles.item} ${labStyles.lead}`}>
          {labText.holdLongest(hold.longest)}
        </li>
        <li className={`${labStyles.item} ${labStyles.lead}`}>{labText.holdDayTwo(hold.dayTwo)}</li>
      </ul>
    </section>
  )
}

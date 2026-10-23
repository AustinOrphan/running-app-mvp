import { useId } from 'react'
import type { FuelBlockView } from '../../../shared/types.ts'
import { labText } from './fuelText.ts'
import labStyles from './FuelLab.module.css'

export interface GutBlockCardProps {
  block: FuelBlockView
  /** The clinician line for a diagnosed gut condition; null without one. */
  clinician: string | null
}

/**
 * The gut-training block as the stored plan holds it: the dates of its weeks, ending before the
 * taper, what it claims ("may improve how well you tolerate carbohydrate") and what it does not
 * (a faster time, protection of the gut lining), and a note that a run of an hour or more in those
 * weeks counts even when the app did not link it to a session. A diagnosed gut condition removes
 * the block and shows the clinician line instead of the claim. The sentences about what training
 * may do come from the server (rule H7); the dates are the plan's.
 */
export function GutBlockCard({ block, clinician }: GutBlockCardProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={labStyles.section}>
      <h2 id={headingId} className={labStyles.heading}>
        {labText.blockHeading()}
      </h2>
      {block.state === 'locked' ? (
        <>
          <p className={labStyles.lead}>{labText.blockLocked()}</p>
          {clinician === null ? null : <p className={labStyles.lead}>{clinician}</p>}
        </>
      ) : null}
      {block.state === 'off' ? <p className={labStyles.lead}>{labText.blockOff()}</p> : null}
      {block.state === 'none' ? <p className={labStyles.lead}>{labText.blockNone()}</p> : null}
      {block.state === 'planned' && block.from !== null && block.to !== null ? (
        <>
          <p className={labStyles.lead}>{labText.blockPlanned(block.from, block.to)}</p>
          <ul className={labStyles.list}>
            {block.weeks.map((monday) => (
              <li key={monday} className={labStyles.note}>
                {labText.blockWeek(monday)}
              </li>
            ))}
          </ul>
          <p className={labStyles.note}>{labText.blockCounts()}</p>
        </>
      ) : null}
      {block.removalPending ? <p className={labStyles.note}>{labText.blockRemoval()}</p> : null}
      {block.lines.map((line) => (
        <p key={line} className={labStyles.lead}>
          {line}
        </p>
      ))}
    </section>
  )
}

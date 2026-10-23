import { useId } from 'react'
import { isToRun } from '../../../shared/domain/sessionStatus.ts'
import { fuelEligible } from '../../../shared/engine/fuel.ts'
import type { PlanSession } from '../../../shared/types.ts'
import { useFuelLab, useFuelTargets } from '../../api/fuel.ts'
import { FuelTargetDetails } from './FuelTargetDetails.tsx'
import styles from './FuelSections.module.css'

/**
 * The Fuel section of the session sheet: the target of a run still to be run, with the reason, the
 * fluid and sodium wording, the nausea plan and the safety card. It asks for the targets of the
 * session's day only when the session can carry one (a run still to be run that is long enough),
 * and renders nothing for any other session, so short runs and settled sessions make no request.
 */
export function FuelSessionSection({ session }: { session: PlanSession }) {
  const headingId = useId()
  const mayCarry =
    isToRun(session.status) &&
    fuelEligible(session.durationMin, session.flags.includes('fuel-practice'))
  const targets = useFuelTargets(session.date, session.date, { enabled: mayCarry })
  const view = targets.data?.find((candidate) => candidate.session.id === session.id) ?? null
  // The safety card comes with the lab view, which also tells whether the goal is a long one.
  const lab = useFuelLab({ enabled: view !== null })
  if (view === null) return null

  return (
    <section aria-labelledby={headingId} className={styles.sheetSection}>
      <h3 id={headingId} className={styles.sheetHeading}>
        {view.text.heading}
      </h3>
      <FuelTargetDetails view={view} eah={lab.data?.eah ?? null} />
    </section>
  )
}

import { useId, useState } from 'react'
import { fuelTotals, minutesOf } from '../../../shared/domain/fuel.ts'
import { fuelEligible } from '../../../shared/engine/fuel.ts'
import { loggedTotalText, stepNote } from '../../../shared/engine/fuelCopy.ts'
import type { Activity, FuelLogView } from '../../../shared/types.ts'
import { useFuelLog } from '../../api/fuel.ts'
import { Button } from '../Button.tsx'
import { Skeleton } from '../Skeleton.tsx'
import { FuelLogSheet } from './FuelLogSheet.tsx'
import { fuelText } from './fuelText.ts'
import styles from './FuelSections.module.css'

/** What a saved log says: the items, the total against the target, the scores and whether it counted. */
function LogSummary({ log, activity }: { log: FuelLogView; activity: Activity }) {
  if (log.skipped) return <p className={styles.line}>{log.counts}</p>
  const total = loggedTotalText({
    carbsG: fuelTotals(log.items).carbsG,
    elapsedSec: activity.durationSec,
    target: log.step.rung,
  })
  // A run that did not count says why in the counts line; the step note would only repeat it.
  const note = log.step.outcome === 'not-counted' ? null : stepNote(log.step)
  return (
    <>
      {log.items.length === 0 ? null : (
        <ul className={styles.items}>
          {log.items.map((item, index) => (
            <li key={`${item.name}:${String(index)}`}>
              {fuelText.itemLine(item.servings, item.name)}
            </li>
          ))}
        </ul>
      )}
      {total === null || log.items.length === 0 ? null : <p className={styles.line}>{total}</p>}
      <dl className={styles.facts}>
        {log.gut === null ? null : (
          <div className={styles.fact}>
            <dt>{fuelText.gutLegend()}</dt>
            <dd>{fuelText.scoreValue(log.gut)}</dd>
          </div>
        )}
        {log.nausea === null ? null : (
          <div className={styles.fact}>
            <dt>{fuelText.nauseaTerm()}</dt>
            <dd>{fuelText.scoreValue(log.nausea)}</dd>
          </div>
        )}
        {log.fluidMl === null ? null : (
          <div className={styles.fact}>
            <dt>{fuelText.fluidLegend()}</dt>
            <dd>{fuelText.fluidLogged(log.fluidMl)}</dd>
          </div>
        )}
      </dl>
      {log.step.hot ? <p className={styles.line}>{fuelText.hotDay()}</p> : null}
      <p className={styles.line}>{log.counts}</p>
      {note === null ? null : <p className={styles.line}>{note}</p>}
    </>
  )
}

/**
 * The Fuel section of the activity page: what was logged for this run and whether it counted
 * toward the ladder, with Log fuel or Edit fuel log to open the form. It shows for a run long
 * enough to count in a gut-training week (the shorter length), and for no other activity.
 */
export function FuelSection({ activity }: { activity: Activity }) {
  const headingId = useId()
  const [open, setOpen] = useState(false)
  const eligible =
    (activity.type === 'run' || activity.type === 'race') &&
    fuelEligible(minutesOf(activity.durationSec), true)
  const log = useFuelLog(activity.id, { enabled: eligible })
  if (!eligible) return null

  const logged = log.data !== null && log.data !== undefined && !log.data.skipped

  return (
    <section aria-labelledby={headingId} className={styles.pageSection}>
      <h2 id={headingId} className={styles.pageHeading}>
        {fuelText.sectionHeading()}
      </h2>
      {log.isError ? (
        <p role="alert" className={styles.error}>
          {fuelText.sectionError()}
        </p>
      ) : log.data === undefined ? (
        <Skeleton lines={2} />
      ) : log.data === null ? (
        <p className={styles.line}>{fuelText.noneYet()}</p>
      ) : (
        <LogSummary log={log.data} activity={activity} />
      )}
      {log.isError || log.data === undefined ? null : (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(true)
            }}
          >
            {logged ? fuelText.edit() : fuelText.logFuel()}
          </Button>
        </div>
      )}
      {open ? (
        <FuelLogSheet
          activityId={activity.id}
          onClose={() => {
            setOpen(false)
          }}
          onDone={() => {
            setOpen(false)
          }}
        />
      ) : null}
    </section>
  )
}

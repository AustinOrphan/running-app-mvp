import { useEffect, useId, useRef, useState } from 'react'
import type { FuelPrompt, Units } from '../../../shared/types.ts'
import { useSkipFuelLog } from '../../api/fuel.ts'
import { Button } from '../Button.tsx'
import { useToast } from '../Toast.tsx'
import { FuelLogSheet } from '../lazySheets.tsx'
import { fuelText } from './fuelText.ts'
import styles from './FuelPromptCard.module.css'

export interface FuelPromptCardProps {
  /** Recent runs without a fuel log, newest first; the server sends at most three. */
  prompts: FuelPrompt[]
  units: Units
}

/**
 * "Fuel log": the recent runs long enough to count that have no log yet, each with Log fuel (the
 * 20-second form in a sheet) and "Not this time" (the run does not count toward the ladder and is
 * not asked about again). It sits below the fold in the `fuelPrompt` slot and never nags: a run
 * that is answered either way leaves the list.
 */
export function FuelPromptCard({ prompts, units }: FuelPromptCardProps) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const toast = useToast()
  const skip = useSkipFuelLog()
  const [open, setOpen] = useState<string | null>(null)
  const [refocus, setRefocus] = useState(0)
  const [notMarked, setNotMarked] = useState<string | null>(null)

  // A prompt that was answered leaves the list, and with it the button that had focus, so focus
  // goes to the card's heading; the sheet has been closed by then, which moved it to the page.
  useEffect(() => {
    if (refocus > 0) heading.current?.focus()
  }, [refocus])

  if (prompts.length === 0) return null

  function done(): void {
    setOpen(null)
    setRefocus((count) => count + 1)
  }

  function notThisTime(activityId: string): void {
    setNotMarked(null)
    skip.mutateAsync(activityId).then(
      (result) => {
        if (result.message !== null) toast.show(result.message)
        setRefocus((count) => count + 1)
      },
      (error: Error) => {
        setNotMarked(fuelText.notMarked(error.message))
      },
    )
  }

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className={styles.heading}>
        {fuelText.logHeading()}
      </h2>
      <p className={styles.lead}>{fuelText.promptLead()}</p>
      <ul className={styles.list}>
        {prompts.map((prompt) => {
          const run = fuelText.promptRun(prompt, units)
          return (
            <li key={prompt.activityId} className={styles.item}>
              <p className={styles.run}>{run}</p>
              <div className={styles.actions}>
                <Button
                  variant="secondary"
                  aria-label={fuelText.logFor(run)}
                  onClick={() => {
                    setOpen(prompt.activityId)
                  }}
                >
                  {fuelText.logFuel()}
                </Button>
                <Button
                  variant="quiet"
                  aria-label={fuelText.skipFor(run)}
                  loading={skip.isPending && skip.variables === prompt.activityId}
                  onClick={() => {
                    notThisTime(prompt.activityId)
                  }}
                >
                  {fuelText.skip()}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      {notMarked === null ? null : (
        <p role="alert" className={styles.error}>
          {notMarked}
        </p>
      )}
      {open === null ? null : (
        <FuelLogSheet
          activityId={open}
          onClose={() => {
            setOpen(null)
          }}
          onDone={done}
        />
      )}
    </section>
  )
}

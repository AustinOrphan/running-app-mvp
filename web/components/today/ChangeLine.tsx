import { useState } from 'react'
import type { ChangeLine as ChangeLineData, Units } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import { localiseEngineText } from '../engineText.ts'
import { ChangeSheet } from './ChangeSheet.tsx'
import styles from './ChangeLine.module.css'

/**
 * One line on what the last update of the plan changed, with the stored summary as the plan wrote
 * it and a Details button for the sheet. It fills the `brief` slot, whose budget is 52 px at 360
 * px, so the summary is held to two lines; the sheet shows it whole.
 */
export function ChangeLine({ change, units }: { change: ChangeLineData; units: Units }) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-label="What changed" className={styles.line}>
      <p className={styles.text}>{localiseEngineText(change.summary, units)}</p>
      <Button
        variant="quiet"
        aria-label="Details of this update"
        onClick={() => {
          setOpen(true)
        }}
      >
        Details
      </Button>
      <ChangeSheet
        open={open}
        change={change}
        units={units}
        onClose={() => {
          setOpen(false)
        }}
      />
    </section>
  )
}

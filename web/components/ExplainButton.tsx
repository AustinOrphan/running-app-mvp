import { useState } from 'react'
import type { ExplainRef } from '../api/explain.ts'
import { Button } from './Button.tsx'
import styles from './ExplainButton.module.css'
import { WhyDrawer } from './WhyDrawer.tsx'

export interface ExplainButtonProps {
  /** What the figures are, so the button names them for assistive technology. */
  subject: string
  /** Rule ids such as `d-4`; the drawer resolves them to parameters, grades and papers. */
  rules: string[]
  /**
   * What the figures are about (a session, a week, a prediction, a run). The drawer opens on the
   * runner's numbers for it; without it only the rules are read.
   */
  explain?: ExplainRef
  /**
   * An info icon (a circle with an "i") in place of the word, for a note whose line it ends: the
   * parent is a flex row that holds the note's text, and the icon takes the right end of the
   * first line instead of a line of its own. The name and the drawer are the same.
   */
  icon?: boolean
}

/** A circle with an "i", drawn in the colour of the button that holds it. */
function InfoIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="7.75" r="1.25" fill="currentColor" />
      <path d="M12 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** A quiet "Why" button that opens the evidence drawer for the figures beside it. */
export function ExplainButton({ subject, rules, explain, icon = false }: ExplainButtonProps) {
  const [open, setOpen] = useState(false)
  const show = () => {
    setOpen(true)
  }
  return (
    <>
      {icon ? (
        <button type="button" className={styles.info} aria-label={`Why: ${subject}`} onClick={show}>
          <InfoIcon />
        </button>
      ) : (
        <Button variant="quiet" aria-label={`Why: ${subject}`} onClick={show}>
          Why
        </Button>
      )}
      <WhyDrawer
        explain={explain}
        rules={rules}
        open={open}
        onClose={() => {
          setOpen(false)
        }}
      />
    </>
  )
}

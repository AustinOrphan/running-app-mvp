import { useState } from 'react'
import type { ExplainRef } from '../api/explain.ts'
import { Button } from './Button.tsx'
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
}

/** A quiet "Why" button that opens the evidence drawer for the figures beside it. */
export function ExplainButton({ subject, rules, explain }: ExplainButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="quiet"
        aria-label={`Why: ${subject}`}
        onClick={() => {
          setOpen(true)
        }}
      >
        Why
      </Button>
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

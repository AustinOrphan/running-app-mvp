import { useState } from 'react'
import { Button } from './Button.tsx'
import { WhyDrawer } from './WhyDrawer.tsx'

export interface ExplainButtonProps {
  /** What the figures are, so the button names them for assistive technology. */
  subject: string
  /** Rule ids such as `d-4`; the drawer resolves them to parameters, grades and papers. */
  rules: string[]
}

/** A quiet "Why" button that opens the evidence drawer for the figures beside it. */
export function ExplainButton({ subject, rules }: ExplainButtonProps) {
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
        rules={rules}
        open={open}
        onClose={() => {
          setOpen(false)
        }}
      />
    </>
  )
}

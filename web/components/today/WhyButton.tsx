import { useState } from 'react'
import type { ExplainRef } from '../../api/explain.ts'
import { Button } from '../Button.tsx'
import { WhyDrawer } from '../WhyDrawer.tsx'

export interface WhyButtonProps {
  /** What the button says and is named: "Why this session". */
  label: string
  /** What the figures are about; the drawer opens on the runner's numbers for it. */
  explain: ExplainRef
  /** Rule ids such as `j-2`, shown with their parameters and papers. */
  rules: string[]
}

/**
 * A quiet button on Today that opens the why drawer on its own subject. Each button owns its drawer,
 * so the subject is decided where the figure is shown and not by the page that composes them.
 */
export function WhyButton({ label, explain, rules }: WhyButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="quiet"
        onClick={() => {
          setOpen(true)
        }}
      >
        {label}
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

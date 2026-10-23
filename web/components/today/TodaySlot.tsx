import { Children, type ReactNode } from 'react'
import { SLOT_BUDGETS_PX, type SlotName } from './slots.ts'

/**
 * A named place on Today for one line or card from a later epic. Without content it renders
 * nothing; with content it wraps it in `<div data-slot data-budget-px>`. An unbudgeted slot has no
 * `data-budget-px`.
 */
export function TodaySlot({ name, children }: { name: SlotName; children?: ReactNode }) {
  const hasContent = Children.toArray(children).some((child) => child !== '')
  if (!hasContent) return null
  const budget = SLOT_BUDGETS_PX[name]
  return (
    <div data-slot={name} data-budget-px={budget ?? undefined}>
      {children}
    </div>
  )
}

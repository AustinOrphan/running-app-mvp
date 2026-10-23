import { Children, type ReactNode } from 'react'
import { SLOT_BUDGETS_PX, type SlotName } from './slots.ts'

/** Whether a slot was given anything to show; an empty string, list, null or false is nothing. */
export function hasSlotContent(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => child !== '')
}

/**
 * The wrapper of a named slot: `<div data-slot data-budget-px>` around its content, and nothing at
 * all while it has none, so an empty slot costs no height. An unbudgeted slot has no
 * `data-budget-px`. A slot mount (`slotMounts.tsx`) builds its content and hands it to this frame.
 */
export function SlotFrame({ name, children }: { name: SlotName; children?: ReactNode }) {
  if (!hasSlotContent(children)) return null
  const budget = SLOT_BUDGETS_PX[name]
  return (
    <div data-slot={name} data-budget-px={budget ?? undefined}>
      {children}
    </div>
  )
}

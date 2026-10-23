import type { ReactNode } from 'react'
import { hasSlotContent, SlotFrame } from './SlotFrame.tsx'
import { SLOT_MOUNTS } from './slotMounts.tsx'
import type { SlotName } from './slots.ts'

/**
 * A named place on Today for one line or card from a later epic. Given content it wraps it in
 * `<div data-slot data-budget-px>` (`SlotFrame`). Given none it renders the mount registered for
 * the slot in `slotMounts.tsx`, which reads the Today payload itself, so the page that places the
 * slot needs no edit when an epic fills it; a slot with neither renders nothing.
 */
export function TodaySlot({ name, children }: { name: SlotName; children?: ReactNode }) {
  const Mount = SLOT_MOUNTS[name]
  if (Mount !== undefined && !hasSlotContent(children)) return <Mount />
  return <SlotFrame name={name}>{children}</SlotFrame>
}

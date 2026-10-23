import type { ReactNode } from 'react'
import type { PlanSession } from '../../../shared/types.ts'
import { AdjustSection } from '../disruption/AdjustSection.tsx'
import { Sheet } from '../Sheet.tsx'

export interface NotTodaySheetProps {
  /** The planned session the Not today button belongs to. */
  session: PlanSession
  /** Closes the sheet with nothing changed (Close, Escape, the scrim). */
  onClose: () => void
  /** Called in place of `onClose` after the session was moved or skipped. */
  onChanged: () => void
  /**
   * Room for what a later epic adds above the move and skip controls: E5's "Not 100%" entry
   * (`NotFullEntry`, which the hero passes). The sheet does not know what it is given.
   */
  children?: ReactNode
}

/**
 * What "Not today" opens: move the session to another day or skip it ("A skipped session is not
 * made up later."), through `AdjustSection`, which asks the server whether the change is allowed
 * (spacing, the weekly limits) before it saves, and closes the sheet once a change is applied.
 */
export function NotTodaySheet({ session, onClose, onChanged, children }: NotTodaySheetProps) {
  return (
    <Sheet open onClose={onClose} title="Not today">
      {children}
      <AdjustSection session={session} onApplied={onChanged} />
    </Sheet>
  )
}

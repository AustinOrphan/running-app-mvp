import type { ReactNode } from 'react'
import type { PlanSession } from '../../../shared/types.ts'
import { SessionChanges } from '../SessionChanges.tsx'
import { Sheet } from '../Sheet.tsx'

export interface NotTodaySheetProps {
  /** The planned session the Not today button belongs to. */
  session: PlanSession
  /** Closes the sheet with nothing changed (Close, Escape, the scrim). */
  onClose: () => void
  /** Called in place of `onClose` after the session was moved or skipped. */
  onChanged: () => void
  /**
   * Room for what a later epic adds above the move and skip controls: E5's "Not 100%" entry and
   * its live guards. The sheet does not know what it is given.
   */
  children?: ReactNode
}

/**
 * What "Not today" opens: move the session to another day or skip it ("A skipped session is not
 * made up later."), through `SessionChanges`, which checks a move against spacing and the weekly
 * limits before it saves.
 */
export function NotTodaySheet({ session, onClose, onChanged, children }: NotTodaySheetProps) {
  return (
    <Sheet open onClose={onClose} title="Not today">
      {children}
      <SessionChanges session={session} onClose={onChanged} />
    </Sheet>
  )
}

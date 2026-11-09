import type { ReactNode } from 'react'
import { Button } from './Button.tsx'
import { AlertGlyph, TrashGlyph } from './Glyphs.tsx'
import { Sheet } from './Sheet.tsx'
import styles from './ConfirmSheet.module.css'

export interface ConfirmSheetProps {
  open: boolean
  /** The question, which is also the dialog's name ("Delete this activity?"). */
  title: string
  /** What the confirming button says ("Delete activity"). */
  confirmLabel: string
  /** What the other button says. */
  keepLabel?: string
  /** The action is under way: the sheet stays open and cannot be dismissed. */
  pending?: boolean
  /** A refusal to show under the question; the sheet stays open. */
  error?: string | null
  onConfirm: () => void
  onClose: () => void
  /** A line that says what goes and what stays, under the title. */
  children?: ReactNode
}

/**
 * The confirm step of a destructive action (visual design 11): a sheet with the question as its
 * title, the safe choice first and in the primary style, and a secondary button with a trash glyph
 * that does it. Nothing here is red. Focus starts on the safe button and goes back to whatever
 * opened the sheet (`Sheet`).
 */
export function ConfirmSheet({
  open,
  title,
  confirmLabel,
  keepLabel = 'Keep',
  pending = false,
  error,
  onConfirm,
  onClose,
  children,
}: ConfirmSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={title} busy={pending}>
      {children === undefined ? null : <p className={styles.lead}>{children}</p>}
      {error === undefined || error === null || error === '' ? null : (
        <p role="alert" className={styles.error}>
          <AlertGlyph />
          <span>{error}</span>
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="primary" busy={pending} onClick={onClose}>
          {keepLabel}
        </Button>
        <Button variant="secondary" busy={pending} onClick={onConfirm}>
          <TrashGlyph />
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  )
}

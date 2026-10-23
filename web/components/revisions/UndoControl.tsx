import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { undoDoneText, undoReasonLine, undoWords } from '../../../shared/copy/revisionView.ts'
import { todayIso } from '../../../shared/dates.ts'
import type { PlanPreview, PlanRevisionView, UndoReason, Units } from '../../../shared/types.ts'
import { ApiError } from '../../api/client.ts'
import { usePreviewUndo, useUndoRevision } from '../../api/plan.ts'
import { Button } from '../Button.tsx'
import { useToast } from '../Toast.tsx'
import { PlanDiffView } from './PlanDiffView.tsx'
import styles from './UndoControl.module.css'

export interface UndoControlProps {
  revision: PlanRevisionView
  units: Units
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The newer preview a 409 `stale-preview` carries, or null for any other answer. */
function stalePreviewOf(details: unknown): PlanPreview | null {
  if (!isRecord(details) || details['code'] !== 'stale-preview') return null
  const preview = details['preview']
  return isRecord(preview) && typeof preview['hash'] === 'string'
    ? (preview as unknown as PlanPreview)
    : null
}

/** The reasons a 409 carries when the revision can no longer be undone, or an empty list. */
function reasonsOf(details: unknown): UndoReason[] {
  if (!isRecord(details) || !Array.isArray(details['reasons'])) return []
  return details['reasons'].filter(
    (reason): reason is UndoReason => isRecord(reason) && typeof reason['code'] === 'string',
  )
}

/**
 * Undo for one revision. When the revision can be undone it offers "Undo update": that asks the
 * server what undoing would change (`POST /api/plan/preview`, which writes nothing), shows the
 * restore diff with the confirm sentences, and applies it only on a second tap, with the preview's
 * hash so a plan that moved in between answers with a newer preview instead of an unseen change.
 * When it cannot be undone it says why, as muted lines, from the reasons the server gave. Focus
 * moves into the confirm when it opens and back to the button when it closes.
 */
export function UndoControl({ revision, units }: UndoControlProps) {
  const headingId = useId()
  const toast = useToast()
  const previewUndo = usePreviewUndo()
  const undo = useUndoRevision()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<PlanPreview | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [refused, setRefused] = useState<UndoReason[]>([])
  const [failure, setFailure] = useState<'preview' | 'undo' | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const confirm = useRef<HTMLElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<'button' | 'control' | null>(null)

  useEffect(() => {
    if (open) {
      confirm.current?.focus()
    } else if (returnTo.current !== null) {
      const target = returnTo.current === 'button' ? (button.current ?? root.current) : root.current
      returnTo.current = null
      target?.focus()
    }
  }, [open])

  const words = undoWords({ auto: revision.auto, today: preview?.today ?? todayIso(), units })

  function start() {
    setOpen(true)
    setPreview(null)
    setNotice(null)
    setRefused([])
    setFailure(null)
    previewUndo.mutate(revision.id, {
      onSuccess: setPreview,
      onError: () => {
        setFailure('preview')
      },
    })
  }

  function close() {
    returnTo.current = 'button'
    setOpen(false)
  }

  function commit() {
    if (preview === null || preview.blocked) return
    setNotice(null)
    setRefused([])
    setFailure(null)
    undo.mutate(
      { id: revision.id, expectHash: preview.hash },
      {
        onSuccess: () => {
          toast.show(undoDoneText(todayIso(new Date(revision.createdAt)), units))
          returnTo.current = 'control'
          setOpen(false)
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            const newer = stalePreviewOf(error.details)
            if (newer !== null) {
              setPreview(newer)
              setNotice(error.message)
              return
            }
            const reasons = reasonsOf(error.details)
            if (reasons.length > 0) {
              setRefused(reasons)
              return
            }
          }
          if (error instanceof ApiError && error.status === 422) {
            setRefused([{ code: 'checklist', message: error.message }])
            return
          }
          setFailure('undo')
        },
      },
    )
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || undo.isPending) return
    // The control may sit inside a sheet, which closes on Escape too: only the confirm closes.
    event.stopPropagation()
    close()
  }

  const reasons: Array<Pick<UndoReason, 'code' | 'message'>> =
    revision.undo.reasons.length > 0
      ? revision.undo.reasons
      : [{ code: 'not-undoable', message: '' }]

  if (!open) {
    return (
      <div ref={root} tabIndex={-1} className={styles.control}>
        {revision.undo.available ? (
          <Button ref={button} variant="secondary" onClick={start}>
            {words.button}
          </Button>
        ) : (
          <ul className={styles.reasons} aria-label={words.whyNot}>
            {reasons.map((reason, index) => (
              <li key={`${reason.code}-${String(index)}`}>{undoReasonLine(reason, units)}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const shownReasons = refused.length > 0 ? refused : (preview?.reasons ?? [])
  const blocked = preview !== null && (preview.blocked || refused.length > 0)
  return (
    <div ref={root} tabIndex={-1} className={styles.control}>
      <section
        ref={confirm}
        role="dialog"
        aria-modal="false"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={styles.confirm}
        onKeyDown={onKeyDown}
      >
        <p id={headingId} className={styles.heading}>
          {words.heading}
        </p>
        {failure === 'preview' ? (
          <p role="alert" className={styles.text}>
            {words.previewError}
          </p>
        ) : null}
        {failure === 'undo' ? (
          <p role="alert" className={styles.text}>
            {words.error}
          </p>
        ) : null}
        {preview === null && failure === null ? (
          <p role="status" className={styles.muted}>
            {words.loading}
          </p>
        ) : null}
        {preview !== null ? (
          <>
            <p className={styles.text}>{words.question}</p>
            <p className={styles.text}>{words.stays}</p>
            {words.nextUpdate !== null ? <p className={styles.text}>{words.nextUpdate}</p> : null}
            {notice !== null ? (
              <p role="status" className={styles.text}>
                {notice}
              </p>
            ) : null}
            {blocked ? (
              <div>
                <p className={styles.text}>{words.blocked}</p>
                <ul className={styles.reasons} aria-label={words.whyNot}>
                  {shownReasons.map((reason, index) => (
                    <li key={`${reason.code}-${String(index)}`}>{undoReasonLine(reason, units)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className={styles.subheading}>{words.restores}</p>
            <PlanDiffView diff={preview.diff} units={units} label={words.restores} />
          </>
        ) : null}
        <div className={styles.actions}>
          {preview !== null && !blocked ? (
            <Button variant="primary" loading={undo.isPending} onClick={commit}>
              {words.button}
            </Button>
          ) : null}
          <Button variant="quiet" disabled={undo.isPending} onClick={close}>
            {blocked || failure !== null ? words.close : words.keep}
          </Button>
        </div>
      </section>
    </div>
  )
}

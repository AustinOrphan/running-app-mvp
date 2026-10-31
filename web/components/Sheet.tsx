import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button.tsx'
import { focusMain, isFocusLost } from './focusMain.ts'
import styles from './Sheet.module.css'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

/**
 * The sheets that are open, the newest last. A sheet can open over another (the logging sheet over
 * the session's, the Why drawer over either), and each one listens for keys on the document, so
 * without an order they would all answer one Escape and all pull Tab to their own controls. Only the
 * top sheet answers; the ones under it are `inert`, which keeps focus, clicks and assistive
 * technology off them until the sheet over them closes. The attribute is set here at once, not by a
 * render, so the sheet that is back on top can take focus in the same step that its neighbour leaves.
 */
const openSheets: Array<{ id: symbol; root: () => HTMLElement | null }> = []

function syncOpenSheets(): void {
  openSheets.forEach((sheet, index) => {
    const root = sheet.root()
    if (root === null) return
    if (index === openSheets.length - 1) root.removeAttribute('inert')
    else root.setAttribute('inert', '')
  })
}

const focusable =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A modal dialog: a bottom sheet below 900px, a right-hand panel above. Escape and a click on the
 * scrim close it, Tab stays inside (also when focus has fallen to the page), and focus goes back to
 * whatever opened it, or to the main landmark when the opener is gone and focus is lost with it.
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const titleId = useId()
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const id = Symbol('sheet')
    openSheets.push({ id, root: () => root.current })
    syncOpenSheets()
    const first = body.current?.querySelector<HTMLElement>(focusable) ?? panel.current
    first?.focus()

    function onKeyDown(event: globalThis.KeyboardEvent) {
      // a sheet over this one is the one the keys are for
      if (openSheets[openSheets.length - 1]?.id !== id) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      // Focus falls to <body> when the focused control unmounts or becomes disabled, and then the
      // panel's own handler never sees Tab. Bring focus back instead of letting it reach the page.
      const dialog = panel.current
      if (event.key === 'Tab' && dialog && !dialog.contains(document.activeElement)) {
        event.preventDefault()
        const items = [...dialog.querySelectorAll<HTMLElement>(focusable)]
        const target = event.shiftKey ? items[items.length - 1] : items[0]
        ;(target ?? dialog).focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const at = openSheets.findIndex((sheet) => sheet.id === id)
      if (at !== -1) openSheets.splice(at, 1)
      syncOpenSheets()
      if (opener?.isConnected === true) {
        opener.focus()
      } else if (opener !== null && isFocusLost()) {
        // The opener went with the sheet (removing the rest window that the Today banner opened
        // takes the banner away), and so did the focused control. The main landmark is the one
        // stable place left, and it keeps the page where it is.
        focusMain()
      }
    }
  }, [open])

  if (!open) return null

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    // a key from a sheet opened over this one reaches here through the React tree, not the DOM
    if (event.key !== 'Tab' || !panel.current || !panel.current.contains(event.target as Node))
      return
    const items = [...panel.current.querySelectorAll<HTMLElement>(focusable)]
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) {
      event.preventDefault()
      panel.current.focus()
      return
    }
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div ref={root} className={styles.root}>
      <div className={styles.scrim} data-testid="sheet-scrim" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.panel}
        onKeyDown={trapTab}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
        <div ref={body} className={styles.body}>
          {children}
        </div>
        {footer !== undefined ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

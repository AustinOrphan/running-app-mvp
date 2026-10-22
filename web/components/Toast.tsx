import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from './Button.tsx'
import styles from './Toast.module.css'

export interface ToastOptions {
  action?: { label: string; onClick(): void }
}

export interface ToastApi {
  show(message: string, opts?: ToastOptions): void
}

interface ToastItem {
  id: number
  message: string
  action?: ToastOptions['action']
}

const TOAST_MS = 4000

/** Outside a provider (a page rendered on its own in a test) showing a toast does nothing. */
const ToastContext = createContext<ToastApi>({
  show: () => {},
})

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

/** Hosts the live region; toasts last 4 s. Errors belong in the form, not here. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) clearTimeout(timer)
    timers.current.delete(id)
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (message: string, opts?: ToastOptions) => {
      const id = nextId.current
      nextId.current += 1
      setToasts((current) => [...current, { id, message, action: opts?.action }])
      timers.current.set(
        id,
        setTimeout(() => {
          dismiss(id)
        }, TOAST_MS),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div role="status" className={styles.region}>
        {toasts.map((toast) => (
          <div key={toast.id} className={styles.toast}>
            <span>{toast.message}</span>
            {toast.action ? (
              <Button
                variant="quiet"
                onClick={() => {
                  toast.action?.onClick()
                  dismiss(toast.id)
                }}
              >
                {toast.action.label}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

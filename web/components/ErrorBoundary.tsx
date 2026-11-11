import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { reportClientError } from '../pwa/clientErrors.ts'
import { Button } from './Button.tsx'
import styles from './ErrorState.module.css'

const originalStacks = new WeakMap<object, string>()

/**
 * Keeps the component stack of the first boundary that saw `error`. A `ChunkBoundary` rethrows an
 * error that is not a failed chunk load, and the boundary above it sees a stack that starts at the
 * rethrower; this one names the component that threw. The first call for an error wins.
 */
export function rememberComponentStack(error: unknown, componentStack: string | null | undefined) {
  if (typeof error !== 'object' || error === null || !componentStack) return
  if (!originalStacks.has(error)) originalStacks.set(error, componentStack)
}

export interface ErrorBoundaryProps {
  /**
   * `app` stands in for the whole app and offers a reload only. `page` stands in for one routed
   * page, inside the layout, so the navigation still works.
   */
  scope: 'app' | 'page'
  /** When this changes, a caught error is cleared: leaving the page that failed shows the next one. */
  resetKey?: string
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * Catches a render-time error that no boundary below answered for (a page, or a lazy sheet that
 * threw; a `ChunkBoundary` rethrows everything but a failed chunk load). Shows a calm screen with a
 * Reload button in place of the blank page that React leaves when nothing catches. The error goes
 * to the console with its component stack, for Safari's Web Inspector, and once to the server
 * (`reportClientError`).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const stack =
      (typeof error === 'object' && error !== null ? originalStacks.get(error) : undefined) ??
      info.componentStack
    console.error(`Render error (${this.props.scope} boundary):`, error, stack)
    reportClientError(error, stack)
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    const hint = this.props.scope === 'page' ? 'error.crash-hint-nav' : 'error.crash-hint'
    return (
      <div className={styles.error}>
        <p role="alert" className={styles.title}>
          {render(TEMPLATES['error.crash'], {}, 'km')}
        </p>
        <p className={styles.body}>{render(TEMPLATES[hint], {}, 'km')}</p>
        <div className={styles.action}>
          <Button
            variant="primary"
            onClick={() => {
              window.location.reload()
            }}
          >
            {render(TEMPLATES['error.crash-reload'], {}, 'km')}
          </Button>
        </div>
      </div>
    )
  }
}

/** A page boundary that clears when the route's path changes. */
export function PageBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary scope="page" resetKey={pathname}>
      {children}
    </ErrorBoundary>
  )
}

import { Component, type ReactNode } from 'react'

export interface ChunkBoundaryProps {
  /**
   * Fetches the code again. Resolves when it loaded (the parent then remounts this boundary with a
   * fresh lazy component) and rejects when it did not.
   */
  onRetry: () => Promise<void>
  /** What stands in for the code that did not load. `retrying` is true while `retry` runs. */
  fallback: (state: { retry: () => void; retrying: boolean }) => ReactNode
  children: ReactNode
}

interface ChunkBoundaryState {
  failed: boolean
  retrying: boolean
}

/**
 * Catches the rejection of a lazy import. A `React.lazy` component keeps a rejection for good, so
 * the retry is the parent's: it runs the import again, and on success replaces the lazy component
 * and remounts this boundary. A retry that fails while the browser is online has met a real
 * problem (a release replaced the file), and only then is the document reloaded; offline it stays
 * on the fallback, so the app is never swapped for the browser's offline page.
 */
export class ChunkBoundary extends Component<ChunkBoundaryProps, ChunkBoundaryState> {
  override state: ChunkBoundaryState = { failed: false, retrying: false }
  private mounted = true

  static getDerivedStateFromError(): Partial<ChunkBoundaryState> {
    return { failed: true }
  }

  override componentWillUnmount(): void {
    this.mounted = false
  }

  private retry = (): void => {
    if (this.state.retrying) return
    this.setState({ retrying: true })
    this.props.onRetry().catch(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
        window.location.reload()
        return
      }
      if (this.mounted) this.setState({ retrying: false })
    })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return this.props.fallback({ retry: this.retry, retrying: this.state.retrying })
  }
}

import { Component, type ReactNode } from 'react'

/** The rejection of a lazy import: the one error a `ChunkBoundary` answers for. */
export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super('The code of this part of the app did not load.', { cause })
    this.name = 'ChunkLoadError'
  }
}

/** A lazy factory: the import, with its failure marked as a `ChunkLoadError`. */
export async function loadChunk<T>(load: () => Promise<T>): Promise<{ default: T }> {
  try {
    return { default: await load() }
  } catch (error) {
    throw new ChunkLoadError(error)
  }
}

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
  /** The error caught below: a `ChunkLoadError` is answered for, anything else is thrown on. */
  error: unknown
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
  override state: ChunkBoundaryState = { error: null, failed: false, retrying: false }
  private mounted = true

  static getDerivedStateFromError(error: unknown): Partial<ChunkBoundaryState> {
    return { error, failed: true }
  }

  // Strict Mode mounts, unmounts and mounts the same instance, so the flag is set here too.
  override componentDidMount(): void {
    this.mounted = true
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
    // A bug in a page that did load is not a failed load: let the next boundary up show it.
    if (!(this.state.error instanceof ChunkLoadError)) throw this.state.error
    return this.props.fallback({ retry: this.retry, retrying: this.state.retrying })
  }
}

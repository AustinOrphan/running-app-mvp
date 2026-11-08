import { lazy, useState, type ComponentType } from 'react'
import { ChunkBoundary, loadChunk } from './components/ChunkBoundary.tsx'
import { ErrorState } from './components/ErrorState.tsx'

/** A route's page: loaded the first time the route opens, with `load` to fetch it ahead of that. */
export interface Page {
  Component: ComponentType
  load: () => Promise<unknown>
}

/**
 * A page loaded the first time its route opens, so a visit downloads the code of the page it
 * shows and not of the other twenty. The pages are named exports; the module's own file is
 * unchanged. When the code cannot be fetched (offline with no copy kept, or a release replaced
 * the file) the route shows the failed-load state, and its button runs the import again; see
 * `ChunkBoundary` for when the document is reloaded instead.
 */
export function lazyPage(load: () => Promise<ComponentType>): Page {
  const make = () => lazy(() => loadChunk(load))
  let Loaded = make()
  function Component() {
    const [version, setVersion] = useState(0)
    return (
      <ChunkBoundary
        key={version}
        onRetry={async () => {
          await load()
          Loaded = make()
          setVersion((v) => v + 1)
        }}
        fallback={({ retry, retrying }) => (
          <ErrorState subject="This page" onRetry={retry} retrying={retrying} />
        )}
      >
        <Loaded />
      </ChunkBoundary>
    )
  }
  return { Component, load }
}

/** True on a connection where fetching code nobody asked for yet would cost the runner. */
function savingData(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection
  return (
    connection?.saveData === true ||
    connection?.effectiveType === 'slow-2g' ||
    connection?.effectiveType === '2g'
  )
}

/**
 * Fetches the code of these pages once the app is idle, so moving between tabs asks for nothing
 * more. Skipped on Save-Data and on a 2g connection. A failed fetch is left to the route.
 */
export function warmPages(pages: readonly Page[]): void {
  if (savingData()) return
  const start = () => {
    for (const page of pages) page.load().catch(() => {})
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 5000 })
  } else {
    window.setTimeout(start, 1000)
  }
}

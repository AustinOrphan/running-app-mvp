// The path of the page the runner was on before the current one, for the feedback note (FB1).
// Kept in memory only and never sent by itself; a page opened directly has no earlier page.
let current: string | null = null
let previous: string | null = null

/** Records a visit. A repeat of the current path (a query or tab change) changes nothing. */
export function notePagePath(path: string): void {
  if (path === current) return
  previous = current
  current = path
}

/** The path before the current page, or null when the app was opened on this page. */
export function previousPagePath(): string | null {
  return previous
}

/** Back to a fresh page load, for tests. */
export function resetPageTrailForTests(): void {
  current = null
  previous = null
}

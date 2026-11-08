import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from './client.ts'

/** Which line of copy an export refusal gets, by its status and the server's `details.code`. */
export type ExportRefusal = 'running' | 'rate' | 'too-big' | 'error'

export function exportRefusal(error: unknown): ExportRefusal {
  if (!(error instanceof ApiError)) return 'error'
  const code = (error.details as { code?: unknown } | undefined)?.code
  if (error.status === 429) return code === 'export-running' ? 'running' : 'rate'
  if (error.status === 413 && code === 'export-too-many-files') return 'too-big'
  return 'error'
}

/**
 * Starts the download in two steps. The first asks the server for a one-time token (and learns of
 * a refusal: an export already running, a history too large for one ZIP). The second hands the
 * token to the browser as an ordinary link to `GET /api/export`, so the browser's download manager
 * streams the archive to disk and the page never holds it in memory. A failure after the link is
 * followed is the browser's to show; the server has checked everything it can before that.
 */
async function startExport(): Promise<void> {
  const { token } = await api<{ token: string }>('POST', '/export/token')
  const link = document.createElement('a')
  link.href = `/api/export?token=${encodeURIComponent(token)}`
  link.download = ''
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
}

export function useDownloadExport() {
  return useMutation({ mutationFn: startExport })
}

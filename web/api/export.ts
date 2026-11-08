import { useMutation } from '@tanstack/react-query'
import { ApiError, UNAUTHORIZED_EVENT } from './client.ts'

const FALLBACK_NAME = 'running-log-export.zip'

function isErrorBody(value: unknown): value is { error: { code: string; message: string } } {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = (value as { error: unknown }).error
  return typeof error === 'object' && error !== null && 'message' in error
}

/** The file name the server chose (`running-log-export-YYYY-MM-DD.zip`), or a plain one. */
function fileNameOf(response: Response): string {
  const match = /filename="([^"\\/]+)"/.exec(response.headers.get('Content-Disposition') ?? '')
  return match?.[1] ?? FALLBACK_NAME
}

/**
 * Asks for the archive and hands it to the browser as a download. It is read as a whole in memory
 * (a `Blob`), because a plain link could not show a busy state or a refusal; an archive of years of
 * runs is tens or hundreds of megabytes. A refusal is an `ApiError` (429 when an export is already
 * running), and so is an archive cut off on the way, which the browser reports as a network error.
 */
async function downloadExport(): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/export', {
      credentials: 'same-origin',
      headers: { Accept: 'application/zip' },
    })
  } catch {
    throw new ApiError(0, 'internal', 'The server did not respond.')
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }
    if (isErrorBody(payload)) {
      throw new ApiError(
        response.status,
        payload.error.code as ApiError['code'],
        payload.error.message,
      )
    }
    throw new ApiError(response.status, 'internal', 'The server returned an unexpected response.')
  }
  let blob: Blob
  try {
    blob = await response.blob()
  } catch {
    throw new ApiError(0, 'internal', 'The archive was cut off.')
  }
  const name = fileNameOf(response)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // Some browsers read the object URL after the click returns, so it is released a minute later.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 60_000)
  return name
}

export function useDownloadExport() {
  return useMutation({ mutationFn: downloadExport })
}

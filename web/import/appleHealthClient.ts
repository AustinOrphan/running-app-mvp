import { processAppleExport } from './appleExport.ts'
import type { AppleExportProgress, AppleExportResult } from './appleExport.ts'

export interface AppleWorkerRequest {
  file: Blob
  timezone: string
}

export type AppleWorkerReply =
  | ({ type: 'progress' } & AppleExportProgress)
  | { type: 'done'; result: AppleExportResult }
  | { type: 'error'; message: string }

export interface AppleImportRun {
  result: Promise<AppleExportResult>
  cancel: () => void
}

/**
 * Starts reading an Apple Health export in a Web Worker. Where there is no Worker (tests), the
 * same code runs on the calling thread.
 */
export function startAppleExport(
  file: Blob,
  timezone: string,
  onProgress: (progress: AppleExportProgress) => void,
): AppleImportRun {
  if (typeof Worker === 'undefined') {
    const controller = new AbortController()
    return {
      result: processAppleExport(file, { timezone, onProgress, signal: controller.signal }),
      cancel: () => controller.abort(),
    }
  }

  const worker = new Worker(new URL('./appleHealth.worker.ts', import.meta.url), {
    type: 'module',
  })
  let stop: () => void = () => {}
  const result = new Promise<AppleExportResult>((resolve, reject) => {
    stop = () => {
      worker.terminate()
      reject(new DOMException('Import cancelled.', 'AbortError'))
    }
    worker.onmessage = (event: MessageEvent<AppleWorkerReply>) => {
      const reply = event.data
      if (reply.type === 'progress') {
        onProgress({ phase: reply.phase, fraction: reply.fraction })
        return
      }
      worker.terminate()
      if (reply.type === 'done') resolve(reply.result)
      else reject(new Error(reply.message))
    }
    worker.onerror = (event: ErrorEvent) => {
      worker.terminate()
      reject(new Error(event.message || 'The export could not be read.'))
    }
    const request: AppleWorkerRequest = { file, timezone }
    worker.postMessage(request)
  })
  // A terminated worker never answers, so cancelling settles the promise itself.
  return { result, cancel: () => stop() }
}

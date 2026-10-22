import { processAppleExport } from './appleExport.ts'
import type { AppleWorkerReply, AppleWorkerRequest } from './appleHealthClient.ts'

/**
 * The Web Worker that reads an Apple Health export off the main thread: `fflate` unzips it as a
 * stream and `saxes` parses `export.xml` as a stream, so a multi-gigabyte file never loads whole.
 */
const scope = self as unknown as {
  postMessage(message: AppleWorkerReply): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<AppleWorkerRequest>) => void,
  ): void
}

scope.addEventListener('message', (event) => {
  const { file, timezone } = event.data
  void processAppleExport(file, {
    timezone,
    onProgress: (progress) => scope.postMessage({ type: 'progress', ...progress }),
  }).then(
    (result) => scope.postMessage({ type: 'done', result }),
    (error: unknown) =>
      scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'The export could not be read.',
      }),
  )
})

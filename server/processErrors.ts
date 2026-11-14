import type { Logger } from 'pino'

type Kind = 'uncaughtException' | 'unhandledRejection'

/**
 * Logs a process-level error at fatal level and exits non-zero, so the container's restart policy
 * takes over: after one of these the process state is not to be trusted. `exit` is a parameter so a
 * test can stub it.
 */
export function createFatalHandler(
  logger: Pick<Logger, 'fatal'>,
  exit: (code: number) => void,
): (kind: Kind, error: unknown) => void {
  return (kind, error) => {
    logger.fatal({ err: error, kind }, 'process error, exiting')
    exit(1)
  }
}

/** Installs the two handlers once, where the server starts. */
export function installProcessErrorHandlers(
  logger: Pick<Logger, 'fatal'>,
  proc: Pick<NodeJS.Process, 'on' | 'exit'> = process,
): void {
  const handle = createFatalHandler(logger, (code) => proc.exit(code))
  proc.on('uncaughtException', (error) => handle('uncaughtException', error))
  proc.on('unhandledRejection', (reason) => handle('unhandledRejection', reason))
}

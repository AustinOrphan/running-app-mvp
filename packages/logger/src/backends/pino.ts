import type { LogEntry, LoggerBackend } from '../logger.js';

export interface PinoBackendOptions {
  pino: any;
  logger?: any;
}

export class PinoBackend implements LoggerBackend {
  private readonly logger: any;

  constructor(options: PinoBackendOptions) {
    if (options.logger) {
      this.logger = options.logger;
    } else if (options.pino) {
      this.logger = options.pino();
    } else {
      throw new Error('PinoBackend requires either pino instance or logger');
    }
  }

  log(entry: LogEntry): void {
    const { level, message, ...rest } = entry;
    this.logger[level](rest, message);
  }

  async flush(): Promise<void> {
    return new Promise((resolve) => {
      if (this.logger.flush) {
        this.logger.flush(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

export function createPinoBackend(options: PinoBackendOptions): LoggerBackend {
  return new PinoBackend(options);
}

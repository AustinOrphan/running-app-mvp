import type { LogEntry, LoggerBackend } from '../logger.js';

export interface WinstonBackendOptions {
  winston: any;
  logger?: any;
}

export class WinstonBackend implements LoggerBackend {
  private readonly logger: any;

  constructor(options: WinstonBackendOptions) {
    if (options.logger) {
      this.logger = options.logger;
    } else if (options.winston) {
      this.logger = options.winston.createLogger({
        format: options.winston.format.json(),
        transports: [new options.winston.transports.Console()],
      });
    } else {
      throw new Error(
        'WinstonBackend requires either winston instance or logger'
      );
    }
  }

  log(entry: LogEntry): void {
    this.logger.log(entry);
  }

  async flush(): Promise<void> {
    return new Promise((resolve) => {
      if (this.logger.close) {
        this.logger.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

export function createWinstonBackend(
  options: WinstonBackendOptions
): LoggerBackend {
  return new WinstonBackend(options);
}

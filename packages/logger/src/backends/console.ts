import type { LogEntry, LoggerBackend } from '../logger.js';

export interface ConsoleBackendOptions {
  pretty?: boolean;
  colors?: boolean;
}

export class ConsoleBackend implements LoggerBackend {
  private readonly options: ConsoleBackendOptions;

  constructor(options: ConsoleBackendOptions = {}) {
    this.options = {
      pretty: options.pretty ?? false,
      colors: options.colors ?? false,
    };
  }

  log(entry: LogEntry): void {
    if (this.options.pretty) {
      this.logPretty(entry);
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  private logPretty(entry: LogEntry): void {
    const color = this.options.colors ? this.getColor(entry.level) : '';
    const reset = this.options.colors ? '\x1b[0m' : '';
    const levelPadded = entry.level.toUpperCase().padEnd(5);

    const base = `${color}[${entry.timestamp}] ${levelPadded}${reset} ${entry.component}:${entry.operation} - ${entry.message}`;
    const meta = [
      `requestId=${entry.requestId}`,
      entry.userId ? `userId=${entry.userId}` : null,
      entry.traceId ? `traceId=${entry.traceId}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    console.log(`${base} (${meta})`);

    if (entry.error) {
      console.log(`  Error: ${entry.error.type}: ${entry.error.message}`);
      if (entry.error.stack) {
        console.log(`  Stack: ${entry.error.stack}`);
      }
    }

    if (entry.context && Object.keys(entry.context).length > 0) {
      console.log(`  Context: ${JSON.stringify(entry.context, null, 2)}`);
    }
  }

  private getColor(level: string): string {
    switch (level) {
      case 'error':
        return '\x1b[31m';
      case 'warn':
        return '\x1b[33m';
      case 'info':
        return '\x1b[36m';
      case 'debug':
        return '\x1b[90m';
      default:
        return '';
    }
  }
}

export function createConsoleBackend(
  options?: ConsoleBackendOptions
): LoggerBackend {
  return new ConsoleBackend(options);
}

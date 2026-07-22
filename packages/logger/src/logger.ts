export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface ErrorDetails {
  message: string;
  type: string;
  code?: string;
  stack?: string;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  env: string;
  requestId: string;
  traceId?: string;
  userId?: string;
  component: string;
  operation: string;
  message: string;
  error?: ErrorDetails;
  context?: Record<string, unknown>;
}

export interface LogContext {
  requestId?: string;
  traceId?: string;
  userId?: string;
  component?: string;
  operation?: string;
  context?: Record<string, unknown>;
}

export interface ILogger {
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  child(context: Partial<LogContext>): ILogger;
}

export interface LoggerBackend {
  log(entry: LogEntry): void;
  flush?(): Promise<void>;
}

export interface LoggerConfig {
  service: string;
  env: string;
  backend: LoggerBackend;
  level?: LogLevel;
  defaultComponent?: string;
  redactPII?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export class Logger implements ILogger {
  private readonly config: Required<Omit<LoggerConfig, 'defaultComponent'>> & {
    defaultComponent?: string;
  };
  private readonly childContext: Partial<LogContext>;

  constructor(config: LoggerConfig, childContext: Partial<LogContext> = {}) {
    this.config = {
      service: config.service,
      env: config.env,
      backend: config.backend,
      level: config.level ?? 'info',
      defaultComponent: config.defaultComponent,
      redactPII: config.redactPII ?? false,
    };
    this.childContext = childContext;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.config.level];
  }

  private buildEntry(
    level: LogLevel,
    message: string,
    context?: LogContext
  ): LogEntry {
    const merged = { ...this.childContext, ...context };

    return {
      timestamp: new Date().toISOString(),
      level,
      service: this.config.service,
      env: this.config.env,
      requestId: merged.requestId ?? 'no-request-id',
      traceId: merged.traceId,
      userId: merged.userId,
      component: merged.component ?? this.config.defaultComponent ?? 'unknown',
      operation: merged.operation ?? 'unknown',
      message,
      context: merged.context,
    };
  }

  error(message: string, context?: LogContext): void {
    if (!this.shouldLog('error')) return;

    const entry = this.buildEntry('error', message, context);

    if (context?.context?.error instanceof Error) {
      const err = context.context.error as Error;
      entry.error = {
        message: err.message,
        type: err.constructor.name,
        code: (err as any).code,
        stack: this.config.env === 'development' ? err.stack : undefined,
      };

      const { error, ...restContext } = context.context;
      entry.context = restContext;
    }

    this.config.backend.log(entry);
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) return;
    this.config.backend.log(this.buildEntry('warn', message, context));
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return;
    this.config.backend.log(this.buildEntry('info', message, context));
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) return;
    this.config.backend.log(this.buildEntry('debug', message, context));
  }

  child(context: Partial<LogContext>): ILogger {
    const merged = { ...this.childContext, ...context };
    return new Logger(this.config, merged);
  }

  async flush(): Promise<void> {
    if (this.config.backend.flush) {
      await this.config.backend.flush();
    }
  }
}

export function createLogger(config: LoggerConfig): ILogger {
  return new Logger(config);
}

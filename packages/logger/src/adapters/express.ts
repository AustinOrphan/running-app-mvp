import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { ILogger } from '../logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';
export const TRACE_ID_HEADER = 'x-trace-id';

export interface RequestLoggerOptions {
  logger: ILogger;
  component?: string;
  generateRequestId?: () => string;
  extractUserId?: (req: Request) => string | undefined;
  skipPaths?: string[];
}

export function requestLogger(options: RequestLoggerOptions) {
  const {
    logger,
    component = 'api',
    generateRequestId = uuidv4,
    extractUserId,
    skipPaths = [],
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (skipPaths.some((path) => req.path.startsWith(path))) {
      return next();
    }

    const requestId =
      (req.headers[REQUEST_ID_HEADER] as string) || generateRequestId();
    const traceId = req.headers[TRACE_ID_HEADER] as string | undefined;
    const userId = extractUserId ? extractUserId(req) : undefined;

    (req as any).requestId = requestId;
    (req as any).traceId = traceId;

    (req as any).logger = logger.child({
      requestId,
      traceId,
      userId,
      component,
    });

    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const level = res.statusCode >= 500 ? 'error' : 'info';

      const reqLogger = (req as any).logger;
      const logMethod = reqLogger![level].bind(reqLogger);
      logMethod(`${req.method} ${req.path} ${res.statusCode}`, {
        operation: 'http-request',
        context: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          userAgent: req.headers['user-agent'],
        },
      });
    });

    next();
  };
}

export interface CorrelationIdOptions {
  header?: string;
  generateId?: () => string;
}

export function correlationId(options: CorrelationIdOptions = {}) {
  const { header = REQUEST_ID_HEADER, generateId = uuidv4 } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const id = (req.headers[header] as string) || generateId();
    (req as any).requestId = id;
    res.setHeader(header, id);
    next();
  };
}

export function errorLogger(logger: ILogger, component = 'api') {
  return (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const requestLogger = (req as any).logger || logger;

    requestLogger.error('Request error', {
      requestId: (req as any).requestId,
      traceId: (req as any).traceId,
      component,
      operation: 'error-handler',
      context: {
        error: err,
        method: req.method,
        path: req.path,
      },
    });

    next(err);
  };
}

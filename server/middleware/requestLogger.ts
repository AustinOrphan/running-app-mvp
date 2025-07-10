/**
 * Request Logging Middleware - Issue #178
 *
 * Winston-based request/response logging middleware for comprehensive API monitoring.
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { winstonLogger, LogCategory, LogOperation } from '../utils/winstonLogger.js';

export interface LoggedRequest extends Request {
  requestId: string;
  startTime: number;
}

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const loggedReq = req as LoggedRequest;
  // Generate request ID if not already present
  loggedReq.requestId = loggedReq.requestId || uuidv4();
  loggedReq.startTime = Date.now();

  // Track if response has been logged to avoid duplicates
  let responseLogged = false;

  // Extract user context from auth middleware if available
  const userId = loggedReq.user?.id;

  // Log incoming request
  winstonLogger.info('Request received', {
    requestId: loggedReq.requestId,
    method: loggedReq.method,
    url: loggedReq.url,
    userAgent: loggedReq.get('User-Agent'),
    ip: loggedReq.ip,
    userId,
    component: LogCategory.API,
    operation: LogOperation.PROCESS,
    metadata: {
      headers: {
        'content-type': loggedReq.get('Content-Type'),
        accept: loggedReq.get('Accept'),
        authorization: loggedReq.get('Authorization') ? '[REDACTED]' : undefined,
      },
      query: loggedReq.query,
      params: loggedReq.params,
    },
  });

  // Helper function to log response completion
  const logResponse = (type: string, data?: unknown) => {
    if (responseLogged) return;
    responseLogged = true;

    const duration = Date.now() - loggedReq.startTime;

    winstonLogger.info(`Request completed${type ? ` (${type})` : ''}`, {
      requestId: loggedReq.requestId,
      method: loggedReq.method,
      url: loggedReq.url,
      statusCode: res.statusCode,
      duration,
      userId,
      component: LogCategory.API,
      operation: LogOperation.PROCESS,
      metadata: {
        responseSize: data ? Buffer.byteLength(JSON.stringify(data), 'utf8') : undefined,
        responseDataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
        contentType: res.get('Content-Type'),
      },
    });
  };

  // Capture original response methods
  const originalSend = res.send;
  const originalJson = res.json;

  // Override res.send to log response
  res.send = function (data) {
    logResponse('send', data);
    return originalSend.call(this, data);
  };

  // Override res.json to log response
  res.json = function (data) {
    logResponse('json', data);
    return originalJson.call(this, data);
  };

  // Handle response finish for cases where send/json aren't called
  res.on('finish', () => {
    logResponse('finish');
  });

  // Log slow requests (> 1 second)
  const slowRequestThreshold = 1000;
  setTimeout(() => {
    if (!responseLogged) {
      const duration = Date.now() - loggedReq.startTime;
      if (duration > slowRequestThreshold) {
        winstonLogger.warn('Slow request detected', {
          requestId: loggedReq.requestId,
          method: loggedReq.method,
          url: loggedReq.url,
          duration,
          userId,
          component: LogCategory.PERFORMANCE,
          operation: LogOperation.PROCESS,
          metadata: {
            threshold: slowRequestThreshold,
          },
        });
      }
    }
  }, slowRequestThreshold);

  next();
};

// Error logging middleware
export const errorLogger = (error: Error, req: Request, res: Response, next: NextFunction) => {
  const loggedReq = req as LoggedRequest;
  const duration = Date.now() - loggedReq.startTime;
  const userId = loggedReq.user?.id;

  winstonLogger.error('Request error', {
    requestId: loggedReq.requestId,
    method: loggedReq.method,
    url: loggedReq.url,
    duration,
    userId,
    component: LogCategory.API,
    operation: LogOperation.PROCESS,
    error: {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    },
    metadata: {
      statusCode: res.statusCode,
    },
  });

  next(error);
};

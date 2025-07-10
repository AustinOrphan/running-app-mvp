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

export const requestLogger = (
  req: LoggedRequest,
  res: Response,
  next: NextFunction
) => {
  // Generate request ID if not already present
  req.requestId = req.requestId || uuidv4();
  req.startTime = Date.now();

  // Extract user context from auth middleware if available
  const userId = req.user?.id;

  // Log incoming request
  winstonLogger.info('Request received', {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    userId,
    component: LogCategory.API,
    operation: LogOperation.PROCESS,
    metadata: {
      headers: {
        'content-type': req.get('Content-Type'),
        'accept': req.get('Accept'),
        'authorization': req.get('Authorization') ? '[REDACTED]' : undefined
      },
      query: req.query,
      params: req.params
    }
  });

  // Capture original response methods
  const originalSend = res.send;
  const originalJson = res.json;

  // Override res.send to log response
  res.send = function(data) {
    const duration = Date.now() - req.startTime;
    
    winstonLogger.info('Request completed', {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userId,
      component: LogCategory.API,
      operation: LogOperation.PROCESS,
      metadata: {
        responseSize: Buffer.byteLength(data || '', 'utf8'),
        contentType: res.get('Content-Type')
      }
    });

    // Call original send
    return originalSend.call(this, data);
  };

  // Override res.json to log response
  res.json = function(data) {
    const duration = Date.now() - req.startTime;
    
    winstonLogger.info('Request completed (JSON)', {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userId,
      component: LogCategory.API,
      operation: LogOperation.PROCESS,
      metadata: {
        responseDataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
        contentType: res.get('Content-Type')
      }
    });

    // Call original json
    return originalJson.call(this, data);
  };

  // Handle response finish for cases where send/json aren't called
  res.on('finish', () => {
    // Only log if we haven't already logged (send/json weren't called)
    if (!res.headersSent) {
      const duration = Date.now() - req.startTime;
      
      winstonLogger.info('Request finished', {
        requestId: req.requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        userId,
        component: LogCategory.API,
        operation: LogOperation.PROCESS
      });
    }
  });

  // Log slow requests (> 1 second)
  const slowRequestThreshold = 1000;
  setTimeout(() => {
    if (!res.headersSent) {
      const duration = Date.now() - req.startTime;
      if (duration > slowRequestThreshold) {
        winstonLogger.warn('Slow request detected', {
          requestId: req.requestId,
          method: req.method,
          url: req.url,
          duration,
          userId,
          component: LogCategory.PERFORMANCE,
          operation: LogOperation.PROCESS,
          metadata: {
            threshold: slowRequestThreshold
          }
        });
      }
    }
  }, slowRequestThreshold);

  next();
};

// Error logging middleware
export const errorLogger = (
  error: Error,
  req: LoggedRequest,
  res: Response,
  next: NextFunction
) => {
  const duration = Date.now() - req.startTime;
  const userId = req.user?.id;

  winstonLogger.error('Request error', {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    duration,
    userId,
    component: LogCategory.API,
    operation: LogOperation.PROCESS,
    error: {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    },
    metadata: {
      statusCode: res.statusCode
    }
  });

  next(error);
};
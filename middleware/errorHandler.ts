import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Enhanced structured error logging
  const errorLog = {
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    message: err.message,
    statusCode: statusCode,
    isOperational: err.isOperational || false,
    request: {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip ? crypto.createHash('sha256').update(req.ip).digest('hex') : req.connection.remoteAddress,
      userId: (req as any).user?.id,
    },
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  };

  console.error('Express Error:', errorLog);

  res.status(statusCode).json({
    message,
    status: statusCode,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export const createError = (message: string, statusCode: number = 500): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.isOperational = true;
  return error;
};

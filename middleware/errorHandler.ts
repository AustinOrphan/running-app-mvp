import { Request, Response, NextFunction } from 'express';
import { secureLogger } from '../utils/secureLogger.js';

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

  // Use secure logging with automatic data redaction and context
  secureLogger.error('Express route error', req, err, {
    statusCode,
    isOperational: err.isOperational || false,
    errorType: err.constructor.name,
  });

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

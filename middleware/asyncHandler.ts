import { Request, Response, NextFunction } from 'express';

/**
 * Async error handling wrapper for Express route handlers
 * This utility automatically catches async errors and passes them to next()
 * preventing uncaught promise rejections that could crash the server
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Async error handling wrapper specifically for authenticated routes
 * with AuthRequest type
 */
export const asyncAuthHandler = (
  fn: (req: any, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: any, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
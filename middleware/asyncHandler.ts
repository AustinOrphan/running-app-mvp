import { Request, Response, NextFunction } from 'express';

/**
 * Generic async error handling wrapper for Express route handlers
 * This utility automatically catches async errors and passes them to next()
 * preventing uncaught promise rejections that could crash the server
 * 
 * @param fn - The async route handler function
 * @returns Express middleware function with error handling
 */
export const asyncHandlerGeneric = <T = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Async error handling wrapper for standard Express routes
 * @param fn - The async route handler function
 * @returns Express middleware function with error handling
 */
export const asyncHandler = asyncHandlerGeneric<Request>;

/**
 * Async error handling wrapper for authenticated routes with AuthRequest type
 * Import AuthRequest type from requireAuth middleware
 * @param fn - The async route handler function with AuthRequest
 * @returns Express middleware function with error handling
 */
export const asyncAuthHandler = asyncHandlerGeneric<any>; // Using any for now, will be typed as AuthRequest in routes
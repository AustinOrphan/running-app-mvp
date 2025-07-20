import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { createError } from './errorHandler.js';
import { logAuth } from '../utils/logger.js';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw createError('No token provided', 401);
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!process.env.JWT_SECRET) {
      throw createError('JWT secret not configured', 500);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as {
      id: string;
      email: string;
    };

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      const authError = createError('Invalid token', 401);
      logAuth('token-validation', req, authError, {
        errorType: 'JsonWebTokenError',
        tokenProvided: !!req.headers.authorization,
      });
      next(authError);
    } else {
      const unexpectedError = error instanceof Error ? error : new Error(String(error));
      logAuth('auth-middleware', req, unexpectedError, {
        errorType: 'UnexpectedError',
      });
      next(unexpectedError);
    }
  }
};

export type { AuthRequest };

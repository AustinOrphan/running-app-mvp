import { Request, Response, NextFunction } from 'express';

import { createError } from './errorHandler.js';
import { logAuth } from '../utils/logger.js';
import { validateToken, extractTokenFromHeader, isTokenBlacklisted } from '../utils/jwtUtils.js';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export const requireAuth = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      throw createError('No valid token provided', 401);
    }

    // Validate the token and ensure it's an access token
    const decoded = validateToken(token, 'access');

    // Check if token is blacklisted
    if (decoded.jti && isTokenBlacklisted(decoded.jti)) {
      throw createError('Token has been revoked', 401);
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
    };

    next();
  } catch (error) {
    const authError = error instanceof Error ? error : createError('Authentication failed', 401);
    logAuth('token-validation', req, authError, {
      errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      tokenProvided: !!req.headers.authorization,
    });
    next(authError);
  }
};

export type { AuthRequest };

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createError } from '../middleware/errorHandler.js';

export interface JWTPayload {
  id: string;
  email: string;
  iat: number;
  exp?: number;
  jti?: string;
  type?: 'access' | 'refresh';
}

/**
 * Enhanced JWT token generation with security best practices
 */
export const generateTokens = (user: { id: string; email: string }) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw createError('JWT secret not configured', 500);
  }

  // Access token payload
  const accessPayload: JWTPayload = {
    id: user.id,
    email: user.email,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    type: 'access',
  };

  // Generate access token
  const accessToken = (jwt as any).sign(accessPayload, secret, {
    expiresIn: process.env.JWT_ACCESS_EXPIRY || '1h',
    issuer: 'running-app',
    audience: 'running-app-users',
  });

  // Refresh token payload (minimal data for security)
  const refreshPayload = {
    id: user.id,
    jti: crypto.randomUUID(),
    type: 'refresh',
    iat: Math.floor(Date.now() / 1000),
  };

  // Generate refresh token
  const refreshToken = (jwt as any).sign(refreshPayload, secret, {
    expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d',
    issuer: 'running-app',
    audience: 'running-app-users',
  });

  return { accessToken, refreshToken };
};

/**
 * Enhanced token validation with type checking
 */
export const validateToken = (token: string, type: 'access' | 'refresh' = 'access'): JWTPayload => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw createError('JWT secret not configured', 500);
  }

  try {
    const decoded = jwt.verify(token, secret, {
      issuer: 'running-app',
      audience: 'running-app-users',
    }) as JWTPayload;

    // Verify token type
    if (decoded.type && decoded.type !== type) {
      throw createError('Invalid token type', 401);
    }

    // Check if token is blacklisted
    if (decoded.jti && isTokenBlacklisted(decoded.jti)) {
      throw createError('Token has been revoked', 401);
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw createError('Token has expired', 401);
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw createError('Invalid token', 401);
    }
    throw error;
  }
};

/**
 * Extract token from Authorization header
 */
export const extractTokenFromHeader = (authHeader: string | undefined): string | null => {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
};

/**
 * In-memory token blacklist for development
 * TODO: Replace with Redis in production
 */
const blacklistedTokens = new Set<string>();

export const blacklistToken = (jti: string, expiresAt: number) => {
  blacklistedTokens.add(jti);

  // Schedule automatic removal after expiration
  const ttl = expiresAt - Math.floor(Date.now() / 1000);
  if (ttl > 0) {
    setTimeout(() => {
      blacklistedTokens.delete(jti);
    }, ttl * 1000);
  }
};

export const isTokenBlacklisted = (jti: string): boolean => {
  return blacklistedTokens.has(jti);
};

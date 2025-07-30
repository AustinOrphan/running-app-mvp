import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createError } from '../middleware/errorHandler.js';
import { secureLogger } from './secureLogger.js';

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
  // TypeScript assertion after null check
  const jwtSecret: string = secret;

  // Access token payload
  const accessPayload = {
    id: user.id,
    email: user.email,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    type: 'access' as const,
  };

  // Generate access token
  const accessToken = jwt.sign(
    accessPayload,
    jwtSecret as jwt.Secret,
    {
      expiresIn: process.env.JWT_ACCESS_EXPIRY || '1h',
      issuer: 'running-app',
      audience: 'running-app-users',
    } as jwt.SignOptions
  );

  // Refresh token payload (minimal data for security)
  const refreshPayload = {
    id: user.id,
    jti: crypto.randomUUID(),
    type: 'refresh' as const,
    iat: Math.floor(Date.now() / 1000),
  };

  // Generate refresh token
  const refreshToken = jwt.sign(
    refreshPayload,
    jwtSecret as jwt.Secret,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d',
      issuer: 'running-app',
      audience: 'running-app-users',
    } as jwt.SignOptions
  );

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
  // TypeScript assertion after null check
  const jwtSecret: string = secret;

  try {
    const decoded = jwt.verify(
      token,
      jwtSecret as jwt.Secret,
      {
        issuer: 'running-app',
        audience: 'running-app-users',
      } as jwt.VerifyOptions
    ) as JWTPayload;

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
 * Token blacklist implementation
 *
 * CRITICAL TODO: Replace with persistent storage before production deployment
 * Current implementation uses in-memory storage which has two major issues:
 * 1. Blacklist is cleared on server restart (revoked tokens become valid again)
 * 2. Not shared across multiple server instances (horizontal scaling issue)
 *
 * Production implementation options:
 * - Redis with TTL matching token expiration
 * - Memcached for distributed caching
 * - Database table with cleanup job
 *
 * Example Redis implementation:
 * ```
 * import Redis from 'ioredis';
 * const redis = new Redis(process.env.REDIS_URL);
 *
 * export const blacklistToken = async (jti: string, expiresAt: number) => {
 *   const ttl = expiresAt - Math.floor(Date.now() / 1000);
 *   if (ttl > 0) {
 *     await redis.setex(`blacklist:${jti}`, ttl, '1');
 *   }
 * };
 *
 * export const isTokenBlacklisted = async (jti: string): boolean => {
 *   const result = await redis.get(`blacklist:${jti}`);
 *   return result === '1';
 * };
 * ```
 */
const blacklistedTokens = new Set<string>();

// Development-only warning
if (process.env.NODE_ENV === 'production') {
  secureLogger.warn(
    'Using in-memory token blacklist in production. This is not recommended for scalability.'
  );
}

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

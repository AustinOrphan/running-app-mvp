import bcrypt from 'bcrypt';
import express from 'express';

import { prisma } from '../../lib/prisma.js';
import { asyncHandler, asyncAuthHandler } from '../middleware/asyncHandler.js';
import {
  createError,
  createConflictError,
  createUnauthorizedError,
} from '../middleware/errorHandler.js';
import {
  validateRegister,
  validateLogin,
  sanitizeInput,
  securityHeaders,
} from '../middleware/validation.js';
import { authRateLimit } from '../middleware/rateLimiting.js';
import { logUserAction } from '../utils/secureLogger.js';
import { requireAuth, type AuthRequest } from '../middleware/requireAuth.js';
import {
  generateTokens,
  validateToken,
  extractTokenFromHeader,
  blacklistToken,
} from '../utils/jwtUtils.js';
import { auditAuth, auditData } from '../utils/auditLogger.js';

const router = express.Router();

// Apply rate limiting to all auth routes
router.use(authRateLimit);

// Apply security headers to all auth routes
router.use(securityHeaders);

// Apply input sanitization to all auth routes
router.use(sanitizeInput);

// Test endpoint to verify auth route is working
router.get('/test', (req, res) => {
  res.json({ message: 'Auth routes are working', timestamp: new Date().toISOString() });
});

// POST /api/auth/register - User registration
router.post(
  '/register',
  validateRegister,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      await auditAuth.register(req, email, 'failure');
      throw createConflictError('User already exists', { email });
    }

    // Hash password with configurable rounds
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user in database
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    logUserAction('User registration', req, { email });
    await auditAuth.register(req, user.id, 'success');
    await auditData.create(req, 'user', user.id, 'success');

    // Generate JWT tokens
    const { accessToken, refreshToken } = generateTokens(user);

    res.status(201).json({
      message: 'User created successfully',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  })
);

// POST /api/auth/login - User login
router.post(
  '/login',
  validateLogin,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      await auditAuth.login(req, email, 'failure', { reason: 'user_not_found' });
      throw createUnauthorizedError('Invalid credentials');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      await auditAuth.login(req, user.id, 'failure', { reason: 'invalid_password' });
      throw createUnauthorizedError('Invalid credentials');
    }

    logUserAction('User login', req, { email });
    await auditAuth.login(req, user.id, 'success');

    // Generate JWT tokens
    const { accessToken, refreshToken } = generateTokens(user);

    res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  })
);

// GET /api/auth/verify - Verify JWT token and return user info
router.get(
  '/verify',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    // Safely validate user ID from token
    const userId = req.user?.id;
    if (typeof userId !== 'string') {
      throw createUnauthorizedError('Invalid token');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw createUnauthorizedError('Invalid token');
    }

    res.json({ user });
  })
);

// POST /api/auth/refresh - Refresh access token using refresh token
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw createUnauthorizedError('Refresh token is required');
    }

    try {
      // Validate refresh token
      const decoded = validateToken(refreshToken, 'refresh');

      // Get user from database to ensure they still exist
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true },
      });

      if (!user) {
        throw createUnauthorizedError('User not found');
      }

      // Generate new access token (keep the same refresh token)
      const { accessToken } = generateTokens(user);

      logUserAction('Token refresh', req, { userId: user.id });
      await auditAuth.refresh(req, user.id, 'success');

      res.json({
        message: 'Token refreshed successfully',
        accessToken,
      });
    } catch {
      await auditAuth.refresh(req, 'unknown', 'failure');
      throw createUnauthorizedError('Invalid refresh token');
    }
  })
);

// POST /api/auth/logout - Logout user and blacklist tokens
router.post(
  '/logout',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    try {
      const authHeader = req.headers.authorization;
      const token = extractTokenFromHeader(authHeader);

      if (token) {
        const decoded = validateToken(token);

        // Blacklist the access token
        if (decoded.jti) {
          blacklistToken(decoded.jti, decoded.exp || 0);
        }
      }

      // Also blacklist refresh token if provided
      const refreshToken = req.body?.refreshToken;
      if (refreshToken) {
        try {
          const decodedRefresh = validateToken(refreshToken, 'refresh');
          if (decodedRefresh.jti) {
            blacklistToken(decodedRefresh.jti, decodedRefresh.exp || 0);
          }
        } catch {
          // Ignore refresh token validation errors during logout
        }
      }

      logUserAction('User logout', req, { userId: req.user?.id });
      await auditAuth.logout(req, req.user?.id || 'unknown');

      res.json({ message: 'Logged out successfully' });
    } catch {
      await auditAuth.logout(req, req.user?.id || 'unknown');
      throw createError('Logout failed', 500);
    }
  })
);

export default router;

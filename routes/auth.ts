import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';

import { asyncHandler, asyncAuthHandler } from '../middleware/asyncHandler';
import {
  createError,
  createConflictError,
  createUnauthorizedError,
} from '../middleware/errorHandler';
import {
  validateRegister,
  validateLogin,
  sanitizeInput,
  securityHeaders,
} from '../middleware/validation';
import { authRateLimit } from '../middleware/rateLimiting';
import { logUserAction } from '../utils/secureLogger';
import { requireAuth, type AuthRequest } from '../middleware/requireAuth';

const router = express.Router();
const prisma = new PrismaClient();

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
      throw createConflictError('User already exists', { email });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user in database
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    logUserAction('User registration', req, { email });

    // Generate JWT
    if (!process.env.JWT_SECRET) {
      throw createError('JWT secret not configured', 500);
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(201).json({
      message: 'User created successfully',
      token,
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
      throw createUnauthorizedError('Invalid credentials');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      throw createUnauthorizedError('Invalid credentials');
    }

    logUserAction('User login', req, { email });

    // Generate JWT
    if (!process.env.JWT_SECRET) {
      throw createError('JWT secret not configured', 500);
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({
      message: 'Login successful',
      token,
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

export default router;

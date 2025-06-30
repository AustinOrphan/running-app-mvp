import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';

import { asyncHandler } from '../middleware/asyncHandler.js';
import { createError, createConflictError, createUnauthorizedError } from '../middleware/errorHandler.js';
import { validateRegister, validateLogin, sanitizeInput, securityHeaders } from '../middleware/validation.js';
import { authRateLimit } from '../middleware/rateLimiting.js';
import { logUserAction } from '../utils/secureLogger.js';

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
  asyncHandler(async (req, res, next) => {
    const { email, password } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return next(createConflictError('User already exists', { email }));
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
      return next(createError('JWT secret not configured', 500));
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    return res.status(201).json({
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
  asyncHandler(async (req, res, next) => {
    const { email, password } = req.body;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return next(createUnauthorizedError('Invalid credentials'));
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return next(createUnauthorizedError('Invalid credentials'));
    }

    logUserAction('User login', req, { email });

    // Generate JWT
    if (!process.env.JWT_SECRET) {
      return next(createError('JWT secret not configured', 500));
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  })
);

export default router;

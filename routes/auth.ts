import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';

import { createError } from '../middleware/errorHandler.js';
import { prisma } from '../server.js';

const router = express.Router();

// Test endpoint to verify auth route is working
router.get('/test', (req, res) => {
  res.json({ message: 'Auth routes are working', timestamp: new Date().toISOString() });
});

// POST /api/auth/register - User registration
router.post('/register', async (req, res, next) => {
  try {
    console.log('Registration attempt:', {
      hasEmail: !!req.body?.email,
      hasPassword: !!req.body?.password,
    });

    const { email, password } = req.body;

    // Basic validation
    if (!email || !password) {
      throw createError('Email and password are required', 400);
    }

    if (password.length < 6) {
      throw createError('Password must be at least 6 characters', 400);
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw createError('User already exists', 409);
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
  } catch (error: any) {
    console.error('Registration error:', error);
    next(error);
  }
});

// POST /api/auth/login - User login
router.post('/login', async (req, res, next) => {
  try {
    console.log('Login attempt:', {
      hasEmail: !!req.body?.email,
      hasPassword: !!req.body?.password,
    });

    const { email, password } = req.body;

    // Basic validation
    if (!email || !password) {
      throw createError('Email and password are required', 400);
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw createError('Invalid credentials', 401);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      throw createError('Invalid credentials', 401);
    }

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
  } catch (error: any) {
    console.error('Login error:', error);
    next(error);
  }
});

export default router;

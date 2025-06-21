import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { validateBody } from '../middleware/validateBody.js';
import { createError } from '../middleware/errorHandler.js';

const router = express.Router();
const prisma = new PrismaClient();

// POST /api/auth/register - User registration
router.post(
  '/register',
  validateBody([
    { field: 'email', required: true, type: 'string' },
    { field: 'password', required: true, type: 'string', min: 6 },
  ]),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw createError('User already exists', 400);
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

      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        message: 'User created successfully',
        token,
        user: {
          id: user.id,
          email: user.email,
        },
      });
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw createError('Registration failed', 500);
    }
  }
);

// POST /api/auth/login - User login
router.post(
  '/login',
  validateBody([
    { field: 'email', required: true, type: 'string' },
    { field: 'password', required: true, type: 'string' },
  ]),
  async (req, res) => {
    try {
      const { email, password } = req.body;

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

      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
        },
      });
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw createError('Login failed', 500);
    }
  }
);

export default router;
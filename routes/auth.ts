import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../server.js';

const router = express.Router();

// Test endpoint to verify auth route is working
router.get('/test', (req, res) => {
  res.json({ message: 'Auth routes are working', timestamp: new Date().toISOString() });
});

// POST /api/auth/register - User registration
router.post('/register', async (req, res, next) => {
  try {
    console.log('Registration attempt:', { email: req.body?.email, hasPassword: !!req.body?.password });
    
    const { email, password } = req.body;

    // Basic validation
    if (!email || !password) {
      return res.status(400).json({ error: { message: 'Email and password are required', status: 400 } });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: { message: 'Password must be at least 6 characters', status: 400 } });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: { message: 'User already exists', status: 400 } });
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
      return res.status(500).json({ error: { message: 'JWT secret not configured', status: 500 } });
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
    console.error('Registration error:', error);
    res.status(500).json({ error: { message: 'Registration failed', status: 500 } });
  }
});

// POST /api/auth/login - User login
router.post('/login', async (req, res) => {
  try {
    console.log('Login attempt:', { email: req.body?.email, hasPassword: !!req.body?.password });
    
    const { email, password } = req.body;

    // Basic validation
    if (!email || !password) {
      return res.status(400).json({ error: { message: 'Email and password are required', status: 400 } });
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: { message: 'Invalid credentials', status: 401 } });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: { message: 'Invalid credentials', status: 401 } });
    }

    // Generate JWT
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: { message: 'JWT secret not configured', status: 500 } });
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
    console.error('Login error:', error);
    res.status(500).json({ error: { message: 'Login failed', status: 500 } });
  }
});

export default router;
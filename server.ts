import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { globalRateLimit } from './middleware/rateLimiting.js';
import { securityHeaders } from './middleware/validation.js';

// Import routes
import authRoutes from './routes/auth.js';
import goalRoutes from './routes/goals.js';
import raceRoutes from './routes/races.js';
import runRoutes from './routes/runs.js';
import statsRoutes from './routes/stats.js';

// Import secure logging
import { logError, logInfo } from './utils/secureLogger.js';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(express.json());

// Security middleware
app.use(securityHeaders);
app.use(globalRateLimit);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/runs', runRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/races', raceRoutes);
app.use('/api/stats', statsRoutes);

// Health check with database ping
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1 as test`;

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    logError(
      'Health check error',
      req,
      error instanceof Error ? error : new Error(String(error))
    );
    res.status(500).json({
      status: 'error',
      message: 'Health check failed: Database disconnected',
      database: 'disconnected',
    });
  }
});

// Debug endpoint to check users (development only)
if (process.env.NODE_ENV === 'development') {
  app.get('/api/debug/users', async (req, res) => {
    try {
      const users = await prisma.user.findMany({
        select: { id: true, email: true, createdAt: true },
      });
      res.json(users);
    } catch {
      res.status(500).json({ message: 'Failed to fetch users' });
    }
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  logInfo(`🚀 Server running on port ${PORT}`);
});

export { app, prisma };

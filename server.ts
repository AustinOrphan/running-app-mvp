import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Import database client
import { prisma } from './lib/prisma.js';

// Import middleware
import { errorHandler } from './server/middleware/errorHandler.js';
import { globalRateLimit } from './server/middleware/rateLimiting.js';
import { securityHeaders } from './server/middleware/validation.js';

// Import routes
import authRoutes from './server/routes/auth.js';
import goalRoutes from './server/routes/goals.js';
import raceRoutes from './server/routes/races.js';
import runRoutes from './server/routes/runs.js';
import statsRoutes from './server/routes/stats.js';

// Import enhanced logging
import { logError, logInfo, correlationMiddleware } from './server/utils/logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Correlation ID middleware for request tracing
app.use(correlationMiddleware());

// Security middleware
app.use(securityHeaders);
app.use(globalRateLimit);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/runs', runRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/races', raceRoutes);
app.use('/api/stats', statsRoutes);

// Serve static client and handle SPA routing in production
if (process.env.NODE_ENV === 'production') {
  const clientPath = path.join(__dirname, 'dist');
  app.use(express.static(clientPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });
}

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
    logError('server', 'health-check', error, req);
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
    } catch (error) {
      logError('server', 'debug-fetch-users', error, req);
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
  logInfo('server', 'startup', `🚀 Server running on port ${PORT}`, undefined, { port: PORT });
});

export { app, prisma };

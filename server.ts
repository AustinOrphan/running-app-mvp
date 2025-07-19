import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ES modules compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Initialize Prisma
export const prisma = new PrismaClient();

// Import middleware
import { errorHandler } from './server/middleware/errorHandler.js';
import { globalRateLimit } from './server/middleware/rateLimiting.js';
import { securityHeaders } from './server/middleware/validation.js';
import { requestLogger } from './server/middleware/requestLogger.js';

// Import routes
import authRoutes from './server/routes/auth.js';
import runsRoutes from './server/routes/runs.js';
import goalsRoutes from './server/routes/goals.js';
import statsRoutes from './server/routes/stats.js';
import racesRoutes from './server/routes/races.js';
import analyticsRoutes from './routes/analytics.js';
import trainingPlansRoutes from './routes/trainingPlans.js';

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(
  cors({
    origin:
      process.env.NODE_ENV === 'production'
        ? process.env.FRONTEND_URL
        : ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
  })
);
app.use(express.json());
app.use(securityHeaders);
app.use(requestLogger);
app.use(globalRateLimit);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/runs', runsRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/races', racesRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/training-plans', trainingPlansRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

export default app;

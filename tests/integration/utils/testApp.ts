import express from 'express';
import cors from 'cors';

// Import middleware
import { errorHandler } from '../../../src/server/middleware/errorHandler';
import { globalRateLimit } from '../../../src/server/middleware/rateLimiting';
import { securityHeaders } from '../../../src/server/middleware/validation';
import { requestLogger } from '../../../src/server/middleware/requestLogger';

// Import routes
import authRoutes from '../../../src/server/routes/auth';
import runsRoutes from '../../../src/server/routes/runs';
import goalsRoutes from '../../../src/server/routes/goals';
import statsRoutes from '../../../src/server/routes/stats';
import racesRoutes from '../../../src/server/routes/races';
import auditRoutes from '../../../src/server/routes/audit';

/**
 * Creates a properly configured Express app for integration testing
 * This mirrors the production server setup but allows for test-specific configuration
 */
export const createTestApp = () => {
  const app = express();

  // Disable x-powered-by header for security
  app.disable('x-powered-by');

  // Core middleware
  app.use(
    cors({
      origin: ['http://localhost:3000', 'http://localhost:5173'],
      credentials: true,
    })
  );
  app.use(express.json());

  // Security and logging middleware
  app.use(securityHeaders);
  app.use(requestLogger);

  // Rate limiting (can be disabled for tests if needed)
  if (process.env.DISABLE_RATE_LIMIT_IN_TESTS !== 'true') {
    app.use(globalRateLimit);
  }

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
  app.use('/api/audit', auditRoutes);

  // Error handling middleware (must be last)
  app.use(errorHandler);

  return app;
};

/**
 * Creates a minimal test app with only specific routes
 * Useful for testing individual route modules in isolation
 */
export const createMinimalTestApp = (routePath: string, routeHandler: express.Router) => {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json());
  app.use(securityHeaders);

  // Mount the specific route
  app.use(routePath, routeHandler);

  // Error handling middleware
  app.use(errorHandler);

  return app;
};

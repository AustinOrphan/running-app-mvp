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
import auditRoutes from './server/routes/audit.js';

// Import enhanced logging
import { logError, logInfo, correlationMiddleware } from './server/utils/logger.js';

// Import security utilities
import { comprehensiveSecurityMiddleware } from './server/utils/securityUtils.js';
import { securityEventTracker, getSecurityMetrics } from './server/utils/securityLogger.js';
import {
  enhancedSecurityHeaders,
  apiSecurityHeaders,
  staticAssetSecurityHeaders,
  developmentSecurityHeaders,
  checkSecurityHeaders,
} from './server/middleware/securityHeaders.js';
import { createSSLRedirectMiddleware } from './server/utils/sslUtils.js';
import {
  startServer,
  gracefulShutdown,
  getServerConfig,
  setupCertificateMonitoring,
  setupDevelopmentSSL,
} from './server/utils/httpsServer.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Setup development SSL if needed
setupDevelopmentSSL();

// SSL redirect middleware (before any other middleware)
app.use(createSSLRedirectMiddleware());

// Enhanced security headers (replacing basic helmet configuration)
app.use(enhancedSecurityHeaders);

// Development-specific security headers
app.use(developmentSecurityHeaders);

// Static asset security headers
app.use(staticAssetSecurityHeaders);

// CORS configuration - restrict origins in production
const allowedOrigins =
  process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
    : ['http://localhost:3000', 'http://localhost:5173']; // Development origins

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void
  ) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: process.env.CORS_CREDENTIALS !== 'false',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Rate-Limit-Remaining', 'X-Rate-Limit-Reset'],
  optionsSuccessStatus: 200,
  maxAge: 86400, // 24 hours
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Correlation ID middleware for request tracing
app.use(correlationMiddleware());

// Security event tracking
app.use(securityEventTracker);

// Comprehensive security middleware stack
app.use(comprehensiveSecurityMiddleware);

// Additional security middleware
app.use(securityHeaders);
app.use(globalRateLimit);

// API-specific security headers
app.use('/api', apiSecurityHeaders);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/runs', runRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/races', raceRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/audit', auditRoutes);

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

  // Security metrics endpoint for monitoring
  app.get('/api/debug/security-metrics', (req, res) => {
    try {
      const metrics = getSecurityMetrics();
      res.json({
        timestamp: new Date().toISOString(),
        metrics,
      });
    } catch (error) {
      logError('server', 'security-metrics', error, req);
      res.status(500).json({ message: 'Failed to fetch security metrics' });
    }
  });

  // Security headers health check endpoint
  app.get('/api/debug/security-headers', (req, res) => {
    try {
      const headerCheck = checkSecurityHeaders(req);
      res.json({
        timestamp: new Date().toISOString(),
        securityScore: headerCheck.score,
        missingHeaders: headerCheck.missing,
        recommendations: headerCheck.recommendations,
        currentHeaders: Object.keys(req.headers).filter(
          h =>
            h.startsWith('x-') ||
            ['content-security-policy', 'strict-transport-security', 'referrer-policy'].includes(h)
        ),
      });
    } catch (error) {
      logError('server', 'security-headers-check', error, req);
      res.status(500).json({ message: 'Failed to check security headers' });
    }
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

// Get server configuration
const serverConfig = getServerConfig();

// Store server references for graceful shutdown
let servers: { server: any; redirectServer?: any } | null = null;

// Graceful shutdown handlers
const shutdown = async (signal: string) => {
  logInfo('server', 'shutdown', `Received ${signal}, initiating graceful shutdown`);

  if (servers) {
    await gracefulShutdown(servers);
  }

  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start the server
startServer(app, serverConfig)
  .then(serverInstances => {
    servers = serverInstances;

    // Setup SSL certificate monitoring if HTTPS is enabled
    setupCertificateMonitoring(serverInstances.server, { enabled: serverConfig.ssl });

    const isHTTPS = serverInstances.server.listening && 'key' in serverInstances.server;
    const protocol = isHTTPS ? 'HTTPS' : 'HTTP';
    const port = isHTTPS ? serverConfig.httpsPort || 443 : serverConfig.port;

    logInfo('server', 'startup', `🚀 ${protocol} server running on port ${port}`, undefined, {
      port,
      protocol: protocol.toLowerCase(),
      ssl: serverConfig.ssl,
      redirectHTTP: !!serverInstances.redirectServer,
    });

    if (serverInstances.redirectServer) {
      logInfo('server', 'startup', `🔀 HTTP redirect server running on port ${serverConfig.port}`);
    }
  })
  .catch(error => {
    logError('server', 'startup', error);
    process.exit(1);
  });

export { app, prisma };

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';

// Import routes
import authRoutes from './routes/auth.js';
import runRoutes from './routes/runs.js';
import goalRoutes from './routes/goals.js';
import raceRoutes from './routes/races.js';
import statsRoutes from './routes/stats.js';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(express.json());

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
      database: 'connected'
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Health check failed: Database disconnected',
      database: 'disconnected'
    });
  }
});

// Debug endpoint to check users (development only)
if (process.env.NODE_ENV === 'development') {
  app.get('/api/debug/users', async (req, res) => {
    try {
      const users = await prisma.user.findMany({
        select: { id: true, email: true, createdAt: true }
      });
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// Function to find an available port
async function getAvailablePort(preferredPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = app.listen(preferredPort, () => {
      const actualPort = (server.address() as any)?.port || preferredPort;
      server.close(() => resolve(actualPort));
    }).on('error', () => {
      // If preferred port is busy, try next available port
      const server2 = app.listen(0, () => {
        const actualPort = (server2.address() as any)?.port;
        server2.close(() => resolve(actualPort));
      });
    });
  });
}

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`\n📡 Received ${signal}. Shutting down gracefully...`);
  try {
    await prisma.$disconnect();
    console.log('✅ Database disconnected');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start server with port availability check
async function startServer() {
  try {
    const availablePort = await getAvailablePort(Number(PORT));
    
    if (availablePort !== Number(PORT)) {
      console.log(`⚠️  Port ${PORT} is busy, using port ${availablePort} instead`);
      console.log(`📝 Update your frontend proxy to target: http://localhost:${availablePort}`);
    }
    
    const server = app.listen(availablePort, () => {
      console.log(`🚀 Server running on port ${availablePort}`);
      console.log(`🔗 Health check: http://localhost:${availablePort}/api/health`);
      console.log(`📊 Debug users: http://localhost:${availablePort}/api/debug/users`);
    });

    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${availablePort} is already in use!`);
        console.log('💡 Try killing the process or use a different port');
        process.exit(1);
      } else {
        console.error('❌ Server error:', error);
      }
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export { prisma };

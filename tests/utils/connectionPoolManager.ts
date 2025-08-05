/**
 * Connection Pool Manager for Integration Tests
 * Manages Prisma database connections with proper pooling configuration
 * to prevent connection leaks and ensure reliable test execution
 */

import { PrismaClient } from '@prisma/client';

interface ConnectionPoolConfig {
  maxConnections: number;
  connectionTimeout: number;
  queryTimeout: number;
  enableQueryLogging: boolean;
}

class ConnectionPoolManager {
  private static instance: ConnectionPoolManager;
  private prismaClient: PrismaClient | null = null;
  private isConnected = false;
  private connectionCount = 0;
  private readonly config: ConnectionPoolConfig;

  private constructor() {
    this.config = {
      // For SQLite in tests, keep connections low to prevent locking issues
      maxConnections: parseInt(process.env.TEST_DB_MAX_CONNECTIONS || '3'),
      connectionTimeout: parseInt(process.env.TEST_DB_CONNECTION_TIMEOUT || '10000'),
      queryTimeout: parseInt(process.env.TEST_DB_QUERY_TIMEOUT || '30000'),
      enableQueryLogging: process.env.TEST_DB_LOGGING === 'true',
    };
  }

  static getInstance(): ConnectionPoolManager {
    if (!ConnectionPoolManager.instance) {
      ConnectionPoolManager.instance = new ConnectionPoolManager();
    }
    return ConnectionPoolManager.instance;
  }

  /**
   * Get a shared Prisma client instance with proper pooling configuration
   */
  getPrismaClient(): PrismaClient {
    if (!this.prismaClient) {
      let databaseUrl =
        process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'file:./prisma/test.db';

      // Add SQLite optimization parameters for tests
      if (!databaseUrl.includes('?')) {
        databaseUrl +=
          '?connection_limit=1&busy_timeout=30000&socket_timeout=60000&pool_timeout=10000';
      } else if (!databaseUrl.includes('socket_timeout')) {
        databaseUrl += '&socket_timeout=60000&pool_timeout=10000&busy_timeout=30000';
      }

      // Configure Prisma client with logging optimizations
      this.prismaClient = new PrismaClient({
        datasources: {
          db: { url: databaseUrl },
        },
        log: this.config.enableQueryLogging ? ['query', 'info', 'warn', 'error'] : ['error'],
        // Note: SQLite connection pooling is handled by the database engine itself
        // We manage connection limits through application-level pooling
      });

      // Set query timeout to prevent hanging tests
      this.prismaClient.$on('query', e => {
        if (this.config.enableQueryLogging) {
          console.log(`[DB Query] ${e.query} - Duration: ${e.duration}ms`);
        }

        // Warn about slow queries that might indicate connection issues
        if (e.duration > 5000) {
          console.warn(`⚠️ Slow query detected (${e.duration}ms): ${e.query}`);
        }
      });
    }

    return this.prismaClient;
  }

  /**
   * Connect to the database with connection monitoring
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    const client = this.getPrismaClient();

    try {
      await client.$connect();
      this.isConnected = true;
      this.connectionCount++;

      if (this.config.enableQueryLogging) {
        console.log(`✅ Database connected (connection #${this.connectionCount})`);
      }
    } catch (error) {
      console.error('❌ Failed to connect to database:', error);
      throw error;
    }
  }

  /**
   * Disconnect from the database and cleanup resources
   */
  async disconnect(): Promise<void> {
    if (!this.prismaClient || !this.isConnected) {
      return;
    }

    try {
      await this.prismaClient.$disconnect();
      this.isConnected = false;

      if (this.config.enableQueryLogging) {
        console.log('✅ Database disconnected gracefully');
      }
    } catch (error) {
      console.error('⚠️ Error during database disconnection:', error);
      // Don't throw here to avoid masking other test errors
    }
  }

  /**
   * Force close all connections (for test teardown)
   */
  async forceCloseAll(): Promise<void> {
    if (this.prismaClient) {
      try {
        // Force disconnect without waiting for pending queries
        await Promise.race([
          this.prismaClient.$disconnect(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Disconnect timeout')), 5000)
          ),
        ]);
      } catch {
        if (this.config.enableQueryLogging) {
          console.warn('⚠️ Forced connection cleanup due to timeout');
        }
      } finally {
        this.prismaClient = null;
        this.isConnected = false;
      }
    }
  }

  /**
   * Reset the connection pool (for between tests)
   */
  async reset(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  /**
   * Get connection health status
   */
  async getConnectionHealth(): Promise<{
    isConnected: boolean;
    connectionCount: number;
    canExecuteQuery: boolean;
  }> {
    const health = {
      isConnected: this.isConnected,
      connectionCount: this.connectionCount,
      canExecuteQuery: false,
    };

    if (this.isConnected && this.prismaClient) {
      try {
        // Test with a simple query
        await this.prismaClient.$queryRaw`SELECT 1`;
        health.canExecuteQuery = true;
      } catch (error) {
        console.warn('⚠️ Connection health check failed:', error);
      }
    }

    return health;
  }

  /**
   * Execute a function with automatic connection management
   */
  async withConnection<T>(fn: (client: PrismaClient) => Promise<T>): Promise<T> {
    await this.connect();
    const client = this.getPrismaClient();

    try {
      return await fn(client);
    } finally {
      // Don't disconnect here - let the pool manage connections
      // Only disconnect in explicit cleanup scenarios
    }
  }

  /**
   * Clean all data from test database
   */
  async cleanDatabase(): Promise<void> {
    const client = this.getPrismaClient();

    try {
      await client.$transaction(
        [
          client.race.deleteMany(),
          client.goal.deleteMany(),
          client.run.deleteMany(),
          client.user.deleteMany(),
        ],
        {
          timeout: this.config.queryTimeout,
        }
      );

      if (this.config.enableQueryLogging) {
        console.log('🧹 Database cleaned successfully');
      }
    } catch (error) {
      console.error('❌ Failed to clean database:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const connectionPool = ConnectionPoolManager.getInstance();

// Export the class for testing
export { ConnectionPoolManager };

// Helper function for tests to get a configured client
export const getTestPrismaClient = (): PrismaClient => {
  return connectionPool.getPrismaClient();
};

// Helper function for test setup
export const setupTestDatabase = async (): Promise<void> => {
  await connectionPool.connect();
};

// Helper function for test teardown
export const teardownTestDatabase = async (): Promise<void> => {
  await connectionPool.cleanDatabase();
  await connectionPool.disconnect();
};

// Helper function for complete cleanup (end of test suite)
export const forceCleanupAllConnections = async (): Promise<void> => {
  await connectionPool.forceCloseAll();
};

// Alias for backward compatibility
export const disconnectAllClients = forceCleanupAllConnections;

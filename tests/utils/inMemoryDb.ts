/**
 * In-Memory SQLite Database Configuration for Testing
 *
 * This module provides utilities for setting up and managing in-memory SQLite
 * databases for faster test execution. In-memory databases are created in RAM
 * and destroyed when the connection is closed, making them ideal for testing.
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface InMemoryDbConfig {
  /** Unique identifier for this database instance */
  id: string;
  /** Whether to enable SQL query logging */
  enableLogging: boolean;
  /** Whether to run migrations on setup */
  runMigrations: boolean;
  /** Custom migration path (optional) */
  migrationPath?: string;
}

export class InMemoryDatabase {
  private client: PrismaClient | null = null;
  private databaseUrl: string;
  private config: InMemoryDbConfig;
  private isSetup = false;

  constructor(config: Partial<InMemoryDbConfig> = {}) {
    this.config = {
      id: config.id || crypto.randomBytes(8).toString('hex'),
      enableLogging: config.enableLogging ?? false,
      runMigrations: config.runMigrations ?? true,
      migrationPath: config.migrationPath,
    };

    // Create in-memory database URL with unique identifier
    this.databaseUrl = `:memory:`;

    // For Prisma, we need to use a temporary file that gets deleted
    // because Prisma doesn't support :memory: directly
    const tempDir = process.env.TMPDIR || '/tmp';
    const tempDbPath = path.join(tempDir, `test-db-${this.config.id}.db`);
    this.databaseUrl = `file:${tempDbPath}`;
  }

  /**
   * Set up the in-memory database with schema and optional seed data
   */
  async setup(): Promise<void> {
    if (this.isSetup) {
      return;
    }

    try {
      // Set environment variable for this database
      process.env.DATABASE_URL = this.databaseUrl;

      // Create Prisma client
      this.client = new PrismaClient({
        log: this.config.enableLogging ? ['query', 'info', 'warn', 'error'] : [],
        datasources: {
          db: {
            url: this.databaseUrl,
          },
        },
      });

      // Run migrations if enabled
      if (this.config.runMigrations) {
        await this.runMigrations();
      }

      // Connect to verify setup
      await this.client.$connect();

      this.isSetup = true;

      if (this.config.enableLogging) {
        console.log(`✅ In-memory database ${this.config.id} setup complete`);
      }
    } catch (error) {
      console.error(`❌ Failed to setup in-memory database ${this.config.id}:`, error);
      throw error;
    }
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    try {
      const migrationPath = this.config.migrationPath || './prisma/migrations';

      // Check if migrations directory exists
      try {
        await fs.access(migrationPath);
      } catch {
        if (this.config.enableLogging) {
          console.log(`No migrations found at ${migrationPath}, creating schema directly`);
        }
        // If no migrations, use prisma db push to create schema
        execSync('npx prisma db push --force-reset', {
          stdio: this.config.enableLogging ? 'inherit' : 'pipe',
          env: {
            ...process.env,
            DATABASE_URL: this.databaseUrl,
          },
        });
        return;
      }

      // Run migrations using Prisma CLI
      execSync('npx prisma migrate deploy', {
        stdio: this.config.enableLogging ? 'inherit' : 'pipe',
        env: {
          ...process.env,
          DATABASE_URL: this.databaseUrl,
        },
      });
    } catch (error) {
      console.error('Failed to run migrations:', error);
      throw error;
    }
  }

  /**
   * Get the Prisma client for this database
   */
  getClient(): PrismaClient {
    if (!this.client || !this.isSetup) {
      throw new Error('Database not setup. Call setup() first.');
    }
    return this.client;
  }

  /**
   * Clean all data from the database (but keep schema)
   */
  async clean(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      // Get all table names from the schema
      const tables = await this.client.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations';
      `;

      // Disable foreign key constraints
      await this.client.$executeRaw`PRAGMA foreign_keys = OFF;`;

      // Delete all data from each table
      for (const table of tables) {
        await this.client.$executeRawUnsafe(`DELETE FROM "${table.name}";`);
      }

      // Re-enable foreign key constraints
      await this.client.$executeRaw`PRAGMA foreign_keys = ON;`;

      if (this.config.enableLogging) {
        console.log(`🧹 Cleaned database ${this.config.id}`);
      }
    } catch (error) {
      console.error(`Failed to clean database ${this.config.id}:`, error);
      throw error;
    }
  }

  /**
   * Seed the database with test data
   */
  async seed(seedFunction?: (client: PrismaClient) => Promise<void>): Promise<void> {
    if (!this.client) {
      throw new Error('Database not setup. Call setup() first.');
    }

    try {
      if (seedFunction) {
        await seedFunction(this.client);
      }

      if (this.config.enableLogging) {
        console.log(`🌱 Seeded database ${this.config.id}`);
      }
    } catch (error) {
      console.error(`Failed to seed database ${this.config.id}:`, error);
      throw error;
    }
  }

  /**
   * Destroy the database and clean up resources
   */
  async destroy(): Promise<void> {
    try {
      if (this.client) {
        await this.client.$disconnect();
        this.client = null;
      }

      // Remove temporary database file if it exists
      if (this.databaseUrl.startsWith('file:')) {
        const filePath = this.databaseUrl.replace('file:', '');
        try {
          await fs.unlink(filePath);
        } catch {
          // File might not exist, that's okay
        }
      }

      this.isSetup = false;

      if (this.config.enableLogging) {
        console.log(`🗑️  Destroyed database ${this.config.id}`);
      }
    } catch (error) {
      console.error(`Failed to destroy database ${this.config.id}:`, error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    tableCount: number;
    totalRows: number;
    databaseSize: number;
    tables: Array<{ name: string; rowCount: number }>;
  }> {
    if (!this.client) {
      throw new Error('Database not setup. Call setup() first.');
    }

    try {
      // Get all tables
      const tables = await this.client.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations';
      `;

      const tableStats: Array<{ name: string; rowCount: number }> = [];
      let totalRows = 0;

      // Get row count for each table
      for (const table of tables) {
        const result = (await this.client.$queryRawUnsafe(
          `SELECT COUNT(*) as count FROM "${table.name}";`
        )) as Array<{ count: bigint }>;
        const rowCount = Number(result[0].count);
        tableStats.push({ name: table.name, rowCount });
        totalRows += rowCount;
      }

      // Get database size (approximate for in-memory)
      let databaseSize = 0;
      try {
        const pageCountResult = await this.client.$queryRaw<
          Array<{ page_count: number }>
        >`PRAGMA page_count;`;
        const pageSizeResult = await this.client.$queryRaw<
          Array<{ page_size: number }>
        >`PRAGMA page_size;`;

        if (pageCountResult.length > 0 && pageSizeResult.length > 0) {
          const pageCount = Number(pageCountResult[0].page_count);
          const pageSize = Number(pageSizeResult[0].page_size);
          databaseSize = pageCount * pageSize;
        }
      } catch {
        // Size calculation failed, use 0
        databaseSize = 0;
      }

      return {
        tableCount: tables.length,
        totalRows,
        databaseSize,
        tables: tableStats,
      };
    } catch (error) {
      console.error(`Failed to get stats for database ${this.config.id}:`, error);
      throw error;
    }
  }

  /**
   * Get the database URL
   */
  getDatabaseUrl(): string {
    return this.databaseUrl;
  }

  /**
   * Check if database is setup and ready
   */
  isReady(): boolean {
    return this.isSetup && this.client !== null;
  }
}

/**
 * Global in-memory database manager for test suites
 */
export class InMemoryDbManager {
  private static databases = new Map<string, InMemoryDatabase>();

  /**
   * Create or get an existing in-memory database
   */
  static async getOrCreate(
    id: string,
    config?: Partial<InMemoryDbConfig>
  ): Promise<InMemoryDatabase> {
    if (this.databases.has(id)) {
      return this.databases.get(id)!;
    }

    const db = new InMemoryDatabase({ ...config, id });
    await db.setup();
    this.databases.set(id, db);
    return db;
  }

  /**
   * Clean up all databases
   */
  static async cleanupAll(): Promise<void> {
    const promises = Array.from(this.databases.values()).map(db => db.destroy());
    await Promise.all(promises);
    this.databases.clear();
  }

  /**
   * Clean up a specific database
   */
  static async cleanup(id: string): Promise<void> {
    const db = this.databases.get(id);
    if (db) {
      await db.destroy();
      this.databases.delete(id);
    }
  }

  /**
   * Get database statistics for all managed databases
   */
  static async getAllStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    for (const [id, db] of this.databases) {
      try {
        stats[id] = await db.getStats();
      } catch (error) {
        stats[id] = { error: error.message };
      }
    }

    return stats;
  }
}

/**
 * Utility function to create a test database with common configuration
 */
export async function createTestDatabase(
  testName?: string,
  config?: Partial<InMemoryDbConfig>
): Promise<InMemoryDatabase> {
  const id = testName || `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  return InMemoryDbManager.getOrCreate(id, {
    enableLogging: process.env.TEST_DB_LOGGING === 'true',
    runMigrations: true,
    ...config,
  });
}

/**
 * Cleanup function for test teardown
 */
export async function cleanupTestDatabases(): Promise<void> {
  await InMemoryDbManager.cleanupAll();
}

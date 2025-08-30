#!/usr/bin/env tsx

/**
 * Database Performance Benchmark Script
 *
 * This script compares the performance of file-based SQLite vs in-memory SQLite
 * for test execution. It measures setup time, query performance, and cleanup time.
 */

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { InMemoryDatabase, createTestDatabase } from '../tests/utils/inMemoryDb';
import { seedBasicTestData, seedPerformanceTestData } from '../tests/utils/testSeeds';
import { PrismaClient } from '@prisma/client';

interface BenchmarkResult {
  name: string;
  setupTime: number;
  queryTime: number;
  cleanupTime: number;
  totalTime: number;
  recordsCreated: number;
  avgQueryTime: number;
}

interface BenchmarkSuite {
  fileBased: BenchmarkResult;
  inMemory: BenchmarkResult;
  improvement: {
    setupTimeImprovement: number;
    queryTimeImprovement: number;
    cleanupTimeImprovement: number;
    totalTimeImprovement: number;
  };
}

class DatabaseBenchmark {
  private results: BenchmarkSuite[] = [];

  /**
   * Benchmark file-based SQLite database
   */
  async benchmarkFileBased(
    testName: string,
    seedFunction: (client: PrismaClient) => Promise<void>
  ): Promise<BenchmarkResult> {
    const tempDir = process.env.TMPDIR || '/tmp';
    const dbPath = path.join(tempDir, `benchmark-${Date.now()}.db`);
    const databaseUrl = `file:${dbPath}`;

    let client: PrismaClient | null = null;

    try {
      // Setup timing
      const setupStart = Date.now();

      // Create client and run migrations
      process.env.DATABASE_URL = databaseUrl;

      execSync('npx prisma db push --force-reset', {
        stdio: 'pipe',
        env: { ...process.env, DATABASE_URL: databaseUrl },
      });

      client = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
      });

      await client.$connect();
      await seedFunction(client);

      const setupEnd = Date.now();
      const setupTime = setupEnd - setupStart;

      // Query timing
      const queryStart = Date.now();

      // Perform typical test queries
      const userCount = await client.user.count();
      const runCount = await client.run.count();
      const goalCount = await client.goal.count();
      const raceCount = await client.race.count();

      // Complex query with joins
      const userWithRuns = await client.user.findMany({
        include: {
          runs: true,
          goals: true,
          races: true,
        },
      });

      // Aggregation query
      const totalDistance = await client.run.aggregate({
        _sum: { distance: true },
        _avg: { duration: true },
      });

      const queryEnd = Date.now();
      const queryTime = queryEnd - queryStart;

      // Cleanup timing
      const cleanupStart = Date.now();

      await client.$disconnect();
      await fs.unlink(dbPath);

      const cleanupEnd = Date.now();
      const cleanupTime = cleanupEnd - cleanupStart;

      const recordsCreated = userCount + runCount + goalCount + raceCount;
      const totalTime = setupTime + queryTime + cleanupTime;
      const avgQueryTime = queryTime / 6; // 6 queries performed

      return {
        name: `${testName} (File-based)`,
        setupTime,
        queryTime,
        cleanupTime,
        totalTime,
        recordsCreated,
        avgQueryTime,
      };
    } catch (error) {
      console.error(`File-based benchmark failed for ${testName}:`, error);
      throw error;
    } finally {
      if (client) {
        try {
          await client.$disconnect();
        } catch {
          // Ignore disconnection errors
        }
      }
    }
  }

  /**
   * Benchmark in-memory SQLite database
   */
  async benchmarkInMemory(
    testName: string,
    seedFunction: (client: PrismaClient) => Promise<void>
  ): Promise<BenchmarkResult> {
    let db: InMemoryDatabase | null = null;

    try {
      // Setup timing
      const setupStart = Date.now();

      db = await createTestDatabase(`benchmark-${testName}`, {
        enableLogging: false,
        runMigrations: true,
      });

      await db.seed(seedFunction);

      const setupEnd = Date.now();
      const setupTime = setupEnd - setupStart;

      // Query timing
      const queryStart = Date.now();

      const client = db.getClient();

      // Perform same queries as file-based test
      const userCount = await client.user.count();
      const runCount = await client.run.count();
      const goalCount = await client.goal.count();
      const raceCount = await client.race.count();

      // Complex query with joins
      const userWithRuns = await client.user.findMany({
        include: {
          runs: true,
          goals: true,
          races: true,
        },
      });

      // Aggregation query
      const totalDistance = await client.run.aggregate({
        _sum: { distance: true },
        _avg: { duration: true },
      });

      const queryEnd = Date.now();
      const queryTime = queryEnd - queryStart;

      // Cleanup timing
      const cleanupStart = Date.now();

      await db.destroy();

      const cleanupEnd = Date.now();
      const cleanupTime = cleanupEnd - cleanupStart;

      const recordsCreated = userCount + runCount + goalCount + raceCount;
      const totalTime = setupTime + queryTime + cleanupTime;
      const avgQueryTime = queryTime / 6; // 6 queries performed

      return {
        name: `${testName} (In-memory)`,
        setupTime,
        queryTime,
        cleanupTime,
        totalTime,
        recordsCreated,
        avgQueryTime,
      };
    } catch (error) {
      console.error(`In-memory benchmark failed for ${testName}:`, error);
      throw error;
    } finally {
      if (db) {
        try {
          await db.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Run a complete benchmark suite
   */
  async runBenchmarkSuite(
    testName: string,
    seedFunction: (client: PrismaClient) => Promise<void>
  ): Promise<BenchmarkSuite> {
    console.log(`\n🏃 Running benchmark: ${testName}`);

    // Run file-based benchmark
    console.log('  📁 Testing file-based SQLite...');
    const fileBased = await this.benchmarkFileBased(testName, seedFunction);

    // Run in-memory benchmark
    console.log('  💾 Testing in-memory SQLite...');
    const inMemory = await this.benchmarkInMemory(testName, seedFunction);

    // Calculate improvements
    const improvement = {
      setupTimeImprovement:
        ((fileBased.setupTime - inMemory.setupTime) / fileBased.setupTime) * 100,
      queryTimeImprovement:
        ((fileBased.queryTime - inMemory.queryTime) / fileBased.queryTime) * 100,
      cleanupTimeImprovement:
        ((fileBased.cleanupTime - inMemory.cleanupTime) / fileBased.cleanupTime) * 100,
      totalTimeImprovement:
        ((fileBased.totalTime - inMemory.totalTime) / fileBased.totalTime) * 100,
    };

    const suite: BenchmarkSuite = {
      fileBased,
      inMemory,
      improvement,
    };

    this.results.push(suite);
    return suite;
  }

  /**
   * Generate a detailed performance report
   */
  generateReport(): string {
    let report = '\n# 📊 Database Performance Benchmark Report\n\n';

    report += `Generated: ${new Date().toLocaleString()}\n\n`;

    for (const suite of this.results) {
      report += `## ${suite.fileBased.name.split(' (')[0]}\n\n`;

      report += '### Performance Comparison\n\n';
      report += '| Metric | File-based SQLite | In-memory SQLite | Improvement |\n';
      report += '|--------|------------------|-----------------|-------------|\n';
      report += `| Setup Time | ${suite.fileBased.setupTime}ms | ${suite.inMemory.setupTime}ms | ${suite.improvement.setupTimeImprovement.toFixed(1)}% |\n`;
      report += `| Query Time | ${suite.fileBased.queryTime}ms | ${suite.inMemory.queryTime}ms | ${suite.improvement.queryTimeImprovement.toFixed(1)}% |\n`;
      report += `| Cleanup Time | ${suite.fileBased.cleanupTime}ms | ${suite.inMemory.cleanupTime}ms | ${suite.improvement.cleanupTimeImprovement.toFixed(1)}% |\n`;
      report += `| **Total Time** | **${suite.fileBased.totalTime}ms** | **${suite.inMemory.totalTime}ms** | **${suite.improvement.totalTimeImprovement.toFixed(1)}%** |\n`;
      report += `| Records Created | ${suite.fileBased.recordsCreated} | ${suite.inMemory.recordsCreated} | - |\n`;
      report += `| Avg Query Time | ${suite.fileBased.avgQueryTime.toFixed(1)}ms | ${suite.inMemory.avgQueryTime.toFixed(1)}ms | ${(((suite.fileBased.avgQueryTime - suite.inMemory.avgQueryTime) / suite.fileBased.avgQueryTime) * 100).toFixed(1)}% |\n\n`;
    }

    // Overall summary
    if (this.results.length > 1) {
      const avgTotalImprovement =
        this.results.reduce((sum, suite) => sum + suite.improvement.totalTimeImprovement, 0) /
        this.results.length;
      const avgSetupImprovement =
        this.results.reduce((sum, suite) => sum + suite.improvement.setupTimeImprovement, 0) /
        this.results.length;
      const avgQueryImprovement =
        this.results.reduce((sum, suite) => sum + suite.improvement.queryTimeImprovement, 0) /
        this.results.length;
      const avgCleanupImprovement =
        this.results.reduce((sum, suite) => sum + suite.improvement.cleanupTimeImprovement, 0) /
        this.results.length;

      report += '## 📈 Overall Performance Summary\n\n';
      report += '| Category | Average Improvement |\n';
      report += '|----------|--------------------|\n';
      report += `| Setup Time | ${avgSetupImprovement.toFixed(1)}% |\n`;
      report += `| Query Performance | ${avgQueryImprovement.toFixed(1)}% |\n`;
      report += `| Cleanup Time | ${avgCleanupImprovement.toFixed(1)}% |\n`;
      report += `| **Overall Performance** | **${avgTotalImprovement.toFixed(1)}%** |\n\n`;
    }

    report += '## 💡 Recommendations\n\n';

    const bestImprovement = Math.max(...this.results.map(s => s.improvement.totalTimeImprovement));

    if (bestImprovement > 50) {
      report +=
        '✅ **Highly Recommended**: In-memory SQLite provides significant performance improvements (>50%)\n\n';
    } else if (bestImprovement > 20) {
      report +=
        '✅ **Recommended**: In-memory SQLite provides good performance improvements (>20%)\n\n';
    } else {
      report += '⚠️ **Consider**: Performance improvements are modest. Evaluate other factors.\n\n';
    }

    report += '### Implementation Steps:\n';
    report += '1. Update test setup to use `InMemoryDatabase` class\n';
    report += '2. Configure test suites with `setupInMemoryDb()` and `cleanupInMemoryDb()`\n';
    report += '3. Use seed functions for consistent test data\n';
    report += '4. Monitor test execution times after implementation\n\n';

    report += '### Best Practices:\n';
    report += '- Use in-memory databases for unit and integration tests\n';
    report += '- Keep file-based databases for E2E tests if external tools need access\n';
    report += '- Clean database between tests for isolation\n';
    report += '- Use seed functions for consistent test data\n';

    return report;
  }
}

/**
 * Main benchmark execution function
 */
async function main(): Promise<void> {
  console.log('🚀 Starting Database Performance Benchmark\n');

  const benchmark = new DatabaseBenchmark();

  try {
    // Benchmark 1: Basic test data (small dataset)
    await benchmark.runBenchmarkSuite('Basic Test Data', seedBasicTestData);

    // Benchmark 2: Performance test data (large dataset)
    await benchmark.runBenchmarkSuite('Performance Test Data', seedPerformanceTestData);

    // Generate and save report
    const report = benchmark.generateReport();
    console.log(report);

    // Save report to file
    const reportPath = path.join(process.cwd(), 'benchmark-results.md');
    await fs.writeFile(reportPath, report);

    console.log(`\n📄 Full report saved to: ${reportPath}`);
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

// Execute if this is the main module
main();

export { DatabaseBenchmark, BenchmarkResult, BenchmarkSuite };

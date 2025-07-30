#!/usr/bin/env tsx

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { glob } from 'glob';

interface TestFile {
  path: string;
  type: 'unit' | 'integration' | 'e2e';
  requiresDatabase: boolean;
  estimatedDuration?: number;
}

interface TestGroup {
  name: string;
  files: TestFile[];
  canRunInParallel: boolean;
  maxWorkers?: number;
}

interface TestResult {
  file: string;
  duration: number;
  passed: boolean;
  error?: string;
}

class ParallelTestOrchestrator {
  private maxWorkers: number;
  private testFiles: TestFile[] = [];
  private results: TestResult[] = [];

  constructor(maxWorkers?: number) {
    this.maxWorkers = maxWorkers || this.calculateOptimalWorkers();
  }

  private calculateOptimalWorkers(): number {
    const cpuCount = os.cpus().length;
    const memoryGB = os.totalmem() / (1024 * 1024 * 1024);

    // Conservative approach for CI environments
    if (process.env.CI === 'true') {
      return Math.min(2, cpuCount);
    }

    // For local development, use more workers but leave some resources
    const memoryBasedLimit = Math.floor(memoryGB / 2); // 2GB per worker
    const cpuBasedLimit = Math.max(1, cpuCount - 1); // Leave one CPU free

    return Math.min(memoryBasedLimit, cpuBasedLimit, 4); // Cap at 4 workers
  }

  async analyzeTestFiles(): Promise<void> {
    console.log('🔍 Analyzing test files...\n');

    // Find all test files
    const unitTests = await glob('src/**/*.test.{ts,tsx}', { ignore: 'node_modules/**' });
    const integrationTests = await glob('tests/integration/**/*.test.{ts,js}', {
      ignore: 'node_modules/**',
    });
    const e2eTests = await glob('tests/e2e/**/*.test.{ts,js}', { ignore: 'node_modules/**' });

    // Analyze unit tests
    for (const file of unitTests) {
      const content = fs.readFileSync(file, 'utf-8');
      const requiresDatabase = this.checkDatabaseDependency(content);

      this.testFiles.push({
        path: file,
        type: 'unit',
        requiresDatabase,
        estimatedDuration: this.estimateTestDuration(content),
      });
    }

    // Integration tests typically require database
    for (const file of integrationTests) {
      const content = fs.readFileSync(file, 'utf-8');

      this.testFiles.push({
        path: file,
        type: 'integration',
        requiresDatabase: true, // Conservative: assume all integration tests need DB
        estimatedDuration: this.estimateTestDuration(content) * 2, // Integration tests are slower
      });
    }

    // E2E tests require full environment
    for (const file of e2eTests) {
      const content = fs.readFileSync(file, 'utf-8');

      this.testFiles.push({
        path: file,
        type: 'e2e',
        requiresDatabase: true,
        estimatedDuration: this.estimateTestDuration(content) * 3, // E2E tests are slowest
      });
    }

    console.log(`Found ${this.testFiles.length} test files:`);
    console.log(`- Unit tests: ${unitTests.length}`);
    console.log(`- Integration tests: ${integrationTests.length}`);
    console.log(`- E2E tests: ${e2eTests.length}`);
    console.log(`- Database-dependent: ${this.testFiles.filter(f => f.requiresDatabase).length}`);
    console.log(
      `- Can run in parallel: ${this.testFiles.filter(f => !f.requiresDatabase).length}\n`
    );
  }

  private checkDatabaseDependency(content: string): boolean {
    const databaseIndicators = [
      'prisma',
      'PrismaClient',
      'db.',
      'database',
      'createTestUser',
      'cleanupDatabase',
      'migrate',
      '@prisma/client',
      'test.db',
      'DATABASE_URL',
    ];

    return databaseIndicators.some(indicator =>
      content.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  private estimateTestDuration(content: string): number {
    // Simple heuristic based on test count and complexity
    const testCount = (content.match(/\b(it|test|describe)\s*\(/g) || []).length;
    const hasAsync = content.includes('async') || content.includes('await');
    const hasTimeout = content.includes('timeout');

    let baseDuration = testCount * 100; // 100ms per test

    if (hasAsync) baseDuration *= 1.5;
    if (hasTimeout) baseDuration *= 2;

    return baseDuration;
  }

  createTestGroups(): TestGroup[] {
    const groups: TestGroup[] = [];

    // Group 1: Non-database unit tests (highly parallel)
    const parallelUnitTests = this.testFiles.filter(f => f.type === 'unit' && !f.requiresDatabase);

    if (parallelUnitTests.length > 0) {
      groups.push({
        name: 'Parallel Unit Tests',
        files: parallelUnitTests,
        canRunInParallel: true,
        maxWorkers: this.maxWorkers,
      });
    }

    // Group 2: Database-dependent unit tests (limited parallelism)
    const dbUnitTests = this.testFiles.filter(f => f.type === 'unit' && f.requiresDatabase);

    if (dbUnitTests.length > 0) {
      groups.push({
        name: 'Database Unit Tests',
        files: dbUnitTests,
        canRunInParallel: true,
        maxWorkers: Math.min(2, this.maxWorkers), // Limit DB connections
      });
    }

    // Group 3: Integration tests (sequential)
    const integrationTests = this.testFiles.filter(f => f.type === 'integration');

    if (integrationTests.length > 0) {
      groups.push({
        name: 'Integration Tests',
        files: integrationTests,
        canRunInParallel: false,
        maxWorkers: 1,
      });
    }

    // Group 4: E2E tests (sequential)
    const e2eTests = this.testFiles.filter(f => f.type === 'e2e');

    if (e2eTests.length > 0) {
      groups.push({
        name: 'E2E Tests',
        files: e2eTests,
        canRunInParallel: false,
        maxWorkers: 1,
      });
    }

    return groups;
  }

  async runTestGroup(group: TestGroup): Promise<TestResult[]> {
    console.log(`\n🧪 Running ${group.name}...`);
    console.log(
      `Files: ${group.files.length}, Parallel: ${group.canRunInParallel}, Workers: ${group.maxWorkers}`
    );

    if (group.canRunInParallel && group.maxWorkers! > 1) {
      return this.runTestsInParallel(group);
    } else {
      return this.runTestsSequentially(group);
    }
  }

  private async runTestsInParallel(group: TestGroup): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const queue = [...group.files];
    const workers: Promise<TestResult>[] = [];

    // Function to run a single test
    const runTest = async (file: TestFile): Promise<TestResult> => {
      const startTime = Date.now();

      try {
        await this.executeTest(file);
        return {
          file: file.path,
          duration: Date.now() - startTime,
          passed: true,
        };
      } catch (error) {
        return {
          file: file.path,
          duration: Date.now() - startTime,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    // Start initial workers
    for (let i = 0; i < Math.min(group.maxWorkers!, queue.length); i++) {
      const file = queue.shift()!;
      workers.push(runTest(file));
    }

    // Process queue
    while (workers.length > 0) {
      const result = await Promise.race(workers);
      results.push(result);

      const workerIndex = workers.findIndex(async w => (await w) === result);
      workers.splice(workerIndex, 1);

      // Start new worker if queue has items
      if (queue.length > 0) {
        const file = queue.shift()!;
        workers.push(runTest(file));
      }
    }

    return results;
  }

  private async runTestsSequentially(group: TestGroup): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const file of group.files) {
      const startTime = Date.now();

      try {
        await this.executeTest(file);
        results.push({
          file: file.path,
          duration: Date.now() - startTime,
          passed: true,
        });
      } catch (error) {
        results.push({
          file: file.path,
          duration: Date.now() - startTime,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  private executeTest(file: TestFile): Promise<void> {
    return new Promise((resolve, reject) => {
      const testCommand = this.getTestCommand(file);
      const args = this.getTestArgs(file);

      const child = spawn(testCommand, [...args, file.path], {
        stdio: 'pipe',
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      let output = '';

      child.stdout.on('data', data => {
        output += data.toString();
        process.stdout.write(`[${path.basename(file.path)}] ${data}`);
      });

      child.stderr.on('data', data => {
        output += data.toString();
        process.stderr.write(`[${path.basename(file.path)}] ${data}`);
      });

      child.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Test failed with exit code ${code}`));
        }
      });

      child.on('error', error => {
        reject(error);
      });
    });
  }

  private getTestCommand(file: TestFile): string {
    switch (file.type) {
      case 'unit':
        return 'npx';
      case 'integration':
        return 'npx';
      case 'e2e':
        return 'npx';
      default:
        return 'npx';
    }
  }

  private getTestArgs(file: TestFile): string[] {
    switch (file.type) {
      case 'unit':
        return ['vitest', 'run'];
      case 'integration':
        return ['jest', '--runInBand'];
      case 'e2e':
        return ['playwright', 'test'];
      default:
        return [];
    }
  }

  async orchestrate(): Promise<void> {
    console.log('🚀 Parallel Test Orchestrator');
    console.log(`Max workers: ${this.maxWorkers}`);
    console.log(`CI mode: ${process.env.CI === 'true' ? 'Yes' : 'No'}\n`);

    // Analyze test files
    await this.analyzeTestFiles();

    // Create test groups
    const groups = this.createTestGroups();

    // Run each group
    for (const group of groups) {
      const results = await this.runTestGroup(group);
      this.results.push(...results);
    }

    // Generate report
    this.generateReport();
  }

  private generateReport(): void {
    console.log('\n\n📊 Test Execution Report');
    console.log('='.repeat(60));

    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log(`Total tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(`Total duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`Average duration: ${(totalDuration / totalTests / 1000).toFixed(2)}s`);

    if (failedTests > 0) {
      console.log('\n❌ Failed tests:');
      this.results
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`  ${r.file}`);
          if (r.error) {
            console.log(`    Error: ${r.error}`);
          }
        });
    }

    // Performance analysis
    console.log('\n⚡ Performance Analysis:');
    const groups = this.createTestGroups();

    groups.forEach(group => {
      const groupResults = this.results.filter(r => group.files.some(f => f.path === r.file));

      if (groupResults.length > 0) {
        const groupDuration = groupResults.reduce((sum, r) => sum + r.duration, 0);
        const parallelFactor = group.canRunInParallel ? group.maxWorkers! : 1;
        const theoreticalDuration = groupDuration / parallelFactor;

        console.log(`\n${group.name}:`);
        console.log(`  Files: ${groupResults.length}`);
        console.log(`  Total duration: ${(groupDuration / 1000).toFixed(2)}s`);
        console.log(`  Parallel factor: ${parallelFactor}x`);
        console.log(`  Theoretical minimum: ${(theoreticalDuration / 1000).toFixed(2)}s`);
      }
    });

    // Save detailed report
    const reportPath = path.join(process.cwd(), 'test-reports', `parallel-test-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          summary: {
            totalTests,
            passedTests,
            failedTests,
            totalDuration,
            maxWorkers: this.maxWorkers,
          },
          results: this.results,
          groups: groups.map(g => ({
            name: g.name,
            fileCount: g.files.length,
            canRunInParallel: g.canRunInParallel,
            maxWorkers: g.maxWorkers,
          })),
        },
        null,
        2
      )
    );

    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }
}

// Export for use in other scripts
export { ParallelTestOrchestrator, TestFile, TestGroup, TestResult };

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const maxWorkers = args.includes('--workers')
    ? parseInt(args[args.indexOf('--workers') + 1])
    : undefined;

  const orchestrator = new ParallelTestOrchestrator(maxWorkers);

  orchestrator
    .orchestrate()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Orchestration failed:', error);
      process.exit(1);
    });
}

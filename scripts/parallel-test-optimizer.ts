#!/usr/bin/env tsx

/**
 * Parallel Test Optimizer
 *
 * This script analyzes test files and optimizes their grouping for better parallelization.
 * It considers test execution time, resource usage, and dependencies to create optimal
 * test groups that can run in parallel safely.
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface TestFile {
  path: string;
  type: 'unit' | 'integration' | 'e2e';
  estimatedDuration: number;
  resourceIntensive: boolean;
  databaseDependent: boolean;
  browserDependent: boolean;
  parallelSafe: boolean;
}

interface TestGroup {
  name: string;
  files: TestFile[];
  estimatedDuration: number;
  maxParallelWorkers: number;
  requirements: string[];
}

class ParallelTestOptimizer {
  private testFiles: TestFile[] = [];

  async analyzeTestFiles(): Promise<void> {
    console.log('🔍 Analyzing test files for optimal parallelization...\n');

    // Analyze unit tests
    await this.analyzeTestDirectory('tests/unit', 'unit');
    await this.analyzeTestDirectory('src', 'unit'); // Component tests

    // Analyze integration tests
    await this.analyzeTestDirectory('tests/integration', 'integration');

    // Analyze E2E tests
    await this.analyzeTestDirectory('tests/e2e', 'e2e');

    console.log(`Found ${this.testFiles.length} test files to analyze\n`);
  }

  private async analyzeTestDirectory(
    directory: string,
    type: 'unit' | 'integration' | 'e2e'
  ): Promise<void> {
    try {
      const files = await this.findTestFiles(directory);

      for (const file of files) {
        const testFile = await this.analyzeTestFile(file, type);
        this.testFiles.push(testFile);
      }
    } catch (err) {
      console.warn(`Could not analyze directory ${directory}:`, err);
    }
  }

  private async findTestFiles(directory: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          files.push(...(await this.findTestFiles(fullPath)));
        } else if (entry.isFile() && this.isTestFile(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch (err) {
      // Directory might not exist
    }

    return files;
  }

  private isTestFile(filename: string): boolean {
    return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filename);
  }

  private async analyzeTestFile(
    filePath: string,
    type: 'unit' | 'integration' | 'e2e'
  ): Promise<TestFile> {
    const content = await fs.readFile(filePath, 'utf-8');

    // Estimate duration based on test count and complexity
    const testCount = (content.match(/\b(test|it|describe)\(/g) || []).length;
    const hasAsyncOperations = /\b(async|await|setTimeout|setInterval|Promise)\b/.test(content);

    let estimatedDuration = testCount * 0.1; // Base: 100ms per test

    if (hasAsyncOperations) estimatedDuration *= 2;
    if (type === 'integration') estimatedDuration *= 3;
    if (type === 'e2e') estimatedDuration *= 10;

    // Analyze dependencies and resource usage
    const databaseDependent = /\b(prisma|database|db|sql)\b/i.test(content);
    const browserDependent = /\b(page\.|browser\.|playwright|puppeteer)\b/.test(content);
    const resourceIntensive =
      /\b(large|bulk|performance|memory|cpu)\b/i.test(content) ||
      content.includes('jest.setTimeout') ||
      content.includes('test.setTimeout');

    // Determine if test is parallel-safe
    const parallelSafe =
      !databaseDependent ||
      (content.includes('beforeEach') && content.includes('cleanup')) ||
      type === 'unit';

    return {
      path: filePath,
      type,
      estimatedDuration,
      resourceIntensive,
      databaseDependent,
      browserDependent,
      parallelSafe,
    };
  }

  async createOptimalGroups(): Promise<TestGroup[]> {
    console.log('📊 Creating optimal test groups...\n');

    const groups: TestGroup[] = [];

    // Group 1: Fast parallel-safe unit tests
    const fastUnitTests = this.testFiles.filter(
      t => t.type === 'unit' && t.parallelSafe && t.estimatedDuration < 2 && !t.resourceIntensive
    );

    if (fastUnitTests.length > 0) {
      groups.push({
        name: 'fast-unit-tests',
        files: fastUnitTests,
        estimatedDuration: Math.max(...fastUnitTests.map(t => t.estimatedDuration)),
        maxParallelWorkers: Math.min(8, Math.max(2, Math.ceil(fastUnitTests.length / 10))),
        requirements: ['node', 'jest'],
      });
    }

    // Group 2: Slow or resource-intensive unit tests
    const slowUnitTests = this.testFiles.filter(
      t => t.type === 'unit' && (t.estimatedDuration >= 2 || t.resourceIntensive) && t.parallelSafe
    );

    if (slowUnitTests.length > 0) {
      groups.push({
        name: 'slow-unit-tests',
        files: slowUnitTests,
        estimatedDuration: slowUnitTests.reduce((sum, t) => sum + t.estimatedDuration, 0),
        maxParallelWorkers: Math.min(4, Math.max(1, Math.ceil(slowUnitTests.length / 5))),
        requirements: ['node', 'jest', 'high-memory'],
      });
    }

    // Group 3: Database-dependent integration tests (sequential)
    const dbIntegrationTests = this.testFiles.filter(
      t => t.type === 'integration' && t.databaseDependent
    );

    if (dbIntegrationTests.length > 0) {
      groups.push({
        name: 'database-integration-tests',
        files: dbIntegrationTests,
        estimatedDuration: dbIntegrationTests.reduce((sum, t) => sum + t.estimatedDuration, 0),
        maxParallelWorkers: 1, // Sequential for database safety
        requirements: ['node', 'jest', 'database', 'sequential'],
      });
    }

    // Group 4: API integration tests (limited parallelism)
    const apiIntegrationTests = this.testFiles.filter(
      t => t.type === 'integration' && !t.databaseDependent && t.parallelSafe
    );

    if (apiIntegrationTests.length > 0) {
      groups.push({
        name: 'api-integration-tests',
        files: apiIntegrationTests,
        estimatedDuration: Math.max(...apiIntegrationTests.map(t => t.estimatedDuration)),
        maxParallelWorkers: 2, // Limited for API rate limiting
        requirements: ['node', 'jest', 'network'],
      });
    }

    // Group 5: Browser E2E tests (sharded)
    const browserE2ETests = this.testFiles.filter(t => t.type === 'e2e' && t.browserDependent);

    if (browserE2ETests.length > 0) {
      const shardsNeeded = Math.min(3, Math.max(1, Math.ceil(browserE2ETests.length / 3)));

      for (let i = 0; i < shardsNeeded; i++) {
        const shardFiles = browserE2ETests.filter((_, index) => index % shardsNeeded === i);

        if (shardFiles.length > 0) {
          groups.push({
            name: `e2e-browser-shard-${i + 1}`,
            files: shardFiles,
            estimatedDuration: Math.max(...shardFiles.map(t => t.estimatedDuration)) * 1.2, // Add overhead for browser startup
            maxParallelWorkers: 2, // 2 workers per shard
            requirements: ['node', 'playwright', 'browser', 'display'],
          });
        }
      }
    }

    // Group 6: Non-browser E2E tests (API-only)
    const apiE2ETests = this.testFiles.filter(t => t.type === 'e2e' && !t.browserDependent);

    if (apiE2ETests.length > 0) {
      groups.push({
        name: 'e2e-api-tests',
        files: apiE2ETests,
        estimatedDuration: Math.max(...apiE2ETests.map(t => t.estimatedDuration)),
        maxParallelWorkers: 3,
        requirements: ['node', 'network'],
      });
    }

    return groups;
  }

  async generateOptimizationReport(groups: TestGroup[]): Promise<void> {
    console.log('📈 Parallelization Optimization Report\n');

    const totalFiles = this.testFiles.length;
    const totalDuration = this.testFiles.reduce((sum, t) => sum + t.estimatedDuration, 0);
    const parallelDuration = Math.max(...groups.map(g => g.estimatedDuration));
    const speedup = totalDuration / parallelDuration;

    console.log('### Overall Statistics');
    console.log(`Total test files: ${totalFiles}`);
    console.log(`Sequential duration: ${totalDuration.toFixed(1)}s`);
    console.log(`Parallel duration: ${parallelDuration.toFixed(1)}s`);
    console.log(`Expected speedup: ${speedup.toFixed(1)}x`);
    console.log(`Efficiency: ${((speedup / groups.length) * 100).toFixed(1)}%\n`);

    console.log('### Test Groups');
    for (const group of groups) {
      console.log(`**${group.name}**`);
      console.log(`- Files: ${group.files.length}`);
      console.log(`- Duration: ${group.estimatedDuration.toFixed(1)}s`);
      console.log(`- Workers: ${group.maxParallelWorkers}`);
      console.log(`- Requirements: ${group.requirements.join(', ')}`);
      console.log('');
    }

    console.log('### Recommendations');

    // Analyze bottlenecks
    const slowestGroup = groups.reduce((prev, current) =>
      prev.estimatedDuration > current.estimatedDuration ? prev : current
    );

    if (slowestGroup.estimatedDuration > parallelDuration * 0.8) {
      console.log(
        `- Consider splitting "${slowestGroup.name}" further (${slowestGroup.estimatedDuration.toFixed(1)}s)`
      );
    }

    const sequentialGroups = groups.filter(g => g.maxParallelWorkers === 1);
    if (sequentialGroups.length > 0) {
      console.log(
        `- ${sequentialGroups.length} groups run sequentially - consider isolating dependencies`
      );
    }

    const highWorkerGroups = groups.filter(g => g.maxParallelWorkers > 4);
    if (highWorkerGroups.length > 0) {
      console.log(`- ${highWorkerGroups.length} groups use >4 workers - monitor resource usage`);
    }

    console.log(
      `- Total workers needed: ${groups.reduce((sum, g) => sum + g.maxParallelWorkers, 0)}`
    );
    console.log(
      `- Recommended CI runners: ${Math.ceil(groups.reduce((sum, g) => sum + g.maxParallelWorkers, 0) / 4)}`
    );
  }

  async generateConfigurationFiles(groups: TestGroup[]): Promise<void> {
    console.log('⚙️ Generating optimized configuration files...\n');

    // Generate Jest configuration for different groups
    const jestConfigs = groups
      .filter(g => g.requirements.includes('jest'))
      .map(group => ({
        name: group.name,
        testMatch: group.files.map(f => `<rootDir>/${f.path}`),
        maxWorkers: group.maxParallelWorkers,
        runInBand: group.maxParallelWorkers === 1,
      }));

    // Generate Playwright sharding configuration
    const playwrightShards = groups
      .filter(g => g.requirements.includes('playwright'))
      .map((group, index) => ({
        name: group.name,
        shard: `${index + 1}/${groups.filter(g => g.requirements.includes('playwright')).length}`,
        workers: group.maxParallelWorkers,
      }));

    // Write configuration files
    await fs.writeFile(
      'test-groups.json',
      JSON.stringify(
        {
          groups: groups.map(g => ({
            name: g.name,
            files: g.files.map(f => f.path),
            workers: g.maxParallelWorkers,
            requirements: g.requirements,
            estimatedDuration: g.estimatedDuration,
          })),
        },
        null,
        2
      )
    );

    console.log('✅ Generated test-groups.json with optimization data');

    // Generate npm scripts for parallel execution
    const npmScripts = groups.map(group => {
      const command = group.requirements.includes('playwright')
        ? `playwright test --grep="${group.name}" --workers=${group.maxParallelWorkers}`
        : group.requirements.includes('jest')
          ? `jest --testPathPattern="${group.name}" --maxWorkers=${group.maxParallelWorkers}${group.maxParallelWorkers === 1 ? ' --runInBand' : ''}`
          : `vitest run --config vitest.config.ts --threads=${group.maxParallelWorkers}`;

      return `"test:${group.name}": "${command}"`;
    });

    console.log('\n📝 Suggested package.json scripts:');
    for (const script of npmScripts) {
      console.log(`    ${script},`);
    }
  }

  async validateCurrentConfiguration(): Promise<void> {
    console.log('🔍 Validating current parallelization configuration...\n');

    // Check Jest configuration files
    try {
      await fs.access('jest.config.js');
      const jestConfigContent = await fs.readFile('jest.config.js', 'utf-8');
      console.log('✅ Jest configuration found');

      if (jestConfigContent.includes('maxWorkers')) {
        const maxWorkersMatch = jestConfigContent.match(/maxWorkers:\s*([^,\n]+)/);
        console.log(`   - Max workers: ${maxWorkersMatch?.[1] || 'configured'}`);
      }

      if (jestConfigContent.includes('runInBand')) {
        console.log(`   - Run in band: configured`);
      }
    } catch (err) {
      console.log('⚠️  Jest configuration not found');
    }

    // Check Jest CI configuration
    try {
      await fs.access('jest.config.ci.js');
      const jestCiContent = await fs.readFile('jest.config.ci.js', 'utf-8');
      console.log('✅ Jest CI configuration found');

      if (jestCiContent.includes('maxWorkers')) {
        const maxWorkersMatch = jestCiContent.match(/maxWorkers:\s*([^,\n]+)/);
        console.log(`   - CI Max workers: ${maxWorkersMatch?.[1] || 'configured'}`);
      }
    } catch (err) {
      console.log('⚠️  Jest CI configuration not found');
    }

    // Check Playwright configuration
    try {
      await fs.access('playwright.config.ts');
      const playwrightConfigContent = await fs.readFile('playwright.config.ts', 'utf-8');
      console.log('✅ Playwright configuration found');

      if (playwrightConfigContent.includes('workers')) {
        console.log(`   - Workers: configured dynamically`);
      }

      if (playwrightConfigContent.includes('fullyParallel')) {
        console.log(`   - Fully parallel: enabled`);
      }

      if (playwrightConfigContent.includes('shard')) {
        console.log(`   - Sharding: enabled`);
      }
    } catch (err) {
      console.log('⚠️  Playwright configuration not found');
    }

    // Check Vitest configuration
    try {
      await fs.access('vitest.config.ts');
      const vitestConfigContent = await fs.readFile('vitest.config.ts', 'utf-8');
      console.log('✅ Vitest configuration found');

      if (vitestConfigContent.includes('pool')) {
        console.log(`   - Thread pool: configured`);
      }

      if (
        vitestConfigContent.includes('maxThreads') ||
        vitestConfigContent.includes('minThreads')
      ) {
        console.log(`   - Thread limits: configured`);
      }
    } catch (err) {
      console.log('⚠️  Vitest configuration not found');
    }

    // Check CI Vitest configuration
    try {
      await fs.access('vitest.config.ci.ts');
      const vitestCiContent = await fs.readFile('vitest.config.ci.ts', 'utf-8');
      console.log('✅ Vitest CI configuration found');

      if (vitestCiContent.includes('maxThreads')) {
        const maxThreadsMatch = vitestCiContent.match(/maxThreads:\s*[^?]*\?\s*(\d+)\s*:\s*(\d+)/);
        console.log(
          `   - CI Threads: ${maxThreadsMatch?.[1] || 'configured'} (CI) / ${maxThreadsMatch?.[2] || 'configured'} (local)`
        );
      }
    } catch (err) {
      console.log('⚠️  Vitest CI configuration not found');
    }

    console.log('');
  }
}

// CLI Interface
async function main() {
  const optimizer = new ParallelTestOptimizer();
  const command = process.argv[2];

  switch (command) {
    case 'analyze':
      await optimizer.validateCurrentConfiguration();
      await optimizer.analyzeTestFiles();
      const groups = await optimizer.createOptimalGroups();
      await optimizer.generateOptimizationReport(groups);
      break;

    case 'generate':
      await optimizer.analyzeTestFiles();
      const generatedGroups = await optimizer.createOptimalGroups();
      await optimizer.generateConfigurationFiles(generatedGroups);
      break;

    case 'validate':
      await optimizer.validateCurrentConfiguration();
      break;

    default:
      console.log('Parallel Test Optimizer');
      console.log('\nUsage:');
      console.log('  npm run parallel:analyze   - Analyze tests and show optimization report');
      console.log('  npm run parallel:generate  - Generate optimized configuration files');
      console.log('  npm run parallel:validate  - Validate current parallelization setup');
  }
}

// Execute if this is the main module
main().catch(console.error);

export default ParallelTestOptimizer;

#!/usr/bin/env tsx
/**
 * Test Grouping Optimization Script
 * Analyzes and optimizes test execution for parallel performance
 */

import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

interface TestFile {
  path: string;
  type: 'unit' | 'integration' | 'e2e' | 'accessibility';
  size: number;
  estimatedDuration: number;
  parallelSafe: boolean;
  dependencies: string[];
}

interface TestGroup {
  name: string;
  files: TestFile[];
  estimatedDuration: number;
  parallelSafe: boolean;
  workerRecommendation: number;
}

function findTestFiles(dir: string, type: string): TestFile[] {
  const files: TestFile[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...findTestFiles(fullPath, type));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx'))
      ) {
        const stats = statSync(fullPath);
        const testFile: TestFile = {
          path: fullPath,
          type: type as any,
          size: stats.size,
          estimatedDuration: estimateTestDuration(fullPath, stats.size),
          parallelSafe: isParallelSafe(fullPath, type),
          dependencies: extractDependencies(fullPath),
        };
        files.push(testFile);
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read directory ${dir}:`, error);
  }

  return files;
}

function estimateTestDuration(filePath: string, fileSize: number): number {
  // Base duration on file size and type
  const baseDuration = Math.max(1, Math.floor(fileSize / 1000)); // 1s per KB

  // Adjust based on test type
  if (filePath.includes('e2e')) {
    return baseDuration * 10; // E2E tests are much slower
  } else if (filePath.includes('integration')) {
    return baseDuration * 3; // Integration tests are slower
  } else if (filePath.includes('accessibility')) {
    return baseDuration * 2; // A11y tests can be slower
  }

  return baseDuration;
}

function isParallelSafe(filePath: string, type: string): boolean {
  // Database-dependent tests are not parallel safe
  if (filePath.includes('database') || filePath.includes('db')) {
    return false;
  }

  // Integration tests touching shared resources
  if (
    type === 'integration' &&
    (filePath.includes('auth') || filePath.includes('session') || filePath.includes('migration'))
  ) {
    return false;
  }

  // E2E tests are generally parallel safe with proper isolation
  if (type === 'e2e') {
    return true;
  }

  // Unit and accessibility tests are generally parallel safe
  return type === 'unit' || type === 'accessibility';
}

function extractDependencies(filePath: string): string[] {
  // Simple dependency extraction - could be enhanced with AST parsing
  const dependencies: string[] = [];

  if (filePath.includes('database') || filePath.includes('prisma')) {
    dependencies.push('database');
  }

  if (filePath.includes('auth')) {
    dependencies.push('authentication');
  }

  if (filePath.includes('api') || filePath.includes('server')) {
    dependencies.push('server');
  }

  return dependencies;
}

function groupTests(allTests: TestFile[]): TestGroup[] {
  const groups: TestGroup[] = [];

  // Group 1: Fast parallel-safe unit tests
  const fastUnitTests = allTests.filter(
    t => t.type === 'unit' && t.parallelSafe && t.estimatedDuration <= 5
  );

  if (fastUnitTests.length > 0) {
    groups.push({
      name: 'Fast Unit Tests',
      files: fastUnitTests,
      estimatedDuration: Math.max(...fastUnitTests.map(t => t.estimatedDuration)),
      parallelSafe: true,
      workerRecommendation: Math.min(8, Math.max(2, Math.ceil(fastUnitTests.length / 10))),
    });
  }

  // Group 2: Slow unit tests
  const slowUnitTests = allTests.filter(
    t => t.type === 'unit' && t.parallelSafe && t.estimatedDuration > 5
  );

  if (slowUnitTests.length > 0) {
    groups.push({
      name: 'Slow Unit Tests',
      files: slowUnitTests,
      estimatedDuration: slowUnitTests.reduce((sum, t) => sum + t.estimatedDuration, 0),
      parallelSafe: true,
      workerRecommendation: Math.min(4, Math.max(1, Math.ceil(slowUnitTests.length / 5))),
    });
  }

  // Group 3: Accessibility tests
  const accessibilityTests = allTests.filter(t => t.type === 'accessibility');

  if (accessibilityTests.length > 0) {
    groups.push({
      name: 'Accessibility Tests',
      files: accessibilityTests,
      estimatedDuration: accessibilityTests.reduce((sum, t) => sum + t.estimatedDuration, 0),
      parallelSafe: true,
      workerRecommendation: Math.min(4, Math.max(1, accessibilityTests.length)),
    });
  }

  // Group 4: Parallel-safe integration tests
  const parallelIntegrationTests = allTests.filter(t => t.type === 'integration' && t.parallelSafe);

  if (parallelIntegrationTests.length > 0) {
    groups.push({
      name: 'Parallel Integration Tests',
      files: parallelIntegrationTests,
      estimatedDuration: parallelIntegrationTests.reduce((sum, t) => sum + t.estimatedDuration, 0),
      parallelSafe: true,
      workerRecommendation: Math.min(
        3,
        Math.max(1, Math.ceil(parallelIntegrationTests.length / 3))
      ),
    });
  }

  // Group 5: Sequential integration tests (database, auth, etc.)
  const sequentialIntegrationTests = allTests.filter(
    t => t.type === 'integration' && !t.parallelSafe
  );

  if (sequentialIntegrationTests.length > 0) {
    groups.push({
      name: 'Sequential Integration Tests',
      files: sequentialIntegrationTests,
      estimatedDuration: sequentialIntegrationTests.reduce(
        (sum, t) => sum + t.estimatedDuration,
        0
      ),
      parallelSafe: false,
      workerRecommendation: 1, // Must run sequentially
    });
  }

  // Group 6: E2E tests
  const e2eTests = allTests.filter(t => t.type === 'e2e');

  if (e2eTests.length > 0) {
    groups.push({
      name: 'E2E Tests',
      files: e2eTests,
      estimatedDuration: e2eTests.reduce((sum, t) => sum + t.estimatedDuration, 0),
      parallelSafe: true,
      workerRecommendation: Math.min(4, Math.max(2, Math.ceil(e2eTests.length / 4))),
    });
  }

  return groups;
}

function generateOptimizationReport(groups: TestGroup[]): void {
  console.log('📊 Test Grouping Optimization Report\n');

  const totalTests = groups.reduce((sum, g) => sum + g.files.length, 0);
  const totalDuration = groups.reduce((sum, g) => sum + g.estimatedDuration, 0);
  const parallelGroups = groups.filter(g => g.parallelSafe);
  const sequentialGroups = groups.filter(g => !g.parallelSafe);

  console.log('### Summary');
  console.log(`Total test files: ${totalTests}`);
  console.log(`Estimated sequential duration: ${totalDuration}s`);
  console.log(`Parallel groups: ${parallelGroups.length}`);
  console.log(`Sequential groups: ${sequentialGroups.length}`);
  console.log('');

  console.log('### Recommended Test Execution Strategy\n');

  groups.forEach((group, index) => {
    console.log(`#### ${index + 1}. ${group.name}`);
    console.log(`Files: ${group.files.length}`);
    console.log(`Estimated duration: ${group.estimatedDuration}s`);
    console.log(`Parallel safe: ${group.parallelSafe ? '✅' : '❌'}`);
    console.log(`Recommended workers: ${group.workerRecommendation}`);

    if (group.files.length <= 10) {
      console.log('Test files:');
      group.files.forEach(file => {
        console.log(`  - ${file.path} (${file.estimatedDuration}s)`);
      });
    } else {
      console.log(`Test files: ${group.files.length} files (showing first 5):`);
      group.files.slice(0, 5).forEach(file => {
        console.log(`  - ${file.path} (${file.estimatedDuration}s)`);
      });
      console.log(`  ... and ${group.files.length - 5} more`);
    }
    console.log('');
  });

  // Calculate potential time savings
  const maxParallelDuration = Math.max(
    ...parallelGroups.map(g => Math.ceil(g.estimatedDuration / g.workerRecommendation))
  );
  const sequentialDuration = sequentialGroups.reduce((sum, g) => sum + g.estimatedDuration, 0);
  const optimizedDuration = maxParallelDuration + sequentialDuration;
  const timeSavings = totalDuration - optimizedDuration;
  const percentageSavings = ((timeSavings / totalDuration) * 100).toFixed(1);

  console.log('### Optimization Potential');
  console.log(`Sequential execution: ${totalDuration}s`);
  console.log(`Optimized execution: ${optimizedDuration}s`);
  console.log(`Potential time savings: ${timeSavings}s (${percentageSavings}%)`);
  console.log('');

  console.log('### Implementation Commands');
  console.log('```bash');
  console.log('# Set Jest workers for integration tests');
  console.log(
    `export JEST_WORKERS=${groups.find(g => g.name.includes('Integration'))?.workerRecommendation || 2}`
  );
  console.log('');
  console.log('# Set Playwright workers for E2E tests');
  console.log(
    `export PLAYWRIGHT_WORKERS=${groups.find(g => g.name.includes('E2E'))?.workerRecommendation || 3}`
  );
  console.log('');
  console.log('# Run optimized test suites');
  console.log('npm run test:parallel:unit    # Fast unit tests');
  console.log('npm run test:sequential:db   # Database tests');
  console.log('npm run test:e2e:sharded     # E2E tests with sharding');
  console.log('```');
}

function generatePackageJsonScripts(groups: TestGroup[]): void {
  console.log('### Recommended package.json Scripts\n');
  console.log('```json');
  console.log('"scripts": {');

  groups.forEach(group => {
    const scriptName = group.name.toLowerCase().replace(/\s+/g, '-');
    const workerConfig = group.parallelSafe
      ? `--maxWorkers=${group.workerRecommendation}`
      : '--maxWorkers=1';

    if (group.name.includes('Unit')) {
      console.log(
        `  "test:${scriptName}": "vitest run --pool=threads --poolOptions.threads.maxThreads=${group.workerRecommendation}",`
      );
    } else if (group.name.includes('Integration')) {
      console.log(
        `  "test:${scriptName}": "jest ${workerConfig} --testPathPattern=tests/integration",`
      );
    } else if (group.name.includes('E2E')) {
      console.log(
        `  "test:${scriptName}": "playwright test --workers=${group.workerRecommendation}",`
      );
    } else if (group.name.includes('Accessibility')) {
      console.log(
        `  "test:${scriptName}": "vitest run tests/accessibility --pool=threads --poolOptions.threads.maxThreads=${group.workerRecommendation}",`
      );
    }
  });

  console.log(
    '  "test:parallel:safe": "npm run test:fast-unit-tests && npm run test:accessibility-tests && npm run test:parallel-integration-tests",'
  );
  console.log('  "test:sequential:required": "npm run test:sequential-integration-tests",');
  console.log(
    '  "test:optimized": "npm run test:parallel:safe && npm run test:sequential:required && npm run test:e2e-tests"'
  );
  console.log('}');
  console.log('```');
}

function main() {
  console.log('🔍 Analyzing test files for optimization...\n');

  // Discover all test files
  const allTests: TestFile[] = [
    ...findTestFiles('tests/unit', 'unit'),
    ...findTestFiles('tests/integration', 'integration'),
    ...findTestFiles('tests/e2e', 'e2e'),
    ...findTestFiles('tests/accessibility', 'accessibility'),
    ...findTestFiles('src', 'unit'), // Component tests
  ];

  console.log(`Found ${allTests.length} test files\n`);

  // Group tests for optimal execution
  const groups = groupTests(allTests);

  // Generate optimization report
  generateOptimizationReport(groups);
  generatePackageJsonScripts(groups);

  console.log('\n💡 Next Steps:');
  console.log('1. Review the recommended test grouping strategy');
  console.log('2. Update package.json with the suggested scripts');
  console.log('3. Configure CI workflows to use optimized test execution');
  console.log('4. Monitor test performance and adjust worker counts as needed');
}

// Execute the script
main();

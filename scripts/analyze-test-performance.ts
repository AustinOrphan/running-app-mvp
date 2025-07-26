#!/usr/bin/env tsx

/**
 * Test Performance Analysis Script
 * Identifies slow tests across all test suites and provides optimization recommendations
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import path from 'path';

interface TestResult {
  name: string;
  duration: number;
  file: string;
  suite: string;
  type: 'unit' | 'integration' | 'e2e';
}

interface PerformanceReport {
  slowTests: TestResult[];
  testsByType: Record<string, TestResult[]>;
  recommendations: string[];
  totalDuration: number;
  averageDuration: number;
}

class TestPerformanceAnalyzer {
  private results: TestResult[] = [];
  private readonly slowTestThreshold = {
    unit: 1000, // 1 second
    integration: 5000, // 5 seconds
    e2e: 10000, // 10 seconds
  };

  async analyzeAllTests(): Promise<PerformanceReport> {
    console.log('🔍 Analyzing test performance across all test suites...\n');

    // Analyze unit tests (Vitest)
    await this.analyzeVitestTests();

    // Analyze integration tests (Jest)
    await this.analyzeJestTests();

    // Analyze E2E tests (Playwright)
    await this.analyzePlaywrightTests();

    return this.generateReport();
  }

  private async analyzeVitestTests(): Promise<void> {
    console.log('📊 Analyzing Vitest unit tests...');

    try {
      // Run tests with JSON reporter to get timing data
      execSync(
        'npm run test:run -- --reporter=json --outputFile=test-results/vitest-results.json',
        {
          stdio: 'pipe',
          encoding: 'utf8',
        }
      );

      if (existsSync('test-results/vitest-results.json')) {
        const results = JSON.parse(readFileSync('test-results/vitest-results.json', 'utf8'));
        this.parseVitestResults(results);
      }
    } catch (error) {
      console.warn('⚠️  Could not analyze Vitest tests:', error);
    }
  }

  private parseVitestResults(results: any): void {
    if (!results.testResults) return;

    for (const file of results.testResults) {
      for (const test of file.assertionResults || []) {
        if (test.duration) {
          this.results.push({
            name: test.title,
            duration: test.duration,
            file: file.name,
            suite: test.ancestorTitles?.join(' > ') || '',
            type: 'unit',
          });
        }
      }
    }
  }

  private async analyzeJestTests(): Promise<void> {
    console.log('📊 Analyzing Jest integration tests...');

    try {
      // Run tests with JSON reporter
      execSync('npm run test:integration -- --json --outputFile=test-results/jest-results.json', {
        stdio: 'pipe',
        encoding: 'utf8',
      });

      if (existsSync('test-results/jest-results.json')) {
        const results = JSON.parse(readFileSync('test-results/jest-results.json', 'utf8'));
        this.parseJestResults(results);
      }
    } catch (error) {
      console.warn('⚠️  Could not analyze Jest tests:', error);
    }
  }

  private parseJestResults(results: any): void {
    if (!results.testResults) return;

    for (const file of results.testResults) {
      for (const test of file.testResults || []) {
        if (test.duration !== undefined) {
          this.results.push({
            name: test.title,
            duration: test.duration,
            file: file.name,
            suite: test.ancestorTitles?.join(' > ') || '',
            type: 'integration',
          });
        }
      }
    }
  }

  private async analyzePlaywrightTests(): Promise<void> {
    console.log('📊 Analyzing Playwright E2E tests...');

    try {
      // Run tests with JSON reporter
      execSync('npx playwright test --reporter=json > test-results/playwright-results.json', {
        stdio: 'pipe',
        encoding: 'utf8',
      });

      if (existsSync('test-results/playwright-results.json')) {
        const results = JSON.parse(readFileSync('test-results/playwright-results.json', 'utf8'));
        this.parsePlaywrightResults(results);
      }
    } catch (error) {
      console.warn('⚠️  Could not analyze Playwright tests:', error);
    }
  }

  private parsePlaywrightResults(results: any): void {
    if (!results.suites) return;

    const parseSuite = (suite: any, file: string = '') => {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          if (test.results?.[0]?.duration !== undefined) {
            this.results.push({
              name: spec.title,
              duration: test.results[0].duration,
              file: file || suite.file || '',
              suite: suite.title || '',
              type: 'e2e',
            });
          }
        }
      }

      // Recursively parse nested suites
      for (const childSuite of suite.suites || []) {
        parseSuite(childSuite, file || suite.file);
      }
    };

    for (const suite of results.suites) {
      parseSuite(suite);
    }
  }

  private generateReport(): PerformanceReport {
    // Sort tests by duration
    const sortedTests = [...this.results].sort((a, b) => b.duration - a.duration);

    // Find slow tests based on type-specific thresholds
    const slowTests = this.results.filter(
      test => test.duration > this.slowTestThreshold[test.type]
    );

    // Group tests by type
    const testsByType: Record<string, TestResult[]> = {
      unit: [],
      integration: [],
      e2e: [],
    };

    for (const test of this.results) {
      testsByType[test.type].push(test);
    }

    // Calculate statistics
    const totalDuration = this.results.reduce((sum, test) => sum + test.duration, 0);
    const averageDuration = this.results.length > 0 ? totalDuration / this.results.length : 0;

    // Generate recommendations
    const recommendations = this.generateRecommendations(slowTests, testsByType);

    // Create report
    const report: PerformanceReport = {
      slowTests: slowTests.slice(0, 20), // Top 20 slowest tests
      testsByType,
      recommendations,
      totalDuration,
      averageDuration,
    };

    this.printReport(report);
    this.saveReport(report);

    return report;
  }

  private generateRecommendations(
    slowTests: TestResult[],
    testsByType: Record<string, TestResult[]>
  ): string[] {
    const recommendations: string[] = [];

    // Check for slow unit tests
    const slowUnitTests = slowTests.filter(t => t.type === 'unit');
    if (slowUnitTests.length > 0) {
      recommendations.push(
        `Found ${slowUnitTests.length} slow unit tests (>1s). Consider:`,
        '  - Mock external dependencies and database calls',
        '  - Use test doubles instead of real implementations',
        '  - Avoid file I/O operations',
        '  - Reduce test data size'
      );
    }

    // Check for slow integration tests
    const slowIntegrationTests = slowTests.filter(t => t.type === 'integration');
    if (slowIntegrationTests.length > 0) {
      recommendations.push(
        `Found ${slowIntegrationTests.length} slow integration tests (>5s). Consider:`,
        '  - Use in-memory database for tests',
        '  - Optimize database queries and indexes',
        '  - Batch database operations',
        '  - Use database transactions for cleanup'
      );
    }

    // Check for slow E2E tests
    const slowE2ETests = slowTests.filter(t => t.type === 'e2e');
    if (slowE2ETests.length > 0) {
      recommendations.push(
        `Found ${slowE2ETests.length} slow E2E tests (>10s). Consider:`,
        '  - Use page.waitForLoadState() instead of arbitrary waits',
        '  - Optimize selectors for faster element location',
        '  - Mock slow API endpoints',
        '  - Run tests in parallel where possible'
      );
    }

    // Check for test files with many slow tests
    const fileMap = new Map<string, number>();
    for (const test of slowTests) {
      fileMap.set(test.file, (fileMap.get(test.file) || 0) + 1);
    }

    const problematicFiles = Array.from(fileMap.entries())
      .filter(([_, count]) => count > 3)
      .sort((a, b) => b[1] - a[1]);

    if (problematicFiles.length > 0) {
      recommendations.push(
        'Files with multiple slow tests:',
        ...problematicFiles.map(
          ([file, count]) => `  - ${path.basename(file)}: ${count} slow tests`
        )
      );
    }

    return recommendations;
  }

  private printReport(report: PerformanceReport): void {
    console.log('\n📊 Test Performance Report');
    console.log('========================\n');

    console.log(`Total test duration: ${(report.totalDuration / 1000).toFixed(2)}s`);
    console.log(`Average test duration: ${report.averageDuration.toFixed(0)}ms`);
    console.log(`Total tests analyzed: ${this.results.length}`);
    console.log(`Slow tests found: ${report.slowTests.length}\n`);

    if (report.slowTests.length > 0) {
      console.log('🐌 Top 10 Slowest Tests:');
      console.log('------------------------');

      for (const test of report.slowTests.slice(0, 10)) {
        const duration = (test.duration / 1000).toFixed(2);
        const fileName = path.basename(test.file);
        console.log(`  ${duration}s - ${test.name}`);
        console.log(`         📁 ${fileName} (${test.type})`);
        if (test.suite) {
          console.log(`         📦 ${test.suite}`);
        }
        console.log('');
      }
    }

    if (report.recommendations.length > 0) {
      console.log('💡 Recommendations:');
      console.log('------------------');
      for (const rec of report.recommendations) {
        console.log(rec);
      }
    }
  }

  private saveReport(report: PerformanceReport): void {
    const reportPath = 'test-results/performance-report.json';
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Full report saved to: ${reportPath}`);
  }
}

// Main execution
async function main() {
  const analyzer = new TestPerformanceAnalyzer();

  try {
    await analyzer.analyzeAllTests();
  } catch (error) {
    console.error('❌ Test performance analysis failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { TestPerformanceAnalyzer };

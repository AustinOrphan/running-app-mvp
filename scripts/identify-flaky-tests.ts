#!/usr/bin/env tsx

/**
 * Identify Flaky Tests Script
 * Analyzes test results to identify consistently failing or flaky tests
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

interface TestResult {
  name: string;
  file: string;
  type: 'unit' | 'integration' | 'e2e';
  status: 'passed' | 'failed' | 'retried' | 'flaky';
  attempts: number;
  duration: number;
  error?: string;
}

interface FlakyTestReport {
  summary: {
    totalTests: number;
    flakyTests: number;
    retriedTests: number;
    consistentlyFailingTests: number;
  };
  flakyTests: TestResult[];
  retriedTests: TestResult[];
  consistentlyFailingTests: TestResult[];
  recommendations: string[];
}

class FlakyTestAnalyzer {
  private testResults: TestResult[] = [];

  async analyzeFlakiness(): Promise<FlakyTestReport> {
    console.log('🔍 Analyzing test flakiness across all test suites...\n');

    // Run each test suite multiple times to detect flakiness
    await this.runMultipleTestCycles();

    // Analyze the results
    return this.generateFlakinessReport();
  }

  private async runMultipleTestCycles(): Promise<void> {
    const cycles = 3; // Run tests 3 times to detect flakiness

    for (let cycle = 1; cycle <= cycles; cycle++) {
      console.log(`📅 Running test cycle ${cycle}/${cycles}...`);

      // Run unit tests
      await this.runTestSuite('unit', 'npm run test:run -- --reporter=json');

      // Run integration tests
      await this.runTestSuite('integration', 'npm run test:integration:ci -- --json');

      // Run a subset of E2E tests (they're slower)
      if (cycle === 1) {
        await this.runTestSuite('e2e', 'npm run test:e2e:ci -- --reporter=json');
      }

      console.log(`✅ Cycle ${cycle} completed\n`);
    }
  }

  private async runTestSuite(type: 'unit' | 'integration' | 'e2e', command: string): Promise<void> {
    try {
      console.log(`  🧪 Running ${type} tests...`);

      const output = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: process.cwd(),
      });

      this.parseTestResults(output, type);
    } catch (error) {
      console.warn(`  ⚠️  ${type} tests had failures (expected for flakiness detection)`);

      // Even if tests fail, try to parse the output
      const errorOutput = (error as any).stdout || (error as any).stderr || '';
      if (errorOutput) {
        this.parseTestResults(errorOutput, type);
      }
    }
  }

  private parseTestResults(output: string, type: 'unit' | 'integration' | 'e2e'): void {
    try {
      // Try to parse as JSON first (Vitest/Playwright format)
      if (output.trim().startsWith('{')) {
        this.parseJsonResults(JSON.parse(output), type);
        return;
      }

      // Otherwise parse as text output
      this.parseTextResults(output, type);
    } catch (error) {
      console.warn(`  ⚠️  Could not parse ${type} test results:`, error);
    }
  }

  private parseJsonResults(results: any, type: 'unit' | 'integration' | 'e2e'): void {
    // Handle different JSON formats from different test runners
    if (results.testResults) {
      // Jest format
      this.parseJestResults(results, type);
    } else if (results.suites) {
      // Playwright format
      this.parsePlaywrightResults(results, type);
    } else if (results.tests) {
      // Vitest format
      this.parseVitestResults(results, type);
    }
  }

  private parseJestResults(results: any, type: 'unit' | 'integration' | 'e2e'): void {
    for (const file of results.testResults || []) {
      for (const test of file.assertionResults || []) {
        this.testResults.push({
          name: test.title,
          file: file.name,
          type,
          status: test.status === 'passed' ? 'passed' : 'failed',
          attempts: 1, // Jest doesn't track retries in JSON output
          duration: test.duration || 0,
          error: test.failureMessages?.[0],
        });
      }
    }
  }

  private parseVitestResults(results: any, type: 'unit' | 'integration' | 'e2e'): void {
    for (const test of results.tests || []) {
      this.testResults.push({
        name: test.name,
        file: test.file,
        type,
        status: test.result?.state === 'pass' ? 'passed' : 'failed',
        attempts: test.result?.retryCount ? test.result.retryCount + 1 : 1,
        duration: test.result?.duration || 0,
        error: test.result?.error?.message,
      });
    }
  }

  private parsePlaywrightResults(results: any, type: 'unit' | 'integration' | 'e2e'): void {
    const parseSpecs = (specs: any[], file: string = '') => {
      for (const spec of specs) {
        for (const test of spec.tests || []) {
          const result = test.results?.[0];
          if (result) {
            this.testResults.push({
              name: spec.title,
              file: file || spec.file || '',
              type,
              status: result.status === 'passed' ? 'passed' : 'failed',
              attempts: test.results.length, // Number of retry attempts
              duration: result.duration || 0,
              error: result.error?.message,
            });
          }
        }

        // Recursively parse nested specs
        if (spec.suites) {
          for (const suite of spec.suites) {
            parseSpecs(suite.specs || [], file || suite.file);
          }
        }
      }
    };

    for (const suite of results.suites || []) {
      parseSpecs(suite.specs || [], suite.file);
    }
  }

  private parseTextResults(output: string, type: 'unit' | 'integration' | 'e2e'): void {
    // Simple text parsing for fallback
    const lines = output.split('\n');
    let currentFile = '';

    for (const line of lines) {
      // Extract file names
      if (line.includes('.test.') || line.includes('.spec.')) {
        const match = line.match(/([^\/]+\.(?:test|spec)\.[^\/]+)/);
        if (match) {
          currentFile = match[1];
        }
      }

      // Extract test results
      if (
        line.includes('✓') ||
        line.includes('✗') ||
        line.includes('PASS') ||
        line.includes('FAIL')
      ) {
        const testName = line
          .replace(/^\s*[✓✗❌✅]\s*/, '')
          .replace(/\s*\(\d+ms\)$/, '')
          .trim();
        if (testName) {
          this.testResults.push({
            name: testName,
            file: currentFile,
            type,
            status: line.includes('✓') || line.includes('PASS') ? 'passed' : 'failed',
            attempts: 1,
            duration: 0,
          });
        }
      }
    }
  }

  private generateFlakinessReport(): FlakyTestReport {
    console.log('📊 Generating flakiness report...\n');

    // Group tests by name and file
    const testGroups = new Map<string, TestResult[]>();

    for (const result of this.testResults) {
      const key = `${result.file}::${result.name}`;
      if (!testGroups.has(key)) {
        testGroups.set(key, []);
      }
      testGroups.get(key)!.push(result);
    }

    const flakyTests: TestResult[] = [];
    const retriedTests: TestResult[] = [];
    const consistentlyFailingTests: TestResult[] = [];

    // Analyze each test group
    for (const [key, results] of testGroups) {
      if (results.length === 0) continue;

      const passCount = results.filter(r => r.status === 'passed').length;
      const failCount = results.filter(r => r.status === 'failed').length;
      const totalRuns = results.length;
      const maxAttempts = Math.max(...results.map(r => r.attempts));
      const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / totalRuns;

      const representativeResult: TestResult = {
        ...results[0],
        attempts: maxAttempts,
        duration: avgDuration,
        status: passCount > failCount ? 'passed' : 'failed',
      };

      // Classify the test
      if (passCount > 0 && failCount > 0) {
        // Flaky: sometimes passes, sometimes fails
        representativeResult.status = 'flaky';
        flakyTests.push(representativeResult);
      } else if (maxAttempts > 1) {
        // Retried: required retries but eventually passed
        representativeResult.status = 'retried';
        retriedTests.push(representativeResult);
      } else if (failCount === totalRuns) {
        // Consistently failing
        consistentlyFailingTests.push(representativeResult);
      }
    }

    // Sort by most problematic first
    flakyTests.sort((a, b) => b.attempts - a.attempts);
    retriedTests.sort((a, b) => b.attempts - a.attempts);
    consistentlyFailingTests.sort((a, b) => b.duration - a.duration);

    const recommendations = this.generateRecommendations(
      flakyTests,
      retriedTests,
      consistentlyFailingTests
    );

    const report: FlakyTestReport = {
      summary: {
        totalTests: testGroups.size,
        flakyTests: flakyTests.length,
        retriedTests: retriedTests.length,
        consistentlyFailingTests: consistentlyFailingTests.length,
      },
      flakyTests,
      retriedTests,
      consistentlyFailingTests,
      recommendations,
    };

    this.printReport(report);
    this.saveReport(report);

    return report;
  }

  private generateRecommendations(
    flakyTests: TestResult[],
    retriedTests: TestResult[],
    consistentlyFailingTests: TestResult[]
  ): string[] {
    const recommendations: string[] = [];

    if (flakyTests.length > 0) {
      recommendations.push(
        `🎯 Fix ${flakyTests.length} flaky tests:`,
        '  - Add more stable wait conditions',
        '  - Use proper test isolation and cleanup',
        '  - Mock external dependencies that cause timing issues',
        '  - Add deterministic test data setup'
      );
    }

    if (retriedTests.length > 0) {
      recommendations.push(
        `🔄 ${retriedTests.length} tests are succeeding after retries:`,
        '  - These indicate potential timing issues',
        '  - Consider increasing timeouts or improving wait conditions',
        '  - Monitor these tests for future flakiness'
      );
    }

    if (consistentlyFailingTests.length > 0) {
      recommendations.push(
        `❌ ${consistentlyFailingTests.length} tests are consistently failing:`,
        '  - These should be fixed or marked as skipped',
        '  - May indicate broken functionality or outdated tests',
        '  - Priority: High - blocking CI pipeline'
      );
    }

    if (flakyTests.length === 0 && retriedTests.length === 0) {
      recommendations.push('✅ No flaky tests detected - excellent test stability!');
    }

    return recommendations;
  }

  private printReport(report: FlakyTestReport): void {
    console.log('📋 Flaky Test Analysis Report');
    console.log('=============================\n');

    console.log('📊 Summary:');
    console.log(`  Total tests analyzed: ${report.summary.totalTests}`);
    console.log(`  Flaky tests: ${report.summary.flakyTests}`);
    console.log(`  Tests requiring retries: ${report.summary.retriedTests}`);
    console.log(`  Consistently failing: ${report.summary.consistentlyFailingTests}\n`);

    if (report.flakyTests.length > 0) {
      console.log('🎯 Flaky Tests (pass sometimes, fail sometimes):');
      console.log('------------------------------------------------');
      for (const test of report.flakyTests.slice(0, 5)) {
        console.log(`  🔄 ${path.basename(test.file)}:${test.name}`);
        console.log(`     Attempts: ${test.attempts}, Type: ${test.type}`);
      }
      if (report.flakyTests.length > 5) {
        console.log(`  ... and ${report.flakyTests.length - 5} more\n`);
      }
    }

    if (report.retriedTests.length > 0) {
      console.log('🔄 Tests Requiring Retries:');
      console.log('----------------------------');
      for (const test of report.retriedTests.slice(0, 3)) {
        console.log(`  ↻ ${path.basename(test.file)}:${test.name}`);
        console.log(`     Max attempts: ${test.attempts}, Type: ${test.type}`);
      }
      if (report.retriedTests.length > 3) {
        console.log(`  ... and ${report.retriedTests.length - 3} more\n`);
      }
    }

    console.log('💡 Recommendations:');
    console.log('-------------------');
    for (const rec of report.recommendations) {
      console.log(rec);
    }
    console.log('');
  }

  private saveReport(report: FlakyTestReport): void {
    const reportPath = 'test-results/flaky-test-report.json';
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Detailed report saved to: ${reportPath}`);
  }
}

// Main execution
async function main() {
  const analyzer = new FlakyTestAnalyzer();

  try {
    await analyzer.analyzeFlakiness();
  } catch (error) {
    console.error('❌ Flaky test analysis failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { FlakyTestAnalyzer };

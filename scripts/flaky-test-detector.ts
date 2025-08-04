#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';

interface TestResult {
  testName: string;
  testPath: string;
  suite: 'unit' | 'integration' | 'e2e';
  status: 'passed' | 'failed' | 'skipped' | 'timeout';
  duration: number;
  timestamp: number;
  error?: string;
  retries?: number;
  runId: string;
}

interface TestStats {
  testName: string;
  testPath: string;
  suite: 'unit' | 'integration' | 'e2e';
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  skippedRuns: number;
  timeoutRuns: number;
  successRate: number;
  averageDuration: number;
  maxDuration: number;
  minDuration: number;
  lastFailure?: string;
  isFlaky: boolean;
  flakyScore: number;
  firstSeen: number;
  lastSeen: number;
  consecutiveFailures: number;
  consecutivePasses: number;
}

interface FlakyTestReport {
  timestamp: number;
  runId: string;
  summary: {
    totalTests: number;
    flakyTests: number;
    highRiskTests: number;
    mediumRiskTests: number;
    lowRiskTests: number;
  };
  flakyTests: TestStats[];
  recommendations: string[];
}

class FlakyTestDetector {
  private dataDir: string;
  private resultsFile: string;
  private statsFile: string;
  private reportsDir: string;
  private maxHistoryDays: number = 30;

  constructor() {
    this.dataDir = path.join(process.cwd(), 'test-flakiness');
    this.resultsFile = path.join(this.dataDir, 'test-results.json');
    this.statsFile = path.join(this.dataDir, 'test-stats.json');
    this.reportsDir = path.join(this.dataDir, 'reports');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [this.dataDir, this.reportsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  async runTestSuite(
    suite: 'unit' | 'integration' | 'e2e',
    runs: number = 5
  ): Promise<TestResult[]> {
    console.log(`🧪 Running ${suite} tests ${runs} times to detect flakiness...`);

    const allResults: TestResult[] = [];
    const runId = this.generateRunId();

    for (let i = 1; i <= runs; i++) {
      console.log(`  📊 Run ${i}/${runs}...`);

      try {
        const results = await this.runSingleTestSuite(suite, runId, i);
        allResults.push(...results);

        // Small delay between runs to avoid resource conflicts
        await this.delay(1000);
      } catch (error) {
        console.warn(`  ⚠️ Run ${i} failed:`, error);
      }
    }

    return allResults;
  }

  private async runSingleTestSuite(
    suite: 'unit' | 'integration' | 'e2e',
    runId: string,
    runNumber: number
  ): Promise<TestResult[]> {
    return new Promise((resolve, reject) => {
      let command: string;
      let args: string[];

      switch (suite) {
        case 'unit':
          command = 'npm';
          args = ['run', 'test:run', '--', '--reporter=json'];
          break;
        case 'integration':
          command = 'npm';
          args = ['run', 'test:integration', '--', '--json'];
          break;
        case 'e2e':
          command = 'npm';
          args = ['run', 'test:e2e', '--', '--reporter=json'];
          break;
        default:
          reject(new Error(`Unknown test suite: ${suite}`));
          return;
      }

      const child = spawn(command, args, {
        stdio: 'pipe',
        env: {
          ...process.env,
          CI: 'true',
          FLAKY_TEST_RUN: 'true',
          NODE_ENV: 'test',
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', data => {
        stdout += data.toString();
      });

      child.stderr.on('data', data => {
        stderr += data.toString();
      });

      child.on('close', code => {
        try {
          const results = this.parseTestResults(suite, stdout, stderr, runId, runNumber);
          resolve(results);
        } catch (error) {
          console.warn(`Failed to parse ${suite} test results:`, error);
          resolve([]); // Return empty array instead of rejecting
        }
      });

      child.on('error', error => {
        console.warn(`Error running ${suite} tests:`, error);
        resolve([]);
      });
    });
  }

  private parseTestResults(
    suite: 'unit' | 'integration' | 'e2e',
    stdout: string,
    stderr: string,
    runId: string,
    runNumber: number
  ): TestResult[] {
    const results: TestResult[] = [];
    const timestamp = Date.now();

    try {
      if (suite === 'unit') {
        // Parse Vitest JSON output
        const lines = stdout.split('\n').filter(line => line.trim().startsWith('{'));
        for (const line of lines) {
          try {
            const data = JSON.parse(line);

            if (data.type === 'testResult' && data.result) {
              const testResult = data.result;

              results.push({
                testName: testResult.name || testResult.title || 'Unknown Test',
                testPath: testResult.file || testResult.parent?.file || 'Unknown',
                suite,
                status: this.mapVitestStatus(testResult.state || testResult.status),
                duration: testResult.duration || 0,
                timestamp,
                error: testResult.error?.message,
                runId: `${runId}-${runNumber}`,
              });
            }
          } catch (parseError) {
            // Skip invalid JSON lines
          }
        }
      } else if (suite === 'integration') {
        // Parse Jest JSON output
        try {
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);

            if (data.testResults) {
              data.testResults.forEach((testFile: any) => {
                testFile.assertionResults?.forEach((test: any) => {
                  results.push({
                    testName: test.title || test.fullName || 'Unknown Test',
                    testPath: testFile.name || 'Unknown',
                    suite,
                    status: this.mapJestStatus(test.status),
                    duration: test.duration || 0,
                    timestamp,
                    error: test.failureMessages?.[0],
                    runId: `${runId}-${runNumber}`,
                  });
                });
              });
            }
          }
        } catch (parseError) {
          console.warn('Failed to parse Jest JSON output:', parseError);
        }
      } else if (suite === 'e2e') {
        // Parse Playwright JSON output
        try {
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);

            if (data.suites) {
              this.parsePlaywrightSuites(data.suites, results, suite, timestamp, runId, runNumber);
            }
          }
        } catch (parseError) {
          console.warn('Failed to parse Playwright JSON output:', parseError);
        }
      }

      // Fallback: parse text output if JSON parsing failed
      if (results.length === 0) {
        this.parseTextOutput(stdout, stderr, suite, timestamp, runId, runNumber, results);
      }
    } catch (error) {
      console.warn(`Error parsing ${suite} test results:`, error);
    }

    return results;
  }

  private parsePlaywrightSuites(
    suites: any[],
    results: TestResult[],
    suite: 'e2e',
    timestamp: number,
    runId: string,
    runNumber: number
  ): void {
    suites.forEach(suite_item => {
      suite_item.specs?.forEach((spec: any) => {
        spec.tests?.forEach((test: any) => {
          test.results?.forEach((result: any) => {
            results.push({
              testName: test.title || 'Unknown Test',
              testPath: spec.file || 'Unknown',
              suite,
              status: this.mapPlaywrightStatus(result.status),
              duration: result.duration || 0,
              timestamp,
              error: result.error?.message,
              retries: result.retry || 0,
              runId: `${runId}-${runNumber}`,
            });
          });
        });
      });

      // Recursively parse nested suites
      if (suite_item.suites) {
        this.parsePlaywrightSuites(suite_item.suites, results, suite, timestamp, runId, runNumber);
      }
    });
  }

  private parseTextOutput(
    stdout: string,
    stderr: string,
    suite: 'unit' | 'integration' | 'e2e',
    timestamp: number,
    runId: string,
    runNumber: number,
    results: TestResult[]
  ): void {
    // Basic text parsing as fallback
    const output = stdout + stderr;
    const lines = output.split('\n');

    lines.forEach(line => {
      // Look for test result patterns
      const patterns = [
        /✓\s+(.+?)\s+\((\d+)ms\)/, // Passed test
        /✗\s+(.+?)\s+\((\d+)ms\)/, // Failed test
        /PASS\s+(.+)/, // Jest pass
        /FAIL\s+(.+)/, // Jest fail
      ];

      patterns.forEach(pattern => {
        const match = line.match(pattern);
        if (match) {
          results.push({
            testName: match[1] || 'Unknown Test',
            testPath: 'Unknown',
            suite,
            status: line.includes('✓') || line.includes('PASS') ? 'passed' : 'failed',
            duration: parseInt(match[2]) || 0,
            timestamp,
            runId: `${runId}-${runNumber}`,
          });
        }
      });
    });
  }

  private mapVitestStatus(status: string): TestResult['status'] {
    switch (status?.toLowerCase()) {
      case 'passed':
      case 'pass':
        return 'passed';
      case 'failed':
      case 'fail':
        return 'failed';
      case 'skipped':
      case 'skip':
      case 'todo':
        return 'skipped';
      case 'timeout':
        return 'timeout';
      default:
        return 'failed';
    }
  }

  private mapJestStatus(status: string): TestResult['status'] {
    switch (status?.toLowerCase()) {
      case 'passed':
      case 'pass':
        return 'passed';
      case 'failed':
      case 'fail':
        return 'failed';
      case 'skipped':
      case 'skip':
      case 'pending':
        return 'skipped';
      case 'timeout':
        return 'timeout';
      default:
        return 'failed';
    }
  }

  private mapPlaywrightStatus(status: string): TestResult['status'] {
    switch (status?.toLowerCase()) {
      case 'passed':
      case 'expected':
        return 'passed';
      case 'failed':
      case 'unexpected':
        return 'failed';
      case 'skipped':
        return 'skipped';
      case 'timedout':
        return 'timeout';
      default:
        return 'failed';
    }
  }

  private generateRunId(): string {
    const timestamp = Date.now().toString();
    const hash = createHash('md5')
      .update(timestamp + Math.random().toString())
      .digest('hex');
    return hash.substring(0, 8);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  saveTestResults(results: TestResult[]): void {
    const existingResults = this.loadTestResults();
    const allResults = [...existingResults, ...results];

    // Clean old results
    const cutoffTime = Date.now() - this.maxHistoryDays * 24 * 60 * 60 * 1000;
    const filteredResults = allResults.filter(result => result.timestamp > cutoffTime);

    fs.writeFileSync(this.resultsFile, JSON.stringify(filteredResults, null, 2));
    console.log(`💾 Saved ${results.length} test results`);
  }

  private loadTestResults(): TestResult[] {
    if (!fs.existsSync(this.resultsFile)) {
      return [];
    }

    try {
      return JSON.parse(fs.readFileSync(this.resultsFile, 'utf-8'));
    } catch (error) {
      console.warn('Failed to load test results:', error);
      return [];
    }
  }

  calculateTestStats(): TestStats[] {
    const results = this.loadTestResults();
    const statsMap = new Map<string, TestStats>();

    results.forEach(result => {
      const key = `${result.testPath}::${result.testName}`;

      if (!statsMap.has(key)) {
        statsMap.set(key, {
          testName: result.testName,
          testPath: result.testPath,
          suite: result.suite,
          totalRuns: 0,
          passedRuns: 0,
          failedRuns: 0,
          skippedRuns: 0,
          timeoutRuns: 0,
          successRate: 0,
          averageDuration: 0,
          maxDuration: 0,
          minDuration: Number.MAX_SAFE_INTEGER,
          isFlaky: false,
          flakyScore: 0,
          firstSeen: result.timestamp,
          lastSeen: result.timestamp,
          consecutiveFailures: 0,
          consecutivePasses: 0,
        });
      }

      const stats = statsMap.get(key)!;
      stats.totalRuns++;
      stats.lastSeen = Math.max(stats.lastSeen, result.timestamp);
      stats.firstSeen = Math.min(stats.firstSeen, result.timestamp);

      // Update counters
      switch (result.status) {
        case 'passed':
          stats.passedRuns++;
          break;
        case 'failed':
          stats.failedRuns++;
          stats.lastFailure = result.error;
          break;
        case 'skipped':
          stats.skippedRuns++;
          break;
        case 'timeout':
          stats.timeoutRuns++;
          break;
      }

      // Update duration stats
      if (result.duration > 0) {
        stats.maxDuration = Math.max(stats.maxDuration, result.duration);
        stats.minDuration = Math.min(stats.minDuration, result.duration);
      }
    });

    // Calculate derived metrics
    const statsArray = Array.from(statsMap.values());

    statsArray.forEach(stats => {
      // Calculate success rate
      stats.successRate = stats.totalRuns > 0 ? (stats.passedRuns / stats.totalRuns) * 100 : 0;

      // Calculate average duration
      const testResults = results.filter(
        r => r.testPath === stats.testPath && r.testName === stats.testName && r.duration > 0
      );

      if (testResults.length > 0) {
        stats.averageDuration =
          testResults.reduce((sum, r) => sum + r.duration, 0) / testResults.length;
      }

      // Calculate flakiness
      stats.flakyScore = this.calculateFlakyScore(stats);
      stats.isFlaky = stats.flakyScore > 0.3; // 30% flakiness threshold

      // Calculate consecutive failures/passes
      this.calculateConsecutiveStats(stats, results);
    });

    return statsArray;
  }

  private calculateFlakyScore(stats: TestStats): number {
    if (stats.totalRuns < 3) return 0; // Need at least 3 runs to determine flakiness

    // Base flakiness on success rate variability
    const successRate = stats.successRate / 100;

    // Higher flakiness for tests that fail sometimes but not always
    let flakyScore = 0;

    if (successRate > 0 && successRate < 1) {
      // Most flaky when success rate is around 50%
      flakyScore = 1 - Math.abs(0.5 - successRate) * 2;
    }

    // Increase score for timeout issues
    if (stats.timeoutRuns > 0) {
      flakyScore = Math.max(flakyScore, 0.4);
    }

    // Penalize very low success rates (consistently failing tests aren't flaky)
    if (successRate < 0.2) {
      flakyScore *= 0.5;
    }

    // Penalize very high success rates (consistently passing tests aren't flaky)
    if (successRate > 0.9) {
      flakyScore *= 0.3;
    }

    return Math.min(flakyScore, 1);
  }

  private calculateConsecutiveStats(stats: TestStats, allResults: TestResult[]): void {
    // Get results for this specific test, sorted by timestamp
    const testResults = allResults
      .filter(r => r.testPath === stats.testPath && r.testName === stats.testName)
      .sort((a, b) => a.timestamp - b.timestamp);

    let consecutiveFailures = 0;
    let consecutivePasses = 0;
    let currentFailureStreak = 0;
    let currentPassStreak = 0;

    testResults.forEach(result => {
      if (result.status === 'failed' || result.status === 'timeout') {
        currentFailureStreak++;
        currentPassStreak = 0;
        consecutiveFailures = Math.max(consecutiveFailures, currentFailureStreak);
      } else if (result.status === 'passed') {
        currentPassStreak++;
        currentFailureStreak = 0;
        consecutivePasses = Math.max(consecutivePasses, currentPassStreak);
      }
    });

    stats.consecutiveFailures = consecutiveFailures;
    stats.consecutivePasses = consecutivePasses;
  }

  saveTestStats(stats: TestStats[]): void {
    fs.writeFileSync(this.statsFile, JSON.stringify(stats, null, 2));
    console.log(`📊 Saved stats for ${stats.length} tests`);
  }

  generateFlakyTestReport(): FlakyTestReport {
    const stats = this.calculateTestStats();
    const flakyTests = stats.filter(s => s.isFlaky).sort((a, b) => b.flakyScore - a.flakyScore);

    const report: FlakyTestReport = {
      timestamp: Date.now(),
      runId: this.generateRunId(),
      summary: {
        totalTests: stats.length,
        flakyTests: flakyTests.length,
        highRiskTests: flakyTests.filter(t => t.flakyScore > 0.7).length,
        mediumRiskTests: flakyTests.filter(t => t.flakyScore > 0.4 && t.flakyScore <= 0.7).length,
        lowRiskTests: flakyTests.filter(t => t.flakyScore > 0.3 && t.flakyScore <= 0.4).length,
      },
      flakyTests,
      recommendations: this.generateRecommendations(flakyTests),
    };

    // Save report
    const reportFile = path.join(this.reportsDir, `flaky-tests-${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    return report;
  }

  private generateRecommendations(flakyTests: TestStats[]): string[] {
    const recommendations: string[] = [];

    if (flakyTests.length === 0) {
      recommendations.push('🎉 No flaky tests detected! Your test suite is stable.');
      return recommendations;
    }

    // High-risk test recommendations
    const highRisk = flakyTests.filter(t => t.flakyScore > 0.7);
    if (highRisk.length > 0) {
      recommendations.push(`🚨 ${highRisk.length} high-risk flaky tests need immediate attention`);
      recommendations.push('Consider disabling or quarantining these tests until fixed');
    }

    // Timeout-related recommendations
    const timeoutTests = flakyTests.filter(t => t.timeoutRuns > 0);
    if (timeoutTests.length > 0) {
      recommendations.push(`⏱️ ${timeoutTests.length} tests have timeout issues`);
      recommendations.push('Review test timeouts and async operation handling');
    }

    // Suite-specific recommendations
    const suiteCounts = flakyTests.reduce(
      (acc, test) => {
        acc[test.suite] = (acc[test.suite] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    Object.entries(suiteCounts).forEach(([suite, count]) => {
      recommendations.push(`📋 ${suite.toUpperCase()} suite has ${count} flaky tests`);
    });

    // General recommendations
    recommendations.push('🔍 Review flaky tests for:');
    recommendations.push('  - Race conditions and timing issues');
    recommendations.push('  - Improper test isolation and cleanup');
    recommendations.push('  - External dependencies and network calls');
    recommendations.push('  - Resource contention and shared state');

    return recommendations;
  }

  printReport(report?: FlakyTestReport): void {
    const r = report || this.generateFlakyTestReport();

    console.log('\n🔍 Flaky Test Detection Report');
    console.log('='.repeat(50));
    console.log(`Generated: ${new Date(r.timestamp).toLocaleString()}`);

    // Summary
    console.log('\n📊 Summary:');
    console.log(`  Total Tests: ${r.summary.totalTests}`);
    console.log(
      `  Flaky Tests: ${r.summary.flakyTests} (${((r.summary.flakyTests / r.summary.totalTests) * 100).toFixed(1)}%)`
    );
    console.log(`  High Risk: ${r.summary.highRiskTests}`);
    console.log(`  Medium Risk: ${r.summary.mediumRiskTests}`);
    console.log(`  Low Risk: ${r.summary.lowRiskTests}`);

    // Flaky tests details
    if (r.flakyTests.length > 0) {
      console.log('\n🚨 Flaky Tests (sorted by risk):');
      r.flakyTests.slice(0, 10).forEach((test, index) => {
        const riskLevel =
          test.flakyScore > 0.7 ? '🔴 HIGH' : test.flakyScore > 0.4 ? '🟡 MED' : '🟢 LOW';

        console.log(`  ${index + 1}. ${riskLevel} ${test.testName}`);
        console.log(`     📁 ${test.testPath}`);
        console.log(
          `     📊 Success Rate: ${test.successRate.toFixed(1)}% (${test.passedRuns}/${test.totalRuns})`
        );
        console.log(`     🎯 Flaky Score: ${(test.flakyScore * 100).toFixed(1)}%`);

        if (test.consecutiveFailures > 1) {
          console.log(`     🔥 Max Consecutive Failures: ${test.consecutiveFailures}`);
        }

        if (test.timeoutRuns > 0) {
          console.log(`     ⏱️ Timeouts: ${test.timeoutRuns}`);
        }

        console.log('');
      });

      if (r.flakyTests.length > 10) {
        console.log(`  ... and ${r.flakyTests.length - 10} more flaky tests`);
      }
    }

    // Recommendations
    console.log('\n💡 Recommendations:');
    r.recommendations.forEach(rec => console.log(`  ${rec}`));
  }

  async runCompleteAnalysis(): Promise<FlakyTestReport> {
    console.log('🚀 Starting complete flaky test analysis...\n');

    // Run each test suite multiple times
    const suites: ('unit' | 'integration' | 'e2e')[] = ['unit', 'integration', 'e2e'];
    const runsPerSuite = 5;

    for (const suite of suites) {
      try {
        console.log(`\n📋 Analyzing ${suite} tests...`);
        const results = await this.runTestSuite(suite, runsPerSuite);
        this.saveTestResults(results);

        console.log(`  ✅ Collected ${results.length} test results`);
      } catch (error) {
        console.error(`  ❌ Failed to analyze ${suite} tests:`, error);
      }
    }

    // Calculate and save stats
    console.log('\n📊 Calculating test statistics...');
    const stats = this.calculateTestStats();
    this.saveTestStats(stats);

    // Generate report
    console.log('\n📋 Generating flaky test report...');
    const report = this.generateFlakyTestReport();

    console.log('\n✅ Complete flaky test analysis finished!');
    return report;
  }
}

// Export for use in other scripts
export { FlakyTestDetector, TestResult, TestStats, FlakyTestReport };

// CLI usage
if (require.main === module) {
  const detector = new FlakyTestDetector();

  const args = process.argv.slice(2);
  const command = args[0] || 'analyze';

  switch (command) {
    case 'analyze':
      detector
        .runCompleteAnalysis()
        .then(report => detector.printReport(report))
        .catch(console.error);
      break;

    case 'run':
      const suite = args[1] as 'unit' | 'integration' | 'e2e';
      const runs = parseInt(args[2]) || 5;

      if (!suite || !['unit', 'integration', 'e2e'].includes(suite)) {
        console.error('Usage: tsx flaky-test-detector.ts run <unit|integration|e2e> [runs]');
        process.exit(1);
      }

      detector
        .runTestSuite(suite, runs)
        .then(results => {
          detector.saveTestResults(results);
          console.log(`✅ Completed ${runs} runs of ${suite} tests`);
        })
        .catch(console.error);
      break;

    case 'stats':
      const stats = detector.calculateTestStats();
      detector.saveTestStats(stats);
      console.log(`📊 Calculated stats for ${stats.length} tests`);
      break;

    case 'report':
      const report = detector.generateFlakyTestReport();
      detector.printReport(report);
      break;

    default:
      console.log('Usage:');
      console.log('  tsx flaky-test-detector.ts [analyze|run <suite> [runs]|stats|report]');
      console.log('');
      console.log('Commands:');
      console.log('  analyze  - Run complete flaky test analysis (default)');
      console.log('  run      - Run specific test suite multiple times');
      console.log('  stats    - Calculate test statistics from existing data');
      console.log('  report   - Generate flaky test report');
  }
}

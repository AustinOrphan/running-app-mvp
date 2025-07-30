#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

interface TestResult {
  name: string;
  duration: number;
  status: 'passed' | 'failed' | 'skipped';
  timestamp: number;
  suite: 'unit' | 'integration' | 'e2e';
  file: string;
  retries: number;
}

interface TestSuitePerformance {
  suite: string;
  totalTests: number;
  totalDuration: number;
  averageDuration: number;
  slowestTests: TestResult[];
  passRate: number;
  timestamp: number;
}

interface PerformanceTrend {
  suite: string;
  metric: 'duration' | 'passRate' | 'testCount';
  trend: 'improving' | 'degrading' | 'stable';
  changePercent: number;
  samples: number;
}

class TestPerformanceTracker {
  private dataDir: string;
  private resultsFile: string;
  private trendsFile: string;
  private maxHistoryDays: number = 30;

  constructor() {
    this.dataDir = path.join(process.cwd(), 'test-performance-data');
    this.resultsFile = path.join(this.dataDir, 'test-results.json');
    this.trendsFile = path.join(this.dataDir, 'performance-trends.json');
    this.ensureDataDirectory();
  }

  private ensureDataDirectory(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async trackTestRun(suite: 'unit' | 'integration' | 'e2e'): Promise<TestSuitePerformance> {
    console.log(`📊 Tracking performance for ${suite} tests...`);

    const startTime = Date.now();
    const results = await this.runTestSuite(suite);
    const endTime = Date.now();

    const performance: TestSuitePerformance = {
      suite,
      totalTests: results.length,
      totalDuration: endTime - startTime,
      averageDuration: results.length > 0 ? (endTime - startTime) / results.length : 0,
      slowestTests: results.sort((a, b) => b.duration - a.duration).slice(0, 10),
      passRate:
        results.length > 0
          ? (results.filter(r => r.status === 'passed').length / results.length) * 100
          : 0,
      timestamp: Date.now(),
    };

    await this.savePerformanceData(performance, results);
    return performance;
  }

  private async runTestSuite(suite: 'unit' | 'integration' | 'e2e'): Promise<TestResult[]> {
    const results: TestResult[] = [];

    return new Promise((resolve, reject) => {
      let command: string;
      let args: string[];

      switch (suite) {
        case 'unit':
          command = 'npx';
          args = ['vitest', 'run', '--reporter=json', '--outputFile=test-performance-unit.json'];
          break;
        case 'integration':
          command = 'npx';
          args = [
            'jest',
            '--config',
            'jest.config.js',
            '--json',
            '--outputFile=test-performance-integration.json',
          ];
          break;
        case 'e2e':
          command = 'npx';
          args = [
            'playwright',
            'test',
            '--reporter=json',
            '--output-file=test-performance-e2e.json',
          ];
          break;
        default:
          reject(new Error(`Unknown test suite: ${suite}`));
          return;
      }

      const child = spawn(command, args, {
        stdio: 'pipe',
        env: { ...process.env, CI: 'true' },
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
          // Parse results based on suite type
          const parsedResults = this.parseTestResults(suite, stdout, stderr);
          resolve(parsedResults);
        } catch (error) {
          console.warn(`Failed to parse ${suite} test results:`, error);
          resolve([]); // Return empty array on parsing failure
        }
      });

      child.on('error', error => {
        console.warn(`Error running ${suite} tests:`, error);
        resolve([]); // Return empty array on execution failure
      });
    });
  }

  private parseTestResults(suite: string, stdout: string, stderr: string): TestResult[] {
    const results: TestResult[] = [];

    try {
      switch (suite) {
        case 'unit':
          return this.parseVitestResults(stdout);
        case 'integration':
          return this.parseJestResults(stdout);
        case 'e2e':
          return this.parsePlaywrightResults(stdout);
        default:
          return [];
      }
    } catch (error) {
      console.warn(`Failed to parse ${suite} results:`, error);
      return [];
    }
  }

  private parseVitestResults(output: string): TestResult[] {
    const results: TestResult[] = [];

    try {
      // Try to parse JSON output first
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);

        if (data.testResults) {
          data.testResults.forEach((testFile: any) => {
            testFile.assertionResults?.forEach((test: any) => {
              results.push({
                name: test.title || test.fullName,
                duration: test.duration || 0,
                status: test.status === 'passed' ? 'passed' : 'failed',
                timestamp: Date.now(),
                suite: 'unit' as const,
                file: testFile.name || 'unknown',
                retries: test.numPassingAsserts || 0,
              });
            });
          });
        }
      }
    } catch (error) {
      // Fallback to regex parsing
      const testPattern = /✓|✗|⏩\s+(.+?)\s+\((\d+(?:\.\d+)?)ms\)/g;
      let match;

      while ((match = testPattern.exec(output)) !== null) {
        results.push({
          name: match[1],
          duration: parseFloat(match[2]),
          status: output.includes('✓') ? 'passed' : 'failed',
          timestamp: Date.now(),
          suite: 'unit' as const,
          file: 'parsed',
          retries: 0,
        });
      }
    }

    return results;
  }

  private parseJestResults(output: string): TestResult[] {
    const results: TestResult[] = [];

    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);

        data.testResults?.forEach((testFile: any) => {
          testFile.assertionResults?.forEach((test: any) => {
            results.push({
              name: test.title,
              duration: test.duration || 0,
              status: test.status,
              timestamp: Date.now(),
              suite: 'integration' as const,
              file: testFile.name,
              retries: test.retryReasons?.length || 0,
            });
          });
        });
      }
    } catch (error) {
      console.warn('Failed to parse Jest JSON output:', error);
    }

    return results;
  }

  private parsePlaywrightResults(output: string): TestResult[] {
    const results: TestResult[] = [];

    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);

        data.suites?.forEach((suite: any) => {
          suite.specs?.forEach((spec: any) => {
            spec.tests?.forEach((test: any) => {
              results.push({
                name: test.title,
                duration: test.results?.[0]?.duration || 0,
                status: test.results?.[0]?.status || 'failed',
                timestamp: Date.now(),
                suite: 'e2e' as const,
                file: spec.title,
                retries: test.results?.length - 1 || 0,
              });
            });
          });
        });
      }
    } catch (error) {
      console.warn('Failed to parse Playwright JSON output:', error);
    }

    return results;
  }

  private async savePerformanceData(
    performance: TestSuitePerformance,
    results: TestResult[]
  ): Promise<void> {
    // Load existing data
    const existingData = this.loadHistoricalData();

    // Add new performance data
    existingData.performances.push(performance);
    existingData.detailedResults.push(...results);

    // Clean old data (keep only last 30 days)
    const cutoffTime = Date.now() - this.maxHistoryDays * 24 * 60 * 60 * 1000;
    existingData.performances = existingData.performances.filter(p => p.timestamp > cutoffTime);
    existingData.detailedResults = existingData.detailedResults.filter(
      r => r.timestamp > cutoffTime
    );

    // Save to file
    fs.writeFileSync(this.resultsFile, JSON.stringify(existingData, null, 2));

    console.log(`💾 Saved performance data for ${performance.suite} tests`);
  }

  private loadHistoricalData(): {
    performances: TestSuitePerformance[];
    detailedResults: TestResult[];
  } {
    if (!fs.existsSync(this.resultsFile)) {
      return { performances: [], detailedResults: [] };
    }

    try {
      return JSON.parse(fs.readFileSync(this.resultsFile, 'utf-8'));
    } catch (error) {
      console.warn('Failed to load historical data:', error);
      return { performances: [], detailedResults: [] };
    }
  }

  analyzeTrends(): PerformanceTrend[] {
    const data = this.loadHistoricalData();
    const trends: PerformanceTrend[] = [];

    const suites = ['unit', 'integration', 'e2e'];

    suites.forEach(suite => {
      const suiteData = data.performances.filter(p => p.suite === suite);

      if (suiteData.length < 2) {
        return; // Need at least 2 data points for trend analysis
      }

      // Sort by timestamp
      suiteData.sort((a, b) => a.timestamp - b.timestamp);

      // Analyze duration trend
      const durationTrend = this.calculateTrend(suiteData.map(d => d.averageDuration));

      trends.push({
        suite,
        metric: 'duration',
        trend: durationTrend.trend,
        changePercent: durationTrend.changePercent,
        samples: suiteData.length,
      });

      // Analyze pass rate trend
      const passRateTrend = this.calculateTrend(suiteData.map(d => d.passRate));

      trends.push({
        suite,
        metric: 'passRate',
        trend: passRateTrend.trend,
        changePercent: passRateTrend.changePercent,
        samples: suiteData.length,
      });

      // Analyze test count trend
      const testCountTrend = this.calculateTrend(suiteData.map(d => d.totalTests));

      trends.push({
        suite,
        metric: 'testCount',
        trend: testCountTrend.trend,
        changePercent: testCountTrend.changePercent,
        samples: suiteData.length,
      });
    });

    // Save trends
    fs.writeFileSync(this.trendsFile, JSON.stringify(trends, null, 2));

    return trends;
  }

  private calculateTrend(values: number[]): {
    trend: 'improving' | 'degrading' | 'stable';
    changePercent: number;
  } {
    if (values.length < 2) {
      return { trend: 'stable', changePercent: 0 };
    }

    // Simple linear regression to determine trend
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * values[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate percentage change
    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const changePercent = firstValue !== 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

    // Determine trend based on slope
    const threshold = 0.05; // 5% threshold for considering a trend significant

    if (Math.abs(changePercent) < threshold) {
      return { trend: 'stable', changePercent };
    } else if (slope > 0) {
      return { trend: 'degrading', changePercent }; // Increasing duration is degrading
    } else {
      return { trend: 'improving', changePercent }; // Decreasing duration is improving
    }
  }

  generatePerformanceReport(): void {
    const data = this.loadHistoricalData();
    const trends = this.analyzeTrends();

    console.log('\n📈 Test Performance Report');
    console.log('='.repeat(60));

    // Current performance summary
    const latestPerformances = data.performances
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 3);

    if (latestPerformances.length > 0) {
      console.log('\n🕐 Latest Performance:');
      latestPerformances.forEach(perf => {
        console.log(`  ${perf.suite.toUpperCase()}:`);
        console.log(`    Total tests: ${perf.totalTests}`);
        console.log(`    Duration: ${(perf.totalDuration / 1000).toFixed(2)}s`);
        console.log(`    Avg per test: ${perf.averageDuration.toFixed(2)}ms`);
        console.log(`    Pass rate: ${perf.passRate.toFixed(1)}%`);
        console.log(`    Date: ${new Date(perf.timestamp).toLocaleDateString()}\n`);
      });
    }

    // Trend analysis
    if (trends.length > 0) {
      console.log('📊 Performance Trends:');
      trends.forEach(trend => {
        const icon = trend.trend === 'improving' ? '📈' : trend.trend === 'degrading' ? '📉' : '➡️';
        const sign = trend.changePercent > 0 ? '+' : '';

        console.log(
          `  ${icon} ${trend.suite} ${trend.metric}: ${trend.trend} (${sign}${trend.changePercent.toFixed(1)}%) [${trend.samples} samples]`
        );
      });
    }

    // Slowest tests
    console.log('\n🐌 Slowest Tests (All Time):');
    const slowestTests = data.detailedResults.sort((a, b) => b.duration - a.duration).slice(0, 10);

    slowestTests.forEach((test, index) => {
      console.log(`  ${index + 1}. ${test.name} (${test.suite})`);
      console.log(`     Duration: ${test.duration.toFixed(2)}ms`);
      console.log(`     File: ${path.basename(test.file)}`);
      console.log(`     Status: ${test.status}\n`);
    });

    // Performance recommendations
    this.generateRecommendations(trends, slowestTests);
  }

  private generateRecommendations(trends: PerformanceTrend[], slowestTests: TestResult[]): void {
    console.log('💡 Recommendations:');

    // Check for degrading trends
    const degradingTrends = trends.filter(t => t.trend === 'degrading');
    if (degradingTrends.length > 0) {
      console.log('  ⚠️  Performance Degradation Detected:');
      degradingTrends.forEach(trend => {
        console.log(
          `     - ${trend.suite} ${trend.metric} has degraded by ${trend.changePercent.toFixed(1)}%`
        );
      });
    }

    // Check for slow tests
    const verySlowTests = slowestTests.filter(t => t.duration > 5000); // Over 5 seconds
    if (verySlowTests.length > 0) {
      console.log('  🐌 Very Slow Tests (>5s):');
      verySlowTests.forEach(test => {
        console.log(`     - Optimize "${test.name}" in ${test.suite} tests`);
      });
    }

    // Check pass rates
    const latestData = this.loadHistoricalData();
    const recentFailures = latestData.performances
      .filter(p => p.passRate < 95) // Less than 95% pass rate
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 3);

    if (recentFailures.length > 0) {
      console.log('  ❌ Low Pass Rates:');
      recentFailures.forEach(perf => {
        console.log(
          `     - ${perf.suite} pass rate: ${perf.passRate.toFixed(1)}% - investigate failing tests`
        );
      });
    }

    if (degradingTrends.length === 0 && verySlowTests.length === 0 && recentFailures.length === 0) {
      console.log('  ✅ Test performance looks good! Keep it up!');
    }
  }

  async trackAllSuites(): Promise<void> {
    console.log('🚀 Starting comprehensive test performance tracking...\n');

    const suites: ('unit' | 'integration' | 'e2e')[] = ['unit', 'integration', 'e2e'];

    for (const suite of suites) {
      try {
        await this.trackTestRun(suite);
      } catch (error) {
        console.error(`Failed to track ${suite} tests:`, error);
      }
    }

    console.log('\n📊 Analyzing trends...');
    this.analyzeTrends();

    console.log('\n📋 Generating report...');
    this.generatePerformanceReport();

    console.log('\n✅ Performance tracking complete!');
  }
}

// Export for use in other scripts
export { TestPerformanceTracker, TestResult, TestSuitePerformance, PerformanceTrend };

// CLI usage
if (require.main === module) {
  const tracker = new TestPerformanceTracker();

  const args = process.argv.slice(2);
  const command = args[0] || 'track-all';

  switch (command) {
    case 'track-all':
      tracker.trackAllSuites().catch(console.error);
      break;
    case 'track':
      const suite = args[1] as 'unit' | 'integration' | 'e2e';
      if (!suite || !['unit', 'integration', 'e2e'].includes(suite)) {
        console.error('Usage: tsx test-performance-tracker.ts track <unit|integration|e2e>');
        process.exit(1);
      }
      tracker.trackTestRun(suite).catch(console.error);
      break;
    case 'report':
      tracker.generatePerformanceReport();
      break;
    case 'trends':
      const trends = tracker.analyzeTrends();
      console.log(JSON.stringify(trends, null, 2));
      break;
    default:
      console.log('Usage:');
      console.log('  tsx test-performance-tracker.ts [track-all|track <suite>|report|trends]');
      console.log('');
      console.log('Commands:');
      console.log('  track-all  - Track performance for all test suites');
      console.log('  track      - Track performance for specific suite (unit|integration|e2e)');
      console.log('  report     - Generate performance report');
      console.log('  trends     - Analyze performance trends');
  }
}

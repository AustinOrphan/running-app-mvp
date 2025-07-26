#!/usr/bin/env node

/**
 * Test Performance Monitor
<<<<<<< Updated upstream
 *
=======
 * 
>>>>>>> Stashed changes
 * This script monitors test execution performance and generates reports
 * for tracking test suite performance over time.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

class TestPerformanceMonitor {
  constructor() {
    this.reportDir = join(projectRoot, 'performance-reports');
    this.historicalDataFile = join(this.reportDir, 'historical-performance.json');
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!existsSync(this.reportDir)) {
      mkdirSync(this.reportDir, { recursive: true });
    }
  }

  loadHistoricalData() {
    if (existsSync(this.historicalDataFile)) {
      try {
        const data = readFileSync(this.historicalDataFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        process.stderr.write(`Warning: Failed to load historical data: ${error.message}\n`);
        return { runs: [] };
      }
    }
    return { runs: [] };
  }

  saveHistoricalData(data) {
    try {
      writeFileSync(this.historicalDataFile, JSON.stringify(data, null, 2));
    } catch (error) {
      process.stderr.write(`Error: Failed to save historical data: ${error.message}\n`);
    }
  }

  recordTestRun(testResults) {
    const historicalData = this.loadHistoricalData();
<<<<<<< Updated upstream

=======
    
>>>>>>> Stashed changes
    const run = {
      timestamp: new Date().toISOString(),
      totalDuration: testResults.totalDuration,
      passed: testResults.passed,
      failed: testResults.failed,
      suites: {},
      coverage: testResults.coverage,
      commit: this.getCommitHash(),
      environment: {
        node: process.version,
        os: process.platform,
        arch: process.arch,
        ci: process.env.CI === 'true',
      },
    };

    // Record suite-specific performance
    for (const [name, suite] of Object.entries(testResults.suites)) {
      run.suites[name] = {
        duration: suite.duration,
        status: suite.status,
      };
    }

    historicalData.runs.push(run);
<<<<<<< Updated upstream

=======
    
>>>>>>> Stashed changes
    // Keep only last 100 runs to prevent file size bloat
    if (historicalData.runs.length > 100) {
      historicalData.runs = historicalData.runs.slice(-100);
    }

    this.saveHistoricalData(historicalData);
    return run;
  }

  getCommitHash() {
    try {
      const { execSync } = require('child_process');
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (error) {
      return 'unknown';
    }
  }

  generatePerformanceReport() {
    const historicalData = this.loadHistoricalData();
    const runs = historicalData.runs;

    if (runs.length === 0) {
      return {
        message: 'No performance data available',
        recommendations: [],
      };
    }

    const latest = runs[runs.length - 1];
    const previousRuns = runs.slice(-10); // Last 10 runs
<<<<<<< Updated upstream

=======
    
>>>>>>> Stashed changes
    const report = {
      summary: {
        totalRuns: runs.length,
        latestRun: latest,
        averageTime: this.calculateAverage(previousRuns.map(r => r.totalDuration)),
        trends: this.analyzeTrends(runs),
      },
      suitePerformance: this.analyzeSuitePerformance(runs),
      recommendations: this.generateRecommendations(runs),
      regressions: this.detectRegressions(runs),
    };

    // Save report
<<<<<<< Updated upstream
    const reportPath = join(
      this.reportDir,
      `performance-report-${new Date().toISOString().split('T')[0]}.json`
    );
=======
    const reportPath = join(this.reportDir, `performance-report-${new Date().toISOString().split('T')[0]}.json`);
>>>>>>> Stashed changes
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    return report;
  }

  calculateAverage(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  analyzeTrends(runs) {
    if (runs.length < 5) {
      return { status: 'insufficient_data' };
    }

    const recent = runs.slice(-5);
    const older = runs.slice(-10, -5);

    if (older.length === 0) {
      return { status: 'insufficient_data' };
    }

    const recentAvg = this.calculateAverage(recent.map(r => r.totalDuration));
    const olderAvg = this.calculateAverage(older.map(r => r.totalDuration));

    const change = ((recentAvg - olderAvg) / olderAvg) * 100;

    return {
      status: change > 10 ? 'deteriorating' : change < -10 ? 'improving' : 'stable',
      changePercent: change,
      recentAverage: recentAvg,
      previousAverage: olderAvg,
    };
  }

  analyzeSuitePerformance(runs) {
    const suiteStats = {};
<<<<<<< Updated upstream

=======
    
>>>>>>> Stashed changes
    for (const run of runs) {
      for (const [suiteName, suite] of Object.entries(run.suites || {})) {
        if (!suiteStats[suiteName]) {
          suiteStats[suiteName] = {
            durations: [],
            failures: 0,
            total: 0,
          };
        }
<<<<<<< Updated upstream

        suiteStats[suiteName].durations.push(suite.duration);
        suiteStats[suiteName].total++;

=======
        
        suiteStats[suiteName].durations.push(suite.duration);
        suiteStats[suiteName].total++;
        
>>>>>>> Stashed changes
        if (suite.status === 'failed') {
          suiteStats[suiteName].failures++;
        }
      }
    }

    // Calculate statistics for each suite
    const analysis = {};
    for (const [suiteName, stats] of Object.entries(suiteStats)) {
      analysis[suiteName] = {
        averageDuration: this.calculateAverage(stats.durations),
        minDuration: Math.min(...stats.durations),
        maxDuration: Math.max(...stats.durations),
        failureRate: stats.failures / stats.total,
        trend: this.calculateSuiteTrend(stats.durations),
      };
    }

    return analysis;
  }

  calculateSuiteTrend(durations) {
    if (durations.length < 5) return 'insufficient_data';

    const recent = durations.slice(-3);
    const older = durations.slice(-6, -3);

    if (older.length === 0) return 'insufficient_data';

    const recentAvg = this.calculateAverage(recent);
    const olderAvg = this.calculateAverage(older);
    const change = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (change > 15) return 'deteriorating';
    if (change < -15) return 'improving';
    return 'stable';
  }

  detectRegressions(runs) {
    if (runs.length < 3) return [];

    const regressions = [];
    const recent = runs.slice(-3);
    const baseline = runs.slice(-10, -3);

    if (baseline.length === 0) return [];

    const baselineAvg = this.calculateAverage(baseline.map(r => r.totalDuration));
    const recentAvg = this.calculateAverage(recent.map(r => r.totalDuration));

    // Total duration regression
    if (recentAvg > baselineAvg * 1.2) {
      regressions.push({
        type: 'total_duration',
        severity: 'high',
<<<<<<< Updated upstream
        description: `Total test duration increased by ${(((recentAvg - baselineAvg) / baselineAvg) * 100).toFixed(1)}%`,
=======
        description: `Total test duration increased by ${((recentAvg - baselineAvg) / baselineAvg * 100).toFixed(1)}%`,
>>>>>>> Stashed changes
        baseline: baselineAvg,
        current: recentAvg,
      });
    }

    // Suite-specific regressions
    for (const run of recent) {
      for (const [suiteName, suite] of Object.entries(run.suites || {})) {
        const historicalDurations = baseline
          .map(r => r.suites?.[suiteName]?.duration)
          .filter(d => d !== undefined);

        if (historicalDurations.length === 0) continue;

        const avgHistorical = this.calculateAverage(historicalDurations);
        if (suite.duration > avgHistorical * 1.5) {
          regressions.push({
            type: 'suite_duration',
            suite: suiteName,
            severity: suite.duration > avgHistorical * 2 ? 'high' : 'medium',
            description: `${suiteName} duration increased significantly`,
            baseline: avgHistorical,
            current: suite.duration,
          });
        }
      }
    }

    return regressions;
  }

  generateRecommendations(runs) {
    const recommendations = [];
    const latest = runs[runs.length - 1];

    // General recommendations
<<<<<<< Updated upstream
    if (latest.totalDuration > 300000) {
      // 5 minutes
      recommendations.push({
        priority: 'high',
        category: 'performance',
        message:
          'Total test execution time is over 5 minutes. Consider parallel execution or test optimization.',
=======
    if (latest.totalDuration > 300000) { // 5 minutes
      recommendations.push({
        priority: 'high',
        category: 'performance',
        message: 'Total test execution time is over 5 minutes. Consider parallel execution or test optimization.',
>>>>>>> Stashed changes
      });
    }

    // Suite-specific recommendations
    for (const [suiteName, suite] of Object.entries(latest.suites || {})) {
<<<<<<< Updated upstream
      if (suite.duration > 120000) {
        // 2 minutes
=======
      if (suite.duration > 120000) { // 2 minutes
>>>>>>> Stashed changes
        recommendations.push({
          priority: 'medium',
          category: 'suite_performance',
          message: `${suiteName} takes over 2 minutes. Consider breaking it down or optimizing slow tests.`,
        });
      }
    }

    // Coverage vs performance trade-off
    if (latest.coverage) {
<<<<<<< Updated upstream
      const totalCoverage =
        Object.values(latest.coverage).reduce((sum, cov) => sum + cov.lines.pct, 0) /
        Object.keys(latest.coverage).length;

      if (totalCoverage > 95 && latest.totalDuration > 180000) {
        // 3 minutes
        recommendations.push({
          priority: 'low',
          category: 'optimization',
          message:
            'High coverage achieved. Consider if all tests are necessary or if some can be optimized.',
=======
      const totalCoverage = Object.values(latest.coverage)
        .reduce((sum, cov) => sum + cov.lines.pct, 0) / Object.keys(latest.coverage).length;
      
      if (totalCoverage > 95 && latest.totalDuration > 180000) { // 3 minutes
        recommendations.push({
          priority: 'low',
          category: 'optimization',
          message: 'High coverage achieved. Consider if all tests are necessary or if some can be optimized.',
>>>>>>> Stashed changes
        });
      }
    }

    // Failure rate recommendations
    const totalTests = latest.passed + latest.failed;
    const failureRate = latest.failed / totalTests;
<<<<<<< Updated upstream

    if (failureRate > 0.1) {
      // 10% failure rate
      recommendations.push({
        priority: 'high',
        category: 'stability',
        message:
          'High failure rate detected. Focus on stabilizing tests before performance optimization.',
=======
    
    if (failureRate > 0.1) { // 10% failure rate
      recommendations.push({
        priority: 'high',
        category: 'stability',
        message: 'High failure rate detected. Focus on stabilizing tests before performance optimization.',
>>>>>>> Stashed changes
      });
    }

    return recommendations;
  }

  printReport(report) {
    const colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
    };

<<<<<<< Updated upstream
    process.stdout.write(
      `\n${colors.bright}${colors.cyan}Test Performance Report${colors.reset}\n`
    );
=======
    process.stdout.write(`\n${colors.bright}${colors.cyan}Test Performance Report${colors.reset}\n`);
>>>>>>> Stashed changes
    process.stdout.write('='.repeat(50) + '\n\n');

    // Summary
    process.stdout.write(`${colors.cyan}Summary:${colors.reset}\n`);
    process.stdout.write(`  Total Runs: ${report.summary.totalRuns}\n`);
<<<<<<< Updated upstream
    process.stdout.write(
      `  Latest Duration: ${(report.summary.latestRun.totalDuration / 1000).toFixed(2)}s\n`
    );
    process.stdout.write(
      `  Average Duration: ${(report.summary.averageTime / 1000).toFixed(2)}s\n`
    );

    const trend = report.summary.trends;
    const trendColor =
      trend.status === 'improving'
        ? colors.green
        : trend.status === 'deteriorating'
          ? colors.red
          : colors.yellow;
=======
    process.stdout.write(`  Latest Duration: ${(report.summary.latestRun.totalDuration / 1000).toFixed(2)}s\n`);
    process.stdout.write(`  Average Duration: ${(report.summary.averageTime / 1000).toFixed(2)}s\n`);
    
    const trend = report.summary.trends;
    const trendColor = trend.status === 'improving' ? colors.green : 
                      trend.status === 'deteriorating' ? colors.red : colors.yellow;
>>>>>>> Stashed changes
    process.stdout.write(`  Trend: ${trendColor}${trend.status}${colors.reset}\n\n`);

    // Regressions
    if (report.regressions.length > 0) {
      process.stdout.write(`${colors.red}Regressions Detected:${colors.reset}\n`);
      for (const regression of report.regressions) {
        const severityColor = regression.severity === 'high' ? colors.red : colors.yellow;
<<<<<<< Updated upstream
        process.stdout.write(
          `  ${severityColor}[${regression.severity.toUpperCase()}]${colors.reset} ${regression.description}\n`
        );
=======
        process.stdout.write(`  ${severityColor}[${regression.severity.toUpperCase()}]${colors.reset} ${regression.description}\n`);
>>>>>>> Stashed changes
      }
      process.stdout.write('\n');
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      process.stdout.write(`${colors.yellow}Recommendations:${colors.reset}\n`);
      for (const rec of report.recommendations) {
<<<<<<< Updated upstream
        const priorityColor =
          rec.priority === 'high'
            ? colors.red
            : rec.priority === 'medium'
              ? colors.yellow
              : colors.blue;
        process.stdout.write(
          `  ${priorityColor}[${rec.priority.toUpperCase()}]${colors.reset} ${rec.message}\n`
        );
=======
        const priorityColor = rec.priority === 'high' ? colors.red : 
                            rec.priority === 'medium' ? colors.yellow : colors.blue;
        process.stdout.write(`  ${priorityColor}[${rec.priority.toUpperCase()}]${colors.reset} ${rec.message}\n`);
>>>>>>> Stashed changes
      }
      process.stdout.write('\n');
    }

    process.stdout.write('='.repeat(50) + '\n');
  }
}

// CLI usage
if (import.meta.url === `file://${__filename}`) {
  const monitor = new TestPerformanceMonitor();
<<<<<<< Updated upstream

=======
  
>>>>>>> Stashed changes
  const args = process.argv.slice(2);
  const command = args[0] || 'report';

  switch (command) {
    case 'report':
      const report = monitor.generatePerformanceReport();
      monitor.printReport(report);
      break;
<<<<<<< Updated upstream

=======
      
>>>>>>> Stashed changes
    case 'record':
      // This would be called by the test runner to record results
      const resultsFile = args[1];
      if (resultsFile && existsSync(resultsFile)) {
        const testResults = JSON.parse(readFileSync(resultsFile, 'utf8'));
        monitor.recordTestRun(testResults);
        process.stdout.write('Performance data recorded successfully.\n');
      } else {
        process.stderr.write('Error: Test results file not found.\n');
        process.exit(1);
      }
      break;
<<<<<<< Updated upstream

    default:
      process.stderr.write(
        'Usage: node test-performance-monitor.js [report|record <results-file>]\n'
      );
=======
      
    default:
      process.stderr.write('Usage: node test-performance-monitor.js [report|record <results-file>]\n');
>>>>>>> Stashed changes
      process.exit(1);
  }
}

<<<<<<< Updated upstream
export { TestPerformanceMonitor };
=======
export { TestPerformanceMonitor };
>>>>>>> Stashed changes

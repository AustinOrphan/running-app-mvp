#!/usr/bin/env tsx

/**
 * Test Reliability Tracker
 * 
 * This script tracks test reliability metrics including:
 * - Overall pass rate
 * - Flaky test detection
 * - Test duration trends
 * - Failure patterns
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface TestResult {
  name: string;
  fullName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  file: string;
  timestamp: Date;
}

interface TestSuite {
  name: string;
  results: TestResult[];
  duration: number;
  timestamp: Date;
}

interface TestRun {
  id: string;
  timestamp: Date;
  suites: TestSuite[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  environment: {
    nodeVersion: string;
    gitCommit: string;
    gitBranch: string;
  };
}

interface FlakyTest {
  name: string;
  fullName: string;
  file: string;
  totalRuns: number;
  failures: number;
  flakyRate: number;
  lastFailure: Date;
  errorPatterns: string[];
}

interface ReliabilityMetrics {
  overallPassRate: number;
  flakyTestRate: number;
  totalTests: number;
  flakyTests: FlakyTest[];
  trends: {
    passRateHistory: Array<{ date: Date; passRate: number }>;
    avgDuration: number;
    durationTrend: 'improving' | 'stable' | 'degrading';
  };
  lastUpdated: Date;
}

export class TestReliabilityTracker {
  private readonly dataDir = 'test-data/reliability';
  private readonly metricsFile = path.join(this.dataDir, 'metrics.json');
  private readonly runsDir = path.join(this.dataDir, 'runs');

  constructor() {
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }
  }

  /**
   * Run all test suites and collect reliability data
   */
  async trackReliability(): Promise<ReliabilityMetrics> {
    console.log('🔍 Starting test reliability tracking...\n');

    const testRun = await this.runAllTests();
    await this.saveTestRun(testRun);
    
    const metrics = await this.calculateMetrics();
    await this.saveMetrics(metrics);
    
    this.reportMetrics(metrics);
    
    return metrics;
  }

  /**
   * Run a specific test multiple times to detect flakiness
   */
  async detectFlakiness(testPattern: string, runs: number = 10): Promise<FlakyTest[]> {
    console.log(`🔄 Running flakiness detection for "${testPattern}" (${runs} runs)...\n`);
    
    const results: Array<{ passed: boolean; duration: number; error?: string }> = [];
    
    for (let i = 1; i <= runs; i++) {
      process.stdout.write(`Run ${i}/${runs}: `);
      
      try {
        const startTime = Date.now();
        execSync(`npm run test:run -- --testNamePattern="${testPattern}"`, { 
          stdio: 'ignore' 
        });
        const duration = Date.now() - startTime;
        
        results.push({ passed: true, duration });
        process.stdout.write('✅ PASSED\n');
      } catch (error) {
        const duration = Date.now() - startTime;
        results.push({ 
          passed: false, 
          duration, 
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        process.stdout.write('❌ FAILED\n');
      }
    }
    
    const failures = results.filter(r => !r.passed).length;
    const flakyRate = failures / runs;
    
    console.log(`\n📊 Results for "${testPattern}":`);
    console.log(`  Runs: ${runs}`);
    console.log(`  Failures: ${failures}`);
    console.log(`  Flaky Rate: ${(flakyRate * 100).toFixed(1)}%`);
    console.log(`  Status: ${flakyRate > 0.01 ? '🚨 FLAKY' : '✅ STABLE'}\n`);
    
    if (flakyRate > 0.01) {
      return [{
        name: testPattern,
        fullName: testPattern,
        file: 'unknown',
        totalRuns: runs,
        failures,
        flakyRate,
        lastFailure: new Date(),
        errorPatterns: results
          .filter(r => !r.passed && r.error)
          .map(r => r.error!)
          .filter((error, index, arr) => arr.indexOf(error) === index)
      }];
    }
    
    return [];
  }

  private async runAllTests(): Promise<TestRun> {
    const id = `run-${Date.now()}`;
    const timestamp = new Date();
    
    console.log('🧪 Running unit tests...');
    const unitResults = await this.runTestSuite('unit', 'npm run test:run');
    
    console.log('🔗 Running integration tests...');
    const integrationResults = await this.runTestSuite('integration', 'npm run test:integration');
    
    console.log('🎭 Running E2E tests...');
    const e2eResults = await this.runTestSuite('e2e', 'npm run test:e2e');
    
    const suites = [unitResults, integrationResults, e2eResults];
    const summary = this.calculateSummary(suites);
    const environment = await this.getEnvironmentInfo();
    
    return {
      id,
      timestamp,
      suites,
      summary,
      environment
    };
  }

  private async runTestSuite(name: string, command: string): Promise<TestSuite> {
    const startTime = Date.now();
    const results: TestResult[] = [];
    
    try {
      // For now, we'll use a simplified approach
      // In a real implementation, you'd parse actual test output
      execSync(command, { stdio: 'ignore' });
      
      // Simulate parsing test results
      // In reality, you'd parse JSON output from test runners
      results.push({
        name: `${name}-test-suite`,
        fullName: `${name} test suite`,
        status: 'passed',
        duration: Date.now() - startTime,
        file: `tests/${name}/`,
        timestamp: new Date()
      });
      
    } catch (error) {
      results.push({
        name: `${name}-test-suite`,
        fullName: `${name} test suite`,
        status: 'failed',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Test suite failed',
        file: `tests/${name}/`,
        timestamp: new Date()
      });
    }
    
    return {
      name,
      results,
      duration: Date.now() - startTime,
      timestamp: new Date()
    };
  }

  private calculateSummary(suites: TestSuite[]) {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let duration = 0;
    
    for (const suite of suites) {
      duration += suite.duration;
      for (const result of suite.results) {
        total++;
        switch (result.status) {
          case 'passed': passed++; break;
          case 'failed': failed++; break;
          case 'skipped': skipped++; break;
        }
      }
    }
    
    return { total, passed, failed, skipped, duration };
  }

  private async getEnvironmentInfo() {
    try {
      const nodeVersion = process.version;
      const gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      
      return { nodeVersion, gitCommit, gitBranch };
    } catch {
      return { 
        nodeVersion: process.version, 
        gitCommit: 'unknown', 
        gitBranch: 'unknown' 
      };
    }
  }

  private async saveTestRun(testRun: TestRun): Promise<void> {
    const filename = `${testRun.id}.json`;
    const filepath = path.join(this.runsDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(testRun, null, 2));
  }

  private async calculateMetrics(): Promise<ReliabilityMetrics> {
    const runs = this.loadRecentRuns(30); // Last 30 runs
    
    if (runs.length === 0) {
      return {
        overallPassRate: 0,
        flakyTestRate: 0,
        totalTests: 0,
        flakyTests: [],
        trends: {
          passRateHistory: [],
          avgDuration: 0,
          durationTrend: 'stable'
        },
        lastUpdated: new Date()
      };
    }
    
    // Calculate overall pass rate
    let totalTests = 0;
    let totalPassed = 0;
    const passRateHistory: Array<{ date: Date; passRate: number }> = [];
    
    for (const run of runs) {
      totalTests += run.summary.total;
      totalPassed += run.summary.passed;
      
      const passRate = run.summary.total > 0 ? run.summary.passed / run.summary.total : 0;
      passRateHistory.push({ date: run.timestamp, passRate });
    }
    
    const overallPassRate = totalTests > 0 ? totalPassed / totalTests : 0;
    
    // Detect flaky tests
    const flakyTests = this.detectFlakyTests(runs);
    const flakyTestRate = flakyTests.length / (totalTests || 1);
    
    // Calculate trends
    const avgDuration = runs.reduce((sum, run) => sum + run.summary.duration, 0) / runs.length;
    const durationTrend = this.calculateDurationTrend(runs);
    
    return {
      overallPassRate,
      flakyTestRate,
      totalTests: totalTests / runs.length, // Average per run
      flakyTests,
      trends: {
        passRateHistory,
        avgDuration,
        durationTrend
      },
      lastUpdated: new Date()
    };
  }

  private loadRecentRuns(count: number): TestRun[] {
    try {
      const files = fs.readdirSync(this.runsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .slice(-count);
      
      return files.map(file => {
        const filepath = path.join(this.runsDir, file);
        const content = fs.readFileSync(filepath, 'utf8');
        return JSON.parse(content) as TestRun;
      });
    } catch {
      return [];
    }
  }

  private detectFlakyTests(runs: TestRun[]): FlakyTest[] {
    const testStats = new Map<string, { 
      total: number; 
      failures: number; 
      lastFailure?: Date;
      errors: string[];
    }>();
    
    for (const run of runs) {
      for (const suite of run.suites) {
        for (const result of suite.results) {
          const key = `${result.file}::${result.fullName}`;
          const stats = testStats.get(key) || { 
            total: 0, 
            failures: 0, 
            errors: [] 
          };
          
          stats.total++;
          if (result.status === 'failed') {
            stats.failures++;
            stats.lastFailure = run.timestamp;
            if (result.error) {
              stats.errors.push(result.error);
            }
          }
          
          testStats.set(key, stats);
        }
      }
    }
    
    const flakyTests: FlakyTest[] = [];
    
    for (const [key, stats] of testStats) {
      const flakyRate = stats.failures / stats.total;
      
      // Consider a test flaky if it fails more than 1% of the time
      if (flakyRate > 0.01 && stats.total >= 5) {
        const [file, fullName] = key.split('::');
        flakyTests.push({
          name: fullName.split(' ').pop() || fullName,
          fullName,
          file,
          totalRuns: stats.total,
          failures: stats.failures,
          flakyRate,
          lastFailure: stats.lastFailure || new Date(),
          errorPatterns: [...new Set(stats.errors)]
        });
      }
    }
    
    return flakyTests.sort((a, b) => b.flakyRate - a.flakyRate);
  }

  private calculateDurationTrend(runs: TestRun[]): 'improving' | 'stable' | 'degrading' {
    if (runs.length < 3) return 'stable';
    
    const recent = runs.slice(-5);
    const older = runs.slice(-10, -5);
    
    if (older.length === 0) return 'stable';
    
    const recentAvg = recent.reduce((sum, run) => sum + run.summary.duration, 0) / recent.length;
    const olderAvg = older.reduce((sum, run) => sum + run.summary.duration, 0) / older.length;
    
    const change = (recentAvg - olderAvg) / olderAvg;
    
    if (change < -0.1) return 'improving';
    if (change > 0.1) return 'degrading';
    return 'stable';
  }

  private async saveMetrics(metrics: ReliabilityMetrics): Promise<void> {
    fs.writeFileSync(this.metricsFile, JSON.stringify(metrics, null, 2));
  }

  private reportMetrics(metrics: ReliabilityMetrics): void {
    console.log('\n📊 Test Reliability Report');
    console.log('=' .repeat(50));
    
    const passRateStr = (metrics.overallPassRate * 100).toFixed(1);
    const passRateEmoji = metrics.overallPassRate >= 1.0 ? '✅' : 
                         metrics.overallPassRate >= 0.95 ? '⚠️' : '❌';
    
    console.log(`${passRateEmoji} Overall Pass Rate: ${passRateStr}%`);
    
    const flakyRateStr = (metrics.flakyTestRate * 100).toFixed(1);
    const flakyEmoji = metrics.flakyTestRate <= 0.01 ? '✅' : 
                      metrics.flakyTestRate <= 0.05 ? '⚠️' : '❌';
    
    console.log(`${flakyEmoji} Flaky Test Rate: ${flakyRateStr}%`);
    console.log(`📊 Total Tests: ${metrics.totalTests.toFixed(0)}`);
    console.log(`⏱️  Average Duration: ${(metrics.trends.avgDuration / 1000).toFixed(1)}s`);
    console.log(`📈 Duration Trend: ${this.getTrendEmoji(metrics.trends.durationTrend)} ${metrics.trends.durationTrend}`);
    
    if (metrics.flakyTests.length > 0) {
      console.log('\n🚨 Flaky Tests Detected:');
      for (const test of metrics.flakyTests.slice(0, 5)) {
        console.log(`  • ${test.name} (${(test.flakyRate * 100).toFixed(1)}% failure rate)`);
        console.log(`    File: ${test.file}`);
        console.log(`    Runs: ${test.totalRuns}, Failures: ${test.failures}`);
      }
      
      if (metrics.flakyTests.length > 5) {
        console.log(`  ... and ${metrics.flakyTests.length - 5} more`);
      }
    }
    
    // Success criteria check
    console.log('\n🎯 Success Criteria:');
    const passRateOk = metrics.overallPassRate >= 1.0;
    const flakyRateOk = metrics.flakyTestRate <= 0.01;
    
    console.log(`  ${passRateOk ? '✅' : '❌'} 100% pass rate: ${passRateStr}%`);
    console.log(`  ${flakyRateOk ? '✅' : '❌'} <1% flaky tests: ${flakyRateStr}%`);
    
    const overallSuccess = passRateOk && flakyRateOk;
    console.log(`\n${overallSuccess ? '🎉' : '⚠️'} Overall Status: ${overallSuccess ? 'MEETING CRITERIA' : 'NEEDS IMPROVEMENT'}`);
    
    console.log(`\n📅 Last Updated: ${metrics.lastUpdated.toISOString()}`);
    console.log(`💾 Data saved to: ${this.metricsFile}\n`);
  }

  private getTrendEmoji(trend: string): string {
    switch (trend) {
      case 'improving': return '📈';
      case 'degrading': return '📉';
      default: return '➡️';
    }
  }

  /**
   * Generate HTML report
   */
  async generateHtmlReport(): Promise<string> {
    const metrics = this.loadMetrics();
    if (!metrics) {
      throw new Error('No metrics data available. Run trackReliability() first.');
    }
    
    const reportPath = path.join(this.dataDir, 'reliability-report.html');
    const html = this.generateHtmlContent(metrics);
    
    fs.writeFileSync(reportPath, html);
    console.log(`📊 HTML report generated: ${reportPath}`);
    
    return reportPath;
  }

  private loadMetrics(): ReliabilityMetrics | null {
    try {
      const content = fs.readFileSync(this.metricsFile, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private generateHtmlContent(metrics: ReliabilityMetrics): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Reliability Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { text-align: center; border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 20px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff; }
        .metric-value { font-size: 2em; font-weight: bold; color: #333; }
        .metric-label { color: #666; margin-top: 5px; }
        .flaky-tests { margin-top: 30px; }
        .flaky-test { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .success { color: #28a745; }
        .warning { color: #ffc107; }
        .error { color: #dc3545; }
        .chart { width: 100%; height: 300px; margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Test Reliability Report</h1>
            <p>Generated on ${metrics.lastUpdated.toLocaleString()}</p>
        </div>
        
        <div class="metrics">
            <div class="metric-card">
                <div class="metric-value ${metrics.overallPassRate >= 1.0 ? 'success' : metrics.overallPassRate >= 0.95 ? 'warning' : 'error'}">
                    ${(metrics.overallPassRate * 100).toFixed(1)}%
                </div>
                <div class="metric-label">Overall Pass Rate</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value ${metrics.flakyTestRate <= 0.01 ? 'success' : metrics.flakyTestRate <= 0.05 ? 'warning' : 'error'}">
                    ${(metrics.flakyTestRate * 100).toFixed(1)}%
                </div>
                <div class="metric-label">Flaky Test Rate</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value">${metrics.totalTests.toFixed(0)}</div>
                <div class="metric-label">Total Tests</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value">${(metrics.trends.avgDuration / 1000).toFixed(1)}s</div>
                <div class="metric-label">Average Duration</div>
            </div>
        </div>
        
        <div class="success-criteria">
            <h2>Success Criteria</h2>
            <ul>
                <li class="${metrics.overallPassRate >= 1.0 ? 'success' : 'error'}">
                    100% pass rate: ${(metrics.overallPassRate * 100).toFixed(1)}%
                </li>
                <li class="${metrics.flakyTestRate <= 0.01 ? 'success' : 'error'}">
                    &lt;1% flaky tests: ${(metrics.flakyTestRate * 100).toFixed(1)}%
                </li>
            </ul>
        </div>
        
        ${metrics.flakyTests.length > 0 ? `
        <div class="flaky-tests">
            <h2>Flaky Tests (${metrics.flakyTests.length})</h2>
            <table>
                <thead>
                    <tr>
                        <th>Test Name</th>
                        <th>File</th>
                        <th>Failure Rate</th>
                        <th>Total Runs</th>
                        <th>Failures</th>
                        <th>Last Failure</th>
                    </tr>
                </thead>
                <tbody>
                    ${metrics.flakyTests.map(test => `
                        <tr>
                            <td>${test.name}</td>
                            <td>${test.file}</td>
                            <td>${(test.flakyRate * 100).toFixed(1)}%</td>
                            <td>${test.totalRuns}</td>
                            <td>${test.failures}</td>
                            <td>${test.lastFailure.toLocaleDateString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : '<div class="success"><h2>🎉 No Flaky Tests Detected!</h2></div>'}
        
        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666;">
            Running App MVP - Test Reliability Report
        </div>
    </div>
</body>
</html>`;
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const tracker = new TestReliabilityTracker();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'track':
      tracker.trackReliability().catch(console.error);
      break;
      
    case 'flaky':
      const testPattern = process.argv[3];
      const runs = parseInt(process.argv[4]) || 10;
      if (!testPattern) {
        console.error('Usage: npm run test:reliability flaky <test-pattern> [runs]');
        process.exit(1);
      }
      tracker.detectFlakiness(testPattern, runs).catch(console.error);
      break;
      
    case 'report':
      tracker.generateHtmlReport().catch(console.error);
      break;
      
    default:
      console.log('Test Reliability Tracker');
      console.log('');
      console.log('Usage:');
      console.log('  npm run test:reliability track        - Track test reliability');
      console.log('  npm run test:reliability flaky <test> - Detect flaky tests');
      console.log('  npm run test:reliability report       - Generate HTML report');
      break;
  }
}
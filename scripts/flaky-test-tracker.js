#!/usr/bin/env node

/**
 * Flaky Test Tracker
 * 
 * Detects, tracks, and reports flaky tests across all test suites.
 * Provides statistics, trends, and auto-retry capabilities.
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class FlakyTestTracker {
  constructor(options = {}) {
    this.options = {
      outputDir: options.outputDir || './reports/flaky-tests',
      retryCount: options.retryCount || 3,
      threshold: options.threshold || 0.1, // 10% failure rate to be considered flaky
      historyLength: options.historyLength || 50, // Number of runs to keep in history
      ...options
    };
    
    this.testHistory = new Map();
    this.flakyTests = new Map();
    this.currentRun = {
      timestamp: new Date().toISOString(),
      results: new Map(),
      retries: new Map()
    };
  }

  /**
   * Initialize the flaky test tracker
   */
  async initialize() {
    await this.ensureOutputDir();
    await this.loadHistory();
    console.log('🔍 Flaky Test Tracker initialized');
  }

  /**
   * Ensure output directory exists
   */
  async ensureOutputDir() {
    try {
      await fs.mkdir(this.options.outputDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create output directory:', error);
      throw error;
    }
  }

  /**
   * Load test history from previous runs
   */
  async loadHistory() {
    try {
      const historyPath = path.join(this.options.outputDir, 'history.json');
      const historyData = await fs.readFile(historyPath, 'utf8');
      const history = JSON.parse(historyData);
      
      // Convert arrays back to Maps
      this.testHistory = new Map(history.testHistory || []);
      this.flakyTests = new Map(history.flakyTests || []);
      
      console.log(`📚 Loaded history for ${this.testHistory.size} tests`);
    } catch (error) {
      console.log('📝 No previous history found, starting fresh');
    }
  }

  /**
   * Save test history to disk
   */
  async saveHistory() {
    try {
      const historyPath = path.join(this.options.outputDir, 'history.json');
      const history = {
        lastUpdated: new Date().toISOString(),
        testHistory: Array.from(this.testHistory.entries()),
        flakyTests: Array.from(this.flakyTests.entries())
      };
      
      await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
      console.log('💾 Test history saved');
    } catch (error) {
      console.error('Failed to save history:', error);
    }
  }

  /**
   * Run tests with flaky test detection
   */
  async runTestsWithTracking(testSuite = 'all') {
    console.log(`🚀 Running tests with flaky test tracking (${testSuite})`);
    
    const suites = testSuite === 'all' 
      ? ['unit', 'integration', 'e2e']
      : [testSuite];
    
    for (const suite of suites) {
      await this.runSuiteWithRetries(suite);
    }
    
    await this.analyzeResults();
    await this.generateReports();
    await this.saveHistory();
    
    return this.currentRun;
  }

  /**
   * Run a test suite with automatic retries for failures
   */
  async runSuiteWithRetries(suite) {
    console.log(`\n📋 Running ${suite} tests...`);
    
    const commands = {
      unit: 'npm run test:run',
      integration: 'npm run test:integration',
      e2e: 'npm run test:e2e'
    };
    
    const command = commands[suite];
    if (!command) {
      console.warn(`⚠️ Unknown test suite: ${suite}`);
      return;
    }
    
    let attempt = 1;
    let lastResult = null;
    
    while (attempt <= this.options.retryCount) {
      console.log(`\n🔄 Attempt ${attempt}/${this.options.retryCount} for ${suite} tests`);
      
      const result = await this.runTestCommand(command, suite, attempt);
      lastResult = result;
      
      if (result.success) {
        console.log(`✅ ${suite} tests passed on attempt ${attempt}`);
        break;
      } else {
        console.log(`❌ ${suite} tests failed on attempt ${attempt}`);
        
        // Track individual test failures for flaky detection
        await this.trackFailedTests(result, suite, attempt);
        
        if (attempt < this.options.retryCount) {
          console.log(`🔄 Retrying ${suite} tests...`);
          await this.delay(2000); // Wait 2 seconds between retries
        }
      }
      
      attempt++;
    }
    
    // Record final result for this suite
    this.currentRun.results.set(suite, lastResult);
  }

  /**
   * Run a test command and capture results
   */
  async runTestCommand(command, suite, attempt) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const [cmd, ...args] = command.split(' ');
      
      const child = spawn(cmd, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: true
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        process.stdout.write(data);
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        process.stderr.write(data);
      });
      
      child.on('close', (code) => {
        const duration = Date.now() - startTime;
        const success = code === 0;
        
        const result = {
          suite,
          attempt,
          success,
          exitCode: code,
          duration,
          timestamp: new Date().toISOString(),
          stdout,
          stderr,
          failedTests: this.parseFailedTests(stdout, stderr, suite)
        };
        
        resolve(result);
      });
      
      child.on('error', (error) => {
        resolve({
          suite,
          attempt,
          success: false,
          error: error.message,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          failedTests: []
        });
      });
    });
  }

  /**
   * Parse failed tests from test output
   */
  parseFailedTests(stdout, stderr, suite) {
    const failedTests = [];
    const output = stdout + stderr;
    
    // Different patterns for different test runners
    const patterns = {
      unit: [
        /❯ (.+\.test\.ts?) > (.+)/g,  // Vitest
        /✕ (.+) \(/g,                 // General failure
        /FAIL (.+\.test\.ts?)/g       // Jest style
      ],
      integration: [
        /✕ (.+)/g,                    // Jest style
        /FAIL (.+\.test\.ts?)/g,      // Jest file failures
        /× (.+)/g                     // Alternative Jest style
      ],
      e2e: [
        /(\d+\)) (.+) (/g,            // Playwright style
        /✘ \[(.+)\] (.+)/g,           // Playwright with browser
        /FAILED (.+\.spec\.ts?) /g    // Playwright file failures
      ]
    };
    
    const suitePatterns = patterns[suite] || patterns.unit;
    
    for (const pattern of suitePatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const testName = match[1] || match[2];
        if (testName && !failedTests.includes(testName)) {
          failedTests.push(testName.trim());
        }
      }
    }
    
    return failedTests;
  }

  /**
   * Track failed tests for flaky analysis
   */
  async trackFailedTests(result, suite, attempt) {
    for (const testName of result.failedTests) {
      const testId = `${suite}:${testName}`;
      
      if (!this.testHistory.has(testId)) {
        this.testHistory.set(testId, {
          suite,
          testName,
          runs: [],
          totalRuns: 0,
          failures: 0,
          successes: 0,
          flakyScore: 0
        });
      }
      
      const testData = this.testHistory.get(testId);
      
      // Add this run to history
      testData.runs.push({
        timestamp: result.timestamp,
        attempt,
        success: false,
        duration: result.duration
      });
      
      // Keep only recent runs
      if (testData.runs.length > this.options.historyLength) {
        testData.runs = testData.runs.slice(-this.options.historyLength);
      }
      
      testData.totalRuns++;
      testData.failures++;
      
      // Calculate flaky score
      this.calculateFlakyScore(testData);
      
      this.testHistory.set(testId, testData);
    }
  }

  /**
   * Calculate flaky score for a test
   */
  calculateFlakyScore(testData) {
    if (testData.totalRuns < 5) {
      testData.flakyScore = 0; // Need more data
      return;
    }
    
    const recentRuns = testData.runs.slice(-20); // Last 20 runs
    const failures = recentRuns.filter(run => !run.success).length;
    const successes = recentRuns.filter(run => run.success).length;
    
    // Flaky score: tests that sometimes pass, sometimes fail
    if (failures > 0 && successes > 0) {
      const failureRate = failures / recentRuns.length;
      const successRate = successes / recentRuns.length;
      
      // Higher score for tests that fail between 10% and 90% of the time
      if (failureRate >= 0.1 && failureRate <= 0.9) {
        testData.flakyScore = Math.min(failureRate, 1 - failureRate) * 2;
      } else {
        testData.flakyScore = 0;
      }
    } else {
      testData.flakyScore = 0;
    }
    
    testData.failures = failures;
    testData.successes = successes;
  }

  /**
   * Analyze test results for flaky patterns
   */
  async analyzeResults() {
    console.log('\n📊 Analyzing test results for flaky patterns...');
    
    const flakyTests = [];
    const consistentlyFailing = [];
    const stable = [];
    
    for (const [testId, testData] of this.testHistory.entries()) {
      if (testData.flakyScore >= this.options.threshold) {
        flakyTests.push({ testId, ...testData });
        this.flakyTests.set(testId, {
          ...testData,
          detectedAt: new Date().toISOString(),
          severity: this.categorizeFlakyness(testData.flakyScore)
        });
      } else if (testData.failures > 0 && testData.successes === 0) {
        consistentlyFailing.push({ testId, ...testData });
      } else {
        stable.push({ testId, ...testData });
      }
    }
    
    console.log(`\n🔍 Analysis Results:`);
    console.log(`   🔀 Flaky tests: ${flakyTests.length}`);
    console.log(`   ❌ Consistently failing: ${consistentlyFailing.length}`);
    console.log(`   ✅ Stable tests: ${stable.length}`);
    
    return {
      flaky: flakyTests,
      consistentlyFailing,
      stable,
      summary: {
        total: this.testHistory.size,
        flakyCount: flakyTests.length,
        flakyPercentage: this.testHistory.size > 0 ? (flakyTests.length / this.testHistory.size * 100).toFixed(2) : 0
      }
    };
  }

  /**
   * Categorize flakiness severity
   */
  categorizeFlakyness(score) {
    if (score >= 0.4) return 'high';
    if (score >= 0.2) return 'medium';
    return 'low';
  }

  /**
   * Generate comprehensive flaky test reports
   */
  async generateReports() {
    console.log('\n📝 Generating flaky test reports...');
    
    const analysis = await this.analyzeResults();
    
    // Generate JSON report
    await this.generateJsonReport(analysis);
    
    // Generate HTML dashboard
    await this.generateHtmlReport(analysis);
    
    // Generate summary report
    await this.generateSummaryReport(analysis);
    
    console.log(`📊 Reports generated in ${this.options.outputDir}`);
  }

  /**
   * Generate JSON report
   */
  async generateJsonReport(analysis) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: analysis.summary,
      flakyTests: analysis.flaky.map(test => ({
        testId: test.testId,
        suite: test.suite,
        testName: test.testName,
        flakyScore: test.flakyScore,
        severity: this.categorizeFlakyness(test.flakyScore),
        totalRuns: test.totalRuns,
        failures: test.failures,
        successes: test.successes,
        failureRate: test.totalRuns > 0 ? (test.failures / test.totalRuns * 100).toFixed(2) : 0,
        recentRuns: test.runs.slice(-10) // Last 10 runs
      })),
      consistentlyFailing: analysis.consistentlyFailing.map(test => ({
        testId: test.testId,
        suite: test.suite,
        testName: test.testName,
        totalRuns: test.totalRuns,
        failures: test.failures
      })),
      recommendations: this.generateRecommendations(analysis)
    };
    
    const reportPath = path.join(this.options.outputDir, 'flaky-tests-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  }

  /**
   * Generate HTML dashboard
   */
  async generateHtmlReport(analysis) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flaky Test Dashboard</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: white; padding: 30px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header h1 { margin: 0; color: #333; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-number { font-size: 2.5em; font-weight: bold; margin: 10px 0; }
        .flaky { color: #ff6b35; }
        .failing { color: #d32f2f; }
        .stable { color: #4caf50; }
        .section { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .test-list { list-style: none; padding: 0; }
        .test-item { padding: 15px; border-left: 4px solid #ddd; margin: 10px 0; background: #f9f9f9; border-radius: 0 4px 4px 0; }
        .test-item.high { border-left-color: #d32f2f; }
        .test-item.medium { border-left-color: #ff9800; }
        .test-item.low { border-left-color: #fdd835; }
        .test-name { font-weight: bold; margin-bottom: 5px; }
        .test-details { font-size: 0.9em; color: #666; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold; }
        .badge.high { background: #ffebee; color: #d32f2f; }
        .badge.medium { background: #fff8e1; color: #f57c00; }
        .badge.low { background: #fffde7; color: #f9a825; }
        .recommendations { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 20px; margin: 20px 0; border-radius: 0 4px 4px 0; }
        .chart-placeholder { height: 200px; background: #f5f5f5; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 Flaky Test Dashboard</h1>
            <p>Generated on ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-number flaky">${analysis.summary.flakyCount}</div>
                <div>Flaky Tests</div>
                <div class="test-details">${analysis.summary.flakyPercentage}% of total</div>
            </div>
            <div class="stat-card">
                <div class="stat-number failing">${analysis.consistentlyFailing.length}</div>
                <div>Consistently Failing</div>
            </div>
            <div class="stat-card">
                <div class="stat-number stable">${analysis.stable.length}</div>
                <div>Stable Tests</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${analysis.summary.total}</div>
                <div>Total Tests Tracked</div>
            </div>
        </div>
        
        ${analysis.flaky.length > 0 ? `
        <div class="section">
            <h2>🔀 Flaky Tests (${analysis.flaky.length})</h2>
            <ul class="test-list">
                ${analysis.flaky.map(test => `
                <li class="test-item ${this.categorizeFlakyness(test.flakyScore)}">
                    <div class="test-name">${test.testName}</div>
                    <div class="test-details">
                        <span class="badge ${this.categorizeFlakyness(test.flakyScore)}">${this.categorizeFlakyness(test.flakyScore).toUpperCase()}</span>
                        Suite: ${test.suite} | 
                        Flaky Score: ${test.flakyScore.toFixed(3)} | 
                        Success Rate: ${test.totalRuns > 0 ? ((test.successes / test.totalRuns) * 100).toFixed(1) : 0}% | 
                        Total Runs: ${test.totalRuns}
                    </div>
                </li>
                `).join('')}
            </ul>
        </div>
        ` : ''}
        
        ${analysis.consistentlyFailing.length > 0 ? `
        <div class="section">
            <h2>❌ Consistently Failing Tests (${analysis.consistentlyFailing.length})</h2>
            <ul class="test-list">
                ${analysis.consistentlyFailing.map(test => `
                <li class="test-item high">
                    <div class="test-name">${test.testName}</div>
                    <div class="test-details">
                        Suite: ${test.suite} | 
                        Failures: ${test.failures}/${test.totalRuns} | 
                        Never Passed
                    </div>
                </li>
                `).join('')}
            </ul>
        </div>
        ` : ''}
        
        <div class="section">
            <h2>📋 Recommendations</h2>
            <div class="recommendations">
                ${this.generateRecommendations(analysis).map(rec => `<p>• ${rec}</p>`).join('')}
            </div>
        </div>
        
        <div class="section">
            <h2>📊 Test Stability Trends</h2>
            <div class="chart-placeholder">
                Chart visualization would go here<br>
                (Showing test stability over time)
            </div>
        </div>
        
        <div class="section">
            <h2>ℹ️ About Flaky Tests</h2>
            <p><strong>Flaky Score:</strong> Measures how inconsistent a test is (0.0 = consistent, 1.0 = maximum flakiness)</p>
            <p><strong>Severity Levels:</strong></p>
            <ul>
                <li><strong>High (≥0.4):</strong> Highly unreliable, immediate attention needed</li>
                <li><strong>Medium (0.2-0.4):</strong> Moderately unreliable, should be investigated</li>
                <li><strong>Low (0.1-0.2):</strong> Slightly unreliable, monitor for trends</li>
            </ul>
        </div>
    </div>
</body>
</html>
    `;
    
    const reportPath = path.join(this.options.outputDir, 'flaky-tests-dashboard.html');
    await fs.writeFile(reportPath, html);
  }

  /**
   * Generate summary report
   */
  async generateSummaryReport(analysis) {
    const summary = `# Flaky Test Report Summary

**Generated:** ${new Date().toLocaleString()}

## 📊 Overview

- **Total Tests Tracked:** ${analysis.summary.total}
- **Flaky Tests:** ${analysis.summary.flakyCount} (${analysis.summary.flakyPercentage}%)
- **Consistently Failing:** ${analysis.consistentlyFailing.length}
- **Stable Tests:** ${analysis.stable.length}

## 🔀 Top Flaky Tests

${analysis.flaky.slice(0, 10).map(test => 
  `- **${test.testName}** (${test.suite})\n  - Flaky Score: ${test.flakyScore.toFixed(3)} (${this.categorizeFlakyness(test.flakyScore)})\n  - Success Rate: ${test.totalRuns > 0 ? ((test.successes / test.totalRuns) * 100).toFixed(1) : 0}%\n`
).join('')}

## 📋 Recommendations

${this.generateRecommendations(analysis).map(rec => `- ${rec}`).join('\n')}

## 🔧 Next Steps

1. **Investigate High-Priority Flaky Tests:** Focus on tests with high flaky scores
2. **Add Debugging:** Add logging and better error messages to flaky tests
3. **Increase Timeouts:** Consider if timing issues are causing flakiness
4. **Improve Test Isolation:** Ensure tests don't interfere with each other
5. **Monitor Trends:** Watch for patterns in test failures

---
*Report generated by Flaky Test Tracker*
`;
    
    const reportPath = path.join(this.options.outputDir, 'flaky-tests-summary.md');
    await fs.writeFile(reportPath, summary);
  }

  /**
   * Generate recommendations based on analysis
   */
  generateRecommendations(analysis) {
    const recommendations = [];
    
    if (analysis.flaky.length === 0) {
      recommendations.push('✅ Great! No flaky tests detected. Keep monitoring to maintain stability.');
    } else {
      recommendations.push(`🔍 ${analysis.flaky.length} flaky tests detected. Prioritize investigation by severity.`);
      
      const highSeverity = analysis.flaky.filter(t => this.categorizeFlakyness(t.flakyScore) === 'high');
      if (highSeverity.length > 0) {
        recommendations.push(`🚨 ${highSeverity.length} high-severity flaky tests need immediate attention.`);
      }
      
      recommendations.push('🔧 Consider adding retry logic with exponential backoff for flaky tests.');
      recommendations.push('📋 Add detailed logging to flaky tests to identify root causes.');
      recommendations.push('⏱️ Review test timeouts and async operations in flaky tests.');
    }
    
    if (analysis.consistentlyFailing.length > 0) {
      recommendations.push(`❌ ${analysis.consistentlyFailing.length} tests are consistently failing - these should be fixed or disabled.`);
    }
    
    if (analysis.summary.flakyPercentage > 5) {
      recommendations.push('📈 Flaky test percentage is high (>5%). Consider reviewing test infrastructure and isolation.');
    }
    
    recommendations.push('📊 Set up automated alerts for when new flaky tests are detected.');
    recommendations.push('🔄 Run this analysis regularly (daily/weekly) to track trends.');
    
    return recommendations;
  }

  /**
   * Generate auto-retry configuration
   */
  async generateRetryConfig() {
    console.log('\n⚙️ Generating auto-retry configuration...');
    
    const flakyTests = Array.from(this.flakyTests.values()).filter(test => 
      test.flakyScore >= this.options.threshold
    );
    
    // Generate Jest retry configuration
    const jestRetryConfig = {
      testRetries: 2,
      retryPattern: flakyTests.map(test => ({
        testNamePattern: test.testName,
        retries: this.categorizeFlakyness(test.flakyScore) === 'high' ? 3 : 2
      }))
    };
    
    // Generate Playwright retry configuration
    const playwrightRetryConfig = {
      retries: 2,
      projects: [
        {
          name: 'chromium',
          retries: 3 // More retries for E2E tests
        }
      ]
    };
    
    // Generate Vitest retry configuration
    const vitestRetryConfig = {
      retry: 2,
      testTimeout: 10000
    };
    
    const configPath = path.join(this.options.outputDir, 'retry-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      jest: jestRetryConfig,
      playwright: playwrightRetryConfig,
      vitest: vitestRetryConfig,
      flakyTests: flakyTests.map(test => ({
        testId: test.testName,
        suite: test.suite,
        recommendedRetries: this.categorizeFlakyness(test.flakyScore) === 'high' ? 3 : 2,
        severity: this.categorizeFlakyness(test.flakyScore)
      }))
    }, null, 2));
    
    console.log(`⚙️ Auto-retry configuration saved to ${configPath}`);
  }

  /**
   * Utility: delay execution
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI functionality
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'track';
  
  const tracker = new FlakyTestTracker({
    outputDir: process.env.FLAKY_OUTPUT_DIR || './reports/flaky-tests',
    retryCount: parseInt(process.env.FLAKY_RETRY_COUNT || '3'),
    threshold: parseFloat(process.env.FLAKY_THRESHOLD || '0.1')
  });
  
  try {
    await tracker.initialize();
    
    switch (command) {
      case 'track':
        console.log('🔍 Starting flaky test tracking...');
        const suite = args[1] || 'all';
        await tracker.runTestsWithTracking(suite);
        await tracker.generateRetryConfig();
        break;
        
      case 'analyze':
        console.log('📊 Analyzing existing test data...');
        const analysis = await tracker.analyzeResults();
        await tracker.generateReports();
        console.log(`\n📋 Analysis complete:`);
        console.log(`   Flaky tests: ${analysis.summary.flakyCount}`);
        console.log(`   Flaky percentage: ${analysis.summary.flakyPercentage}%`);
        break;
        
      case 'report':
        console.log('📝 Generating flaky test reports...');
        await tracker.generateReports();
        break;
        
      case 'config':
        console.log('⚙️ Generating retry configuration...');
        await tracker.generateRetryConfig();
        break;
        
      default:
        console.log('Usage: node flaky-test-tracker.js [track|analyze|report|config] [suite]');
        console.log('  track [suite]  - Run tests with flaky detection (default)');
        console.log('  analyze        - Analyze existing test data');
        console.log('  report         - Generate reports only');
        console.log('  config         - Generate retry configuration');
        console.log('');
        console.log('Suites: all, unit, integration, e2e');
        process.exit(1);
    }
    
    console.log('\n✅ Flaky test tracking complete');
    
  } catch (error) {
    console.error('❌ Flaky test tracking failed:', error);
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = FlakyTestTracker;

// Run CLI if called directly
if (require.main === module) {
  main();
}
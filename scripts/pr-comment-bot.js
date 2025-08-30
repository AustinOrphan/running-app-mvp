#!/usr/bin/env node

/**
 * PR Comment Bot
 *
 * Automatically posts comprehensive test results and coverage information
 * as comments on pull requests, providing developers with immediate feedback.
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class PRCommentBot {
  constructor(options = {}) {
    this.options = {
      outputDir: options.outputDir || './reports/pr-comments',
      testSuitesDir: options.testSuitesDir || './reports',
      coverageDir: options.coverageDir || './coverage',
      integrationCoverageDir: options.integrationCoverageDir || './coverage-integration',
      performanceDir: options.performanceDir || './reports/performance',
      flakyTestDir: options.flakyTestDir || './reports/flaky-tests',
      ...options,
    };

    this.testResults = {
      unit: null,
      integration: null,
      e2e: null,
      coverage: null,
      performance: null,
      flaky: null,
    };

    this.prData = {
      branch: null,
      commit: null,
      author: null,
      title: null,
    };
  }

  /**
   * Initialize the PR comment bot
   */
  async initialize() {
    await this.ensureOutputDir();
    await this.loadPRData();
    console.log('🤖 PR Comment Bot initialized');
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
   * Load PR data from git/environment
   */
  async loadPRData() {
    try {
      this.prData.branch = await this.getGitBranch();
      this.prData.commit = await this.getGitCommit();
      this.prData.author = await this.getGitAuthor();
      this.prData.title = process.env.PR_TITLE || 'Pull Request';
    } catch (error) {
      console.warn('Warning: Could not load all PR data:', error.message);
    }
  }

  /**
   * Get current git branch
   */
  async getGitBranch() {
    try {
      const { stdout } = await execAsync('git branch --show-current');
      return stdout.trim();
    } catch (error) {
      return process.env.GITHUB_HEAD_REF || 'unknown';
    }
  }

  /**
   * Get current git commit
   */
  async getGitCommit() {
    try {
      const { stdout } = await execAsync('git rev-parse --short HEAD');
      return stdout.trim();
    } catch (error) {
      return process.env.GITHUB_SHA?.substring(0, 8) || 'unknown';
    }
  }

  /**
   * Get git author
   */
  async getGitAuthor() {
    try {
      const { stdout } = await execAsync('git log -1 --pretty=format:"%an"');
      return stdout.trim();
    } catch (error) {
      return process.env.GITHUB_ACTOR || 'unknown';
    }
  }

  /**
   * Collect all test results
   */
  async collectTestResults() {
    console.log('📊 Collecting test results...\n');

    // Collect unit test results
    this.testResults.unit = await this.collectUnitTestResults();

    // Collect integration test results
    this.testResults.integration = await this.collectIntegrationTestResults();

    // Collect E2E test results
    this.testResults.e2e = await this.collectE2ETestResults();

    // Collect coverage data
    this.testResults.coverage = await this.collectCoverageResults();

    // Collect performance data
    this.testResults.performance = await this.collectPerformanceResults();

    // Collect flaky test data
    this.testResults.flaky = await this.collectFlakyTestResults();

    console.log('✅ Test results collection complete\n');
  }

  /**
   * Collect unit test results
   */
  async collectUnitTestResults() {
    try {
      console.log('📦 Collecting unit test results...');

      // Run unit tests and capture results
      const startTime = Date.now();
      let testOutput, exitCode;

      try {
        const { stdout } = await execAsync('npm run test:run -- --reporter=json', {
          maxBuffer: 1024 * 1024 * 10,
        });
        testOutput = stdout;
        exitCode = 0;
      } catch (error) {
        testOutput = error.stdout || error.stderr || '';
        exitCode = error.code || 1;
      }

      const duration = Date.now() - startTime;

      // Parse test results from output
      const results = this.parseVitestResults(testOutput);

      return {
        suite: 'Unit Tests',
        framework: 'Vitest',
        passed: exitCode === 0,
        duration,
        ...results,
      };
    } catch (error) {
      console.error('❌ Failed to collect unit test results:', error.message);
      return {
        suite: 'Unit Tests',
        framework: 'Vitest',
        passed: false,
        error: error.message,
        tests: 0,
        passed_tests: 0,
        failed_tests: 0,
        skipped_tests: 0,
      };
    }
  }

  /**
   * Collect integration test results
   */
  async collectIntegrationTestResults() {
    try {
      console.log('🔗 Collecting integration test results...');

      const startTime = Date.now();
      let testOutput, exitCode;

      try {
        const { stdout } = await execAsync('npm run test:integration -- --reporter=json', {
          maxBuffer: 1024 * 1024 * 10,
        });
        testOutput = stdout;
        exitCode = 0;
      } catch (error) {
        testOutput = error.stdout || error.stderr || '';
        exitCode = error.code || 1;
      }

      const duration = Date.now() - startTime;

      // Parse test results from output
      const results = this.parseJestResults(testOutput);

      return {
        suite: 'Integration Tests',
        framework: 'Jest',
        passed: exitCode === 0,
        duration,
        ...results,
      };
    } catch (error) {
      console.error('❌ Failed to collect integration test results:', error.message);
      return {
        suite: 'Integration Tests',
        framework: 'Jest',
        passed: false,
        error: error.message,
        tests: 0,
        passed_tests: 0,
        failed_tests: 0,
        skipped_tests: 0,
      };
    }
  }

  /**
   * Collect E2E test results
   */
  async collectE2ETestResults() {
    try {
      console.log('🎭 Collecting E2E test results...');

      const startTime = Date.now();
      let testOutput, exitCode;

      try {
        const { stdout } = await execAsync('npm run test:e2e -- --reporter=json', {
          maxBuffer: 1024 * 1024 * 10,
        });
        testOutput = stdout;
        exitCode = 0;
      } catch (error) {
        testOutput = error.stdout || error.stderr || '';
        exitCode = error.code || 1;
      }

      const duration = Date.now() - startTime;

      // Parse test results from output
      const results = this.parsePlaywrightResults(testOutput);

      return {
        suite: 'E2E Tests',
        framework: 'Playwright',
        passed: exitCode === 0,
        duration,
        ...results,
      };
    } catch (error) {
      console.error('❌ Failed to collect E2E test results:', error.message);
      return {
        suite: 'E2E Tests',
        framework: 'Playwright',
        passed: false,
        error: error.message,
        tests: 0,
        passed_tests: 0,
        failed_tests: 0,
        skipped_tests: 0,
      };
    }
  }

  /**
   * Collect coverage results
   */
  async collectCoverageResults() {
    try {
      console.log('📊 Collecting coverage results...');

      const coverage = {
        unit: null,
        integration: null,
        overall: null,
      };

      // Collect unit test coverage
      try {
        const unitSummaryPath = path.join(this.options.coverageDir, 'coverage-summary.json');
        const unitData = await fs.readFile(unitSummaryPath, 'utf8');
        const unitSummary = JSON.parse(unitData);
        coverage.unit = this.extractCoverageMetrics(unitSummary.total);
      } catch (error) {
        console.warn('Unit coverage not available:', error.message);
      }

      // Collect integration test coverage
      try {
        const integrationSummaryPath = path.join(
          this.options.integrationCoverageDir,
          'coverage-summary.json'
        );
        const integrationData = await fs.readFile(integrationSummaryPath, 'utf8');
        const integrationSummary = JSON.parse(integrationData);
        coverage.integration = this.extractCoverageMetrics(integrationSummary.total);
      } catch (error) {
        console.warn('Integration coverage not available:', error.message);
      }

      // Calculate overall coverage
      if (coverage.unit && coverage.integration) {
        coverage.overall = this.calculateOverallCoverage(coverage.unit, coverage.integration);
      } else if (coverage.unit) {
        coverage.overall = coverage.unit;
      } else if (coverage.integration) {
        coverage.overall = coverage.integration;
      }

      return coverage;
    } catch (error) {
      console.error('❌ Failed to collect coverage results:', error.message);
      return null;
    }
  }

  /**
   * Collect performance results
   */
  async collectPerformanceResults() {
    try {
      console.log('⚡ Collecting performance results...');

      // Try to read performance report
      const performancePath = path.join(this.options.performanceDir, 'performance-report.json');
      const performanceData = await fs.readFile(performancePath, 'utf8');
      const performance = JSON.parse(performanceData);

      return {
        totalDuration: performance.totalDuration,
        suitePerformance: performance.suites,
        trends: performance.trends,
        alerts: performance.alerts || [],
      };
    } catch (error) {
      console.warn('Performance data not available:', error.message);
      return null;
    }
  }

  /**
   * Collect flaky test results
   */
  async collectFlakyTestResults() {
    try {
      console.log('🔄 Collecting flaky test results...');

      // Try to read flaky test report
      const flakyPath = path.join(this.options.flakyTestDir, 'flaky-tests-report.json');
      const flakyData = await fs.readFile(flakyPath, 'utf8');
      const flaky = JSON.parse(flakyData);

      return {
        totalFlaky: flaky.totalFlaky || 0,
        newFlaky: flaky.newFlaky || 0,
        fixedFlaky: flaky.fixedFlaky || 0,
        flakyTests: flaky.flakyTests || [],
      };
    } catch (error) {
      console.warn('Flaky test data not available:', error.message);
      return {
        totalFlaky: 0,
        newFlaky: 0,
        fixedFlaky: 0,
        flakyTests: [],
      };
    }
  }

  /**
   * Parse Vitest results
   */
  parseVitestResults(output) {
    try {
      // Try to parse JSON output
      const lines = output.split('\n');
      let jsonLine = lines.find(
        line => line.trim().startsWith('{') && line.includes('numTotalTests')
      );

      if (jsonLine) {
        const results = JSON.parse(jsonLine);
        return {
          tests: results.numTotalTests || 0,
          passed_tests: results.numPassedTests || 0,
          failed_tests: results.numFailedTests || 0,
          skipped_tests: results.numPendingTests || 0,
          failures:
            results.testResults
              ?.filter(t => t.status === 'failed')
              ?.map(t => ({
                name: t.ancestorTitles?.join(' ') + ' ' + t.title,
                error: t.failureMessages?.[0] || 'Unknown error',
              })) || [],
        };
      }

      // Fallback: parse text output
      return this.parseTextTestResults(output);
    } catch (error) {
      return this.parseTextTestResults(output);
    }
  }

  /**
   * Parse Jest results
   */
  parseJestResults(output) {
    try {
      // Try to parse JSON output
      const lines = output.split('\n');
      let jsonLine = lines.find(
        line => line.trim().startsWith('{') && line.includes('numTotalTests')
      );

      if (jsonLine) {
        const results = JSON.parse(jsonLine);
        return {
          tests: results.numTotalTests || 0,
          passed_tests: results.numPassedTests || 0,
          failed_tests: results.numFailedTests || 0,
          skipped_tests: results.numPendingTests || 0,
          failures:
            results.testResults?.flatMap(suite =>
              suite.assertionResults
                ?.filter(test => test.status === 'failed')
                ?.map(test => ({
                  name: `${suite.testFilePath} > ${test.ancestorTitles?.join(' > ')} > ${test.title}`,
                  error: test.failureMessages?.[0] || 'Unknown error',
                }))
            ) || [],
        };
      }

      // Fallback: parse text output
      return this.parseTextTestResults(output);
    } catch (error) {
      return this.parseTextTestResults(output);
    }
  }

  /**
   * Parse Playwright results
   */
  parsePlaywrightResults(output) {
    try {
      // Try to parse JSON output
      if (output.includes('"stats"') && output.includes('"expected"')) {
        const results = JSON.parse(output);
        const stats = results.stats || {};

        return {
          tests: stats.expected + stats.unexpected + stats.flaky + stats.skipped,
          passed_tests: stats.expected || 0,
          failed_tests: stats.unexpected || 0,
          skipped_tests: stats.skipped || 0,
          flaky_tests: stats.flaky || 0,
          failures:
            results.suites?.flatMap(suite =>
              suite.specs?.flatMap(spec =>
                spec.tests
                  ?.filter(test => test.results?.[0]?.status === 'failed')
                  ?.map(test => ({
                    name: `${spec.title} > ${test.title}`,
                    error: test.results?.[0]?.error?.message || 'Unknown error',
                  }))
              )
            ) || [],
        };
      }

      // Fallback: parse text output
      return this.parseTextTestResults(output);
    } catch (error) {
      return this.parseTextTestResults(output);
    }
  }

  /**
   * Parse text-based test results (fallback)
   */
  parseTextTestResults(output) {
    const lines = output.split('\n');

    // Extract test counts from common patterns
    let tests = 0,
      passed = 0,
      failed = 0,
      skipped = 0;

    for (const line of lines) {
      const lower = line.toLowerCase();

      // Vitest patterns
      if (line.includes('Test Files') && line.includes('passed')) {
        const match = line.match(/(\d+)\s+passed/);
        if (match) passed += parseInt(match[1]);
      }
      if (line.includes('Tests') && line.includes('passed')) {
        const match = line.match(/Tests\s+(\d+)\s+passed/);
        if (match) tests = parseInt(match[1]);
      }
      if (lower.includes('failed')) {
        const match = line.match(/(\d+)\s+failed/);
        if (match) failed += parseInt(match[1]);
      }
      if (lower.includes('skipped') || lower.includes('pending')) {
        const match = line.match(/(\d+)\s+(?:skipped|pending)/);
        if (match) skipped += parseInt(match[1]);
      }

      // Jest patterns
      if (line.includes('Tests:') && line.includes('passed')) {
        const passMatch = line.match(/(\d+)\s+passed/);
        const failMatch = line.match(/(\d+)\s+failed/);
        const skipMatch = line.match(/(\d+)\s+skipped/);
        const totalMatch = line.match(/(\d+)\s+total/);

        if (passMatch) passed = parseInt(passMatch[1]);
        if (failMatch) failed = parseInt(failMatch[1]);
        if (skipMatch) skipped = parseInt(skipMatch[1]);
        if (totalMatch) tests = parseInt(totalMatch[1]);
      }
    }

    if (tests === 0) {
      tests = passed + failed + skipped;
    }

    return {
      tests,
      passed_tests: passed,
      failed_tests: failed,
      skipped_tests: skipped,
      failures: [],
    };
  }

  /**
   * Extract coverage metrics
   */
  extractCoverageMetrics(coverage) {
    return {
      statements: coverage.statements?.pct || 0,
      branches: coverage.branches?.pct || 0,
      functions: coverage.functions?.pct || 0,
      lines: coverage.lines?.pct || 0,
    };
  }

  /**
   * Calculate overall coverage from multiple suites
   */
  calculateOverallCoverage(unit, integration) {
    return {
      statements: Math.round(((unit.statements + integration.statements) / 2) * 100) / 100,
      branches: Math.round(((unit.branches + integration.branches) / 2) * 100) / 100,
      functions: Math.round(((unit.functions + integration.functions) / 2) * 100) / 100,
      lines: Math.round(((unit.lines + integration.lines) / 2) * 100) / 100,
    };
  }

  /**
   * Generate comprehensive PR comment
   */
  generatePRComment() {
    const sections = [];

    // Header
    sections.push(this.generateHeader());

    // Test results summary
    sections.push(this.generateTestResultsSummary());

    // Detailed test results
    if (this.hasTestResults()) {
      sections.push(this.generateDetailedTestResults());
    }

    // Coverage section
    if (this.testResults.coverage) {
      sections.push(this.generateCoverageSection());
    }

    // Performance section
    if (this.testResults.performance) {
      sections.push(this.generatePerformanceSection());
    }

    // Flaky tests section
    if (this.testResults.flaky && this.testResults.flaky.totalFlaky > 0) {
      sections.push(this.generateFlakyTestsSection());
    }

    // Footer
    sections.push(this.generateFooter());

    return sections.join('\n\n');
  }

  /**
   * Generate comment header
   */
  generateHeader() {
    const status = this.getOverallStatus();
    const emoji = status === 'passed' ? '✅' : status === 'failed' ? '❌' : '⚠️';

    return `# ${emoji} Test Results Report

**Branch**: \`${this.prData.branch}\`  
**Commit**: \`${this.prData.commit}\`  
**Author**: @${this.prData.author}  
**Generated**: ${new Date().toLocaleString()}`;
  }

  /**
   * Generate test results summary
   */
  generateTestResultsSummary() {
    const summary = [];
    summary.push('## 📊 Test Summary\n');

    const suites = ['unit', 'integration', 'e2e'].filter(suite => this.testResults[suite]);

    if (suites.length === 0) {
      summary.push('⚠️ No test results available\n');
      return summary.join('');
    }

    summary.push('| Test Suite | Status | Tests | Passed | Failed | Skipped | Duration |');
    summary.push('|------------|--------|-------|--------|--------|---------|----------|');

    for (const suite of suites) {
      const result = this.testResults[suite];
      const status = result.passed ? '✅' : '❌';
      const duration = this.formatDuration(result.duration);

      summary.push(
        `| ${result.suite} | ${status} | ${result.tests || 0} | ${result.passed_tests || 0} | ${result.failed_tests || 0} | ${result.skipped_tests || 0} | ${duration} |`
      );
    }

    // Overall statistics
    const totalTests = suites.reduce((sum, suite) => sum + (this.testResults[suite].tests || 0), 0);
    const totalPassed = suites.reduce(
      (sum, suite) => sum + (this.testResults[suite].passed_tests || 0),
      0
    );
    const totalFailed = suites.reduce(
      (sum, suite) => sum + (this.testResults[suite].failed_tests || 0),
      0
    );
    const totalSkipped = suites.reduce(
      (sum, suite) => sum + (this.testResults[suite].skipped_tests || 0),
      0
    );
    const totalDuration = suites.reduce(
      (sum, suite) => sum + (this.testResults[suite].duration || 0),
      0
    );

    summary.push('|------------|--------|-------|--------|--------|---------|----------|');
    summary.push(
      `| **Total** | ${totalFailed === 0 ? '✅' : '❌'} | **${totalTests}** | **${totalPassed}** | **${totalFailed}** | **${totalSkipped}** | **${this.formatDuration(totalDuration)}** |`
    );

    return summary.join('\n') + '\n';
  }

  /**
   * Generate detailed test results
   */
  generateDetailedTestResults() {
    const details = [];
    details.push('## 📝 Detailed Results\n');

    const suites = ['unit', 'integration', 'e2e'].filter(suite => this.testResults[suite]);

    for (const suite of suites) {
      const result = this.testResults[suite];

      if (result.failed_tests > 0 && result.failures && result.failures.length > 0) {
        details.push(`### ${result.suite} Failures\n`);

        for (const failure of result.failures.slice(0, 5)) {
          // Limit to 5 failures
          details.push('<details>');
          details.push(`<summary>❌ ${failure.name}</summary>\n`);
          details.push('```');
          details.push(failure.error);
          details.push('```\n');
          details.push('</details>\n');
        }

        if (result.failures.length > 5) {
          details.push(`*... and ${result.failures.length - 5} more failures*\n`);
        }
      }
    }

    return details.join('\n');
  }

  /**
   * Generate coverage section
   */
  generateCoverageSection() {
    const coverage = [];
    coverage.push('## 📊 Code Coverage\n');

    if (this.testResults.coverage.overall) {
      const overall = this.testResults.coverage.overall;

      coverage.push('### Overall Coverage\n');
      coverage.push('| Metric | Coverage | Status |');
      coverage.push('|--------|----------|---------|');

      const metrics = ['statements', 'branches', 'functions', 'lines'];
      for (const metric of metrics) {
        const value = overall[metric];
        const status = value >= 80 ? '✅' : value >= 70 ? '⚠️' : '❌';
        coverage.push(
          `| ${metric.charAt(0).toUpperCase() + metric.slice(1)} | ${value}% | ${status} |`
        );
      }

      coverage.push('');
    }

    if (this.testResults.coverage.unit || this.testResults.coverage.integration) {
      coverage.push('### Coverage by Test Suite\n');
      coverage.push('| Suite | Statements | Branches | Functions | Lines |');
      coverage.push('|-------|------------|----------|-----------|-------|');

      if (this.testResults.coverage.unit) {
        const unit = this.testResults.coverage.unit;
        coverage.push(
          `| Unit Tests | ${unit.statements}% | ${unit.branches}% | ${unit.functions}% | ${unit.lines}% |`
        );
      }

      if (this.testResults.coverage.integration) {
        const integration = this.testResults.coverage.integration;
        coverage.push(
          `| Integration Tests | ${integration.statements}% | ${integration.branches}% | ${integration.functions}% | ${integration.lines}% |`
        );
      }

      coverage.push('');
    }

    return coverage.join('\n');
  }

  /**
   * Generate performance section
   */
  generatePerformanceSection() {
    const performance = [];
    performance.push('## ⚡ Performance\n');

    const perf = this.testResults.performance;

    performance.push(`**Total Test Duration**: ${this.formatDuration(perf.totalDuration)}\n`);

    if (perf.suitePerformance && Object.keys(perf.suitePerformance).length > 0) {
      performance.push('### Suite Performance\n');
      performance.push('| Suite | Duration | Tests/sec | Status |');
      performance.push('|-------|----------|-----------|---------|');

      for (const [suite, data] of Object.entries(perf.suitePerformance)) {
        const testsPerSec = data.tests > 0 ? (data.tests / (data.duration / 1000)).toFixed(1) : '0';
        const status = data.duration < 60000 ? '✅' : data.duration < 180000 ? '⚠️' : '❌';
        performance.push(
          `| ${suite} | ${this.formatDuration(data.duration)} | ${testsPerSec} | ${status} |`
        );
      }

      performance.push('');
    }

    if (perf.alerts && perf.alerts.length > 0) {
      performance.push('### Performance Alerts\n');
      for (const alert of perf.alerts) {
        performance.push(`⚠️ ${alert}`);
      }
      performance.push('');
    }

    return performance.join('\n');
  }

  /**
   * Generate flaky tests section
   */
  generateFlakyTestsSection() {
    const flaky = [];
    flaky.push('## 🔄 Flaky Tests\n');

    const flakyData = this.testResults.flaky;

    flaky.push(`**Total Flaky Tests**: ${flakyData.totalFlaky}`);
    flaky.push(`**New Flaky Tests**: ${flakyData.newFlaky}`);
    flaky.push(`**Fixed Flaky Tests**: ${flakyData.fixedFlaky}\n`);

    if (flakyData.flakyTests && flakyData.flakyTests.length > 0) {
      flaky.push('### Current Flaky Tests\n');

      for (const test of flakyData.flakyTests.slice(0, 10)) {
        // Limit to 10
        const score = (test.flakyScore * 100).toFixed(1);
        flaky.push(`- **${test.testName}** (Flaky Score: ${score}%)`);
        flaky.push(`  - Success Rate: ${test.successRate}%`);
        flaky.push(`  - Total Runs: ${test.totalRuns}`);
      }

      if (flakyData.flakyTests.length > 10) {
        flaky.push(`\n*... and ${flakyData.flakyTests.length - 10} more flaky tests*`);
      }

      flaky.push('');
    }

    return flaky.join('\n');
  }

  /**
   * Generate comment footer
   */
  generateFooter() {
    return `---
*This comment was automatically generated by PR Comment Bot* 🤖  
*See the [full CI results](${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY || 'owner/repo'}/actions/runs/${process.env.GITHUB_RUN_ID || '0'}) for more details*`;
  }

  /**
   * Get overall test status
   */
  getOverallStatus() {
    const suites = ['unit', 'integration', 'e2e'].filter(suite => this.testResults[suite]);

    if (suites.length === 0) {
      return 'unknown';
    }

    const allPassed = suites.every(suite => this.testResults[suite].passed);
    const anyFailed = suites.some(suite => !this.testResults[suite].passed);

    if (allPassed) {
      return 'passed';
    } else if (anyFailed) {
      return 'failed';
    } else {
      return 'mixed';
    }
  }

  /**
   * Check if we have any test results
   */
  hasTestResults() {
    return ['unit', 'integration', 'e2e'].some(suite => this.testResults[suite]);
  }

  /**
   * Format duration in milliseconds to human readable format
   */
  formatDuration(ms) {
    if (!ms) return '0s';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);

    if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Save comment to file
   */
  async saveComment(comment) {
    const commentPath = path.join(this.options.outputDir, 'pr-comment.md');
    await fs.writeFile(commentPath, comment);
    console.log(`💾 PR comment saved to ${commentPath}`);
  }

  /**
   * Save comment data as JSON
   */
  async saveCommentData() {
    const data = {
      prData: this.prData,
      testResults: this.testResults,
      timestamp: new Date().toISOString(),
      overallStatus: this.getOverallStatus(),
    };

    const dataPath = path.join(this.options.outputDir, 'pr-comment-data.json');
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
    console.log(`💾 PR comment data saved to ${dataPath}`);
  }
}

// CLI functionality
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'generate';

  const bot = new PRCommentBot({
    outputDir: process.env.PR_COMMENT_OUTPUT_DIR || './reports/pr-comments',
  });

  try {
    await bot.initialize();

    switch (command) {
      case 'generate':
        console.log('🤖 Generating PR comment...');
        await bot.collectTestResults();
        const comment = bot.generatePRComment();
        await bot.saveComment(comment);
        await bot.saveCommentData();
        console.log('✅ PR comment generated successfully');
        break;

      case 'collect':
        console.log('📊 Collecting test results only...');
        await bot.collectTestResults();
        await bot.saveCommentData();
        console.log('✅ Test results collected');
        break;

      case 'comment':
        console.log('💬 Generating comment only...');
        const commentText = bot.generatePRComment();
        await bot.saveComment(commentText);
        console.log('✅ Comment generated');
        break;

      default:
        console.log('Usage: node pr-comment-bot.js [generate|collect|comment]');
        console.log('  generate - Collect results and generate comment (default)');
        console.log('  collect  - Collect test results only');
        console.log('  comment  - Generate comment from existing data');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ PR Comment Bot failed:', error);
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = PRCommentBot;

// Run CLI if called directly
if (require.main === module) {
  main();
}

/**
 * Jest Retry Reporter
 *
 * Custom Jest reporter that tracks retry attempts and flaky test behavior.
 * Generates detailed reports about test retries and failures.
 */

const fs = require('fs');
const path = require('path');

class RetryReporter {
  constructor(globalConfig, options = {}) {
    this.globalConfig = globalConfig;
    this.options = options;
    this.outputFile = options.outputFile || 'reports/test-retries.json';
    this.retryData = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: 0,
        retriedTests: 0,
        successfulRetries: 0,
        failedRetries: 0,
        totalRetryAttempts: 0,
      },
      tests: [],
      flakyTests: [],
    };
  }

  onRunStart() {
    console.log('🔄 Jest Retry Reporter: Starting test run with retry tracking');
  }

  onTestResult(test, testResult) {
    this.retryData.summary.totalTests += testResult.numPassingTests + testResult.numFailingTests;

    // Process each test case for retry information
    testResult.testResults.forEach(result => {
      const testName = result.fullName || result.title;
      const retryAttempts = global.retryAttempts?.get(testName) || 0;
      const flakyData = global.flakyTestData?.get(testName);

      if (retryAttempts > 0 || flakyData) {
        this.retryData.summary.retriedTests++;
        this.retryData.summary.totalRetryAttempts += retryAttempts;

        const testData = {
          name: testName,
          filePath: test.path,
          status: result.status,
          retryAttempts: retryAttempts,
          duration: result.duration || 0,
          succeeded: result.status === 'passed',
          isFlakyTest: flakyData?.isFlakyTest || false,
          lastError: flakyData?.lastError || result.failureMessages?.[0],
          timestamp: new Date().toISOString(),
        };

        this.retryData.tests.push(testData);

        if (testData.succeeded && retryAttempts > 0) {
          this.retryData.summary.successfulRetries++;
        } else if (!testData.succeeded && retryAttempts > 0) {
          this.retryData.summary.failedRetries++;
        }

        // Track tests that show flaky behavior
        if (flakyData?.isFlakyTest || (retryAttempts > 0 && testData.succeeded)) {
          this.retryData.flakyTests.push({
            ...testData,
            flakyScore: this.calculateFlakyScore(testData),
            recommendation: this.getRecommendation(testData),
          });
        }
      }
    });
  }

  onRunComplete() {
    this.generateReport();
    this.logSummary();
  }

  calculateFlakyScore(testData) {
    // Simple flaky score calculation based on retry behavior
    const baseScore = testData.retryAttempts / 10; // Higher retries = higher score
    const successModifier = testData.succeeded ? 0.5 : 1.0; // Failed tests get higher score
    const durationModifier = testData.duration > 5000 ? 1.2 : 1.0; // Slow tests more likely flaky

    return Math.min(baseScore * successModifier * durationModifier, 1.0);
  }

  getRecommendation(testData) {
    if (testData.retryAttempts >= 3) {
      return 'High priority: Investigate test stability and dependencies';
    } else if (testData.retryAttempts >= 2) {
      return 'Medium priority: Review test for timing issues';
    } else if (testData.duration > 10000) {
      return 'Consider optimizing test performance';
    }
    return 'Monitor for patterns';
  }

  generateReport() {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(this.outputFile);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Calculate additional statistics
      this.retryData.summary.retrySuccessRate =
        this.retryData.summary.retriedTests > 0
          ? (
              (this.retryData.summary.successfulRetries / this.retryData.summary.retriedTests) *
              100
            ).toFixed(2)
          : 0;

      this.retryData.summary.averageRetryAttempts =
        this.retryData.summary.retriedTests > 0
          ? (
              this.retryData.summary.totalRetryAttempts / this.retryData.summary.retriedTests
            ).toFixed(2)
          : 0;

      // Write the report
      fs.writeFileSync(this.outputFile, JSON.stringify(this.retryData, null, 2));

      console.log(`📊 Retry report generated: ${this.outputFile}`);
    } catch (error) {
      console.error('❌ Failed to generate retry report:', error);
    }
  }

  logSummary() {
    const { summary } = this.retryData;

    console.log('\n🔄 Test Retry Summary:');
    console.log(`   Total Tests: ${summary.totalTests}`);
    console.log(`   Tests with Retries: ${summary.retriedTests}`);
    console.log(`   Successful Retries: ${summary.successfulRetries}`);
    console.log(`   Failed Retries: ${summary.failedRetries}`);
    console.log(`   Total Retry Attempts: ${summary.totalRetryAttempts}`);
    console.log(`   Retry Success Rate: ${summary.retrySuccessRate}%`);
    console.log(`   Average Retry Attempts: ${summary.averageRetryAttempts}`);

    if (this.retryData.flakyTests.length > 0) {
      console.log(`\n🚨 Flaky Tests Detected: ${this.retryData.flakyTests.length}`);
      this.retryData.flakyTests.slice(0, 3).forEach(test => {
        console.log(
          `   • ${test.name} (${test.retryAttempts} retries, score: ${test.flakyScore.toFixed(3)})`
        );
      });
    }
  }
}

module.exports = RetryReporter;

# Flaky Test Tracking Documentation

## Overview

This project implements comprehensive flaky test detection, tracking, and automatic retry capabilities across all test suites (unit, integration, and E2E tests). The system automatically identifies unreliable tests, tracks their behavior over time, and provides actionable insights for improving test stability.

## Architecture

### Core Components

1. **Flaky Test Tracker** (`scripts/flaky-test-tracker.js`)
   - Main detection and analysis engine
   - Tracks test results across multiple runs
   - Generates comprehensive reports and dashboards
   - Calculates flaky scores and trends

2. **Auto-Retry Configurations**
   - `jest.retry.config.js` - Jest retry configuration
   - `vitest.retry.config.ts` - Vitest retry configuration
   - `playwright.retry.config.ts` - Playwright retry configuration

3. **GitHub Actions Workflow** (`.github/workflows/flaky-test-detection.yml`)
   - Automated daily and weekly flaky test detection
   - CI/CD integration for continuous monitoring
   - Automatic issue creation for high-severity flaky tests

4. **Retry Setup Files**
   - `tests/setup/retrySetup.js` - Jest retry logic
   - `tests/setup/vitestRetrySetup.ts` - Vitest retry logic
   - Custom reporters for tracking retry attempts

## Features

### 🔍 Flaky Test Detection

#### Intelligent Detection Algorithm
- **Flaky Score Calculation**: Measures test inconsistency (0.0 = consistent, 1.0 = maximum flakiness)
- **Pattern Recognition**: Identifies tests that sometimes pass, sometimes fail
- **Threshold-Based Classification**: Configurable threshold for flaky test identification
- **Historical Analysis**: Tracks test behavior over multiple runs

#### Severity Classification
- **High Severity (≥0.4)**: Highly unreliable, immediate attention needed
- **Medium Severity (0.2-0.4)**: Moderately unreliable, should be investigated
- **Low Severity (0.1-0.2)**: Slightly unreliable, monitor for trends

### 📊 Comprehensive Reporting

#### HTML Dashboard
- Interactive visual dashboard with test stability metrics
- Flaky test trends and patterns
- Severity-based categorization
- Actionable recommendations

#### JSON Reports
- Machine-readable test data for CI/CD integration
- Historical trend analysis
- Detailed test run information
- Performance metrics

#### Summary Reports
- Markdown format for easy sharing
- Executive summaries
- Top flaky tests with priority rankings
- Improvement recommendations

### 🔄 Automatic Retry System

#### Intelligent Retry Logic
- **Dynamic Retry Counts**: Based on test history and severity
- **Progressive Delays**: Exponential backoff between retries
- **Context-Aware**: Different retry strategies per test framework
- **Resource Optimization**: Balances reliability with CI performance

#### Framework Integration
- **Jest**: Custom retry wrapper with detailed tracking
- **Vitest**: TypeScript-enabled retry system
- **Playwright**: Browser-specific retry configurations
- **Cross-Framework**: Consistent retry behavior across all test types

### 🚨 Alerting and Monitoring

#### GitHub Integration
- **Automatic Issues**: Creates GitHub issues for high-severity flaky tests
- **Weekly Updates**: Regular updates on flaky test status
- **PR Comments**: Contextual information about test changes
- **Workflow Integration**: Seamless CI/CD pipeline integration

#### Alert Thresholds
- **Critical**: >5% flaky test percentage
- **High**: Tests with >70% flaky score
- **Medium**: Tests with 40-70% flaky score
- **Trending**: Increasing flaky test count over time

## Usage

### Command Line Interface

#### Basic Commands
```bash
# Track flaky tests across all suites
npm run flaky:track

# Track specific test suite
npm run flaky:track:unit
npm run flaky:track:integration
npm run flaky:track:e2e

# Generate analysis and reports
npm run flaky:analyze
npm run flaky:report

# Generate retry configuration
npm run flaky:config
```

#### Advanced Usage
```bash
# Custom tracking with options
FLAKY_THRESHOLD=0.15 FLAKY_RETRY_COUNT=5 npm run flaky:track

# Generate reports only
node scripts/flaky-test-tracker.js report

# Analyze existing data
node scripts/flaky-test-tracker.js analyze
```

### Configuration

#### Environment Variables
```bash
# Flaky test detection threshold (default: 0.1 = 10%)
FLAKY_THRESHOLD=0.1

# Number of retry attempts for failed tests (default: 3)
FLAKY_RETRY_COUNT=3

# Number of historical runs to keep (default: 50)
FLAKY_HISTORY_LENGTH=50

# Output directory for reports (default: ./reports/flaky-tests)
FLAKY_OUTPUT_DIR=./reports/flaky-tests

# Enable automatic retries for known flaky tests
AUTO_RETRY_FLAKY_TESTS=true

# Enable test retries (default: true)
ENABLE_TEST_RETRIES=true
```

#### Framework-Specific Configuration

##### Jest Configuration
```javascript
// Use retry configuration
module.exports = require('./jest.retry.config.js');

// Or extend base config
const baseConfig = require('./jest.config.js');
module.exports = {
  ...baseConfig,
  setupFilesAfterEnv: [
    ...baseConfig.setupFilesAfterEnv,
    '<rootDir>/tests/setup/retrySetup.js'
  ]
};
```

##### Vitest Configuration
```typescript
// Use retry configuration
import retryConfig from './vitest.retry.config';
export default retryConfig;

// Or import utilities
import { testWithRetry, describeWithRetry } from './tests/setup/vitestRetrySetup';

describeWithRetry('My Component', () => {
  testWithRetry('should work reliably', async () => {
    // Test implementation
  }, { retries: 3 });
});
```

##### Playwright Configuration
```typescript
// Use retry configuration
import retryConfig from './playwright.retry.config';
export default retryConfig;

// Or configure per-test retries
test.describe('My E2E Tests', () => {
  test('should retry on failure', async ({ page }) => {
    // Test implementation
  });
});
```

### CI/CD Integration

#### GitHub Actions
The flaky test detection workflow runs automatically:
- **Daily**: 2:00 AM UTC for continuous monitoring
- **Weekly**: Monday 2:00 PM UTC for comprehensive analysis
- **Post-CI**: After main CI pipeline completion
- **Manual**: On-demand via workflow dispatch

#### Workflow Triggers
```yaml
# Manual trigger with options
workflow_dispatch:
  inputs:
    test_suite:
      description: 'Test suite to analyze'
      required: true
      default: 'all'
      type: choice
      options: ['all', 'unit', 'integration', 'e2e']
```

#### Artifact Management
- **Reports**: 30-day retention for analysis reports
- **History**: 90-day retention for historical data
- **Configuration**: 90-day retention for retry configs
- **Dashboards**: 30-day retention for HTML dashboards

## Best Practices

### Writing Stable Tests

#### Test Design Principles
1. **Isolation**: Tests should not depend on other tests
2. **Deterministic**: Same input should always produce same output
3. **Fast**: Minimize test execution time to reduce flakiness
4. **Resilient**: Handle timing variations and external dependencies

#### Common Flaky Test Patterns
```javascript
// ❌ Bad: Race condition
test('should update counter', async () => {
  fireEvent.click(button);
  expect(counter).toBe(1); // May fail due to timing
});

// ✅ Good: Proper waiting
test('should update counter', async () => {
  fireEvent.click(button);
  await waitFor(() => expect(counter).toBe(1));
});

// ❌ Bad: Shared state
let sharedVariable = 0;
test('test 1', () => {
  sharedVariable = 1;
  expect(sharedVariable).toBe(1);
});

// ✅ Good: Isolated state
test('test 1', () => {
  const localVariable = 1;
  expect(localVariable).toBe(1);
});
```

### Managing Flaky Tests

#### Investigation Process
1. **Reproduce Locally**: Run the test multiple times
2. **Analyze Patterns**: Check failure frequency and conditions
3. **Review Dependencies**: Identify external factors
4. **Check Timing**: Look for race conditions
5. **Verify Environment**: Ensure consistent test environment

#### Remediation Strategies
1. **Add Waits**: Use proper async/await patterns
2. **Improve Selectors**: Use stable, unique selectors
3. **Mock Dependencies**: Reduce external factor variability
4. **Increase Timeouts**: Allow for slower environments
5. **Add Retries**: As a temporary measure while fixing root cause

### Monitoring and Maintenance

#### Regular Reviews
- **Weekly**: Review flaky test reports and trends
- **Monthly**: Analyze patterns and implement improvements
- **Quarterly**: Review retry configurations and thresholds
- **Annually**: Assess overall test stability strategy

#### Key Metrics to Track
- **Flaky Test Percentage**: Should be <1% for stable suites
- **Retry Success Rate**: Should be >90% for configured retries
- **Test Duration Trends**: Monitor for performance degradation
- **Failure Pattern Analysis**: Identify systemic issues

## Troubleshooting

### Common Issues

#### High Flaky Test Count
```bash
# Symptoms: >5% of tests marked as flaky
# Investigation:
npm run flaky:analyze
npm run flaky:report

# Solutions:
# 1. Review test infrastructure
# 2. Check for shared state issues
# 3. Improve test isolation
# 4. Add proper wait conditions
```

#### Retry Configuration Not Working
```bash
# Check configuration file exists
ls reports/flaky-tests/retry-config.json

# Verify environment variables
echo $AUTO_RETRY_FLAKY_TESTS
echo $ENABLE_TEST_RETRIES

# Regenerate configuration
npm run flaky:config
```

#### Reports Not Generated
```bash
# Check output directory permissions
ls -la reports/flaky-tests/

# Verify test history exists
cat reports/flaky-tests/history.json

# Run with debug output
DEBUG=flaky-tracker npm run flaky:track
```

### Debug Commands

#### Verbose Analysis
```bash
# Run with detailed logging
node scripts/flaky-test-tracker.js track all --verbose

# Generate debug report
node scripts/flaky-test-tracker.js analyze --debug

# Check retry configuration
node scripts/flaky-test-tracker.js config --validate
```

#### Manual Test Execution
```bash
# Run specific test multiple times
for i in {1..10}; do npm test -- specific-test.test.js; done

# Run with retry configuration
JEST_CONFIG=jest.retry.config.js npm test

# Run with custom retry count
FLAKY_RETRY_COUNT=5 npm test
```

## API Reference

### Flaky Test Tracker

#### Main Methods
```javascript
const FlakyTestTracker = require('./scripts/flaky-test-tracker');

const tracker = new FlakyTestTracker({
  outputDir: './reports/flaky-tests',
  retryCount: 3,
  threshold: 0.1,
  historyLength: 50
});

// Initialize tracker
await tracker.initialize();

// Run tests with tracking
const results = await tracker.runTestsWithTracking('all');

// Analyze results
const analysis = await tracker.analyzeResults();

// Generate reports
await tracker.generateReports();
```

#### Configuration Options
```javascript
{
  outputDir: string,        // Output directory for reports
  retryCount: number,       // Number of retry attempts
  threshold: number,        // Flaky test threshold (0.0-1.0)
  historyLength: number,    // Number of runs to keep in history
}
```

### Retry Utilities

#### Jest Utilities
```javascript
const { testWithRetry, isFlakyTest } = require('./tests/setup/retrySetup');

// Manual retry test
testWithRetry('my test', async () => {
  // Test implementation
}, 10000); // 10 second timeout

// Check if test is flaky
if (isFlakyTest('my test', 'unit')) {
  // Handle flaky test
}
```

#### Vitest Utilities
```typescript
import { testWithRetry, describeWithRetry } from './tests/setup/vitestRetrySetup';

// Retry test with options
testWithRetry('my test', async () => {
  // Test implementation
}, { timeout: 10000, retries: 3 });

// Retry describe block
describeWithRetry('my suite', () => {
  // Test suite
}, { retries: 2 });
```

## Integration Examples

### Custom Reporter Integration
```javascript
// Custom Jest reporter
class CustomReporter extends RetryReporter {
  onTestResult(test, testResult) {
    super.onTestResult(test, testResult);
    
    // Custom logic for retry tracking
    if (this.retryData.flakyTests.length > 0) {
      this.sendSlackAlert(this.retryData.flakyTests);
    }
  }
}
```

### CI/CD Pipeline Integration
```yaml
# Custom workflow step
- name: Check Flaky Tests
  run: |
    npm run flaky:track
    FLAKY_COUNT=$(jq '.summary.flakyCount' reports/flaky-tests/flaky-tests-report.json)
    if [ "$FLAKY_COUNT" -gt 5 ]; then
      echo "Too many flaky tests detected: $FLAKY_COUNT"
      exit 1
    fi
```

### Monitoring Integration
```javascript
// Custom monitoring hook
const tracker = new FlakyTestTracker();
tracker.on('flakyTestDetected', (test) => {
  // Send to monitoring system
  metrics.increment('flaky_tests.detected', {
    suite: test.suite,
    severity: test.severity
  });
});
```

## Related Documentation

- [Test Infrastructure Overview](./TESTING.md)
- [CI/CD Pipeline Documentation](./CI_CD.md)
- [Performance Testing](./PERFORMANCE_TESTING.md)
- [Test Best Practices](./TEST_BEST_PRACTICES.md)

## External Resources

- [Flaky Test Best Practices](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)
- [Jest Retry Documentation](https://jestjs.io/docs/jest-object#jestretrytimes-numretries)
- [Playwright Test Retries](https://playwright.dev/docs/test-retries)
- [Test Stability Patterns](https://martinfowler.com/articles/nonDeterminism.html)
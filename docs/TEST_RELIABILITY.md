# Test Reliability System

This document describes the comprehensive test reliability tracking and monitoring system implemented for the Running App MVP.

## Overview

The test reliability system ensures we maintain high-quality, stable tests by:

- **Tracking pass rates** across all test suites
- **Detecting flaky tests** that fail intermittently
- **Monitoring trends** in test performance and stability
- **Alerting** when reliability thresholds are not met
- **Generating reports** for visibility and accountability

## Success Criteria

Our test reliability targets are:

- **100% pass rate**: All tests should pass consistently
- **<1% flaky tests**: Less than 1% of tests should exhibit flaky behavior

## System Components

### 1. Test Reliability Tracker (`scripts/test-reliability-tracker.ts`)

The core component that:

- Runs all test suites and collects results
- Analyzes historical data to identify patterns
- Detects flaky tests based on failure rates
- Generates comprehensive reports
- Provides CLI interface for manual analysis

#### Usage

```bash
# Track overall test reliability
npm run test:reliability:track

# Detect flaky behavior in specific tests
npm run test:reliability:flaky "test pattern" 10

# Generate HTML report
npm run test:reliability:report
```

### 2. Automated Monitoring (`.github/workflows/test-reliability.yml`)

GitHub Actions workflow that:

- **Runs automatically** on every push and PR
- **Daily scheduled runs** for continuous monitoring
- **Comments on PRs** with reliability metrics
- **Creates issues** when thresholds are not met
- **Archives reports** as workflow artifacts

#### Triggers

- Push to main/develop branches
- Pull requests
- Daily at 6 AM UTC
- Manual workflow dispatch

### 3. Data Storage

Reliability data is stored in:

```
test-data/reliability/
├── metrics.json          # Current reliability metrics
├── reliability-report.html # Latest HTML report
└── runs/                 # Historical test run data
    ├── run-1234567890.json
    └── run-1234567891.json
```

## How It Works

### 1. Data Collection

The system runs all test suites and collects:

- **Test results**: Pass/fail status for each test
- **Execution times**: Duration of individual tests and suites
- **Error details**: Failure messages and stack traces
- **Environment info**: Node version, Git commit, branch
- **Timestamps**: When tests were executed

### 2. Flaky Test Detection

A test is considered flaky if:

- It has failed at least once in recent runs
- Failure rate is > 1% over minimum 5 runs
- It shows inconsistent behavior (passes and fails)

Algorithm:
```typescript
flakyRate = failures / totalRuns
isFlaky = flakyRate > 0.01 && totalRuns >= 5
```

### 3. Metrics Calculation

Key metrics calculated:

- **Overall Pass Rate**: `totalPassed / totalTests`
- **Flaky Test Rate**: `flakyTests.length / totalTests`
- **Average Duration**: Mean execution time across runs
- **Duration Trend**: Improving/stable/degrading based on recent history

### 4. Reporting

Reports include:

- **Summary metrics** with visual indicators
- **Flaky test details** with failure patterns
- **Trend analysis** showing historical performance
- **Success criteria status** against targets

## Usage Guide

### For Developers

#### Check Test Reliability

```bash
# Quick reliability check
npm run test:reliability:track

# Check for flaky tests in your changes
npm run test:reliability:flaky "MyComponent" 20
```

#### Investigate Failures

1. **Review the HTML report**:
   ```bash
   npm run test:reliability:report
   open test-data/reliability/reliability-report.html
   ```

2. **Check specific test patterns**:
   ```bash
   # Run a test multiple times to confirm flakiness
   npm run test:reliability:flaky "should handle async operations" 15
   ```

3. **Analyze historical data**:
   - Check `test-data/reliability/runs/` for past results
   - Look for patterns in failure messages
   - Compare against recent code changes

#### Fix Flaky Tests

Common causes and solutions:

1. **Timing Issues**:
   ```typescript
   // Bad: Fixed delays
   await new Promise(resolve => setTimeout(resolve, 1000));
   
   // Good: Wait for conditions
   await waitFor(() => expect(element).toBeInTheDocument());
   ```

2. **Test Isolation**:
   ```typescript
   // Ensure clean state between tests
   beforeEach(async () => {
     await cleanupDatabase();
     jest.clearAllMocks();
   });
   ```

3. **Async Operations**:
   ```typescript
   // Bad: Not waiting for async operations
   component.click();
   expect(result).toBe(expected);
   
   // Good: Properly await async operations
   await component.click();
   await waitFor(() => expect(result).toBe(expected));
   ```

### For CI/CD

#### Workflow Integration

The reliability tracking is integrated into CI/CD:

1. **PR Checks**: Every PR gets reliability metrics in comments
2. **Main Branch**: Reliability is tracked on main branch pushes
3. **Daily Monitoring**: Scheduled runs detect degradation
4. **Issue Creation**: Automatic issues for reliability problems

#### Viewing Results

1. **Workflow artifacts**: Download reliability reports from GitHub Actions
2. **PR comments**: See metrics directly in pull request discussions
3. **Issues**: Automatic issues highlight problems requiring attention

## Configuration

### Reliability Thresholds

Modify thresholds in the workflow file:

```yaml
# .github/workflows/test-reliability.yml
- name: Check reliability thresholds
  run: |
    # Update these values to change thresholds
    const passRateOk = passRate >= 100;  # 100% pass rate
    const flakyRateOk = flakyRate <= 1;  # <1% flaky tests
```

### Flaky Test Detection

Adjust flaky test detection sensitivity:

```typescript
// scripts/test-reliability-tracker.ts
// Change these values to adjust sensitivity
const FLAKY_RATE_THRESHOLD = 0.01;  // 1%
const MINIMUM_RUNS = 5;              // Min runs to consider
```

### Reporting Frequency

Modify the schedule in the workflow:

```yaml
# .github/workflows/test-reliability.yml
schedule:
  # Run daily at 6 AM UTC (change as needed)
  - cron: '0 6 * * *'
```

## Troubleshooting

### Common Issues

#### No Data Available

```bash
Error: No metrics data available. Run trackReliability() first.
```

**Solution**: Run the tracker first:
```bash
npm run test:reliability:track
```

#### High Flaky Test Rate

**Symptoms**:
- Many tests marked as flaky
- Inconsistent CI results
- Developer frustration

**Solutions**:
1. **Identify root causes**: Check error patterns in flaky tests
2. **Improve test isolation**: Ensure tests don't affect each other
3. **Add proper waits**: Replace fixed timeouts with condition waits
4. **Review test data**: Ensure consistent test data setup

#### Performance Degradation

**Symptoms**:
- Increasing test execution times
- Timeout failures
- Resource exhaustion

**Solutions**:
1. **Profile slow tests**: Use performance tracking
2. **Optimize database operations**: Use transactions, reduce queries
3. **Parallel execution**: Ensure tests can run in parallel safely
4. **Resource cleanup**: Properly clean up after tests

### Debug Mode

Enable debug output:

```bash
# Run with verbose output
DEBUG=test-reliability npm run test:reliability:track

# Check individual test runs
ls -la test-data/reliability/runs/
cat test-data/reliability/runs/run-latest.json
```

## Best Practices

### Writing Reliable Tests

1. **Make tests atomic**: Each test should be independent
2. **Use proper assertions**: Wait for conditions, don't guess
3. **Clean up resources**: Always clean up after tests
4. **Mock external dependencies**: Don't rely on external services
5. **Use meaningful test data**: Avoid hardcoded magic values

### Monitoring Reliability

1. **Review reports regularly**: Check weekly reliability reports
2. **Address flaky tests immediately**: Don't let them accumulate
3. **Monitor trends**: Watch for degrading performance
4. **Set up alerts**: Use reliability tracking for early warning

### Team Workflow

1. **PR responsibility**: Fix reliability issues in your PRs
2. **Daily review**: Check reliability status in standups
3. **Sprint planning**: Include reliability improvements in sprints
4. **Knowledge sharing**: Share flaky test solutions with team

## Metrics Reference

### Pass Rate Calculation

```
Pass Rate = (Total Passed Tests) / (Total Tests) × 100%

Target: 100%
Warning: <95%
Critical: <90%
```

### Flaky Rate Calculation

```
Flaky Rate = (Number of Flaky Tests) / (Total Tests) × 100%

Target: <1%
Warning: 1-5%
Critical: >5%
```

### Duration Trend

```
Recent Average = Average duration of last 5 runs
Historical Average = Average duration of previous 5 runs

Trend = (Recent - Historical) / Historical × 100%

Improving: <-10%
Stable: -10% to +10%
Degrading: >+10%
```

## API Reference

### TestReliabilityTracker Class

```typescript
class TestReliabilityTracker {
  // Track overall test reliability
  async trackReliability(): Promise<ReliabilityMetrics>
  
  // Detect flakiness in specific tests
  async detectFlakiness(testPattern: string, runs: number): Promise<FlakyTest[]>
  
  // Generate HTML report
  async generateHtmlReport(): Promise<string>
}
```

### Data Types

```typescript
interface ReliabilityMetrics {
  overallPassRate: number;      // 0-1, overall test pass rate
  flakyTestRate: number;        // 0-1, rate of flaky tests
  totalTests: number;           // Total number of tests
  flakyTests: FlakyTest[];      // List of detected flaky tests
  trends: {
    passRateHistory: Array<{ date: Date; passRate: number }>;
    avgDuration: number;        // Average test duration in ms
    durationTrend: 'improving' | 'stable' | 'degrading';
  };
  lastUpdated: Date;
}

interface FlakyTest {
  name: string;                 // Test name
  fullName: string;             // Full test path
  file: string;                 // Test file location
  totalRuns: number;            // Total executions tracked
  failures: number;             // Number of failures
  flakyRate: number;            // Failure rate (0-1)
  lastFailure: Date;            // When last failure occurred
  errorPatterns: string[];      // Common error messages
}
```

## Integration Examples

### Custom Reliability Checks

```typescript
// Custom reliability validation
import { TestReliabilityTracker } from './scripts/test-reliability-tracker';

const tracker = new TestReliabilityTracker();

// Run custom reliability check
const metrics = await tracker.trackReliability();

if (metrics.overallPassRate < 1.0) {
  console.error('❌ Pass rate below 100%');
  process.exit(1);
}

if (metrics.flakyTestRate > 0.01) {
  console.error('❌ Too many flaky tests');
  process.exit(1);
}

console.log('✅ All reliability checks passed');
```

### Pre-deployment Validation

```bash
#!/bin/bash
# pre-deploy.sh

echo "🔍 Checking test reliability before deployment..."

# Run reliability tracking
npm run test:reliability:track

# Check if metrics meet requirements
node -e "
  const fs = require('fs');
  const metrics = JSON.parse(fs.readFileSync('test-data/reliability/metrics.json'));
  
  if (metrics.overallPassRate < 1.0 || metrics.flakyTestRate > 0.01) {
    console.error('❌ Reliability requirements not met');
    process.exit(1);
  }
  
  console.log('✅ Reliability requirements satisfied');
"

echo "🚀 Ready for deployment"
```

## Conclusion

The test reliability system provides comprehensive monitoring and alerting to ensure our test suite remains stable and trustworthy. By maintaining 100% pass rates and minimizing flaky tests, we can have confidence in our CI/CD pipeline and development workflow.

Regular monitoring and proactive fixes ensure that our test suite continues to provide value and doesn't become a bottleneck in our development process.
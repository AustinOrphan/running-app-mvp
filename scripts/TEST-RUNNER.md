# Test Runner Documentation

## Overview

The test runner (`scripts/test-runner.js`) is a comprehensive test execution and validation tool that can run all test suites in the Running App MVP project and provide detailed reporting.

## Features

- **Complete Test Suite Execution**: Runs unit, integration, E2E, accessibility, visual regression, performance, and memory tests
- **Parallel Execution**: Can run multiple test suites in parallel for faster results
- **Multiple Reporters**: Console, JSON, and HTML report generation
- **Coverage Analysis**: Aggregates coverage data from all test suites
- **CI/CD Integration**: Special CI mode with strict thresholds and exit codes
- **Progress Monitoring**: Real-time test execution status with colored output
- **Error Analysis**: Detailed error reporting and recommendations
- **Quality Gates**: Configurable thresholds for coverage, performance, and memory

## Installation

The test runner uses existing project dependencies. No additional installation required.

## Usage

### Basic Command

```bash
# Run all tests
node scripts/test-runner.js

# Or with npm script (add to package.json)
npm run test:runner
```

### Command Line Options

<<<<<<< Updated upstream
| Option       | Short | Description                                                                        | Default      |
| ------------ | ----- | ---------------------------------------------------------------------------------- | ------------ |
| `--suite`    | `-s`  | Test suite to run (unit, integration, e2e, a11y, visual, performance, memory, all) | all          |
| `--parallel` | `-p`  | Run tests in parallel where possible                                               | false        |
| `--reporter` | `-r`  | Reporter type (console, json, html, all)                                           | console      |
| `--output`   | `-o`  | Output directory for reports                                                       | test-reports |
| `--ci`       |       | Run in CI mode                                                                     | false        |
| `--verbose`  | `-v`  | Verbose output                                                                     | false        |
| `--bail`     | `-b`  | Stop on first test failure                                                         | false        |
| `--watch`    | `-w`  | Run in watch mode (where supported)                                                | false        |
| `--help`     | `-h`  | Show help message                                                                  |              |
=======
| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--suite` | `-s` | Test suite to run (unit, integration, e2e, a11y, visual, performance, memory, all) | all |
| `--parallel` | `-p` | Run tests in parallel where possible | false |
| `--reporter` | `-r` | Reporter type (console, json, html, all) | console |
| `--output` | `-o` | Output directory for reports | test-reports |
| `--ci` | | Run in CI mode | false |
| `--verbose` | `-v` | Verbose output | false |
| `--bail` | `-b` | Stop on first test failure | false |
| `--watch` | `-w` | Run in watch mode (where supported) | false |
| `--help` | `-h` | Show help message | |
>>>>>>> Stashed changes

### Examples

```bash
# Run only unit tests
node scripts/test-runner.js --suite unit

# Run tests in parallel with JSON output
node scripts/test-runner.js --parallel --reporter json --output ./reports

# CI mode with strict thresholds and bail on failure
node scripts/test-runner.js --ci --bail

# Run specific suite with HTML report
node scripts/test-runner.js --suite integration --reporter html

# Verbose mode for debugging
node scripts/test-runner.js --verbose
```

## Test Suites

### Unit Tests
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Framework**: Vitest
- **Coverage**: Yes
- **Target**: React components and utilities
- **Command**: `npm run test:coverage`

### Integration Tests
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Framework**: Jest
- **Coverage**: Yes
- **Target**: API endpoints and database operations
- **Command**: `npm run test:coverage:integration`

### E2E Tests
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Framework**: Playwright
- **Coverage**: No
- **Target**: Full user workflows
- **Command**: `npm run test:e2e`

### Accessibility Tests
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Framework**: Vitest + Playwright
- **Coverage**: No
- **Target**: WCAG compliance
- **Command**: `npm run test:a11y:all`

### Visual Regression Tests
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Framework**: Playwright
- **Coverage**: No
- **Target**: UI consistency
- **Command**: `npm run test:visual`

### Performance Tests
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Framework**: Custom benchmarks
- **Coverage**: No
- **Target**: Load times and responsiveness
- **Command**: `npm run test:performance`

### Memory Tests
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Framework**: Custom memory profiling
- **Coverage**: No
- **Target**: Memory leaks and usage
- **Command**: `npm run test:memory`

## Output Reports

### Console Report
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Always generated
- Color-coded results
- Summary statistics
- Coverage percentages
- Warnings and errors

### JSON Report
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Machine-readable format
- Complete test results
- Detailed timing information
- Coverage data
- Output: `test-reports/test-results.json`

### HTML Report
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Interactive web page
- Visual coverage bars
- Detailed suite information
- Error details
- Output: `test-reports/test-report.html`

### Coverage Summary
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Merged coverage from all suites
- Per-metric breakdown
- Threshold validation
- Output: `test-reports/coverage-summary.json`

## CI/CD Integration

### Environment Variables
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```bash
# Enable CI mode
CI=true node scripts/test-runner.js

# Custom thresholds
COVERAGE_THRESHOLD=80 node scripts/test-runner.js
```

### Exit Codes
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- `0`: All tests passed
- `1`: One or more tests failed
- `1`: Coverage below threshold (CI mode)
- `1`: Environment validation failed

### GitHub Actions Example
<<<<<<< Updated upstream

```yaml
- name: Run all tests
  run: node scripts/test-runner.js --ci --reporter all --bail

=======
```yaml
- name: Run all tests
  run: node scripts/test-runner.js --ci --reporter all --bail
  
>>>>>>> Stashed changes
- name: Upload test reports
  uses: actions/upload-artifact@v3
  if: always()
  with:
    name: test-reports
    path: test-reports/
```

## Thresholds

Default thresholds (customizable):
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- **Coverage**: 70% (lines, statements, functions, branches)
- **Performance**: 1000ms max response time
- **Memory**: 100MB max heap usage

## Troubleshooting

### Common Issues

1. **Test database not found**
   - The runner will attempt to set up the test database automatically
   - Manual setup: `npm run test:setup:db`

2. **Environment validation failed**
   - Check Node.js version (20+ required)
   - Verify all dependencies are installed
   - Run `npm run validate-test-env`

3. **Parallel execution failures**
   - Some tests may not be parallelizable
   - Use `--verbose` to debug
   - Disable with sequential execution

4. **Coverage data missing**
   - Ensure test commands generate coverage
   - Check coverage directory paths
   - Verify `coverage-summary.json` exists

### Debug Mode

Run with verbose output for detailed information:
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
```bash
node scripts/test-runner.js --verbose --suite unit
```

## Best Practices

1. **Regular Execution**
   - Run before committing code
   - Include in pre-push hooks
   - Schedule nightly full runs

2. **CI Pipeline**
   - Always use `--ci` flag
   - Enable `--bail` for faster feedback
   - Archive reports as artifacts

3. **Coverage Monitoring**
   - Track coverage trends
   - Set realistic thresholds
   - Focus on critical paths

4. **Performance Tracking**
   - Baseline performance metrics
   - Monitor regression
   - Profile slow tests

## Adding to package.json

Add these scripts to your package.json:

```json
{
  "scripts": {
    "test:runner": "node scripts/test-runner.js",
    "test:runner:ci": "node scripts/test-runner.js --ci --reporter all --bail",
    "test:runner:unit": "node scripts/test-runner.js --suite unit",
    "test:runner:integration": "node scripts/test-runner.js --suite integration",
    "test:runner:e2e": "node scripts/test-runner.js --suite e2e",
    "test:runner:parallel": "node scripts/test-runner.js --parallel",
    "test:runner:report": "node scripts/test-runner.js --reporter html --output ./reports"
  }
}
```

## Future Enhancements

Potential improvements for the test runner:

1. **Test Sharding**: Distribute tests across multiple machines
2. **Flaky Test Detection**: Automatic retry and reporting
3. **Historical Tracking**: Compare results over time
4. **Custom Reporters**: Plugin system for additional formats
5. **Test Impact Analysis**: Run only affected tests
6. **Performance Budgets**: Set limits per test suite
7. **Notification Integration**: Slack/email alerts
<<<<<<< Updated upstream
8. **Dashboard Integration**: Real-time monitoring
=======
8. **Dashboard Integration**: Real-time monitoring
>>>>>>> Stashed changes

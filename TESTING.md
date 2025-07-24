# Comprehensive Testing Guide

This document provides a complete overview of the testing infrastructure for the Running App MVP project, including the comprehensive test runner and performance monitoring system.

## Quick Start

```bash
# Run all tests with the comprehensive test runner
npm run test:runner

# Run tests in CI mode with all reports
npm run test:runner:ci

# Generate performance report
npm run test:runner:monitor
```

## Test Architecture

### Test Types

1. **Unit Tests** (Vitest + jsdom)
   - Location: `tests/unit/`, `src/**/*.test.{js,ts,tsx}`
   - Framework: Vitest
   - Environment: jsdom for React components
   - Coverage: Yes
   - Command: `npm run test` or `npm run test:coverage`

2. **Integration Tests** (Jest + Node.js)
   - Location: `tests/integration/`
   - Framework: Jest with ts-jest
   - Environment: Node.js
   - Coverage: Yes
   - Command: `npm run test:integration`

3. **End-to-End Tests** (Playwright)
   - Location: `tests/e2e/`
   - Framework: Playwright
   - Browsers: Chromium, Firefox, WebKit
   - Command: `npm run test:e2e`

4. **Accessibility Tests**
   - Unit Level: `tests/accessibility/` (Vitest + @axe-core/react)
   - E2E Level: `tests/e2e/accessibility.test.ts` (Playwright + @axe-core/playwright)
   - Command: `npm run test:a11y:all`

5. **Visual Regression Tests**
   - Location: `tests/e2e/visual-regression.test.ts`
   - Framework: Playwright with screenshot comparison
   - Command: `npm run test:visual`

6. **Performance Tests**
   - Location: `tests/performance/`
   - Custom benchmarking scripts
   - Command: `npm run test:performance`

7. **Memory Tests**
   - Location: `tests/memory/`
   - Memory leak detection
   - Command: `npm run test:memory`

## Comprehensive Test Runner

The test runner (`scripts/test-runner.js`) provides unified execution of all test suites with detailed reporting.

### Features

- **Unified Execution**: Run all or specific test suites from one command
- **Parallel Processing**: Execute multiple test suites simultaneously
- **Multiple Reporters**: Console, JSON, and HTML output formats
- **Coverage Aggregation**: Combine coverage from all test suites
- **CI/CD Integration**: Special CI mode with strict thresholds
- **Performance Tracking**: Integration with performance monitoring
- **Quality Gates**: Configurable thresholds for coverage and performance

### Usage Examples

```bash
# Run all tests (default)
npm run test:runner

# Run specific test suite
npm run test:runner:unit
npm run test:runner:integration
npm run test:runner:e2e

# Parallel execution
npm run test:runner:parallel

# CI mode with strict thresholds
npm run test:runner:ci

# Generate HTML report
npm run test:runner:report

# Custom options
node scripts/test-runner.js --suite unit --reporter json --output ./my-reports
node scripts/test-runner.js --parallel --verbose --bail
```

### Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--suite <name>` | Test suite to run (unit, integration, e2e, a11y, visual, performance, memory, all) | all |
| `--parallel` | Run tests in parallel where possible | false |
| `--reporter <type>` | Reporter type (console, json, html, all) | console |
| `--output <dir>` | Output directory for reports | test-reports |
| `--ci` | Run in CI mode with strict thresholds | false |
| `--verbose` | Verbose output for debugging | false |
| `--bail` | Stop on first test failure | false |
| `--watch` | Run in watch mode (where supported) | false |

## Performance Monitoring

The performance monitor (`scripts/test-performance-monitor.js`) tracks test execution performance over time.

### Features

- **Historical Tracking**: Stores performance data for up to 100 test runs
- **Trend Analysis**: Identifies improving, stable, or deteriorating performance
- **Regression Detection**: Automatically detects significant performance degradations
- **Recommendations**: Provides actionable suggestions for optimization
- **Suite-Level Analysis**: Individual performance tracking per test suite

### Usage

```bash
# Generate performance report
npm run test:runner:monitor

# Record test results (usually called by test runner)
node scripts/test-performance-monitor.js record test-reports/test-results.json
```

## Test Configuration Files

### Vitest Configuration
- File: `vite.config.ts` (test section)
- Environment: jsdom
- Setup: `vitest.setup.ts`, `tests/setup/testSetup.ts`
- Coverage: v8 provider

### Jest Configuration
- File: `jest.config.js`
- Environment: Node.js
- Setup: `tests/setup/globalSetup.ts`, `tests/setup/jestSetup.ts`
- Coverage: Default Jest coverage

### Playwright Configuration
- File: `playwright.config.ts`
- Browsers: Chromium, Firefox, WebKit
- Base URL: http://localhost:3000
- Web Server: Automatically starts `npm run dev:full`

## Coverage Requirements

### Default Thresholds
- Lines: 70%
- Statements: 70%
- Functions: 70%
- Branches: 70%

### Coverage Collection
- **Unit Tests**: Frontend React components, utilities
- **Integration Tests**: Backend routes, middleware, database operations
- **Combined Reports**: Merged coverage data from all test suites

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Comprehensive Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20.x'
        cache: 'npm'
    - run: npm ci
    - run: npm run test:runner:ci
    - uses: actions/upload-artifact@v4
      if: always()
      with:
        name: test-reports
        path: test-reports/
```

### Environment Variables
- `CI=true`: Enables CI mode
- `COVERAGE_THRESHOLD=80`: Custom coverage threshold
- `DATABASE_URL`: Test database connection
- `JWT_SECRET`: Test JWT secret

### Exit Codes
- `0`: All tests passed
- `1`: Test failures or coverage below threshold

## Test Data Management

### Test Database
- SQLite database for integration tests
- Setup: `npm run test:setup:db`
- Validation: `npm run validate-test-env`
- Cleanup: Automatic after each test

### Test User Creation
- Command: `npm run create-test-user`
- Creates test users for authentication testing

## Best Practices

### Writing Tests

1. **Unit Tests**
   - Test components in isolation
   - Mock external dependencies
   - Focus on business logic
   - Use React Testing Library for UI components

2. **Integration Tests**
   - Test API endpoints end-to-end
   - Include database operations
   - Verify error handling
   - Test authentication flows

3. **E2E Tests**
   - Test complete user workflows
   - Focus on critical paths
   - Keep tests independent
   - Use Page Object Model pattern

### Test Organization

```
tests/
├── unit/              # Unit tests
│   ├── components/    # React component tests
│   ├── hooks/         # Custom hook tests
│   └── utils/         # Utility function tests
├── integration/       # Integration tests
│   ├── api/          # API endpoint tests
│   └── auth/         # Authentication tests
├── e2e/              # End-to-end tests
│   ├── auth/         # Authentication workflows
│   ├── dashboard/    # Dashboard functionality
│   └── runs/         # Running data features
├── accessibility/    # Accessibility tests
├── performance/      # Performance benchmarks
├── memory/           # Memory leak tests
└── setup/           # Test setup and utilities
```

### Performance Optimization

1. **Parallel Execution**
   - Use `npm run test:runner:parallel` for faster feedback
   - Ensure tests are independent
   - Monitor resource usage

2. **Test Sharding**
   - Split tests across CI workers
   - Use Playwright's built-in sharding
   - Balance test distribution

3. **Selective Testing**
   - Run specific suites during development
   - Use watch mode for active development
   - Full suite for CI/CD

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   ```bash
   # Reset test database
   npm run test:setup:db
   
   # Verify environment
   npm run validate-test-env
   ```

2. **Port Conflicts**
   - Frontend: 3000
   - Backend: 3001
   - Ensure ports are available

3. **Browser Issues (E2E)**
   ```bash
   # Install browsers
   npx playwright install
   
   # Run with headed mode for debugging
   npm run test:e2e:headed
   ```

4. **Coverage Issues**
   - Check file inclusion patterns
   - Verify source maps are generated
   - Review coverage thresholds

### Debug Mode

```bash
# Verbose output
node scripts/test-runner.js --verbose

# Single suite debugging
npm run test:runner:unit --verbose

# Performance analysis
npm run test:runner:monitor
```

## Reporting and Analytics

### Report Types

1. **Console Report**
   - Real-time colored output
   - Summary statistics
   - Error details
   - Coverage overview

2. **JSON Report**
   - Machine-readable format
   - Complete test results
   - Performance metrics
   - Coverage data

3. **HTML Report**
   - Interactive web interface
   - Visual coverage bars
   - Detailed error information
   - Historical comparisons

### Metrics Tracked

- Test execution times
- Coverage percentages
- Failure rates
- Performance trends
- Memory usage
- Flaky test detection

## Future Enhancements

### Planned Improvements

1. **Advanced Monitoring**
   - Real-time dashboards
   - Alert notifications
   - Historical trend analysis
   - Performance budgets

2. **Test Intelligence**
   - Flaky test detection
   - Test impact analysis
   - Smart test selection
   - Predictive insights

3. **Enhanced CI/CD**
   - Multi-environment testing
   - Canary deployments
   - Automated rollbacks
   - Quality gates

4. **Developer Experience**
   - IDE integrations
   - Visual test debugging
   - Interactive reports
   - Test recommendations

## Support and Maintenance

### Regular Maintenance Tasks

1. **Weekly**
   - Review performance trends
   - Update test data
   - Check flaky tests
   - Monitor coverage

2. **Monthly**
   - Update dependencies
   - Review test suite performance
   - Optimize slow tests
   - Archive old reports

3. **Quarterly**
   - Evaluate testing strategy
   - Update test infrastructure
   - Review coverage targets
   - Plan improvements

### Getting Help

1. Check the test runner documentation: `scripts/TEST-RUNNER.md`
2. Review individual test configuration files
3. Use verbose mode for debugging
4. Check performance reports for optimization opportunities
5. Contact the development team for infrastructure issues

---

This comprehensive testing infrastructure provides a robust foundation for maintaining code quality, catching regressions early, and ensuring the Running App MVP meets all functional and non-functional requirements.
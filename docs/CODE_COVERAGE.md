# Code Coverage Monitoring System

This document describes the comprehensive code coverage monitoring system that enforces and maintains >80% code coverage across the codebase.

## Overview

The code coverage system ensures high code quality by:

- **Collecting coverage data** from unit and integration tests
- **Enforcing minimum thresholds** of 80% coverage
- **Tracking coverage trends** over time
- **Generating detailed reports** with actionable insights
- **Automating enforcement** in CI/CD pipelines
- **Creating alerts** when coverage drops below targets

## Coverage Target

🎯 **Target**: Maintain >80% code coverage

This target ensures:
- High confidence in code quality
- Reduced risk of bugs
- Better maintainability
- Comprehensive test suite
- Easier refactoring

## System Components

### 1. Coverage Monitor (`scripts/coverage-monitor.ts`)

Core monitoring system that:

- **Collects coverage data** from all test types
- **Merges coverage reports** for comprehensive analysis
- **Analyzes trends** to identify improvements or regressions
- **Generates reports** in multiple formats
- **Enforces thresholds** with pass/fail status
- **Provides recommendations** for improving coverage

#### Usage

```bash
# Collect coverage from all tests
npm run coverage:collect

# Analyze coverage trends
npm run coverage:analyze

# Generate reports and badges
npm run coverage:report

# Enforce coverage thresholds
npm run coverage:enforce

# Watch coverage in real-time
npm run coverage:watch
```

### 2. GitHub Actions Workflow (`.github/workflows/code-coverage.yml`)

Automated workflow that:

- **Runs on every PR** to check coverage impact
- **Comments on PRs** with coverage details
- **Blocks merging** if coverage drops below threshold
- **Creates issues** when coverage degrades
- **Updates badges** automatically
- **Tracks trends** over time

### 3. Test Configuration

#### Vitest Configuration (`vitest.config.ts`)

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html', 'lcov'],
  thresholds: {
    lines: 80,
    functions: 80,
    branches: 75,
    statements: 80,
  },
  perFile: true,
  all: true,
}
```

#### Jest Configuration (`jest.config.js`)

```javascript
coverageThreshold: {
  global: {
    lines: 80,
    functions: 80,
    branches: 75,
    statements: 80,
  },
}
```

## Coverage Metrics

### Metrics Tracked

1. **Line Coverage**: Percentage of code lines executed
2. **Statement Coverage**: Percentage of statements executed
3. **Function Coverage**: Percentage of functions called
4. **Branch Coverage**: Percentage of conditional branches tested

### Coverage Calculation

```typescript
interface CoverageData {
  lines: { total: number; covered: number; percentage: number };
  statements: { total: number; covered: number; percentage: number };
  functions: { total: number; covered: number; percentage: number };
  branches: { total: number; covered: number; percentage: number };
}
```

## Using the Coverage System

### Running Coverage Locally

1. **Check current coverage**:
   ```bash
   npm run test:coverage
   ```

2. **Run all tests with coverage**:
   ```bash
   npm run coverage:collect
   ```

3. **View detailed report**:
   ```bash
   npm run coverage:report
   open coverage-data/coverage-report.html
   ```

4. **Monitor while developing**:
   ```bash
   npm run coverage:watch
   ```

### Understanding Coverage Reports

#### Console Output

```
📊 Code Coverage Summary
Lines: 82.5% ✅
Statements: 81.3% ✅
Functions: 79.8% ❌
Branches: 76.2% ✅
```

#### HTML Report

Open `coverage-data/coverage-report.html` to see:
- File-by-file coverage breakdown
- Line-by-line coverage visualization
- Uncovered code highlighting
- Coverage trends over time

#### PR Comments

Every PR receives an automatic comment with:
- Overall coverage percentage
- Coverage change from base branch
- Files with low coverage
- Recommendations for improvement

### Improving Coverage

#### 1. Identify Gaps

```bash
npm run coverage:analyze
```

This shows:
- Files with lowest coverage
- Uncovered functions
- Missing branch tests

#### 2. Add Tests

Focus on:
- **Unit tests** for individual functions
- **Edge cases** for better branch coverage
- **Error handling** paths
- **Integration tests** for complex flows

#### 3. Coverage-Driven Development

```bash
# Watch coverage while adding tests
npm run coverage:watch

# See impact of new tests immediately
npm run test:coverage -- --watch
```

## Coverage Thresholds

### Global Thresholds

All code must meet:
- **Lines**: 80%
- **Statements**: 80%
- **Functions**: 80%
- **Branches**: 75%

### Per-File Thresholds

Individual files must meet:
- **Lines**: 60%
- **Statements**: 60%
- **Functions**: 60%
- **Branches**: 50%

### Configuring Thresholds

Edit `coverage-data/thresholds.json`:

```json
{
  "global": {
    "lines": 80,
    "statements": 80,
    "functions": 80,
    "branches": 75
  },
  "each": {
    "lines": 60,
    "statements": 60,
    "functions": 60,
    "branches": 50
  }
}
```

## CI/CD Integration

### Pull Request Workflow

1. **Coverage collection** runs automatically
2. **PR comment** shows coverage impact
3. **Status check** blocks merge if below threshold
4. **Detailed report** available in artifacts

### Main Branch Protection

- Coverage must be >80% to merge
- Automated badge updates
- Historical trend tracking
- Issue creation for regressions

### Scheduled Monitoring

Daily checks that:
- Analyze coverage trends
- Create issues for degradation
- Close resolved issues
- Update documentation

## Troubleshooting

### Common Issues

#### 1. Coverage Not Collecting

**Problem**: No coverage data generated

**Solutions**:
```bash
# Ensure test setup is correct
npm run validate-test-env

# Check coverage configuration
cat vitest.config.ts | grep coverage

# Run with debug output
DEBUG=coverage npm run coverage:collect
```

#### 2. Coverage Below Threshold

**Problem**: Tests pass but coverage fails

**Solutions**:
```bash
# Find uncovered code
npm run coverage:analyze

# Generate detailed report
npm run coverage:report

# Focus on specific files
npm run test:coverage -- src/utils/
```

#### 3. Merge Conflicts in Coverage Data

**Problem**: Coverage data conflicts in git

**Solutions**:
```bash
# Coverage data shouldn't be committed
echo "coverage-data/" >> .gitignore

# Clean local data
rm -rf coverage-data/

# Regenerate
npm run coverage:collect
```

#### 4. Slow Coverage Collection

**Problem**: Coverage takes too long

**Solutions**:
```bash
# Run tests in parallel
npm run test:coverage -- --maxWorkers=100%

# Skip coverage for watch mode
npm run test:watch -- --coverage=false

# Use focused tests
npm run test:coverage -- --testNamePattern="specific test"
```

## Best Practices

### Writing Testable Code

1. **Small functions**: Easier to test completely
2. **Pure functions**: No side effects
3. **Dependency injection**: Mock external dependencies
4. **Error handling**: Explicit error paths

### Test Organization

1. **Co-locate tests**: Keep tests near source files
2. **Descriptive names**: Clear test descriptions
3. **Arrange-Act-Assert**: Consistent test structure
4. **Test utilities**: Share common test setup

### Coverage Goals

1. **New code**: 100% coverage for new features
2. **Legacy code**: Incrementally improve coverage
3. **Critical paths**: Prioritize business-critical code
4. **Edge cases**: Test boundary conditions

## Advanced Features

### Custom Coverage Rules

```typescript
// Exclude specific patterns
/* istanbul ignore next */
if (process.env.NODE_ENV === 'production') {
  // Production-only code
}

// Exclude entire files
/* istanbul ignore file */
```

### Coverage Badges

```markdown
![Coverage](https://img.shields.io/badge/coverage-82.5%25-brightgreen)
```

Automatically updated by CI:
- Green: ≥80%
- Yellow: 60-79%
- Red: <60%

### Coverage Trends API

```typescript
// Get coverage trends
const trends = await monitor.getTrends(30); // Last 30 days

// Get specific test type
const unitTrends = trends.filter(t => t.testType === 'unit');

// Calculate improvement
const improvement = trends[0].coverage - trends[29].coverage;
```

### Integration with Other Tools

#### SonarQube Integration

```yaml
sonar.javascript.lcov.reportPaths=coverage/lcov.info,coverage-integration/lcov.info
sonar.coverage.exclusions=**/*.test.ts,**/*.spec.ts
```

#### Codecov Integration

```yaml
- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info,./coverage-integration/lcov.info
    flags: unittests,integration
```

## Monitoring Dashboard

### Coverage Overview

Access the dashboard at `coverage-data/coverage-report.html`:

1. **Summary metrics** with visual indicators
2. **File browser** with coverage percentages
3. **Source viewer** with line-by-line coverage
4. **Trend charts** showing coverage over time
5. **Top files** needing improvement

### Alerts and Notifications

Automatic alerts when:
- Coverage drops below 80%
- Significant regression detected (>5% drop)
- New uncovered files added
- Coverage improves significantly (>10% increase)

## Future Enhancements

### Planned Improvements

1. **Mutation testing**: Test the tests themselves
2. **Coverage predictions**: ML-based coverage estimation
3. **IDE integration**: Real-time coverage in VS Code
4. **Coverage gamification**: Team leaderboards
5. **Automated test generation**: AI-powered test creation

### Experimental Features

Enable experimental features:

```bash
# Enable advanced analytics
COVERAGE_ADVANCED=true npm run coverage:analyze

# Enable performance tracking
COVERAGE_PERF=true npm run coverage:collect
```

## Conclusion

The code coverage monitoring system provides comprehensive tools to maintain high code quality through automated testing and coverage enforcement. By following the practices outlined in this document and maintaining >80% coverage, we ensure a robust, maintainable, and reliable codebase.

Regular monitoring and continuous improvement of test coverage leads to:
- Fewer bugs in production
- Easier refactoring
- Better code documentation through tests
- Higher developer confidence
- Faster development cycles
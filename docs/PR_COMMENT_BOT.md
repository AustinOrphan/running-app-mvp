# PR Comment Bot Documentation

## Overview

The PR Comment Bot automatically posts comprehensive test results and coverage information as comments on pull requests, providing developers with immediate feedback about their changes. The system integrates with GitHub Actions to run after all tests complete and generates rich, formatted comments with detailed test metrics.

## Architecture

### Core Components

1. **PR Comment Bot Script** (`scripts/pr-comment-bot.js`)
   - Main comment generation engine
   - Collects test results from multiple sources
   - Formats comprehensive PR comments
   - Supports multiple test frameworks

2. **GitHub Actions Workflow** (`.github/workflows/pr-test-results.yml`)
   - Automated test execution and comment posting
   - Runs on PR events (opened, synchronize, reopened)
   - Handles comment updates and workflow management
   - Manual trigger support for testing

3. **Test Result Parsers**
   - Vitest (unit tests) result parsing
   - Jest (integration tests) result parsing
   - Playwright (E2E tests) result parsing
   - Coverage data aggregation

## Features

### 📊 Comprehensive Test Results

#### Multi-Framework Support

- **Unit Tests** (Vitest): Component and utility function testing
- **Integration Tests** (Jest): API and database interaction testing
- **E2E Tests** (Playwright): Full user workflow testing

#### Test Metrics Collected

- **Test Counts**: Total, passed, failed, skipped tests
- **Execution Time**: Per suite and total duration
- **Failure Details**: Error messages and stack traces
- **Test Performance**: Tests per second metrics

### 📈 Coverage Integration

#### Coverage Sources

- Unit test coverage (Vitest with coverage)
- Integration test coverage (Jest with coverage)
- Combined coverage metrics

#### Coverage Metrics

- **Statements**: Percentage of executed statements
- **Branches**: Percentage of executed conditional branches
- **Functions**: Percentage of called functions
- **Lines**: Percentage of executed lines

### ⚡ Performance Monitoring

#### Performance Metrics

- Total test execution duration
- Per-suite performance breakdown
- Tests per second calculations
- Performance trend alerts

### 🔄 Flaky Test Detection

#### Flaky Test Information

- Total flaky tests count
- New flaky tests identified
- Recently fixed flaky tests
- Flaky test details with scores

### 💬 Rich Comment Formatting

#### Comment Structure

1. **Header**: Branch, commit, author, timestamp
2. **Test Summary**: Overview table with all test suites
3. **Detailed Results**: Failure details with collapsible sections
4. **Coverage Section**: Coverage metrics and trends
5. **Performance Section**: Execution times and alerts
6. **Flaky Tests Section**: Flaky test information
7. **Footer**: Links to full CI results

## Usage

### Command Line Interface

#### Basic Commands

```bash
# Generate complete PR comment
npm run pr:comment

# Collect test results only
npm run pr:comment:collect

# Generate comment from existing data
npm run pr:comment:only
```

#### Direct Script Usage

```bash
# Full comment generation
node scripts/pr-comment-bot.js generate

# Collect results only
node scripts/pr-comment-bot.js collect

# Generate comment only
node scripts/pr-comment-bot.js comment
```

### GitHub Actions Integration

#### Automatic Execution

The PR comment bot runs automatically on:

- **Pull Request Events**: opened, synchronize, reopened
- **Target Branches**: main, develop
- **Manual Triggers**: workflow_dispatch with PR number

#### Workflow Features

```yaml
# Automatic comment posting
on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main, develop]

# Manual trigger for testing
workflow_dispatch:
  inputs:
    pr_number:
      description: 'PR number to comment on'
      required: false
      type: string
```

### Configuration

#### Environment Variables

```bash
# Output directory for comments
PR_COMMENT_OUTPUT_DIR=./reports/pr-comments

# PR metadata (usually set by GitHub Actions)
PR_TITLE="Feature implementation"
GITHUB_HEAD_REF="feature-branch"
GITHUB_SHA="abc123def"
GITHUB_ACTOR="username"

# GitHub Actions specific
GITHUB_SERVER_URL="https://github.com"
GITHUB_REPOSITORY="owner/repo"
GITHUB_RUN_ID="12345"
```

#### Bot Configuration

```javascript
const bot = new PRCommentBot({
  outputDir: './reports/pr-comments',
  testSuitesDir: './reports',
  coverageDir: './coverage',
  integrationCoverageDir: './coverage-integration',
  performanceDir: './reports/performance',
  flakyTestDir: './reports/flaky-tests',
});
```

## Comment Format Examples

### Basic Test Summary

```markdown
# ✅ Test Results Report

**Branch**: `feature-branch`
**Commit**: `abc123d`
**Author**: @developer
**Generated**: 2025-01-15, 10:30:00

## 📊 Test Summary

| Test Suite        | Status   | Tests   | Passed   | Failed   | Skipped   | Duration   |
| ----------------- | -------- | ------- | -------- | -------- | --------- | ---------- |
| Unit Tests        | ✅       | 45      | 45       | 0        | 0         | 12s        |
| Integration Tests | ✅       | 23      | 23       | 0        | 0         | 34s        |
| E2E Tests         | ✅       | 8       | 8        | 0        | 0         | 2m 15s     |
| ------------      | -------- | ------- | -------- | -------- | --------- | ---------- |
| **Total**         | ✅       | **76**  | **76**   | **0**    | **0**     | **3m 1s**  |
```

### Coverage Section

```markdown
## 📊 Code Coverage

### Overall Coverage

| Metric     | Coverage | Status |
| ---------- | -------- | ------ |
| Statements | 87.5%    | ✅     |
| Branches   | 82.3%    | ✅     |
| Functions  | 91.2%    | ✅     |
| Lines      | 86.8%    | ✅     |

### Coverage by Test Suite

| Suite             | Statements | Branches | Functions | Lines |
| ----------------- | ---------- | -------- | --------- | ----- |
| Unit Tests        | 89.2%      | 84.1%    | 93.4%     | 88.7% |
| Integration Tests | 85.8%      | 80.5%    | 89.0%     | 85.0% |
```

### Failure Details

```markdown
## 📝 Detailed Results

### Unit Tests Failures

<details>
<summary>❌ UserService > should validate email format</summary>
```

Expected: true
Received: false

at expect (/path/to/test.js:42:5)
at /path/to/test.js:40:3

```

</details>
```

### Performance Section

```markdown
## ⚡ Performance

**Total Test Duration**: 3m 1s

### Suite Performance

| Suite             | Duration | Tests/sec | Status |
| ----------------- | -------- | --------- | ------ |
| Unit Tests        | 12s      | 3.8       | ✅     |
| Integration Tests | 34s      | 0.7       | ✅     |
| E2E Tests         | 2m 15s   | 0.1       | ⚠️     |

### Performance Alerts

⚠️ E2E tests taking longer than usual (2m 15s vs avg 1m 45s)
```

### Flaky Tests Section

```markdown
## 🔄 Flaky Tests

**Total Flaky Tests**: 3
**New Flaky Tests**: 1
**Fixed Flaky Tests**: 0

### Current Flaky Tests

- **LoginTest > should handle network timeout** (Flaky Score: 15.2%)
  - Success Rate: 84.8%
  - Total Runs: 25
- **DataSync > should retry on failure** (Flaky Score: 8.7%)
  - Success Rate: 91.3%
  - Total Runs: 18
```

## Advanced Features

### Comment Update Logic

#### Smart Comment Management

- **Update Existing**: Updates existing bot comments instead of creating new ones
- **Content Comparison**: Only updates if content has changed
- **Timestamp Tracking**: Shows when comment was last updated

#### Comment Identification

```javascript
// Find existing bot comments
const botComment = comments.data.find(
  comment =>
    comment.user.type === 'Bot' &&
    comment.body.includes('Test Results Report') &&
    comment.body.includes('PR Comment Bot')
);
```

### Multi-Framework Parsing

#### Result Parser Architecture

```javascript
// Framework-specific parsers
parseVitestResults(output); // JSON or text output
parseJestResults(output); // JSON or text output
parsePlaywrightResults(output); // JSON or text output

// Fallback text parser
parseTextTestResults(output); // Universal text parsing
```

#### Flexible Output Handling

- **JSON Output**: Preferred, structured data
- **Text Output**: Fallback parsing for any framework
- **Error Handling**: Graceful degradation when parsing fails

### Performance Optimization

#### Efficient Data Collection

```javascript
// Parallel test execution
const [unit, integration, e2e] = await Promise.allSettled([
  this.collectUnitTestResults(),
  this.collectIntegrationTestResults(),
  this.collectE2ETestResults(),
]);
```

#### Resource Management

- **Memory Limits**: Large buffer sizes for test output
- **Timeout Handling**: Graceful handling of long-running tests
- **Error Recovery**: Continue processing even if some tests fail

### Extensibility

#### Custom Test Frameworks

```javascript
// Add custom test framework support
async collectCustomTestResults() {
  try {
    const { stdout } = await execAsync('npm run test:custom');
    return this.parseCustomResults(stdout);
  } catch (error) {
    return this.handleTestError(error);
  }
}
```

#### Custom Comment Sections

```javascript
// Add custom comment sections
generateCustomSection() {
  return `## 🔧 Custom Section

  Custom metrics and information here...
  `;
}
```

## Best Practices

### Comment Content Guidelines

#### Keep Comments Focused

1. **Prioritize Failures**: Show failed tests prominently
2. **Limit Failure Count**: Show max 5 failures to avoid overwhelming
3. **Use Collapsible Sections**: Hide detailed error messages in `<details>`
4. **Highlight Critical Issues**: Use clear visual indicators

#### Performance Considerations

1. **Efficient Parsing**: Use JSON output when available
2. **Reasonable Limits**: Limit comment length to prevent GitHub issues
3. **Graceful Degradation**: Handle missing data gracefully
4. **Timeout Management**: Set appropriate timeouts for test execution

### GitHub Actions Integration

#### Workflow Best Practices

1. **Concurrency Control**: Prevent multiple comment workflows
2. **Artifact Management**: Upload test results for debugging
3. **Error Handling**: Continue on test failures to still post comments
4. **Resource Optimization**: Use appropriate timeouts and retries

#### Security Considerations

1. **Token Permissions**: Use minimal required permissions
2. **Input Validation**: Validate PR numbers and inputs
3. **Error Sanitization**: Don't expose sensitive information in comments
4. **Rate Limiting**: Respect GitHub API rate limits

### Maintenance and Monitoring

#### Regular Maintenance

1. **Comment Format Updates**: Keep format current with test frameworks
2. **Parser Updates**: Update parsers when test frameworks change
3. **Performance Monitoring**: Monitor comment generation performance
4. **Error Rate Tracking**: Track and address parsing failures

#### Debugging and Troubleshooting

1. **Artifact Collection**: Save raw test output for debugging
2. **Verbose Logging**: Enable detailed logging for troubleshooting
3. **Manual Testing**: Support manual workflow triggers
4. **Fallback Mechanisms**: Provide graceful degradation options

## Troubleshooting

### Common Issues

#### Comment Not Posted

```bash
# Check workflow execution
gh run list --workflow=pr-test-results.yml

# Check test result artifacts
gh run download <run-id>

# Verify PR comment bot locally
npm run pr:comment:collect
npm run pr:comment:only
```

#### Missing Test Results

```bash
# Verify test execution
npm run test:coverage
npm run test:coverage:integration
npm run test:e2e

# Check output directories
ls -la coverage/
ls -la coverage-integration/
ls -la test-results/
```

#### Parsing Errors

```bash
# Debug with verbose output
DEBUG=pr-comment-bot npm run pr:comment

# Check raw test output
npm run test:coverage -- --reporter=json > test-output.json
```

#### GitHub Actions Issues

```bash
# Check workflow permissions
gh api repos/:owner/:repo/actions/permissions

# Verify artifact upload
gh run view <run-id> --verbose

# Check comment permissions
gh api repos/:owner/:repo/issues/comments --method POST
```

### Debug Mode

#### Enable Verbose Logging

```bash
# Environment variable for debug mode
export DEBUG=pr-comment-bot

# Run with debug output
DEBUG=pr-comment-bot npm run pr:comment
```

#### Manual Testing

```bash
# Test comment generation locally
node scripts/pr-comment-bot.js generate

# Test with specific PR data
export PR_TITLE="Test PR"
export GITHUB_HEAD_REF="test-branch"
node scripts/pr-comment-bot.js generate
```

## Related Documentation

- [Test Infrastructure Overview](./TESTING.md)
- [CI/CD Pipeline Documentation](./CI_CD.md)
- [Coverage Trend Reporting](./COVERAGE_TREND_REPORTING.md)
- [Flaky Test Tracking](./FLAKY_TEST_TRACKING.md)
- [Performance Testing](./PERFORMANCE_TESTING.md)

## External Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub REST API - Issues](https://docs.github.com/en/rest/issues)
- [Vitest Reporters](https://vitest.dev/guide/reporters.html)
- [Jest Reporters](https://jestjs.io/docs/configuration#reporters-arraymodulename--modulename-options)
- [Playwright Reporters](https://playwright.dev/docs/test-reporters)

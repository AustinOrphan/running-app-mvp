/**
 * @fileoverview Generates a GitHub issue body for coverage trend analysis.
 *
 * This script is designed to be called from a GitHub Actions workflow. It reads
 * coverage data, thresholds, and trend analysis from environment variables,
 * then constructs a Markdown-formatted issue body and prints it to stdout.
 *
 * Required Environment Variables:
 * - GITHUB_REPO_URL: The URL of the repository (e.g., https://github.com/owner/repo).
 * - GITHUB_RUN_ID: The ID of the current workflow run.
 * - CURRENT_COVERAGE: A JSON string representing the current coverage report.
 * - THRESHOLDS: A JSON string with the configured coverage thresholds.
 * - ANALYSIS: A JSON string containing the coverage trend analysis.
 * - ALERTS: A JSON string representing an array of alert messages.
 */

const { GITHUB_REPO_URL, GITHUB_RUN_ID, CURRENT_COVERAGE, THRESHOLDS, ANALYSIS, ALERTS } =
  process.env;

/**
 * Validates that all required environment variables are present.
 */
function validateInputs() {
  const requiredVars = {
    GITHUB_REPO_URL,
    GITHUB_RUN_ID,
    CURRENT_COVERAGE,
    THRESHOLDS,
    ANALYSIS,
    ALERTS,
  };
  const missingVars = Object.entries(requiredVars)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingVars.length > 0) {
    console.error(`Error: Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Parses a JSON string from an environment variable with error handling.
 * @param {string} jsonString The JSON string to parse.
 * @param {string} varName The name of the environment variable for error messages.
 * @returns {object} The parsed JavaScript object.
 */
function parseJSON(jsonString, varName) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error(`Error: Failed to parse JSON from ${varName}.`);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Generates the main coverage metrics table in Markdown.
 * @param {object} current - The current coverage data object.
 * @param {object} thresholds - The configured thresholds object.
 * @returns {string} A Markdown table.
 */
function generateCoverageTable(current, thresholds) {
  const metrics = ['statements', 'branches', 'functions', 'lines'];
  const header = `| Metric     | Coverage | Threshold | Status |
|------------|----------|-----------|--------|`;

  const rows = metrics
    .map(metric => {
      const currentPct = current.overall[metric].percentage;
      const thresholdPct = thresholds.configured[metric];
      const status = currentPct >= thresholdPct ? '✅' : '❌';
      const capitalizedMetric = metric.charAt(0).toUpperCase() + metric.slice(1);
      return `| ${capitalizedMetric.padEnd(10)} | ${currentPct}%    | ${thresholdPct}%     | ${status}    |`;
    })
    .join('\n');

  return `${header}\n${rows}`;
}

/**
 * Generates the coverage trend analysis section if data is available.
 * @param {object} analysis - The trend analysis data object.
 * @returns {string} A Markdown section with a trends table, or an empty string.
 */
function generateTrendSection(analysis) {
  if (!analysis.hasEnoughData) {
    return '';
  }

  const trendDirection = analysis.overallTrend > 0 ? '+' : '';
  const trendHeader = `## 📈 Coverage Trends

**Overall Trend**: ${analysis.direction} (${trendDirection}${analysis.overallTrend.toFixed(2)}% per day)`;

  const tableHeader = `| Metric     | Current  | Previous | Change   |
|------------|----------|----------|----------|`;

  const tableRows = Object.entries(analysis.trends)
    .map(([metric, trend]) => {
      const change = trend.change > 0 ? `+${trend.change.toFixed(1)}` : trend.change.toFixed(1);
      const capitalizedMetric = metric.charAt(0).toUpperCase() + metric.slice(1);
      return `| ${capitalizedMetric.padEnd(10)} | ${trend.current}%   | ${trend.previous}%  | ${change}%    |`;
    })
    .join('\n');

  return `${trendHeader}\n\n${tableHeader}\n${tableRows}`;
}

/**
 * Assembles the complete GitHub issue body.
 * @returns {string} The formatted Markdown string for the issue body.
 */
function generateIssueBody() {
  const current = parseJSON(CURRENT_COVERAGE, 'CURRENT_COVERAGE');
  const thresholds = parseJSON(THRESHOLDS, 'THRESHOLDS');
  const analysis = parseJSON(ANALYSIS, 'ANALYSIS');
  const alerts = parseJSON(ALERTS, 'ALERTS');

  const coverageTable = generateCoverageTable(current, thresholds);
  const trendSection = generateTrendSection(analysis);

  return `# 🚨 Coverage Alert

**Date**: ${new Date().toLocaleDateString()}
**Workflow**: [View Details](${GITHUB_REPO_URL}/actions/runs/${GITHUB_RUN_ID})
**Branch**: ${current.branch}
**Commit**: ${current.commit}

## 📊 Current Coverage

${coverageTable}

## 🚨 Alerts

${alerts.join('\n')}

${trendSection}

## 🔧 Recommended Actions

1. **Review Recent Changes**: Check for untested code in recent commits.
2. **Add Missing Tests**: Focus on areas with low coverage.
3. **Update Thresholds**: If coverage drops are intentional, update thresholds.
4. **Monitor Trends**: Keep an eye on coverage trends in upcoming builds.

## 📊 Resources

- [Coverage Dashboard](${GITHUB_REPO_URL}/actions/artifacts)
- [Full Coverage Report](${GITHUB_REPO_URL}/actions/runs/${GITHUB_RUN_ID})
- [Coverage Trend Chart](${GITHUB_REPO_URL}/actions/artifacts)

---
*This issue was automatically created by the Coverage Trend Tracking workflow.*`;
}

/**
 * Main execution function.
 */
function main() {
  validateInputs();
  const issueBody = generateIssueBody();
  console.log(issueBody);
}

main();

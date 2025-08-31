/**
 * @fileoverview Generates a GitHub issue body for test performance alerts.
 *
 * This script is designed to be called from a GitHub Actions workflow. It reads
 * performance alert data from environment variables and constructs a Markdown-formatted
 * issue body for critical performance alerts.
 *
 * Required Environment Variables:
 * - GITHUB_REPO_URL: The URL of the repository (e.g., https://github.com/owner/repo).
 * - GITHUB_RUN_ID: The ID of the current workflow run.
 * - GITHUB_WORKFLOW: The name of the current workflow.
 * - CRITICAL_ALERTS: A JSON string representing an array of critical alert objects.
 */

const { GITHUB_REPO_URL, GITHUB_RUN_ID, GITHUB_WORKFLOW, CRITICAL_ALERTS } = process.env;

/**
 * Validates that all required environment variables are present.
 */
function validateInputs() {
  const requiredVars = {
    GITHUB_REPO_URL,
    GITHUB_RUN_ID,
    GITHUB_WORKFLOW,
    CRITICAL_ALERTS,
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
 * Generates alert details section for each critical alert.
 * @param {Array} criticalAlerts - Array of critical alert objects.
 * @returns {string} Formatted alert details in Markdown.
 */
function generateAlertDetails(criticalAlerts) {
  return criticalAlerts
    .map(alert => {
      let details = `- **${alert.message}**\n`;
      details += `  - Suite: ${alert.suite}\n`;
      details += `  - Type: ${alert.type}\n`;

      if (alert.actual) {
        details += `  - Actual: ${alert.actual}\n`;
      }

      if (alert.threshold) {
        details += `  - Threshold: ${alert.threshold}\n`;
      }

      if (alert.changePercent !== undefined && alert.changePercent !== null) {
        const change =
          alert.changePercent > 0
            ? `+${alert.changePercent.toFixed(1)}`
            : alert.changePercent.toFixed(1);
        details += `  - Change: ${change}%\n`;
      }

      return details;
    })
    .join('\n');
}

/**
 * Assembles the complete GitHub issue body for performance alerts.
 * @returns {string} The formatted Markdown string for the issue body.
 */
function generateIssueBody() {
  const criticalAlerts = parseJSON(CRITICAL_ALERTS, 'CRITICAL_ALERTS');

  const alertDetails = generateAlertDetails(criticalAlerts);

  return `## 🚨 Critical Performance Alerts Detected

**Alert Count**: ${criticalAlerts.length}
**Detection Time**: ${new Date().toISOString()}
**Workflow**: [${GITHUB_WORKFLOW}](${GITHUB_REPO_URL}/actions/runs/${GITHUB_RUN_ID})

### Critical Alerts:

${alertDetails}

### Recommended Actions:
1. Review test performance metrics in the dashboard
2. Investigate slow or failing tests
3. Check for recent changes that might impact performance
4. Consider optimizing test setup or infrastructure

### Dashboard Links:
- [Performance Dashboard](${GITHUB_REPO_URL}/actions/artifacts)
- [Workflow Run](${GITHUB_REPO_URL}/actions/runs/${GITHUB_RUN_ID})

---
*This issue was automatically created by the Test Performance Monitoring workflow.*`;
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

#!/usr/bin/env tsx

/**
 * CI Performance Report Generator
 * Generates detailed performance reports for CI/CD pipeline
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

interface PerformanceReportConfig {
  artifactsDir: string;
  outputFormat: 'markdown' | 'html' | 'json';
  includePreviousRuns: number;
  githubActionsOutput: boolean;
}

interface CIEnvironment {
  isCI: boolean;
  provider?: string;
  buildId?: string;
  pullRequestNumber?: string;
  branch?: string;
  commit?: string;
  actor?: string;
}

class CIPerformanceReporter {
  private config: PerformanceReportConfig;
  private env: CIEnvironment;

  constructor(config?: Partial<PerformanceReportConfig>) {
    this.config = {
      artifactsDir: 'benchmark-results',
      outputFormat: 'markdown',
      includePreviousRuns: 5,
      githubActionsOutput: true,
      ...config,
    };

    this.env = this.detectCIEnvironment();
  }

  private detectCIEnvironment(): CIEnvironment {
    const env: CIEnvironment = {
      isCI: Boolean(process.env.CI),
    };

    // GitHub Actions
    if (process.env.GITHUB_ACTIONS) {
      env.provider = 'GitHub Actions';
      env.buildId = process.env.GITHUB_RUN_ID;
      env.pullRequestNumber =
        process.env.GITHUB_EVENT_NAME === 'pull_request'
          ? process.env.GITHUB_REF?.split('/')[2]
          : undefined;
      env.branch = process.env.GITHUB_REF_NAME;
      env.commit = process.env.GITHUB_SHA?.substring(0, 7);
      env.actor = process.env.GITHUB_ACTOR;
    }

    return env;
  }

  async generateReport(): Promise<void> {
    console.log('📊 Generating CI Performance Report...\n');

    // Load latest benchmark results
    const latestResults = this.loadLatestResults();
    if (!latestResults) {
      console.error('❌ No benchmark results found');
      process.exit(1);
    }

    // Load previous runs for comparison
    const previousRuns = this.loadPreviousRuns();

    // Generate report based on format
    let report: string;
    switch (this.config.outputFormat) {
      case 'markdown':
        report = this.generateMarkdownReport(latestResults, previousRuns);
        break;
      case 'html':
        report = this.generateHTMLReport(latestResults, previousRuns);
        break;
      case 'json':
        report = JSON.stringify({ latest: latestResults, previous: previousRuns }, null, 2);
        break;
    }

    // Save report
    const reportPath = this.saveReport(report);
    console.log(`✅ Report saved to: ${reportPath}`);

    // Output for GitHub Actions
    if (this.config.githubActionsOutput && this.env.provider === 'GitHub Actions') {
      this.outputForGitHubActions(latestResults);
    }

    // Set exit code based on performance thresholds
    const exitCode = latestResults.comparison?.passed === false ? 1 : 0;
    if (exitCode !== 0) {
      console.error('\n❌ Performance thresholds exceeded!');
    } else {
      console.log('\n✅ All performance thresholds passed!');
    }
    process.exit(exitCode);
  }

  private loadLatestResults(): any {
    const latestPath = path.join(this.config.artifactsDir, 'latest.json');
    if (!existsSync(latestPath)) {
      return null;
    }
    return JSON.parse(readFileSync(latestPath, 'utf8'));
  }

  private loadPreviousRuns(): any[] {
    const runs: any[] = [];
    try {
      const files = require('fs').readdirSync(this.config.artifactsDir);
      const benchmarkFiles = files
        .filter((f: string) => f.startsWith('benchmark-') && f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(1, this.config.includePreviousRuns + 1);

      for (const file of benchmarkFiles) {
        const content = readFileSync(path.join(this.config.artifactsDir, file), 'utf8');
        runs.push(JSON.parse(content));
      }
    } catch (error) {
      console.warn('⚠️  Could not load previous runs');
    }
    return runs;
  }

  private generateMarkdownReport(latest: any, previous: any[]): string {
    let report = `# 🚀 Performance Report\n\n`;

    // CI Environment info
    if (this.env.isCI) {
      report += `## 📍 CI Environment\n\n`;
      report += `- **Provider**: ${this.env.provider || 'Unknown'}\n`;
      report += `- **Build ID**: ${this.env.buildId || 'N/A'}\n`;
      report += `- **Branch**: ${this.env.branch || 'N/A'}\n`;
      report += `- **Commit**: ${this.env.commit || 'N/A'}\n`;
      if (this.env.pullRequestNumber) {
        report += `- **Pull Request**: #${this.env.pullRequestNumber}\n`;
      }
      report += `- **Actor**: ${this.env.actor || 'N/A'}\n`;
      report += `- **Timestamp**: ${latest.timestamp}\n\n`;
    }

    // Summary
    report += `## 📊 Summary\n\n`;
    if (latest.comparison?.passed === false) {
      report += `> ❌ **Performance regression detected!**\n\n`;
      report += `### Failed Thresholds:\n\n`;
      for (const reason of latest.comparison.failureReasons) {
        report += `- ${reason}\n`;
      }
      report += '\n';
    } else {
      report += `> ✅ **All performance thresholds passed!**\n\n`;
    }

    // Current Metrics
    report += `## 📈 Current Metrics\n\n`;
    report += this.formatMetricsTable(latest.metrics);

    // Comparison with Baseline
    if (latest.comparison) {
      report += `## 🔄 Comparison with Baseline\n\n`;
      report += this.formatComparisonTable(latest.comparison.differences);
    }

    // Historical Trends
    if (previous.length > 0) {
      report += `## 📉 Historical Trends\n\n`;
      report += this.formatTrendsTable(latest, previous);
    }

    // Recommendations
    report += `## 💡 Recommendations\n\n`;
    report += this.generateRecommendations(latest);

    return report;
  }

  private generateHTMLReport(latest: any, previous: any[]): string {
    // Simplified HTML report
    return `<!DOCTYPE html>
<html>
<head>
  <title>Performance Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .summary { background: #f0f0f0; padding: 10px; border-radius: 5px; }
    .pass { color: green; }
    .fail { color: red; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
    .metric-increase { color: red; }
    .metric-decrease { color: green; }
  </style>
</head>
<body>
  <h1>🚀 Performance Report</h1>
  
  <div class="summary">
    <h2>Summary</h2>
    <p class="${latest.comparison?.passed === false ? 'fail' : 'pass'}">
      ${latest.comparison?.passed === false ? '❌ Performance regression detected!' : '✅ All performance thresholds passed!'}
    </p>
  </div>
  
  <h2>Current Metrics</h2>
  ${this.formatMetricsHTML(latest.metrics)}
  
  ${
    latest.comparison
      ? `
    <h2>Comparison with Baseline</h2>
    ${this.formatComparisonHTML(latest.comparison.differences)}
  `
      : ''
  }
  
</body>
</html>`;
  }

  private formatMetricsTable(metrics: any): string {
    return `| Metric | Value |
|--------|-------|
| **Test Execution Times** | |
| Unit Tests | ${this.formatTime(metrics.testExecutionTime.unit)} |
| Integration Tests | ${this.formatTime(metrics.testExecutionTime.integration)} |
| E2E Tests | ${this.formatTime(metrics.testExecutionTime.e2e)} |
| Total Test Time | ${this.formatTime(metrics.testExecutionTime.total)} |
| **Bundle Sizes** | |
| Main Bundle | ${this.formatBytes(metrics.bundleSize.main)} |
| Vendor Bundle | ${this.formatBytes(metrics.bundleSize.vendor)} |
| Total Bundle Size | ${this.formatBytes(metrics.bundleSize.total)} |
| **Build Times** | |
| Frontend Build | ${this.formatTime(metrics.buildTime.frontend)} |
| Backend Build | ${this.formatTime(metrics.buildTime.backend)} |
| Total Build Time | ${this.formatTime(metrics.buildTime.total)} |
| **Memory Usage** | |
| Heap Used | ${this.formatBytes(metrics.memoryUsage.heapUsed)} |
| RSS | ${this.formatBytes(metrics.memoryUsage.rss)} |

`;
  }

  private formatComparisonTable(differences: any): string {
    let table = `| Metric | Baseline | Current | Change | Status |
|--------|----------|---------|--------|--------|
`;

    for (const [metric, data] of Object.entries(differences)) {
      const { current, baseline, diff, percentChange, unit } = data as any;
      const changeSymbol = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
      const changeColor = diff > 0 ? '🔴' : diff < 0 ? '🟢' : '⚪';

      table += `| ${metric} | ${this.formatValue(baseline, unit)} | ${this.formatValue(current, unit)} | ${changeSymbol} ${percentChange} | ${changeColor} |\n`;
    }

    return table;
  }

  private formatTrendsTable(latest: any, previous: any[]): string {
    const runs = [latest, ...previous].slice(0, 5);

    let table = `| Run | Test Time | Bundle Size | Build Time | Memory |
|-----|-----------|-------------|------------|--------|
`;

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const label = i === 0 ? 'Latest' : `${i} runs ago`;

      table += `| ${label} | ${this.formatTime(run.metrics.testExecutionTime.total)} | ${this.formatBytes(run.metrics.bundleSize.total)} | ${this.formatTime(run.metrics.buildTime.total)} | ${this.formatBytes(run.metrics.memoryUsage.heapUsed)} |\n`;
    }

    return table;
  }

  private formatMetricsHTML(metrics: any): string {
    // Simplified HTML table formatting
    return (
      '<table><tr><th>Metric</th><th>Value</th></tr>' +
      Object.entries(metrics)
        .map(([category, values]) =>
          Object.entries(values as any)
            .map(([metric, value]) => `<tr><td>${category}.${metric}</td><td>${value}</td></tr>`)
            .join('')
        )
        .join('') +
      '</table>'
    );
  }

  private formatComparisonHTML(differences: any): string {
    // Simplified HTML comparison table
    return (
      '<table><tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Change</th></tr>' +
      Object.entries(differences)
        .map(([metric, data]) => {
          const { current, baseline, percentChange } = data as any;
          const changeClass = current > baseline ? 'metric-increase' : 'metric-decrease';
          return `<tr><td>${metric}</td><td>${baseline}</td><td>${current}</td><td class="${changeClass}">${percentChange}</td></tr>`;
        })
        .join('') +
      '</table>'
    );
  }

  private generateRecommendations(results: any): string {
    const recommendations: string[] = [];
    const metrics = results.metrics;

    // Test execution time recommendations
    if (metrics.testExecutionTime.total > 180000) {
      // > 3 minutes
      recommendations.push('- Consider parallelizing test execution to reduce total test time');
    }
    if (metrics.testExecutionTime.unit > 20000) {
      // > 20 seconds
      recommendations.push('- Unit tests are taking too long. Review and optimize slow unit tests');
    }

    // Bundle size recommendations
    if (metrics.bundleSize.total > 1572864) {
      // > 1.5MB
      recommendations.push('- Bundle size is large. Consider code splitting and lazy loading');
      recommendations.push(
        '- Analyze bundle with webpack-bundle-analyzer to identify large dependencies'
      );
    }

    // Build time recommendations
    if (metrics.buildTime.total > 60000) {
      // > 1 minute
      recommendations.push(
        '- Build time is high. Consider using build caching and incremental builds'
      );
    }

    // Memory usage recommendations
    if (metrics.memoryUsage.heapUsed > 402653184) {
      // > 384MB
      recommendations.push(
        '- High memory usage detected. Check for memory leaks and optimize data structures'
      );
    }

    if (recommendations.length === 0) {
      recommendations.push('- Performance metrics are within acceptable ranges');
      recommendations.push('- Continue monitoring for regressions');
    }

    return recommendations.join('\n');
  }

  private outputForGitHubActions(results: any): void {
    // Output summary for GitHub Actions
    const summary = [];

    if (results.comparison?.passed === false) {
      summary.push('❌ Performance regression detected!');
      summary.push('');
      summary.push('Failed thresholds:');
      for (const reason of results.comparison.failureReasons) {
        summary.push(`- ${reason}`);
      }
    } else {
      summary.push('✅ All performance thresholds passed!');
    }

    // Set output variables
    console.log(
      `::set-output name=performance-status::${results.comparison?.passed === false ? 'failed' : 'passed'}`
    );
    console.log(
      `::set-output name=test-time::${this.formatTime(results.metrics.testExecutionTime.total)}`
    );
    console.log(
      `::set-output name=bundle-size::${this.formatBytes(results.metrics.bundleSize.total)}`
    );
    console.log(
      `::set-output name=build-time::${this.formatTime(results.metrics.buildTime.total)}`
    );

    // Add summary to job summary
    if (process.env.GITHUB_STEP_SUMMARY) {
      const summaryPath = process.env.GITHUB_STEP_SUMMARY;
      const summaryContent = summary.join('\n');
      writeFileSync(summaryPath, summaryContent);
    }
  }

  private saveReport(report: string): string {
    const extension =
      this.config.outputFormat === 'html'
        ? 'html'
        : this.config.outputFormat === 'json'
          ? 'json'
          : 'md';
    const filename = `performance-report.${extension}`;
    const filepath = path.join(this.config.artifactsDir, filename);

    writeFileSync(filepath, report);
    return filepath;
  }

  private formatTime(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  }

  private formatValue(value: number, unit: string): string {
    switch (unit) {
      case 'ms':
        return this.formatTime(value);
      case 'bytes':
        return this.formatBytes(value);
      default:
        return value.toString();
    }
  }
}

// Main execution
async function main() {
  const reporter = new CIPerformanceReporter({
    outputFormat: (process.env.REPORT_FORMAT as any) || 'markdown',
    githubActionsOutput: process.env.GITHUB_ACTIONS === 'true',
  });

  await reporter.generateReport();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ CI Performance report generation failed:', error);
    process.exit(1);
  });
}

export { CIPerformanceReporter };

#!/usr/bin/env node

/**
 * Coverage Trend Tracker
 *
 * Tracks test coverage over time, generates trend visualizations,
 * and enforces coverage thresholds across all test suites.
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class CoverageTrendTracker {
  constructor(options = {}) {
    this.options = {
      outputDir: options.outputDir || './reports/coverage-trends',
      historyFile: options.historyFile || 'coverage-history.json',
      thresholds: options.thresholds || {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      maxHistoryLength: options.maxHistoryLength || 90, // 90 days of history
      failOnThreshold: options.failOnThreshold !== false,
      ...options,
    };

    this.coverageHistory = [];
    this.currentCoverage = null;
  }

  /**
   * Initialize the coverage trend tracker
   */
  async initialize() {
    await this.ensureOutputDir();
    await this.loadHistory();
    console.log('📊 Coverage Trend Tracker initialized');
  }

  /**
   * Ensure output directory exists
   */
  async ensureOutputDir() {
    try {
      await fs.mkdir(this.options.outputDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create output directory:', error);
      throw error;
    }
  }

  /**
   * Load coverage history from previous runs
   */
  async loadHistory() {
    try {
      const historyPath = path.join(this.options.outputDir, this.options.historyFile);
      const historyData = await fs.readFile(historyPath, 'utf8');
      this.coverageHistory = JSON.parse(historyData);
      console.log(`📚 Loaded ${this.coverageHistory.length} historical coverage entries`);
    } catch (error) {
      console.log('📝 No previous coverage history found, starting fresh');
      this.coverageHistory = [];
    }
  }

  /**
   * Save coverage history to disk
   */
  async saveHistory() {
    try {
      const historyPath = path.join(this.options.outputDir, this.options.historyFile);

      // Trim history to max length
      if (this.coverageHistory.length > this.options.maxHistoryLength) {
        this.coverageHistory = this.coverageHistory.slice(-this.options.maxHistoryLength);
      }

      await fs.writeFile(historyPath, JSON.stringify(this.coverageHistory, null, 2));
      console.log('💾 Coverage history saved');
    } catch (error) {
      console.error('Failed to save coverage history:', error);
    }
  }

  /**
   * Collect coverage data from all test suites
   */
  async collectCoverage() {
    console.log('🔍 Collecting coverage data from all test suites...\n');

    const coverage = {
      timestamp: new Date().toISOString(),
      date: new Date().toLocaleDateString(),
      commit: await this.getGitCommit(),
      branch: await this.getGitBranch(),
      suites: {},
      overall: {
        statements: { total: 0, covered: 0, percentage: 0 },
        branches: { total: 0, covered: 0, percentage: 0 },
        functions: { total: 0, covered: 0, percentage: 0 },
        lines: { total: 0, covered: 0, percentage: 0 },
      },
    };

    // Collect unit test coverage (Vitest)
    const unitCoverage = await this.collectUnitCoverage();
    if (unitCoverage) {
      coverage.suites.unit = unitCoverage;
      this.aggregateCoverage(coverage.overall, unitCoverage);
    }

    // Collect integration test coverage (Jest)
    const integrationCoverage = await this.collectIntegrationCoverage();
    if (integrationCoverage) {
      coverage.suites.integration = integrationCoverage;
      this.aggregateCoverage(coverage.overall, integrationCoverage);
    }

    // Calculate overall percentages
    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
      if (coverage.overall[metric].total > 0) {
        coverage.overall[metric].percentage = (
          (coverage.overall[metric].covered / coverage.overall[metric].total) *
          100
        ).toFixed(2);
      }
    }

    this.currentCoverage = coverage;
    return coverage;
  }

  /**
   * Collect unit test coverage (Vitest)
   */
  async collectUnitCoverage() {
    try {
      console.log('📦 Collecting unit test coverage...');

      // Run unit tests with coverage
      await execAsync('npm run test:coverage', { maxBuffer: 1024 * 1024 * 10 });

      // Read coverage summary
      const summaryPath = path.join(process.cwd(), 'coverage/coverage-summary.json');
      const summaryData = await fs.readFile(summaryPath, 'utf8');
      const summary = JSON.parse(summaryData);

      const coverage = {
        statements: this.extractMetric(summary.total.statements),
        branches: this.extractMetric(summary.total.branches),
        functions: this.extractMetric(summary.total.functions),
        lines: this.extractMetric(summary.total.lines),
      };

      console.log(`✅ Unit test coverage collected`);
      return coverage;
    } catch (error) {
      console.error('❌ Failed to collect unit test coverage:', error.message);
      return null;
    }
  }

  /**
   * Collect integration test coverage (Jest)
   */
  async collectIntegrationCoverage() {
    try {
      console.log('🔗 Collecting integration test coverage...');

      // Run integration tests with coverage
      await execAsync('npm run test:coverage:integration', { maxBuffer: 1024 * 1024 * 10 });

      // Read coverage summary
      const summaryPath = path.join(process.cwd(), 'coverage-integration/coverage-summary.json');
      const summaryData = await fs.readFile(summaryPath, 'utf8');
      const summary = JSON.parse(summaryData);

      const coverage = {
        statements: this.extractMetric(summary.total.statements),
        branches: this.extractMetric(summary.total.branches),
        functions: this.extractMetric(summary.total.functions),
        lines: this.extractMetric(summary.total.lines),
      };

      console.log(`✅ Integration test coverage collected`);
      return coverage;
    } catch (error) {
      console.error('❌ Failed to collect integration test coverage:', error.message);
      return null;
    }
  }

  /**
   * Extract metric data from coverage summary
   */
  extractMetric(metric) {
    return {
      total: metric.total || 0,
      covered: metric.covered || 0,
      percentage: metric.pct || 0,
    };
  }

  /**
   * Aggregate coverage data
   */
  aggregateCoverage(overall, suite) {
    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
      overall[metric].total += suite[metric].total;
      overall[metric].covered += suite[metric].covered;
    }
  }

  /**
   * Get current git commit
   */
  async getGitCommit() {
    try {
      const { stdout } = await execAsync('git rev-parse --short HEAD');
      return stdout.trim();
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Get current git branch
   */
  async getGitBranch() {
    try {
      const { stdout } = await execAsync('git branch --show-current');
      return stdout.trim();
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Analyze coverage trends
   */
  analyzeTrends() {
    if (this.coverageHistory.length < 2) {
      return {
        hasEnoughData: false,
        message: 'Not enough historical data for trend analysis',
      };
    }

    const recent = this.coverageHistory.slice(-30); // Last 30 entries
    const trends = {
      statements: this.calculateTrend(recent, 'statements'),
      branches: this.calculateTrend(recent, 'branches'),
      functions: this.calculateTrend(recent, 'functions'),
      lines: this.calculateTrend(recent, 'lines'),
    };

    // Calculate overall trend
    const overallTrend = Object.values(trends).reduce((sum, trend) => sum + trend.slope, 0) / 4;

    return {
      hasEnoughData: true,
      trends,
      overallTrend,
      direction: overallTrend > 0.1 ? 'improving' : overallTrend < -0.1 ? 'declining' : 'stable',
      recommendation: this.getTrendRecommendation(trends, overallTrend),
    };
  }

  /**
   * Calculate trend for a specific metric
   */
  calculateTrend(data, metric) {
    const values = data.map(d => parseFloat(d.overall[metric].percentage));

    // Simple linear regression
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, i) => sum + val * i, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const current = values[values.length - 1];
    const previous = values[values.length - 2];
    const change = current - previous;

    return {
      current,
      previous,
      change,
      changePercent: previous > 0 ? (change / previous) * 100 : 0,
      slope,
      intercept,
      direction: slope > 0.1 ? 'up' : slope < -0.1 ? 'down' : 'stable',
    };
  }

  /**
   * Get trend recommendation
   */
  getTrendRecommendation(trends, overallTrend) {
    const recommendations = [];

    if (overallTrend < -0.5) {
      recommendations.push('⚠️ Coverage is declining significantly. Review recent changes.');
    } else if (overallTrend > 0.5) {
      recommendations.push('✅ Coverage is improving! Keep up the good work.');
    }

    // Check individual metrics
    for (const [metric, trend] of Object.entries(trends)) {
      if (trend.current < this.options.thresholds[metric]) {
        recommendations.push(
          `📉 ${metric} coverage (${trend.current}%) is below threshold (${this.options.thresholds[metric]}%)`
        );
      }
      if (trend.change < -5) {
        recommendations.push(
          `⚠️ ${metric} coverage dropped by ${Math.abs(trend.change).toFixed(1)}%`
        );
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ Coverage is stable and meeting all thresholds');
    }

    return recommendations;
  }

  /**
   * Check coverage thresholds
   */
  checkThresholds() {
    const results = {
      passed: true,
      failures: [],
      warnings: [],
    };

    if (!this.currentCoverage) {
      results.passed = false;
      results.failures.push('No coverage data available');
      return results;
    }

    for (const [metric, threshold] of Object.entries(this.options.thresholds)) {
      const current = parseFloat(this.currentCoverage.overall[metric].percentage);

      if (current < threshold) {
        results.passed = false;
        results.failures.push({
          metric,
          current,
          threshold,
          diff: (current - threshold).toFixed(2),
        });
      } else if (current < threshold + 5) {
        results.warnings.push({
          metric,
          current,
          threshold,
          margin: (current - threshold).toFixed(2),
        });
      }
    }

    return results;
  }

  /**
   * Generate coverage reports
   */
  async generateReports() {
    console.log('\n📝 Generating coverage trend reports...');

    // Add current coverage to history
    if (this.currentCoverage) {
      this.coverageHistory.push(this.currentCoverage);
      await this.saveHistory();
    }

    // Generate JSON report
    await this.generateJsonReport();

    // Generate HTML dashboard
    await this.generateHtmlDashboard();

    // Generate trend chart
    await this.generateTrendChart();

    // Generate markdown summary
    await this.generateMarkdownSummary();

    console.log(`📊 Coverage reports generated in ${this.options.outputDir}`);
  }

  /**
   * Generate JSON report
   */
  async generateJsonReport() {
    const analysis = this.analyzeTrends();
    const thresholdResults = this.checkThresholds();

    const report = {
      timestamp: new Date().toISOString(),
      current: this.currentCoverage,
      history: {
        entries: this.coverageHistory.length,
        dateRange: {
          start: this.coverageHistory[0]?.date,
          end: this.coverageHistory[this.coverageHistory.length - 1]?.date,
        },
      },
      analysis,
      thresholds: {
        configured: this.options.thresholds,
        results: thresholdResults,
      },
    };

    const reportPath = path.join(this.options.outputDir, 'coverage-trend-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  }

  /**
   * Generate HTML dashboard
   */
  async generateHtmlDashboard() {
    const analysis = this.analyzeTrends();
    const thresholdResults = this.checkThresholds();

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Coverage Trend Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: white; padding: 30px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header h1 { margin: 0; color: #333; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-value { font-size: 2.5em; font-weight: bold; margin: 10px 0; }
        .metric-name { color: #666; font-size: 0.9em; text-transform: uppercase; }
        .percentage { font-size: 0.5em; color: #666; }
        .change { font-size: 0.4em; margin-left: 10px; }
        .positive { color: #4caf50; }
        .negative { color: #f44336; }
        .neutral { color: #666; }
        .threshold-status { padding: 5px 10px; border-radius: 20px; font-size: 0.8em; display: inline-block; margin-top: 10px; }
        .passed { background: #e8f5e9; color: #2e7d32; }
        .failed { background: #ffebee; color: #c62828; }
        .warning { background: #fff8e1; color: #f57c00; }
        .chart-container { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .chart-title { font-size: 1.2em; font-weight: bold; margin-bottom: 20px; color: #333; }
        .recommendations { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 20px; margin: 20px 0; border-radius: 0 4px 4px 0; }
        .threshold-table { width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .threshold-table th, .threshold-table td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        .threshold-table th { background: #f5f5f5; font-weight: bold; }
        .threshold-table tr:last-child td { border-bottom: none; }
        .footer { text-align: center; color: #666; margin-top: 40px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Coverage Trend Dashboard</h1>
            <p>Generated on ${new Date().toLocaleString()}</p>
            ${
              this.currentCoverage
                ? `
            <p>Branch: <strong>${this.currentCoverage.branch}</strong> | Commit: <code>${this.currentCoverage.commit}</code></p>
            `
                : ''
            }
        </div>
        
        ${
          this.currentCoverage
            ? `
        <div class="stats">
            ${['statements', 'branches', 'functions', 'lines']
              .map(metric => {
                const current = this.currentCoverage.overall[metric];
                const trend = analysis.hasEnoughData ? analysis.trends[metric] : null;
                const threshold = this.options.thresholds[metric];
                const status = current.percentage >= threshold ? 'passed' : 'failed';

                return `
                <div class="stat-card">
                    <div class="metric-name">${metric}</div>
                    <div class="stat-value ${status === 'passed' ? 'positive' : 'negative'}">
                        ${current.percentage}<span class="percentage">%</span>
                        ${
                          trend
                            ? `
                        <span class="change ${trend.change > 0 ? 'positive' : trend.change < 0 ? 'negative' : 'neutral'}">
                            ${trend.change > 0 ? '↑' : trend.change < 0 ? '↓' : '→'} ${Math.abs(trend.change).toFixed(1)}%
                        </span>
                        `
                            : ''
                        }
                    </div>
                    <div>${current.covered} / ${current.total} covered</div>
                    <div class="threshold-status ${status}">
                        Threshold: ${threshold}% ${status === 'passed' ? '✓' : '✗'}
                    </div>
                </div>
                `;
              })
              .join('')}
        </div>
        `
            : '<p>No current coverage data available</p>'
        }
        
        <div class="chart-container">
            <div class="chart-title">Coverage Trends (Last 30 Days)</div>
            <canvas id="trendChart" height="100"></canvas>
        </div>
        
        ${
          thresholdResults.failures.length > 0 || thresholdResults.warnings.length > 0
            ? `
        <div class="chart-container">
            <div class="chart-title">Threshold Status</div>
            <table class="threshold-table">
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Current</th>
                        <th>Threshold</th>
                        <th>Status</th>
                        <th>Difference</th>
                    </tr>
                </thead>
                <tbody>
                    ${thresholdResults.failures
                      .map(
                        f => `
                    <tr>
                        <td>${f.metric}</td>
                        <td class="negative">${f.current}%</td>
                        <td>${f.threshold}%</td>
                        <td><span class="threshold-status failed">Failed</span></td>
                        <td class="negative">${f.diff}%</td>
                    </tr>
                    `
                      )
                      .join('')}
                    ${thresholdResults.warnings
                      .map(
                        w => `
                    <tr>
                        <td>${w.metric}</td>
                        <td class="neutral">${w.current}%</td>
                        <td>${w.threshold}%</td>
                        <td><span class="threshold-status warning">Warning</span></td>
                        <td class="neutral">+${w.margin}%</td>
                    </tr>
                    `
                      )
                      .join('')}
                </tbody>
            </table>
        </div>
        `
            : ''
        }
        
        ${
          analysis.hasEnoughData && analysis.recommendation.length > 0
            ? `
        <div class="recommendations">
            <h3>📋 Recommendations</h3>
            ${analysis.recommendation.map(rec => `<p>${rec}</p>`).join('')}
        </div>
        `
            : ''
        }
        
        <div class="footer">
            <p>Coverage data collected from ${this.coverageHistory.length} test runs</p>
        </div>
    </div>
    
    <script>
        // Prepare chart data
        const chartData = ${JSON.stringify(this.prepareChartData())};
        
        // Create trend chart
        const ctx = document.getElementById('trendChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [
                    {
                        label: 'Statements',
                        data: chartData.statements,
                        borderColor: '#4caf50',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        tension: 0.1
                    },
                    {
                        label: 'Branches',
                        data: chartData.branches,
                        borderColor: '#2196f3',
                        backgroundColor: 'rgba(33, 150, 243, 0.1)',
                        tension: 0.1
                    },
                    {
                        label: 'Functions',
                        data: chartData.functions,
                        borderColor: '#ff9800',
                        backgroundColor: 'rgba(255, 152, 0, 0.1)',
                        tension: 0.1
                    },
                    {
                        label: 'Lines',
                        data: chartData.lines,
                        borderColor: '#9c27b0',
                        backgroundColor: 'rgba(156, 39, 176, 0.1)',
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>
    `;

    const dashboardPath = path.join(this.options.outputDir, 'coverage-trend-dashboard.html');
    await fs.writeFile(dashboardPath, html);
  }

  /**
   * Prepare chart data for visualization
   */
  prepareChartData() {
    const recent = this.coverageHistory.slice(-30);

    return {
      labels: recent.map(d => d.date),
      statements: recent.map(d => parseFloat(d.overall.statements.percentage)),
      branches: recent.map(d => parseFloat(d.overall.branches.percentage)),
      functions: recent.map(d => parseFloat(d.overall.functions.percentage)),
      lines: recent.map(d => parseFloat(d.overall.lines.percentage)),
    };
  }

  /**
   * Generate trend chart as SVG
   */
  async generateTrendChart() {
    const chartData = this.prepareChartData();

    // Simple SVG chart generation
    const width = 800;
    const height = 400;
    const padding = 40;
    const chartWidth = width - 2 * padding;
    const chartHeight = height - 2 * padding;

    const maxY = 100;
    const xStep = chartWidth / (chartData.labels.length - 1);

    const createPath = (data, color) => {
      const points = data
        .map((value, index) => {
          const x = padding + index * xStep;
          const y = padding + (1 - value / maxY) * chartHeight;
          return `${x},${y}`;
        })
        .join(' ');

      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>`;
    };

    const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <!-- Grid -->
  ${[0, 25, 50, 75, 100]
    .map(y => {
      const yPos = padding + (1 - y / maxY) * chartHeight;
      return `
      <line x1="${padding}" y1="${yPos}" x2="${width - padding}" y2="${yPos}" stroke="#eee" stroke-width="1"/>
      <text x="${padding - 5}" y="${yPos + 5}" text-anchor="end" font-size="12" fill="#666">${y}%</text>
    `;
    })
    .join('')}
  
  <!-- Data lines -->
  ${createPath(chartData.statements, '#4caf50')}
  ${createPath(chartData.branches, '#2196f3')}
  ${createPath(chartData.functions, '#ff9800')}
  ${createPath(chartData.lines, '#9c27b0')}
  
  <!-- Legend -->
  <rect x="${width - 150}" y="10" width="15" height="15" fill="#4caf50"/>
  <text x="${width - 130}" y="22" font-size="12" fill="#666">Statements</text>
  
  <rect x="${width - 150}" y="30" width="15" height="15" fill="#2196f3"/>
  <text x="${width - 130}" y="42" font-size="12" fill="#666">Branches</text>
  
  <rect x="${width - 150}" y="50" width="15" height="15" fill="#ff9800"/>
  <text x="${width - 130}" y="62" font-size="12" fill="#666">Functions</text>
  
  <rect x="${width - 150}" y="70" width="15" height="15" fill="#9c27b0"/>
  <text x="${width - 130}" y="82" font-size="12" fill="#666">Lines</text>
</svg>
    `;

    const chartPath = path.join(this.options.outputDir, 'coverage-trend-chart.svg');
    await fs.writeFile(chartPath, svg);
  }

  /**
   * Generate markdown summary
   */
  async generateMarkdownSummary() {
    const analysis = this.analyzeTrends();
    const thresholdResults = this.checkThresholds();

    const summary = `# Coverage Trend Report

**Generated:** ${new Date().toLocaleString()}
${
  this.currentCoverage
    ? `
**Branch:** ${this.currentCoverage.branch}  
**Commit:** ${this.currentCoverage.commit}
`
    : ''
}

## 📊 Current Coverage

${
  this.currentCoverage
    ? `
| Metric | Coverage | Threshold | Status |
|--------|----------|-----------|---------|
| Statements | ${this.currentCoverage.overall.statements.percentage}% | ${this.options.thresholds.statements}% | ${this.currentCoverage.overall.statements.percentage >= this.options.thresholds.statements ? '✅' : '❌'} |
| Branches | ${this.currentCoverage.overall.branches.percentage}% | ${this.options.thresholds.branches}% | ${this.currentCoverage.overall.branches.percentage >= this.options.thresholds.branches ? '✅' : '❌'} |
| Functions | ${this.currentCoverage.overall.functions.percentage}% | ${this.options.thresholds.functions}% | ${this.currentCoverage.overall.functions.percentage >= this.options.thresholds.functions ? '✅' : '❌'} |
| Lines | ${this.currentCoverage.overall.lines.percentage}% | ${this.options.thresholds.lines}% | ${this.currentCoverage.overall.lines.percentage >= this.options.thresholds.lines ? '✅' : '❌'} |
`
    : 'No current coverage data available'
}

## 📈 Coverage Trends

${
  analysis.hasEnoughData
    ? `
**Overall Trend:** ${analysis.direction} (${analysis.overallTrend > 0 ? '+' : ''}${analysis.overallTrend.toFixed(2)}% per day)

### Metric Trends
| Metric | Current | Previous | Change | Trend |
|--------|---------|----------|--------|-------|
${['statements', 'branches', 'functions', 'lines']
  .map(metric => {
    const trend = analysis.trends[metric];
    return `| ${metric} | ${trend.current}% | ${trend.previous}% | ${trend.change > 0 ? '+' : ''}${trend.change.toFixed(1)}% | ${trend.direction === 'up' ? '📈' : trend.direction === 'down' ? '📉' : '➡️'} |`;
  })
  .join('\n')}
`
    : 'Not enough historical data for trend analysis'
}

## 🎯 Threshold Results

${thresholdResults.passed ? '✅ **All coverage thresholds met!**' : '❌ **Coverage below configured thresholds**'}

${
  thresholdResults.failures.length > 0
    ? `
### Failed Thresholds
${thresholdResults.failures.map(f => `- **${f.metric}**: ${f.current}% (threshold: ${f.threshold}%, difference: ${f.diff}%)`).join('\n')}
`
    : ''
}

${
  thresholdResults.warnings.length > 0
    ? `
### Warning - Close to Threshold
${thresholdResults.warnings.map(w => `- **${w.metric}**: ${w.current}% (threshold: ${w.threshold}%, margin: +${w.margin}%)`).join('\n')}
`
    : ''
}

## 📋 Recommendations

${
  analysis.hasEnoughData && analysis.recommendation.length > 0
    ? analysis.recommendation.map(rec => `- ${rec}`).join('\n')
    : '- ✅ Coverage is stable and meeting all thresholds'
}

## 📊 Historical Data

- **Total Entries:** ${this.coverageHistory.length}
- **Date Range:** ${this.coverageHistory[0]?.date || 'N/A'} to ${this.coverageHistory[this.coverageHistory.length - 1]?.date || 'N/A'}

---
*Generated by Coverage Trend Tracker*
`;

    const summaryPath = path.join(this.options.outputDir, 'coverage-trend-summary.md');
    await fs.writeFile(summaryPath, summary);
  }

  /**
   * Enforce coverage thresholds
   */
  async enforceThresholds() {
    const results = this.checkThresholds();

    if (!results.passed && this.options.failOnThreshold) {
      console.error('\n❌ Coverage thresholds not met:');
      results.failures.forEach(f => {
        console.error(`   - ${f.metric}: ${f.current}% < ${f.threshold}% (${f.diff}%)`);
      });
      process.exit(1);
    }

    if (results.warnings.length > 0) {
      console.warn('\n⚠️ Coverage warnings:');
      results.warnings.forEach(w => {
        console.warn(
          `   - ${w.metric}: ${w.current}% is close to threshold ${w.threshold}% (margin: +${w.margin}%)`
        );
      });
    }

    if (results.passed) {
      console.log('\n✅ All coverage thresholds met!');
    }
  }
}

// CLI functionality
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'track';

  const tracker = new CoverageTrendTracker({
    outputDir: process.env.COVERAGE_OUTPUT_DIR || './reports/coverage-trends',
    thresholds: {
      statements: parseInt(process.env.COVERAGE_THRESHOLD_STATEMENTS || '80'),
      branches: parseInt(process.env.COVERAGE_THRESHOLD_BRANCHES || '80'),
      functions: parseInt(process.env.COVERAGE_THRESHOLD_FUNCTIONS || '80'),
      lines: parseInt(process.env.COVERAGE_THRESHOLD_LINES || '80'),
    },
    failOnThreshold: process.env.FAIL_ON_COVERAGE_THRESHOLD !== 'false',
  });

  try {
    await tracker.initialize();

    switch (command) {
      case 'track':
        console.log('🔍 Starting coverage trend tracking...');
        await tracker.collectCoverage();
        await tracker.generateReports();
        await tracker.enforceThresholds();
        break;

      case 'collect':
        console.log('📊 Collecting coverage data...');
        const coverage = await tracker.collectCoverage();
        console.log('\nCoverage collected:');
        console.log(`  Statements: ${coverage.overall.statements.percentage}%`);
        console.log(`  Branches: ${coverage.overall.branches.percentage}%`);
        console.log(`  Functions: ${coverage.overall.functions.percentage}%`);
        console.log(`  Lines: ${coverage.overall.lines.percentage}%`);
        break;

      case 'report':
        console.log('📝 Generating coverage reports...');
        await tracker.generateReports();
        break;

      case 'analyze':
        console.log('📈 Analyzing coverage trends...');
        const analysis = tracker.analyzeTrends();
        console.log(JSON.stringify(analysis, null, 2));
        break;

      case 'check':
        console.log('🎯 Checking coverage thresholds...');
        await tracker.collectCoverage();
        await tracker.enforceThresholds();
        break;

      default:
        console.log('Usage: node coverage-trend-tracker.js [track|collect|report|analyze|check]');
        console.log('  track   - Collect coverage and generate reports (default)');
        console.log('  collect - Collect coverage data only');
        console.log('  report  - Generate reports from existing data');
        console.log('  analyze - Analyze coverage trends');
        console.log('  check   - Check coverage against thresholds');
        process.exit(1);
    }

    console.log('\n✅ Coverage trend tracking complete');
  } catch (error) {
    console.error('❌ Coverage trend tracking failed:', error);
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = CoverageTrendTracker;

// Run CLI if called directly
if (require.main === module) {
  main();
}

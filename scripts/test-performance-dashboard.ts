#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { TestResult, TestSuitePerformance, PerformanceTrend } from './test-performance-tracker';

interface DashboardData {
  performances: TestSuitePerformance[];
  detailedResults: TestResult[];
  lastUpdated: number;
  summary: {
    totalTests: number;
    averageDuration: number;
    overallPassRate: number;
    totalRuns: number;
  };
}

class TestPerformanceDashboard {
  private dataDir: string;
  private resultsFile: string;
  private dashboardFile: string;

  constructor() {
    this.dataDir = path.join(process.cwd(), 'test-performance-data');
    this.resultsFile = path.join(this.dataDir, 'test-results.json');
    this.dashboardFile = path.join(this.dataDir, 'dashboard.html');
  }

  generateDashboard(): void {
    console.log('📊 Generating test performance dashboard...');

    const data = this.loadPerformanceData();
    if (!data) {
      console.error('❌ No performance data found. Run test tracking first.');
      return;
    }

    const html = this.generateDashboardHTML(data);
    fs.writeFileSync(this.dashboardFile, html);

    console.log(`✅ Dashboard generated: ${this.dashboardFile}`);
    console.log(`🌐 Open in browser: file://${this.dashboardFile}`);
  }

  private loadPerformanceData(): DashboardData | null {
    if (!fs.existsSync(this.resultsFile)) {
      return null;
    }

    try {
      const rawData = JSON.parse(fs.readFileSync(this.resultsFile, 'utf-8'));

      // Calculate summary statistics
      const summary = {
        totalTests: rawData.detailedResults.length,
        averageDuration:
          rawData.detailedResults.length > 0
            ? rawData.detailedResults.reduce((sum: number, r: TestResult) => sum + r.duration, 0) /
              rawData.detailedResults.length
            : 0,
        overallPassRate:
          rawData.detailedResults.length > 0
            ? (rawData.detailedResults.filter((r: TestResult) => r.status === 'passed').length /
                rawData.detailedResults.length) *
              100
            : 0,
        totalRuns: rawData.performances.length,
      };

      return {
        performances: rawData.performances,
        detailedResults: rawData.detailedResults,
        lastUpdated: Date.now(),
        summary,
      };
    } catch (error) {
      console.error('Failed to load performance data:', error);
      return null;
    }
  }

  private generateDashboardHTML(data: DashboardData): string {
    const chartData = this.prepareChartData(data);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Performance Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .dashboard {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            border-radius: 10px;
            margin-bottom: 2rem;
            text-align: center;
        }
        .header h1 {
            margin: 0 0 0.5rem 0;
            font-size: 2.5rem;
        }
        .header p {
            margin: 0;
            opacity: 0.9;
            font-size: 1.1rem;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .stat-card {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        .stat-value {
            font-size: 2rem;
            font-weight: bold;
            color: #333;
            margin-bottom: 0.5rem;
        }
        .stat-label {
            color: #666;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
            gap: 2rem;
            margin-bottom: 2rem;
        }
        .chart-container {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .chart-title {
            font-size: 1.2rem;
            font-weight: bold;
            margin-bottom: 1rem;
            color: #333;
        }
        .chart-canvas {
            position: relative;
            height: 300px;
        }
        .table-container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .table-title {
            padding: 1.5rem 1.5rem 1rem 1.5rem;
            font-size: 1.2rem;
            font-weight: bold;
            color: #333;
            border-bottom: 1px solid #eee;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            text-align: left;
            padding: 1rem 1.5rem;
            border-bottom: 1px solid #eee;
        }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #333;
        }
        tr:hover {
            background-color: #f8f9fa;
        }
        .status-passed { color: #28a745; font-weight: bold; }
        .status-failed { color: #dc3545; font-weight: bold; }
        .status-skipped { color: #ffc107; font-weight: bold; }
        .trend-improving { color: #28a745; }
        .trend-degrading { color: #dc3545; }
        .trend-stable { color: #6c757d; }
        .footer {
            text-align: center;
            margin-top: 2rem;
            padding: 1rem;
            color: #666;
            font-size: 0.9rem;
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>📊 Test Performance Dashboard</h1>
            <p>Last updated: ${new Date(data.lastUpdated).toLocaleString()}</p>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${data.summary.totalTests.toLocaleString()}</div>
                <div class="stat-label">Total Tests</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${data.summary.averageDuration.toFixed(0)}ms</div>
                <div class="stat-label">Avg Duration</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${data.summary.overallPassRate.toFixed(1)}%</div>
                <div class="stat-label">Pass Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${data.summary.totalRuns}</div>
                <div class="stat-label">Test Runs</div>
            </div>
        </div>

        <div class="charts-grid">
            <div class="chart-container">
                <div class="chart-title">Test Duration Over Time</div>
                <div class="chart-canvas">
                    <canvas id="durationChart"></canvas>
                </div>
            </div>
            <div class="chart-container">
                <div class="chart-title">Pass Rate Trends</div>
                <div class="chart-canvas">
                    <canvas id="passRateChart"></canvas>
                </div>
            </div>
        </div>

        <div class="charts-grid">
            <div class="chart-container">
                <div class="chart-title">Test Count by Suite</div>
                <div class="chart-canvas">
                    <canvas id="suiteChart"></canvas>
                </div>
            </div>
            <div class="chart-container">
                <div class="chart-title">Performance Distribution</div>
                <div class="chart-canvas">
                    <canvas id="distributionChart"></canvas>
                </div>
            </div>
        </div>

        <div class="table-container">
            <div class="table-title">🐌 Slowest Tests</div>
            <table>
                <thead>
                    <tr>
                        <th>Test Name</th>
                        <th>Suite</th>
                        <th>Duration</th>
                        <th>Status</th>
                        <th>File</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.generateSlowestTestsTable(data.detailedResults)}
                </tbody>
            </table>
        </div>

        <div class="footer">
            Generated by Test Performance Tracker • Running App MVP
        </div>
    </div>

    <script>
        // Chart data
        const chartData = ${JSON.stringify(chartData)};
        
        // Duration Chart
        new Chart(document.getElementById('durationChart'), {
            type: 'line',
            data: {
                labels: chartData.timeLabels,
                datasets: [{
                    label: 'Unit Tests',
                    data: chartData.unitDurations,
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    tension: 0.4
                }, {
                    label: 'Integration Tests',
                    data: chartData.integrationDurations,
                    borderColor: '#764ba2',
                    backgroundColor: 'rgba(118, 75, 162, 0.1)',
                    tension: 0.4
                }, {
                    label: 'E2E Tests',
                    data: chartData.e2eDurations,
                    borderColor: '#f093fb',
                    backgroundColor: 'rgba(240, 147, 251, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Duration (ms)'
                        }
                    }
                }
            }
        });

        // Pass Rate Chart
        new Chart(document.getElementById('passRateChart'), {
            type: 'line',
            data: {
                labels: chartData.timeLabels,
                datasets: [{
                    label: 'Unit Tests',
                    data: chartData.unitPassRates,
                    borderColor: '#28a745',
                    backgroundColor: 'rgba(40, 167, 69, 0.1)',
                    tension: 0.4
                }, {
                    label: 'Integration Tests',
                    data: chartData.integrationPassRates,
                    borderColor: '#ffc107',
                    backgroundColor: 'rgba(255, 193, 7, 0.1)',
                    tension: 0.4
                }, {
                    label: 'E2E Tests',
                    data: chartData.e2ePassRates,
                    borderColor: '#dc3545',
                    backgroundColor: 'rgba(220, 53, 69, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        min: 0,
                        max: 100,
                        title: {
                            display: true,
                            text: 'Pass Rate (%)'
                        }
                    }
                }
            }
        });

        // Suite Chart
        new Chart(document.getElementById('suiteChart'), {
            type: 'doughnut',
            data: {
                labels: ['Unit Tests', 'Integration Tests', 'E2E Tests'],
                datasets: [{
                    data: [
                        chartData.suiteDistribution.unit,
                        chartData.suiteDistribution.integration,
                        chartData.suiteDistribution.e2e
                    ],
                    backgroundColor: ['#667eea', '#764ba2', '#f093fb']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });

        // Distribution Chart
        new Chart(document.getElementById('distributionChart'), {
            type: 'bar',
            data: {
                labels: ['0-100ms', '100-500ms', '500ms-1s', '1s-5s', '5s+'],
                datasets: [{
                    label: 'Number of Tests',
                    data: chartData.durationDistribution,
                    backgroundColor: [
                        '#28a745',
                        '#ffc107',
                        '#fd7e14',
                        '#dc3545',
                        '#6f42c1'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Tests'
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>`;
  }

  private prepareChartData(data: DashboardData) {
    // Sort performances by timestamp
    const sortedPerformances = data.performances.sort((a, b) => a.timestamp - b.timestamp);

    // Prepare time-series data
    const timeLabels = sortedPerformances.map(p => new Date(p.timestamp).toLocaleDateString());

    const unitData = sortedPerformances.filter(p => p.suite === 'unit');
    const integrationData = sortedPerformances.filter(p => p.suite === 'integration');
    const e2eData = sortedPerformances.filter(p => p.suite === 'e2e');

    // Create aligned arrays for charts
    const unitDurations: number[] = [];
    const integrationDurations: number[] = [];
    const e2eDurations: number[] = [];
    const unitPassRates: number[] = [];
    const integrationPassRates: number[] = [];
    const e2ePassRates: number[] = [];

    sortedPerformances.forEach(perf => {
      if (perf.suite === 'unit') {
        unitDurations.push(perf.averageDuration);
        unitPassRates.push(perf.passRate);
      } else {
        unitDurations.push(null as any);
        unitPassRates.push(null as any);
      }

      if (perf.suite === 'integration') {
        integrationDurations.push(perf.averageDuration);
        integrationPassRates.push(perf.passRate);
      } else {
        integrationDurations.push(null as any);
        integrationPassRates.push(null as any);
      }

      if (perf.suite === 'e2e') {
        e2eDurations.push(perf.averageDuration);
        e2ePassRates.push(perf.passRate);
      } else {
        e2eDurations.push(null as any);
        e2ePassRates.push(null as any);
      }
    });

    // Suite distribution
    const suiteDistribution = {
      unit: data.detailedResults.filter(r => r.suite === 'unit').length,
      integration: data.detailedResults.filter(r => r.suite === 'integration').length,
      e2e: data.detailedResults.filter(r => r.suite === 'e2e').length,
    };

    // Duration distribution
    const durationBuckets = [0, 0, 0, 0, 0]; // 0-100ms, 100-500ms, 500ms-1s, 1s-5s, 5s+
    data.detailedResults.forEach(result => {
      if (result.duration <= 100) durationBuckets[0]++;
      else if (result.duration <= 500) durationBuckets[1]++;
      else if (result.duration <= 1000) durationBuckets[2]++;
      else if (result.duration <= 5000) durationBuckets[3]++;
      else durationBuckets[4]++;
    });

    return {
      timeLabels,
      unitDurations,
      integrationDurations,
      e2eDurations,
      unitPassRates,
      integrationPassRates,
      e2ePassRates,
      suiteDistribution,
      durationDistribution: durationBuckets,
    };
  }

  private generateSlowestTestsTable(results: TestResult[]): string {
    const slowestTests = results.sort((a, b) => b.duration - a.duration).slice(0, 20);

    return slowestTests
      .map(test => {
        const statusClass = `status-${test.status}`;
        const fileName = path.basename(test.file);

        return `
        <tr>
            <td>${test.name}</td>
            <td>${test.suite.toUpperCase()}</td>
            <td>${test.duration.toFixed(2)}ms</td>
            <td class="${statusClass}">${test.status.toUpperCase()}</td>
            <td>${fileName}</td>
        </tr>
      `;
      })
      .join('');
  }

  openDashboard(): void {
    if (!fs.existsSync(this.dashboardFile)) {
      console.log('📊 Dashboard not found. Generating...');
      this.generateDashboard();
    }

    const { spawn } = require('child_process');
    const platform = process.platform;

    let command: string;
    if (platform === 'darwin') {
      command = 'open';
    } else if (platform === 'win32') {
      command = 'start';
    } else {
      command = 'xdg-open';
    }

    spawn(command, [this.dashboardFile], { detached: true });
    console.log(`🌐 Opening dashboard in browser...`);
  }
}

// Export for use in other scripts
export { TestPerformanceDashboard };

// CLI usage
if (require.main === module) {
  const dashboard = new TestPerformanceDashboard();

  const args = process.argv.slice(2);
  const command = args[0] || 'generate';

  switch (command) {
    case 'generate':
      dashboard.generateDashboard();
      break;
    case 'open':
      dashboard.openDashboard();
      break;
    default:
      console.log('Usage:');
      console.log('  tsx test-performance-dashboard.ts [generate|open]');
      console.log('');
      console.log('Commands:');
      console.log('  generate  - Generate HTML dashboard');
      console.log('  open      - Open dashboard in browser');
  }
}

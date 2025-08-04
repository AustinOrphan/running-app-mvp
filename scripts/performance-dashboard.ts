#!/usr/bin/env tsx

/**
 * Performance Dashboard Generator
 * Creates visual performance reports with charts and trends
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

interface DashboardConfig {
  resultsDir: string;
  outputDir: string;
  maxHistoricalRuns: number;
  chartWidth: number;
  chartHeight: number;
}

interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    borderColor?: string;
    backgroundColor?: string;
    tension?: number;
  }[];
}

class PerformanceDashboard {
  private config: DashboardConfig;

  constructor(config?: Partial<DashboardConfig>) {
    this.config = {
      resultsDir: 'benchmark-results',
      outputDir: 'performance-dashboard',
      maxHistoricalRuns: 20,
      chartWidth: 800,
      chartHeight: 400,
      ...config,
    };
  }

  async generateDashboard(): Promise<void> {
    console.log('📊 Generating Performance Dashboard...\n');

    // Load all benchmark results
    const results = this.loadBenchmarkResults();
    if (results.length === 0) {
      console.error('❌ No benchmark results found');
      return;
    }

    // Generate HTML dashboard
    const html = this.generateHTML(results);

    // Save dashboard
    const outputPath = path.join(this.config.outputDir, 'index.html');
    writeFileSync(outputPath, html);

    console.log(`✅ Dashboard generated at: ${outputPath}`);
  }

  private loadBenchmarkResults(): any[] {
    const results: any[] = [];

    try {
      const files = readdirSync(this.config.resultsDir);
      const benchmarkFiles = files
        .filter(f => f.startsWith('benchmark-') && f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, this.config.maxHistoricalRuns);

      for (const file of benchmarkFiles) {
        const content = readFileSync(path.join(this.config.resultsDir, file), 'utf8');
        results.push(JSON.parse(content));
      }
    } catch (error) {
      console.warn('⚠️  Could not load benchmark results:', error);
    }

    return results.reverse(); // Chronological order
  }

  private generateHTML(results: any[]): string {
    const chartData = this.prepareChartData(results);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Performance Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background-color: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        h1 {
            color: #2c3e50;
            margin-bottom: 30px;
            text-align: center;
            font-size: 2.5em;
        }
        
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        
        .metric-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: transform 0.2s;
        }
        
        .metric-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        
        .metric-title {
            font-size: 0.9em;
            color: #666;
            margin-bottom: 5px;
        }
        
        .metric-value {
            font-size: 2em;
            font-weight: bold;
            color: #2c3e50;
        }
        
        .metric-trend {
            font-size: 0.85em;
            margin-top: 5px;
        }
        
        .trend-up {
            color: #e74c3c;
        }
        
        .trend-down {
            color: #27ae60;
        }
        
        .trend-neutral {
            color: #95a5a6;
        }
        
        .chart-container {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .chart-title {
            font-size: 1.3em;
            color: #2c3e50;
            margin-bottom: 20px;
            text-align: center;
        }
        
        canvas {
            max-width: 100%;
            height: auto !important;
        }
        
        .footer {
            text-align: center;
            color: #666;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
        }
        
        .threshold-line {
            border-top: 2px dashed #e74c3c;
            opacity: 0.5;
        }
        
        @media (max-width: 768px) {
            .metrics-grid {
                grid-template-columns: 1fr;
            }
            
            h1 {
                font-size: 2em;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Performance Dashboard</h1>
        
        ${this.generateMetricsCards(results)}
        
        <div class="chart-container">
            <h2 class="chart-title">Test Execution Time Trends</h2>
            <canvas id="testTimeChart"></canvas>
        </div>
        
        <div class="chart-container">
            <h2 class="chart-title">Bundle Size Trends</h2>
            <canvas id="bundleSizeChart"></canvas>
        </div>
        
        <div class="chart-container">
            <h2 class="chart-title">Build Time Trends</h2>
            <canvas id="buildTimeChart"></canvas>
        </div>
        
        <div class="chart-container">
            <h2 class="chart-title">Memory Usage Trends</h2>
            <canvas id="memoryChart"></canvas>
        </div>
        
        <div class="footer">
            <p>Generated on ${new Date().toLocaleString()}</p>
            <p>Total runs analyzed: ${results.length}</p>
        </div>
    </div>
    
    <script>
        ${this.generateChartScripts(chartData)}
    </script>
</body>
</html>`;
  }

  private generateMetricsCards(results: any[]): string {
    if (results.length === 0) return '';

    const latest = results[results.length - 1];
    const previous = results.length > 1 ? results[results.length - 2] : null;

    const metrics = [
      {
        title: 'Total Test Time',
        value: this.formatTime(latest.metrics.testExecutionTime.total),
        trend: previous
          ? this.calculateTrend(
              latest.metrics.testExecutionTime.total,
              previous.metrics.testExecutionTime.total
            )
          : null,
        isLowerBetter: true,
      },
      {
        title: 'Bundle Size',
        value: this.formatBytes(latest.metrics.bundleSize.total),
        trend: previous
          ? this.calculateTrend(latest.metrics.bundleSize.total, previous.metrics.bundleSize.total)
          : null,
        isLowerBetter: true,
      },
      {
        title: 'Build Time',
        value: this.formatTime(latest.metrics.buildTime.total),
        trend: previous
          ? this.calculateTrend(latest.metrics.buildTime.total, previous.metrics.buildTime.total)
          : null,
        isLowerBetter: true,
      },
      {
        title: 'Memory Usage',
        value: this.formatBytes(latest.metrics.memoryUsage.heapUsed),
        trend: previous
          ? this.calculateTrend(
              latest.metrics.memoryUsage.heapUsed,
              previous.metrics.memoryUsage.heapUsed
            )
          : null,
        isLowerBetter: true,
      },
    ];

    return `
        <div class="metrics-grid">
            ${metrics.map(metric => this.generateMetricCard(metric)).join('')}
        </div>
    `;
  }

  private generateMetricCard(metric: any): string {
    let trendClass = 'trend-neutral';
    let trendSymbol = '→';
    let trendText = 'No change';

    if (metric.trend) {
      const isImprovement = metric.isLowerBetter ? metric.trend < 0 : metric.trend > 0;
      trendClass = isImprovement ? 'trend-down' : 'trend-up';
      trendSymbol = metric.trend > 0 ? '↑' : '↓';
      trendText = `${Math.abs(metric.trend).toFixed(1)}%`;
    }

    return `
        <div class="metric-card">
            <div class="metric-title">${metric.title}</div>
            <div class="metric-value">${metric.value}</div>
            ${
              metric.trend !== null
                ? `
                <div class="metric-trend ${trendClass}">
                    ${trendSymbol} ${trendText}
                </div>
            `
                : ''
            }
        </div>
    `;
  }

  private prepareChartData(results: any[]): Record<string, ChartData> {
    const labels = results.map(r => {
      const date = new Date(r.timestamp);
      return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
    });

    return {
      testTime: {
        labels,
        datasets: [
          {
            label: 'Unit Tests',
            data: results.map(r => r.metrics.testExecutionTime.unit / 1000),
            borderColor: '#3498db',
            backgroundColor: 'rgba(52, 152, 219, 0.1)',
            tension: 0.1,
          },
          {
            label: 'Integration Tests',
            data: results.map(r => r.metrics.testExecutionTime.integration / 1000),
            borderColor: '#2ecc71',
            backgroundColor: 'rgba(46, 204, 113, 0.1)',
            tension: 0.1,
          },
          {
            label: 'E2E Tests',
            data: results.map(r => r.metrics.testExecutionTime.e2e / 1000),
            borderColor: '#f39c12',
            backgroundColor: 'rgba(243, 156, 18, 0.1)',
            tension: 0.1,
          },
        ],
      },
      bundleSize: {
        labels,
        datasets: [
          {
            label: 'Main Bundle',
            data: results.map(r => r.metrics.bundleSize.main / 1024),
            borderColor: '#9b59b6',
            backgroundColor: 'rgba(155, 89, 182, 0.1)',
            tension: 0.1,
          },
          {
            label: 'Total Size',
            data: results.map(r => r.metrics.bundleSize.total / 1024),
            borderColor: '#e74c3c',
            backgroundColor: 'rgba(231, 76, 60, 0.1)',
            tension: 0.1,
          },
        ],
      },
      buildTime: {
        labels,
        datasets: [
          {
            label: 'Frontend Build',
            data: results.map(r => r.metrics.buildTime.frontend / 1000),
            borderColor: '#1abc9c',
            backgroundColor: 'rgba(26, 188, 156, 0.1)',
            tension: 0.1,
          },
          {
            label: 'Backend Build',
            data: results.map(r => r.metrics.buildTime.backend / 1000),
            borderColor: '#34495e',
            backgroundColor: 'rgba(52, 73, 94, 0.1)',
            tension: 0.1,
          },
        ],
      },
      memory: {
        labels,
        datasets: [
          {
            label: 'Heap Used',
            data: results.map(r => r.metrics.memoryUsage.heapUsed / 1024 / 1024),
            borderColor: '#e67e22',
            backgroundColor: 'rgba(230, 126, 34, 0.1)',
            tension: 0.1,
          },
          {
            label: 'RSS',
            data: results.map(r => r.metrics.memoryUsage.rss / 1024 / 1024),
            borderColor: '#95a5a6',
            backgroundColor: 'rgba(149, 165, 166, 0.1)',
            tension: 0.1,
          },
        ],
      },
    };
  }

  private generateChartScripts(chartData: Record<string, ChartData>): string {
    return `
        // Chart configuration
        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                },
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Value'
                    },
                    beginAtZero: true
                }
            }
        };
        
        // Test Time Chart
        new Chart(document.getElementById('testTimeChart'), {
            type: 'line',
            data: ${JSON.stringify(chartData.testTime)},
            options: {
                ...chartOptions,
                scales: {
                    ...chartOptions.scales,
                    y: {
                        ...chartOptions.scales.y,
                        title: {
                            display: true,
                            text: 'Time (seconds)'
                        }
                    }
                }
            }
        });
        
        // Bundle Size Chart
        new Chart(document.getElementById('bundleSizeChart'), {
            type: 'line',
            data: ${JSON.stringify(chartData.bundleSize)},
            options: {
                ...chartOptions,
                scales: {
                    ...chartOptions.scales,
                    y: {
                        ...chartOptions.scales.y,
                        title: {
                            display: true,
                            text: 'Size (KB)'
                        }
                    }
                }
            }
        });
        
        // Build Time Chart
        new Chart(document.getElementById('buildTimeChart'), {
            type: 'line',
            data: ${JSON.stringify(chartData.buildTime)},
            options: {
                ...chartOptions,
                scales: {
                    ...chartOptions.scales,
                    y: {
                        ...chartOptions.scales.y,
                        title: {
                            display: true,
                            text: 'Time (seconds)'
                        }
                    }
                }
            }
        });
        
        // Memory Chart
        new Chart(document.getElementById('memoryChart'), {
            type: 'line',
            data: ${JSON.stringify(chartData.memory)},
            options: {
                ...chartOptions,
                scales: {
                    ...chartOptions.scales,
                    y: {
                        ...chartOptions.scales.y,
                        title: {
                            display: true,
                            text: 'Memory (MB)'
                        }
                    }
                }
            }
        });
    `;
  }

  private calculateTrend(current: number, previous: number): number {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }

  private formatTime(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
}

// Main execution
async function main() {
  const dashboard = new PerformanceDashboard();
  await dashboard.generateDashboard();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Dashboard generation failed:', error);
    process.exit(1);
  });
}

export { PerformanceDashboard };

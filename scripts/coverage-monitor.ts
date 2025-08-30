#!/usr/bin/env tsx

/**
 * Code Coverage Monitor
 *
 * Monitors and enforces >80% code coverage across all test types.
 * Tracks coverage trends, generates reports, and integrates with CI/CD.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface CoverageData {
  lines: { total: number; covered: number; percentage: number };
  statements: { total: number; covered: number; percentage: number };
  functions: { total: number; covered: number; percentage: number };
  branches: { total: number; covered: number; percentage: number };
}

interface FileCoverage {
  path: string;
  lines: CoverageData['lines'];
  statements: CoverageData['statements'];
  functions: CoverageData['functions'];
  branches: CoverageData['branches'];
}

interface CoverageReport {
  id: string;
  timestamp: Date;
  branch: string;
  commit: string;
  summary: CoverageData;
  files: FileCoverage[];
  testType: 'unit' | 'integration' | 'e2e' | 'combined';
  targetMet: boolean;
  improvements: string[];
  regressions: string[];
}

interface CoverageTrend {
  date: Date;
  coverage: number;
  testType: string;
}

interface CoverageThreshold {
  global: {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  };
  each: {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  };
}

export class CoverageMonitor {
  private readonly dataDir = 'coverage-data';
  private readonly reportsDir = path.join(this.dataDir, 'reports');
  private readonly trendsFile = path.join(this.dataDir, 'trends.json');
  private readonly thresholdsFile = path.join(this.dataDir, 'thresholds.json');
  private readonly targetCoverage = 80;

  constructor() {
    this.ensureDirectories();
    this.initializeThresholds();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  private initializeThresholds(): void {
    if (!fs.existsSync(this.thresholdsFile)) {
      const defaultThresholds: CoverageThreshold = {
        global: {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 75,
        },
        each: {
          lines: 60,
          statements: 60,
          functions: 60,
          branches: 50,
        },
      };
      fs.writeFileSync(this.thresholdsFile, JSON.stringify(defaultThresholds, null, 2));
    }
  }

  /**
   * Collect coverage data from all test types
   */
  async collectCoverage(): Promise<CoverageReport[]> {
    console.log('📊 Collecting code coverage data...\n');

    const reports: CoverageReport[] = [];

    // Collect unit test coverage
    console.log('🧪 Running unit tests with coverage...');
    const unitReport = await this.runCoverageForTestType('unit', 'npm run test:coverage');
    if (unitReport) reports.push(unitReport);

    // Collect integration test coverage
    console.log('🔗 Running integration tests with coverage...');
    const integrationReport = await this.runCoverageForTestType(
      'integration',
      'npm run test:coverage:integration'
    );
    if (integrationReport) reports.push(integrationReport);

    // Merge coverage reports
    console.log('🔀 Merging coverage reports...');
    const combinedReport = await this.mergeCoverageReports(reports);
    if (combinedReport) reports.push(combinedReport);

    // Save reports
    for (const report of reports) {
      await this.saveReport(report);
    }

    // Update trends
    await this.updateTrends(reports);

    return reports;
  }

  private async runCoverageForTestType(
    testType: 'unit' | 'integration' | 'e2e',
    command: string
  ): Promise<CoverageReport | null> {
    try {
      // Run tests with coverage
      execSync(command, { stdio: 'pipe', encoding: 'utf8' });

      // Parse coverage data
      const coverageFile =
        testType === 'integration'
          ? 'coverage-integration/coverage-final.json'
          : 'coverage/coverage-final.json';

      if (!fs.existsSync(coverageFile)) {
        console.warn(`⚠️  No coverage file found for ${testType} tests`);
        return null;
      }

      const coverageData = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
      const report = this.parseCoverageData(coverageData, testType);

      console.log(`✅ ${testType} coverage: ${report.summary.lines.percentage.toFixed(1)}%\n`);

      return report;
    } catch (error) {
      console.error(`❌ Failed to collect ${testType} coverage:`, error);
      return null;
    }
  }

  private parseCoverageData(coverageData: any, testType: string): CoverageReport {
    const files: FileCoverage[] = [];
    let totalLines = 0,
      coveredLines = 0;
    let totalStatements = 0,
      coveredStatements = 0;
    let totalFunctions = 0,
      coveredFunctions = 0;
    let totalBranches = 0,
      coveredBranches = 0;

    for (const [filePath, fileData] of Object.entries(coverageData)) {
      if (typeof fileData !== 'object') continue;

      const data = fileData as any;

      // Calculate file coverage
      const lines = this.calculateMetric(data.l);
      const statements = this.calculateMetric(data.s);
      const functions = this.calculateMetric(data.f);
      const branches = this.calculateBranchMetric(data.b);

      files.push({
        path: filePath,
        lines,
        statements,
        functions,
        branches,
      });

      // Update totals
      totalLines += lines.total;
      coveredLines += lines.covered;
      totalStatements += statements.total;
      coveredStatements += statements.covered;
      totalFunctions += functions.total;
      coveredFunctions += functions.covered;
      totalBranches += branches.total;
      coveredBranches += branches.covered;
    }

    const summary: CoverageData = {
      lines: {
        total: totalLines,
        covered: coveredLines,
        percentage: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0,
      },
      statements: {
        total: totalStatements,
        covered: coveredStatements,
        percentage: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0,
      },
      functions: {
        total: totalFunctions,
        covered: coveredFunctions,
        percentage: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0,
      },
      branches: {
        total: totalBranches,
        covered: coveredBranches,
        percentage: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0,
      },
    };

    const report: CoverageReport = {
      id: `coverage-${testType}-${Date.now()}`,
      timestamp: new Date(),
      branch: this.getCurrentBranch(),
      commit: this.getCurrentCommit(),
      summary,
      files: files.sort((a, b) => a.lines.percentage - b.lines.percentage),
      testType: testType as any,
      targetMet: summary.lines.percentage >= this.targetCoverage,
      improvements: [],
      regressions: [],
    };

    return report;
  }

  private calculateMetric(metric: any): CoverageData['lines'] {
    if (!metric) return { total: 0, covered: 0, percentage: 0 };

    const values = Object.values(metric).map(v => Number(v));
    const total = values.length;
    const covered = values.filter(v => v > 0).length;

    return {
      total,
      covered,
      percentage: total > 0 ? (covered / total) * 100 : 0,
    };
  }

  private calculateBranchMetric(branches: any): CoverageData['branches'] {
    if (!branches) return { total: 0, covered: 0, percentage: 0 };

    let total = 0;
    let covered = 0;

    for (const branch of Object.values(branches)) {
      if (Array.isArray(branch)) {
        total += branch.length;
        covered += branch.filter(b => b > 0).length;
      }
    }

    return {
      total,
      covered,
      percentage: total > 0 ? (covered / total) * 100 : 0,
    };
  }

  private async mergeCoverageReports(reports: CoverageReport[]): Promise<CoverageReport | null> {
    if (reports.length === 0) return null;

    // Merge all files
    const allFiles = new Map<string, FileCoverage>();

    for (const report of reports) {
      for (const file of report.files) {
        const existing = allFiles.get(file.path);
        if (!existing || file.lines.percentage > existing.lines.percentage) {
          allFiles.set(file.path, file);
        }
      }
    }

    // Calculate combined summary
    const files = Array.from(allFiles.values());
    let totalLines = 0,
      coveredLines = 0;
    let totalStatements = 0,
      coveredStatements = 0;
    let totalFunctions = 0,
      coveredFunctions = 0;
    let totalBranches = 0,
      coveredBranches = 0;

    for (const file of files) {
      totalLines += file.lines.total;
      coveredLines += file.lines.covered;
      totalStatements += file.statements.total;
      coveredStatements += file.statements.covered;
      totalFunctions += file.functions.total;
      coveredFunctions += file.functions.covered;
      totalBranches += file.branches.total;
      coveredBranches += file.branches.covered;
    }

    const summary: CoverageData = {
      lines: {
        total: totalLines,
        covered: coveredLines,
        percentage: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0,
      },
      statements: {
        total: totalStatements,
        covered: coveredStatements,
        percentage: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0,
      },
      functions: {
        total: totalFunctions,
        covered: coveredFunctions,
        percentage: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0,
      },
      branches: {
        total: totalBranches,
        covered: coveredBranches,
        percentage: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0,
      },
    };

    return {
      id: `coverage-combined-${Date.now()}`,
      timestamp: new Date(),
      branch: this.getCurrentBranch(),
      commit: this.getCurrentCommit(),
      summary,
      files,
      testType: 'combined',
      targetMet: summary.lines.percentage >= this.targetCoverage,
      improvements: [],
      regressions: [],
    };
  }

  /**
   * Analyze coverage trends and identify areas for improvement
   */
  async analyzeCoverage(): Promise<void> {
    console.log('📈 Analyzing coverage trends...\n');

    const reports = this.loadRecentReports(30);
    const trends = this.loadTrends();

    // Group reports by test type
    const byType = new Map<string, CoverageReport[]>();
    for (const report of reports) {
      const existing = byType.get(report.testType) || [];
      existing.push(report);
      byType.set(report.testType, existing);
    }

    // Analyze each test type
    for (const [testType, typeReports] of byType) {
      console.log(`\n📊 ${testType.toUpperCase()} Test Coverage:`);
      console.log('='.repeat(50));

      const latest = typeReports[typeReports.length - 1];
      const previous = typeReports[typeReports.length - 2];

      // Current coverage
      console.log(`Current: ${latest.summary.lines.percentage.toFixed(1)}%`);
      console.log(`Target: ${this.targetCoverage}%`);
      console.log(`Status: ${latest.targetMet ? '✅ Target Met' : '❌ Below Target'}`);

      // Trend analysis
      if (previous) {
        const change = latest.summary.lines.percentage - previous.summary.lines.percentage;
        const trend = change > 0 ? '📈' : change < 0 ? '📉' : '➡️';
        console.log(`Trend: ${trend} ${change > 0 ? '+' : ''}${change.toFixed(1)}%`);
      }

      // Identify low coverage files
      const lowCoverageFiles = latest.files.filter(f => f.lines.percentage < 60).slice(0, 5);

      if (lowCoverageFiles.length > 0) {
        console.log('\n🔍 Files needing attention:');
        for (const file of lowCoverageFiles) {
          const shortPath = file.path.replace(process.cwd(), '.');
          console.log(`  • ${shortPath}: ${file.lines.percentage.toFixed(1)}%`);
        }
      }
    }

    // Overall recommendations
    console.log('\n💡 Recommendations:');
    const recommendations = await this.generateRecommendations(reports);
    for (const rec of recommendations.slice(0, 5)) {
      console.log(`  • ${rec}`);
    }
  }

  /**
   * Generate coverage reports and badges
   */
  async generateReports(): Promise<void> {
    console.log('📄 Generating coverage reports...\n');

    const reports = this.loadRecentReports(10);
    if (reports.length === 0) {
      console.log('⚠️  No coverage data available');
      return;
    }

    // Generate HTML report
    await this.generateHTMLReport(reports);

    // Generate badges
    await this.generateBadges(reports);

    // Generate markdown summary
    await this.generateMarkdownSummary(reports);

    console.log('✅ Reports generated successfully');
  }

  private async generateHTMLReport(reports: CoverageReport[]): Promise<void> {
    const latest = reports.find(r => r.testType === 'combined') || reports[0];

    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Code Coverage Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 20px; border-radius: 8px; }
        .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 20px 0; }
        .metric { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metric h3 { margin: 0; color: #666; font-size: 14px; }
        .metric .value { font-size: 36px; font-weight: bold; margin: 10px 0; }
        .metric .bar { height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; }
        .metric .fill { height: 100%; transition: width 0.3s; }
        .good { color: #4caf50; }
        .warning { color: #ff9800; }
        .bad { color: #f44336; }
        .good .fill { background: #4caf50; }
        .warning .fill { background: #ff9800; }
        .bad .fill { background: #f44336; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e0e0e0; }
        th { background: #f5f5f5; font-weight: bold; }
        .trend { font-size: 24px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Code Coverage Report</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>
        <p>Branch: ${latest.branch} | Commit: ${latest.commit.substring(0, 8)}</p>
    </div>

    <div class="summary">
        ${this.generateMetricHTML('Lines', latest.summary.lines)}
        ${this.generateMetricHTML('Statements', latest.summary.statements)}
        ${this.generateMetricHTML('Functions', latest.summary.functions)}
        ${this.generateMetricHTML('Branches', latest.summary.branches)}
    </div>

    <h2>File Coverage</h2>
    <table>
        <thead>
            <tr>
                <th>File</th>
                <th>Lines</th>
                <th>Statements</th>
                <th>Functions</th>
                <th>Branches</th>
            </tr>
        </thead>
        <tbody>
            ${latest.files
              .map(
                file => `
                <tr>
                    <td>${file.path.replace(process.cwd(), '.')}</td>
                    <td class="${this.getCoverageClass(file.lines.percentage)}">${file.lines.percentage.toFixed(1)}%</td>
                    <td class="${this.getCoverageClass(file.statements.percentage)}">${file.statements.percentage.toFixed(1)}%</td>
                    <td class="${this.getCoverageClass(file.functions.percentage)}">${file.functions.percentage.toFixed(1)}%</td>
                    <td class="${this.getCoverageClass(file.branches.percentage)}">${file.branches.percentage.toFixed(1)}%</td>
                </tr>
            `
              )
              .join('')}
        </tbody>
    </table>

    <h2>Coverage Trends</h2>
    <canvas id="trendChart" width="800" height="400"></canvas>

    <script>
        // Add chart rendering logic here
    </script>
</body>
</html>`;

    fs.writeFileSync(path.join(this.dataDir, 'coverage-report.html'), html);
    console.log('📄 HTML report: coverage-data/coverage-report.html');
  }

  private generateMetricHTML(name: string, metric: CoverageData['lines']): string {
    const coverageClass = this.getCoverageClass(metric.percentage);

    return `
        <div class="metric ${coverageClass}">
            <h3>${name}</h3>
            <div class="value">${metric.percentage.toFixed(1)}%</div>
            <div class="bar">
                <div class="fill" style="width: ${metric.percentage}%"></div>
            </div>
            <small>${metric.covered} / ${metric.total}</small>
        </div>
    `;
  }

  private getCoverageClass(percentage: number): string {
    if (percentage >= 80) return 'good';
    if (percentage >= 60) return 'warning';
    return 'bad';
  }

  private async generateBadges(reports: CoverageReport[]): Promise<void> {
    const latest = reports.find(r => r.testType === 'combined') || reports[0];
    const coverage = latest.summary.lines.percentage;

    const color = coverage >= 80 ? 'brightgreen' : coverage >= 60 ? 'yellow' : 'red';
    const badge = `https://img.shields.io/badge/coverage-${coverage.toFixed(1)}%25-${color}`;

    // Create badge markdown
    const badgeMd = `[![Coverage](${badge})](./coverage-data/coverage-report.html)`;

    fs.writeFileSync(path.join(this.dataDir, 'badge.md'), badgeMd);
    console.log('🏷️  Badge: coverage-data/badge.md');
  }

  private async generateMarkdownSummary(reports: CoverageReport[]): Promise<void> {
    const latest = reports.find(r => r.testType === 'combined') || reports[0];

    const summary = `# Code Coverage Summary

Generated: ${new Date().toLocaleString()}

## Overall Coverage

| Metric | Coverage | Target | Status |
|--------|----------|--------|--------|
| **Lines** | ${latest.summary.lines.percentage.toFixed(1)}% | 80% | ${latest.summary.lines.percentage >= 80 ? '✅' : '❌'} |
| **Statements** | ${latest.summary.statements.percentage.toFixed(1)}% | 80% | ${latest.summary.statements.percentage >= 80 ? '✅' : '❌'} |
| **Functions** | ${latest.summary.functions.percentage.toFixed(1)}% | 80% | ${latest.summary.functions.percentage >= 80 ? '✅' : '❌'} |
| **Branches** | ${latest.summary.branches.percentage.toFixed(1)}% | 75% | ${latest.summary.branches.percentage >= 75 ? '✅' : '❌'} |

## Low Coverage Files

Files with less than 60% coverage that need attention:

${latest.files
  .filter(f => f.lines.percentage < 60)
  .slice(0, 10)
  .map(f => `- \`${f.path.replace(process.cwd(), '.')}\`: ${f.lines.percentage.toFixed(1)}%`)
  .join('\n')}

## How to Improve Coverage

1. **Write more unit tests** for uncovered functions
2. **Add edge case tests** for better branch coverage
3. **Test error handling** paths
4. **Add integration tests** for complex workflows
5. **Use test coverage reports** to identify gaps

Run \`npm run test:coverage\` to see detailed coverage information.
`;

    fs.writeFileSync(path.join(this.dataDir, 'coverage-summary.md'), summary);
    console.log('📝 Summary: coverage-data/coverage-summary.md');
  }

  /**
   * Enforce coverage thresholds
   */
  async enforceThresholds(): Promise<boolean> {
    console.log('🚦 Enforcing coverage thresholds...\n');

    const reports = this.loadRecentReports(1);
    if (reports.length === 0) {
      console.error('❌ No coverage data available');
      return false;
    }

    const latest = reports[0];
    const thresholds = JSON.parse(
      fs.readFileSync(this.thresholdsFile, 'utf8')
    ) as CoverageThreshold;

    let passed = true;

    // Check global thresholds
    console.log('🌍 Global Coverage:');
    for (const [metric, threshold] of Object.entries(thresholds.global)) {
      const value = (latest.summary as any)[metric].percentage;
      const status = value >= threshold ? '✅' : '❌';

      console.log(`  ${metric}: ${value.toFixed(1)}% (threshold: ${threshold}%) ${status}`);

      if (value < threshold) {
        passed = false;
      }
    }

    // Check per-file thresholds
    console.log('\n📁 Per-file Coverage:');
    const failedFiles = [];

    for (const file of latest.files) {
      let filePassed = true;

      for (const [metric, threshold] of Object.entries(thresholds.each)) {
        const value = (file as any)[metric].percentage;
        if (value < threshold) {
          filePassed = false;
          break;
        }
      }

      if (!filePassed) {
        failedFiles.push(file);
      }
    }

    if (failedFiles.length > 0) {
      console.log(`  ❌ ${failedFiles.length} files below threshold:`);
      for (const file of failedFiles.slice(0, 5)) {
        console.log(
          `    • ${file.path.replace(process.cwd(), '.')}: ${file.lines.percentage.toFixed(1)}%`
        );
      }
      passed = false;
    } else {
      console.log('  ✅ All files meet threshold requirements');
    }

    console.log(`\n${passed ? '✅' : '❌'} Coverage ${passed ? 'PASSED' : 'FAILED'}`);
    return passed;
  }

  /**
   * Monitor coverage in watch mode
   */
  async watchCoverage(): Promise<void> {
    console.log('👀 Starting coverage monitor...\n');
    console.log('Press Ctrl+C to stop\n');

    const runCoverage = async () => {
      console.clear();
      console.log('🔄 Running coverage check...\n');

      const reports = await this.collectCoverage();
      const combined = reports.find(r => r.testType === 'combined');

      if (combined) {
        console.log('\n📊 Coverage Summary:');
        console.log(`Lines: ${combined.summary.lines.percentage.toFixed(1)}%`);
        console.log(`Target: ${this.targetCoverage}%`);
        console.log(`Status: ${combined.targetMet ? '✅ Target Met' : '❌ Below Target'}`);

        if (!combined.targetMet) {
          console.log('\n🔍 Top files to improve:');
          const lowFiles = combined.files.filter(f => f.lines.percentage < 80).slice(0, 3);

          for (const file of lowFiles) {
            console.log(
              `  • ${file.path.replace(process.cwd(), '.')}: ${file.lines.percentage.toFixed(1)}%`
            );
          }
        }
      }

      console.log('\n⏳ Waiting for file changes...');
    };

    // Initial run
    await runCoverage();

    // Watch for changes
    const watcher = fs.watch(process.cwd(), { recursive: true }, async (eventType, filename) => {
      if (filename && (filename.endsWith('.ts') || filename.endsWith('.tsx'))) {
        await runCoverage();
      }
    });

    process.on('SIGINT', () => {
      watcher.close();
      console.log('\n👋 Coverage monitor stopped');
      process.exit(0);
    });
  }

  // Helper methods
  private getCurrentBranch(): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  private getCurrentCommit(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  private async saveReport(report: CoverageReport): Promise<void> {
    const filename = `${report.id}.json`;
    const filepath = path.join(this.reportsDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  }

  private loadRecentReports(count: number): CoverageReport[] {
    try {
      const files = fs
        .readdirSync(this.reportsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .slice(-count);

      return files.map(file => {
        const filepath = path.join(this.reportsDir, file);
        const content = fs.readFileSync(filepath, 'utf8');
        return JSON.parse(content) as CoverageReport;
      });
    } catch {
      return [];
    }
  }

  private async updateTrends(reports: CoverageReport[]): Promise<void> {
    const trends = this.loadTrends();

    for (const report of reports) {
      trends.push({
        date: report.timestamp,
        coverage: report.summary.lines.percentage,
        testType: report.testType,
      });
    }

    // Keep last 90 days of data
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const recentTrends = trends.filter(t => new Date(t.date) > cutoff);

    fs.writeFileSync(this.trendsFile, JSON.stringify(recentTrends, null, 2));
  }

  private loadTrends(): CoverageTrend[] {
    try {
      const content = fs.readFileSync(this.trendsFile, 'utf8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private async generateRecommendations(reports: CoverageReport[]): Promise<string[]> {
    const recommendations: string[] = [];
    const latest = reports[reports.length - 1];

    if (!latest) return recommendations;

    // Low coverage files
    const lowCoverage = latest.files.filter(f => f.lines.percentage < 60);
    if (lowCoverage.length > 0) {
      recommendations.push(`Add tests for ${lowCoverage.length} files with <60% coverage`);
    }

    // Branch coverage
    if (latest.summary.branches.percentage < 70) {
      recommendations.push('Improve branch coverage by testing all conditional paths');
    }

    // Function coverage
    const uncoveredFunctions = latest.summary.functions.total - latest.summary.functions.covered;
    if (uncoveredFunctions > 10) {
      recommendations.push(`Add tests for ${uncoveredFunctions} uncovered functions`);
    }

    // Test types
    if (latest.testType === 'unit' && latest.summary.lines.percentage < 70) {
      recommendations.push('Focus on unit test coverage for business logic');
    }

    if (latest.testType === 'integration' && latest.summary.lines.percentage < 50) {
      recommendations.push('Add more integration tests for API endpoints');
    }

    return recommendations;
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new CoverageMonitor();
  const command = process.argv[2];

  switch (command) {
    case 'collect':
      monitor
        .collectCoverage()
        .then(reports => {
          const combined = reports.find(r => r.testType === 'combined');
          if (combined && !combined.targetMet) {
            process.exit(1);
          }
        })
        .catch(err => {
          console.error(err);
          process.exit(1);
        });
      break;

    case 'analyze':
      monitor.analyzeCoverage().catch(console.error);
      break;

    case 'report':
      monitor.generateReports().catch(console.error);
      break;

    case 'enforce':
      monitor
        .enforceThresholds()
        .then(passed => process.exit(passed ? 0 : 1))
        .catch(err => {
          console.error(err);
          process.exit(1);
        });
      break;

    case 'watch':
      monitor.watchCoverage().catch(console.error);
      break;

    default:
      console.log('Code Coverage Monitor');
      console.log('');
      console.log('Usage:');
      console.log('  npm run coverage:collect  - Collect coverage from all tests');
      console.log('  npm run coverage:analyze  - Analyze coverage trends');
      console.log('  npm run coverage:report   - Generate coverage reports');
      console.log('  npm run coverage:enforce  - Enforce coverage thresholds');
      console.log('  npm run coverage:watch    - Monitor coverage in watch mode');
      break;
  }
}

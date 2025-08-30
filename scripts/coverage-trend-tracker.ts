#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

interface CoverageData {
  timestamp: number;
  commitHash: string;
  branch: string;
  type: 'unit' | 'integration' | 'e2e' | 'combined';
  coverage: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  };
  totals: {
    coveredLines: number;
    totalLines: number;
    coveredFunctions: number;
    totalFunctions: number;
    coveredBranches: number;
    totalBranches: number;
    coveredStatements: number;
    totalStatements: number;
  };
  files: {
    [filePath: string]: {
      lines: number;
      functions: number;
      branches: number;
      statements: number;
    };
  };
}

interface CoverageTrend {
  metric: 'lines' | 'functions' | 'branches' | 'statements';
  trend: 'improving' | 'declining' | 'stable';
  changePercent: number;
  currentValue: number;
  previousValue: number;
  samples: number;
}

interface CoverageGoal {
  metric: 'lines' | 'functions' | 'branches' | 'statements';
  target: number;
  current: number;
  status: 'met' | 'below' | 'approaching';
  gap: number;
}

class CoverageTrendTracker {
  private dataDir: string;
  private trendsFile: string;
  private goalsFile: string;
  private maxHistoryDays: number = 90;

  constructor() {
    this.dataDir = path.join(process.cwd(), 'coverage-trends');
    this.trendsFile = path.join(this.dataDir, 'coverage-history.json');
    this.goalsFile = path.join(this.dataDir, 'coverage-goals.json');
    this.ensureDataDirectory();
  }

  private ensureDataDirectory(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async trackCoverage(type: 'unit' | 'integration' | 'e2e' | 'combined'): Promise<CoverageData> {
    console.log(`📊 Tracking ${type} test coverage...`);

    const coverage = await this.runCoverageTests(type);
    const coverageData: CoverageData = {
      timestamp: Date.now(),
      commitHash: await this.getGitCommitHash(),
      branch: await this.getGitBranch(),
      type,
      coverage: coverage.summary,
      totals: coverage.totals,
      files: coverage.files,
    };

    await this.saveCoverageData(coverageData);
    return coverageData;
  }

  private async runCoverageTests(type: string): Promise<{
    summary: CoverageData['coverage'];
    totals: CoverageData['totals'];
    files: CoverageData['files'];
  }> {
    return new Promise((resolve, reject) => {
      let command: string;
      let args: string[];

      switch (type) {
        case 'unit':
          command = 'npm';
          args = ['run', 'test:coverage'];
          break;
        case 'integration':
          command = 'npm';
          args = ['run', 'test:coverage:integration'];
          break;
        case 'e2e':
          command = 'npm';
          args = ['run', 'test:e2e', '--', '--coverage'];
          break;
        case 'combined':
          command = 'npm';
          args = ['run', 'test:coverage:all'];
          break;
        default:
          reject(new Error(`Unknown coverage type: ${type}`));
          return;
      }

      const child = spawn(command, args, {
        stdio: 'pipe',
        env: { ...process.env, CI: 'true' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', data => {
        stdout += data.toString();
      });

      child.stderr.on('data', data => {
        stderr += data.toString();
      });

      child.on('close', code => {
        try {
          const coverage = this.parseCoverageOutput(type, stdout, stderr);
          resolve(coverage);
        } catch (error) {
          console.warn(`Failed to parse ${type} coverage:`, error);
          // Return default coverage data if parsing fails
          resolve({
            summary: { lines: 0, functions: 0, branches: 0, statements: 0 },
            totals: {
              coveredLines: 0,
              totalLines: 0,
              coveredFunctions: 0,
              totalFunctions: 0,
              coveredBranches: 0,
              totalBranches: 0,
              coveredStatements: 0,
              totalStatements: 0,
            },
            files: {},
          });
        }
      });

      child.on('error', error => {
        console.warn(`Error running ${type} coverage:`, error);
        resolve({
          summary: { lines: 0, functions: 0, branches: 0, statements: 0 },
          totals: {
            coveredLines: 0,
            totalLines: 0,
            coveredFunctions: 0,
            totalFunctions: 0,
            coveredBranches: 0,
            totalBranches: 0,
            coveredStatements: 0,
            totalStatements: 0,
          },
          files: {},
        });
      });
    });
  }

  private parseCoverageOutput(
    type: string,
    stdout: string,
    stderr: string
  ): {
    summary: CoverageData['coverage'];
    totals: CoverageData['totals'];
    files: CoverageData['files'];
  } {
    const coverage = {
      summary: { lines: 0, functions: 0, branches: 0, statements: 0 },
      totals: {
        coveredLines: 0,
        totalLines: 0,
        coveredFunctions: 0,
        totalFunctions: 0,
        coveredBranches: 0,
        totalBranches: 0,
        coveredStatements: 0,
        totalStatements: 0,
      },
      files: {} as { [key: string]: any },
    };

    try {
      // Try to read coverage report files
      const coverageDir = type === 'integration' ? 'coverage-integration' : 'coverage';
      const summaryFile = path.join(process.cwd(), coverageDir, 'coverage-summary.json');

      if (fs.existsSync(summaryFile)) {
        const summaryData = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));

        if (summaryData.total) {
          coverage.summary.lines = summaryData.total.lines?.pct || 0;
          coverage.summary.functions = summaryData.total.functions?.pct || 0;
          coverage.summary.branches = summaryData.total.branches?.pct || 0;
          coverage.summary.statements = summaryData.total.statements?.pct || 0;

          coverage.totals.coveredLines = summaryData.total.lines?.covered || 0;
          coverage.totals.totalLines = summaryData.total.lines?.total || 0;
          coverage.totals.coveredFunctions = summaryData.total.functions?.covered || 0;
          coverage.totals.totalFunctions = summaryData.total.functions?.total || 0;
          coverage.totals.coveredBranches = summaryData.total.branches?.covered || 0;
          coverage.totals.totalBranches = summaryData.total.branches?.total || 0;
          coverage.totals.coveredStatements = summaryData.total.statements?.covered || 0;
          coverage.totals.totalStatements = summaryData.total.statements?.total || 0;
        }

        // Parse file-level coverage
        Object.keys(summaryData).forEach(filePath => {
          if (filePath !== 'total' && summaryData[filePath]) {
            const fileData = summaryData[filePath];
            coverage.files[filePath] = {
              lines: fileData.lines?.pct || 0,
              functions: fileData.functions?.pct || 0,
              branches: fileData.branches?.pct || 0,
              statements: fileData.statements?.pct || 0,
            };
          }
        });
      } else {
        // Fallback: parse text output
        this.parseTextCoverage(stdout, coverage);
      }
    } catch (error) {
      console.warn('Failed to parse coverage files, using text parsing:', error);
      this.parseTextCoverage(stdout, coverage);
    }

    return coverage;
  }

  private parseTextCoverage(output: string, coverage: any): void {
    // Parse coverage from text output (fallback)
    const patterns = {
      lines: /Lines\s*:\s*([\d.]+)%/i,
      functions: /Functions\s*:\s*([\d.]+)%/i,
      branches: /Branches\s*:\s*([\d.]+)%/i,
      statements: /Statements\s*:\s*([\d.]+)%/i,
    };

    Object.entries(patterns).forEach(([metric, pattern]) => {
      const match = output.match(pattern);
      if (match) {
        coverage.summary[metric] = parseFloat(match[1]);
      }
    });
  }

  private async getGitCommitHash(): Promise<string> {
    try {
      return await this.execCommand('git rev-parse HEAD');
    } catch {
      return 'unknown';
    }
  }

  private async getGitBranch(): Promise<string> {
    try {
      return await this.execCommand('git rev-parse --abbrev-ref HEAD');
    } catch {
      return 'unknown';
    }
  }

  private execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');
      const child = spawn(cmd, args, { stdio: 'pipe' });

      let output = '';
      child.stdout.on('data', data => {
        output += data.toString();
      });

      child.on('close', code => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Command failed: ${command}`));
        }
      });
    });
  }

  private async saveCoverageData(data: CoverageData): Promise<void> {
    const history = this.loadCoverageHistory();
    history.push(data);

    // Clean old data
    const cutoffTime = Date.now() - this.maxHistoryDays * 24 * 60 * 60 * 1000;
    const filteredHistory = history.filter(item => item.timestamp > cutoffTime);

    fs.writeFileSync(this.trendsFile, JSON.stringify(filteredHistory, null, 2));
    console.log(`💾 Saved coverage data for ${data.type} tests`);
  }

  private loadCoverageHistory(): CoverageData[] {
    if (!fs.existsSync(this.trendsFile)) {
      return [];
    }

    try {
      return JSON.parse(fs.readFileSync(this.trendsFile, 'utf-8'));
    } catch (error) {
      console.warn('Failed to load coverage history:', error);
      return [];
    }
  }

  analyzeTrends(): CoverageTrend[] {
    const history = this.loadCoverageHistory();
    const trends: CoverageTrend[] = [];

    if (history.length < 2) {
      console.warn('Not enough data for trend analysis (need at least 2 data points)');
      return trends;
    }

    // Group by test type
    const typeGroups = this.groupByType(history);

    Object.entries(typeGroups).forEach(([type, data]) => {
      if (data.length < 2) return;

      // Sort by timestamp
      data.sort((a, b) => a.timestamp - b.timestamp);

      const metrics: (keyof CoverageData['coverage'])[] = [
        'lines',
        'functions',
        'branches',
        'statements',
      ];

      metrics.forEach(metric => {
        const values = data.map(d => d.coverage[metric]);
        const trend = this.calculateTrend(values);

        trends.push({
          metric,
          trend: trend.trend,
          changePercent: trend.changePercent,
          currentValue: values[values.length - 1],
          previousValue: values[values.length - 2],
          samples: values.length,
        });
      });
    });

    return trends;
  }

  private groupByType(history: CoverageData[]): { [type: string]: CoverageData[] } {
    const groups: { [type: string]: CoverageData[] } = {};

    history.forEach(item => {
      if (!groups[item.type]) {
        groups[item.type] = [];
      }
      groups[item.type].push(item);
    });

    return groups;
  }

  private calculateTrend(values: number[]): {
    trend: 'improving' | 'declining' | 'stable';
    changePercent: number;
  } {
    if (values.length < 2) {
      return { trend: 'stable', changePercent: 0 };
    }

    const recent = values.slice(-5); // Use last 5 data points for trend
    const firstValue = recent[0];
    const lastValue = recent[recent.length - 1];

    const changePercent = firstValue !== 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

    // Calculate linear regression slope
    const n = recent.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = recent.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * recent[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    // Determine trend based on slope and change percentage
    const threshold = 1.0; // 1% threshold for significant change

    if (Math.abs(changePercent) < threshold) {
      return { trend: 'stable', changePercent };
    } else if (slope > 0 && changePercent > 0) {
      return { trend: 'improving', changePercent };
    } else {
      return { trend: 'declining', changePercent };
    }
  }

  setCoverageGoals(): void {
    const currentGoals = this.loadCoverageGoals();
    const history = this.loadCoverageHistory();

    if (history.length === 0) {
      console.warn('No coverage history available to set goals');
      return;
    }

    // Get latest combined coverage data
    const latestCombined = history
      .filter(d => d.type === 'combined')
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (!latestCombined) {
      console.warn('No combined coverage data available');
      return;
    }

    const goals: CoverageGoal[] = [
      {
        metric: 'lines',
        target: this.calculateTarget(latestCombined.coverage.lines),
        current: latestCombined.coverage.lines,
        status: 'below',
        gap: 0,
      },
      {
        metric: 'functions',
        target: this.calculateTarget(latestCombined.coverage.functions),
        current: latestCombined.coverage.functions,
        status: 'below',
        gap: 0,
      },
      {
        metric: 'branches',
        target: this.calculateTarget(latestCombined.coverage.branches),
        current: latestCombined.coverage.branches,
        status: 'below',
        gap: 0,
      },
      {
        metric: 'statements',
        target: this.calculateTarget(latestCombined.coverage.statements),
        current: latestCombined.coverage.statements,
        status: 'below',
        gap: 0,
      },
    ];

    // Update goal status
    goals.forEach(goal => {
      goal.gap = goal.target - goal.current;

      if (goal.current >= goal.target) {
        goal.status = 'met';
      } else if (goal.gap <= 5) {
        goal.status = 'approaching';
      } else {
        goal.status = 'below';
      }
    });

    // Merge with existing goals to preserve custom targets
    const updatedGoals = this.mergeGoals(currentGoals, goals);

    fs.writeFileSync(
      this.goalsFile,
      JSON.stringify(
        {
          lastUpdated: Date.now(),
          goals: updatedGoals,
        },
        null,
        2
      )
    );

    console.log('🎯 Coverage goals updated');
  }

  private loadCoverageGoals(): CoverageGoal[] {
    if (!fs.existsSync(this.goalsFile)) {
      return [];
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.goalsFile, 'utf-8'));
      return data.goals || [];
    } catch (error) {
      console.warn('Failed to load coverage goals:', error);
      return [];
    }
  }

  private calculateTarget(current: number): number {
    // Set progressive targets based on current coverage
    if (current >= 90) return Math.min(95, current + 2);
    if (current >= 80) return Math.min(90, current + 5);
    if (current >= 70) return Math.min(85, current + 10);
    return Math.min(75, current + 15);
  }

  private mergeGoals(existing: CoverageGoal[], calculated: CoverageGoal[]): CoverageGoal[] {
    const merged: CoverageGoal[] = [];

    calculated.forEach(calc => {
      const existing_goal = existing.find(e => e.metric === calc.metric);
      if (existing_goal) {
        // Keep existing target if it's higher, update current and status
        merged.push({
          ...calc,
          target: Math.max(existing_goal.target, calc.target),
        });
      } else {
        merged.push(calc);
      }
    });

    return merged;
  }

  generateCoverageReport(): void {
    const history = this.loadCoverageHistory();
    const trends = this.analyzeTrends();
    const goals = this.loadCoverageGoals();

    console.log('\n📊 Coverage Trends Report');
    console.log('='.repeat(50));

    if (history.length === 0) {
      console.log('No coverage data available');
      return;
    }

    // Latest coverage summary
    const latest = history
      .filter(d => d.type === 'combined')
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (latest) {
      console.log('\n📈 Current Coverage:');
      console.log(`  Lines: ${latest.coverage.lines.toFixed(1)}%`);
      console.log(`  Functions: ${latest.coverage.functions.toFixed(1)}%`);
      console.log(`  Branches: ${latest.coverage.branches.toFixed(1)}%`);
      console.log(`  Statements: ${latest.coverage.statements.toFixed(1)}%`);
      console.log(`  Date: ${new Date(latest.timestamp).toLocaleDateString()}`);
      console.log(`  Commit: ${latest.commitHash.substring(0, 8)}`);
    }

    // Trends analysis
    if (trends.length > 0) {
      console.log('\n📊 Coverage Trends:');
      trends.forEach(trend => {
        const icon = trend.trend === 'improving' ? '📈' : trend.trend === 'declining' ? '📉' : '➡️';
        const sign = trend.changePercent > 0 ? '+' : '';

        console.log(
          `  ${icon} ${trend.metric}: ${trend.trend} (${sign}${trend.changePercent.toFixed(1)}%)`
        );
        console.log(
          `     Current: ${trend.currentValue.toFixed(1)}% | Previous: ${trend.previousValue.toFixed(1)}%`
        );
      });
    }

    // Goals status
    if (goals.length > 0) {
      console.log('\n🎯 Coverage Goals:');
      goals.forEach(goal => {
        const statusIcon =
          goal.status === 'met' ? '✅' : goal.status === 'approaching' ? '🟡' : '❌';

        console.log(
          `  ${statusIcon} ${goal.metric}: ${goal.current.toFixed(1)}% / ${goal.target}%`
        );
        if (goal.status !== 'met') {
          console.log(`     Gap: ${goal.gap.toFixed(1)}% remaining`);
        }
      });
    }

    // Recommendations
    this.generateRecommendations(trends, goals);
  }

  private generateRecommendations(trends: CoverageTrend[], goals: CoverageGoal[]): void {
    console.log('\n💡 Recommendations:');

    // Check for declining trends
    const declining = trends.filter(t => t.trend === 'declining');
    if (declining.length > 0) {
      console.log('  ⚠️  Declining Coverage:');
      declining.forEach(trend => {
        console.log(
          `     - ${trend.metric} coverage has declined by ${Math.abs(trend.changePercent).toFixed(1)}%`
        );
      });
    }

    // Check for unmet goals
    const unmet = goals.filter(g => g.status === 'below');
    if (unmet.length > 0) {
      console.log('  🎯 Focus Areas:');
      unmet.forEach(goal => {
        console.log(
          `     - Improve ${goal.metric} coverage by ${goal.gap.toFixed(1)}% to reach ${goal.target}% target`
        );
      });
    }

    // Positive feedback
    const met = goals.filter(g => g.status === 'met');
    const improving = trends.filter(t => t.trend === 'improving');

    if (met.length > 0 || improving.length > 0) {
      console.log('  ✅ Good Progress:');
      met.forEach(goal => {
        console.log(`     - ${goal.metric} coverage goal achieved (${goal.current.toFixed(1)}%)`);
      });
      improving.forEach(trend => {
        console.log(
          `     - ${trend.metric} coverage trending upward (+${trend.changePercent.toFixed(1)}%)`
        );
      });
    }

    if (declining.length === 0 && unmet.length === 0) {
      console.log('  🎉 Excellent! All coverage goals are met and trending well!');
    }
  }

  async trackAllCoverage(): Promise<void> {
    console.log('🚀 Starting comprehensive coverage tracking...\n');

    const types: ('unit' | 'integration' | 'combined')[] = ['unit', 'integration', 'combined'];

    for (const type of types) {
      try {
        await this.trackCoverage(type);
      } catch (error) {
        console.error(`Failed to track ${type} coverage:`, error);
      }
    }

    console.log('\n📊 Analyzing trends...');
    this.analyzeTrends();

    console.log('\n🎯 Setting coverage goals...');
    this.setCoverageGoals();

    console.log('\n📋 Generating report...');
    this.generateCoverageReport();

    console.log('\n✅ Coverage tracking complete!');
  }
}

// Export for use in other scripts
export { CoverageTrendTracker, CoverageData, CoverageTrend, CoverageGoal };

// CLI usage
if (require.main === module) {
  const tracker = new CoverageTrendTracker();

  const args = process.argv.slice(2);
  const command = args[0] || 'track-all';

  switch (command) {
    case 'track-all':
      tracker.trackAllCoverage().catch(console.error);
      break;
    case 'track':
      const type = args[1] as 'unit' | 'integration' | 'e2e' | 'combined';
      if (!type || !['unit', 'integration', 'e2e', 'combined'].includes(type)) {
        console.error('Usage: tsx coverage-trend-tracker.ts track <unit|integration|e2e|combined>');
        process.exit(1);
      }
      tracker.trackCoverage(type).catch(console.error);
      break;
    case 'trends':
      const trends = tracker.analyzeTrends();
      console.log(JSON.stringify(trends, null, 2));
      break;
    case 'goals':
      tracker.setCoverageGoals();
      break;
    case 'report':
      tracker.generateCoverageReport();
      break;
    default:
      console.log('Usage:');
      console.log('  tsx coverage-trend-tracker.ts [track-all|track <type>|trends|goals|report]');
      console.log('');
      console.log('Commands:');
      console.log('  track-all  - Track coverage for all test types');
      console.log('  track      - Track coverage for specific type');
      console.log('  trends     - Analyze coverage trends');
      console.log('  goals      - Set coverage goals');
      console.log('  report     - Generate coverage report');
  }
}

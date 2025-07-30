#!/usr/bin/env tsx

/**
 * Performance Benchmark Script for CI
 * Measures key performance metrics and compares against baselines
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { performance } from 'perf_hooks';
import path from 'path';

interface BenchmarkMetrics {
  testExecutionTime: {
    unit: number;
    integration: number;
    e2e: number;
    total: number;
  };
  bundleSize: {
    main: number;
    vendor: number;
    total: number;
  };
  buildTime: {
    frontend: number;
    backend: number;
    total: number;
  };
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
}

interface BenchmarkResult {
  timestamp: string;
  commit: string;
  branch: string;
  metrics: BenchmarkMetrics;
  comparison?: {
    baseline: BenchmarkMetrics;
    differences: Record<string, any>;
    passed: boolean;
    failureReasons: string[];
  };
}

interface PerformanceThresholds {
  testExecutionTime: {
    unit: { max: number; warning: number };
    integration: { max: number; warning: number };
    e2e: { max: number; warning: number };
    total: { max: number; warning: number };
  };
  bundleSize: {
    main: { max: number; warning: number };
    vendor: { max: number; warning: number };
    total: { max: number; warning: number };
  };
  buildTime: {
    frontend: { max: number; warning: number };
    backend: { max: number; warning: number };
    total: { max: number; warning: number };
  };
  memoryUsage: {
    heapUsed: { max: number; warning: number };
    rss: { max: number; warning: number };
  };
}

class PerformanceBenchmark {
  private resultsDir = 'benchmark-results';
  private baselineFile = 'performance-baseline.json';
  private thresholdsFile = 'performance-thresholds.json';

  constructor() {
    // Ensure results directory exists
    if (!existsSync(this.resultsDir)) {
      mkdirSync(this.resultsDir, { recursive: true });
    }
  }

  async runBenchmarks(): Promise<BenchmarkResult> {
    console.log('🚀 Running Performance Benchmarks...\n');

    const metrics: BenchmarkMetrics = {
      testExecutionTime: await this.measureTestExecutionTime(),
      bundleSize: await this.measureBundleSize(),
      buildTime: await this.measureBuildTime(),
      memoryUsage: await this.measureMemoryUsage(),
    };

    const result: BenchmarkResult = {
      timestamp: new Date().toISOString(),
      commit: this.getGitCommit(),
      branch: this.getGitBranch(),
      metrics,
    };

    // Compare with baseline if exists
    if (existsSync(this.baselineFile)) {
      const baseline = JSON.parse(readFileSync(this.baselineFile, 'utf8'));
      result.comparison = this.compareWithBaseline(metrics, baseline);
    }

    // Save results
    this.saveResults(result);

    // Print report
    this.printReport(result);

    // Exit with appropriate code
    const exitCode = result.comparison?.passed === false ? 1 : 0;
    process.exit(exitCode);
  }

  private async measureTestExecutionTime(): Promise<BenchmarkMetrics['testExecutionTime']> {
    console.log('⏱️  Measuring test execution times...');

    const times = {
      unit: 0,
      integration: 0,
      e2e: 0,
      total: 0,
    };

    // Measure unit tests
    try {
      const unitStart = performance.now();
      execSync('npm run test:run -- --reporter=silent', { stdio: 'pipe' });
      times.unit = performance.now() - unitStart;
    } catch (error) {
      console.warn('⚠️  Unit tests failed, using default time');
      times.unit = 0;
    }

    // Measure integration tests
    try {
      const integrationStart = performance.now();
      execSync('npm run test:integration -- --silent', { stdio: 'pipe' });
      times.integration = performance.now() - integrationStart;
    } catch (error) {
      console.warn('⚠️  Integration tests failed, using default time');
      times.integration = 0;
    }

    // Measure E2E tests (sample test)
    try {
      const e2eStart = performance.now();
      execSync('npx playwright test tests/e2e/auth.test.ts --reporter=dot', { stdio: 'pipe' });
      times.e2e = performance.now() - e2eStart;
    } catch (error) {
      console.warn('⚠️  E2E tests failed, using default time');
      times.e2e = 0;
    }

    times.total = times.unit + times.integration + times.e2e;

    return times;
  }

  private async measureBundleSize(): Promise<BenchmarkMetrics['bundleSize']> {
    console.log('📦 Measuring bundle sizes...');

    // Build the project
    execSync('npm run build', { stdio: 'pipe' });

    const sizes = {
      main: 0,
      vendor: 0,
      total: 0,
    };

    // Analyze build output
    const distDir = path.join(process.cwd(), 'dist');
    if (existsSync(distDir)) {
      try {
        const output = execSync(
          `find ${distDir} -name "*.js" -type f -exec ls -l {} + | awk '{sum += $5} END {print sum}'`,
          {
            encoding: 'utf8',
          }
        );
        sizes.total = parseInt(output.trim()) || 0;

        // Try to get specific bundle sizes
        const mainBundle = execSync(
          `find ${distDir} -name "*main*.js" -type f -exec ls -l {} + | awk '{sum += $5} END {print sum}'`,
          {
            encoding: 'utf8',
          }
        ).trim();
        sizes.main = parseInt(mainBundle) || sizes.total / 2;

        const vendorBundle = execSync(
          `find ${distDir} -name "*vendor*.js" -type f -exec ls -l {} + | awk '{sum += $5} END {print sum}'`,
          {
            encoding: 'utf8',
          }
        ).trim();
        sizes.vendor = parseInt(vendorBundle) || sizes.total / 2;
      } catch (error) {
        console.warn('⚠️  Could not analyze bundle sizes in detail');
      }
    }

    return sizes;
  }

  private async measureBuildTime(): Promise<BenchmarkMetrics['buildTime']> {
    console.log('🏗️  Measuring build times...');

    const times = {
      frontend: 0,
      backend: 0,
      total: 0,
    };

    // Clean build artifacts first
    try {
      execSync('rm -rf dist', { stdio: 'pipe' });
    } catch {}

    // Measure frontend build time
    const frontendStart = performance.now();
    try {
      execSync('npm run build', { stdio: 'pipe' });
      times.frontend = performance.now() - frontendStart;
    } catch (error) {
      console.warn('⚠️  Frontend build failed');
    }

    // Measure backend build time (TypeScript compilation)
    const backendStart = performance.now();
    try {
      execSync('npx tsc --noEmit', { stdio: 'pipe' });
      times.backend = performance.now() - backendStart;
    } catch (error) {
      console.warn('⚠️  Backend type check failed');
    }

    times.total = times.frontend + times.backend;

    return times;
  }

  private async measureMemoryUsage(): Promise<BenchmarkMetrics['memoryUsage']> {
    console.log('🧠 Measuring memory usage...');

    // Run the memory check script
    let memoryData = {
      heapUsed: 0,
      heapTotal: 0,
      rss: 0,
    };

    try {
      execSync('npm run test:memory', { stdio: 'pipe' });

      if (existsSync('memory-results.json')) {
        const results = JSON.parse(readFileSync('memory-results.json', 'utf8'));
        const finalMeasurement = results.measurements[results.measurements.length - 1];

        memoryData = {
          heapUsed: finalMeasurement.heapUsedMB * 1024 * 1024, // Convert to bytes
          heapTotal: finalMeasurement.heapTotal,
          rss: finalMeasurement.rssGB * 1024 * 1024 * 1024, // Convert to bytes
        };
      }
    } catch (error) {
      console.warn('⚠️  Memory measurement failed');
    }

    return memoryData;
  }

  private compareWithBaseline(
    current: BenchmarkMetrics,
    baseline: BenchmarkMetrics
  ): BenchmarkResult['comparison'] {
    const thresholds = this.loadThresholds();
    const differences: Record<string, any> = {};
    const failureReasons: string[] = [];

    // Compare test execution times
    this.compareMetric(
      'Test Execution Time (Unit)',
      current.testExecutionTime.unit,
      baseline.testExecutionTime.unit,
      thresholds.testExecutionTime.unit,
      differences,
      failureReasons,
      'ms'
    );

    this.compareMetric(
      'Test Execution Time (Integration)',
      current.testExecutionTime.integration,
      baseline.testExecutionTime.integration,
      thresholds.testExecutionTime.integration,
      differences,
      failureReasons,
      'ms'
    );

    this.compareMetric(
      'Test Execution Time (E2E)',
      current.testExecutionTime.e2e,
      baseline.testExecutionTime.e2e,
      thresholds.testExecutionTime.e2e,
      differences,
      failureReasons,
      'ms'
    );

    // Compare bundle sizes
    this.compareMetric(
      'Bundle Size (Main)',
      current.bundleSize.main,
      baseline.bundleSize.main,
      thresholds.bundleSize.main,
      differences,
      failureReasons,
      'bytes'
    );

    this.compareMetric(
      'Bundle Size (Total)',
      current.bundleSize.total,
      baseline.bundleSize.total,
      thresholds.bundleSize.total,
      differences,
      failureReasons,
      'bytes'
    );

    // Compare build times
    this.compareMetric(
      'Build Time (Frontend)',
      current.buildTime.frontend,
      baseline.buildTime.frontend,
      thresholds.buildTime.frontend,
      differences,
      failureReasons,
      'ms'
    );

    // Compare memory usage
    this.compareMetric(
      'Memory Usage (Heap)',
      current.memoryUsage.heapUsed,
      baseline.memoryUsage.heapUsed,
      thresholds.memoryUsage.heapUsed,
      differences,
      failureReasons,
      'bytes'
    );

    return {
      baseline,
      differences,
      passed: failureReasons.length === 0,
      failureReasons,
    };
  }

  private compareMetric(
    name: string,
    current: number,
    baseline: number,
    threshold: { max: number; warning: number },
    differences: Record<string, any>,
    failureReasons: string[],
    unit: string
  ): void {
    const diff = current - baseline;
    const percentChange = baseline > 0 ? (diff / baseline) * 100 : 0;

    differences[name] = {
      current,
      baseline,
      diff,
      percentChange: percentChange.toFixed(2) + '%',
      unit,
    };

    // Check against thresholds
    if (current > threshold.max) {
      failureReasons.push(
        `${name} exceeds maximum threshold: ${this.formatValue(current, unit)} > ${this.formatValue(threshold.max, unit)}`
      );
    } else if (current > threshold.warning) {
      console.warn(
        `⚠️  ${name} exceeds warning threshold: ${this.formatValue(current, unit)} > ${this.formatValue(threshold.warning, unit)}`
      );
    }
  }

  private formatValue(value: number, unit: string): string {
    switch (unit) {
      case 'ms':
        return value < 1000 ? `${value.toFixed(0)}ms` : `${(value / 1000).toFixed(2)}s`;
      case 'bytes':
        if (value < 1024) return `${value}B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)}KB`;
        return `${(value / 1024 / 1024).toFixed(2)}MB`;
      default:
        return value.toString();
    }
  }

  private loadThresholds(): PerformanceThresholds {
    // Load custom thresholds if exists, otherwise use defaults
    if (existsSync(this.thresholdsFile)) {
      return JSON.parse(readFileSync(this.thresholdsFile, 'utf8'));
    }

    // Default thresholds
    return {
      testExecutionTime: {
        unit: { max: 30000, warning: 20000 }, // 30s max, 20s warning
        integration: { max: 60000, warning: 45000 }, // 60s max, 45s warning
        e2e: { max: 120000, warning: 90000 }, // 120s max, 90s warning
        total: { max: 300000, warning: 240000 }, // 5m max, 4m warning
      },
      bundleSize: {
        main: { max: 512 * 1024, warning: 400 * 1024 }, // 512KB max, 400KB warning
        vendor: { max: 1024 * 1024, warning: 800 * 1024 }, // 1MB max, 800KB warning
        total: { max: 2 * 1024 * 1024, warning: 1.5 * 1024 * 1024 }, // 2MB max, 1.5MB warning
      },
      buildTime: {
        frontend: { max: 60000, warning: 45000 }, // 60s max, 45s warning
        backend: { max: 30000, warning: 20000 }, // 30s max, 20s warning
        total: { max: 90000, warning: 65000 }, // 90s max, 65s warning
      },
      memoryUsage: {
        heapUsed: { max: 512 * 1024 * 1024, warning: 384 * 1024 * 1024 }, // 512MB max, 384MB warning
        rss: { max: 1024 * 1024 * 1024, warning: 768 * 1024 * 1024 }, // 1GB max, 768MB warning
      },
    };
  }

  private saveResults(result: BenchmarkResult): void {
    // Save timestamped result
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultFile = path.join(this.resultsDir, `benchmark-${timestamp}.json`);
    writeFileSync(resultFile, JSON.stringify(result, null, 2));

    // Save as latest result
    const latestFile = path.join(this.resultsDir, 'latest.json');
    writeFileSync(latestFile, JSON.stringify(result, null, 2));

    // Update baseline if on main branch and all tests passed
    if (this.getGitBranch() === 'main' && result.comparison?.passed !== false) {
      writeFileSync(this.baselineFile, JSON.stringify(result.metrics, null, 2));
      console.log('✅ Updated performance baseline');
    }
  }

  private printReport(result: BenchmarkResult): void {
    console.log('\n📊 Performance Benchmark Report');
    console.log('================================\n');

    console.log(`📅 Timestamp: ${result.timestamp}`);
    console.log(`🔖 Commit: ${result.commit}`);
    console.log(`🌿 Branch: ${result.branch}\n`);

    console.log('📈 Current Metrics:');
    console.log('------------------');
    this.printMetrics(result.metrics);

    if (result.comparison) {
      console.log('\n🔄 Comparison with Baseline:');
      console.log('---------------------------');

      for (const [metric, data] of Object.entries(result.comparison.differences)) {
        const { current, baseline, diff, percentChange, unit } = data as any;
        const symbol = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
        const color = diff > 0 ? '\x1b[31m' : diff < 0 ? '\x1b[32m' : '\x1b[0m';

        console.log(
          `${symbol} ${metric}: ${this.formatValue(baseline, unit)} → ${this.formatValue(current, unit)} ` +
            `${color}(${diff > 0 ? '+' : ''}${this.formatValue(Math.abs(diff), unit)}, ${percentChange})\x1b[0m`
        );
      }

      if (result.comparison.failureReasons.length > 0) {
        console.log('\n❌ Performance Threshold Failures:');
        console.log('----------------------------------');
        for (const reason of result.comparison.failureReasons) {
          console.log(`  • ${reason}`);
        }
      } else {
        console.log('\n✅ All performance thresholds passed!');
      }
    }
  }

  private printMetrics(metrics: BenchmarkMetrics): void {
    console.log(`  Test Execution Times:`);
    console.log(`    • Unit: ${this.formatValue(metrics.testExecutionTime.unit, 'ms')}`);
    console.log(
      `    • Integration: ${this.formatValue(metrics.testExecutionTime.integration, 'ms')}`
    );
    console.log(`    • E2E: ${this.formatValue(metrics.testExecutionTime.e2e, 'ms')}`);
    console.log(`    • Total: ${this.formatValue(metrics.testExecutionTime.total, 'ms')}`);

    console.log(`  Bundle Sizes:`);
    console.log(`    • Main: ${this.formatValue(metrics.bundleSize.main, 'bytes')}`);
    console.log(`    • Vendor: ${this.formatValue(metrics.bundleSize.vendor, 'bytes')}`);
    console.log(`    • Total: ${this.formatValue(metrics.bundleSize.total, 'bytes')}`);

    console.log(`  Build Times:`);
    console.log(`    • Frontend: ${this.formatValue(metrics.buildTime.frontend, 'ms')}`);
    console.log(`    • Backend: ${this.formatValue(metrics.buildTime.backend, 'ms')}`);
    console.log(`    • Total: ${this.formatValue(metrics.buildTime.total, 'ms')}`);

    console.log(`  Memory Usage:`);
    console.log(`    • Heap Used: ${this.formatValue(metrics.memoryUsage.heapUsed, 'bytes')}`);
    console.log(`    • RSS: ${this.formatValue(metrics.memoryUsage.rss, 'bytes')}`);
  }

  private getGitCommit(): string {
    try {
      return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  private getGitBranch(): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }
}

// Main execution
async function main() {
  const benchmark = new PerformanceBenchmark();
  await benchmark.runBenchmarks();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Performance benchmark failed:', error);
    process.exit(1);
  });
}

export { PerformanceBenchmark };

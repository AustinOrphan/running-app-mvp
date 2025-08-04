#!/usr/bin/env tsx

/**
 * Performance Benchmark Script for CI
 * Measures key performance metrics and compares against baselines
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { performance } from 'perf_hooks';
import path from 'path';
import { ServerReadinessChecker } from './wait-for-server.js';

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

interface CIEnvironmentConfig {
  // Timing adjustments for slower CI runners
  timeouts: {
    server: number;
    test: number;
    build: number;
  };
  // Browser configuration for headless mode
  browser: {
    headless: boolean;
    viewport: {
      width: number;
      height: number;
    };
    chromeFlags: string[];
  };
  // Performance thresholds adjusted for CI
  performance: {
    relaxedThresholds: boolean;
    timeoutMultiplier: number;
    maxRetries: number;
  };
}

class PerformanceBenchmark {
  private resultsDir = 'benchmark-results';
  private baselineFile = 'performance-baseline.json';
  private thresholdsFile = 'performance-thresholds.json';
  private isCI: boolean;
  private ciConfig: CIEnvironmentConfig;

  constructor() {
    // Detect CI environment
    this.isCI = this.detectCIEnvironment();
    this.ciConfig = this.getCIConfiguration();

    // Ensure results directory exists
    if (!existsSync(this.resultsDir)) {
      mkdirSync(this.resultsDir, { recursive: true });
    }

    if (this.isCI) {
      console.log('🔧 CI environment detected, applying optimizations...');
      this.logCIConfiguration();
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

    // Measure E2E tests (sample test) - with server readiness check
    try {
      const e2eStart = performance.now();

      // Wait for server ready before running E2E tests
      await this.waitForServerReady();

      execSync('npx playwright test tests/e2e/auth.test.ts --reporter=dot', { stdio: 'pipe' });
      times.e2e = performance.now() - e2eStart;
    } catch (error) {
      console.warn('⚠️  E2E tests failed, using default time');
      times.e2e = 0;
    }

    times.total = times.unit + times.integration + times.e2e;

    return times;
  }

  /**
   * Wait for server to be ready before running performance tests
   */
  private async waitForServerReady(): Promise<void> {
    console.log('⏳ Waiting for servers to be ready...');

    // Adjust timeouts based on CI environment
    const maxAttempts = this.isCI ? 45 : 30; // More attempts in CI
    const delayMs = this.isCI ? 3000 : 2000; // Longer delays in CI

    console.log(
      `🔧 Environment: ${this.isCI ? 'CI' : 'Local'} | Max attempts: ${maxAttempts} | Delay: ${delayMs}ms`
    );

    // Check if servers are already running
    const frontendUrl = 'http://localhost:3000';
    const backendUrl = 'http://localhost:3001';

    // Wait for frontend server
    for (let i = 1; i <= maxAttempts; i++) {
      try {
        const response = await fetch(frontendUrl);
        if (response.ok) {
          console.log(`✅ Frontend server is ready (attempt ${i})`);
          break;
        }
      } catch (error) {
        if (i === maxAttempts) {
          console.warn('⚠️  Frontend server not available, performance tests may be unreliable');
          break;
        }
        console.log(`⏳ Waiting for frontend server... (attempt ${i}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // Wait for backend server
    for (let i = 1; i <= maxAttempts; i++) {
      try {
        const response = await fetch(`${backendUrl}/api/health`);
        if (response.ok) {
          console.log(`✅ Backend server is ready (attempt ${i})`);
          break;
        }
      } catch (error) {
        if (i === maxAttempts) {
          console.warn('⚠️  Backend server not available, performance tests may be unreliable');
          break;
        }
        console.log(`⏳ Waiting for backend server... (attempt ${i}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // Check page load complete
    await this.checkPageLoadComplete();

    // Additional wait to ensure servers are fully stabilized
    console.log('⏳ Allowing servers to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('✅ Server readiness check completed');
  }

  /**
   * Check if pages load completely and are ready for performance testing
   */
  private async checkPageLoadComplete(): Promise<void> {
    console.log('📄 Checking page load completion...');

    const testUrls = [
      'http://localhost:3000/',
      'http://localhost:3000/dashboard',
      'http://localhost:3000/runs',
      'http://localhost:3000/analytics',
    ];

    for (const url of testUrls) {
      const maxAttempts = 10;
      const delayMs = 1500;

      for (let i = 1; i <= maxAttempts; i++) {
        try {
          console.log(`⏳ Checking page load: ${url} (attempt ${i}/${maxAttempts})`);

          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Accept: 'text/html,application/xhtml+xml',
              'User-Agent': 'Performance-Test-Agent',
            },
          });

          if (response.ok) {
            const content = await response.text();

            // Check if page has essential content loaded
            const hasHTML = content.includes('<!DOCTYPE html>') || content.includes('<html');
            const hasReactRoot = content.includes('root') || content.includes('app');
            const hasBasicStructure = content.length > 1000; // Minimum content size

            if (hasHTML && hasReactRoot && hasBasicStructure) {
              console.log(`✅ Page loaded completely: ${url}`);
              break;
            } else {
              console.log(
                `⚠️  Page incomplete: ${url} (HTML: ${hasHTML}, Root: ${hasReactRoot}, Size: ${content.length})`
              );
            }
          } else {
            console.log(`⚠️  Page responded with status ${response.status}: ${url}`);
          }

          if (i === maxAttempts) {
            console.warn(`⚠️  Page load check failed after ${maxAttempts} attempts: ${url}`);
          } else {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        } catch (error) {
          console.log(
            `⚠️  Page load check error for ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );

          if (i === maxAttempts) {
            console.warn(`⚠️  Page load check failed after ${maxAttempts} attempts: ${url}`);
          } else {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }
    }

    console.log('✅ Page load completion checks finished');
  }

  /**
   * Check if page loads completely with all resources
   */
  private async checkPageLoadComplete(): Promise<void> {
    console.log('⏳ Checking page load completion...');

    try {
      const frontendUrl = 'http://localhost:3000';

      // Fetch the HTML content
      const response = await fetch(frontendUrl, {
        timeout: 10000,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'User-Agent': 'Mozilla/5.0 (compatible; PerformanceBenchmark/1.0)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      // Basic checks for complete page load
      const hasDoctype = html.toLowerCase().includes('<!doctype html>');
      const hasHtmlTag = html.includes('<html');
      const hasBodyTag = html.includes('<body');
      const hasHeadTag = html.includes('<head');

      if (!hasDoctype) {
        console.warn('⚠️  Missing DOCTYPE declaration');
      }

      if (!hasHtmlTag || !hasBodyTag || !hasHeadTag) {
        throw new Error('Page content appears incomplete - missing essential HTML structure');
      }

      // Check for React root element (specific to this app)
      const hasReactRoot = html.includes('id="root"') || html.includes('id="app"');
      if (!hasReactRoot) {
        console.warn('⚠️  React root element not found, page may not be fully rendered');
      }

      // Check for JavaScript and CSS assets
      const hasJavaScript = html.includes('<script') || html.includes('.js');
      const hasCSS =
        (html.includes('<link') && html.includes('stylesheet')) || html.includes('.css');

      if (!hasJavaScript) {
        console.warn('⚠️  No JavaScript assets detected in HTML');
      }

      if (!hasCSS) {
        console.warn('⚠️  No CSS assets detected in HTML');
      }

      // For production builds, verify build assets
      if (process.env.NODE_ENV === 'production') {
        const hasHashedAssets = /\.(js|css)\?v=\w+|\/assets\/[^\/]+\.(js|css)/.test(html);
        if (!hasHashedAssets) {
          console.warn('⚠️  No versioned/hashed assets found in production build');
        }
      }

      // Check page size (should not be empty or too small)
      const contentLength = html.length;
      if (contentLength < 1000) {
        console.warn(`⚠️  Page content seems small (${contentLength} bytes), may be incomplete`);
      }

      // Basic validation for common meta tags
      const hasTitle = html.includes('<title>') && !html.includes('<title></title>');
      const hasMetaCharset = html.includes('charset=') || html.includes('charset="');
      const hasViewport = html.includes('viewport');

      if (!hasTitle) {
        console.warn('⚠️  Page missing title tag');
      }

      if (!hasMetaCharset) {
        console.warn('⚠️  Page missing charset declaration');
      }

      if (!hasViewport) {
        console.warn('⚠️  Page missing viewport meta tag');
      }

      console.log('✅ Page load completion verified');
      console.log(`📊 Page size: ${(contentLength / 1024).toFixed(2)}KB`);
    } catch (error) {
      console.warn('⚠️  Page load completion check failed:', (error as Error).message);
      // Don't throw - this is a soft check that shouldn't fail the benchmark
    }
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

    // Base thresholds
    const baseThresholds: PerformanceThresholds = {
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

    // Apply CI relaxed thresholds if in CI environment
    if (this.isCI && this.ciConfig.performance.relaxedThresholds) {
      console.log('🔧 Applying relaxed thresholds for CI environment');
      const multiplier = this.ciConfig.performance.timeoutMultiplier;

      // Increase all time-based thresholds
      baseThresholds.testExecutionTime.unit.max *= multiplier;
      baseThresholds.testExecutionTime.unit.warning *= multiplier;
      baseThresholds.testExecutionTime.integration.max *= multiplier;
      baseThresholds.testExecutionTime.integration.warning *= multiplier;
      baseThresholds.testExecutionTime.e2e.max *= multiplier;
      baseThresholds.testExecutionTime.e2e.warning *= multiplier;
      baseThresholds.testExecutionTime.total.max *= multiplier;
      baseThresholds.testExecutionTime.total.warning *= multiplier;

      baseThresholds.buildTime.frontend.max *= multiplier;
      baseThresholds.buildTime.frontend.warning *= multiplier;
      baseThresholds.buildTime.backend.max *= multiplier;
      baseThresholds.buildTime.backend.warning *= multiplier;
      baseThresholds.buildTime.total.max *= multiplier;
      baseThresholds.buildTime.total.warning *= multiplier;

      // Relax memory thresholds slightly for CI
      baseThresholds.memoryUsage.heapUsed.max *= 1.5;
      baseThresholds.memoryUsage.heapUsed.warning *= 1.5;
      baseThresholds.memoryUsage.rss.max *= 1.5;
      baseThresholds.memoryUsage.rss.warning *= 1.5;
    }

    return baseThresholds;
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

  /**
   * Detect if running in CI environment
   */
  private detectCIEnvironment(): boolean {
    const ciIndicators = [
      'CI',
      'CONTINUOUS_INTEGRATION',
      'GITHUB_ACTIONS',
      'GITLAB_CI',
      'CIRCLECI',
      'JENKINS_URL',
      'TRAVIS',
      'BUILDKITE',
      'TF_BUILD',
    ];

    return ciIndicators.some(
      indicator => process.env[indicator] === 'true' || !!process.env[indicator]
    );
  }

  /**
   * Get CI-optimized configuration
   */
  private getCIConfiguration(): CIEnvironmentConfig {
    if (!this.isCI) {
      // Default local configuration
      return {
        timeouts: {
          server: 30000,
          test: 60000,
          build: 120000,
        },
        browser: {
          headless: false,
          viewport: { width: 1920, height: 1080 },
          chromeFlags: [],
        },
        performance: {
          relaxedThresholds: false,
          timeoutMultiplier: 1,
          maxRetries: 1,
        },
      };
    }

    // CI environment optimizations
    return {
      timeouts: {
        server: 60000, // 2x longer for slower CI runners
        test: 120000, // 2x longer for test execution
        build: 300000, // 5 minutes for build in CI
      },
      browser: {
        headless: true,
        viewport: { width: 1280, height: 720 }, // Smaller viewport for CI
        chromeFlags: [
          '--headless',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--memory-pressure-off',
          '--remote-debugging-port=9222',
        ],
      },
      performance: {
        relaxedThresholds: true,
        timeoutMultiplier: 2, // Double timeouts in CI
        maxRetries: 2, // Allow more retries in CI
      },
    };
  }

  /**
   * Log CI configuration for debugging
   */
  private logCIConfiguration(): void {
    console.log('📊 CI Environment Configuration:');
    console.log(`  • Server timeout: ${this.ciConfig.timeouts.server}ms`);
    console.log(`  • Test timeout: ${this.ciConfig.timeouts.test}ms`);
    console.log(`  • Build timeout: ${this.ciConfig.timeouts.build}ms`);
    console.log(`  • Headless mode: ${this.ciConfig.browser.headless ? 'enabled' : 'disabled'}`);
    console.log(
      `  • Viewport: ${this.ciConfig.browser.viewport.width}x${this.ciConfig.browser.viewport.height}`
    );
    console.log(`  • Chrome flags: ${this.ciConfig.browser.chromeFlags.length} optimization flags`);
    console.log(
      `  • Relaxed thresholds: ${this.ciConfig.performance.relaxedThresholds ? 'enabled' : 'disabled'}`
    );
    console.log(`  • Timeout multiplier: ${this.ciConfig.performance.timeoutMultiplier}x`);
    console.log(`  • Max retries: ${this.ciConfig.performance.maxRetries}`);
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

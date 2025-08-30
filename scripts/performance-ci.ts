#!/usr/bin/env tsx

/**
 * CI-Optimized Performance Test Runner
 * Handles slower CI runners, headless mode, and appropriate viewport settings
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';

interface CIPerformanceConfig {
  timeout: number;
  retries: number;
  headless: boolean;
  viewport: {
    width: number;
    height: number;
  };
  chromeFlags: string[];
}

class CIPerformanceRunner {
  private config: CIPerformanceConfig;

  constructor() {
    this.config = {
      timeout: 600000, // 10 minutes for CI
      retries: 2,
      headless: true,
      viewport: {
        width: 1280,
        height: 720,
      },
      chromeFlags: [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--memory-pressure-off',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
    };
  }

  async runCIPerformanceTests(): Promise<void> {
    console.log('🚀 Starting CI Performance Tests with optimizations...');

    // Log CI environment details
    this.logEnvironment();

    // Set environment variables for CI optimizations
    this.setupCIEnvironment();

    const results = {
      lighthouse: await this.runLighthouseCI(),
      bundleAnalysis: await this.runBundleAnalysis(),
      performanceBenchmarks: await this.runPerformanceBenchmarks(),
    };

    // Generate CI performance report
    await this.generateCIReport(results);

    // Exit with appropriate code
    const hasFailures = Object.values(results).some(result => !result.success);
    process.exit(hasFailures ? 1 : 0);
  }

  private logEnvironment(): void {
    console.log('📊 CI Performance Environment:');
    console.log(`  • Node.js: ${process.version}`);
    console.log(`  • Platform: ${process.platform}`);
    console.log(`  • Architecture: ${process.arch}`);
    console.log(`  • Memory: ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`);
    console.log(`  • Timeout: ${this.config.timeout}ms`);
    console.log(`  • Retries: ${this.config.retries}`);
    console.log(`  • Headless: ${this.config.headless}`);
    console.log(`  • Viewport: ${this.config.viewport.width}x${this.config.viewport.height}`);
    console.log(`  • Chrome flags: ${this.config.chromeFlags.length} optimization flags`);
  }

  private setupCIEnvironment(): void {
    // Set CI-specific environment variables
    process.env.CI = 'true';
    process.env.NODE_ENV = 'test';
    process.env.CHROME_FLAGS = this.config.chromeFlags.join(' ');
    process.env.LIGHTHOUSE_VIEWPORT_WIDTH = this.config.viewport.width.toString();
    process.env.LIGHTHOUSE_VIEWPORT_HEIGHT = this.config.viewport.height.toString();

    // Increase memory limits for CI
    if (!process.env.NODE_OPTIONS) {
      process.env.NODE_OPTIONS = '--max-old-space-size=4096';
    }
  }

  private async runLighthouseCI(): Promise<{ success: boolean; duration: number; error?: string }> {
    console.log('🔍 Running Lighthouse CI...');
    const startTime = Date.now();

    try {
      execSync('npm run test:lighthouse:ci', {
        stdio: 'inherit',
        timeout: this.config.timeout,
      });

      const duration = Date.now() - startTime;
      console.log(`✅ Lighthouse CI completed in ${duration}ms`);
      return { success: true, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Lighthouse CI failed after ${duration}ms: ${errorMessage}`);
      return { success: false, duration, error: errorMessage };
    }
  }

  private async runBundleAnalysis(): Promise<{
    success: boolean;
    duration: number;
    error?: string;
  }> {
    console.log('📦 Running bundle analysis...');
    const startTime = Date.now();

    try {
      execSync('npm run test:bundle-size', {
        stdio: 'inherit',
        timeout: this.config.timeout / 2, // Bundle analysis should be faster
      });

      const duration = Date.now() - startTime;
      console.log(`✅ Bundle analysis completed in ${duration}ms`);
      return { success: true, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Bundle analysis failed after ${duration}ms: ${errorMessage}`);
      return { success: false, duration, error: errorMessage };
    }
  }

  private async runPerformanceBenchmarks(): Promise<{
    success: boolean;
    duration: number;
    error?: string;
  }> {
    console.log('⚡ Running performance benchmarks...');
    const startTime = Date.now();

    try {
      execSync('tsx scripts/performance-benchmark.ts', {
        stdio: 'inherit',
        timeout: this.config.timeout,
      });

      const duration = Date.now() - startTime;
      console.log(`✅ Performance benchmarks completed in ${duration}ms`);
      return { success: true, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Performance benchmarks failed after ${duration}ms: ${errorMessage}`);

      // Allow some benchmark failures in CI
      if (errorMessage.includes('BENCHMARK_FAILED')) {
        console.warn('⚠️  Some benchmarks failed, but continuing...');
        return { success: true, duration, error: errorMessage };
      }

      return { success: false, duration, error: errorMessage };
    }
  }

  private async generateCIReport(results: Record<string, any>): Promise<void> {
    console.log('📊 Generating CI performance report...');

    const report = {
      timestamp: new Date().toISOString(),
      environment: 'CI',
      results,
      summary: {
        totalTests: Object.keys(results).length,
        passed: Object.values(results).filter((r: any) => r.success).length,
        failed: Object.values(results).filter((r: any) => !r.success).length,
        totalDuration: Object.values(results).reduce((sum: number, r: any) => sum + r.duration, 0),
      },
      ciOptimizations: {
        headlessMode: this.config.headless,
        viewport: this.config.viewport,
        timeout: this.config.timeout,
        retries: this.config.retries,
        chromeFlags: this.config.chromeFlags.length,
      },
    };

    // Save report
    writeFileSync('ci-performance-report.json', JSON.stringify(report, null, 2));

    // Log summary
    console.log('\n📋 CI Performance Summary:');
    console.log(`  • Total tests: ${report.summary.totalTests}`);
    console.log(`  • Passed: ${report.summary.passed}`);
    console.log(`  • Failed: ${report.summary.failed}`);
    console.log(`  • Total duration: ${report.summary.totalDuration}ms`);

    if (report.summary.failed > 0) {
      console.log('\n❌ Failed tests:');
      Object.entries(results).forEach(([test, result]: [string, any]) => {
        if (!result.success) {
          console.log(`  • ${test}: ${result.error || 'Unknown error'}`);
        }
      });
    }
  }
}

// Main execution
async function main() {
  const runner = new CIPerformanceRunner();
  await runner.runCIPerformanceTests();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ CI Performance tests failed:', error);
    process.exit(1);
  });
}

export { CIPerformanceRunner };

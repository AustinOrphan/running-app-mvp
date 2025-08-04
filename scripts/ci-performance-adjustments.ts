#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { CIResourceMonitor } from './ci-resource-monitor';

interface PerformanceAdjustments {
  testTimeouts: {
    unit: number;
    integration: number;
    e2e: number;
  };
  bundleSizeLimits: {
    multiplier: number;
  };
  responseTimes: {
    multiplier: number;
  };
  parallelism: {
    maxWorkers: number;
    maxThreads: number;
    maxConcurrency: number;
  };
  memory: {
    maxOldSpaceSize: number;
    heapSizeLimit: number;
  };
  retries: {
    unit: number;
    integration: number;
    e2e: number;
  };
}

class CIPerformanceAdjuster {
  private monitor: CIResourceMonitor;
  private baseThresholds: any;

  constructor() {
    this.monitor = new CIResourceMonitor();
    this.loadBaseThresholds();
  }

  private loadBaseThresholds(): void {
    const thresholdPath = path.join(process.cwd(), 'performance-thresholds-detailed.json');
    if (fs.existsSync(thresholdPath)) {
      this.baseThresholds = JSON.parse(fs.readFileSync(thresholdPath, 'utf-8'));
    } else {
      console.error('Base threshold file not found');
      this.baseThresholds = {};
    }
  }

  calculateAdjustments(): PerformanceAdjustments {
    const metrics = this.monitor.getCurrentMetrics();
    const limits = this.monitor.getCIResourceLimits();

    // Base adjustments for CI environment
    const adjustments: PerformanceAdjustments = {
      testTimeouts: {
        unit: 30000, // 30s
        integration: 45000, // 45s
        e2e: 60000, // 60s
      },
      bundleSizeLimits: {
        multiplier: 1.2, // Allow 20% larger bundles in CI
      },
      responseTimes: {
        multiplier: 2.0, // Allow 2x slower response times in CI
      },
      parallelism: {
        maxWorkers: 1,
        maxThreads: 2,
        maxConcurrency: 1,
      },
      memory: {
        maxOldSpaceSize: 4096,
        heapSizeLimit: 4096,
      },
      retries: {
        unit: 2,
        integration: 3,
        e2e: 3,
      },
    };

    // Adjust based on available resources
    if (metrics.cpu.cores <= 2) {
      // Limited CPU: Reduce parallelism further
      adjustments.parallelism.maxWorkers = 1;
      adjustments.parallelism.maxThreads = 1;
      adjustments.testTimeouts.unit *= 1.5;
      adjustments.testTimeouts.integration *= 1.5;
      adjustments.testTimeouts.e2e *= 1.5;
    }

    if (metrics.memory.total < 8192) {
      // Less than 8GB RAM
      // Limited memory: Adjust heap sizes
      adjustments.memory.maxOldSpaceSize = Math.floor(metrics.memory.total * 0.5);
      adjustments.memory.heapSizeLimit = Math.floor(metrics.memory.total * 0.5);

      // Increase timeouts due to potential GC pressure
      adjustments.testTimeouts.unit *= 1.2;
      adjustments.testTimeouts.integration *= 1.2;
      adjustments.testTimeouts.e2e *= 1.2;
    }

    if (metrics.memory.total < 4096) {
      // Less than 4GB RAM
      // Very limited memory: More aggressive adjustments
      adjustments.memory.maxOldSpaceSize = Math.floor(metrics.memory.total * 0.4);
      adjustments.memory.heapSizeLimit = Math.floor(metrics.memory.total * 0.4);
      adjustments.retries.e2e = 4; // More retries for flaky tests
    }

    // Adjust based on CI platform
    switch (metrics.environment.ciPlatform) {
      case 'GitHub Actions':
        // GitHub Actions specific adjustments
        adjustments.parallelism.maxWorkers = 2;
        adjustments.parallelism.maxThreads = 2;
        break;

      case 'CircleCI':
        // CircleCI with medium resource class
        adjustments.memory.maxOldSpaceSize = 2048;
        adjustments.memory.heapSizeLimit = 2048;
        break;

      case 'GitLab CI':
        // GitLab shared runners
        adjustments.parallelism.maxWorkers = 2;
        adjustments.parallelism.maxThreads = 2;
        break;
    }

    return adjustments;
  }

  generateCIThresholds(): void {
    const adjustments = this.calculateAdjustments();
    const ciThresholds = JSON.parse(JSON.stringify(this.baseThresholds));

    // Apply response time adjustments
    if (ciThresholds.responseTime) {
      this.applyMultiplier(ciThresholds.responseTime, adjustments.responseTimes.multiplier);
    }

    // Apply bundle size adjustments
    if (ciThresholds.bundleSize) {
      this.applyMultiplier(ciThresholds.bundleSize, adjustments.bundleSizeLimits.multiplier);
    }

    // Apply test timeout adjustments
    if (ciThresholds.testExecutionTime) {
      ciThresholds.testExecutionTime.unit.max = adjustments.testTimeouts.unit;
      ciThresholds.testExecutionTime.unit.warning = adjustments.testTimeouts.unit * 0.8;
      ciThresholds.testExecutionTime.integration.max = adjustments.testTimeouts.integration;
      ciThresholds.testExecutionTime.integration.warning =
        adjustments.testTimeouts.integration * 0.8;
      ciThresholds.testExecutionTime.e2e.max = adjustments.testTimeouts.e2e;
      ciThresholds.testExecutionTime.e2e.warning = adjustments.testTimeouts.e2e * 0.8;
    }

    // Add CI-specific metadata
    ciThresholds.ciAdjustments = {
      ...adjustments,
      appliedAt: new Date().toISOString(),
      environment: this.monitor.getCurrentMetrics().environment,
    };

    // Save CI-specific thresholds
    const ciThresholdPath = path.join(process.cwd(), 'performance-thresholds-ci.json');
    fs.writeFileSync(ciThresholdPath, JSON.stringify(ciThresholds, null, 2));
    console.log(`✅ CI-specific thresholds saved to: ${ciThresholdPath}`);
  }

  private applyMultiplier(obj: any, multiplier: number): void {
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        this.applyMultiplier(obj[key], multiplier);
      } else if (typeof obj[key] === 'number' && (key === 'max' || key === 'warning')) {
        obj[key] = Math.floor(obj[key] * multiplier);
      }
    }
  }

  generateEnvironmentConfig(): void {
    const adjustments = this.calculateAdjustments();
    const metrics = this.monitor.getCurrentMetrics();

    // Generate CI-specific environment variables
    const envConfig = {
      // Node.js memory settings
      NODE_OPTIONS: `--max-old-space-size=${adjustments.memory.maxOldSpaceSize}`,

      // Test framework settings
      VITEST_MAX_THREADS: adjustments.parallelism.maxThreads.toString(),
      VITEST_MAX_WORKERS: adjustments.parallelism.maxWorkers.toString(),
      JEST_MAX_WORKERS: adjustments.parallelism.maxWorkers.toString(),

      // Timeout settings
      TEST_TIMEOUT_UNIT: adjustments.testTimeouts.unit.toString(),
      TEST_TIMEOUT_INTEGRATION: adjustments.testTimeouts.integration.toString(),
      TEST_TIMEOUT_E2E: adjustments.testTimeouts.e2e.toString(),

      // Retry settings
      TEST_RETRY_UNIT: adjustments.retries.unit.toString(),
      TEST_RETRY_INTEGRATION: adjustments.retries.integration.toString(),
      TEST_RETRY_E2E: adjustments.retries.e2e.toString(),

      // CI environment info
      CI_CPU_CORES: metrics.cpu.cores.toString(),
      CI_MEMORY_MB: metrics.memory.total.toString(),
      CI_PLATFORM: metrics.environment.ciPlatform || 'unknown',
    };

    // Save environment configuration
    const envPath = path.join(process.cwd(), '.env.ci');
    const envContent = Object.entries(envConfig)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    fs.writeFileSync(envPath, envContent);
    console.log(`✅ CI environment config saved to: ${envPath}`);

    // Generate shell export script
    const exportPath = path.join(process.cwd(), 'scripts/ci-env-export.sh');
    const exportContent = `#!/bin/bash
# CI Environment Configuration
# Generated at: ${new Date().toISOString()}

${Object.entries(envConfig)
  .map(([key, value]) => `export ${key}="${value}"`)
  .join('\n')}

echo "✅ CI environment variables exported"
`;

    fs.writeFileSync(exportPath, exportContent);
    fs.chmodSync(exportPath, '755');
    console.log(`✅ CI environment export script saved to: ${exportPath}`);
  }

  printRecommendations(): void {
    const metrics = this.monitor.getCurrentMetrics();
    const adjustments = this.calculateAdjustments();

    console.log('\n📋 CI Performance Recommendations:');
    console.log('='.repeat(50));

    console.log('\n1️⃣ Test Configuration:');
    console.log(`   - Unit test timeout: ${adjustments.testTimeouts.unit / 1000}s`);
    console.log(`   - Integration test timeout: ${adjustments.testTimeouts.integration / 1000}s`);
    console.log(`   - E2E test timeout: ${adjustments.testTimeouts.e2e / 1000}s`);
    console.log(`   - Max parallel workers: ${adjustments.parallelism.maxWorkers}`);
    console.log(`   - Max threads: ${adjustments.parallelism.maxThreads}`);

    console.log('\n2️⃣ Memory Settings:');
    console.log(`   - Max heap size: ${adjustments.memory.heapSizeLimit}MB`);
    console.log(`   - NODE_OPTIONS: --max-old-space-size=${adjustments.memory.maxOldSpaceSize}`);

    console.log('\n3️⃣ Performance Expectations:');
    console.log(
      `   - Response times: ${adjustments.responseTimes.multiplier}x slower than baseline`
    );
    console.log(
      `   - Bundle sizes: ${(adjustments.bundleSizeLimits.multiplier - 1) * 100}% larger allowed`
    );

    console.log('\n4️⃣ Retry Strategy:');
    console.log(`   - Unit tests: ${adjustments.retries.unit} retries`);
    console.log(`   - Integration tests: ${adjustments.retries.integration} retries`);
    console.log(`   - E2E tests: ${adjustments.retries.e2e} retries`);

    if (metrics.memory.total < 4096) {
      console.log('\n⚠️  Low Memory Warning:');
      console.log('   - Consider using smaller test datasets');
      console.log('   - Run test suites sequentially');
      console.log('   - Increase test timeouts further');
      console.log('   - Monitor for OOM errors');
    }

    if (metrics.cpu.cores <= 2) {
      console.log('\n⚠️  Limited CPU Warning:');
      console.log('   - Disable parallel test execution');
      console.log('   - Increase all timeouts by 50%');
      console.log('   - Consider splitting test jobs');
    }

    console.log('\n='.repeat(50));
  }
}

// Export for use in other scripts
export { CIPerformanceAdjuster, PerformanceAdjustments };

// Main execution
if (require.main === module) {
  const adjuster = new CIPerformanceAdjuster();

  console.log('🚀 CI Performance Adjustment Tool\n');

  // Print current environment
  adjuster.printRecommendations();

  // Generate configurations
  console.log('\n📝 Generating CI-specific configurations...\n');
  adjuster.generateCIThresholds();
  adjuster.generateEnvironmentConfig();

  console.log('\n✅ CI performance adjustments complete!');
  console.log('\nTo apply these settings in your CI workflow:');
  console.log('1. Source the environment variables: source scripts/ci-env-export.sh');
  console.log('2. Use performance-thresholds-ci.json for CI-specific thresholds');
  console.log('3. Review and apply the recommendations above');
}

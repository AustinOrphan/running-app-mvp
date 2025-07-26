#!/usr/bin/env tsx

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CIResourceMonitor } from './ci-resource-monitor';

interface TestResourceMetrics {
  testType: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  peakMemory: number;
  avgMemory: number;
  peakCpu: number;
  avgCpu: number;
  exitCode?: number;
  status: 'running' | 'completed' | 'failed';
  samples: Array<{
    timestamp: number;
    memory: number;
    cpu: number;
  }>;
}

class TestResourceMonitor {
  private monitor: CIResourceMonitor;
  private metrics: Map<string, TestResourceMetrics> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private currentProcess?: ChildProcess;
  private currentTestType?: string;

  constructor() {
    this.monitor = new CIResourceMonitor();
  }

  async monitorTestCommand(
    testType: string,
    command: string,
    args: string[] = []
  ): Promise<TestResourceMetrics> {
    console.log(`\n🔍 Monitoring resources for: ${testType}`);
    console.log(`📋 Command: ${command} ${args.join(' ')}\n`);

    const metrics: TestResourceMetrics = {
      testType,
      startTime: Date.now(),
      peakMemory: 0,
      avgMemory: 0,
      peakCpu: 0,
      avgCpu: 0,
      status: 'running',
      samples: [],
    };

    this.metrics.set(testType, metrics);
    this.currentTestType = testType;

    // Start resource monitoring
    const samples: typeof metrics.samples = [];
    this.monitoringInterval = setInterval(() => {
      const resourceMetrics = this.monitor.getCurrentMetrics();
      const sample = {
        timestamp: Date.now(),
        memory: resourceMetrics.process.memoryUsage.heapUsed / 1024 / 1024, // MB
        cpu: resourceMetrics.cpu.usage,
      };
      samples.push(sample);
      metrics.samples = samples;

      // Update peaks
      if (sample.memory > metrics.peakMemory) {
        metrics.peakMemory = sample.memory;
      }
      if (sample.cpu > metrics.peakCpu) {
        metrics.peakCpu = sample.cpu;
      }

      // Print live stats
      this.printLiveStats(testType, sample);
    }, 1000); // Sample every second

    // Run the test command
    return new Promise(resolve => {
      const child = spawn(command, args, {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env },
      });

      this.currentProcess = child;

      child.on('exit', code => {
        clearInterval(this.monitoringInterval);

        metrics.endTime = Date.now();
        metrics.duration = metrics.endTime - metrics.startTime;
        metrics.exitCode = code || 0;
        metrics.status = code === 0 ? 'completed' : 'failed';

        // Calculate averages
        if (samples.length > 0) {
          metrics.avgMemory = samples.reduce((sum, s) => sum + s.memory, 0) / samples.length;
          metrics.avgCpu = samples.reduce((sum, s) => sum + s.cpu, 0) / samples.length;
        }

        this.printTestSummary(metrics);
        resolve(metrics);
      });

      child.on('error', error => {
        console.error(`Error running ${testType}:`, error);
        metrics.status = 'failed';
        resolve(metrics);
      });
    });
  }

  private printLiveStats(testType: string, sample: { memory: number; cpu: number }): void {
    process.stdout.write(
      `\r${testType} | Memory: ${sample.memory.toFixed(2)}MB | CPU: ${sample.cpu.toFixed(1)}%`
    );
  }

  private printTestSummary(metrics: TestResourceMetrics): void {
    console.log(`\n\n📊 Test Resource Summary: ${metrics.testType}`);
    console.log('='.repeat(50));
    console.log(`Status: ${metrics.status}`);
    console.log(`Duration: ${((metrics.duration || 0) / 1000).toFixed(2)}s`);
    console.log(`Exit Code: ${metrics.exitCode}`);
    console.log('\nMemory Usage:');
    console.log(`  Peak: ${metrics.peakMemory.toFixed(2)}MB`);
    console.log(`  Average: ${metrics.avgMemory.toFixed(2)}MB`);
    console.log('\nCPU Usage:');
    console.log(`  Peak: ${metrics.peakCpu.toFixed(1)}%`);
    console.log(`  Average: ${metrics.avgCpu.toFixed(1)}%`);
    console.log('='.repeat(50));
  }

  async monitorAllTests(): Promise<void> {
    const testCommands = [
      { type: 'Unit Tests', command: 'npm', args: ['run', 'test:coverage:unit:ci'] },
      { type: 'Integration Tests', command: 'npm', args: ['run', 'test:coverage:integration:ci'] },
      { type: 'E2E Tests', command: 'npm', args: ['run', 'test:e2e:ci'] },
    ];

    console.log('🚀 Starting comprehensive test resource monitoring...\n');

    for (const test of testCommands) {
      if (process.env.CI === 'true' || process.argv.includes('--all')) {
        await this.monitorTestCommand(test.type, test.command, test.args);
      } else {
        // In non-CI, just monitor a quick test
        if (test.type === 'Unit Tests') {
          await this.monitorTestCommand(test.type, test.command, test.args);
        }
      }
    }

    this.generateComprehensiveReport();
  }

  private generateComprehensiveReport(): void {
    console.log('\n\n📈 Comprehensive Test Resource Report');
    console.log('='.repeat(70));

    const allMetrics = Array.from(this.metrics.values());

    // Overall statistics
    const totalDuration = allMetrics.reduce((sum, m) => sum + (m.duration || 0), 0);
    const overallPeakMemory = Math.max(...allMetrics.map(m => m.peakMemory));
    const overallPeakCpu = Math.max(...allMetrics.map(m => m.peakCpu));

    console.log('\n📊 Overall Statistics:');
    console.log(`Total Test Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`Peak Memory Usage: ${overallPeakMemory.toFixed(2)}MB`);
    console.log(`Peak CPU Usage: ${overallPeakCpu.toFixed(1)}%`);

    // Per-test breakdown
    console.log('\n📋 Per-Test Breakdown:');
    console.log('-'.repeat(70));
    console.log(
      'Test Type'.padEnd(20) +
        'Duration'.padEnd(12) +
        'Peak Mem'.padEnd(12) +
        'Avg Mem'.padEnd(12) +
        'Peak CPU'.padEnd(12) +
        'Status'
    );
    console.log('-'.repeat(70));

    allMetrics.forEach(m => {
      console.log(
        m.testType.padEnd(20) +
          `${((m.duration || 0) / 1000).toFixed(2)}s`.padEnd(12) +
          `${m.peakMemory.toFixed(2)}MB`.padEnd(12) +
          `${m.avgMemory.toFixed(2)}MB`.padEnd(12) +
          `${m.peakCpu.toFixed(1)}%`.padEnd(12) +
          m.status
      );
    });

    console.log('-'.repeat(70));

    // CI-specific recommendations
    if (process.env.CI === 'true') {
      console.log('\n💡 CI-Specific Recommendations:');

      if (overallPeakMemory > 4096) {
        console.log('⚠️  High memory usage detected (>4GB)');
        console.log('   - Consider splitting test suites');
        console.log('   - Increase CI runner memory if possible');
      }

      if (overallPeakCpu > 90) {
        console.log('⚠️  High CPU usage detected (>90%)');
        console.log('   - Reduce parallel test execution');
        console.log('   - Consider using more powerful CI runners');
      }

      const slowTests = allMetrics.filter(m => (m.duration || 0) > 300000); // >5 minutes
      if (slowTests.length > 0) {
        console.log('⚠️  Slow tests detected (>5 minutes):');
        slowTests.forEach(m => {
          console.log(`   - ${m.testType}: ${((m.duration || 0) / 1000).toFixed(2)}s`);
        });
      }
    }

    // Save detailed report
    const reportPath = path.join(
      process.cwd(),
      'performance-reports',
      `test-resources-${Date.now()}.json`
    );
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });

    const report = {
      timestamp: new Date().toISOString(),
      environment: this.monitor.getCurrentMetrics().environment,
      summary: {
        totalDuration,
        overallPeakMemory,
        overallPeakCpu,
        testCount: allMetrics.length,
        failedTests: allMetrics.filter(m => m.status === 'failed').length,
      },
      tests: allMetrics,
      ciResourceLimits: this.monitor.getCIResourceLimits(),
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }

  generateResourceGraphs(): void {
    // Generate CSV files for graphing
    this.metrics.forEach((metrics, testType) => {
      if (metrics.samples.length === 0) return;

      const csvPath = path.join(
        process.cwd(),
        'performance-reports',
        `${testType.replace(/\s+/g, '-').toLowerCase()}-resources.csv`
      );

      const csvContent =
        'timestamp,memory_mb,cpu_percent\n' +
        metrics.samples
          .map(s => `${s.timestamp},${s.memory.toFixed(2)},${s.cpu.toFixed(1)}`)
          .join('\n');

      fs.mkdirSync(path.dirname(csvPath), { recursive: true });
      fs.writeFileSync(csvPath, csvContent);
    });

    console.log('\n📊 Resource usage data exported for graphing');
  }
}

// Export for use in other scripts
export { TestResourceMonitor, TestResourceMetrics };

// Main execution
if (require.main === module) {
  const monitor = new TestResourceMonitor();

  // Check command line arguments
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log('Test Resource Monitor');
    console.log('Usage: npm run monitor-test-resources [options]');
    console.log('\nOptions:');
    console.log('  --all          Monitor all test types (unit, integration, e2e)');
    console.log('  --test <type>  Monitor specific test type');
    console.log('  --help         Show this help message');
    process.exit(0);
  }

  if (args.includes('--test')) {
    const testIndex = args.indexOf('--test');
    const testType = args[testIndex + 1];

    const testMap: Record<string, { command: string; args: string[] }> = {
      unit: { command: 'npm', args: ['run', 'test:coverage:unit:ci'] },
      integration: { command: 'npm', args: ['run', 'test:coverage:integration:ci'] },
      e2e: { command: 'npm', args: ['run', 'test:e2e:ci'] },
    };

    const test = testMap[testType];
    if (test) {
      monitor.monitorTestCommand(`${testType} tests`, test.command, test.args).then(() => {
        monitor.generateResourceGraphs();
        process.exit(0);
      });
    } else {
      console.error(`Unknown test type: ${testType}`);
      process.exit(1);
    }
  } else {
    // Monitor all tests or just unit tests based on environment
    monitor
      .monitorAllTests()
      .then(() => {
        monitor.generateResourceGraphs();
        process.exit(0);
      })
      .catch(error => {
        console.error('Error:', error);
        process.exit(1);
      });
  }
}

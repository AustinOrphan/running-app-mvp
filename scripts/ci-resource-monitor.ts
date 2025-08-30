#!/usr/bin/env tsx

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface ResourceMetrics {
  cpu: {
    cores: number;
    usage: number;
    model: string;
    speed: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    percentage: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    percentage: number;
  };
  process: {
    pid: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
  };
  environment: {
    platform: string;
    nodejs: string;
    npm: string;
    isCI: boolean;
    ciPlatform?: string;
  };
}

interface ResourceLimits {
  memory: {
    maxHeapMB: number;
    maxRssMB: number;
    warningThresholdPercent: number;
  };
  cpu: {
    maxCores: number;
    maxUsagePercent: number;
  };
  disk: {
    minFreeMB: number;
    warningThresholdPercent: number;
  };
}

class CIResourceMonitor {
  private startTime: number;
  private isCI: boolean;
  private ciPlatform?: string;
  private monitoringInterval?: NodeJS.Timeout;
  private metrics: ResourceMetrics[] = [];

  constructor() {
    this.startTime = Date.now();
    this.isCI = process.env.CI === 'true';
    this.detectCIPlatform();
  }

  private detectCIPlatform(): void {
    // Detect common CI platforms
    if (process.env.GITHUB_ACTIONS === 'true') {
      this.ciPlatform = 'GitHub Actions';
    } else if (process.env.GITLAB_CI) {
      this.ciPlatform = 'GitLab CI';
    } else if (process.env.CIRCLECI) {
      this.ciPlatform = 'CircleCI';
    } else if (process.env.JENKINS_URL) {
      this.ciPlatform = 'Jenkins';
    } else if (process.env.TRAVIS) {
      this.ciPlatform = 'Travis CI';
    } else if (process.env.AZURE_PIPELINES) {
      this.ciPlatform = 'Azure Pipelines';
    } else if (this.isCI) {
      this.ciPlatform = 'Unknown CI';
    }
  }

  private getCPUUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - Math.floor((idle * 100) / total);

    return usage;
  }

  private getDiskUsage(): { total: number; free: number; used: number; percentage: number } {
    try {
      const platform = os.platform();
      let diskInfo: string;

      if (platform === 'win32') {
        // Windows: Use wmic
        diskInfo = execSync('wmic logicaldisk get size,freespace /format:csv', {
          encoding: 'utf8',
        });
        const lines = diskInfo
          .trim()
          .split('\n')
          .filter(line => line);
        const data = lines[lines.length - 1].split(',');
        const free = parseInt(data[1]) || 0;
        const total = parseInt(data[2]) || 0;
        const used = total - free;
        return {
          total: Math.floor(total / 1024 / 1024),
          free: Math.floor(free / 1024 / 1024),
          used: Math.floor(used / 1024 / 1024),
          percentage: total > 0 ? Math.floor((used / total) * 100) : 0,
        };
      } else {
        // Unix-like: Use df
        diskInfo = execSync('df -m .', { encoding: 'utf8' });
        const lines = diskInfo.trim().split('\n');
        const data = lines[1].split(/\s+/);
        const total = parseInt(data[1]) || 0;
        const used = parseInt(data[2]) || 0;
        const free = parseInt(data[3]) || 0;
        const percentage = parseInt(data[4]) || 0;
        return { total, free, used, percentage };
      }
    } catch (error) {
      return { total: 0, free: 0, used: 0, percentage: 0 };
    }
  }

  private getNpmVersion(): string {
    try {
      return execSync('npm --version', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  getCurrentMetrics(): ResourceMetrics {
    const cpus = os.cpus();
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memTotal - memFree;
    const diskUsage = this.getDiskUsage();
    const processMemory = process.memoryUsage();
    const processCpu = process.cpuUsage();

    return {
      cpu: {
        cores: cpus.length,
        usage: this.getCPUUsage(),
        model: cpus[0].model,
        speed: cpus[0].speed,
      },
      memory: {
        total: Math.floor(memTotal / 1024 / 1024),
        free: Math.floor(memFree / 1024 / 1024),
        used: Math.floor(memUsed / 1024 / 1024),
        percentage: Math.floor((memUsed / memTotal) * 100),
      },
      disk: diskUsage,
      process: {
        pid: process.pid,
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        memoryUsage: processMemory,
        cpuUsage: processCpu,
      },
      environment: {
        platform: os.platform(),
        nodejs: process.version,
        npm: this.getNpmVersion(),
        isCI: this.isCI,
        ciPlatform: this.ciPlatform,
      },
    };
  }

  getCIResourceLimits(): ResourceLimits {
    // Define resource limits based on CI platform
    const baselineLimits: ResourceLimits = {
      memory: {
        maxHeapMB: 4096,
        maxRssMB: 7168,
        warningThresholdPercent: 80,
      },
      cpu: {
        maxCores: 2,
        maxUsagePercent: 90,
      },
      disk: {
        minFreeMB: 1024,
        warningThresholdPercent: 90,
      },
    };

    // Adjust limits based on CI platform
    switch (this.ciPlatform) {
      case 'GitHub Actions':
        // GitHub Actions provides 2 cores, 7GB RAM
        baselineLimits.memory.maxHeapMB = 3072;
        baselineLimits.memory.maxRssMB = 6144;
        baselineLimits.cpu.maxCores = 2;
        break;

      case 'CircleCI':
        // CircleCI medium resource class: 2 cores, 4GB RAM
        baselineLimits.memory.maxHeapMB = 2048;
        baselineLimits.memory.maxRssMB = 3584;
        baselineLimits.cpu.maxCores = 2;
        break;

      case 'GitLab CI':
        // GitLab shared runners: 2 cores, 7.5GB RAM
        baselineLimits.memory.maxHeapMB = 3584;
        baselineLimits.memory.maxRssMB = 6656;
        baselineLimits.cpu.maxCores = 2;
        break;

      default:
        // Conservative defaults for unknown CI platforms
        baselineLimits.memory.maxHeapMB = 2048;
        baselineLimits.memory.maxRssMB = 4096;
        baselineLimits.cpu.maxCores = 2;
    }

    return baselineLimits;
  }

  startMonitoring(intervalMs: number = 5000): void {
    console.log('🔍 Starting CI Resource Monitoring...\n');
    this.printResourceReport();

    this.monitoringInterval = setInterval(() => {
      const metrics = this.getCurrentMetrics();
      this.metrics.push(metrics);

      // Keep only last 100 metrics to avoid memory buildup
      if (this.metrics.length > 100) {
        this.metrics.shift();
      }

      // Check for resource warnings
      this.checkResourceWarnings(metrics);
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      console.log('\n🛑 Resource monitoring stopped');
    }
  }

  private checkResourceWarnings(metrics: ResourceMetrics): void {
    const limits = this.getCIResourceLimits();
    const warnings: string[] = [];

    // Memory warnings
    const heapUsedMB = Math.floor(metrics.process.memoryUsage.heapUsed / 1024 / 1024);
    const rssUsedMB = Math.floor(metrics.process.memoryUsage.rss / 1024 / 1024);

    if (heapUsedMB > limits.memory.maxHeapMB * (limits.memory.warningThresholdPercent / 100)) {
      warnings.push(`⚠️ Heap memory usage high: ${heapUsedMB}MB / ${limits.memory.maxHeapMB}MB`);
    }

    if (rssUsedMB > limits.memory.maxRssMB * (limits.memory.warningThresholdPercent / 100)) {
      warnings.push(`⚠️ RSS memory usage high: ${rssUsedMB}MB / ${limits.memory.maxRssMB}MB`);
    }

    // CPU warnings
    if (metrics.cpu.usage > limits.cpu.maxUsagePercent) {
      warnings.push(`⚠️ CPU usage high: ${metrics.cpu.usage}%`);
    }

    // Disk warnings
    if (metrics.disk.free < limits.disk.minFreeMB) {
      warnings.push(`⚠️ Low disk space: ${metrics.disk.free}MB free`);
    }

    if (warnings.length > 0) {
      console.log('\n⚠️ Resource Warnings:');
      warnings.forEach(warning => console.log(warning));
    }
  }

  printResourceReport(): void {
    const metrics = this.getCurrentMetrics();
    const limits = this.getCIResourceLimits();

    console.log('📊 CI Resource Report');
    console.log('='.repeat(50));

    console.log('\n🖥️  Environment:');
    console.log(`  Platform: ${metrics.environment.platform}`);
    console.log(`  Node.js: ${metrics.environment.nodejs}`);
    console.log(`  npm: ${metrics.environment.npm}`);
    console.log(
      `  CI: ${metrics.environment.isCI ? `Yes (${metrics.environment.ciPlatform})` : 'No'}`
    );

    console.log('\n💻 CPU:');
    console.log(`  Model: ${metrics.cpu.model}`);
    console.log(`  Cores: ${metrics.cpu.cores} (limit: ${limits.cpu.maxCores})`);
    console.log(`  Speed: ${metrics.cpu.speed}MHz`);
    console.log(`  Usage: ${metrics.cpu.usage}%`);

    console.log('\n🧠 Memory:');
    console.log(`  Total: ${metrics.memory.total}MB`);
    console.log(`  Used: ${metrics.memory.used}MB (${metrics.memory.percentage}%)`);
    console.log(`  Free: ${metrics.memory.free}MB`);
    console.log(
      `  Process Heap: ${Math.floor(metrics.process.memoryUsage.heapUsed / 1024 / 1024)}MB / ${limits.memory.maxHeapMB}MB`
    );
    console.log(
      `  Process RSS: ${Math.floor(metrics.process.memoryUsage.rss / 1024 / 1024)}MB / ${limits.memory.maxRssMB}MB`
    );

    console.log('\n💾 Disk:');
    console.log(`  Total: ${metrics.disk.total}MB`);
    console.log(`  Used: ${metrics.disk.used}MB (${metrics.disk.percentage}%)`);
    console.log(`  Free: ${metrics.disk.free}MB (min: ${limits.disk.minFreeMB}MB)`);

    console.log('\n⚙️  Process:');
    console.log(`  PID: ${metrics.process.pid}`);
    console.log(`  Uptime: ${metrics.process.uptime}s`);
    console.log('='.repeat(50));
  }

  generateReport(): void {
    if (this.metrics.length === 0) {
      console.log('No metrics collected');
      return;
    }

    // Calculate averages
    const avgCpuUsage = this.metrics.reduce((sum, m) => sum + m.cpu.usage, 0) / this.metrics.length;
    const avgMemoryUsage =
      this.metrics.reduce((sum, m) => sum + m.memory.percentage, 0) / this.metrics.length;
    const maxHeapUsed = Math.max(...this.metrics.map(m => m.process.memoryUsage.heapUsed));
    const maxRssUsed = Math.max(...this.metrics.map(m => m.process.memoryUsage.rss));

    console.log('\n📈 Resource Usage Summary:');
    console.log(`  Average CPU Usage: ${avgCpuUsage.toFixed(2)}%`);
    console.log(`  Average Memory Usage: ${avgMemoryUsage.toFixed(2)}%`);
    console.log(`  Max Heap Used: ${Math.floor(maxHeapUsed / 1024 / 1024)}MB`);
    console.log(`  Max RSS Used: ${Math.floor(maxRssUsed / 1024 / 1024)}MB`);

    // Save report
    const reportPath = path.join(
      process.cwd(),
      'performance-reports',
      `ci-resources-${Date.now()}.json`
    );
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          environment: this.metrics[0]?.environment,
          summary: {
            avgCpuUsage,
            avgMemoryUsage,
            maxHeapUsed,
            maxRssUsed,
            metricsCount: this.metrics.length,
          },
          metrics: this.metrics,
        },
        null,
        2
      )
    );

    console.log(`\n📄 Full report saved to: ${reportPath}`);
  }
}

// Export for use in tests
export { CIResourceMonitor, ResourceMetrics, ResourceLimits };

// Main execution
if (require.main === module) {
  const monitor = new CIResourceMonitor();

  // Print initial report
  monitor.printResourceReport();

  // Start monitoring if requested
  const args = process.argv.slice(2);
  if (args.includes('--monitor')) {
    const duration = parseInt(args[args.indexOf('--monitor') + 1] || '60') * 1000;

    monitor.startMonitoring(5000); // Check every 5 seconds

    // Stop after specified duration
    setTimeout(() => {
      monitor.stopMonitoring();
      monitor.generateReport();
      process.exit(0);
    }, duration);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      monitor.stopMonitoring();
      monitor.generateReport();
      process.exit(0);
    });
  }
}

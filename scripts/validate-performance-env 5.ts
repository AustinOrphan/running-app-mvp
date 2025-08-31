#!/usr/bin/env tsx

/**
 * Performance Environment Validator
 * Ensures the environment is properly configured for accurate performance benchmarks
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import os from 'os';

interface ValidationResult {
  check: string;
  passed: boolean;
  message: string;
  warning?: boolean;
}

class PerformanceEnvironmentValidator {
  private results: ValidationResult[] = [];
  private hasErrors = false;
  private hasWarnings = false;

  async validate(): Promise<boolean> {
    console.log('🔍 Validating Performance Environment...\n');

    // Run all validation checks
    this.checkNodeVersion();
    this.checkMemory();
    this.checkCPU();
    this.checkDiskSpace();
    this.checkDependencies();
    this.checkBenchmarkDirectories();
    this.checkGitStatus();
    this.checkRunningProcesses();
    this.checkEnvironmentVariables();

    // Print results
    this.printResults();

    return !this.hasErrors;
  }

  private checkNodeVersion(): void {
    try {
      const nodeVersion = process.version;
      const major = parseInt(nodeVersion.split('.')[0].substring(1));

      if (major < 18) {
        this.addResult({
          check: 'Node.js Version',
          passed: false,
          message: `Node.js ${nodeVersion} is too old. Requires Node.js 18 or higher.`,
        });
      } else {
        this.addResult({
          check: 'Node.js Version',
          passed: true,
          message: `Node.js ${nodeVersion} ✓`,
        });
      }
    } catch (error) {
      this.addResult({
        check: 'Node.js Version',
        passed: false,
        message: 'Could not determine Node.js version',
      });
    }
  }

  private checkMemory(): void {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemoryPercent = ((totalMemory - freeMemory) / totalMemory) * 100;

    if (freeMemory < 2 * 1024 * 1024 * 1024) {
      // Less than 2GB free
      this.addResult({
        check: 'Available Memory',
        passed: false,
        message: `Only ${this.formatBytes(freeMemory)} free memory available. Need at least 2GB.`,
      });
    } else if (usedMemoryPercent > 80) {
      this.addResult({
        check: 'Available Memory',
        passed: true,
        message: `${this.formatBytes(freeMemory)} free (${(100 - usedMemoryPercent).toFixed(1)}% available)`,
        warning: true,
      });
    } else {
      this.addResult({
        check: 'Available Memory',
        passed: true,
        message: `${this.formatBytes(freeMemory)} free (${(100 - usedMemoryPercent).toFixed(1)}% available) ✓`,
      });
    }
  }

  private checkCPU(): void {
    const cpus = os.cpus();
    const loadAvg = os.loadavg()[0]; // 1-minute load average
    const cpuCount = cpus.length;

    if (loadAvg > cpuCount * 0.8) {
      this.addResult({
        check: 'CPU Load',
        passed: true,
        message: `High CPU load detected (${loadAvg.toFixed(2)}). Results may be inconsistent.`,
        warning: true,
      });
    } else {
      this.addResult({
        check: 'CPU Load',
        passed: true,
        message: `CPU load: ${loadAvg.toFixed(2)} (${cpuCount} cores) ✓`,
      });
    }
  }

  private checkDiskSpace(): void {
    try {
      // Check available disk space
      const diskInfo = execSync('df -k . | tail -1', { encoding: 'utf8' });
      const parts = diskInfo.trim().split(/\s+/);
      const availableKB = parseInt(parts[3]);
      const availableGB = availableKB / 1024 / 1024;

      if (availableGB < 1) {
        this.addResult({
          check: 'Disk Space',
          passed: false,
          message: `Only ${availableGB.toFixed(2)}GB free disk space. Need at least 1GB.`,
        });
      } else if (availableGB < 5) {
        this.addResult({
          check: 'Disk Space',
          passed: true,
          message: `${availableGB.toFixed(2)}GB free disk space`,
          warning: true,
        });
      } else {
        this.addResult({
          check: 'Disk Space',
          passed: true,
          message: `${availableGB.toFixed(2)}GB free disk space ✓`,
        });
      }
    } catch (error) {
      this.addResult({
        check: 'Disk Space',
        passed: true,
        message: 'Could not determine disk space (non-critical)',
        warning: true,
      });
    }
  }

  private checkDependencies(): void {
    try {
      // Check if node_modules exists
      if (!existsSync('node_modules')) {
        this.addResult({
          check: 'Dependencies',
          passed: false,
          message: 'node_modules not found. Run "npm install" first.',
        });
        return;
      }

      // Verify key dependencies
      const requiredPackages = ['tsx', 'vitest', 'playwright', '@prisma/client'];
      const missingPackages: string[] = [];

      for (const pkg of requiredPackages) {
        if (!existsSync(`node_modules/${pkg}`)) {
          missingPackages.push(pkg);
        }
      }

      if (missingPackages.length > 0) {
        this.addResult({
          check: 'Dependencies',
          passed: false,
          message: `Missing required packages: ${missingPackages.join(', ')}`,
        });
      } else {
        this.addResult({
          check: 'Dependencies',
          passed: true,
          message: 'All required dependencies installed ✓',
        });
      }
    } catch (error) {
      this.addResult({
        check: 'Dependencies',
        passed: false,
        message: 'Error checking dependencies',
      });
    }
  }

  private checkBenchmarkDirectories(): void {
    const directories = ['benchmark-results', 'test-results', 'performance-dashboard'];

    for (const dir of directories) {
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true });
        } catch (error) {
          this.addResult({
            check: 'Benchmark Directories',
            passed: false,
            message: `Could not create directory: ${dir}`,
          });
          return;
        }
      }
    }

    this.addResult({
      check: 'Benchmark Directories',
      passed: true,
      message: 'All required directories exist ✓',
    });
  }

  private checkGitStatus(): void {
    try {
      // Check if in a git repository
      execSync('git rev-parse --git-dir', { stdio: 'pipe' });

      // Check for uncommitted changes
      const status = execSync('git status --porcelain', { encoding: 'utf8' });

      if (status.trim().length > 0) {
        this.addResult({
          check: 'Git Status',
          passed: true,
          message: 'Uncommitted changes detected. Results may not be reproducible.',
          warning: true,
        });
      } else {
        this.addResult({
          check: 'Git Status',
          passed: true,
          message: 'Clean git working directory ✓',
        });
      }
    } catch (error) {
      this.addResult({
        check: 'Git Status',
        passed: true,
        message: 'Not in a git repository (non-critical)',
        warning: true,
      });
    }
  }

  private checkRunningProcesses(): void {
    try {
      // Check for resource-intensive processes
      const processes = execSync('ps aux | sort -nrk 3,3 | head -5', { encoding: 'utf8' });
      const lines = processes.trim().split('\n');
      const highCPUProcesses = lines
        .slice(1) // Skip header
        .map(line => {
          const parts = line.split(/\s+/);
          return {
            cpu: parseFloat(parts[2]),
            command: parts.slice(10).join(' '),
          };
        })
        .filter(p => p.cpu > 50);

      if (highCPUProcesses.length > 0) {
        this.addResult({
          check: 'Running Processes',
          passed: true,
          message: `High CPU processes detected. Consider closing them for accurate results.`,
          warning: true,
        });
      } else {
        this.addResult({
          check: 'Running Processes',
          passed: true,
          message: 'No high CPU processes detected ✓',
        });
      }
    } catch (error) {
      // Non-critical, skip on non-Unix systems
      this.addResult({
        check: 'Running Processes',
        passed: true,
        message: 'Process check not available on this system',
        warning: true,
      });
    }
  }

  private checkEnvironmentVariables(): void {
    const requiredEnvVars = ['DATABASE_URL'];
    const missingEnvVars: string[] = [];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        missingEnvVars.push(envVar);
      }
    }

    // Check for CI environment
    if (process.env.CI) {
      this.addResult({
        check: 'Environment',
        passed: true,
        message: 'Running in CI environment ✓',
      });
    } else if (missingEnvVars.length > 0) {
      this.addResult({
        check: 'Environment Variables',
        passed: true,
        message: `Missing optional env vars: ${missingEnvVars.join(', ')}`,
        warning: true,
      });
    } else {
      this.addResult({
        check: 'Environment Variables',
        passed: true,
        message: 'All environment variables configured ✓',
      });
    }
  }

  private addResult(result: ValidationResult): void {
    this.results.push(result);
    if (!result.passed && !result.warning) {
      this.hasErrors = true;
    }
    if (result.warning) {
      this.hasWarnings = true;
    }
  }

  private printResults(): void {
    console.log('Validation Results:');
    console.log('==================\n');

    for (const result of this.results) {
      const icon = !result.passed ? '❌' : result.warning ? '⚠️ ' : '✅';
      const color = !result.passed ? '\x1b[31m' : result.warning ? '\x1b[33m' : '\x1b[32m';
      const reset = '\x1b[0m';

      console.log(`${icon} ${result.check}: ${color}${result.message}${reset}`);
    }

    console.log('\nSummary:');
    console.log('--------');

    if (this.hasErrors) {
      console.log('\x1b[31m❌ Validation failed! Please fix the errors above.\x1b[0m');
    } else if (this.hasWarnings) {
      console.log('\x1b[33m⚠️  Validation passed with warnings. Results may vary.\x1b[0m');
    } else {
      console.log('\x1b[32m✅ All validation checks passed!\x1b[0m');
    }

    // Provide recommendations
    if (this.hasWarnings || this.hasErrors) {
      console.log('\nRecommendations:');
      console.log('---------------');

      if (this.hasErrors) {
        console.log('• Fix all errors before running performance benchmarks');
      }

      if (this.hasWarnings) {
        console.log('• Close unnecessary applications to free up resources');
        console.log('• Ensure consistent environment for reproducible results');
        console.log('• Consider running benchmarks multiple times and averaging results');
      }
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
  }
}

// Main execution
async function main() {
  const validator = new PerformanceEnvironmentValidator();
  const isValid = await validator.validate();

  process.exit(isValid ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  });
}

export { PerformanceEnvironmentValidator };

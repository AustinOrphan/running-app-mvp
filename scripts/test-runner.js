#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Test suite configurations
const testSuites = {
  unit: {
    name: 'Unit Tests',
    command: 'npm',
    args: ['run', 'test:coverage'],
    description: 'Vitest unit tests with coverage',
    coverageDir: 'coverage',
  },
  integration: {
    name: 'Integration Tests',
    command: 'npm',
    args: ['run', 'test:coverage:integration'],
    description: 'Jest integration tests with coverage',
    coverageDir: 'coverage-integration',
  },
  e2e: {
    name: 'E2E Tests',
    command: 'npm',
    args: ['run', 'test:e2e'],
    description: 'Playwright end-to-end tests',
    reportDir: 'playwright-report',
  },
  a11y: {
    name: 'Accessibility Tests',
    command: 'npm',
    args: ['run', 'test:a11y:all'],
    description: 'Accessibility tests (unit + e2e)',
  },
  visual: {
    name: 'Visual Regression Tests',
    command: 'npm',
    args: ['run', 'test:visual'],
    description: 'Visual regression tests with Playwright',
  },
  performance: {
    name: 'Performance Tests',
    command: 'npm',
    args: ['run', 'test:performance'],
    description: 'Performance benchmarks',
  },
  memory: {
    name: 'Memory Tests',
    command: 'npm',
    args: ['run', 'test:memory'],
    description: 'Memory usage and leak detection',
  },
};

// Command line arguments parsing
const args = process.argv.slice(2);
const options = {
  suite: 'all',
  parallel: false,
  reporter: 'console',
  outputDir: join(projectRoot, 'test-reports'),
  ci: process.env.CI === 'true',
  verbose: false,
  bail: false,
  watch: false,
  threshold: {
    coverage: 70,
    performance: 1000, // ms
    memory: 100, // MB
  },
};

// Parse command line arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '--suite':
    case '-s':
      options.suite = args[++i];
      break;
    case '--parallel':
    case '-p':
      options.parallel = true;
      break;
    case '--reporter':
    case '-r':
      options.reporter = args[++i];
      break;
    case '--output':
    case '-o':
      options.outputDir = args[++i];
      break;
    case '--ci':
      options.ci = true;
      break;
    case '--verbose':
    case '-v':
      options.verbose = true;
      break;
    case '--bail':
    case '-b':
      options.bail = true;
      break;
    case '--watch':
    case '-w':
      options.watch = true;
      break;
    case '--help':
    case '-h':
      printHelp();
      process.exit(0);
  }
}

// Test runner state
const testResults = {
  suites: {},
  startTime: null,
  endTime: null,
  totalDuration: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  coverage: {},
  errors: [],
  warnings: [],
};

// Output array for structured logging
const output = [];

// Helper functions
function printHelp() {
  const helpText = `
${colors.bright}Running App MVP - Comprehensive Test Runner${colors.reset}

${colors.cyan}Usage:${colors.reset}
  node scripts/test-runner.js [options]

${colors.cyan}Options:${colors.reset}
  ${colors.yellow}--suite, -s <name>${colors.reset}     Test suite to run (default: all)
                        Options: unit, integration, e2e, a11y, visual, performance, memory, all
  ${colors.yellow}--parallel, -p${colors.reset}        Run tests in parallel where possible
  ${colors.yellow}--reporter, -r <type>${colors.reset}  Reporter type: console, json, html (default: console)
  ${colors.yellow}--output, -o <dir>${colors.reset}     Output directory for reports (default: test-reports)
  ${colors.yellow}--ci${colors.reset}                  Run in CI mode (stricter thresholds, no interactive output)
  ${colors.yellow}--verbose, -v${colors.reset}         Verbose output
  ${colors.yellow}--bail, -b${colors.reset}            Stop on first test failure
  ${colors.yellow}--watch, -w${colors.reset}           Run in watch mode (where supported)
  ${colors.yellow}--help, -h${colors.reset}            Show this help message

${colors.cyan}Examples:${colors.reset}
  # Run all tests
  node scripts/test-runner.js

  # Run unit tests only
  node scripts/test-runner.js --suite unit

  # Run tests in parallel with JSON output
  node scripts/test-runner.js --parallel --reporter json --output ./reports

  # CI mode with strict thresholds
  node scripts/test-runner.js --ci --bail
`;
  process.stdout.write(helpText);
}

function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix =
    {
      info: `${colors.blue}[INFO]${colors.reset}`,
      success: `${colors.green}[SUCCESS]${colors.reset}`,
      warning: `${colors.yellow}[WARNING]${colors.reset}`,
      error: `${colors.red}[ERROR]${colors.reset}`,
    }[level] || '[LOG]';

  const logEntry = {
    timestamp,
    level,
    message,
  };

  output.push(logEntry);

  if (!options.ci || options.verbose) {
    process.stdout.write(`${colors.dim}${timestamp}${colors.reset} ${prefix} ${message}\n`);
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = performance.now();
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: options.verbose ? 'inherit' : 'pipe',
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';

    if (!options.verbose) {
      child.stdout?.on('data', data => {
        stdout += data.toString();
        if (options.stream) process.stdout.write(data);
      });

      child.stderr?.on('data', data => {
        stderr += data.toString();
        if (options.stream) process.stderr.write(data);
      });
    }

    child.on('close', code => {
      const duration = performance.now() - startTime;
      resolve({
        code,
        stdout,
        stderr,
        duration,
        success: code === 0,
      });
    });

    child.on('error', error => {
      reject(error);
    });
  });
}

async function ensureDirectories() {
  const dirs = [
    options.outputDir,
    join(options.outputDir, 'coverage'),
    join(options.outputDir, 'reports'),
    join(options.outputDir, 'artifacts'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

async function checkEnvironment() {
  log('Checking test environment...', 'info');

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
  if (majorVersion < 20) {
    log(`Node.js version ${nodeVersion} detected. Version 20+ recommended.`, 'warning');
    testResults.warnings.push(`Node.js version ${nodeVersion} (20+ recommended)`);
  }

  // Check if database exists
  const dbPath = join(projectRoot, 'prisma', 'test.db');
  if (!existsSync(dbPath)) {
    log('Test database not found. Setting up...', 'warning');
    const setupResult = await runCommand('npm', ['run', 'test:setup:db']);
    if (!setupResult.success) {
      log('Failed to setup test database', 'error');
      testResults.errors.push('Test database setup failed');
      return false;
    }
  }

  // Validate test environment
  const validateResult = await runCommand('npm', ['run', 'validate-test-env']);
  if (!validateResult.success) {
    log('Test environment validation failed', 'error');
    testResults.errors.push('Environment validation failed');
    return false;
  }

  log('Environment check passed', 'success');
  return true;
}

async function runTestSuite(suiteName, suiteConfig) {
  const startTime = performance.now();
  log(`Running ${suiteConfig.name}...`, 'info');

  testResults.suites[suiteName] = {
    name: suiteConfig.name,
    status: 'running',
    startTime: new Date().toISOString(),
    duration: 0,
    output: '',
    error: null,
  };

  try {
    const result = await runCommand(suiteConfig.command, suiteConfig.args, {
      verbose: options.verbose,
      stream: !options.parallel,
    });

    const duration = performance.now() - startTime;
    testResults.suites[suiteName].duration = duration;
    testResults.suites[suiteName].endTime = new Date().toISOString();
    testResults.suites[suiteName].output = result.stdout;

    if (result.success) {
      testResults.suites[suiteName].status = 'passed';
      testResults.passed++;
      log(`${suiteConfig.name} completed in ${formatDuration(duration)}`, 'success');
    } else {
      testResults.suites[suiteName].status = 'failed';
      testResults.suites[suiteName].error = result.stderr || result.stdout;
      testResults.failed++;
      log(`${suiteConfig.name} failed after ${formatDuration(duration)}`, 'error');

      if (options.bail) {
        throw new Error(`Test suite ${suiteName} failed. Bailing out.`);
      }
    }

    // Extract coverage data if available
    if (suiteConfig.coverageDir) {
      await extractCoverageData(suiteName, suiteConfig.coverageDir);
    }
  } catch (error) {
    testResults.suites[suiteName].status = 'error';
    testResults.suites[suiteName].error = error.message;
    testResults.failed++;
    log(`${suiteConfig.name} encountered an error: ${error.message}`, 'error');

    if (options.bail) {
      throw error;
    }
  }
}

async function extractCoverageData(suiteName, coverageDir) {
  const coveragePath = join(projectRoot, coverageDir, 'coverage-summary.json');

  if (existsSync(coveragePath)) {
    try {
      const coverageData = JSON.parse(readFileSync(coveragePath, 'utf8'));
      testResults.coverage[suiteName] = coverageData.total;

      // Check coverage thresholds
      const metrics = ['lines', 'statements', 'functions', 'branches'];
      for (const metric of metrics) {
        const percentage = coverageData.total[metric].pct;
        if (percentage < options.threshold.coverage) {
          testResults.warnings.push(
            `${suiteName} ${metric} coverage (${percentage}%) below threshold (${options.threshold.coverage}%)`
          );
        }
      }
    } catch (error) {
      log(`Failed to extract coverage data for ${suiteName}: ${error.message}`, 'warning');
    }
  }
}

async function runAllTests() {
  testResults.startTime = new Date().toISOString();
  const startTime = performance.now();

  // Determine which suites to run
  let suitesToRun = [];
  if (options.suite === 'all') {
    suitesToRun = Object.entries(testSuites);
  } else if (testSuites[options.suite]) {
    suitesToRun = [[options.suite, testSuites[options.suite]]];
  } else {
    log(`Unknown test suite: ${options.suite}`, 'error');
    process.exit(1);
  }

  // Run tests
  if (options.parallel && suitesToRun.length > 1) {
    log('Running tests in parallel mode', 'info');
    const promises = suitesToRun.map(([name, config]) => runTestSuite(name, config));
    await Promise.allSettled(promises);
  } else {
    for (const [name, config] of suitesToRun) {
      await runTestSuite(name, config);
    }
  }

  testResults.endTime = new Date().toISOString();
  testResults.totalDuration = performance.now() - startTime;
}

async function generateReports() {
  log('Generating test reports...', 'info');

  // Console report (always generated)
  generateConsoleReport();

  // JSON report
  if (options.reporter === 'json' || options.reporter === 'all') {
    const jsonPath = join(options.outputDir, 'test-results.json');
    writeFileSync(jsonPath, JSON.stringify(testResults, null, 2));
    log(`JSON report saved to: ${jsonPath}`, 'success');
  }

  // HTML report
  if (options.reporter === 'html' || options.reporter === 'all') {
    await generateHTMLReport();
  }

  // Coverage report
  if (Object.keys(testResults.coverage).length > 0) {
    await generateCoverageReport();
  }
}

function generateConsoleReport() {
  const reportLines = [];
  reportLines.push('\n' + '='.repeat(80));
  reportLines.push(`${colors.bright}TEST EXECUTION SUMMARY${colors.reset}`);
  reportLines.push('='.repeat(80));

  // Overall statistics
  reportLines.push(`\n${colors.cyan}Overall Results:${colors.reset}`);
  reportLines.push(`  Total Duration: ${formatDuration(testResults.totalDuration)}`);
  reportLines.push(`  Started: ${testResults.startTime}`);
  reportLines.push(`  Completed: ${testResults.endTime}`);
  reportLines.push(`  ${colors.green}Passed: ${testResults.passed}${colors.reset}`);
  reportLines.push(`  ${colors.red}Failed: ${testResults.failed}${colors.reset}`);

  // Suite details
  reportLines.push(`\n${colors.cyan}Test Suites:${colors.reset}`);
  for (const [name, suite] of Object.entries(testResults.suites)) {
    const icon = suite.status === 'passed' ? '✓' : '✗';
    const color = suite.status === 'passed' ? colors.green : colors.red;
    reportLines.push(
      `  ${color}${icon} ${suite.name}${colors.reset} - ${formatDuration(suite.duration)}`
    );
  }

  // Coverage summary
  if (Object.keys(testResults.coverage).length > 0) {
    reportLines.push(`\n${colors.cyan}Coverage Summary:${colors.reset}`);
    for (const [suite, coverage] of Object.entries(testResults.coverage)) {
      reportLines.push(`  ${suite}:`);
      reportLines.push(`    Lines: ${coverage.lines.pct}%`);
      reportLines.push(`    Statements: ${coverage.statements.pct}%`);
      reportLines.push(`    Functions: ${coverage.functions.pct}%`);
      reportLines.push(`    Branches: ${coverage.branches.pct}%`);
    }
  }

  // Warnings
  if (testResults.warnings.length > 0) {
    reportLines.push(`\n${colors.yellow}Warnings:${colors.reset}`);
    testResults.warnings.forEach(warning => {
      reportLines.push(`  - ${warning}`);
    });
  }

  // Errors
  if (testResults.errors.length > 0) {
    reportLines.push(`\n${colors.red}Errors:${colors.reset}`);
    testResults.errors.forEach(error => {
      reportLines.push(`  - ${error}`);
    });
  }

  reportLines.push('\n' + '='.repeat(80));

  // Exit code
  const exitCode = testResults.failed > 0 ? 1 : 0;
  if (exitCode === 0) {
    reportLines.push(`${colors.green}${colors.bright}All tests passed!${colors.reset}`);
  } else {
    reportLines.push(`${colors.red}${colors.bright}Tests failed!${colors.reset}`);
  }

  // Write report to stdout
  process.stdout.write(reportLines.join('\n') + '\n');

  return exitCode;
}

async function generateHTMLReport() {
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Results - Running App MVP</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: #fff;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        h1 {
            color: #2c3e50;
            margin-bottom: 10px;
        }
        .metadata {
            color: #666;
            font-size: 14px;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .card {
            background: #fff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .card h3 {
            margin-bottom: 15px;
            color: #34495e;
        }
        .metric {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
        }
        .metric-value {
            font-weight: bold;
        }
        .passed { color: #27ae60; }
        .failed { color: #e74c3c; }
        .warning { color: #f39c12; }
        .suite-results {
            background: #fff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        .suite-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid #eee;
        }
        .suite-status {
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }
        .icon {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
        }
        .icon.passed { background: #27ae60; }
        .icon.failed { background: #e74c3c; }
        .coverage-bar {
            background: #ecf0f1;
            height: 20px;
            border-radius: 10px;
            overflow: hidden;
            margin: 5px 0;
        }
        .coverage-fill {
            height: 100%;
            background: #3498db;
            transition: width 0.3s ease;
        }
        .coverage-low { background: #e74c3c; }
        .coverage-medium { background: #f39c12; }
        .coverage-high { background: #27ae60; }
        pre {
            background: #f8f8f8;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            font-size: 12px;
            margin-top: 10px;
        }
        .warnings, .errors {
            margin-top: 30px;
        }
        .message {
            background: #fff;
            padding: 15px;
            border-left: 4px solid;
            margin-bottom: 10px;
            border-radius: 4px;
        }
        .message.warning {
            border-color: #f39c12;
            background: #fef5e7;
        }
        .message.error {
            border-color: #e74c3c;
            background: #fadbd8;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Test Execution Report</h1>
            <div class="metadata">
                <p>Generated: ${new Date().toLocaleString()}</p>
                <p>Duration: ${formatDuration(testResults.totalDuration)}</p>
                <p>Environment: ${options.ci ? 'CI' : 'Local'}</p>
            </div>
        </div>

        <div class="summary">
            <div class="card">
                <h3>Test Results</h3>
                <div class="metric">
                    <span>Total Suites:</span>
                    <span class="metric-value">${Object.keys(testResults.suites).length}</span>
                </div>
                <div class="metric">
                    <span>Passed:</span>
                    <span class="metric-value passed">${testResults.passed}</span>
                </div>
                <div class="metric">
                    <span>Failed:</span>
                    <span class="metric-value failed">${testResults.failed}</span>
                </div>
            </div>

            ${
              Object.keys(testResults.coverage).length > 0
                ? `
            <div class="card">
                <h3>Coverage Overview</h3>
                ${Object.entries(testResults.coverage)
                  .map(
                    ([suite, coverage]) => `
                    <div class="metric">
                        <span>${suite}:</span>
                        <span class="metric-value">${coverage.lines.pct}%</span>
                    </div>
                `
                  )
                  .join('')}
            </div>
            `
                : ''
            }
        </div>

        <h2>Suite Details</h2>
        ${Object.entries(testResults.suites)
          .map(
            ([name, suite]) => `
            <div class="suite-results">
                <div class="suite-header">
                    <div>
                        <span class="suite-status">
                            <span class="icon ${suite.status}">
                                ${suite.status === 'passed' ? '✓' : '✗'}
                            </span>
                            <h3>${suite.name}</h3>
                        </span>
                    </div>
                    <div>
                        <span>Duration: ${formatDuration(suite.duration)}</span>
                    </div>
                </div>
                
                ${
                  testResults.coverage[name]
                    ? `
                    <div class="coverage">
                        <h4>Coverage</h4>
                        ${['lines', 'statements', 'functions', 'branches']
                          .map(metric => {
                            const pct = testResults.coverage[name][metric].pct;
                            const level = pct >= 80 ? 'high' : pct >= 60 ? 'medium' : 'low';
                            return `
                                <div>
                                    <div class="metric">
                                        <span>${metric}:</span>
                                        <span>${pct}%</span>
                                    </div>
                                    <div class="coverage-bar">
                                        <div class="coverage-fill coverage-${level}" style="width: ${pct}%"></div>
                                    </div>
                                </div>
                            `;
                          })
                          .join('')}
                    </div>
                `
                    : ''
                }
                
                ${
                  suite.error
                    ? `
                    <div class="error-output">
                        <h4>Error Output</h4>
                        <pre>${suite.error}</pre>
                    </div>
                `
                    : ''
                }
            </div>
        `
          )
          .join('')}

        ${
          testResults.warnings.length > 0
            ? `
            <div class="warnings">
                <h2>Warnings</h2>
                ${testResults.warnings
                  .map(
                    warning => `
                    <div class="message warning">${warning}</div>
                `
                  )
                  .join('')}
            </div>
        `
            : ''
        }

        ${
          testResults.errors.length > 0
            ? `
            <div class="errors">
                <h2>Errors</h2>
                ${testResults.errors
                  .map(
                    error => `
                    <div class="message error">${error}</div>
                `
                  )
                  .join('')}
            </div>
        `
            : ''
        }
    </div>
</body>
</html>
  `;

  const htmlPath = join(options.outputDir, 'test-report.html');
  writeFileSync(htmlPath, htmlContent);
  log(`HTML report saved to: ${htmlPath}`, 'success');
}

async function generateCoverageReport() {
  // Merge coverage data from different test suites
  const mergedCoverage = {};

  for (const [suite, coverage] of Object.entries(testResults.coverage)) {
    for (const metric of ['lines', 'statements', 'functions', 'branches']) {
      if (!mergedCoverage[metric]) {
        mergedCoverage[metric] = {
          total: 0,
          covered: 0,
          pct: 0,
        };
      }
      mergedCoverage[metric].total += coverage[metric].total;
      mergedCoverage[metric].covered += coverage[metric].covered;
    }
  }

  // Calculate percentages
  for (const metric of Object.keys(mergedCoverage)) {
    const data = mergedCoverage[metric];
    data.pct = data.total > 0 ? ((data.covered / data.total) * 100).toFixed(2) : 0;
  }

  // Generate coverage summary
  const coverageSummary = {
    total: mergedCoverage,
    suites: testResults.coverage,
    timestamp: new Date().toISOString(),
    thresholds: {
      lines: options.threshold.coverage,
      statements: options.threshold.coverage,
      functions: options.threshold.coverage,
      branches: options.threshold.coverage,
    },
  };

  const coveragePath = join(options.outputDir, 'coverage-summary.json');
  writeFileSync(coveragePath, JSON.stringify(coverageSummary, null, 2));
  log(`Coverage summary saved to: ${coveragePath}`, 'success');

  // Generate badges if in CI mode
  if (options.ci) {
    await generateCoverageBadges(mergedCoverage);
  }
}

async function generateCoverageBadges(coverage) {
  try {
    await runCommand('npm', ['run', 'test:coverage:badges']);
    log('Coverage badges generated', 'success');
  } catch (error) {
    log(`Failed to generate coverage badges: ${error.message}`, 'warning');
  }
}

// Main execution
async function main() {
  try {
    process.stdout.write(
      `${colors.bright}${colors.cyan}Running App MVP - Test Runner${colors.reset}\n`
    );
    process.stdout.write(`${colors.dim}Starting test execution...${colors.reset}\n\n`);

    // Ensure output directories exist
    await ensureDirectories();

    // Check environment
    if (!(await checkEnvironment())) {
      log('Environment check failed. Aborting.', 'error');
      process.exit(1);
    }

    // Run tests
    await runAllTests();

    // Generate reports
    await generateReports();

    // Determine exit code
    const exitCode = testResults.failed > 0 ? 1 : 0;

    // CI-specific checks
    if (options.ci) {
      // Check coverage thresholds
      for (const [suite, coverage] of Object.entries(testResults.coverage)) {
        for (const metric of ['lines', 'statements', 'functions', 'branches']) {
          if (coverage[metric].pct < options.threshold.coverage) {
            log(`Coverage threshold not met for ${suite} ${metric}`, 'error');
            process.exit(1);
          }
        }
      }
    }

    process.exit(exitCode);
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
    process.stderr.write(error.stack + '\n');
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${__filename}`) {
  main();
}

export { main, runAllTests, generateReports };

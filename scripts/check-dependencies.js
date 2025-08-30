#!/usr/bin/env node

/**
 * Dependency Checker Script
 *
 * This script checks for outdated dependencies and security vulnerabilities.
 * It provides a comprehensive overview of dependency health.
 *
 * Usage:
 *   node scripts/check-dependencies.js [options]
 *
 * Options:
 *   --security-only    Only check for security vulnerabilities
 *   --outdated-only    Only check for outdated packages
 *   --json            Output in JSON format
 *   --fix             Automatically fix security vulnerabilities
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  checkOutdated: true,
  checkSecurity: true,
  autoFix: false,
  jsonOutput: false,
  verbose: false,
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);

  for (const arg of args) {
    switch (arg) {
      case '--security-only':
        CONFIG.checkOutdated = false;
        break;
      case '--outdated-only':
        CONFIG.checkSecurity = false;
        break;
      case '--json':
        CONFIG.jsonOutput = true;
        break;
      case '--fix':
        CONFIG.autoFix = true;
        break;
      case '--verbose':
        CONFIG.verbose = true;
        break;
      case '--help':
        showHelp();
        process.exit(0);
      default:
        if (arg.startsWith('--')) {
          console.warn(`Unknown option: ${arg}`);
        }
    }
  }
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
Dependency Checker Script

Usage: node scripts/check-dependencies.js [options]

Options:
  --security-only    Only check for security vulnerabilities
  --outdated-only    Only check for outdated packages  
  --json            Output results in JSON format
  --fix             Automatically fix security vulnerabilities
  --verbose         Show detailed output
  --help            Show this help message

Examples:
  node scripts/check-dependencies.js                    # Full check
  node scripts/check-dependencies.js --security-only    # Security audit only
  node scripts/check-dependencies.js --fix              # Check and fix
  node scripts/check-dependencies.js --json             # JSON output
`);
}

/**
 * Execute command and return result
 */
function execCommand(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options,
    });
    return { success: true, output: result };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || error.message,
      error: error.stderr || error.message,
      code: error.status,
    };
  }
}

/**
 * Check for outdated dependencies
 */
async function checkOutdated() {
  if (!CONFIG.checkOutdated) return null;

  console.log('📦 Checking for outdated dependencies...\n');

  const result = execCommand('npm outdated --json', { silent: true });

  if (result.success && result.output) {
    try {
      const outdated = JSON.parse(result.output);
      const packages = Object.keys(outdated);

      if (packages.length === 0) {
        console.log('✅ All dependencies are up to date!\n');
        return { outdated: [], count: 0 };
      }

      console.log(`⚠️  Found ${packages.length} outdated dependencies:\n`);

      const outdatedList = [];

      for (const [name, info] of Object.entries(outdated)) {
        const item = {
          name,
          current: info.current,
          wanted: info.wanted,
          latest: info.latest,
          type: info.type || 'dependencies',
        };

        outdatedList.push(item);

        if (!CONFIG.jsonOutput) {
          console.log(`  📍 ${name}:`);
          console.log(`    Current: ${info.current}`);
          console.log(`    Wanted:  ${info.wanted}`);
          console.log(`    Latest:  ${info.latest}`);
          console.log(`    Type:    ${info.type || 'dependencies'}`);
          console.log('');
        }
      }

      return { outdated: outdatedList, count: packages.length };
    } catch (error) {
      console.error('❌ Failed to parse outdated dependencies:', error.message);
      return null;
    }
  } else {
    console.log('✅ All dependencies are up to date!\n');
    return { outdated: [], count: 0 };
  }
}

/**
 * Check for security vulnerabilities
 */
async function checkSecurity() {
  if (!CONFIG.checkSecurity) return null;

  console.log('🔒 Checking for security vulnerabilities...\n');

  const auditResult = execCommand('npm audit --json', { silent: true });

  if (auditResult.success && auditResult.output) {
    try {
      const audit = JSON.parse(auditResult.output);

      if (audit.metadata.vulnerabilities.total === 0) {
        console.log('✅ No security vulnerabilities found!\n');
        return { vulnerabilities: [], total: 0, summary: audit.metadata.vulnerabilities };
      }

      const vulns = audit.metadata.vulnerabilities;
      console.log(`🚨 Found ${vulns.total} security vulnerabilities:`);
      console.log(`  - Critical: ${vulns.critical || 0}`);
      console.log(`  - High:     ${vulns.high || 0}`);
      console.log(`  - Moderate: ${vulns.moderate || 0}`);
      console.log(`  - Low:      ${vulns.low || 0}`);
      console.log('');

      const vulnerabilityList = [];

      if (audit.vulnerabilities) {
        for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
          const item = {
            name,
            severity: vuln.severity,
            title: vuln.title,
            range: vuln.range,
            fixAvailable: vuln.fixAvailable,
          };

          vulnerabilityList.push(item);

          if (!CONFIG.jsonOutput) {
            console.log(`  🔴 ${name} (${vuln.severity}):`);
            console.log(`    Title: ${vuln.title}`);
            console.log(`    Range: ${vuln.range}`);
            console.log(`    Fix:   ${vuln.fixAvailable ? 'Available' : 'Not available'}`);
            console.log('');
          }
        }
      }

      // Auto-fix if requested
      if (CONFIG.autoFix) {
        console.log('🔧 Attempting to fix security vulnerabilities...\n');
        const fixResult = execCommand('npm audit fix');

        if (fixResult.success) {
          console.log('✅ Security vulnerabilities fixed!\n');
        } else {
          console.log(
            '❌ Failed to fix some vulnerabilities. Manual intervention may be required.\n'
          );
        }
      }

      return {
        vulnerabilities: vulnerabilityList,
        total: vulns.total,
        summary: vulns,
      };
    } catch (error) {
      console.error('❌ Failed to parse security audit:', error.message);
      return null;
    }
  } else {
    // npm audit returns non-zero exit code when vulnerabilities are found
    if (auditResult.code === 1 && auditResult.output) {
      try {
        const audit = JSON.parse(auditResult.output);
        const vulns = audit.metadata.vulnerabilities;

        console.log(`🚨 Found ${vulns.total} security vulnerabilities:`);
        console.log(`  - Critical: ${vulns.critical || 0}`);
        console.log(`  - High:     ${vulns.high || 0}`);
        console.log(`  - Moderate: ${vulns.moderate || 0}`);
        console.log(`  - Low:      ${vulns.low || 0}`);
        console.log('');

        return { vulnerabilities: [], total: vulns.total, summary: vulns };
      } catch (error) {
        console.error('❌ Failed to parse security audit:', error.message);
        return null;
      }
    } else {
      console.log('✅ No security vulnerabilities found!\n');
      return { vulnerabilities: [], total: 0, summary: { total: 0 } };
    }
  }
}

/**
 * Check Dependabot configuration
 */
function checkDependabotConfig() {
  const dependabotPath = path.join(process.cwd(), '.github', 'dependabot.yml');

  if (fs.existsSync(dependabotPath)) {
    console.log('✅ Dependabot configuration found');

    try {
      const config = fs.readFileSync(dependabotPath, 'utf8');
      const updates = (config.match(/package-ecosystem:/g) || []).length;
      console.log(`📋 Configured for ${updates} package ecosystems`);

      if (config.includes("interval: 'daily'")) {
        console.log('🚨 Daily security updates enabled');
      }

      if (config.includes("interval: 'weekly'")) {
        console.log('📅 Weekly dependency updates enabled');
      }

      return { configured: true, ecosystems: updates };
    } catch (error) {
      console.log('⚠️  Dependabot config exists but could not be parsed');
      return { configured: true, ecosystems: 0 };
    }
  } else {
    console.log('❌ Dependabot configuration not found');
    console.log('💡 Run: npm run deps:setup to configure Dependabot');
    return { configured: false, ecosystems: 0 };
  }
}

/**
 * Generate recommendations
 */
function generateRecommendations(outdatedResult, securityResult) {
  const recommendations = [];

  if (securityResult && securityResult.total > 0) {
    if (securityResult.summary.critical > 0 || securityResult.summary.high > 0) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Fix critical and high severity vulnerabilities immediately',
        command: 'npm audit fix --force',
      });
    }

    if (securityResult.summary.moderate > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Review and fix moderate severity vulnerabilities',
        command: 'npm audit fix',
      });
    }
  }

  if (outdatedResult && outdatedResult.count > 0) {
    const majorUpdates = outdatedResult.outdated.filter(
      pkg => pkg.current.split('.')[0] !== pkg.latest.split('.')[0]
    );

    if (majorUpdates.length > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        action: `Review ${majorUpdates.length} major version updates manually`,
        command: 'npm update --dry-run',
      });
    }

    const minorUpdates = outdatedResult.outdated.filter(
      pkg =>
        pkg.current.split('.')[0] === pkg.latest.split('.')[0] &&
        pkg.current.split('.')[1] !== pkg.latest.split('.')[1]
    );

    if (minorUpdates.length > 0) {
      recommendations.push({
        priority: 'LOW',
        action: `Consider updating ${minorUpdates.length} minor versions`,
        command: 'npm update',
      });
    }
  }

  return recommendations;
}

/**
 * Main execution
 */
async function main() {
  console.log('🔍 Dependency Health Check\n');
  console.log('='.repeat(50));
  console.log('');

  const results = {
    timestamp: new Date().toISOString(),
    outdated: null,
    security: null,
    dependabot: null,
    recommendations: [],
  };

  try {
    // Check outdated dependencies
    results.outdated = await checkOutdated();

    // Check security vulnerabilities
    results.security = await checkSecurity();

    // Check Dependabot configuration
    console.log('🤖 Checking Dependabot configuration...\n');
    results.dependabot = checkDependabotConfig();
    console.log('');

    // Generate recommendations
    results.recommendations = generateRecommendations(results.outdated, results.security);

    // Output results
    if (CONFIG.jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      // Summary
      console.log('📊 Summary');
      console.log('='.repeat(50));

      if (results.outdated) {
        console.log(`📦 Outdated packages: ${results.outdated.count}`);
      }

      if (results.security) {
        console.log(`🔒 Security vulnerabilities: ${results.security.total}`);
      }

      console.log(`🤖 Dependabot configured: ${results.dependabot.configured ? 'Yes' : 'No'}`);

      // Recommendations
      if (results.recommendations.length > 0) {
        console.log('\n💡 Recommendations');
        console.log('='.repeat(50));

        for (const rec of results.recommendations) {
          console.log(`[${rec.priority}] ${rec.action}`);
          console.log(`  Command: ${rec.command}`);
          console.log('');
        }
      } else {
        console.log('\n✅ No immediate actions required!');
      }
    }

    // Exit with appropriate code
    const hasIssues =
      (results.security && results.security.total > 0) ||
      (results.outdated && results.outdated.count > 10);

    process.exit(hasIssues ? 1 : 0);
  } catch (error) {
    console.error('💥 Unexpected error:', error.message);
    process.exit(1);
  }
}

// Parse arguments and run
parseArgs();

if (require.main === module) {
  main();
}

module.exports = { checkOutdated, checkSecurity, checkDependabotConfig };

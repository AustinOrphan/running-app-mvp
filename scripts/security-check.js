#!/usr/bin/env node

/**
 * Local Security Check Script
 * 
 * This script performs comprehensive security checks locally before CI deployment.
 * It provides quick feedback on security issues and helps developers identify
 * problems early in the development cycle.
 * 
 * Usage:
 *   node scripts/security-check.js [options]
 * 
 * Options:
 *   --quick           Run only fast security checks
 *   --dependencies    Only check dependencies for vulnerabilities
 *   --secrets         Only scan for secrets and credentials
 *   --config          Only review security configuration
 *   --fix             Automatically fix issues where possible
 *   --json            Output results in JSON format
 *   --verbose         Show detailed output
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const CONFIG = {
  runQuick: false,
  dependenciesOnly: false,
  secretsOnly: false,
  configOnly: false,
  autoFix: false,
  jsonOutput: false,
  verbose: false,
  checkSecrets: true,
  checkDependencies: true,
  checkConfig: true,
  checkLinting: true
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  
  for (const arg of args) {
    switch (arg) {
      case '--quick':
        CONFIG.runQuick = true;
        break;
      case '--dependencies':
        CONFIG.dependenciesOnly = true;
        CONFIG.checkSecrets = false;
        CONFIG.checkConfig = false;
        CONFIG.checkLinting = false;
        break;
      case '--secrets':
        CONFIG.secretsOnly = true;
        CONFIG.checkDependencies = false;
        CONFIG.checkConfig = false;
        CONFIG.checkLinting = false;
        break;
      case '--config':
        CONFIG.configOnly = true;
        CONFIG.checkSecrets = false;
        CONFIG.checkDependencies = false;
        CONFIG.checkLinting = false;
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
Local Security Check Script

Usage: node scripts/security-check.js [options]

Options:
  --quick           Run only fast security checks
  --dependencies    Only check dependencies for vulnerabilities
  --secrets         Only scan for secrets and credentials
  --config          Only review security configuration  
  --json            Output results in JSON format
  --fix             Automatically fix issues where possible
  --verbose         Show detailed output
  --help            Show this help message

Examples:
  node scripts/security-check.js                    # Full security check
  node scripts/security-check.js --quick            # Fast checks only
  node scripts/security-check.js --dependencies     # Dependency scan only
  node scripts/security-check.js --secrets          # Secret scan only
  node scripts/security-check.js --fix              # Check and fix issues
  node scripts/security-check.js --json             # JSON output
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
      ...options
    });
    return { success: true, output: result };
  } catch (error) {
    return { 
      success: false, 
      output: error.stdout || error.message,
      error: error.stderr || error.message,
      code: error.status
    };
  }
}

/**
 * Check for secrets and credentials in code
 */
async function checkSecrets() {
  if (!CONFIG.checkSecrets) return null;
  
  console.log('🔍 Scanning for secrets and credentials...\n');
  
  const secretPatterns = [
    {
      name: 'AWS Access Key',
      pattern: /AKIA[0-9A-Z]{16}/g,
      severity: 'HIGH'
    },
    {
      name: 'AWS Secret Key',
      pattern: /[0-9a-zA-Z/+]{40}/g,
      severity: 'HIGH'
    },
    {
      name: 'GitHub Token',
      pattern: /ghp_[0-9a-zA-Z]{36}/g,
      severity: 'HIGH'
    },
    {
      name: 'JWT Token',
      pattern: /ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g,
      severity: 'MEDIUM'
    },
    {
      name: 'API Key',
      pattern: /api[_-]?key[\\s]*[:=][\\s]*['\"][0-9a-zA-Z]{16,}['\"]/gi,
      severity: 'HIGH'
    },
    {
      name: 'Database URL',
      pattern: /(mongodb|mysql|postgres):\/\/[^\s]+/gi,
      severity: 'HIGH'
    },
    {
      name: 'Private Key',
      pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----/g,
      severity: 'CRITICAL'
    },
    {
      name: 'Password in Code',
      pattern: /password[\\s]*[:=][\\s]*['\"][^'\"\\s]{8,}['\"]/gi,
      severity: 'MEDIUM'
    }
  ];
  
  const secretsFound = [];
  const filesToCheck = [
    'src/**/*.js',
    'src/**/*.ts',
    'src/**/*.tsx',
    'server/**/*.js',
    'server/**/*.ts',
    'tests/**/*.js',
    'tests/**/*.ts'
  ];
  
  // Get all files to check
  const files = [];
  for (const pattern of filesToCheck) {
    try {
      const result = execCommand(`find . -path "./node_modules" -prune -o -name "${pattern.replace('**/*', '*')}" -print`, { silent: true });
      if (result.success) {
        files.push(...result.output.split('\n').filter(f => f.trim()));
      }
    } catch (error) {
      // Ignore errors for file patterns that don't match
    }
  }
  
  // Scan each file
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      
      for (const pattern of secretPatterns) {
        const matches = content.match(pattern.pattern);
        if (matches) {
          for (const match of matches) {
            // Skip common test values and placeholders
            if (match.includes('test') || 
                match.includes('example') || 
                match.includes('placeholder') ||
                match.includes('your_') ||
                match.includes('xxx')) {
              continue;
            }
            
            secretsFound.push({
              file: filePath,
              type: pattern.name,
              severity: pattern.severity,
              match: match.substring(0, 50) + (match.length > 50 ? '...' : ''),
              line: findLineNumber(content, match)
            });
          }
        }
      }
    } catch (error) {
      if (CONFIG.verbose) {
        console.warn(`Warning: Could not read file ${filePath}: ${error.message}`);
      }
    }
  }
  
  // Display results
  if (secretsFound.length === 0) {
    console.log('✅ No secrets or credentials found in code!\n');
    return { secrets: [], count: 0 };
  } else {
    console.log(`🚨 Found ${secretsFound.length} potential secrets/credentials:\n`);
    
    for (const secret of secretsFound) {
      if (!CONFIG.jsonOutput) {
        console.log(`  🔴 ${secret.type} (${secret.severity})`);
        console.log(`    File: ${secret.file}:${secret.line}`);
        console.log(`    Match: ${secret.match}`);
        console.log('');
      }
    }
    
    return { secrets: secretsFound, count: secretsFound.length };
  }
}

/**
 * Find line number of a match in content
 */
function findLineNumber(content, match) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(match)) {
      return i + 1;
    }
  }
  return 1;
}

/**
 * Check dependency vulnerabilities
 */
async function checkDependencyVulnerabilities() {
  if (!CONFIG.checkDependencies) return null;
  
  console.log('📦 Checking dependency vulnerabilities...\n');
  
  // Run npm audit
  const auditResult = execCommand('npm audit --json', { silent: true });
  
  if (auditResult.success && auditResult.output) {
    try {
      const audit = JSON.parse(auditResult.output);
      
      if (audit.metadata.vulnerabilities.total === 0) {
        console.log('✅ No dependency vulnerabilities found!\n');
        return { vulnerabilities: [], total: 0, summary: audit.metadata.vulnerabilities };
      }
      
      const vulns = audit.metadata.vulnerabilities;
      console.log(`🚨 Found ${vulns.total} dependency vulnerabilities:`);
      console.log(`  - Critical: ${vulns.critical || 0}`);
      console.log(`  - High:     ${vulns.high || 0}`);
      console.log(`  - Moderate: ${vulns.moderate || 0}`);
      console.log(`  - Low:      ${vulns.low || 0}`);
      console.log('');
      
      // Auto-fix if requested
      if (CONFIG.autoFix) {
        console.log('🔧 Attempting to fix vulnerabilities...\n');
        const fixResult = execCommand('npm audit fix');
        
        if (fixResult.success) {
          console.log('✅ Vulnerabilities fixed!\n');
        } else {
          console.log('❌ Some vulnerabilities could not be fixed automatically.\n');
        }
      }
      
      return { 
        vulnerabilities: [], 
        total: vulns.total, 
        summary: vulns 
      };
      
    } catch (error) {
      console.error('❌ Failed to parse npm audit results:', error.message);
      return null;
    }
  } else {
    // Handle non-zero exit code (vulnerabilities found)
    if (auditResult.code === 1 && auditResult.output) {
      try {
        const audit = JSON.parse(auditResult.output);
        const vulns = audit.metadata.vulnerabilities;
        
        console.log(`🚨 Found ${vulns.total} dependency vulnerabilities:`);
        console.log(`  - Critical: ${vulns.critical || 0}`);
        console.log(`  - High:     ${vulns.high || 0}`);
        console.log(`  - Moderate: ${vulns.moderate || 0}`);
        console.log(`  - Low:      ${vulns.low || 0}`);
        console.log('');
        
        return { vulnerabilities: [], total: vulns.total, summary: vulns };
      } catch (error) {
        console.error('❌ Failed to parse npm audit results:', error.message);
        return null;
      }
    } else {
      console.log('✅ No dependency vulnerabilities found!\n');
      return { vulnerabilities: [], total: 0, summary: { total: 0 } };
    }
  }
}

/**
 * Check security configuration
 */
function checkSecurityConfiguration() {
  if (!CONFIG.checkConfig) return null;
  
  console.log('⚙️ Reviewing security configuration...\n');
  
  const configChecks = [
    {
      file: '.github/dependabot.yml',
      description: 'Automated dependency updates',
      required: true
    },
    {
      file: '.github/workflows/codeql-analysis.yml',
      description: 'CodeQL security scanning',
      required: true
    },
    {
      file: '.github/workflows/security-scanning.yml',
      description: 'Advanced security scanning',
      required: true
    },
    {
      file: '.eslintrc.js',
      description: 'ESLint configuration',
      required: true
    },
    {
      file: '.gitignore',
      description: 'Git ignore file',
      required: true
    },
    {
      file: '.env.example',
      description: 'Environment variable template',
      required: false
    }
  ];
  
  const configResults = {
    passed: [],
    failed: [],
    warnings: []
  };
  
  for (const check of configChecks) {
    if (fs.existsSync(check.file)) {
      configResults.passed.push(check);
      if (!CONFIG.jsonOutput) {
        console.log(`✅ ${check.file}: ${check.description}`);
      }
    } else {
      if (check.required) {
        configResults.failed.push(check);
        if (!CONFIG.jsonOutput) {
          console.log(`❌ ${check.file}: Missing - ${check.description}`);
        }
      } else {
        configResults.warnings.push(check);
        if (!CONFIG.jsonOutput) {
          console.log(`⚠️  ${check.file}: Optional - ${check.description}`);
        }
      }
    }
  }
  
  // Check for .env file in repository
  if (fs.existsSync('.env')) {
    configResults.warnings.push({
      file: '.env',
      description: 'Environment file found in repository',
      issue: 'Should be in .gitignore'
    });
    if (!CONFIG.jsonOutput) {
      console.log('⚠️  .env: Found in repository - ensure it\'s in .gitignore');
    }
  }
  
  // Check package.json for security issues
  if (fs.existsSync('package.json')) {
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      
      // Check scripts for dangerous commands
      if (packageJson.scripts) {
        const dangerousPatterns = [
          { pattern: /sudo/, warning: 'Contains sudo commands' },
          { pattern: /rm -rf/, warning: 'Contains rm -rf commands' },
          { pattern: /curl.*\|.*sh/, warning: 'Contains curl pipe to shell' }
        ];
        
        for (const [scriptName, scriptContent] of Object.entries(packageJson.scripts)) {
          for (const dangerous of dangerousPatterns) {
            if (dangerous.pattern.test(scriptContent)) {
              configResults.warnings.push({
                file: 'package.json',
                description: `Script "${scriptName}": ${dangerous.warning}`,
                issue: scriptContent
              });
              
              if (!CONFIG.jsonOutput) {
                console.log(`⚠️  package.json script "${scriptName}": ${dangerous.warning}`);
              }
            }
          }
        }
      }
    } catch (error) {
      if (CONFIG.verbose) {
        console.warn(`Warning: Could not parse package.json: ${error.message}`);
      }
    }
  }
  
  if (!CONFIG.jsonOutput) {
    console.log('');
  }
  
  return configResults;
}

/**
 * Run security-focused ESLint checks
 */
async function checkLinting() {
  if (!CONFIG.checkLinting || CONFIG.runQuick) return null;
  
  console.log('🔧 Running security-focused linting...\n');
  
  // Check if security ESLint plugins are available
  const securityPlugins = ['eslint-plugin-security'];
  const availablePlugins = [];
  
  for (const plugin of securityPlugins) {
    try {
      require.resolve(plugin);
      availablePlugins.push(plugin);
    } catch (error) {
      if (CONFIG.verbose) {
        console.warn(`Security plugin ${plugin} not installed`);
      }
    }
  }
  
  if (availablePlugins.length === 0) {
    console.log('⚠️  No security ESLint plugins found. Consider installing eslint-plugin-security\n');
    return { issues: [], plugins: [] };
  }
  
  // Run ESLint with security focus
  const lintResult = execCommand('npx eslint src/ server/ --ext .js,.ts,.tsx --format json', { silent: true });
  
  if (lintResult.success) {
    try {
      const results = JSON.parse(lintResult.output);
      const securityIssues = [];
      
      for (const fileResult of results) {
        for (const message of fileResult.messages) {
          if (message.ruleId && message.ruleId.includes('security')) {
            securityIssues.push({
              file: fileResult.filePath,
              line: message.line,
              column: message.column,
              rule: message.ruleId,
              message: message.message,
              severity: message.severity === 2 ? 'error' : 'warning'
            });
          }
        }
      }
      
      if (securityIssues.length === 0) {
        console.log('✅ No security linting issues found!\n');
      } else {
        console.log(`⚠️  Found ${securityIssues.length} security linting issues:\n`);
        
        for (const issue of securityIssues) {
          if (!CONFIG.jsonOutput) {
            console.log(`  ${issue.severity === 'error' ? '❌' : '⚠️'} ${issue.file}:${issue.line}:${issue.column}`);
            console.log(`    Rule: ${issue.rule}`);
            console.log(`    Message: ${issue.message}`);
            console.log('');
          }
        }
      }
      
      return { issues: securityIssues, plugins: availablePlugins };
      
    } catch (error) {
      console.error('❌ Failed to parse ESLint results:', error.message);
      return null;
    }
  } else {
    console.log('⚠️  ESLint execution failed\n');
    return null;
  }
}

/**
 * Generate security recommendations
 */
function generateRecommendations(results) {
  const recommendations = [];
  
  if (results.secrets && results.secrets.count > 0) {
    const criticalSecrets = results.secrets.secrets.filter(s => s.severity === 'CRITICAL');
    const highSecrets = results.secrets.secrets.filter(s => s.severity === 'HIGH');
    
    if (criticalSecrets.length > 0) {
      recommendations.push({
        priority: 'CRITICAL',
        action: 'Remove critical secrets from code immediately',
        details: `Found ${criticalSecrets.length} critical secrets (private keys, etc.)`
      });
    }
    
    if (highSecrets.length > 0) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Remove or secure high-risk credentials',
        details: `Found ${highSecrets.length} high-risk credentials (API keys, tokens, etc.)`
      });
    }
  }
  
  if (results.dependencies && results.dependencies.total > 0) {
    const summary = results.dependencies.summary;
    
    if (summary.critical > 0 || summary.high > 0) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Fix critical and high severity vulnerabilities immediately',
        details: `Critical: ${summary.critical}, High: ${summary.high}`,
        command: 'npm audit fix'
      });
    }
    
    if (summary.moderate > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Review and fix moderate severity vulnerabilities',
        details: `Moderate: ${summary.moderate}`,
        command: 'npm audit'
      });
    }
  }
  
  if (results.config && results.config.failed.length > 0) {
    recommendations.push({
      priority: 'MEDIUM',
      action: 'Add missing security configuration files',
      details: `Missing: ${results.config.failed.map(f => f.file).join(', ')}`
    });
  }
  
  return recommendations;
}

/**
 * Main execution
 */
async function main() {
  console.log('🛡️  Local Security Check\n');
  console.log('='.repeat(50));
  console.log('');
  
  const results = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    secrets: null,
    dependencies: null,
    configuration: null,
    linting: null,
    recommendations: []
  };
  
  try {
    // Run security checks
    if (!CONFIG.runQuick) {
      results.secrets = await checkSecrets();
    }
    
    results.dependencies = await checkDependencyVulnerabilities();
    results.configuration = checkSecurityConfiguration();
    
    if (!CONFIG.runQuick) {
      results.linting = await checkLinting();
    }
    
    // Generate recommendations
    results.recommendations = generateRecommendations(results);
    
    // Output results
    if (CONFIG.jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      // Summary
      console.log('📊 Security Check Summary');
      console.log('='.repeat(50));
      
      if (results.secrets) {
        console.log(`🔍 Secrets scan: ${results.secrets.count} issues found`);
      }
      
      if (results.dependencies) {
        console.log(`📦 Dependencies: ${results.dependencies.total} vulnerabilities found`);
      }
      
      if (results.configuration) {
        const configIssues = results.configuration.failed.length + results.configuration.warnings.length;
        console.log(`⚙️  Configuration: ${configIssues} issues found`);
      }
      
      if (results.linting) {
        console.log(`🔧 Security linting: ${results.linting.issues.length} issues found`);
      }
      
      // Recommendations
      if (results.recommendations.length > 0) {
        console.log('\n💡 Security Recommendations');
        console.log('='.repeat(50));
        
        for (const rec of results.recommendations) {
          console.log(`[${rec.priority}] ${rec.action}`);
          if (rec.details) {
            console.log(`  Details: ${rec.details}`);
          }
          if (rec.command) {
            console.log(`  Command: ${rec.command}`);
          }
          console.log('');
        }
      } else {
        console.log('\n✅ No critical security issues found!');
      }
    }
    
    // Exit with appropriate code
    const hasCriticalIssues = results.recommendations.some(r => r.priority === 'CRITICAL') ||
                             (results.dependencies && results.dependencies.summary && 
                              (results.dependencies.summary.critical > 0 || results.dependencies.summary.high > 0));
    
    process.exit(hasCriticalIssues ? 1 : 0);
    
  } catch (error) {
    console.error('💥 Unexpected error:', error.message);
    if (CONFIG.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Parse arguments and run
parseArgs();

if (require.main === module) {
  main();
}

module.exports = { checkSecrets, checkDependencyVulnerabilities, checkSecurityConfiguration };
#!/usr/bin/env node

/**
 * Error Code Extractor Script
 * Scans codebase for error handling patterns and error constants
 *
 * Usage: node scripts/error-code-extractor.js
 *
 * Generates a comprehensive report of:
 * - Error handling patterns (try/catch blocks)
 * - Error constants and custom error classes
 * - Error scenarios that need test coverage
 */

import fs from 'fs';
import path from 'path';

const SOURCE_DIRS = ['./src/server', './src/hooks', './src/utils', './src/components'];

const ERROR_PATTERNS = {
  tryBlock: /try\s*\{[\s\S]*?\}\s*catch/g,
  catchBlock: /catch\s*\(\s*([^)]+)\s*\)\s*\{[\s\S]*?\}/g,
  throwStatement: /throw\s+new\s+(\w*Error|\w+)\s*\(([^)]*)\)/g,
  errorConstant: /(?:const|let|var)\s+(\w*[Ee]rror\w*)\s*=\s*['"`]([^'"`]+)['"`]/g,
  errorClass: /class\s+(\w*Error\w*)\s+extends\s+Error/g,
  errorMessage: /(?:error|Error)\.message|error\.toString\(\)|String\(error\)/g,
  errorLog: /(?:console\.error|logger\.error|logError)\s*\([^)]*\)/g,
};

class ErrorCodeExtractor {
  constructor() {
    this.errorPatterns = [];
    this.errorConstants = [];
    this.errorClasses = [];
    this.uncoveredScenarios = [];
    this.stats = {
      filesScanned: 0,
      tryBlocks: 0,
      catchBlocks: 0,
      throwStatements: 0,
      errorConstants: 0,
      errorClasses: 0,
    };
  }

  async extract() {
    console.log('🔍 Starting Error Code Extraction...\n');

    try {
      await this.scanDirectories();
      this.generateReport();
      this.saveResults();
    } catch (error) {
      console.error('❌ Extraction failed:', error.message);
      process.exit(1);
    }
  }

  async scanDirectories() {
    console.log('📂 Scanning directories for error patterns...');

    for (const dir of SOURCE_DIRS) {
      if (fs.existsSync(dir)) {
        await this.scanDirectory(dir);
      } else {
        console.log(`⚠️  Directory not found: ${dir}`);
      }
    }

    console.log(`📊 Scanned ${this.stats.filesScanned} files`);
  }

  async scanDirectory(dirPath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath);
      } else if (this.isSourceFile(entry.name)) {
        await this.scanFile(fullPath);
      }
    }
  }

  isSourceFile(filename) {
    return (
      /\.(ts|tsx|js|jsx)$/.test(filename) &&
      !filename.includes('.test.') &&
      !filename.includes('.spec.')
    );
  }

  async scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      this.stats.filesScanned++;

      // Extract different error patterns
      this.extractTryBlocks(content, filePath);
      this.extractCatchBlocks(content, filePath);
      this.extractThrowStatements(content, filePath);
      this.extractErrorConstants(content, filePath);
      this.extractErrorClasses(content, filePath);
    } catch (error) {
      console.warn(`⚠️  Failed to read file: ${filePath}`);
    }
  }

  extractTryBlocks(content, filePath) {
    const matches = [...content.matchAll(ERROR_PATTERNS.tryBlock)];

    matches.forEach((match, index) => {
      this.stats.tryBlocks++;
      this.errorPatterns.push({
        type: 'try-block',
        file: filePath,
        line: this.getLineNumber(content, match.index),
        code: this.cleanCode(match[0].substring(0, 100)),
        scenario: this.inferErrorScenario(match[0], filePath),
      });
    });
  }

  extractCatchBlocks(content, filePath) {
    const matches = [...content.matchAll(ERROR_PATTERNS.catchBlock)];

    matches.forEach((match, index) => {
      this.stats.catchBlocks++;
      const errorVariable = match[1] || 'error';

      this.errorPatterns.push({
        type: 'catch-block',
        file: filePath,
        line: this.getLineNumber(content, match.index),
        errorVariable: errorVariable,
        code: this.cleanCode(match[0].substring(0, 100)),
        hasErrorHandling: this.hasMeaningfulErrorHandling(match[0]),
      });
    });
  }

  extractThrowStatements(content, filePath) {
    const matches = [...content.matchAll(ERROR_PATTERNS.throwStatement)];

    matches.forEach(match => {
      this.stats.throwStatements++;
      const errorType = match[1];
      const errorMessage = match[2];

      this.errorPatterns.push({
        type: 'throw-statement',
        file: filePath,
        line: this.getLineNumber(content, match.index),
        errorType: errorType,
        message: this.cleanCode(errorMessage),
        code: this.cleanCode(match[0]),
      });
    });
  }

  extractErrorConstants(content, filePath) {
    const matches = [...content.matchAll(ERROR_PATTERNS.errorConstant)];

    matches.forEach(match => {
      this.stats.errorConstants++;
      this.errorConstants.push({
        name: match[1],
        value: match[2],
        file: filePath,
        line: this.getLineNumber(content, match.index),
      });
    });
  }

  extractErrorClasses(content, filePath) {
    const matches = [...content.matchAll(ERROR_PATTERNS.errorClass)];

    matches.forEach(match => {
      this.stats.errorClasses++;
      this.errorClasses.push({
        name: match[1],
        file: filePath,
        line: this.getLineNumber(content, match.index),
        code: this.cleanCode(match[0]),
      });
    });
  }

  inferErrorScenario(code, filePath) {
    // Infer what type of error scenario this might be
    if (filePath.includes('/auth') || code.includes('token') || code.includes('login')) {
      return 'authentication';
    }
    if (filePath.includes('/api') || code.includes('request') || code.includes('response')) {
      return 'api-request';
    }
    if (code.includes('prisma') || code.includes('database') || code.includes('db')) {
      return 'database';
    }
    if (code.includes('fetch') || code.includes('http') || code.includes('network')) {
      return 'network';
    }
    if (code.includes('validation') || code.includes('validate')) {
      return 'validation';
    }

    return 'general';
  }

  hasMeaningfulErrorHandling(catchBlock) {
    // Check if the catch block has meaningful error handling beyond just logging
    const meaningfulPatterns = [
      /setError\s*\(/,
      /showToast\s*\(/,
      /throw\s+/,
      /return\s+.*error/,
      /\.message/,
      /error.*response/,
    ];

    return meaningfulPatterns.some(pattern => pattern.test(catchBlock));
  }

  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
  }

  cleanCode(code) {
    return code.replace(/\s+/g, ' ').trim();
  }

  generateReport() {
    console.log('\n📊 ERROR CODE EXTRACTION REPORT');
    console.log('='.repeat(50));

    this.printStats();
    this.printErrorScenarios();
    this.printErrorConstants();
    this.printErrorClasses();
    this.printTestingRecommendations();
  }

  printStats() {
    console.log('\n📈 EXTRACTION STATISTICS');
    console.log('-'.repeat(30));
    console.log(`Files Scanned:     ${this.stats.filesScanned}`);
    console.log(`Try Blocks:        ${this.stats.tryBlocks}`);
    console.log(`Catch Blocks:      ${this.stats.catchBlocks}`);
    console.log(`Throw Statements:  ${this.stats.throwStatements}`);
    console.log(`Error Constants:   ${this.stats.errorConstants}`);
    console.log(`Error Classes:     ${this.stats.errorClasses}`);
  }

  printErrorScenarios() {
    console.log('\n🎯 ERROR SCENARIOS BY TYPE');
    console.log('-'.repeat(40));

    const scenarioGroups = this.groupBy(
      this.errorPatterns.filter(p => p.scenario),
      'scenario'
    );

    Object.entries(scenarioGroups).forEach(([scenario, patterns]) => {
      console.log(`\n${scenario.toUpperCase()} (${patterns.length} patterns):`);

      patterns.slice(0, 3).forEach(pattern => {
        const fileName = path.basename(pattern.file);
        console.log(`  • ${fileName}:${pattern.line} - ${pattern.type}`);
        if (pattern.code) {
          console.log(`    Code: ${pattern.code.substring(0, 60)}...`);
        }
      });
    });
  }

  printErrorConstants() {
    console.log('\n🔧 ERROR CONSTANTS FOUND');
    console.log('-'.repeat(30));

    if (this.errorConstants.length === 0) {
      console.log('No error constants found.');
      return;
    }

    this.errorConstants.forEach(constant => {
      const fileName = path.basename(constant.file);
      console.log(`• ${constant.name}: "${constant.value}"`);
      console.log(`  File: ${fileName}:${constant.line}`);
    });
  }

  printErrorClasses() {
    console.log('\n🏗️  CUSTOM ERROR CLASSES');
    console.log('-'.repeat(30));

    if (this.errorClasses.length === 0) {
      console.log('No custom error classes found.');
      return;
    }

    this.errorClasses.forEach(errorClass => {
      const fileName = path.basename(errorClass.file);
      console.log(`• ${errorClass.name}`);
      console.log(`  File: ${fileName}:${errorClass.line}`);
    });
  }

  printTestingRecommendations() {
    console.log('\n💡 TESTING RECOMMENDATIONS');
    console.log('-'.repeat(35));

    console.log('\n🎯 HIGH-PRIORITY ERROR SCENARIOS TO TEST:');

    const scenarioGroups = this.groupBy(
      this.errorPatterns.filter(p => p.scenario),
      'scenario'
    );

    const prioritizedScenarios = Object.entries(scenarioGroups)
      .sort(([, a], [, b]) => b.length - a.length)
      .slice(0, 5);

    prioritizedScenarios.forEach(([scenario, patterns], index) => {
      const uncoveredHandlers = patterns.filter(
        p => p.type === 'catch-block' && !p.hasErrorHandling
      );

      console.log(`\n${index + 1}. ${scenario.toUpperCase()} ERRORS (${patterns.length} total)`);
      console.log(`   • ${patterns.filter(p => p.type === 'try-block').length} try blocks`);
      console.log(`   • ${patterns.filter(p => p.type === 'catch-block').length} catch blocks`);
      console.log(`   • ${uncoveredHandlers.length} potentially untested error paths`);

      // Suggest specific test scenarios
      this.suggestTestScenarios(scenario, patterns);
    });

    console.log('\n📋 SUGGESTED TEST PATTERNS:');
    console.log('   • Test network timeout scenarios');
    console.log('   • Test malformed API responses');
    console.log('   • Test database connection failures');
    console.log('   • Test invalid authentication tokens');
    console.log('   • Test concurrent operation conflicts');
  }

  suggestTestScenarios(scenario, patterns) {
    const suggestions = {
      authentication: [
        'Invalid/expired tokens',
        'Concurrent login attempts',
        'Token refresh failures',
      ],
      'api-request': ['Network timeout', 'Malformed responses', 'Rate limiting scenarios'],
      database: ['Connection failures', 'Transaction rollbacks', 'Constraint violations'],
      network: ['Connection timeouts', 'DNS resolution failures', 'SSL certificate errors'],
      validation: ['Invalid input data', 'Missing required fields', 'Type coercion failures'],
    };

    const scenarioSuggestions = suggestions[scenario] || ['Error boundary testing'];
    console.log(`   Test scenarios: ${scenarioSuggestions.join(', ')}`);
  }

  groupBy(array, key) {
    return array.reduce((groups, item) => {
      const group = item[key];
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(item);
      return groups;
    }, {});
  }

  saveResults() {
    const results = {
      timestamp: new Date().toISOString(),
      stats: this.stats,
      errorPatterns: this.errorPatterns,
      errorConstants: this.errorConstants,
      errorClasses: this.errorClasses,
      recommendations: {
        highPriorityScenarios: this.getPriorityScenarios(),
        testCandidates: this.getTestCandidates(),
      },
    };

    const outputPath = './scripts/error-analysis-results.json';
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n📋 Detailed results saved to: ${outputPath}`);
  }

  getPriorityScenarios() {
    const scenarioGroups = this.groupBy(
      this.errorPatterns.filter(p => p.scenario),
      'scenario'
    );

    return Object.entries(scenarioGroups)
      .map(([scenario, patterns]) => ({
        scenario,
        patternCount: patterns.length,
        tryBlocks: patterns.filter(p => p.type === 'try-block').length,
        catchBlocks: patterns.filter(p => p.type === 'catch-block').length,
        uncoveredHandlers: patterns.filter(p => p.type === 'catch-block' && !p.hasErrorHandling)
          .length,
      }))
      .sort((a, b) => b.patternCount - a.patternCount);
  }

  getTestCandidates() {
    return this.errorPatterns
      .filter(pattern => pattern.type === 'catch-block' && !pattern.hasErrorHandling)
      .map(pattern => ({
        file: pattern.file,
        line: pattern.line,
        scenario: pattern.scenario,
        reason: 'Catch block with minimal error handling',
      }));
  }
}

// CLI execution
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const extractor = new ErrorCodeExtractor();
  extractor.extract().catch(console.error);
}

export default ErrorCodeExtractor;

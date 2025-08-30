#!/usr/bin/env tsx

/**
 * Test Data Conflict Detector
 *
 * Scans integration tests for potential data conflicts and provides
 * recommendations for fixing them.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { testDb } from '../tests/integration/utils/testDbSetup.js';

interface ConflictIssue {
  type:
    | 'hardcoded-email'
    | 'hardcoded-data'
    | 'duplicate-test-data'
    | 'race-condition'
    | 'shared-state';
  severity: 'high' | 'medium' | 'low';
  file: string;
  line: number;
  code: string;
  description: string;
  recommendation: string;
}

interface ConflictReport {
  totalIssues: number;
  issuesBySeverity: Record<string, number>;
  issuesByType: Record<string, number>;
  issues: ConflictIssue[];
  summary: string[];
  recommendations: string[];
}

class TestDataConflictDetector {
  private testDirectory: string;
  private issues: ConflictIssue[] = [];

  constructor(testDirectory: string = 'tests/integration') {
    this.testDirectory = testDirectory;
  }

  /**
   * Scans all test files for potential conflicts
   */
  async scanForConflicts(): Promise<ConflictReport> {
    console.log('🔍 Scanning for test data conflicts...');

    this.issues = [];
    await this.scanDirectory(this.testDirectory);

    // Also check database for existing conflicts
    await this.scanDatabaseForConflicts();

    return this.generateReport();
  }

  /**
   * Recursively scans directory for test files
   */
  private async scanDirectory(dir: string): Promise<void> {
    const fullPath = join(process.cwd(), dir);

    try {
      const entries = readdirSync(fullPath);

      for (const entry of entries) {
        const entryPath = join(fullPath, entry);
        const stat = statSync(entryPath);

        if (stat.isDirectory()) {
          await this.scanDirectory(join(dir, entry));
        } else if (this.isTestFile(entry)) {
          await this.scanTestFile(join(dir, entry));
        }
      }
    } catch (error) {
      console.warn(`⚠️ Could not scan directory ${dir}:`, error);
    }
  }

  /**
   * Checks if a file is a test file
   */
  private isTestFile(filename: string): boolean {
    return (
      extname(filename) === '.ts' && (filename.includes('.test.') || filename.includes('.spec.'))
    );
  }

  /**
   * Scans a test file for potential conflicts
   */
  private async scanTestFile(filePath: string): Promise<void> {
    try {
      const content = readFileSync(join(process.cwd(), filePath), 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        this.checkForHardcodedEmails(line, index + 1, filePath);
        this.checkForHardcodedTestData(line, index + 1, filePath);
        this.checkForRaceConditions(line, index + 1, filePath);
        this.checkForSharedState(line, index + 1, filePath);
      });
    } catch (error) {
      console.warn(`⚠️ Could not read test file ${filePath}:`, error);
    }
  }

  /**
   * Checks for hardcoded email addresses
   */
  private checkForHardcodedEmails(line: string, lineNumber: number, file: string): void {
    const hardcodedEmailPatterns = [
      /['"`]test@example\.com['"`]/,
      /['"`]user@test\.com['"`]/,
      /['"`]admin@test\.com['"`]/,
      /['"`]testuser@example\.com['"`]/,
      /['"`]newuser@test\.com['"`]/,
      /['"`]\w+@(test|example)\.com['"`]/,
    ];

    hardcodedEmailPatterns.forEach(pattern => {
      if (pattern.test(line)) {
        this.issues.push({
          type: 'hardcoded-email',
          severity: 'high',
          file,
          line: lineNumber,
          code: line.trim(),
          description: 'Hardcoded email address can cause conflicts in parallel tests',
          recommendation:
            'Use testDb.utils.generateUniqueEmail() or isolationManager.generateTestEmail()',
        });
      }
    });
  }

  /**
   * Checks for other hardcoded test data
   */
  private checkForHardcodedTestData(line: string, lineNumber: number, file: string): void {
    const hardcodedDataPatterns = [
      { pattern: /title:\s*['"`]Test\s+\w+['"`]/, message: 'Hardcoded title' },
      { pattern: /name:\s*['"`]Test\s+User['"`]/, message: 'Hardcoded name' },
      { pattern: /notes:\s*['"`]Test\s+\w+['"`]/, message: 'Hardcoded notes' },
      { pattern: /new Date\(['"`]\d{4}-\d{2}-\d{2}['"`]\)/, message: 'Hardcoded date' },
    ];

    hardcodedDataPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(line)) {
        this.issues.push({
          type: 'hardcoded-data',
          severity: 'medium',
          file,
          line: lineNumber,
          code: line.trim(),
          description: `${message} can cause conflicts in parallel tests`,
          recommendation: 'Use unique data generation or add randomization',
        });
      }
    });
  }

  /**
   * Checks for potential race conditions
   */
  private checkForRaceConditions(line: string, lineNumber: number, file: string): void {
    const raceConditionPatterns = [
      { pattern: /await\s+testDb\.clean\(\)/, message: 'Database cleanup in test body' },
      { pattern: /setTimeout|setInterval/, message: 'Timer usage in tests' },
      {
        pattern: /Math\.random\(\)(?!\s*\.\s*toString)/,
        message: 'Non-deterministic random values',
      },
    ];

    raceConditionPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(line)) {
        this.issues.push({
          type: 'race-condition',
          severity: 'medium',
          file,
          line: lineNumber,
          code: line.trim(),
          description: `${message} can cause race conditions`,
          recommendation: 'Use beforeEach/afterEach hooks or deterministic values',
        });
      }
    });
  }

  /**
   * Checks for shared state issues
   */
  private checkForSharedState(line: string, lineNumber: number, file: string): void {
    const sharedStatePatterns = [
      {
        pattern: /let\s+\w+.*=.*(?:null|undefined);\s*$/,
        message: 'Module-level mutable variable',
      },
      { pattern: /global\.\w+\s*=/, message: 'Global variable assignment' },
      { pattern: /process\.env\.\w+\s*=/, message: 'Environment variable modification' },
    ];

    sharedStatePatterns.forEach(({ pattern, message }) => {
      if (pattern.test(line)) {
        this.issues.push({
          type: 'shared-state',
          severity: 'low',
          file,
          line: lineNumber,
          code: line.trim(),
          description: `${message} can cause shared state issues`,
          recommendation: 'Use test-scoped variables or proper cleanup',
        });
      }
    });
  }

  /**
   * Checks database for existing conflicts
   */
  private async scanDatabaseForConflicts(): Promise<void> {
    try {
      console.log('🗄️ Checking database for existing conflicts...');

      await testDb.initialize();
      const validation = await testDb.validateIntegrity();

      if (!validation.valid) {
        validation.issues.forEach(issue => {
          this.issues.push({
            type: 'duplicate-test-data',
            severity: 'high',
            file: 'database',
            line: 0,
            code: '',
            description: issue,
            recommendation: 'Clean database and fix data generation in tests',
          });
        });
      }
    } catch (error) {
      console.warn('⚠️ Could not check database for conflicts:', error);
    }
  }

  /**
   * Generates a comprehensive report
   */
  private generateReport(): ConflictReport {
    const totalIssues = this.issues.length;

    const issuesBySeverity = this.issues.reduce(
      (acc, issue) => {
        acc[issue.severity] = (acc[issue.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const issuesByType = this.issues.reduce(
      (acc, issue) => {
        acc[issue.type] = (acc[issue.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const summary = this.generateSummary(totalIssues, issuesBySeverity, issuesByType);
    const recommendations = this.generateRecommendations();

    return {
      totalIssues,
      issuesBySeverity,
      issuesByType,
      issues: this.issues,
      summary,
      recommendations,
    };
  }

  /**
   * Generates a summary of findings
   */
  private generateSummary(
    totalIssues: number,
    issuesBySeverity: Record<string, number>,
    issuesByType: Record<string, number>
  ): string[] {
    const summary: string[] = [];

    if (totalIssues === 0) {
      summary.push('✅ No test data conflicts detected!');
      return summary;
    }

    summary.push(`⚠️ Found ${totalIssues} potential test data conflict(s)`);

    if (issuesBySeverity.high) {
      summary.push(
        `🚨 ${issuesBySeverity.high} high severity issue(s) - should be fixed immediately`
      );
    }

    if (issuesBySeverity.medium) {
      summary.push(`⚠️ ${issuesBySeverity.medium} medium severity issue(s) - should be addressed`);
    }

    if (issuesBySeverity.low) {
      summary.push(`ℹ️ ${issuesBySeverity.low} low severity issue(s) - consider fixing`);
    }

    // Type breakdown
    Object.entries(issuesByType).forEach(([type, count]) => {
      summary.push(`• ${count} ${type.replace(/-/g, ' ')} issue(s)`);
    });

    return summary;
  }

  /**
   * Generates actionable recommendations
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    if (this.issues.some(i => i.type === 'hardcoded-email')) {
      recommendations.push('📧 Replace hardcoded emails with testDb.utils.generateUniqueEmail()');
    }

    if (this.issues.some(i => i.type === 'hardcoded-data')) {
      recommendations.push('🔧 Use data factories or add randomization to test data');
    }

    if (this.issues.some(i => i.type === 'race-condition')) {
      recommendations.push(
        '🏃 Fix race conditions by using proper test hooks and deterministic data'
      );
    }

    if (this.issues.some(i => i.type === 'duplicate-test-data')) {
      recommendations.push('🗄️ Clean test database and implement proper test isolation');
    }

    if (this.issues.some(i => i.type === 'shared-state')) {
      recommendations.push('🌐 Eliminate shared state by using test-scoped variables');
    }

    recommendations.push('');
    recommendations.push(
      '🚀 Consider using TestDataIsolationManager for comprehensive conflict prevention'
    );
    recommendations.push(
      '📖 See tests/integration/examples/isolatedAuthTest.example.ts for usage examples'
    );

    return recommendations;
  }

  /**
   * Prints a detailed report to console
   */
  printReport(report: ConflictReport): void {
    console.log('\n📊 Test Data Conflict Detection Report');
    console.log('=====================================\n');

    // Summary
    report.summary.forEach(line => console.log(line));

    if (report.totalIssues === 0) {
      return;
    }

    // Detailed issues
    console.log('\n📋 Detailed Issues:\n');

    const sortedIssues = report.issues.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });

    sortedIssues.forEach((issue, index) => {
      const severityIcon = {
        high: '🚨',
        medium: '⚠️',
        low: 'ℹ️',
      }[issue.severity];

      console.log(`${index + 1}. ${severityIcon} ${issue.type.replace(/-/g, ' ').toUpperCase()}`);
      console.log(`   File: ${issue.file}:${issue.line}`);
      console.log(`   Code: ${issue.code}`);
      console.log(`   Issue: ${issue.description}`);
      console.log(`   Fix: ${issue.recommendation}`);
      console.log('');
    });

    // Recommendations
    console.log('💡 Recommendations:\n');
    report.recommendations.forEach(rec => console.log(rec));
  }
}

/**
 * Main execution
 */
async function main() {
  const detector = new TestDataConflictDetector();

  try {
    const report = await detector.scanForConflicts();
    detector.printReport(report);

    // Exit with appropriate code
    const hasHighSeverityIssues = report.issues.some(i => i.severity === 'high');
    if (hasHighSeverityIssues) {
      console.log('\n🚨 High severity issues detected. Please fix before running tests.\n');
      process.exit(1);
    } else if (report.totalIssues > 0) {
      console.log(
        '\n⚠️ Issues detected but not critical. Consider fixing to improve test reliability.\n'
      );
      process.exit(0);
    } else {
      console.log('\n✅ No issues detected. Tests should run without data conflicts.\n');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Failed to scan for test data conflicts:', error);
    process.exit(1);
  } finally {
    try {
      await testDb.disconnect();
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { TestDataConflictDetector };

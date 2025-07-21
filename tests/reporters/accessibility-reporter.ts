import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

interface AccessibilityViolation {
  rule: string;
  impact: string;
  description: string;
  help: string;
  helpUrl: string;
  nodes: number;
}

interface AccessibilitySummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  violations: AccessibilityViolation[];
  timestamp: string;
  duration: number;
}

export default class AccessibilityReporter implements Reporter {
  private summary: AccessibilitySummary = {
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    violations: [],
    timestamp: new Date().toISOString(),
    duration: 0,
  };
  private startTime = Date.now();

  onTestEnd(test: TestCase, result: TestResult) {
    // Only process accessibility tests
    if (
      !test.title.toLowerCase().includes('accessibility') &&
      !test.parent.title?.toLowerCase().includes('accessibility')
    ) {
      return;
    }

    this.summary.totalTests++;

    if (result.status === 'passed') {
      this.summary.passedTests++;
    } else if (result.status === 'failed') {
      this.summary.failedTests++;

      // Extract accessibility violations from error messages
      const errorMessage = result.error?.message || '';
      const violationMatch = errorMessage.match(/violations:\s*(\[[\s\S]*?\])/);

      if (violationMatch) {
        try {
          const violations = JSON.parse(violationMatch[1]);
          violations.forEach((violation: any) => {
            this.summary.violations.push({
              rule: violation.id,
              impact: violation.impact,
              description: violation.description,
              help: violation.help,
              helpUrl: violation.helpUrl,
              nodes: violation.nodes?.length || 0,
            });
          });
        } catch {
          // Failed to parse violations
        }
      }
    }
  }

  onEnd() {
    this.summary.duration = Date.now() - this.startTime;

    // Ensure directory exists
    const outputPath = 'test-results/accessibility-summary.json';
    mkdirSync(dirname(outputPath), { recursive: true });

    // Write summary file
    writeFileSync(outputPath, JSON.stringify(this.summary, null, 2));

    // Also log to console for debugging
    console.log('\n📊 Accessibility Test Summary:');
    console.log(`   Total tests: ${this.summary.totalTests}`);
    console.log(`   Passed: ${this.summary.passedTests}`);
    console.log(`   Failed: ${this.summary.failedTests}`);
    console.log(`   Violations found: ${this.summary.violations.length}`);
    console.log(`   Duration: ${(this.summary.duration / 1000).toFixed(2)}s`);

    if (this.summary.violations.length > 0) {
      console.log('\n⚠️  Accessibility Violations:');
      this.summary.violations.forEach(v => {
        console.log(`   - ${v.rule} (${v.impact}): ${v.help}`);
      });
    }
  }
}

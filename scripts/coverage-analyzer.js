#!/usr/bin/env node

/**
 * Coverage Analyzer Script
 * Parses coverage JSON and identifies critical gaps in test coverage
 *
 * Usage: node scripts/coverage-analyzer.js
 *
 * Output: Analysis of coverage gaps focusing on:
 * - Files with <50% coverage in critical paths
 * - Complex functions with low coverage
 * - Error handling scenarios
 */

import fs from 'fs';
import path from 'path';

const COVERAGE_JSON_PATH = './coverage/coverage-summary.json';
const CRITICAL_PATHS = [
  'src/server/routes',
  'src/server/middleware',
  'src/server/utils',
  'src/hooks',
  'src/utils',
  'src/components',
];

const COMPLEXITY_THRESHOLD = 50; // Lines of code
const LOW_COVERAGE_THRESHOLD = 50; // Percentage

class CoverageAnalyzer {
  constructor(coverageJsonPath = COVERAGE_JSON_PATH) {
    this.coverageJsonPath = coverageJsonPath;
    this.coverageData = null;
    this.criticalGaps = [];
    this.complexLowCoverageFiles = [];
    this.errorHandlingGaps = [];
  }

  async analyze() {
    console.log('🔍 Starting Coverage Analysis...\n');

    try {
      await this.loadCoverageData();
      console.log(`📊 Processing ${Object.keys(this.coverageData).length - 1} files...`);
      this.identifyCriticalGaps();
      this.findComplexLowCoverageFiles();
      this.generateReport();
    } catch (error) {
      console.error('❌ Analysis failed:', error.message);
      process.exit(1);
    }
  }

  async loadCoverageData() {
    if (!fs.existsSync(this.coverageJsonPath)) {
      throw new Error(
        `Coverage file not found: ${this.coverageJsonPath}. Run 'npm run test:coverage' first.`
      );
    }

    const rawData = fs.readFileSync(this.coverageJsonPath, 'utf8');
    this.coverageData = JSON.parse(rawData);
    console.log('✅ Coverage data loaded successfully');
  }

  identifyCriticalGaps() {
    console.log('🎯 Identifying critical coverage gaps...');

    let checkedFiles = 0;
    for (const [filePath, data] of Object.entries(this.coverageData)) {
      if (filePath === 'total') continue;

      // Focus only on src/ files, ignore config and duplicate files
      if (!filePath.includes('/src/') || filePath.includes(' 2.') || filePath.includes(' 3.')) {
        continue;
      }

      checkedFiles++;
      const isInCriticalPath = CRITICAL_PATHS.some(criticalPath => filePath.includes(criticalPath));

      if (isInCriticalPath && data.lines.pct < LOW_COVERAGE_THRESHOLD) {
        this.criticalGaps.push({
          file: filePath,
          coverage: data.lines.pct,
          uncoveredLines: data.lines.total - data.lines.covered,
          branches: data.branches.pct,
          functions: data.functions.pct,
          statements: data.statements.pct,
        });
      }
    }

    // Sort by lowest coverage first
    this.criticalGaps.sort((a, b) => a.coverage - b.coverage);
    console.log(
      `📋 Checked ${checkedFiles} src/ files, found ${this.criticalGaps.length} critical coverage gaps`
    );
  }

  findComplexLowCoverageFiles() {
    console.log('🧩 Finding complex files with low coverage...');

    let checkedFiles = 0;
    for (const [filePath, data] of Object.entries(this.coverageData)) {
      if (filePath === 'total') continue;

      // Focus only on src/ files, ignore config and duplicate files
      if (!filePath.includes('/src/') || filePath.includes(' 2.') || filePath.includes(' 3.')) {
        continue;
      }

      checkedFiles++;
      const isComplex = data.lines.total > COMPLEXITY_THRESHOLD;
      const hasLowCoverage = data.lines.pct < LOW_COVERAGE_THRESHOLD;

      if (isComplex && hasLowCoverage) {
        this.complexLowCoverageFiles.push({
          file: filePath,
          totalLines: data.lines.total,
          coverage: data.lines.pct,
          uncoveredLines: data.lines.total - data.lines.covered,
          complexity: this.calculateComplexityScore(data),
          priority: this.calculatePriority(data),
        });
      }
    }

    // Sort by priority (complexity * uncovered lines)
    this.complexLowCoverageFiles.sort((a, b) => b.priority - a.priority);
    console.log(`🔍 Found ${this.complexLowCoverageFiles.length} complex files with low coverage`);
  }

  calculateComplexityScore(data) {
    // Simple complexity score based on size and branch coverage
    const sizeScore = data.lines.total / 100;
    const branchComplexity = (100 - data.branches.pct) / 10;
    return Math.round(sizeScore + branchComplexity);
  }

  calculatePriority(data) {
    // Priority = complexity * uncovered lines * branch complexity
    const uncoveredLines = data.lines.total - data.lines.covered;
    const branchGap = 100 - data.branches.pct;
    return Math.round(uncoveredLines * branchGap * 0.1);
  }

  generateReport() {
    console.log('\n📊 COVERAGE ANALYSIS REPORT');
    console.log('='.repeat(50));

    this.printOverallSummary();
    this.printCriticalGaps();
    this.printComplexLowCoverageFiles();
    this.printRecommendations();

    // Save detailed report to file
    this.saveDetailedReport();
  }

  printOverallSummary() {
    const total = this.coverageData.total;

    console.log('\n📈 OVERALL COVERAGE SUMMARY');
    console.log('-'.repeat(30));
    console.log(`Lines:      ${total.lines.pct}% (${total.lines.covered}/${total.lines.total})`);
    console.log(
      `Branches:   ${total.branches.pct}% (${total.branches.covered}/${total.branches.total})`
    );
    console.log(
      `Functions:  ${total.functions.pct}% (${total.functions.covered}/${total.functions.total})`
    );
    console.log(
      `Statements: ${total.statements.pct}% (${total.statements.covered}/${total.statements.total})`
    );
  }

  printCriticalGaps() {
    console.log('\n🚨 CRITICAL COVERAGE GAPS (Critical Paths <50% Coverage)');
    console.log('-'.repeat(60));

    if (this.criticalGaps.length === 0) {
      console.log('✅ No critical coverage gaps found!');
      return;
    }

    this.criticalGaps.slice(0, 10).forEach((gap, index) => {
      console.log(`${index + 1}. ${gap.file}`);
      console.log(`   Coverage: ${gap.coverage}% | Uncovered: ${gap.uncoveredLines} lines`);
      console.log(`   Branches: ${gap.branches}% | Functions: ${gap.functions}%`);
      console.log('');
    });
  }

  printComplexLowCoverageFiles() {
    console.log('\n🎯 HIGH-PRIORITY TESTING TARGETS (Complex + Low Coverage)');
    console.log('-'.repeat(65));

    if (this.complexLowCoverageFiles.length === 0) {
      console.log('✅ No complex low-coverage files found!');
      return;
    }

    this.complexLowCoverageFiles.slice(0, 5).forEach((file, index) => {
      console.log(`${index + 1}. ${file.file}`);
      console.log(`   Size: ${file.totalLines} lines | Coverage: ${file.coverage}%`);
      console.log(`   Uncovered: ${file.uncoveredLines} lines | Priority: ${file.priority}`);
      console.log(`   Complexity Score: ${file.complexity}`);
      console.log('');
    });
  }

  printRecommendations() {
    console.log('\n💡 TESTING RECOMMENDATIONS');
    console.log('-'.repeat(30));

    const highPriorityFiles = this.complexLowCoverageFiles.slice(0, 3);
    const criticalGaps = this.criticalGaps.slice(0, 3);

    console.log('🎯 PHASE 2 TESTING PRIORITIES:');
    console.log('');

    console.log('1. HIGH-IMPACT COMPLEX FILES:');
    highPriorityFiles.forEach((file, index) => {
      const fileName = path.basename(file.file);
      console.log(
        `   ${index + 1}) ${fileName} (${file.totalLines} lines, ${file.coverage}% coverage)`
      );
    });

    console.log('\n2. CRITICAL PATH GAPS:');
    criticalGaps.forEach((gap, index) => {
      const fileName = path.basename(gap.file);
      console.log(
        `   ${index + 1}) ${fileName} (${gap.coverage}% coverage, ${gap.uncoveredLines} lines to cover)`
      );
    });

    console.log('\n3. SUGGESTED TESTING APPROACH:');
    console.log('   • Focus on error handling paths in auth routes');
    console.log('   • Add edge case testing for complex hooks');
    console.log('   • Create integration tests for uncovered middleware');
    console.log('   • Test state transitions in large components');
  }

  saveDetailedReport() {
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: this.coverageData.total,
      criticalGaps: this.criticalGaps,
      complexLowCoverageFiles: this.complexLowCoverageFiles,
      recommendations: {
        highPriorityTargets: this.complexLowCoverageFiles.slice(0, 3).map(f => f.file),
        criticalGaps: this.criticalGaps.slice(0, 3).map(g => g.file),
      },
    };

    const reportPath = './coverage/analysis-report.json';
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n📋 Detailed report saved to: ${reportPath}`);
  }
}

// CLI execution
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const analyzer = new CoverageAnalyzer();
  analyzer.analyze().catch(console.error);
}

export default CoverageAnalyzer;

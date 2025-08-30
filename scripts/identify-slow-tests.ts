#!/usr/bin/env tsx

/**
 * Simplified test identification script
 * Identifies tests that could potentially be slow based on code patterns
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';

interface PotentialSlowTest {
  file: string;
  test: string;
  reason: string;
  line: number;
}

class SlowTestIdentifier {
  private slowTests: PotentialSlowTest[] = [];

  private patterns = {
    // Database operations
    database: [
      /prisma\.(create|update|delete|upsert|findMany|findUnique)/,
      /db\.(query|execute|transaction)/,
      /\.migrate\(/,
      /setupDatabase|seedData/,
    ],
    // Network operations
    network: [
      /fetch\(/,
      /axios\./,
      /supertest\(/,
      /request\.(get|post|put|delete|patch)/,
      /\.goto\(/,
      /page\.waitForResponse/,
    ],
    // File operations
    fileIO: [
      /fs\.(read|write|copy|move|remove)/,
      /readFile|writeFile/,
      /createReadStream|createWriteStream/,
    ],
    // Large loops or data processing
    computation: [
      /for\s*\([^)]*\d{3,}[^)]*\)/, // Loops with large numbers
      /\.map\([^)]*\)\.filter\([^)]*\)\.reduce/, // Chain operations
      /Array\(\d{4,}\)/, // Large array creation
      /while\s*\(true\)/, // Infinite loops
    ],
    // Timeouts and delays
    delays: [
      /setTimeout\(/,
      /setInterval\(/,
      /sleep\(/,
      /delay\(/,
      /wait\(/,
      /waitFor\(/,
      /\.pause\(/,
    ],
    // Complex selectors
    complexSelectors: [
      /\$\$\(/, // Multiple element queries
      /xpath=/, // XPath selectors
      /:has\(/, // Complex CSS selectors
      /nth-child\(\d{2,}\)/, // Large nth-child values
    ],
  };

  analyzeDirectory(dir: string, type: 'unit' | 'integration' | 'e2e'): void {
    console.log(`\n📂 Analyzing ${type} tests in: ${dir}`);

    try {
      this.scanDirectory(dir, type);
    } catch (error) {
      console.warn(`⚠️  Could not analyze ${dir}:`, error);
    }
  }

  private scanDirectory(dir: string, type: 'unit' | 'integration' | 'e2e'): void {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory() && !entry.includes('node_modules')) {
        this.scanDirectory(fullPath, type);
      } else if (stat.isFile() && this.isTestFile(entry)) {
        this.analyzeFile(fullPath, type);
      }
    }
  }

  private isTestFile(filename: string): boolean {
    return filename.includes('.test.') || filename.includes('.spec.');
  }

  private analyzeFile(filePath: string, type: 'unit' | 'integration' | 'e2e'): void {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      // Skip comments
      if (line.trim().startsWith('//') || line.trim().startsWith('/*')) {
        return;
      }

      // Check for test definitions
      const testMatch = line.match(/(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/);
      if (testMatch) {
        const testName = testMatch[1];

        // Look ahead in the test body for slow patterns
        const testEndIndex = this.findTestEnd(lines, index);
        const testBody = lines.slice(index, testEndIndex).join('\n');

        // Check all patterns
        for (const [category, patterns] of Object.entries(this.patterns)) {
          for (const pattern of patterns) {
            if (pattern.test(testBody)) {
              this.slowTests.push({
                file: filePath,
                test: testName,
                reason: `Contains ${category} operations`,
                line: index + 1,
              });
              break; // One reason per test is enough
            }
          }
        }
      }
    });
  }

  private findTestEnd(lines: string[], startIndex: number): number {
    let braceCount = 0;
    let inTest = false;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{') {
          braceCount++;
          inTest = true;
        } else if (char === '}') {
          braceCount--;
          if (inTest && braceCount === 0) {
            return i + 1;
          }
        }
      }
    }

    return lines.length;
  }

  generateReport(): void {
    console.log('\n📊 Potential Slow Tests Report');
    console.log('================================\n');

    if (this.slowTests.length === 0) {
      console.log('✅ No potentially slow tests identified!');
      return;
    }

    console.log(`Found ${this.slowTests.length} potentially slow tests:\n`);

    // Group by reason
    const byReason = new Map<string, PotentialSlowTest[]>();
    for (const test of this.slowTests) {
      const tests = byReason.get(test.reason) || [];
      tests.push(test);
      byReason.set(test.reason, tests);
    }

    // Print by category
    for (const [reason, tests] of byReason) {
      console.log(`\n🐌 ${reason} (${tests.length} tests):`);
      console.log('----------------------------------------');

      for (const test of tests.slice(0, 5)) {
        // Show top 5 per category
        const fileName = basename(test.file);
        console.log(`  📁 ${fileName}:${test.line}`);
        console.log(`     📝 ${test.test}`);
      }

      if (tests.length > 5) {
        console.log(`  ... and ${tests.length - 5} more`);
      }
    }

    // Recommendations
    console.log('\n💡 Optimization Recommendations:');
    console.log('----------------------------------');

    if (byReason.has('Contains database operations')) {
      console.log('\n🗄️  Database Tests:');
      console.log('  - Use test transactions with rollback');
      console.log('  - Mock Prisma client for unit tests');
      console.log('  - Use in-memory SQLite for faster tests');
      console.log('  - Batch database operations where possible');
    }

    if (byReason.has('Contains network operations')) {
      console.log('\n🌐 Network Tests:');
      console.log('  - Mock external API calls');
      console.log('  - Use MSW (Mock Service Worker) for API mocking');
      console.log('  - Reduce timeouts in test environment');
      console.log('  - Cache responses for repeated calls');
    }

    if (byReason.has('Contains delays operations')) {
      console.log('\n⏱️  Timing Tests:');
      console.log('  - Use fake timers (jest.useFakeTimers())');
      console.log('  - Replace arbitrary waits with proper conditions');
      console.log('  - Use waitFor() instead of fixed delays');
      console.log('  - Reduce timeout values in tests');
    }

    if (byReason.has('Contains fileIO operations')) {
      console.log('\n📁 File I/O Tests:');
      console.log('  - Use memory file systems (memfs)');
      console.log('  - Mock file operations');
      console.log('  - Use smaller test files');
      console.log('  - Clean up files after tests');
    }

    // Files with most slow tests
    const fileCount = new Map<string, number>();
    for (const test of this.slowTests) {
      fileCount.set(test.file, (fileCount.get(test.file) || 0) + 1);
    }

    const topFiles = Array.from(fileCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (topFiles.length > 0) {
      console.log('\n🔥 Files with Most Slow Tests:');
      console.log('--------------------------------');
      for (const [file, count] of topFiles) {
        console.log(`  ${count} tests: ${basename(file)}`);
      }
    }
  }
}

// Main execution
async function main() {
  const identifier = new SlowTestIdentifier();

  // Analyze different test directories
  identifier.analyzeDirectory('tests/unit', 'unit');
  identifier.analyzeDirectory('tests/integration', 'integration');
  identifier.analyzeDirectory('tests/e2e', 'e2e');
  identifier.analyzeDirectory('src', 'unit'); // Component tests

  // Generate report
  identifier.generateReport();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { SlowTestIdentifier };

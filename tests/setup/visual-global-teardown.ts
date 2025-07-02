import fs from 'fs/promises';
import path from 'path';

import { FullConfig } from '@playwright/test';

import { testDb } from '../fixtures/testDatabase.js';

import { VisualTestHelper } from './visualTestingSetup.js';

async function globalTeardown(_config: FullConfig) {
  console.log('🧹 Cleaning up visual regression testing environment...');

  try {
    // Clean up test database
    console.log('🗄️ Cleaning up visual test database...');
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();

    // Generate comprehensive visual regression report
    console.log('📊 Generating visual regression report...');
    const visualTest = new VisualTestHelper();
    await visualTest.generateReport();

    // Generate summary statistics
    await generateVisualTestSummary();

    // Clean up old test artifacts (keep last 10 runs)
    await cleanupOldArtifacts();

    console.log('✅ Visual testing cleanup complete');
  } catch (error) {
    console.error('❌ Visual testing cleanup failed:', error);
    // Don't throw error in teardown to avoid masking test failures
  }
}

async function generateVisualTestSummary() {
  try {
    const diffDir = 'test-results/visual-diffs';
    const summaryPath = path.join('test-results', 'visual-test-summary.json');

    // Count diff files
    let diffFiles: string[] = [];
    try {
      diffFiles = await fs.readdir(diffDir);
      diffFiles = diffFiles.filter(file => file.endsWith('-diff.png'));
    } catch {
      // Directory might not exist if no diffs
    }

    // Count baseline files
    let baselineFiles: string[] = [];
    try {
      baselineFiles = await fs.readdir('tests/visual-baselines');
      baselineFiles = baselineFiles.filter(file => file.endsWith('.png'));
    } catch {
      // Directory might not exist
    }

    const summary = {
      timestamp: new Date().toISOString(),
      environment: {
        ci: process.env.CI === 'true',
        updateBaselines: process.env.UPDATE_VISUAL_BASELINES === 'true',
        nodeVersion: process.version,
      },
      results: {
        totalBaselines: baselineFiles.length,
        totalDiffs: diffFiles.length,
        passedTests: baselineFiles.length - diffFiles.length,
        failedTests: diffFiles.length,
        successRate:
          baselineFiles.length > 0
            ? (((baselineFiles.length - diffFiles.length) / baselineFiles.length) * 100).toFixed(
                2
              ) + '%'
            : '100%',
      },
      files: {
        baselines: baselineFiles,
        diffs: diffFiles,
      },
    };

    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

    console.log('📋 Visual Test Summary:');
    console.log(`   • Total baselines: ${summary.results.totalBaselines}`);
    console.log(`   • Passed tests: ${summary.results.passedTests}`);
    console.log(`   • Failed tests: ${summary.results.failedTests}`);
    console.log(`   • Success rate: ${summary.results.successRate}`);
  } catch (error) {
    console.error('Failed to generate visual test summary:', error);
  }
}

async function cleanupOldArtifacts() {
  try {
    const resultsDir = 'test-results';
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    const now = Date.now();

    const entries = await fs.readdir(resultsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(resultsDir, entry.name);
        const stats = await fs.stat(dirPath);

        // Remove directories older than maxAge
        if (now - stats.mtime.getTime() > maxAge) {
          try {
            await fs.rm(dirPath, { recursive: true, force: true });
            console.log(`🗑️ Removed old artifacts: ${entry.name}`);
          } catch (error) {
            console.warn(`Warning: Could not remove ${entry.name}:`, error);
          }
        }
      }
    }

    // Also clean up old diff images
    const diffDir = path.join(resultsDir, 'visual-diffs');
    try {
      const diffFiles = await fs.readdir(diffDir);
      for (const file of diffFiles) {
        const filePath = path.join(diffDir, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          console.log(`🗑️ Removed old diff: ${file}`);
        }
      }
    } catch {
      // Diff directory might not exist
    }
  } catch (error) {
    console.warn('Warning: Could not cleanup old artifacts:', error);
  }
}

export default globalTeardown;

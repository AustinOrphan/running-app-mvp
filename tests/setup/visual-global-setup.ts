import fs from 'fs/promises';
import path from 'path';

import { FullConfig } from '@playwright/test';

import { testDb } from '../fixtures/testDatabase';

async function globalSetup(_config: FullConfig) {
  console.log('🎨 Setting up visual regression testing environment...');

  try {
    // Ensure visual testing directories exist
    const dirs = [
      'tests/visual-baselines',
      'test-results/visual-actual',
      'test-results/visual-diffs',
      'test-results/visual-regression-report',
    ];

    await Promise.all(dirs.map(dir => fs.mkdir(dir, { recursive: true }).catch(() => {})));

    // Initialize test database for visual tests
    console.log('📊 Initializing visual test database...');
    await testDb.cleanupDatabase();

    // Create baseline directories for different browsers/devices
    const browsers = ['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari'];
    await Promise.all(
      browsers.map(browser =>
        fs.mkdir(path.join('tests/visual-baselines', browser), { recursive: true }).catch(() => {})
      )
    );

    // Set up environment variables for visual testing
    process.env.VISUAL_TESTING = 'true';
    process.env.NODE_ENV = 'test';

    // Create .gitignore for visual test results if it doesn't exist
    const gitignorePath = path.join('test-results', '.gitignore');
    try {
      await fs.access(gitignorePath);
    } catch {
      await fs.writeFile(
        gitignorePath,
        `# Visual regression test results
visual-actual/
visual-diffs/
visual-regression-report/
*.png
*.jpg
*.jpeg
!visual-baselines/
`
      );
    }

    // Log configuration
    console.log('✅ Visual testing setup complete');
    console.log(`   • Baseline directory: tests/visual-baselines/`);
    console.log(`   • Results directory: test-results/`);
    console.log(
      `   • Update baselines: ${process.env.UPDATE_VISUAL_BASELINES === 'true' ? 'YES' : 'NO'}`
    );
    console.log(`   • CI mode: ${process.env.CI === 'true' ? 'YES' : 'NO'}`);
  } catch (error) {
    console.error('❌ Visual testing setup failed:', error);
    throw error;
  }
}

export default globalSetup;

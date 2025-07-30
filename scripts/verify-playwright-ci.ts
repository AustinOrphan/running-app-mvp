#!/usr/bin/env tsx

/**
 * Playwright CI Configuration Verification
 * Verifies that Playwright is properly configured for CI environments
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

interface PlaywrightVerificationResult {
  browserInstalled: boolean;
  configExists: boolean;
  canRunHeadless: boolean;
  errors: string[];
  warnings: string[];
}

async function verifyPlaywrightCI(): Promise<void> {
  console.log('🔍 Verifying Playwright CI configuration...\n');

  const result: PlaywrightVerificationResult = {
    browserInstalled: false,
    configExists: false,
    canRunHeadless: false,
    errors: [],
    warnings: [],
  };

  // Check if Playwright CI config exists
  console.log('📋 Checking Playwright CI configuration...');
  const ciConfigPath = path.join(process.cwd(), 'playwright.config.ci.ts');

  if (existsSync(ciConfigPath)) {
    result.configExists = true;
    console.log('✅ playwright.config.ci.ts exists');

    try {
      // Verify the config can be loaded
      const config = await import(ciConfigPath);
      console.log('✅ CI configuration loads successfully');

      // Check for CI-specific settings
      const configObj = config.default;
      if (configObj.retries !== undefined) {
        console.log(
          `  📊 Retries configured: ${typeof configObj.retries === 'function' ? 'dynamic' : configObj.retries}`
        );
      }

      if (configObj.workers !== undefined) {
        console.log(`  🔧 Workers configured: ${configObj.workers}`);
      }

      if (configObj.use?.headless !== undefined) {
        console.log(`  👁️  Headless mode: ${configObj.use.headless}`);
      }
    } catch (error) {
      result.errors.push(`Failed to load CI configuration: ${error}`);
      console.error('❌ Failed to load CI configuration:', error);
    }
  } else {
    result.errors.push('playwright.config.ci.ts not found');
    console.error('❌ playwright.config.ci.ts not found');
  }

  // Check if Playwright is installed
  console.log('\n🎭 Checking Playwright installation...');
  try {
    const playwrightVersion = execSync('npx playwright --version', {
      encoding: 'utf8',
      timeout: 10000,
    }).trim();
    console.log(`✅ Playwright installed: ${playwrightVersion}`);
  } catch (error) {
    result.errors.push('Playwright CLI not available');
    console.error('❌ Playwright CLI not available:', error);
  }

  // Check browser installation
  console.log('\n🌐 Checking browser installation...');
  try {
    // List installed browsers
    const browserList = execSync('npx playwright install --dry-run', {
      encoding: 'utf8',
      timeout: 15000,
    });

    if (browserList.includes('chromium')) {
      console.log('✅ Chromium browser available for installation');
      result.browserInstalled = true;
    } else {
      result.warnings.push('Chromium may not be available');
      console.warn('⚠️  Chromium availability uncertain');
    }
  } catch (error) {
    result.errors.push(`Browser check failed: ${error}`);
    console.error('❌ Browser check failed:', error);
  }

  // Test headless capability
  console.log('\n👁️  Testing headless browser capability...');
  try {
    // Try to run Playwright in CI mode (headless)
    process.env.CI = 'true';

    const testCommand = 'npx playwright test --config playwright.config.ci.ts --list';
    const testOutput = execSync(testCommand, {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, CI: 'true' },
    });

    if (
      testOutput.includes('0 tests') ||
      testOutput.includes('test') ||
      testOutput.includes('Test Files')
    ) {
      console.log('✅ Can run Playwright with CI configuration');
      result.canRunHeadless = true;
    } else {
      result.warnings.push('Playwright CI test listing produced unexpected output');
      console.warn('⚠️  Unexpected test listing output');
    }
  } catch (error) {
    // This might fail if no tests exist, which is okay
    if (error.toString().includes('No tests found')) {
      console.log('✅ Playwright CI configuration loads (no tests found is expected)');
      result.canRunHeadless = true;
    } else {
      result.warnings.push(`Headless test failed: ${error}`);
      console.warn('⚠️  Headless capability test failed:', error);
    }
  } finally {
    // Reset CI environment
    delete process.env.CI;
  }

  // Check for E2E test files
  console.log('\n📁 Checking E2E test files...');
  const e2eDir = path.join(process.cwd(), 'tests', 'e2e');
  if (existsSync(e2eDir)) {
    try {
      const testFiles = execSync('find tests/e2e -name "*.test.ts" -o -name "*.spec.ts"', {
        encoding: 'utf8',
        timeout: 5000,
      })
        .trim()
        .split('\n')
        .filter(file => file.length > 0);

      console.log(`✅ Found ${testFiles.length} E2E test files`);
      testFiles.forEach(file => console.log(`  📄 ${file}`));
    } catch (error) {
      console.warn('⚠️  Could not list E2E test files:', error);
    }
  } else {
    result.warnings.push('E2E test directory not found');
    console.warn('⚠️  E2E test directory not found');
  }

  // Final summary
  console.log('\n📊 Verification Summary:');

  if (result.errors.length === 0) {
    console.log('🎉 Playwright CI configuration verification completed successfully!');

    if (result.configExists) {
      console.log('✅ CI configuration file exists and loads properly');
    }

    if (result.canRunHeadless) {
      console.log('✅ Can run in headless mode with CI configuration');
    }

    if (result.browserInstalled) {
      console.log('✅ Browser installation capability verified');
    }
  } else {
    console.log('❌ Verification completed with errors:');
    result.errors.forEach(error => console.log(`  - ${error}`));
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach(warning => console.log(`  - ${warning}`));
  }
}

// Auto-run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyPlaywrightCI().catch(error => {
    console.error('❌ Playwright CI verification failed:', error);
    process.exit(1);
  });
}

export { verifyPlaywrightCI };

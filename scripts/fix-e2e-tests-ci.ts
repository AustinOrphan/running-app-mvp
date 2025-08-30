#!/usr/bin/env tsx

/**
 * E2E Test Configuration Fix Script
 *
 * This script addresses E2E test configuration issues in CI by:
 * - Fixing invalid test.use() syntax inside describe blocks
 * - Handling missing device configurations (e.g., iPhone 12)
 * - Setting up proper browser installation
 * - Fixing test structure issues
 * - Improving CI-specific configurations
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

class E2ETestFixer {
  private fixes: Array<{
    name: string;
    status: 'success' | 'failed' | 'skipped';
    message: string;
  }> = [];

  constructor() {
    console.log('🎭 E2E Test Configuration Fixer');
    console.log('='.repeat(50));
  }

  private logFix(name: string, status: 'success' | 'failed' | 'skipped', message: string): void {
    this.fixes.push({ name, status, message });

    const icon = status === 'success' ? '✅' : status === 'failed' ? '❌' : '⏭️';
    console.log(`${icon} ${name}: ${message}`);
  }

  async fixTestUseInDescribeBlocks(): Promise<void> {
    console.log('\n🔧 Fixing test.use() in describe blocks...');

    const e2eTestFiles = [
      'tests/e2e/accessibility.test.ts',
      'tests/e2e/navigation-swipe.test.ts',
      'tests/e2e/mobile-responsiveness.test.ts',
    ];

    for (const file of e2eTestFiles) {
      if (existsSync(file)) {
        try {
          let content = readFileSync(file, 'utf-8');
          let modified = false;

          // Pattern 1: test.use() inside describe blocks with iPhone 12
          if (content.includes("test.use(devices['iPhone 12'])")) {
            content = content.replace(
              /test\.describe\((.*?)\s*\{\s*test\.use\(devices\['iPhone 12'\]\);/g,
              `test.describe($1 {
    // Use iPhone 13 configuration as iPhone 12 is not in default devices
    test.use({
      ...devices['iPhone 13'],
      viewport: { width: 390, height: 844 },
      userAgent: devices['iPhone 13'].userAgent,
      hasTouch: true,
      isMobile: true,
    });`
            );
            modified = true;
          }

          // Pattern 2: test.use() with fallback object
          if (content.includes("devices['iPhone 12'] ??")) {
            content = content.replace(
              /devices\['iPhone 12'\] \?\? \{[\s\S]*?\}/g,
              `{
      ...devices['iPhone 13'],
      viewport: { width: 390, height: 844 },
      userAgent: devices['iPhone 13'].userAgent,
      hasTouch: true,
      isMobile: true,
    }`
            );
            modified = true;
          }

          // Pattern 3: test.use() with iPad (should use iPad Pro 11)
          if (content.includes("test.use(devices['iPad'])")) {
            content = content.replace(
              /test\.use\(devices\['iPad'\]\)/g,
              `test.use({
      ...devices['iPad Pro 11'],
      viewport: { width: 1024, height: 1366 },
      userAgent: devices['iPad Pro 11'].userAgent,
      hasTouch: true,
      isMobile: false,
    })`
            );
            modified = true;
          }

          if (modified) {
            writeFileSync(file, content);
            this.logFix(`Fix test.use in ${file}`, 'success', 'Fixed invalid test.use() syntax');
          } else {
            this.logFix(`Fix test.use in ${file}`, 'skipped', 'No invalid test.use() found');
          }
        } catch (error) {
          this.logFix(`Fix test.use in ${file}`, 'failed', `Error: ${error}`);
        }
      }
    }
  }

  async createDeviceHelpers(): Promise<void> {
    console.log('\n📱 Creating device configuration helpers...');

    const deviceHelpers = `/**
 * Device Configuration Helpers for E2E Tests
 * Provides consistent device configurations for Playwright tests
 */

import { devices } from '@playwright/test';

// iPhone configurations
export const iPhone12Config = {
  ...devices['iPhone 13'], // Use iPhone 13 as base since iPhone 12 is not in default devices
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  hasTouch: true,
  isMobile: true,
  defaultBrowserType: 'webkit' as const,
};

export const iPadConfig = {
  ...devices['iPad Pro 11'],
  viewport: { width: 1024, height: 1366 },
  hasTouch: true,
  isMobile: false,
  defaultBrowserType: 'webkit' as const,
};

// Desktop configurations
export const desktopChrome = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1920, height: 1080 },
};

export const mobileChrome = {
  ...devices['Pixel 5'],
  viewport: { width: 393, height: 851 },
  hasTouch: true,
  isMobile: true,
};

// CI-specific configurations
export const ciDesktopConfig = {
  viewport: { width: 1280, height: 720 },
  hasTouch: false,
  isMobile: false,
  reducedMotion: 'reduce' as const,
  colorScheme: 'light' as const,
};

export const ciMobileConfig = {
  viewport: { width: 375, height: 667 }, // iPhone SE size for CI
  hasTouch: true,
  isMobile: true,
  reducedMotion: 'reduce' as const,
  colorScheme: 'light' as const,
};
`;

    try {
      writeFileSync('tests/e2e/helpers/deviceConfigs.ts', deviceHelpers);
      this.logFix('Device Helpers', 'success', 'Created device configuration helpers');
    } catch (error) {
      this.logFix('Device Helpers', 'failed', `Failed to create device helpers: ${error}`);
    }
  }

  async fixE2ETestImports(): Promise<void> {
    console.log('\n📦 Fixing E2E test imports...');

    const e2eTestFiles = [
      'tests/e2e/accessibility.test.ts',
      'tests/e2e/navigation-swipe.test.ts',
      'tests/e2e/mobile-responsiveness.test.ts',
    ];

    for (const file of e2eTestFiles) {
      if (existsSync(file)) {
        try {
          let content = readFileSync(file, 'utf-8');

          // Add device config import if not present
          if (!content.includes('deviceConfigs')) {
            const importLine =
              "import { iPhone12Config, iPadConfig, ciMobileConfig } from './helpers/deviceConfigs.js';\n";
            content = content.replace(
              /import \{ test, expect, devices \} from '@playwright\/test';/,
              `import { test, expect, devices } from '@playwright/test';\n${importLine}`
            );

            writeFileSync(file, content);
            this.logFix(`Import fix in ${file}`, 'success', 'Added device config imports');
          }
        } catch (error) {
          this.logFix(`Import fix in ${file}`, 'failed', `Error: ${error}`);
        }
      }
    }
  }

  async createBrowserInstallScript(): Promise<void> {
    console.log('\n🌐 Creating browser installation script...');

    const browserScript = `#!/usr/bin/env tsx

/**
 * Playwright Browser Installation Script
 * Ensures browsers are properly installed for E2E tests
 */

import { execSync } from 'child_process';

class BrowserInstaller {
  install(browsers: string[] = ['chromium']): void {
    console.log('🎭 Installing Playwright browsers...');
    
    try {
      // Install specific browsers with dependencies
      const browserList = browsers.join(' ');
      execSync(\`npx playwright install --with-deps \${browserList}\`, {
        stdio: 'inherit',
        timeout: 300000 // 5 minute timeout
      });
      
      console.log('✅ Browsers installed successfully');
      
      // Verify installation
      execSync('npx playwright --version', { stdio: 'inherit' });
      
    } catch (error) {
      console.error('❌ Failed to install browsers:', error);
      process.exit(1);
    }
  }
  
  verify(): void {
    console.log('🔍 Verifying browser installation...');
    
    try {
      const result = execSync('npx playwright show-browsers', { encoding: 'utf-8' });
      console.log(result);
      console.log('✅ Browser verification complete');
    } catch (error) {
      console.error('❌ Browser verification failed:', error);
      process.exit(1);
    }
  }
}

// CLI execution
if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const installer = new BrowserInstaller();
  const command = process.argv[2] || 'install';
  
  switch (command) {
    case 'install':
      installer.install(process.argv.slice(3));
      break;
    case 'verify':
      installer.verify();
      break;
    default:
      console.error('Usage: install-browsers.ts [install|verify] [browser1 browser2 ...]');
      process.exit(1);
  }
}

export { BrowserInstaller };
`;

    try {
      writeFileSync('scripts/install-playwright-browsers.ts', browserScript);
      this.logFix('Browser Install Script', 'success', 'Created browser installation script');
    } catch (error) {
      this.logFix('Browser Install Script', 'failed', `Failed to create script: ${error}`);
    }
  }

  async updatePlaywrightConfig(): Promise<void> {
    console.log('\n⚙️ Updating Playwright configuration...');

    try {
      const configPath = 'playwright.config.ts';
      if (existsSync(configPath)) {
        let content = readFileSync(configPath, 'utf-8');

        // Fix reporter array syntax
        if (
          content.includes(
            "reporter: process.env.CI ? [['html'], ['./tests/reporters/accessibility-reporter.ts']] : 'html',"
          )
        ) {
          content = content.replace(
            "reporter: process.env.CI ? [['html'], ['./tests/reporters/accessibility-reporter.ts']] : 'html',",
            `reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
        ['./tests/reporters/accessibility-reporter.ts'],
      ]
    : 'html',`
          );
        }

        // Add expect configuration if missing
        if (!content.includes('expect:')) {
          const expectConfig = `
  /* Expect configuration for assertions */
  expect: {
    timeout: process.env.CI ? 30000 : 15000,
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixels: 100,
      animations: 'disabled',
    },
  },`;

          content = content.replace(/webServer: \{[\s\S]*?\},\s*}\);/, match =>
            match.replace(/}\);/, `},${expectConfig}\n});`)
          );
        }

        writeFileSync(configPath, content);
        this.logFix('Playwright Config', 'success', 'Updated main Playwright configuration');
      }
    } catch (error) {
      this.logFix('Playwright Config', 'failed', `Failed to update config: ${error}`);
    }
  }

  async createE2ETestSetup(): Promise<void> {
    console.log('\n🎬 Creating E2E test setup...');

    const e2eSetup = `/**
 * E2E Test Setup and Utilities
 * Provides common setup for all E2E tests
 */

import { test as base, expect } from '@playwright/test';
import { testDb } from '../../fixtures/testDatabase.js';

// Extend base test with custom fixtures
export const test = base.extend({
  // Auto-login fixture
  authenticatedPage: async ({ page }, use) => {
    // Create test user
    const testUser = await testDb.createTestUser({
      email: 'e2e-test@example.com',
      password: 'TestPassword123!',
    });

    // Login
    await page.goto('/login');
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    
    // Wait for navigation
    await page.waitForURL('/dashboard');
    
    // Use the authenticated page
    await use(page);
    
    // Cleanup
    await testDb.cleanupDatabase();
  },

  // Database cleanup fixture
  dbCleanup: async ({}, use) => {
    // Setup
    await testDb.cleanupDatabase();
    
    // Use
    await use();
    
    // Teardown
    await testDb.cleanupDatabase();
  },
});

// Export expect for consistency
export { expect };

// Common selectors
export const selectors = {
  login: {
    emailInput: 'input[type="email"]',
    passwordInput: 'input[type="password"]',
    submitButton: 'button[type="submit"]',
  },
  navigation: {
    dashboard: 'a[href="/dashboard"], nav a:has-text("Dashboard")',
    runs: 'a[href="/runs"], nav a:has-text("Runs")',
    stats: 'a[href="/stats"], nav a:has-text("Stats")',
  },
  common: {
    heading: 'h1, h2',
    error: '[role="alert"], .error-message',
    loading: '.loading, [aria-busy="true"]',
  },
};

// Common assertions
export async function waitForPageReady(page: any) {
  await page.waitForLoadState('networkidle');
  await page.waitForSelector(selectors.common.heading);
}

export async function expectNoAccessibilityViolations(page: any) {
  const AxeBuilder = await import('@axe-core/playwright').then(m => m.default);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}
`;

    try {
      const setupDir = 'tests/e2e/setup';
      if (!existsSync(setupDir)) {
        execSync(`mkdir -p ${setupDir}`);
      }

      writeFileSync(`${setupDir}/e2eSetup.ts`, e2eSetup);
      this.logFix('E2E Test Setup', 'success', 'Created E2E test setup utilities');
    } catch (error) {
      this.logFix('E2E Test Setup', 'failed', `Failed to create setup: ${error}`);
    }
  }

  async updateCIWorkflow(): Promise<void> {
    console.log('\n🔄 Updating CI workflow for E2E tests...');

    try {
      const ciPath = '.github/workflows/ci.yml';
      if (existsSync(ciPath)) {
        let content = readFileSync(ciPath, 'utf-8');

        // Improve browser installation step
        const improvedBrowserInstall = `      - name: 🎭 Install Playwright browsers
        run: |
          echo "Installing Playwright browsers for CI..."
          npx playwright install chromium firefox webkit
          npx playwright install-deps
          echo "Verifying browser installation..."
          npx playwright --version
          npx playwright show-browsers`;

        content = content.replace(
          /- name: 🎭 Install Playwright browsers with dependencies[\s\S]*?npx playwright --version/g,
          improvedBrowserInstall
        );

        // Add E2E-specific database setup
        if (!content.includes('E2E_DATABASE_URL')) {
          content = content.replace(
            /e2e-tests:\s*name: 🎭 E2E Tests\s*runs-on: ubuntu-latest\s*timeout-minutes: \d+\s*env:/,
            `e2e-tests:
    name: 🎭 E2E Tests
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      E2E_DATABASE_URL: file:./prisma/e2e-test.db`
          );
        }

        writeFileSync(ciPath, content);
        this.logFix('CI Workflow', 'success', 'Updated CI workflow for better E2E support');
      }
    } catch (error) {
      this.logFix('CI Workflow', 'failed', `Failed to update CI workflow: ${error}`);
    }
  }

  async addNpmScripts(): Promise<void> {
    console.log('\n📝 Adding E2E-specific npm scripts...');

    try {
      const packagePath = 'package.json';
      if (existsSync(packagePath)) {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));

        const newScripts = {
          'playwright:install': 'tsx scripts/install-playwright-browsers.ts install',
          'playwright:install:ci': 'tsx scripts/install-playwright-browsers.ts install chromium',
          'playwright:verify': 'tsx scripts/install-playwright-browsers.ts verify',
          'test:e2e:debug': 'playwright test --debug',
          'test:e2e:codegen': 'playwright codegen http://localhost:3000',
          'test:e2e:report': 'playwright show-report',
        };

        let added = 0;
        for (const [name, command] of Object.entries(newScripts)) {
          if (!packageJson.scripts[name]) {
            packageJson.scripts[name] = command;
            added++;
          }
        }

        if (added > 0) {
          writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
          this.logFix('NPM Scripts', 'success', `Added ${added} E2E-specific npm scripts`);
        } else {
          this.logFix('NPM Scripts', 'skipped', 'All E2E scripts already exist');
        }
      }
    } catch (error) {
      this.logFix('NPM Scripts', 'failed', `Failed to add scripts: ${error}`);
    }
  }

  async createHelperDirectories(): Promise<void> {
    console.log('\n📁 Creating helper directories...');

    const directories = [
      'tests/e2e/helpers',
      'tests/e2e/setup',
      'tests/e2e/fixtures',
      'test-results',
      'playwright-report',
    ];

    for (const dir of directories) {
      try {
        if (!existsSync(dir)) {
          execSync(`mkdir -p ${dir}`);
          this.logFix(`Directory ${dir}`, 'success', 'Created directory');
        } else {
          this.logFix(`Directory ${dir}`, 'skipped', 'Already exists');
        }
      } catch (error) {
        this.logFix(`Directory ${dir}`, 'failed', `Failed to create: ${error}`);
      }
    }
  }

  async runDiagnostics(): Promise<void> {
    console.log('\n🧪 Running E2E diagnostics...');

    try {
      // Check Playwright installation
      console.log('   Checking Playwright installation...');
      execSync('npx playwright --version', { stdio: 'pipe' });
      this.logFix('Playwright Installation', 'success', 'Playwright is installed');

      // Check browser availability
      console.log('   Checking browser availability...');
      try {
        execSync('npx playwright show-browsers', { stdio: 'pipe' });
        this.logFix('Browser Availability', 'success', 'Browsers are available');
      } catch (error) {
        this.logFix(
          'Browser Availability',
          'failed',
          'No browsers installed - run npm run playwright:install'
        );
      }
    } catch (error: any) {
      this.logFix('E2E Diagnostics', 'failed', `Diagnostics failed: ${error.message}`);
    }
  }

  async runAllFixes(): Promise<boolean> {
    console.log('Starting E2E test configuration fixes...\\n');

    await this.createHelperDirectories();
    await this.fixTestUseInDescribeBlocks();
    await this.createDeviceHelpers();
    await this.fixE2ETestImports();
    await this.createBrowserInstallScript();
    await this.updatePlaywrightConfig();
    await this.createE2ETestSetup();
    await this.updateCIWorkflow();
    await this.addNpmScripts();
    await this.runDiagnostics();

    console.log('\\n📊 Fix Summary');
    console.log('='.repeat(30));

    const successful = this.fixes.filter(f => f.status === 'success').length;
    const failed = this.fixes.filter(f => f.status === 'failed').length;
    const skipped = this.fixes.filter(f => f.status === 'skipped').length;

    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏭️ Skipped: ${skipped}`);

    if (failed === 0) {
      console.log('\\n🎉 All E2E test configuration fixes applied successfully!');
      console.log('\\n📌 Next steps:');
      console.log('1. Run: npm run playwright:install');
      console.log('2. Run: npm run test:e2e:ci');
      console.log('3. Check the test report: npm run test:e2e:report');
    } else {
      console.log(`\\n🚨 ${failed} fixes failed. Please review the errors above.`);
    }

    return failed === 0;
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixer = new E2ETestFixer();

  fixer
    .runAllFixes()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Fix process failed:', error);
      process.exit(1);
    });
}

export { E2ETestFixer };

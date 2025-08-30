#!/usr/bin/env tsx

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
      execSync(`npx playwright install --with-deps ${browserList}`, {
        stdio: 'inherit',
        timeout: 300000, // 5 minute timeout
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
if (import.meta.url === `file://${process.argv[1]}`) {
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

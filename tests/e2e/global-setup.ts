/**
 * Playwright Global Setup
 * Runs once before all test suites
 */

import { chromium, FullConfig } from '@playwright/test';
import { ensurePrismaClient } from '../setup/prismaSetup';

async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting E2E global setup...');

  // Ensure Prisma client is generated for E2E tests
  console.log('🔧 Ensuring Prisma client is available for E2E tests...');
  await ensurePrismaClient();

  // Start browser for warmup
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Warmup: Navigate to base URL to ensure server is ready
    const baseURL = config.projects[0].use?.baseURL || 'http://localhost:3000';
    console.log(`🌡️  Warming up server at ${baseURL}...`);

    await page.goto(baseURL, {
      waitUntil: 'networkidle',
      timeout: 60000, // Give server time to start
    });

    console.log('✅ Server is ready for tests');
  } catch (error) {
    console.warn('⚠️  Server warmup failed:', error);
    // Continue anyway - the webServer should handle server startup
  } finally {
    await context.close();
    await browser.close();
  }

  console.log('✅ E2E global setup complete');
}

export default globalSetup;

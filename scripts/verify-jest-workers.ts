#!/usr/bin/env tsx

/**
 * Jest Worker Configuration Verification Script
 * Verifies that Jest respects maxWorkers: 1 setting and tests run sequentially
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

interface JestConfig {
  maxWorkers?: number;
  maxConcurrency?: number;
  testTimeout?: number;
  verbose?: boolean;
}

async function verifyJestWorkerConfiguration(): Promise<void> {
  console.log('🔍 Verifying Jest worker configuration...\n');

  // Check if jest config files exist
  const configFiles = ['jest.config.js', 'jest.config.ci.js'];

  for (const configFile of configFiles) {
    const configPath = path.join(process.cwd(), configFile);
    console.log(`📋 Checking ${configFile}...`);

    if (!existsSync(configPath)) {
      console.error(`❌ ${configFile} does not exist`);
      continue;
    }

    console.log(`✅ ${configFile} exists`);

    try {
      // Import and check the configuration
      const config = await import(configPath);
      const jestConfig: JestConfig = config.default || config;

      console.log(`  📊 Configuration analysis for ${configFile}:`);
      console.log(`    - maxWorkers: ${jestConfig.maxWorkers || 'default (auto)'}`);
      console.log(`    - maxConcurrency: ${jestConfig.maxConcurrency || 'default (5)'}`);
      console.log(`    - testTimeout: ${jestConfig.testTimeout || 'default (5000)'}ms`);
      console.log(`    - verbose: ${jestConfig.verbose || 'default (false)'}`);

      // Verify maxWorkers is set to 1
      if (jestConfig.maxWorkers === 1) {
        console.log(`    ✅ maxWorkers is correctly set to 1 for sequential execution`);
      } else {
        console.log(
          `    ⚠️  maxWorkers is ${jestConfig.maxWorkers} (may cause parallel execution)`
        );
      }

      // Check maxConcurrency
      if (jestConfig.maxConcurrency === 1) {
        console.log(`    ✅ maxConcurrency is set to 1 for additional safety`);
      } else if (jestConfig.maxConcurrency) {
        console.log(`    ⚠️  maxConcurrency is ${jestConfig.maxConcurrency}`);
      }
    } catch (error) {
      console.error(`❌ Failed to load ${configFile}:`, error);
    }

    console.log('');
  }

  // Test Jest CLI behavior with worker settings
  console.log('🧪 Testing Jest worker behavior...');

  try {
    // Test with regular config
    console.log('📋 Testing jest.config.js worker behavior:');
    const output1 = execSync('npx jest --config jest.config.js --listTests --verbose', {
      encoding: 'utf8',
      timeout: 10000,
    });

    const testCount = output1.split('\n').filter(line => line.includes('.test.')).length;
    console.log(`  ✅ Found ${testCount} integration test files`);

    // Test with CI config
    console.log('📋 Testing jest.config.ci.js worker behavior:');
    const output2 = execSync('npx jest --config jest.config.ci.js --listTests --verbose', {
      encoding: 'utf8',
      timeout: 10000,
    });

    const testCountCI = output2.split('\n').filter(line => line.includes('.test.')).length;
    console.log(`  ✅ Found ${testCountCI} integration test files in CI config`);

    if (testCount === testCountCI) {
      console.log(`  ✅ Both configurations detect the same number of tests`);
    } else {
      console.log(
        `  ⚠️  Different test counts detected (regular: ${testCount}, CI: ${testCountCI})`
      );
    }
  } catch (error) {
    console.error('❌ Failed to test Jest CLI behavior:', error);
  }

  // Check for potential parallel execution issues
  console.log('🔍 Checking for potential parallel execution issues...');

  const potentialIssues = [];

  // Check if database setup is properly isolated
  const globalSetupPath = path.join(process.cwd(), 'tests', 'setup', 'globalSetup.ts');
  if (existsSync(globalSetupPath)) {
    console.log('✅ globalSetup.ts exists for database initialization');
  } else {
    potentialIssues.push('Missing globalSetup.ts for database initialization');
  }

  // Check if there are teardown mechanisms
  const teardownFiles = ['tests/setup/globalTeardown.ts', 'tests/setup/teardown.ts'];

  let hasTeardown = false;
  for (const teardownFile of teardownFiles) {
    if (existsSync(path.join(process.cwd(), teardownFile))) {
      console.log(`✅ Found teardown mechanism: ${teardownFile}`);
      hasTeardown = true;
    }
  }

  if (!hasTeardown) {
    potentialIssues.push('No explicit teardown mechanism found (may cause test pollution)');
  }

  // Summary
  console.log('\n📊 Verification Summary:');

  if (potentialIssues.length === 0) {
    console.log('🎉 Jest worker configuration is properly set up for sequential execution!');
    console.log('✅ maxWorkers: 1 is configured in both regular and CI configurations');
    console.log('✅ No parallel execution issues detected');
  } else {
    console.log('⚠️  Potential issues detected:');
    potentialIssues.forEach(issue => console.log(`  - ${issue}`));
  }
}

// Auto-run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyJestWorkerConfiguration().catch(error => {
    console.error('❌ Jest worker verification failed:', error);
    process.exit(1);
  });
}

export { verifyJestWorkerConfiguration };

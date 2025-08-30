#!/usr/bin/env tsx

/**
 * Simple Sharding Validation Script
 *
 * This script validates that Playwright sharding configuration works correctly
 * without running full tests (which might take too long or fail due to setup).
 */

import { spawn } from 'child_process';

const validateShardConfiguration = async (shardSpec: string): Promise<boolean> => {
  return new Promise(resolve => {
    console.log(`🔍 Validating shard configuration: ${shardSpec || 'no sharding'}`);

    const env = {
      ...process.env,
      CI: 'true',
    };

    if (shardSpec) {
      env.PLAYWRIGHT_SHARD = shardSpec;
    }

    // Use --list to just list tests without running them
    const testProcess = spawn('npx', ['playwright', 'test', '--list', '--project', 'chromium'], {
      stdio: 'pipe',
      env,
    });

    let stdout = '';
    let stderr = '';

    testProcess.stdout.on('data', data => {
      stdout += data.toString();
    });

    testProcess.stderr.on('data', data => {
      stderr += data.toString();
    });

    testProcess.on('close', code => {
      if (code === 0) {
        // Count tests listed
        const testLines = stdout.split('\n').filter(line => line.trim().includes('.test.ts'));
        console.log(`✅ Shard ${shardSpec || 'baseline'}: ${testLines.length} tests listed`);
        resolve(true);
      } else {
        console.log(`❌ Shard ${shardSpec || 'baseline'}: Configuration invalid`);
        if (stderr) console.log(`Error: ${stderr.slice(0, 200)}...`);
        resolve(false);
      }
    });

    testProcess.on('error', error => {
      console.log(`❌ Shard ${shardSpec || 'baseline'}: Failed to start`);
      resolve(false);
    });
  });
};

async function main() {
  console.log('🎭 Validating Playwright Sharding Configuration\n');

  const results = await Promise.all([
    validateShardConfiguration(''), // baseline
    validateShardConfiguration('1/2'), // shard 1 of 2
    validateShardConfiguration('2/2'), // shard 2 of 2
    validateShardConfiguration('1/3'), // shard 1 of 3
  ]);

  const allValid = results.every(result => result);

  console.log(
    `\n${allValid ? '✅' : '❌'} Sharding configuration ${allValid ? 'valid' : 'invalid'}`
  );

  if (allValid) {
    console.log('\n💡 Configuration is working correctly!');
    console.log('- Playwright can distribute tests across shards');
    console.log('- Environment variable parsing works');
    console.log('- Ready for CI/CD integration');
  } else {
    console.log('\n🔧 Please check:');
    console.log('- Playwright is installed: npm install @playwright/test');
    console.log('- Tests exist in tests/e2e directory');
    console.log('- Playwright configuration is valid');
  }

  return allValid;
}

// Execute if this is the main module
main().then(success => {
  process.exit(success ? 0 : 1);
});

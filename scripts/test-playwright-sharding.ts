#!/usr/bin/env tsx

/**
 * Playwright Sharding Test Script
 *
 * This script tests Playwright sharding configuration and demonstrates
 * how to run E2E tests in parallel across multiple shards.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

interface ShardResult {
  shard: string;
  duration: number;
  testCount: number;
  passed: number;
  failed: number;
  status: 'success' | 'failed';
}

const runPlaywrightShard = (shardSpec: string, projectName?: string): Promise<ShardResult> => {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Starting shard ${shardSpec}${projectName ? ` for ${projectName}` : ''}...`);

    const startTime = Date.now();
    const env = {
      ...process.env,
      PLAYWRIGHT_SHARD: shardSpec,
      CI: 'true', // Force CI mode for consistent behavior
    };

    const args = ['run', 'test:e2e'];
    if (projectName) {
      args.push('--', '--project', projectName);
    }

    const testProcess = spawn('npm', args, {
      stdio: 'pipe',
      env,
    });

    let stdout = '';
    let stderr = '';

    testProcess.stdout.on('data', data => {
      const output = data.toString();
      stdout += output;
      // Log real-time output for this shard
      process.stdout.write(`[Shard ${shardSpec}] ${output}`);
    });

    testProcess.stderr.on('data', data => {
      stderr += data.toString();
    });

    testProcess.on('close', code => {
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Parse test results from output
      const passedMatch = stdout.match(/(\d+) passed/);
      const failedMatch = stdout.match(/(\d+) failed/);
      const testCountMatch = stdout.match(/(\d+) tests?/);

      const result: ShardResult = {
        shard: shardSpec,
        duration,
        testCount: testCountMatch ? parseInt(testCountMatch[1], 10) : 0,
        passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
        failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
        status: code === 0 ? 'success' : 'failed',
      };

      console.log(`✅ Shard ${shardSpec} completed in ${duration}ms`);
      resolve(result);
    });

    testProcess.on('error', error => {
      console.error(`❌ Failed to start shard ${shardSpec}:`, error);
      reject(error);
    });
  });
};

const testShardingConfiguration = async () => {
  console.log('🎭 Testing Playwright Sharding Configuration\n');

  // Test 1: Run without sharding (baseline)
  console.log('📊 Baseline Test (No Sharding)');
  console.log('================================');

  const baselineStart = Date.now();
  try {
    // Run baseline without sharding by not setting PLAYWRIGHT_SHARD
    const baselineResult = await new Promise<ShardResult>((resolve, reject) => {
      console.log('🚀 Starting baseline test for chromium...');

      const startTime = Date.now();
      const env = {
        ...process.env,
        CI: 'true',
        // Don't set PLAYWRIGHT_SHARD for baseline
      };
      delete env.PLAYWRIGHT_SHARD;

      const testProcess = spawn('npm', ['run', 'test:e2e', '--', '--project', 'chromium'], {
        stdio: 'pipe',
        env,
      });

      let stdout = '';
      let stderr = '';

      testProcess.stdout.on('data', data => {
        const output = data.toString();
        stdout += output;
        process.stdout.write(`[Baseline] ${output}`);
      });

      testProcess.stderr.on('data', data => {
        stderr += data.toString();
      });

      testProcess.on('close', code => {
        const endTime = Date.now();
        const duration = endTime - startTime;

        const passedMatch = stdout.match(/(\d+) passed/);
        const failedMatch = stdout.match(/(\d+) failed/);
        const testCountMatch = stdout.match(/(\d+) tests?/);

        const result: ShardResult = {
          shard: 'baseline',
          duration,
          testCount: testCountMatch ? parseInt(testCountMatch[1], 10) : 0,
          passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
          failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
          status: code === 0 ? 'success' : 'failed',
        };

        console.log(`✅ Baseline completed in ${duration}ms`);
        resolve(result);
      });

      testProcess.on('error', error => {
        console.error(`❌ Failed to start baseline test:`, error);
        reject(error);
      });
    });
    const baselineEnd = Date.now();

    console.log(`\n📈 Baseline Results:`);
    console.log(`Duration: ${baselineResult.duration}ms`);
    console.log(`Tests: ${baselineResult.testCount}`);
    console.log(`Status: ${baselineResult.status}\n`);

    // Test 2: Run with 2 shards
    console.log('🔀 Sharded Test (2 Shards)');
    console.log('===========================');

    const shardStart = Date.now();
    const shardPromises = [
      runPlaywrightShard('1/2', 'chromium'),
      runPlaywrightShard('2/2', 'chromium'),
    ];

    const shardResults = await Promise.all(shardPromises);
    const shardEnd = Date.now();

    console.log(`\n📈 Sharded Results:`);
    shardResults.forEach(result => {
      console.log(
        `Shard ${result.shard}: ${result.duration}ms, ${result.testCount} tests, ${result.status}`
      );
    });

    const totalShardTime = shardEnd - shardStart;
    const totalTests = shardResults.reduce((sum, result) => sum + result.testCount, 0);
    const totalPassed = shardResults.reduce((sum, result) => sum + result.passed, 0);
    const totalFailed = shardResults.reduce((sum, result) => sum + result.failed, 0);

    console.log(`\nTotal parallel execution time: ${totalShardTime}ms`);
    console.log(`Total tests executed: ${totalTests}`);
    console.log(`Total passed: ${totalPassed}`);
    console.log(`Total failed: ${totalFailed}`);

    // Performance comparison
    const improvementMs = baselineResult.duration - totalShardTime;
    const improvementPercent = (improvementMs / baselineResult.duration) * 100;

    console.log(`\n🚀 Performance Improvement:`);
    if (improvementMs > 0) {
      console.log(`Time saved: ${improvementMs}ms (${improvementPercent.toFixed(1)}% faster)`);
    } else {
      console.log(`Sharding overhead: ${Math.abs(improvementMs)}ms`);
    }

    return {
      baseline: baselineResult,
      shards: shardResults,
      improvement: improvementPercent,
    };
  } catch (error) {
    console.error('❌ Sharding test failed:', error);
    throw error;
  }
};

const demonstrateShardDistribution = async () => {
  console.log('\n🎯 Shard Distribution Examples\n');

  console.log('Example 1: 2 Shards');
  console.log('PLAYWRIGHT_SHARD=1/2 npm run test:e2e');
  console.log('PLAYWRIGHT_SHARD=2/2 npm run test:e2e');

  console.log('\nExample 2: 3 Shards');
  console.log('PLAYWRIGHT_SHARD=1/3 npm run test:e2e');
  console.log('PLAYWRIGHT_SHARD=2/3 npm run test:e2e');
  console.log('PLAYWRIGHT_SHARD=3/3 npm run test:e2e');

  console.log('\nExample 3: Browser-specific sharding');
  console.log('PLAYWRIGHT_SHARD=1/2 npm run test:e2e -- --project chromium');
  console.log('PLAYWRIGHT_SHARD=2/2 npm run test:e2e -- --project chromium');

  console.log('\nCI Environment Variables:');
  console.log('export PLAYWRIGHT_SHARD=1/2');
  console.log('export CI=true');
  console.log('npm run test:e2e');
};

const createShardingDocumentation = async () => {
  const docContent = `# Playwright Sharding Configuration

## Overview
Playwright sharding allows distributing E2E tests across multiple parallel processes, reducing overall test execution time.

## Configuration

### Environment Variables
- \`PLAYWRIGHT_SHARD\`: Shard specification in format "current/total" (e.g., "1/2", "2/3")
- \`CI\`: Set to "true" to enable CI-optimized settings

### Usage Examples

#### Local Testing with Shards
\`\`\`bash
# Run shard 1 of 2
PLAYWRIGHT_SHARD=1/2 npm run test:e2e

# Run shard 2 of 2  
PLAYWRIGHT_SHARD=2/2 npm run test:e2e
\`\`\`

#### CI/CD Integration
\`\`\`yaml
# GitHub Actions example
strategy:
  matrix:
    shard: [1/3, 2/3, 3/3]
env:
  PLAYWRIGHT_SHARD: \${{ matrix.shard }}
run: npm run test:e2e
\`\`\`

#### Browser-Specific Sharding
\`\`\`bash
# Shard chromium tests only
PLAYWRIGHT_SHARD=1/2 npm run test:e2e -- --project chromium
\`\`\`

## Configuration Details

### Workers per Shard
- CI with sharding: 2 workers per shard
- CI without sharding: 1 worker
- Local: Default worker count (usually CPU cores / 2)

### Test Distribution
Tests are automatically distributed across shards based on:
- File-level distribution
- Estimated execution time
- Test dependencies

## Performance Benefits

Typical improvements with sharding:
- 2 shards: 40-60% faster execution
- 3 shards: 50-70% faster execution
- 4+ shards: Diminishing returns due to overhead

## Best Practices

1. **Optimal Shard Count**: Start with 2-3 shards, measure performance
2. **CI Resource Limits**: Consider available CPU/memory in CI environment
3. **Test Isolation**: Ensure tests don't have cross-dependencies
4. **Flaky Test Handling**: Use retries for unreliable tests

## Troubleshooting

### Common Issues
- **Uneven distribution**: Some shards finish much faster than others
- **Resource contention**: Too many workers causing instability
- **Test dependencies**: Tests failing when run in isolation

### Solutions
- Adjust shard count based on test suite size
- Monitor CI resource usage
- Ensure proper test isolation
- Use test annotations for ordering when necessary

## Monitoring

Track these metrics:
- Total execution time per shard
- Test distribution across shards
- Failure rates by shard
- Resource utilization
`;

  await fs.writeFile(path.join(process.cwd(), 'tests/docs/PLAYWRIGHT_SHARDING.md'), docContent);

  console.log('📝 Created documentation: tests/docs/PLAYWRIGHT_SHARDING.md');
};

// Main execution
async function main() {
  try {
    console.log('🎭 Playwright Sharding Configuration Test\n');

    // Test the sharding configuration
    const results = await testShardingConfiguration();

    // Show distribution examples
    demonstrateShardDistribution();

    // Create documentation
    await createShardingDocumentation();

    console.log('\n✅ Playwright sharding configuration completed successfully!');
    console.log('\n💡 Next Steps:');
    console.log('- Update CI/CD pipeline to use PLAYWRIGHT_SHARD environment variable');
    console.log('- Test with different shard counts (2, 3, 4) to find optimal performance');
    console.log('- Monitor resource usage and adjust worker count as needed');
    console.log('- Consider browser-specific sharding for large test suites');
  } catch (error) {
    console.error('❌ Sharding configuration test failed:', error);
    process.exit(1);
  }
}

// Execute if this is the main module
main();

export { testShardingConfiguration, runPlaywrightShard };

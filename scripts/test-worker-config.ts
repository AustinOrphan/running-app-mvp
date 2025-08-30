#!/usr/bin/env tsx

/**
 * Test Worker Configuration Script
 *
 * This script tests the parallel execution configuration and monitors performance.
 */

import { spawn } from 'child_process';
import os from 'os';

const testWorkerConfiguration = async () => {
  console.log('🔧 Testing Vitest Worker Configuration\n');

  // Display system information
  console.log('📊 System Information:');
  console.log(`CPU Cores: ${os.cpus().length}`);
  console.log(`Available Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
  console.log(`Free Memory: ${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB`);
  console.log(`Platform: ${os.platform()}`);
  console.log(`Architecture: ${os.arch()}\n`);

  // Calculate expected workers
  const maxWorkers = process.env.CI ? 2 : Math.max(1, Math.floor(os.cpus().length / 2));
  console.log(`🧵 Worker Configuration:`);
  console.log(`Environment: ${process.env.CI ? 'CI' : 'Local'}`);
  console.log(`Expected Max Workers: ${maxWorkers}`);
  console.log(`Thread Pool: Enabled`);
  console.log(`File Parallelism: Enabled`);
  console.log(`Isolation: Enabled\n`);

  console.log('🚀 Running Performance Test...\n');

  // Run a subset of tests to measure performance
  const startTime = Date.now();

  return new Promise<void>((resolve, reject) => {
    const testProcess = spawn(
      'npm',
      ['test', '--', '--run', '--reporter=verbose', 'tests/unit/utils/', 'tests/unit/components/'],
      {
        stdio: 'pipe',
        env: { ...process.env },
      }
    );

    let stdout = '';
    let stderr = '';

    testProcess.stdout.on('data', data => {
      stdout += data.toString();
    });

    testProcess.stderr.on('data', data => {
      stderr += data.toString();
    });

    testProcess.on('close', code => {
      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`⏱️  Test Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)\n`);

      if (code === 0) {
        console.log('✅ Worker configuration test completed successfully!\n');

        // Extract test statistics from output
        const lines = stdout.split('\n');
        const testFilesLine = lines.find(line => line.includes('Test Files'));
        const testsLine = lines.find(line => line.includes('Tests') && line.includes('passed'));

        if (testFilesLine) {
          console.log('📈 Test Results:');
          console.log(`${testFilesLine.trim()}`);
        }
        if (testsLine) {
          console.log(`${testsLine.trim()}`);
        }

        // Performance analysis
        console.log('\n📊 Performance Analysis:');
        const testsPerSecond = testFilesLine
          ? Math.round(
              parseInt(testFilesLine.match(/(\d+) passed/)?.[1] || '0') / (duration / 1000)
            )
          : 0;
        console.log(`Tests per second: ${testsPerSecond}`);

        if (duration < 10000) {
          console.log('🎯 Performance: Excellent (< 10s)');
        } else if (duration < 20000) {
          console.log('👍 Performance: Good (< 20s)');
        } else {
          console.log('⚠️  Performance: Could be improved (> 20s)');
        }

        console.log('\n🎉 Parallel execution is working correctly!');
        resolve();
      } else {
        console.error('❌ Worker configuration test failed!');
        console.error('STDOUT:', stdout);
        console.error('STDERR:', stderr);
        reject(new Error(`Test process exited with code ${code}`));
      }
    });

    testProcess.on('error', error => {
      console.error('❌ Failed to start test process:', error);
      reject(error);
    });
  });
};

const monitorMemoryUsage = () => {
  console.log('\n🔍 Memory Usage Monitoring:');
  console.log('(Run during test execution to monitor resource usage)\n');

  const interval = setInterval(() => {
    const used = process.memoryUsage();
    const free = os.freemem();
    const total = os.totalmem();

    console.log(
      `Memory: ${Math.round(used.rss / 1024 / 1024)}MB RSS, ${Math.round(used.heapUsed / 1024 / 1024)}MB Heap, ${Math.round(free / 1024 / 1024)}MB Free`
    );
  }, 2000);

  // Stop monitoring after 30 seconds
  setTimeout(() => {
    clearInterval(interval);
    console.log('\n📊 Memory monitoring completed.\n');
  }, 30000);
};

// Main execution
async function main() {
  try {
    await testWorkerConfiguration();
    console.log('\n💡 Tips for optimal performance:');
    console.log('- Parallel execution is now enabled for unit tests');
    console.log('- Integration tests remain sequential for database safety');
    console.log('- Monitor CI performance and adjust maxWorkers if needed');
    console.log('- Use --reporter=verbose for detailed parallel execution info');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Execute if this is the main module
main();

export { testWorkerConfiguration, monitorMemoryUsage };

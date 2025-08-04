#!/usr/bin/env node

/**
 * Validation script to test if our fixes for test order dependencies work correctly
 * This script runs the same integration tests multiple times in different orders
 * to ensure they pass consistently regardless of execution order.
 */

const { exec } = require('child_process');
// const path = require('path'); // Not used in this script

const testFiles = [
  'tests/integration/api/goals.test.ts',
  'tests/integration/api/runs.test.ts',
  'tests/integration/api/auth.test.ts',
];

async function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function runTestsInOrder(order) {
  console.log(`\n🧪 Running tests in order: ${order.join(' → ')}`);

  try {
    const cmd = `npm run test:integration -- ${order.join(' ')} --runInBand --verbose --bail`;
    await runCommand(cmd);
    console.log(`✅ Order ${order.join(' → ')} - PASSED`);
    return true;
  } catch (err) {
    console.log(`❌ Order ${order.join(' → ')} - FAILED`);
    console.log('Error:', err.stderr || err.stdout || err.error.message);
    return false;
  }
}

async function validateTestOrderIndependence() {
  console.log('🔍 Validating Test Order Independence');
  console.log('=====================================');
  console.log('This validates that our fixes for test order dependencies work correctly.\n');

  // Different test execution orders to validate
  const testOrders = [
    testFiles, // Original order
    [...testFiles].reverse(), // Reverse order
    [testFiles[1], testFiles[0], testFiles[2]], // Mixed order 1
    [testFiles[2], testFiles[1], testFiles[0]], // Mixed order 2
  ];

  let passCount = 0;
  const totalRuns = testOrders.length;

  for (let i = 0; i < testOrders.length; i++) {
    const success = await runTestsInOrder(testOrders[i]);
    if (success) passCount++;

    // Small delay between test runs
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n📊 Results Summary`);
  console.log(`=================`);
  console.log(`Passed: ${passCount}/${totalRuns} execution orders`);
  console.log(`Success Rate: ${((passCount / totalRuns) * 100).toFixed(1)}%`);

  if (passCount === totalRuns) {
    console.log(`\n🎉 SUCCESS: All test orders passed! Test order dependencies have been fixed.`);
    process.exit(0);
  } else {
    console.log(
      `\n❌ FAILURE: ${totalRuns - passCount} test orders failed. Order dependencies still exist.`
    );
    process.exit(1);
  }
}

// Run validation
validateTestOrderIndependence().catch(err => {
  console.error('Validation script error:', err);
  process.exit(1);
});

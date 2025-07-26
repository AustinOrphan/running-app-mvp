#!/usr/bin/env node

/**
 * Simple script to run test performance analysis
 * Works around shell environment issues
 */

const { spawn } = require('child_process');
const path = require('path');

// Run the TypeScript file using the installed tsx from node_modules
const tsxPath = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx');
const scriptPath = path.join(__dirname, 'analyze-test-performance.ts');

const child = spawn(tsxPath, [scriptPath], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    CI: 'true',
  },
});

child.on('error', error => {
  console.error('Failed to start performance analysis:', error);
  process.exit(1);
});

child.on('exit', code => {
  process.exit(code);
});

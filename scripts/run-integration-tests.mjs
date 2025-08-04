#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Check if Prisma client is generated
function checkPrismaClient() {
  const clientPath = join(projectRoot, 'node_modules', '@prisma', 'client');
  const clientExists = existsSync(clientPath);
  const indexExists =
    existsSync(join(clientPath, 'index.js')) || existsSync(join(clientPath, 'index.d.ts'));

  return clientExists && indexExists;
}

// Ensure Prisma client is generated
async function ensurePrismaClient() {
  console.log('🔧 Checking Prisma client...');

  if (checkPrismaClient()) {
    console.log('✅ Prisma client already available');
    return;
  }

  console.log('🔧 Generating Prisma client...');

  try {
    execSync('npx prisma generate', {
      stdio: 'inherit',
      timeout: 60000, // 1 minute timeout
      cwd: projectRoot,
    });

    console.log('✅ Prisma client generated successfully');
  } catch (error) {
    console.error('❌ Failed to generate Prisma client:', error);
    throw error;
  }
}

// Check if Jest is available
async function checkJestAvailable() {
  try {
    const jestPath = join(projectRoot, 'node_modules', '.bin', 'jest');
    return existsSync(jestPath);
  } catch {
    return false;
  }
}

// Run tests using npx
async function runTestsWithNpx() {
  console.log('📦 Running integration tests with npx...');

  const args = [
    'jest',
    '--config',
    'jest.config.js',
    '--runInBand', // Run tests sequentially
    '--forceExit', // Force exit after tests complete
    '--detectOpenHandles', // Detect handles keeping process alive
  ];

  // Add any additional arguments passed to this script
  const additionalArgs = process.argv.slice(2);

  // Filter out conflicting arguments to avoid "Both --runInBand and --maxWorkers" error
  const filteredArgs = additionalArgs.filter(
    arg => !arg.startsWith('--maxWorkers') && !arg.startsWith('--workers')
  );

  if (filteredArgs.length > 0) {
    args.push(...filteredArgs);
  }

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    NODE_OPTIONS: '--experimental-vm-modules',
  };

  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });

    child.on('close', code => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Tests failed with exit code ${code}`));
      }
    });

    child.on('error', error => {
      reject(error);
    });
  });
}

// Run tests using local Jest installation
async function runTestsWithLocalJest() {
  console.log('🚀 Running integration tests with local Jest...');

  const jestPath = join(projectRoot, 'node_modules', '.bin', 'jest');
  const args = ['--config', 'jest.config.js', '--runInBand', '--forceExit', '--detectOpenHandles'];

  // Add any additional arguments passed to this script
  const additionalArgs = process.argv.slice(2);

  // Filter out conflicting arguments to avoid "Both --runInBand and --maxWorkers" error
  const filteredArgs = additionalArgs.filter(
    arg => !arg.startsWith('--maxWorkers') && !arg.startsWith('--workers')
  );

  if (filteredArgs.length > 0) {
    args.push(...filteredArgs);
  }

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    NODE_OPTIONS: '--experimental-vm-modules',
  };

  return new Promise((resolve, reject) => {
    const child = spawn(jestPath, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });

    child.on('close', code => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Tests failed with exit code ${code}`));
      }
    });

    child.on('error', error => {
      reject(error);
    });
  });
}

// Ensure test database exists
async function ensureTestDatabase() {
  console.log('🗄️  Ensuring test database is set up...');

  const setupScript = join(projectRoot, 'scripts', 'setup-test-db.ts');
  if (existsSync(setupScript)) {
    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['tsx', setupScript], {
        cwd: projectRoot,
        stdio: 'inherit',
      });

      child.on('close', code => {
        if (code === 0) {
          console.log('✅ Test database ready');
          resolve(code);
        } else {
          reject(new Error(`Database setup failed with exit code ${code}`));
        }
      });

      child.on('error', reject);
    });
  } else {
    console.log('⚠️  No database setup script found, skipping...');
  }
}

// Main execution
async function main() {
  console.log('🧪 Integration Test Runner');
  console.log('========================\n');

  try {
    // Step 1: Ensure Prisma client is available
    await ensurePrismaClient();
    console.log('');

    // Step 2: Setup test database
    await ensureTestDatabase();
    console.log('');

    // Step 3: Check if Jest is available locally
    const jestAvailable = await checkJestAvailable();

    // Step 4: Run tests
    if (jestAvailable) {
      await runTestsWithLocalJest();
    } else {
      await runTestsWithNpx();
    }

    console.log('\n✅ Integration tests completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Integration tests failed:');
    console.error(error.message);
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the tests
main();

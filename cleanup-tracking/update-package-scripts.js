#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simplified scripts to replace the current 200+ scripts
const simplifiedScripts = {
  // Development
  dev: 'concurrently "npm:dev:*"',
  'dev:frontend': 'vite',
  'dev:backend': 'tsx watch src/server/index.ts',

  // Building
  build: 'vite build',
  start: 'node dist/server/index.js',
  preview: 'vite preview',

  // Testing (8 scripts instead of 98)
  test: 'vitest',
  'test:ui': 'vitest --ui',
  'test:coverage': 'vitest run --coverage',
  'test:e2e': 'playwright test',
  'test:e2e:ui': 'playwright test --ui',
  'test:performance': 'lhci autorun',
  'test:all': 'npm run test:coverage && npm run test:e2e',
  'test:debug': 'vitest --inspect-brk',

  // Code Quality
  lint: 'eslint .',
  'lint:fix': 'eslint . --fix',
  format: 'prettier --write .',
  typecheck: 'tsc --noEmit',

  // Database
  'db:migrate': 'prisma migrate dev',
  'db:generate': 'prisma generate',
  'db:studio': 'prisma studio',
  'db:seed': 'tsx prisma/seed.ts',

  // Setup & Maintenance
  setup: 'npm install && npm run db:migrate && npm run db:generate',
  clean: 'rm -rf node_modules dist coverage .cache',
  fresh: 'npm run clean && npm run setup',

  // Combined Commands
  quality: 'npm run lint && npm run typecheck && npm run format',
  ci: 'npm run quality && npm run test:coverage && npm run test:e2e',

  // Git hooks
  prepare: 'husky',
};

function updatePackageScripts() {
  const packageJsonPath = path.join(__dirname, '../package.json');
  const backupPath = path.join(__dirname, '../package.json.pre-simplification');

  console.log('📦 Package.json Script Simplification');
  console.log('=====================================');

  try {
    // Read current package.json
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    // Count current scripts
    const currentScriptCount = Object.keys(packageJson.scripts || {}).length;
    const newScriptCount = Object.keys(simplifiedScripts).length;

    console.log(`📊 Current scripts: ${currentScriptCount}`);
    console.log(`📊 New scripts: ${newScriptCount}`);
    console.log(
      `📉 Reduction: ${currentScriptCount - newScriptCount} scripts (${Math.round(((currentScriptCount - newScriptCount) / currentScriptCount) * 100)}%)`
    );

    // Create backup
    fs.writeFileSync(backupPath, JSON.stringify(packageJson, null, 2));
    console.log(`💾 Backup created: package.json.pre-simplification`);

    // Update scripts
    packageJson.scripts = simplifiedScripts;

    // Write updated package.json
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

    console.log('✅ Package.json updated successfully!');
    console.log('');
    console.log('🎯 New Essential Scripts:');
    console.log('------------------------');

    // Group and display scripts
    const groups = {
      Development: ['dev', 'dev:frontend', 'dev:backend'],
      Building: ['build', 'start', 'preview'],
      Testing: [
        'test',
        'test:ui',
        'test:coverage',
        'test:e2e',
        'test:e2e:ui',
        'test:performance',
        'test:all',
        'test:debug',
      ],
      Quality: ['lint', 'lint:fix', 'format', 'typecheck'],
      Database: ['db:migrate', 'db:generate', 'db:studio', 'db:seed'],
      Setup: ['setup', 'clean', 'fresh'],
      Combined: ['quality', 'ci', 'prepare'],
    };

    Object.entries(groups).forEach(([groupName, scripts]) => {
      console.log(`\n${groupName}:`);
      scripts.forEach(script => {
        if (simplifiedScripts[script]) {
          console.log(`  npm run ${script}`);
        }
      });
    });

    console.log('');
    console.log('💡 Quick Reference:');
    console.log('  npm run dev        # Start development servers');
    console.log('  npm run test:all   # Run all tests');
    console.log('  npm run quality    # Run all quality checks');
    console.log('  npm run ci         # Full CI pipeline');
    console.log('');
  } catch (error) {
    console.error('❌ Error updating package.json:', error.message);
    process.exit(1);
  }
}

// Run the update
updatePackageScripts();

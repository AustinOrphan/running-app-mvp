#!/usr/bin/env tsx

/**
 * Setup script for Git hooks
 * This script ensures that Git hooks are properly installed and configured
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const HOOKS_DIR = '.husky';

console.log('🔧 Setting up Git hooks...\n');

try {
  // Check if husky is installed
  try {
    execSync('npx husky --version', { stdio: 'ignore' });
  } catch {
    console.error('❌ Husky is not installed. Please run: npm install');
    process.exit(1);
  }

  // Initialize husky if not already initialized
  if (!fs.existsSync(HOOKS_DIR)) {
    console.log('📁 Initializing husky...');
    execSync('npx husky init', { stdio: 'inherit' });
  }

  // Make hooks executable
  const hooksPath = path.join(process.cwd(), HOOKS_DIR);
  if (fs.existsSync(hooksPath)) {
    const hooks = fs.readdirSync(hooksPath).filter(file => file !== '_');
    hooks.forEach(hook => {
      const hookPath = path.join(hooksPath, hook);
      fs.chmodSync(hookPath, '755');
      console.log(`✅ Made ${hook} executable`);
    });
  }

  // Verify lint-staged configuration
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (!packageJson['lint-staged']) {
    console.error('❌ lint-staged configuration not found in package.json');
    process.exit(1);
  }

  console.log('\n✅ Git hooks setup complete!');
  console.log('\n📋 Pre-commit hook will run:');
  console.log('   - ESLint (with auto-fix)');
  console.log('   - Prettier (with auto-format)');
  console.log('   - Tests for affected files');
  console.log('   - TypeScript type checking');
  
  console.log('\n💡 To skip hooks temporarily, use: git commit --no-verify');
  console.log('💡 To test hooks manually, run: npm run lint:check\n');

} catch (error) {
  console.error('❌ Error setting up Git hooks:', error.message);
  process.exit(1);
}
#!/usr/bin/env tsx

import { execSync } from 'child_process';
import { resolve } from 'path';

// Set up environment for test database
process.env.DATABASE_URL = 'file:./prisma/test.db';

console.log('🔧 Setting up test database...');

try {
  // Generate Prisma client
  console.log('📦 Generating Prisma client...');
  execSync('npx prisma generate', { stdio: 'inherit' });

  // Run migrations on test database
  console.log('🗄️  Running migrations on test database...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  console.log('✅ Test database setup complete!');
} catch (error) {
  console.error('❌ Error setting up test database:', error);
  process.exit(1);
}

#!/usr/bin/env tsx

/**
 * Database Setup Verification Script
 * Verifies that the database is properly set up for CI tests
 */

import { PrismaClient } from '@prisma/client';
import { existsSync } from 'fs';
import path from 'path';

async function verifyDatabaseSetup(): Promise<void> {
  console.log('🔍 Verifying database setup for CI...\n');

  // Check if database file exists
  const dbPath = path.join(process.cwd(), 'prisma', 'test.db');
  console.log(`📍 Checking database file at: ${dbPath}`);

  if (!existsSync(dbPath)) {
    console.error('❌ Database file does not exist');
    process.exit(1);
  }

  console.log('✅ Database file exists');

  // Test database connection
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || 'file:./prisma/test.db',
      },
    },
  });

  try {
    console.log('🔌 Testing database connection...');
    await prisma.$connect();
    console.log('✅ Database connection successful');

    // Check if tables exist by trying to query them
    console.log('📋 Checking database tables...');

    try {
      // Test basic tables exist
      const userCount = await prisma.user.count();
      console.log(`✅ Users table exists (${userCount} records)`);

      const runCount = await prisma.run.count();
      console.log(`✅ Runs table exists (${runCount} records)`);

      const goalCount = await prisma.goal.count();
      console.log(`✅ Goals table exists (${goalCount} records)`);
    } catch (error) {
      console.error('❌ Database tables not properly created:', error);
      process.exit(1);
    }

    console.log('\n🎉 Database setup verification completed successfully!');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Auto-run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyDatabaseSetup().catch(error => {
    console.error('❌ Database verification failed:', error);
    process.exit(1);
  });
}

export { verifyDatabaseSetup };

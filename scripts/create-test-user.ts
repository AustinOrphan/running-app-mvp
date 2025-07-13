#!/usr/bin/env npx tsx

/**
 * Development utility script to create a test user for local development.
 * This script provides a secure way to create test users with proper validation
 * and error handling to ensure a smooth development setup.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

// Environment validation
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'] as const;
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

// Default test user configuration
const DEFAULT_CONFIG = {
  email: 'test@example.com',
  password: 'TestPassword123!',
  name: 'Test User',
} as const;

interface UserConfig {
  email: string;
  password: string;
  name: string;
  force?: boolean;
}

/**
 * Validates environment variables required for the script
 */
function validateEnvironment(): void {
  const missing = REQUIRED_ENV.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    console.error('Error: Missing required environment variables:');
    missing.forEach(envVar => {
      console.error(`  - ${envVar}`);
    });
    console.error('\nPlease ensure your .env file is properly configured.');
    process.exit(1);
  }

  if (!isDevelopment) {
    console.error('Error: This script should only be run in development environment.');
    console.error('Current NODE_ENV:', process.env.NODE_ENV || 'undefined');
    process.exit(1);
  }
}

/**
 * Validates email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates password strength
 */
function isValidPassword(password: string): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (password.length < 8) {
    issues.push('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    issues.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    issues.push('Password must contain at least one lowercase letter');
  }
  if (!/\d/.test(password)) {
    issues.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    issues.push('Password must contain at least one special character');
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

/**
 * Creates a new test user with the given configuration using upsert for idempotency
 */
async function createTestUser(config: UserConfig): Promise<void> {
  const prisma = new PrismaClient();
  
  try {
    console.log('\nCreating test user...');
    
    // Hash password securely
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(config.password, saltRounds);
    
    // Use upsert to make the operation idempotent
    const user = await prisma.user.upsert({
      where: { email: config.email },
      update: {
        password: hashedPassword,
        name: config.name,
      },
      create: {
        email: config.email,
        password: hashedPassword,
        name: config.name,
      },
    });
    
    console.log('\n✓ Test user created or updated successfully!');
    console.log(`  Email: ${user.email}`);
    console.log(`  Name: ${user.name}`);
    console.log(`  ID: ${user.id}`);
    console.log(`  Created: ${user.createdAt.toISOString()}`);
    
  } catch (error) {
    console.error('\nError creating/updating user:');
    
    if (error instanceof Error) {
      // Handle specific database errors
      if (error.message.includes('ECONNREFUSED')) {
        console.error('Cannot connect to database. Is it running?');
      } else {
        console.error(error.message);
      }
    } else {
      console.error('Unknown error occurred:', error);
    }
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Parses command line arguments
 */
function parseArgs(): UserConfig & { help?: boolean } {
  const args = process.argv.slice(2);
  const config: UserConfig & { help?: boolean } = {
    email: DEFAULT_CONFIG.email,
    password: DEFAULT_CONFIG.password,
    name: DEFAULT_CONFIG.name,
    force: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--email':
        config.email = args[++i] || config.email;
        break;
      case '--password':
        config.password = args[++i] || config.password;
        break;
      case '--name':
        config.name = args[++i] || config.name;
        break;
      case '--force':
        config.force = true;
        break;
      case '--help':
        config.help = true;
        break;
      default:
        if (args[i].startsWith('--')) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
    }
  }
  
  return config;
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  try {
    const config = parseArgs();
    
    if (config.help) {
      console.log('Test User Creation Script');
      console.log('\nUsage:');
      console.log('  npm run create-test-user [options]');
      console.log('  npx tsx scripts/create-test-user.ts [options]');
      console.log('\nOptions:');
      console.log('  --email <email>     Email address for the test user');
      console.log('  --password <pass>   Password for the test user');
      console.log('  --name <name>       Display name for the test user');
      console.log('  --force             Overwrite existing user');
      console.log('  --help              Show this help message');
      console.log('\nExamples:');
      console.log('  npm run create-test-user');
      console.log('  npm run create-test-user --email dev@test.com --name "Dev User"');
      console.log(`  npm run create-test-user --force --email ${DEFAULT_CONFIG.email}`);
      process.exit(0);
    }
    
    // Validate environment before proceeding
    validateEnvironment();
    
    console.log('Development Test User Creation Script');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Validate config
    if (!isValidEmail(config.email)) {
      console.error(`Invalid email format: ${config.email}`);
      process.exit(1);
    }
    
    const passwordValidation = isValidPassword(config.password);
    if (!passwordValidation.isValid) {
      console.error('Password validation failed:');
      passwordValidation.issues.forEach(issue => console.error(`  - ${issue}`));
      process.exit(1);
    }
    
    await createTestUser(config);
    
    console.log('\nYou can now sign in with these credentials:');
    console.log(`  Email: ${config.email}`);
    console.log(`  Password: ${config.password}`);
    
  } catch (error) {
    console.error('\nUnexpected error:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Execute main function if script is run directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { createTestUser, validateEnvironment, isValidEmail, isValidPassword };

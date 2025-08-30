#!/usr/bin/env tsx

/**
 * Prisma Client Setup for Tests
 * Ensures Prisma client is available in all test environments
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

interface PrismaSetupOptions {
  verbose?: boolean;
  force?: boolean;
}

class PrismaSetupManager {
  private options: PrismaSetupOptions;
  private projectRoot: string;
  private clientPath: string;

  constructor(options: PrismaSetupOptions = {}) {
    this.options = options;
    this.projectRoot = process.cwd();
    this.clientPath = path.join(this.projectRoot, 'node_modules', '@prisma', 'client');
  }

  private log(message: string): void {
    if (this.options.verbose !== false) {
      console.log(message);
    }
  }

  private logError(message: string, error?: any): void {
    console.error(message);
    if (error && this.options.verbose) {
      console.error(error);
    }
  }

  /**
   * Check if Prisma client is already generated
   */
  isPrismaClientGenerated(): boolean {
    // Check if the client directory exists and has the main files
    const clientExists = existsSync(this.clientPath);
    const indexExists =
      existsSync(path.join(this.clientPath, 'index.js')) ||
      existsSync(path.join(this.clientPath, 'index.d.ts'));

    return clientExists && indexExists;
  }

  /**
   * Generate Prisma client
   */
  async generatePrismaClient(): Promise<void> {
    this.log('🔧 Generating Prisma client...');

    try {
      // Generate Prisma client with timeout
      execSync('npx prisma generate', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        timeout: 60000, // 1 minute timeout
        cwd: this.projectRoot,
      });

      this.log('✅ Prisma client generated successfully');
    } catch (error) {
      this.logError('❌ Failed to generate Prisma client:', error);
      throw new Error(`Prisma client generation failed: ${error}`);
    }
  }

  /**
   * Verify Prisma client can be imported
   */
  async verifyPrismaClient(): Promise<void> {
    this.log('🔍 Verifying Prisma client...');

    try {
      // Try to dynamically import the Prisma client
      const { PrismaClient } = await import('@prisma/client');

      // Create a test instance (don't connect)
      const prisma = new PrismaClient();

      // Verify the client has expected methods
      if (typeof prisma.$connect !== 'function' || typeof prisma.$disconnect !== 'function') {
        throw new Error('Prisma client missing required methods');
      }

      this.log('✅ Prisma client verification successful');
    } catch (error) {
      this.logError('❌ Prisma client verification failed:', error);
      throw new Error(`Prisma client verification failed: ${error}`);
    }
  }

  /**
   * Full setup process
   */
  async setup(): Promise<void> {
    const startTime = Date.now();
    this.log('🚀 Starting Prisma client setup...');

    try {
      // Check if client is already generated (unless forced)
      if (!this.options.force && this.isPrismaClientGenerated()) {
        this.log('ℹ️  Prisma client already exists, skipping generation');
        await this.verifyPrismaClient();
        return;
      }

      // Generate the client
      await this.generatePrismaClient();

      // Verify it works
      await this.verifyPrismaClient();

      const duration = Date.now() - startTime;
      this.log(`🎉 Prisma client setup completed in ${duration}ms`);
    } catch (error) {
      this.logError('💥 Prisma client setup failed:', error);
      throw error;
    }
  }
}

/**
 * Ensure Prisma client is available for tests
 * This function is called by test setup files
 */
export async function ensurePrismaClient(): Promise<void> {
  // Skip in CI if client already exists (performance optimization)
  const isCI = process.env.CI === 'true';
  const verbose = !isCI && process.env.NODE_ENV !== 'test';

  const setupManager = new PrismaSetupManager({
    verbose,
    force: process.env.FORCE_PRISMA_GENERATE === 'true',
  });

  await setupManager.setup();
}

/**
 * Force regenerate Prisma client
 * Useful for test scripts and CI environments
 */
export async function regeneratePrismaClient(): Promise<void> {
  const setupManager = new PrismaSetupManager({
    verbose: true,
    force: true,
  });

  await setupManager.setup();
}

/**
 * Verify Prisma client is available without generating
 * Useful for health checks
 */
export async function verifyPrismaClientExists(): Promise<boolean> {
  const setupManager = new PrismaSetupManager({ verbose: false });

  try {
    if (!setupManager.isPrismaClientGenerated()) {
      return false;
    }

    await setupManager.verifyPrismaClient();
    return true;
  } catch {
    return false;
  }
}

// CLI interface for running as a script - disabled in favor of simpler setup
// This file is primarily used as a module, not as a standalone script

/**
 * Prisma Client Availability Test
 * Ensures that Prisma client is properly generated and available for tests
 */

import { describe, it, expect } from 'vitest';

describe('Prisma Client Setup', () => {
  it('should be able to import PrismaClient', async () => {
    // This test verifies that the Prisma client can be imported
    // If the client is not generated, this import will fail
    const { PrismaClient } = await import('@prisma/client');

    expect(PrismaClient).toBeDefined();
    expect(typeof PrismaClient).toBe('function');
  });

  it('should be able to create a PrismaClient instance', async () => {
    const { PrismaClient } = await import('@prisma/client');

    const prisma = new PrismaClient();

    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe('function');
    expect(typeof prisma.$disconnect).toBe('function');

    // Don't actually connect in this test - just verify the instance has the expected methods
    expect(typeof prisma.user).toBe('object'); // User model delegate
    expect(typeof prisma.run).toBe('object'); // Run model delegate
    expect(typeof prisma.goal).toBe('object'); // Goal model delegate
  });

  it('should have the expected database models available', async () => {
    const { PrismaClient } = await import('@prisma/client');

    const prisma = new PrismaClient();

    // Verify all expected models are available
    expect(prisma.user).toBeDefined();
    expect(prisma.run).toBeDefined();
    expect(prisma.goal).toBeDefined();
    expect(prisma.race).toBeDefined();

    // Verify model methods are available
    expect(typeof prisma.user.findUnique).toBe('function');
    expect(typeof prisma.user.create).toBe('function');
    expect(typeof prisma.user.update).toBe('function');
    expect(typeof prisma.user.delete).toBe('function');
  });
});

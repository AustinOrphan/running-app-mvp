import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Use a singleton pattern to ensure only one Prisma instance
let prismaInstance: PrismaClient | null = null;

/**
 * Gets or creates a singleton Prisma instance for tests
 */
export const getTestPrisma = () => {
  if (!prismaInstance) {
    const databaseUrl =
      process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'file:./prisma/test.db';
    prismaInstance = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      log: process.env.DEBUG_TESTS ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
  }
  return prismaInstance;
};

/**
 * Ensures the test database is properly initialized
 */
export const initializeTestDatabase = async () => {
  const prisma = getTestPrisma();

  try {
    // Check connection
    await prisma.$connect();

    // Schema should already be applied by globalSetup.ts for in-memory databases
    // For file-based databases, migrations are handled elsewhere

    return prisma;
  } catch (error) {
    console.error('Failed to initialize test database:', error);
    throw error;
  }
};

/**
 * Cleans all data from the test database
 */
export const cleanTestDatabase = async () => {
  const prisma = getTestPrisma();

  // Order matters due to foreign key constraints - use proper Prisma model names
  const tables = ['race', 'goal', 'run', 'user'] as const;

  for (const table of tables) {
    try {
      await (prisma[table] as any).deleteMany();
    } catch (error) {
      console.warn(`Failed to clean ${table} table:`, (error as Error).message);
    }
  }
};

/**
 * Creates a test user with hashed password
 */
export const createTestUser = async (userData?: { email?: string; password?: string }) => {
  const prisma = getTestPrisma();
  const email = userData?.email || `test-${crypto.randomUUID()}@example.com`;
  const password = userData?.password || 'TestSecure#2024';

  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
    },
  });

  return { ...user, plainPassword: password };
};

/**
 * Generates a valid JWT token for testing
 */
export const generateTestToken = (userId: string, email?: string) => {
  const secret = process.env.JWT_SECRET || 'test-secret';
  const payload = {
    id: userId,
    email: email || 'test@example.com',
    type: 'access',
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, secret, {
    expiresIn: '1h',
    issuer: 'running-app',
    audience: 'running-app-users',
  });
};

/**
 * Generates both access and refresh tokens
 */
export const generateTestTokens = (userId: string, email?: string) => {
  const secret = process.env.JWT_SECRET || 'test-secret';
  // Using the same secret for both tokens as per application logic

  const accessPayload = {
    id: userId,
    email: email || 'test@example.com',
    type: 'access',
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };

  const refreshPayload = {
    id: userId,
    type: 'refresh',
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };

  const accessToken = jwt.sign(accessPayload, secret, {
    expiresIn: '1h',
    issuer: 'running-app',
    audience: 'running-app-users',
  });

  const refreshToken = jwt.sign(refreshPayload, secret, {
    expiresIn: '7d',
    issuer: 'running-app',
    audience: 'running-app-users',
  });

  return { accessToken, refreshToken };
};

/**
 * Disconnects the test database
 */
export const disconnectTestDatabase = async () => {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
};

// Export a unified test database interface
export const testDb = {
  prisma: getTestPrisma(),
  initialize: initializeTestDatabase,
  clean: cleanTestDatabase,
  disconnect: disconnectTestDatabase,
  createUser: createTestUser,
  generateToken: generateTestToken,
  generateTokens: generateTestTokens,
};

import { PrismaClient } from '@prisma/client';

// Test database setup
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'file:./test.db'
    }
  }
});

// Clean up database before each test
beforeEach(async () => {
  await prisma.run.deleteMany();
  await prisma.user.deleteMany();
});

// Clean up and disconnect after all tests
afterAll(async () => {
  await prisma.run.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

export { prisma };
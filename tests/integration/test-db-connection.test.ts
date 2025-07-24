import { PrismaClient } from '@prisma/client';

describe('Database Connection Test', () => {
  it('should connect to test database', async () => {
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'file:./prisma/test.db',
        },
      },
    });

    try {
      await prisma.$connect();
      console.log('Database connected successfully');

      // Try a simple query
      const userCount = await prisma.user.count();
      console.log('User count:', userCount);

      expect(true).toBe(true);
    } catch (error) {
      console.error('Database connection failed:', error);
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }, 10000); // 10 second timeout
});

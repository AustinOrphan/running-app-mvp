import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function createTestUser() {
  try {
    const email = 'test@example.com';
    const hashedPassword = await bcrypt.hash('TestPassword123!', 12);

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        password: hashedPassword,
        name: 'Test User',
      },
      create: {
        email,
        password: hashedPassword,
        name: 'Test User',
      },
    });

    console.log('Test user created or updated:', user.email);
  } catch (error) {
    console.error('Error creating/updating test user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createTestUser();

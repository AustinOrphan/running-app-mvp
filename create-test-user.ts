import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function createTestUser() {
  try {
    console.log('Creating test user...');
    
    // Check if test user exists
    let user = await prisma.user.findUnique({
      where: { email: 'test@example.com' }
    });
    
    if (user) {
      console.log('Test user already exists:', user.email);
    } else {
      // Create test user
      const hashedPassword = await bcrypt.hash('password123', 12);
      user = await prisma.user.create({
        data: {
          email: 'test@example.com',
          password: hashedPassword,
          name: 'Test User'
        }
      });
      console.log('Test user created:', user.email);
    }
    
    // Test password verification
    const isValid = await bcrypt.compare('password123', user.password);
    console.log('Password verification test:', isValid ? 'PASS' : 'FAIL');
    
    console.log('\n✅ You can now login with:');
    console.log('Email: test@example.com');
    console.log('Password: password123');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestUser();

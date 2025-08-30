// Test script to verify HTTP status codes are correctly implemented
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = 'your-super-secret-jwt-key-change-this-in-production';

// Import the goals router
async function importGoalsRouter() {
  const goalsModule = await import('./server/routes/goals.ts');
  return goalsModule.default;
}

async function testHttpStatusCodes() {
  console.log('🧪 Testing HTTP status codes for authorization scenarios...\n');

  try {
    // Create test app
    const app = express();
    app.use(express.json());

    const goalsRouter = await importGoalsRouter();
    app.use('/api/goals', goalsRouter);

    // Create two test users
    const user1 = await prisma.user.create({
      data: {
        email: 'user1@example.com',
        password: await bcrypt.hash('password123', 10),
      },
    });

    const user2 = await prisma.user.create({
      data: {
        email: 'user2@example.com',
        password: await bcrypt.hash('password123', 10),
      },
    });

    // Generate JWT tokens
    const token1 = jwt.sign({ userId: user1.id, email: user1.email }, JWT_SECRET, {
      expiresIn: '1h',
    });

    const token2 = jwt.sign({ userId: user2.id, email: user2.email }, JWT_SECRET, {
      expiresIn: '1h',
    });

    // Create a goal for user1
    const goal = await prisma.goal.create({
      data: {
        userId: user1.id,
        title: 'User 1 Goal',
        description: 'Testing HTTP status codes',
        type: 'DISTANCE',
        period: 'MONTHLY',
        targetValue: 100,
        targetUnit: 'km',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      },
    });

    console.log('✅ Created test users and goal');

    // Test 1: Access existing goal with correct user (should be 200)
    console.log('\n📝 Test 1: Access existing goal with correct user...');
    const response1 = await request(app)
      .get(`/api/goals/${goal.id}`)
      .set('Authorization', `Bearer ${token1}`);

    console.log('Status:', response1.status);
    if (response1.status === 200) {
      console.log('✅ Correct user can access goal (200)');
    } else {
      console.log('❌ Expected 200, got:', response1.status);
    }

    // Test 2: Access existing goal with wrong user (should be 403)
    console.log('\n📝 Test 2: Access existing goal with wrong user...');
    const response2 = await request(app)
      .get(`/api/goals/${goal.id}`)
      .set('Authorization', `Bearer ${token2}`);

    console.log('Status:', response2.status);
    if (response2.status === 403) {
      console.log('✅ Wrong user gets 403 for existing goal');
    } else {
      console.log('❌ Expected 403, got:', response2.status);
      console.log('Response body:', response2.body);
    }

    // Test 3: Access non-existent goal (should be 404)
    console.log('\n📝 Test 3: Access non-existent goal...');
    const response3 = await request(app)
      .get('/api/goals/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token1}`);

    console.log('Status:', response3.status);
    if (response3.status === 404) {
      console.log('✅ Non-existent goal returns 404');
    } else {
      console.log('❌ Expected 404, got:', response3.status);
      console.log('Response body:', response3.body);
    }

    // Test 4: Update existing goal with wrong user (should be 403)
    console.log('\n📝 Test 4: Update existing goal with wrong user...');
    const response4 = await request(app)
      .put(`/api/goals/${goal.id}`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ title: 'Hacked Goal' });

    console.log('Status:', response4.status);
    if (response4.status === 403) {
      console.log('✅ Wrong user gets 403 when updating existing goal');
    } else {
      console.log('❌ Expected 403, got:', response4.status);
      console.log('Response body:', response4.body);
    }

    console.log('\n🎉 HTTP status code tests completed!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      await prisma.goal.deleteMany({ where: { title: 'User 1 Goal' } });
      await prisma.user.deleteMany({
        where: { email: { in: ['user1@example.com', 'user2@example.com'] } },
      });
      console.log('🧹 Cleanup completed');
    } catch (error) {
      console.log('⚠️  Cleanup warning:', error.message);
    }

    await prisma.$disconnect();
  }
}

// Run the test
testHttpStatusCodes().catch(console.error);

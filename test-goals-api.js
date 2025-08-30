// Test Goals API currentValue persistence through HTTP endpoints
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = 'your-super-secret-jwt-key-change-this-in-production';

// Import the goals router
async function importGoalsRouter() {
  const { default: goalsRouter } = await import('./server/routes/goals.js');
  return goalsRouter;
}

async function testGoalsAPI() {
  console.log('🧪 Testing Goals API currentValue persistence through HTTP...\n');

  try {
    // Create test app
    const app = express();
    app.use(express.json());

    const goalsRouter = await importGoalsRouter();
    app.use('/api/goals', goalsRouter);

    // Create test user
    const testUser = await prisma.user.create({
      data: {
        email: 'apitest@example.com',
        password: await bcrypt.hash('password123', 10),
      },
    });
    console.log('✅ Created test user:', testUser.email);

    // Generate JWT token
    const token = jwt.sign({ userId: testUser.id, email: testUser.email }, JWT_SECRET, {
      expiresIn: '1h',
    });

    // Test 1: Create goal with currentValue
    console.log('\n📝 Test 1: Create goal with currentValue...');
    const createResponse = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'API Test Goal',
        description: 'Testing API currentValue',
        type: 'DISTANCE',
        period: 'MONTHLY',
        targetValue: 100,
        targetUnit: 'km',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

    console.log('Status:', createResponse.status);
    if (createResponse.status === 201) {
      console.log('✅ Goal created successfully');
      console.log('   Initial currentValue:', createResponse.body.currentValue);
    } else {
      console.log('❌ Failed to create goal:', createResponse.body);
    }

    const goalId = createResponse.body.id;

    // Test 2: Update currentValue to 25
    console.log('\n📝 Test 2: Update currentValue to 25...');
    const updateResponse1 = await request(app)
      .put(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentValue: 25,
      });

    console.log('Status:', updateResponse1.status);
    if (updateResponse1.status === 200) {
      console.log('✅ currentValue updated to 25:', updateResponse1.body.currentValue);
    } else {
      console.log('❌ Failed to update currentValue:', updateResponse1.body);
    }

    // Test 3: Update currentValue with other fields
    console.log('\n📝 Test 3: Update currentValue with other fields...');
    const updateResponse2 = await request(app)
      .put(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentValue: 60,
        description: 'Updated via API',
      });

    console.log('Status:', updateResponse2.status);
    if (updateResponse2.status === 200) {
      console.log('✅ currentValue updated to 60:', updateResponse2.body.currentValue);
      console.log('   Description updated:', updateResponse2.body.description);
    } else {
      console.log('❌ Failed to update goal:', updateResponse2.body);
    }

    // Test 4: Test negative value validation
    console.log('\n📝 Test 4: Test negative currentValue validation...');
    const negativeResponse = await request(app)
      .put(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentValue: -10,
      });

    console.log('Status:', negativeResponse.status);
    if (negativeResponse.status === 400) {
      console.log('✅ Negative currentValue properly rejected');
    } else {
      console.log('❌ Negative currentValue should be rejected');
    }

    // Test 5: Update to exceed target (auto-completion)
    console.log('\n📝 Test 5: Update currentValue to exceed target...');
    const exceedResponse = await request(app)
      .put(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentValue: 105,
      });

    console.log('Status:', exceedResponse.status);
    if (exceedResponse.status === 200) {
      console.log('✅ currentValue updated to 105:', exceedResponse.body.currentValue);
      console.log('   Auto-completed:', exceedResponse.body.isCompleted);
      console.log('   Completed at:', exceedResponse.body.completedAt);
    } else {
      console.log('❌ Failed to update currentValue to exceed target:', exceedResponse.body);
    }

    // Test 6: Verify persistence by GET
    console.log('\n📝 Test 6: Verify persistence via GET...');
    const getResponse = await request(app)
      .get(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${token}`);

    console.log('Status:', getResponse.status);
    if (getResponse.status === 200) {
      console.log('✅ Retrieved goal - currentValue:', getResponse.body.currentValue);
      console.log('   Goal completion status:', getResponse.body.isCompleted);
    } else {
      console.log('❌ Failed to retrieve goal:', getResponse.body);
    }

    console.log('\n🎉 All Goals API currentValue tests completed!');
  } catch (error) {
    console.error('❌ API test failed:', error.message);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      await prisma.goal.deleteMany({ where: { title: 'API Test Goal' } });
      await prisma.user.deleteMany({ where: { email: 'apitest@example.com' } });
      console.log('🧹 Cleanup completed');
    } catch (error) {
      console.log('⚠️  Cleanup warning:', error.message);
    }

    await prisma.$disconnect();
  }
}

// Run the test
testGoalsAPI().catch(console.error);

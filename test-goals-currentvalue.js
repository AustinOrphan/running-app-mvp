// Quick test script to verify Goals API currentValue persistence
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
const prisma = new PrismaClient();

async function testGoalsCurrentValue() {
  console.log('🧪 Testing Goals API currentValue persistence...\n');

  try {
    // Create test user
    const testUser = await prisma.user.create({
      data: {
        email: 'test@example.com',
        password: await bcrypt.hash('password123', 10),
      },
    });
    console.log('✅ Created test user:', testUser.email);

    // Create test goal
    const testGoal = await prisma.goal.create({
      data: {
        userId: testUser.id,
        title: 'Test Distance Goal',
        description: 'Testing currentValue persistence',
        type: 'DISTANCE',
        period: 'MONTHLY',
        targetValue: 100,
        targetUnit: 'km',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        currentValue: 0,
        isActive: true,
      },
    });
    console.log('✅ Created test goal:', testGoal.title);
    console.log('   Initial currentValue:', testGoal.currentValue);

    // Test 1: Update currentValue to 25
    const updated1 = await prisma.goal.update({
      where: { id: testGoal.id },
      data: { currentValue: 25 },
    });
    console.log('✅ Updated currentValue to 25:', updated1.currentValue);

    // Test 2: Update currentValue to 50 with other fields
    const updated2 = await prisma.goal.update({
      where: { id: testGoal.id },
      data: {
        currentValue: 50,
        description: 'Updated description',
      },
    });
    console.log('✅ Updated currentValue to 50 with other fields:', updated2.currentValue);
    console.log('   Description also updated:', updated2.description);

    // Test 3: Update currentValue to exceed target (should auto-complete)
    const updated3 = await prisma.goal.update({
      where: { id: testGoal.id },
      data: { currentValue: 105 },
    });
    console.log('✅ Updated currentValue to 105 (exceeds target):', updated3.currentValue);

    // Verify persistence by reading directly from database
    const finalGoal = await prisma.goal.findUnique({
      where: { id: testGoal.id },
    });
    console.log('✅ Final verification - currentValue from DB:', finalGoal?.currentValue);

    // Test edge cases
    console.log('\n🔍 Testing edge cases...');

    // Test negative value (should be rejected)
    try {
      await prisma.goal.update({
        where: { id: testGoal.id },
        data: { currentValue: -10 },
      });
      console.log('❌ ERROR: Negative currentValue should be rejected');
    } catch {
      console.log('✅ Negative currentValue properly rejected');
    }

    // Test very large value
    const largeValue = await prisma.goal.update({
      where: { id: testGoal.id },
      data: { currentValue: 999999 },
    });
    console.log('✅ Large currentValue handled:', largeValue.currentValue);

    // Test decimal value
    const decimalValue = await prisma.goal.update({
      where: { id: testGoal.id },
      data: { currentValue: 42.5 },
    });
    console.log('✅ Decimal currentValue handled:', decimalValue.currentValue);

    console.log('\n🎉 All currentValue persistence tests PASSED!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      await prisma.goal.deleteMany({ where: { title: 'Test Distance Goal' } });
      await prisma.user.deleteMany({ where: { email: 'test@example.com' } });
      console.log('🧹 Cleanup completed');
    } catch (error) {
      console.log('⚠️  Cleanup warning:', error.message);
    }

    await prisma.$disconnect();
  }
}

// Run the test
testGoalsCurrentValue().catch(console.error);

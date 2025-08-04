# Test Data Factories

## Overview

The test data factory system provides a comprehensive set of tools for creating realistic, consistent test data. It includes both simple factory functions and advanced builder patterns for complex scenarios.

## Benefits

### Consistency

- **Standardized data**: All tests use the same data patterns
- **Realistic values**: Generated data matches real-world scenarios
- **Unique identifiers**: Automated generation prevents conflicts

### Maintainability

- **Single source of truth**: Change data patterns in one place
- **Type safety**: Full TypeScript support with Prisma types
- **Reusable patterns**: Common scenarios can be easily recreated

### Flexibility

- **Builder patterns**: Fluent API for complex object creation
- **Scenario builders**: Create interconnected test data
- **Override capabilities**: Customize any aspect of generated data

## Quick Start

### Basic Factory Usage

```typescript
import { createUser, createRun, createGoal } from '../factories';

test('basic factory usage', async () => {
  // Create a user
  const user = await createUser({
    email: 'test@example.com',
    name: 'Test User',
  });

  // Create a run for the user
  const run = await createRun({
    userId: user.id,
    distance: 10.0,
    duration: 3600,
  });

  // Create a goal for the user
  const goal = await createGoal({
    userId: user.id,
    title: 'Monthly Distance Goal',
    type: 'DISTANCE',
    targetValue: 100,
  });
});
```

### Builder Pattern Usage

```typescript
import { user, run, goal, race } from '../factories/builders';

test('builder pattern usage', async () => {
  // Build a user with fluent API
  const userData = await user().withEmail('runner@example.com').withName('Marathon Runner').build();

  // Build related data
  const runData = await run()
    .withUserId(userData.id)
    .asLongRun()
    .yesterdayRun()
    .withRoute(150)
    .build();

  const goalData = await goal()
    .withUserId(userData.id)
    .asDistanceGoal(200)
    .asMonthlyGoal()
    .withProgressPercentage(75)
    .build();
});
```

### Scenario Builder Usage

```typescript
import { scenario } from '../factories/builders';

test('complex scenario', async () => {
  const data = await scenario()
    .addUser(u => u.withName('Beginner Runner'))
    .addUser(u => u.withName('Advanced Runner'))
    .addRunForUser(0, r => r.asEasyRun().withDistance(3))
    .addRunForUser(1, r => r.asLongRun().withDistance(20))
    .addGoalForUser(0, g => g.asFrequencyGoal(3).asWeeklyGoal())
    .addGoalForUser(1, g => g.asDistanceGoal(300).asMonthlyGoal())
    .addRaceForUser(1, r => r.asMarathon().upcomingRace(45))
    .build();

  expect(data.users).toHaveLength(2);
  expect(data.runs).toHaveLength(2);
  expect(data.goals).toHaveLength(2);
  expect(data.races).toHaveLength(1);
});
```

## Factory Functions

### User Factory

```typescript
// Basic user creation
const user = await createUser({
  email: 'user@test.com',
  name: 'Test User',
  password: 'securePassword123',
});

// Multiple users
const users = await createMultipleUsers(5, {
  name: 'Batch User',
});
```

**Available Options:**

- `email?: string` - Custom email (auto-generated if not provided)
- `password?: string` - Plain text password (hashed automatically)
- `name?: string` - User display name
- `id?: string` - Custom user ID

**Returns:** `UserWithPassword` (includes `plainPassword` field)

### Run Factory

```typescript
// Basic run
const run = await createRun({
  userId: user.id,
  distance: 10.5,
  duration: 3600,
  tag: 'Long Run',
});

// Run with route
const runWithRoute = await createRunWithRoute({
  userId: user.id,
  distance: 5.0,
});

// Multiple runs
const runs = await createRunSeries(user.id, 10);
```

**Available Options:**

- `userId: string` - **Required** - User who performed the run
- `date?: Date` - Run date (defaults to now)
- `distance?: number` - Distance in kilometers
- `duration?: number` - Duration in seconds
- `tag?: string` - Run type/category
- `notes?: string` - Run notes
- `routeGeoJson?: string` - GeoJSON route data

### Goal Factory

```typescript
// Basic goal
const goal = await createGoal({
  userId: user.id,
  title: 'Monthly Distance',
  type: 'DISTANCE',
  targetValue: 100,
});

// Distance goal
const distanceGoal = await createDistanceGoal(user.id, 150, 'MONTHLY');

// Completed goal
const completedGoal = await createCompletedGoal(user.id, 7);

// Active goal with progress
const activeGoal = await createActiveGoal(user.id, 75);
```

**Goal Types:**

- `DISTANCE` - Total distance goals
- `TIME` - Total time goals
- `FREQUENCY` - Frequency goals (runs per period)
- `PACE` - Average pace goals
- `LONGEST_RUN` - Longest single run goals

**Periods:**

- `WEEKLY` - Weekly goals
- `MONTHLY` - Monthly goals
- `YEARLY` - Yearly goals
- `CUSTOM` - Custom date range

### Race Factory

```typescript
const race = await createRace({
  userId: user.id,
  name: '10K City Race',
  distance: 10,
  raceDate: new Date('2024-06-15'),
  targetTime: 2700, // 45 minutes
});
```

## Builder Patterns

### User Builder

```typescript
const userData = await user()
  .withEmail('specific@email.com')
  .withName('Specific User')
  .withPassword('customPassword')
  .withId('custom-id')
  .build();
```

### Run Builder

```typescript
const runData = await run()
  .withUserId(user.id)
  .withDate(new Date('2024-01-15'))
  .withDistance(15.5)
  .withDuration(5400)
  .withTag('Long Run')
  .withNotes('Great weather today!')
  .withRoute(200) // 200 GPS points
  .build();

// Predefined run types
const easyRun = await run().withUserId(user.id).asEasyRun().build();
const longRun = await run().withUserId(user.id).asLongRun().build();
const speedWork = await run().withUserId(user.id).asSpeedWork().build();

// Relative dates
const yesterdayRun = await run().withUserId(user.id).yesterdayRun().build();
const lastWeekRun = await run().withUserId(user.id).lastWeekRun().build();
```

### Goal Builder

```typescript
const goalData = await goal()
  .withUserId(user.id)
  .withTitle('Custom Goal')
  .withDescription('Detailed description')
  .withType('DISTANCE')
  .withPeriod('MONTHLY')
  .withTarget(200, 'km')
  .withProgress(150)
  .withColor('#ff0000')
  .withIcon('🎯')
  .build();

// Predefined goal types
const distanceGoal = await goal().withUserId(user.id).asDistanceGoal(100).build();
const frequencyGoal = await goal().withUserId(user.id).asFrequencyGoal(4).build();
const timeGoal = await goal().withUserId(user.id).asTimeGoal(600).build();
const paceGoal = await goal().withUserId(user.id).asPaceGoal(300).build(); // 5:00 per km

// Period shortcuts
const monthlyGoal = await goal().withUserId(user.id).asMonthlyGoal().build();
const weeklyGoal = await goal().withUserId(user.id).asWeeklyGoal().build();

// Status modifiers
const completedGoal = await goal().withUserId(user.id).asCompleted().build();
const progressGoal = await goal().withUserId(user.id).withProgressPercentage(75).build();
```

### Race Builder

```typescript
const raceData = await race()
  .withUserId(user.id)
  .withName('Custom Race')
  .withDate(new Date('2024-06-15'))
  .withDistance(21.1)
  .withTargetTime(7200)
  .withActualTime(7050)
  .withNotes('Personal best!')
  .build();

// Predefined race types
const race5K = await race().withUserId(user.id).as5K().build();
const race10K = await race().withUserId(user.id).as10K().build();
const halfMarathon = await race().withUserId(user.id).asHalfMarathon().build();
const marathon = await race().withUserId(user.id).asMarathon().build();

// Timing shortcuts
const upcomingRace = await race().withUserId(user.id).upcomingRace(30).build(); // 30 days from now
const pastRace = await race().withUserId(user.id).pastRace(30).build(); // 30 days ago
const completedRace = await race().withUserId(user.id).asCompleted(7200).build(); // with actual time
```

## Test Data Manager

### Predefined Scenarios

```typescript
import { testManager, setupTestData } from '../factories/testManager';

// Basic scenario: Single user with runs and goals
const basicContext = await setupTestData('basic');
// Contains: 1 user, 10 runs, 2 goals

// Competition scenario: Multiple users with races
const competitionContext = await setupTestData('competition');
// Contains: 3 users, 60 runs (20 each), 3 goals, 3 races

// Training scenario: Structured training data
const trainingContext = await setupTestData('training');
// Contains: 1 user, 20 runs (4 weeks × 5 days), 3 structured goals

// Always clean up
await basicContext.cleanup();
```

### Custom Scenarios

```typescript
// Create isolated test data
const context = await testManager.createIsolatedData(async userId => {
  // Create custom data for the user
  await createRunSeries(userId, 15);
  await createGoal({ userId, type: 'DISTANCE', targetValue: 200 });
});

await context.cleanup();
```

### Database Management

```typescript
// Reset entire database
await testManager.resetDatabase();

// Seed with sample data
await testManager.seedDatabase(); // Creates 5 users with runs, goals, races
```

## Common Utilities

### Date Generation

```typescript
import { generateDateRange, generateDates } from '../factories/commonFactory';

// Generate date range
const range = generateDateRange(30, 7); // 30 days back, 7 days forward

// Generate multiple dates within range
const dates = generateDates(10, range); // 10 random dates in range
```

### Realistic Data

```typescript
import {
  generateEmail,
  generatePassword,
  generateGeoJSON,
  generateRunTag,
  generateRunNotes,
  generateGoalColor,
  generateGoalIcon,
} from '../factories/commonFactory';

const email = generateEmail('runner'); // runner_1234567890_abc123@test.com
const password = generatePassword(16); // Complex password with mixed chars
const route = generateGeoJSON(50); // GeoJSON with 50 coordinate points
const tag = generateRunTag(); // "Easy Run", "Long Run", etc.
const notes = generateRunNotes(); // "Felt great today. Sunny weather. Hit all my splits!"
const color = generateGoalColor(); // "#3b82f6"
const icon = generateGoalIcon(); // "🎯"
```

## Integration with Tests

### Unit Tests

```typescript
import { user, run } from '../factories/builders';

describe('Run Statistics', () => {
  test('calculates average pace', async () => {
    const userData = await user().build();
    const runData = await run()
      .withUserId(userData.id)
      .withDistance(10)
      .withDuration(3000) // 50 minutes
      .build();

    const pace = calculatePace(runData);
    expect(pace).toBe(300); // 5:00 per km
  });
});
```

### Integration Tests

```typescript
import { createUser, createRun } from '../factories';

describe('Runs API', () => {
  test('creates run successfully', async () => {
    const user = await createUser();

    const response = await request(app)
      .post('/api/runs')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        date: new Date(),
        distance: 10,
        duration: 3600,
      });

    expect(response.status).toBe(201);
  });
});
```

### E2E Tests

```typescript
import { testManager } from '../factories/testManager';

describe('User Dashboard', () => {
  test('displays user stats correctly', async () => {
    const context = await testManager.createScenario('training');
    const user = context.users[0];

    await page.goto(`/dashboard?user=${user.id}`);

    // Verify stats are displayed correctly
    expect(await page.textContent('[data-testid="total-runs"]')).toBe('20');
    expect(await page.textContent('[data-testid="total-distance"]')).toContain('km');

    await context.cleanup();
  });
});
```

## Best Practices

### 1. Use Builders for Complex Objects

```typescript
// ✅ Good - Clear, readable, flexible
const goal = await goal()
  .withUserId(user.id)
  .asDistanceGoal(100)
  .asMonthlyGoal()
  .withProgressPercentage(50)
  .build();

// ❌ Avoid - Hard to read, error-prone
const goal = await createGoal({
  userId: user.id,
  type: 'DISTANCE',
  period: 'MONTHLY',
  targetValue: 100,
  targetUnit: 'km',
  currentValue: 50,
  startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
});
```

### 2. Use Scenarios for Integration Tests

```typescript
// ✅ Good - Comprehensive test data
const context = await setupTestData('competition');
// Test complex interactions between users, runs, goals, races

// ❌ Avoid - Creating data piecemeal
const user1 = await createUser();
const user2 = await createUser();
const runs1 = await createRunSeries(user1.id, 20);
// ... lots of repetitive setup
```

### 3. Always Clean Up

```typescript
describe('User Tests', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await setupTestData('basic');
  });

  afterEach(async () => {
    await context.cleanup(); // Important!
  });

  // tests...
});
```

### 4. Use Meaningful Test Data

```typescript
// ✅ Good - Meaningful for test context
const marathonTrainingGoal = await goal()
  .withUserId(user.id)
  .withTitle('Marathon Training - Build Endurance')
  .asDistanceGoal(300)
  .asMonthlyGoal()
  .build();

// ❌ Avoid - Generic test data
const goal = await createGoal({ userId: user.id });
```

### 5. Prefer Type Safety

```typescript
// ✅ Good - Type-safe builder pattern
const runData = await run()
  .withUserId(user.id)
  .asLongRun() // Predefined with proper values
  .build();

// ❌ Avoid - Magic numbers
const runData = await createRun({
  userId: user.id,
  distance: 15.7,
  duration: 5423,
});
```

## Performance Considerations

### Batch Creation

```typescript
// ✅ Good - Use batch functions
const runs = await createRunSeries(user.id, 100);

// ❌ Avoid - Individual creation in loops
const runs = [];
for (let i = 0; i < 100; i++) {
  runs.push(await createRun({ userId: user.id }));
}
```

### Reuse Test Data

```typescript
// ✅ Good - Reuse setup data
describe('Goal Tests', () => {
  let user: User;

  beforeAll(async () => {
    user = await createUser();
  });

  test('creates distance goal', async () => {
    const goal = await goal().withUserId(user.id).asDistanceGoal().build();
    // Test logic
  });

  test('creates frequency goal', async () => {
    const goal = await goal().withUserId(user.id).asFrequencyGoal().build();
    // Test logic
  });
});
```

### Minimize Database Operations

```typescript
// ✅ Good - Build data first, save once
const data = await scenario()
  .addUser()
  .addRunForUser(0, r => r.asEasyRun())
  .addGoalForUser(0, g => g.asDistanceGoal())
  .build();

// Then save to database if needed
const savedUser = await prisma.user.create({ data: data.users[0] });

// ❌ Avoid - Multiple database round trips
const user = await createUser();
const run = await createRun({ userId: user.id });
const goal = await createGoal({ userId: user.id });
```

## Migration Guide

### From Manual Test Data

**Before:**

```typescript
test('user can create run', async () => {
  const user = await prisma.user.create({
    data: {
      email: 'test@example.com',
      password: await bcrypt.hash('password', 10),
      name: 'Test User',
    },
  });

  const run = await prisma.run.create({
    data: {
      userId: user.id,
      date: new Date(),
      distance: 5.0,
      duration: 1800,
    },
  });

  // test logic
});
```

**After:**

```typescript
test('user can create run', async () => {
  const user = await createUser({
    email: 'test@example.com',
    name: 'Test User',
  });

  const runData = await run().withUserId(user.id).withDistance(5.0).withDuration(1800).build();

  // test logic
});
```

### From Simple Factories

**Before:**

```typescript
const goal = await createGoal({
  userId: user.id,
  type: 'DISTANCE',
  period: 'MONTHLY',
  targetValue: 100,
  currentValue: 75,
});
```

**After:**

```typescript
const goalData = await goal()
  .withUserId(user.id)
  .asDistanceGoal(100)
  .asMonthlyGoal()
  .withProgressPercentage(75)
  .build();
```

## Troubleshooting

### Common Issues

1. **"UserId is required" error**

   ```typescript
   // ❌ Missing userId
   const runData = await run().withDistance(10).build();

   // ✅ Include userId
   const runData = await run().withUserId(user.id).withDistance(10).build();
   ```

2. **Type errors with Prisma**

   ```typescript
   // ❌ Don't mix built data with Prisma operations
   const runData = await run().withUserId(user.id).build();
   await prisma.run.update({ where: { id: runData.id } }); // id doesn't exist on built data

   // ✅ Create in database first
   const runData = await run().withUserId(user.id).build();
   const savedRun = await prisma.run.create({ data: runData });
   await prisma.run.update({ where: { id: savedRun.id } });
   ```

3. **Memory issues with large datasets**

   ```typescript
   // ❌ Creating too much data at once
   const runs = await createRunSeries(user.id, 10000);

   // ✅ Use smaller batches or streaming
   for (let batch = 0; batch < 10; batch++) {
     const runs = await createRunSeries(user.id, 100);
     // Process batch
   }
   ```

### Debug Mode

Enable debug logging for factory operations:

```typescript
process.env.TEST_FACTORY_DEBUG = 'true';

// Will log all factory operations
const user = await createUser(); // Logs: "Creating user with email: test_123@example.com"
```

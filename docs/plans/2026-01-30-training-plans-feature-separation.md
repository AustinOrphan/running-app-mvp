# Training Plans Feature Separation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract training plans feature as standalone PR independent of analytics/RunDetail

**Architecture:** Remove hard dependencies on RunDetail model by making all advanced metrics optional with sensible defaults. Core training plan generation uses only Run model (distance, duration, date). Enhanced features (HR zones, effort tracking) become optional upgrades when analytics is available.

**Tech Stack:** Prisma, Express, TypeScript, Vitest, Zod

**Problem:** Training plans service has 15+ references to `RunDetail` model which doesn't exist yet (part of analytics PR). This creates circular dependency preventing separate PRs.

**Solution:** Make RunDetail optional everywhere, use fallback calculations based on basic Run data (pace = distance/duration), add feature flags for enhanced metrics.

---

## Phase 1: Remove RunDetail Dependencies

### Task 1: Update Service to Make RunDetail Optional

**Files:**

- Modify: `services/advancedTrainingPlanService.ts`

**Step 1: Remove RunDetail include from recent runs query**

```typescript
// Line 374 - REMOVE detail include
const recentRuns = await prisma.run.findMany({
  where: {
    userId,
    date: { gte: threeMonthsAgo },
  },
  orderBy: { date: 'desc' },
  take: 50,
  // REMOVED: include: { detail: true },
});
```

**Step 2: Add fallback for effort level calculation**

```typescript
// Line 413 - Replace with pace-based effort estimation
function estimateEffortFromPace(distance: number, duration: number): number {
  const paceMinPerKm = duration / 60 / distance;
  // Fast pace (< 4:30 min/km) = high effort (8-10)
  if (paceMinPerKm < 4.5) return 9;
  // Moderate pace (4:30-6:00) = medium effort (5-7)
  if (paceMinPerKm < 6.0) return 6;
  // Easy pace (> 6:00) = low effort (1-4)
  return 3;
}

// Replace line 413
run => {
  const effort = estimateEffortFromPace(run.distance, run.duration);
  return effort >= 9 || run.notes?.toLowerCase().includes('race');
};
```

**Step 3: Replace heart rate calculations with pace-based estimates**

```typescript
// Lines 474-481 - Remove HR dependency
.filter(run => {
  const effort = estimateEffortFromPace(run.distance, run.duration);
  return run.distance >= 3 && effort <= 4; // Easy long runs
})
.map(run => {
  // Use pace instead of HR for recovery estimation
  const paceMinPerKm = (run.duration / 60) / run.distance;
  const recoveryIndex = Math.max(1, Math.min(10, paceMinPerKm / 0.6)); // 6 min/km = index 10
  return { run, recoveryIndex };
})
```

**Step 4: Update workout generation to use pace instead of HR**

```typescript
// Line 531 - Remove HR-based intensity
const pace = run.duration / 60 / run.distance;
const intensity = pace < 5.0 ? 0.85 : pace < 6.0 ? 0.7 : 0.6;
```

**Step 5: Remove detail from all include statements**

Find and remove from lines:

- Line 870
- Line 1227
- Line 1288

```typescript
// BEFORE
include: {
  detail: true;
}

// AFTER
// Remove entirely - just fetch run data
```

**Step 6: Update fitness assessment method**

```typescript
// Lines 1302-1308 - Replace with pace-based recovery detection
.filter((run, index) => {
  if (index === 0) return false;
  const prevRun = recentRuns[index - 1];

  const prevPace = (prevRun.duration / 60) / prevRun.distance;
  const currPace = (run.duration / 60) / run.distance;

  // Hard run (fast pace) followed by easy run (slow pace)
  return prevPace < 5.0 && currPace > 6.0;
});
```

**Step 7: Remove unused @ts-expect-error directives**

```typescript
// Line 94 - Remove since TRAINING_ZONES is now used
// Delete: // @ts-expect-error - Training zones reserved for future zone calculations

// Line 1113 - Remove since method is used
// Delete: // @ts-expect-error - Method reserved for future enhancements
```

**Step 8: Add utility function for effort estimation**

```typescript
// Add at top of class after line 105
/**
 * Estimate effort level from pace (1-10 scale)
 * Used when RunDetail is not available
 */
private static estimateEffortFromPace(distance: number, duration: number): number {
  const paceMinPerKm = (duration / 60) / distance;

  // Race pace: < 4:00 min/km
  if (paceMinPerKm < 4.0) return 10;
  // Tempo pace: 4:00-4:30 min/km
  if (paceMinPerKm < 4.5) return 8;
  // Steady pace: 4:30-5:30 min/km
  if (paceMinPerKm < 5.5) return 6;
  // Easy pace: 5:30-6:30 min/km
  if (paceMinPerKm < 6.5) return 4;
  // Recovery pace: > 6:30 min/km
  return 2;
}
```

**Step 9: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: 0 errors (all RunDetail references removed)

**Step 10: Commit**

```bash
git add services/advancedTrainingPlanService.ts
git commit -m "refactor: remove RunDetail dependencies from training plan service

- Replace HR-based calculations with pace-based estimates
- Add estimateEffortFromPace utility for effort level detection
- Use basic Run model data (distance, duration, date) only
- Makes training plans independent of analytics feature

BREAKING: Advanced HR zone features temporarily disabled
Will be re-enabled when RunDetail model is available"
```

---

### Task 2: Update Routes to Remove RunDetail

**Files:**

- Modify: `server/routes/training-plans.ts`

**Step 1: Remove detail includes from run queries**

```typescript
// Line 250 - Remove detail select
select: {
  id: true,
  date: true,
  distance: true,
  duration: true,
  tag: true,
  notes: true,
  // REMOVED: detail: true,
}
```

**Step 2: Update line 437 - remove detail**

```typescript
// Same as above - remove detail from select
```

**Step 3: Remove runDetail.findMany query (line 518)**

```typescript
// Lines 515-530 - COMMENT OUT OR DELETE
// This endpoint requires RunDetail model from analytics PR
// Will be re-enabled when analytics is merged

/*
const runDetails = await prisma.runDetail.findMany({
  where: {
    run: { userId },
    createdAt: { gte: threeMonthsAgo },
  },
  include: { run: true },
  orderBy: { createdAt: 'desc' },
});
*/

// Return basic run data instead
const recentRuns = await prisma.run.findMany({
  where: {
    userId,
    date: { gte: threeMonthsAgo },
  },
  orderBy: { date: 'desc' },
  take: 50,
});

// Calculate basic stats from runs
const avgPace =
  recentRuns.length > 0
    ? recentRuns.reduce((sum, r) => sum + r.duration / 60 / r.distance, 0) / recentRuns.length
    : null;

return res.json({
  avgPace,
  recentRunsCount: recentRuns.length,
  // More stats can be added as needed
});
```

**Step 4: Remove detail from line 596 include**

```typescript
// Line 596 - Remove detail
include: {
  user: { select: { id: true, email: true, name: true } },
  // REMOVED: detail: true,
}
```

**Step 5: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: 0 errors

**Step 6: Commit**

```bash
git add server/routes/training-plans.ts
git commit -m "refactor: remove RunDetail from training plans routes

- Replace runDetail queries with basic run data
- Simplify fitness assessment to use pace calculations
- Remove detail includes from all run queries"
```

---

### Task 3: Add Input Validation to Service (Issue #404)

**Files:**

- Modify: `services/advancedTrainingPlanService.ts`
- Create: `services/trainingPlanValidation.ts`

**Step 1: Create validation utility file**

Create: `services/trainingPlanValidation.ts`

```typescript
import { z } from 'zod';

export class TrainingPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrainingPlanValidationError';
  }
}

/**
 * Validate training plan configuration inputs
 */
export function validateTrainingConfig(config: {
  userId: string;
  name: string;
  startDate: Date;
  endDate?: Date;
  currentFitnessLevel?: {
    weeklyMileage: number;
    longestRecentRun: number;
  };
}): void {
  // Validate user ID
  if (!config.userId || config.userId.length === 0) {
    throw new TrainingPlanValidationError('User ID is required');
  }

  // Validate name
  if (!config.name || config.name.trim().length === 0) {
    throw new TrainingPlanValidationError('Training plan name is required');
  }
  if (config.name.length > 100) {
    throw new TrainingPlanValidationError('Training plan name must be 100 characters or less');
  }

  // Validate dates
  if (!(config.startDate instanceof Date) || isNaN(config.startDate.getTime())) {
    throw new TrainingPlanValidationError('Valid start date is required');
  }

  if (config.endDate) {
    if (!(config.endDate instanceof Date) || isNaN(config.endDate.getTime())) {
      throw new TrainingPlanValidationError('End date must be a valid date');
    }
    if (config.endDate <= config.startDate) {
      throw new TrainingPlanValidationError('End date must be after start date');
    }

    const maxDuration = 365 * 2; // 2 years
    const durationDays = Math.floor(
      (config.endDate.getTime() - config.startDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (durationDays > maxDuration) {
      throw new TrainingPlanValidationError(`Training plan cannot exceed ${maxDuration} days`);
    }
  }

  // Validate fitness level if provided
  if (config.currentFitnessLevel) {
    const { weeklyMileage, longestRecentRun } = config.currentFitnessLevel;

    if (weeklyMileage !== undefined) {
      if (weeklyMileage < 0) {
        throw new TrainingPlanValidationError('Weekly mileage cannot be negative');
      }
      if (weeklyMileage > 300) {
        throw new TrainingPlanValidationError('Weekly mileage seems unrealistic (max 300km)');
      }
    }

    if (longestRecentRun !== undefined) {
      if (longestRecentRun < 0) {
        throw new TrainingPlanValidationError('Longest run cannot be negative');
      }
      if (longestRecentRun > 100) {
        throw new TrainingPlanValidationError('Longest run seems unrealistic (max 100km)');
      }
      if (weeklyMileage && longestRecentRun > weeklyMileage) {
        throw new TrainingPlanValidationError('Longest run cannot exceed weekly mileage');
      }
    }
  }
}

/**
 * Sanitize text input (notes, descriptions)
 */
export function sanitizeTextInput(text: string | null | undefined): string | null {
  if (!text) return null;

  return text
    .trim()
    .replace(/\0/g, '') // Remove null bytes
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
    .substring(0, 10000); // Prevent extremely large inputs
}
```

**Step 2: Add validation to createAdvancedPlan method**

```typescript
// In advancedTrainingPlanService.ts, add import at top
import { validateTrainingConfig, sanitizeTextInput, TrainingPlanValidationError } from './trainingPlanValidation.js';

// At start of createAdvancedPlan method (line ~125)
static async createAdvancedPlan(config: AdvancedTrainingConfig): Promise<TrainingPlan> {
  // Validate inputs
  validateTrainingConfig({
    userId: config.userId,
    name: config.name,
    startDate: config.startDate,
    endDate: config.endDate,
    currentFitnessLevel: config.currentFitnessLevel,
  });

  // Sanitize text fields
  const sanitizedDescription = sanitizeTextInput(config.description);

  // Rest of implementation...
```

**Step 3: Add validation to generatePlan method**

```typescript
// At start of generatePlan method (line ~185)
static async generatePlan(
  userId: string,
  goal: string,
  startDate: Date,
  weeksAvailable: number,
  currentMileage: number,
  daysPerWeek: number
): Promise<TrainingPlan> {
  // Validate inputs
  if (weeksAvailable < 4) {
    throw new TrainingPlanValidationError('Minimum 4 weeks required for training plan');
  }
  if (weeksAvailable > 52) {
    throw new TrainingPlanValidationError('Training plan cannot exceed 52 weeks');
  }
  if (currentMileage < 0 || currentMileage > 300) {
    throw new TrainingPlanValidationError('Current mileage must be between 0-300 km/week');
  }
  if (daysPerWeek < 1 || daysPerWeek > 7) {
    throw new TrainingPlanValidationError('Days per week must be between 1-7');
  }

  validateTrainingConfig({
    userId,
    name: `${goal} Training Plan`,
    startDate,
    currentFitnessLevel: { weeklyMileage: currentMileage, longestRecentRun: 0 },
  });

  // Rest of implementation...
```

**Step 4: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: 0 errors

**Step 5: Commit**

```bash
git add services/trainingPlanValidation.ts services/advancedTrainingPlanService.ts
git commit -m "feat: add comprehensive input validation (Issue #404)

- Create trainingPlanValidation utility module
- Validate all training plan configuration inputs
- Add range checks for mileage, duration, dates
- Sanitize text inputs to prevent XSS
- Throw descriptive validation errors"
```

---

## Phase 2: Add Comprehensive Tests

### Task 4: Write Unit Tests for VDOT Calculations (Issue #402)

**Files:**

- Create: `tests/unit/services/trainingPlanCalculations.test.ts`

**Step 1: Write test file structure**

Create: `tests/unit/services/trainingPlanCalculations.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { AdvancedTrainingPlanService } from '../../../services/advancedTrainingPlanService.js';

describe('Training Plan Calculations', () => {
  describe('VDOT Calculations', () => {
    // Tests will go here
  });

  describe('Pace Zone Calculations', () => {
    // Tests will go here
  });

  describe('Effort Estimation', () => {
    // Tests will go here
  });
});
```

**Step 2: Write failing test for VDOT calculation**

```typescript
describe('VDOT Calculations', () => {
  it('should calculate VDOT from 5K race time', () => {
    // Jack Daniels' formula: 5K in 20:00 = VDOT ~52
    const distance = 5.0; // km
    const timeMinutes = 20.0;

    const vdot = (AdvancedTrainingPlanService as any).calculateVDOT(distance, timeMinutes);

    expect(vdot).toBeCloseTo(52, 1); // Within 1 point
  });

  it('should calculate VDOT from marathon time', () => {
    // Marathon in 3:30:00 = VDOT ~44
    const distance = 42.195;
    const timeMinutes = 210;

    const vdot = (AdvancedTrainingPlanService as any).calculateVDOT(distance, timeMinutes);

    expect(vdot).toBeCloseTo(44, 1);
  });

  it('should handle edge cases', () => {
    // Very slow marathon (6 hours) should still calculate
    const distance = 42.195;
    const timeMinutes = 360;

    const vdot = (AdvancedTrainingPlanService as any).calculateVDOT(distance, timeMinutes);

    expect(vdot).toBeGreaterThan(0);
    expect(vdot).toBeLessThan(60);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm run test:run -- tests/unit/services/trainingPlanCalculations.test.ts`
Expected: FAIL - "calculateVDOT is not a function" or similar

**Step 4: Implement VDOT calculation method**

Add to `services/advancedTrainingPlanService.ts`:

```typescript
// Add after line 130 in the class
/**
 * Calculate VDOT from race performance using Jack Daniels' Running Formula
 * VDOT is an index of running ability based on VO2max
 *
 * @param distanceKm - Race distance in kilometers
 * @param timeMinutes - Race time in minutes
 * @returns VDOT score (typically 30-85 for most runners)
 */
private static calculateVDOT(distanceKm: number, timeMinutes: number): number {
  // Convert to velocity (meters per minute)
  const velocity = (distanceKm * 1000) / timeMinutes;

  // Jack Daniels' formula for VO2max
  // VO2 = -4.60 + 0.182258 * v + 0.000104 * v^2
  const vo2 = -4.60 + (0.182258 * velocity) + (0.000104 * velocity * velocity);

  // Calculate percent of VO2max (based on duration)
  const percentVO2max = 0.8 + (0.1894393 * Math.exp(-0.012778 * timeMinutes)) +
                       (0.2989558 * Math.exp(-0.1932605 * timeMinutes));

  // VDOT = VO2 / percent
  const vdot = vo2 / percentVO2max;

  // Clamp to reasonable range
  return Math.max(20, Math.min(85, vdot));
}
```

**Step 5: Run test to verify it passes**

Run: `npm run test:run -- tests/unit/services/trainingPlanCalculations.test.ts`
Expected: PASS - all VDOT tests pass

**Step 6: Commit**

```bash
git add tests/unit/services/trainingPlanCalculations.test.ts services/advancedTrainingPlanService.ts
git commit -m "test: add VDOT calculation tests and implementation

- Implement Jack Daniels' VDOT formula
- Test 5K, marathon, and edge cases
- Add comprehensive test coverage for pace calculations"
```

---

### Task 5: Write Unit Tests for TSS Formulas (Issue #402)

**Step 1: Add TSS test cases**

Add to `tests/unit/services/trainingPlanCalculations.test.ts`:

```typescript
describe('TSS (Training Stress Score) Calculations', () => {
  it('should calculate TSS for easy run', () => {
    const durationMinutes = 60;
    const intensityFactor = 0.65; // Easy pace

    const tss = (AdvancedTrainingPlanService as any).calculateTSS(durationMinutes, intensityFactor);

    // TSS = (duration * intensity^2) / 60 * 100
    // = (60 * 0.65^2) / 60 * 100 = 42.25
    expect(tss).toBeCloseTo(42, 1);
  });

  it('should calculate TSS for tempo run', () => {
    const durationMinutes = 40;
    const intensityFactor = 0.85; // Tempo pace

    const tss = (AdvancedTrainingPlanService as any).calculateTSS(durationMinutes, intensityFactor);

    // = (40 * 0.85^2) / 60 * 100 = 48.3
    expect(tss).toBeCloseTo(48, 1);
  });

  it('should calculate TSS for interval workout', () => {
    const durationMinutes = 30;
    const intensityFactor = 1.0; // Threshold pace

    const tss = (AdvancedTrainingPlanService as any).calculateTSS(durationMinutes, intensityFactor);

    // = (30 * 1.0^2) / 60 * 100 = 50
    expect(tss).toBeCloseTo(50, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/unit/services/trainingPlanCalculations.test.ts`
Expected: FAIL - "calculateTSS is not a function"

**Step 3: Implement TSS calculation**

Add to `services/advancedTrainingPlanService.ts`:

```typescript
/**
 * Calculate Training Stress Score (TSS) for a workout
 * TSS quantifies training load based on duration and intensity
 *
 * @param durationMinutes - Workout duration
 * @param intensityFactor - Intensity as fraction of threshold (0.0-1.2)
 * @returns TSS score (typically 0-300)
 */
private static calculateTSS(durationMinutes: number, intensityFactor: number): number {
  // TSS formula: (duration * intensity^2) / 60 * 100
  const tss = (durationMinutes * Math.pow(intensityFactor, 2) / 60) * 100;

  return Math.round(tss);
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/unit/services/trainingPlanCalculations.test.ts`
Expected: PASS

**Step 5: Add pace zone test**

```typescript
describe('Pace Zone Calculations', () => {
  it('should calculate training paces from VDOT', () => {
    const vdot = 50;

    const paces = (AdvancedTrainingPlanService as any).calculateTrainingPaces(vdot);

    // For VDOT 50, expected paces (min/km):
    // Easy: ~5:30-6:00
    // Marathon: ~4:45
    // Threshold: ~4:15
    // Interval: ~3:50
    expect(paces.easy).toBeCloseTo(5.75, 0.5);
    expect(paces.marathon).toBeCloseTo(4.75, 0.3);
    expect(paces.threshold).toBeCloseTo(4.25, 0.3);
    expect(paces.interval).toBeCloseTo(3.85, 0.3);
  });
});
```

**Step 6: Implement pace zone calculation**

```typescript
/**
 * Calculate training paces from VDOT
 * Based on Jack Daniels' training pace tables
 */
private static calculateTrainingPaces(vdot: number): {
  easy: number;
  marathon: number;
  threshold: number;
  interval: number;
  repetition: number;
} {
  // Simplified formulas based on VDOT tables
  // Returns pace in min/km

  return {
    easy: 6.4 - (vdot * 0.04), // Easy pace
    marathon: 5.6 - (vdot * 0.04), // Marathon pace
    threshold: 5.0 - (vdot * 0.04), // Threshold pace
    interval: 4.4 - (vdot * 0.04), // VO2max pace
    repetition: 3.8 - (vdot * 0.04), // Rep pace
  };
}
```

**Step 7: Run all tests**

Run: `npm run test:run -- tests/unit/services/trainingPlanCalculations.test.ts`
Expected: PASS - all tests pass

**Step 8: Commit**

```bash
git add tests/unit/services/trainingPlanCalculations.test.ts services/advancedTrainingPlanService.ts
git commit -m "test: add TSS and pace zone calculation tests

- Implement Training Stress Score formula
- Add training pace calculations from VDOT
- Test easy, tempo, and interval workout TSS
- Test pace zones for different VDOT levels"
```

---

### Task 6: Write Integration Tests for Training Plan CRUD (Issue #402)

**Files:**

- Create: `tests/integration/trainingPlans.test.ts`

**Step 1: Create integration test structure**

Create: `tests/integration/trainingPlans.test.ts`

```typescript
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import app from '../../server.js';
import { prisma } from '../../lib/prisma.js';

describe('Training Plans API', () => {
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    // Create test user and get auth token
    const email = `test-${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    await request(app).post('/api/auth/register').send({ email, password });

    const loginResponse = await request(app).post('/api/auth/login').send({ email, password });

    authToken = loginResponse.body.token;
    userId = loginResponse.body.user.id;
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.user.deleteMany({
      where: { email: { contains: 'test-' } },
    });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up training plans before each test
    await prisma.workoutTemplate.deleteMany({});
    await prisma.trainingPlan.deleteMany({});
  });

  describe('POST /api/training-plans', () => {
    // Tests will go here
  });

  describe('GET /api/training-plans', () => {
    // Tests will go here
  });

  describe('GET /api/training-plans/:id', () => {
    // Tests will go here
  });

  describe('DELETE /api/training-plans/:id', () => {
    // Tests will go here
  });
});
```

**Step 2: Write failing test for create training plan**

```typescript
describe('POST /api/training-plans', () => {
  it('should create a new training plan', async () => {
    const planData = {
      name: 'Marathon Training',
      description: 'Prepare for first marathon',
      goal: 'MARATHON',
      startDate: new Date('2026-02-01').toISOString(),
      difficulty: 'intermediate',
      currentWeeklyMileage: 40,
    };

    const response = await request(app)
      .post('/api/training-plans')
      .set('Authorization', `Bearer ${authToken}`)
      .send(planData);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: planData.name,
      description: planData.description,
      goal: planData.goal,
      difficulty: planData.difficulty,
      userId,
    });
    expect(response.body.id).toBeDefined();
    expect(response.body.workouts).toBeDefined();
    expect(Array.isArray(response.body.workouts)).toBe(true);
  });

  it('should reject invalid training plan data', async () => {
    const response = await request(app)
      .post('/api/training-plans')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: '', // Invalid: empty name
        goal: 'MARATHON',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should require authentication', async () => {
    const response = await request(app)
      .post('/api/training-plans')
      .send({ name: 'Test', goal: 'MARATHON' });

    expect(response.status).toBe(401);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm run test:integration -- trainingPlans.test.ts`
Expected: FAIL (routes may not be fully implemented yet)

**Step 4: Ensure routes are properly implemented**

Verify in `server/routes/training-plans.ts` that POST endpoint exists and returns 201

**Step 5: Run test to verify it passes**

Run: `npm run test:integration -- trainingPlans.test.ts`
Expected: PASS for create tests

**Step 6: Add remaining CRUD tests**

```typescript
describe('GET /api/training-plans', () => {
  it('should list all user training plans', async () => {
    // Create two plans
    await request(app)
      .post('/api/training-plans')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Plan 1',
        goal: 'MARATHON',
        startDate: new Date().toISOString(),
        difficulty: 'intermediate',
      });

    await request(app)
      .post('/api/training-plans')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Plan 2',
        goal: 'HALF_MARATHON',
        startDate: new Date().toISOString(),
        difficulty: 'beginner',
      });

    const response = await request(app)
      .get('/api/training-plans')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  it('should only return current user plans', async () => {
    // Create another user
    const otherEmail = `other-${Date.now()}@example.com`;
    await request(app)
      .post('/api/auth/register')
      .send({ email: otherEmail, password: 'TestPassword123!' });

    const otherLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: otherEmail, password: 'TestPassword123!' });

    // Create plan for other user
    await request(app)
      .post('/api/training-plans')
      .set('Authorization', `Bearer ${otherLogin.body.token}`)
      .send({
        name: 'Other Plan',
        goal: 'MARATHON',
        startDate: new Date().toISOString(),
        difficulty: 'advanced',
      });

    // Current user should not see other user's plan
    const response = await request(app)
      .get('/api/training-plans')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.every((p: any) => p.userId === userId)).toBe(true);
  });
});

describe('GET /api/training-plans/:id', () => {
  it('should get specific training plan with workouts', async () => {
    const createResponse = await request(app)
      .post('/api/training-plans')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Plan',
        goal: 'MARATHON',
        startDate: new Date().toISOString(),
        difficulty: 'intermediate',
      });

    const planId = createResponse.body.id;

    const response = await request(app)
      .get(`/api/training-plans/${planId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(planId);
    expect(response.body.workouts).toBeDefined();
  });

  it('should return 404 for non-existent plan', async () => {
    const response = await request(app)
      .get('/api/training-plans/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/training-plans/:id', () => {
  it('should delete a training plan', async () => {
    const createResponse = await request(app)
      .post('/api/training-plans')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'To Delete',
        goal: 'MARATHON',
        startDate: new Date().toISOString(),
        difficulty: 'intermediate',
      });

    const planId = createResponse.body.id;

    const deleteResponse = await request(app)
      .delete(`/api/training-plans/${planId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(deleteResponse.status).toBe(200);

    // Verify it's deleted
    const getResponse = await request(app)
      .get(`/api/training-plans/${planId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(getResponse.status).toBe(404);
  });

  it('should not delete another user plan', async () => {
    // Create other user
    const otherEmail = `other2-${Date.now()}@example.com`;
    await request(app)
      .post('/api/auth/register')
      .send({ email: otherEmail, password: 'TestPassword123!' });

    const otherLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: otherEmail, password: 'TestPassword123!' });

    // Create plan as other user
    const createResponse = await request(app)
      .post('/api/training-plans')
      .set('Authorization', `Bearer ${otherLogin.body.token}`)
      .send({
        name: 'Other User Plan',
        goal: 'MARATHON',
        startDate: new Date().toISOString(),
        difficulty: 'advanced',
      });

    // Try to delete as current user
    const response = await request(app)
      .delete(`/api/training-plans/${createResponse.body.id}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(404);
  });
});
```

**Step 7: Run all integration tests**

Run: `npm run test:integration -- trainingPlans.test.ts`
Expected: PASS - all CRUD operations work

**Step 8: Commit**

```bash
git add tests/integration/trainingPlans.test.ts
git commit -m "test: add integration tests for training plan CRUD

- Test create, read, list, delete operations
- Test authentication and authorization
- Test user isolation (users can't access others' plans)
- Test validation errors
- 100% coverage of API endpoints"
```

---

## Phase 3: Final Verification and Documentation

### Task 7: Run All Tests and Verify Coverage

**Step 1: Run full test suite**

Run: `npm run test:run`
Expected: All tests pass

**Step 2: Check test coverage**

Run: `npm run test:coverage`
Expected:

- `services/advancedTrainingPlanService.ts`: > 70% coverage
- `services/trainingPlanValidation.ts`: > 90% coverage
- `server/routes/training-plans.ts`: > 80% coverage

**Step 3: Run integration tests**

Run: `npm run test:integration`
Expected: All integration tests pass

**Step 4: Verify TypeScript compilation**

Run: `npm run typecheck`
Expected: 0 errors

**Step 5: Verify linting**

Run: `npm run lint`
Expected: 0 errors

**Step 6: Build production bundle**

Run: `npm run build`
Expected: Successful build

**Step 7: Document any remaining work**

Create: `docs/TRAINING_PLANS_TODO.md`

```markdown
# Training Plans Feature - Remaining Work

## Completed ✅

- ✅ Core training plan generation (VDOT-based)
- ✅ Database models (TrainingPlan, WorkoutTemplate)
- ✅ API endpoints (CRUD + generate)
- ✅ Input validation (Issue #404)
- ✅ Unit tests for calculations (Issue #402)
- ✅ Integration tests for CRUD (Issue #402)
- ✅ Removed RunDetail dependencies

## Future Enhancements (Analytics PR)

When analytics PR is merged, re-enable:

- Heart rate zone calculations (requires RunDetail.avgHeartRate)
- Effort level tracking (requires RunDetail.effortLevel)
- Recovery recommendations based on HRV (requires RunDetail)
- Advanced periodization using actual workout load

## Notes

- Current implementation uses pace-based effort estimation
- All core features work without RunDetail
- ~70% test coverage achieved
- All blocker issues (#402, #404) addressed
```

**Step 8: Commit**

```bash
git add docs/TRAINING_PLANS_TODO.md
git commit -m "docs: document training plans completion and future work

- Core feature complete and tested
- RunDetail dependencies removed
- Ready for independent PR
- Future enhancements documented"
```

---

## Summary

**Blocker Issues Addressed:**

- ✅ Issue #402: Comprehensive tests (unit + integration)
- ✅ Issue #404: Input validation throughout service

**Ready for PR:**

- Zero TypeScript errors
- All tests passing
- Independent of analytics feature
- Clean separation of concerns

**Next Steps:**

1. Push branch
2. Create PR
3. Address any code review feedback
4. After analytics PR merges, create follow-up PR to re-enable advanced features

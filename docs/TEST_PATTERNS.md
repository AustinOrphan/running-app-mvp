# Test Patterns and Best Practices

This document outlines testing patterns, conventions, and best practices for the Running App MVP. It covers unit tests, integration tests, and end-to-end tests with specific examples and guidelines.

## Table of Contents

- [Testing Philosophy](#testing-philosophy)
- [Test Strategy Overview](#test-strategy-overview)
- [Unit Test Patterns](#unit-test-patterns)
- [Integration Test Patterns](#integration-test-patterns)
- [End-to-End Test Patterns](#end-to-end-test-patterns)
- [Common Testing Utilities](#common-testing-utilities)
- [Best Practices](#best-practices)
- [Performance Guidelines](#performance-guidelines)
- [Debugging and Troubleshooting](#debugging-and-troubleshooting)

## Testing Philosophy

### Testing Pyramid

The Running App MVP follows the testing pyramid principle:

```
    /\
   /E2E\     ← Few, expensive, high-level tests
  /____\
 /      \
/Integration\ ← Some tests for API and database integration
\____________/
\            /
 \   Unit   /  ← Many, fast, focused tests
  \________/
```

### Test Coverage Goals

- **Unit Tests**: 80%+ code coverage
- **Integration Tests**: Cover all API endpoints and database operations
- **E2E Tests**: Cover critical user journeys and business flows

### Test Classification

- **Unit Tests**: Test individual functions, components, and modules in isolation
- **Integration Tests**: Test interactions between components, API endpoints, and database
- **E2E Tests**: Test complete user workflows from browser perspective

## Test Strategy Overview

### Test Framework Setup

- **Unit Tests**: Vitest (fast, modern alternative to Jest)
- **Integration Tests**: Jest with Supertest for API testing
- **E2E Tests**: Playwright for cross-browser testing

### File Organization

```
tests/
├── unit/                    # Unit tests
│   ├── components/         # React component tests
│   ├── utils/             # Utility function tests
│   └── services/          # Service layer tests
├── integration/            # Integration tests
│   ├── api/               # API endpoint tests
│   ├── database/          # Database operation tests
│   └── services/          # Service integration tests
├── e2e/                   # End-to-end tests
│   ├── auth/              # Authentication flows
│   ├── goals/             # Goal management
│   ├── runs/              # Run tracking
│   └── accessibility/     # A11y tests
├── fixtures/              # Test data and fixtures
├── factories/             # Data factories
├── setup/                 # Test setup and configuration
└── utils/                 # Test utilities
```

## Unit Test Patterns

### React Component Testing

#### Basic Component Testing Pattern

```typescript
// tests/unit/components/Button.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('calls onClick handler when clicked', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    
    render(<Button onClick={handleClick}>Click me</Button>);
    
    await user.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('applies correct CSS classes', () => {
    render(<Button variant="primary" size="large">Button</Button>);
    const button = screen.getByRole('button');
    
    expect(button).toHaveClass('btn', 'btn-primary', 'btn-large');
  });
});
```

#### Form Component Testing Pattern

```typescript
// tests/unit/components/CreateGoalModal.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateGoalModal } from '@/components/goals/CreateGoalModal';
import { dateTestUtils } from '../../utils/dateTestUtils';

describe('CreateGoalModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits form with correct data', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    
    render(<CreateGoalModal {...defaultProps} onSave={onSave} />);
    
    // Fill form fields
    await user.selectOptions(screen.getByLabelText(/goal type/i), 'distance');
    await user.selectOptions(screen.getByLabelText(/period/i), 'weekly');
    await user.type(screen.getByLabelText(/target value/i), '25');
    
    // Use date test utility for consistent date handling
    await dateTestUtils.setDateInput(
      screen.getByLabelText(/start date/i),
      '2024-01-01'
    );
    
    await user.click(screen.getByRole('button', { name: /save goal/i }));
    
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        type: 'distance',
        period: 'weekly',
        targetValue: 25,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: expect.any(String),
      });
    });
  });

  it('shows validation errors for invalid input', async () => {
    const user = userEvent.setup();
    
    render(<CreateGoalModal {...defaultProps} />);
    
    // Submit without filling required fields
    await user.click(screen.getByRole('button', { name: /save goal/i }));
    
    expect(screen.getByText(/target value is required/i)).toBeInTheDocument();
    expect(screen.getByText(/start date is required/i)).toBeInTheDocument();
  });
});
```

#### Hook Testing Pattern

```typescript
// tests/unit/hooks/useGoals.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGoals } from '@/hooks/useGoals';
import { goalsApi } from '@/services/api';

// Mock the API
vi.mock('@/services/api', () => ({
  goalsApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
}));

describe('useGoals', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('fetches goals successfully', async () => {
    const mockGoals = [
      { id: '1', type: 'distance', targetValue: 25, period: 'weekly' },
    ];
    
    vi.mocked(goalsApi.getAll).mockResolvedValue(mockGoals);
    
    const { result } = renderHook(() => useGoals(), { wrapper });
    
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    
    expect(result.current.data).toEqual(mockGoals);
  });

  it('handles error states', async () => {
    vi.mocked(goalsApi.getAll).mockRejectedValue(new Error('API Error'));
    
    const { result } = renderHook(() => useGoals(), { wrapper });
    
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
```

### Utility Function Testing

```typescript
// tests/unit/utils/calculations.test.ts
import { calculatePace, formatDuration, validateGoalProgress } from '@/utils/calculations';

describe('calculations', () => {
  describe('calculatePace', () => {
    it('calculates pace correctly for valid inputs', () => {
      expect(calculatePace(5000, 1800)).toBe(6.0); // 5km in 30min = 6 min/km
      expect(calculatePace(10000, 2400)).toBe(4.0); // 10km in 40min = 4 min/km
    });

    it('handles edge cases', () => {
      expect(calculatePace(0, 1800)).toBe(0);
      expect(calculatePace(5000, 0)).toBe(0);
      expect(calculatePace(0, 0)).toBe(0);
    });

    it('rounds to 2 decimal places', () => {
      expect(calculatePace(3333, 1000)).toBe(5.00);
      expect(calculatePace(7777, 2222)).toBe(4.28);
    });
  });

  describe('formatDuration', () => {
    it('formats seconds correctly', () => {
      expect(formatDuration(30)).toBe('0:30');
      expect(formatDuration(90)).toBe('1:30');
      expect(formatDuration(3661)).toBe('1:01:01');
    });
  });

  describe('validateGoalProgress', () => {
    it('validates progress within bounds', () => {
      expect(validateGoalProgress(15, 25)).toBe(true);
      expect(validateGoalProgress(25, 25)).toBe(true);
      expect(validateGoalProgress(0, 25)).toBe(true);
    });

    it('rejects invalid progress', () => {
      expect(validateGoalProgress(-5, 25)).toBe(false);
      expect(validateGoalProgress(30, 25)).toBe(false);
      expect(validateGoalProgress(NaN, 25)).toBe(false);
    });
  });
});
```

### Service Layer Testing

```typescript
// tests/unit/services/goalsService.test.ts
import { goalsService } from '@/services/goalsService';
import { goalsApi } from '@/services/api';

vi.mock('@/services/api');

describe('goalsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateGoalProgress', () => {
    it('updates goal progress and recalculates completion status', async () => {
      const goal = {
        id: '1',
        targetValue: 25,
        currentValue: 15,
        isCompleted: false,
      };

      vi.mocked(goalsApi.update).mockResolvedValue({
        ...goal,
        currentValue: 25,
        isCompleted: true,
      });

      const result = await goalsService.updateGoalProgress('1', 25);

      expect(goalsApi.update).toHaveBeenCalledWith('1', {
        currentValue: 25,
        isCompleted: true,
      });
      expect(result.isCompleted).toBe(true);
    });

    it('handles validation errors', async () => {
      await expect(
        goalsService.updateGoalProgress('1', -5)
      ).rejects.toThrow('Progress value cannot be negative');
    });
  });
});
```

## Integration Test Patterns

### API Endpoint Testing

```typescript
// tests/integration/api/goals.test.ts
import request from 'supertest';
import { app } from '../../../server';
import { testDb } from '../../setup/testDatabase';
import { createTestUser, generateAuthToken } from '../../utils/authHelpers';

describe('Goals API', () => {
  let testUser: any;
  let authToken: string;

  beforeEach(async () => {
    await testDb.goal.deleteMany();
    await testDb.user.deleteMany();
    
    testUser = await createTestUser({
      email: 'test@example.com',
      password: 'password123',
    });
    authToken = generateAuthToken(testUser);
  });

  describe('POST /api/goals', () => {
    it('creates a new goal', async () => {
      const goalData = {
        type: 'distance',
        period: 'weekly',
        targetValue: 25,
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
      };

      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        userId: testUser.id,
        ...goalData,
        currentValue: 0,
        isCompleted: false,
        isActive: true,
      });

      // Verify in database
      const dbGoal = await testDb.goal.findUnique({
        where: { id: response.body.id },
      });
      expect(dbGoal).toBeTruthy();
    });

    it('validates required fields', async () => {
      const response = await request(app)
        .post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toHaveProperty('type');
      expect(response.body.details).toHaveProperty('targetValue');
    });

    it('requires authentication', async () => {
      await request(app)
        .post('/api/goals')
        .send({ type: 'distance', targetValue: 25 })
        .expect(401);
    });
  });

  describe('PUT /api/goals/:id', () => {
    it('updates goal with currentValue', async () => {
      const goal = await testDb.goal.create({
        data: {
          userId: testUser.id,
          type: 'distance',
          period: 'weekly',
          targetValue: 25,
          currentValue: 0,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
      });

      const response = await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ currentValue: 15 })
        .expect(200);

      expect(response.body.currentValue).toBe(15);
      expect(response.body.isCompleted).toBe(false);

      // Test completion
      await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ currentValue: 25 })
        .expect(200);

      const completedResponse = await request(app)
        .get(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(completedResponse.body.isCompleted).toBe(true);
    });

    it('prevents unauthorized access to other users goals', async () => {
      const otherUser = await createTestUser({
        email: 'other@example.com',
        password: 'password123',
      });

      const goal = await testDb.goal.create({
        data: {
          userId: otherUser.id,
          type: 'distance',
          period: 'weekly',
          targetValue: 25,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
      });

      await request(app)
        .put(`/api/goals/${goal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ currentValue: 15 })
        .expect(403);
    });
  });
});
```

### Database Transaction Testing

```typescript
// tests/integration/database/transactions.test.ts
import { testDb } from '../../setup/testDatabase';
import { goalsService } from '../../../src/services/goalsService';

describe('Database Transactions', () => {
  let testUser: any;

  beforeEach(async () => {
    await testDb.user.deleteMany();
    await testDb.goal.deleteMany();
    await testDb.run.deleteMany();
    
    testUser = await testDb.user.create({
      data: {
        email: 'test@example.com',
        password: 'hashedpassword',
      },
    });
  });

  it('handles transaction rollback on error', async () => {
    const goal = await testDb.goal.create({
      data: {
        userId: testUser.id,
        type: 'distance',
        period: 'weekly',
        targetValue: 25,
        currentValue: 0,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      },
    });

    // Mock an error during transaction
    const originalUpdate = testDb.goal.update;
    testDb.goal.update = vi.fn().mockRejectedValue(new Error('Database error'));

    try {
      await goalsService.updateGoalWithRunData(goal.id, {
        distance: 5,
        date: new Date(),
      });
    } catch (error) {
      // Transaction should have rolled back
      const unchangedGoal = await testDb.goal.findUnique({
        where: { id: goal.id },
      });
      expect(unchangedGoal?.currentValue).toBe(0);
    }

    // Restore original function
    testDb.goal.update = originalUpdate;
  });

  it('maintains data consistency across related entities', async () => {
    const goal = await testDb.goal.create({
      data: {
        userId: testUser.id,
        type: 'distance',
        period: 'weekly',
        targetValue: 25,
        currentValue: 15,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      },
    });

    // Create run and update goal in transaction
    await testDb.$transaction(async (tx) => {
      const run = await tx.run.create({
        data: {
          userId: testUser.id,
          date: new Date(),
          distance: 10,
          duration: 3600,
        },
      });

      await tx.goal.update({
        where: { id: goal.id },
        data: { currentValue: 25, isCompleted: true },
      });
    });

    // Verify both changes were applied
    const [updatedGoal, runCount] = await Promise.all([
      testDb.goal.findUnique({ where: { id: goal.id } }),
      testDb.run.count({ where: { userId: testUser.id } }),
    ]);

    expect(updatedGoal?.currentValue).toBe(25);
    expect(updatedGoal?.isCompleted).toBe(true);
    expect(runCount).toBe(1);
  });
});
```

### Service Integration Testing

```typescript
// tests/integration/services/statsService.test.ts
import { statsService } from '../../../src/services/statsService';
import { testDb } from '../../setup/testDatabase';
import { createTestUser } from '../../utils/authHelpers';
import { runFactory } from '../../factories/runFactory';

describe('StatsService Integration', () => {
  let testUser: any;

  beforeEach(async () => {
    await testDb.run.deleteMany();
    await testDb.user.deleteMany();
    
    testUser = await createTestUser({
      email: 'test@example.com',
      password: 'password123',
    });
  });

  describe('getWeeklyInsights', () => {
    it('calculates weekly stats correctly', async () => {
      // Create test runs for current week
      const weekStart = new Date('2024-01-15'); // Monday
      const runs = await Promise.all([
        runFactory.create({
          userId: testUser.id,
          date: new Date('2024-01-15T08:00:00Z'),
          distance: 5,
          duration: 1800,
        }),
        runFactory.create({
          userId: testUser.id,
          date: new Date('2024-01-17T18:00:00Z'),
          distance: 8,
          duration: 2400,
        }),
        runFactory.create({
          userId: testUser.id,
          date: new Date('2024-01-19T07:00:00Z'),
          distance: 12,
          duration: 3600,
        }),
      ]);

      const insights = await statsService.getWeeklyInsights(testUser.id, weekStart);

      expect(insights).toEqual({
        totalDistance: 25,
        totalDuration: 7800,
        totalRuns: 3,
        avgPace: expect.closeTo(5.2, 1),
        weekStart: weekStart.toISOString(),
        weekEnd: expect.any(String),
        hasData: true,
      });
    });

    it('returns empty insights for week with no runs', async () => {
      const weekStart = new Date('2024-01-15');
      
      const insights = await statsService.getWeeklyInsights(testUser.id, weekStart);

      expect(insights).toEqual({
        totalDistance: 0,
        totalDuration: 0,
        totalRuns: 0,
        avgPace: 0,
        weekStart: weekStart.toISOString(),
        weekEnd: expect.any(String),
        hasData: false,
      });
    });
  });

  describe('getRunTypeBreakdown', () => {
    it('groups runs by type with aggregated stats', async () => {
      await Promise.all([
        runFactory.create({
          userId: testUser.id,
          runType: 'easy',
          distance: 5,
          duration: 1800,
        }),
        runFactory.create({
          userId: testUser.id,
          runType: 'easy',
          distance: 6,
          duration: 2100,
        }),
        runFactory.create({
          userId: testUser.id,
          runType: 'tempo',
          distance: 8,
          duration: 2000,
        }),
      ]);

      const breakdown = await statsService.getRunTypeBreakdown(testUser.id);

      expect(breakdown.breakdown).toEqual([
        {
          runType: 'easy',
          count: 2,
          totalDistance: 11,
          averagePace: expect.closeTo(5.86, 1),
        },
        {
          runType: 'tempo',
          count: 1,
          totalDistance: 8,
          averagePace: 4.17,
        },
      ]);
    });
  });
});
```

## End-to-End Test Patterns

### User Authentication Flow

```typescript
// tests/e2e/auth/login.test.ts
import { test, expect } from '@playwright/test';
import { createTestUser } from '../utils/testHelpers';

test.describe('User Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('successful login flow', async ({ page }) => {
    const testUser = await createTestUser({
      email: 'test@example.com',
      password: 'TestPassword123!',
    });

    // Navigate to login
    await page.click('[data-testid="login-button"]');
    await expect(page).toHaveURL('/login');

    // Fill login form
    await page.fill('[data-testid="email-input"]', testUser.email);
    await page.fill('[data-testid="password-input"]', 'TestPassword123!');
    await page.click('[data-testid="submit-button"]');

    // Verify successful login
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('[data-testid="user-profile"]')).toContainText(testUser.email);

    // Verify auth token is stored
    const token = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(token).toBeTruthy();
  });

  test('displays error for invalid credentials', async ({ page }) => {
    await page.click('[data-testid="login-button"]');
    
    await page.fill('[data-testid="email-input"]', 'invalid@example.com');
    await page.fill('[data-testid="password-input"]', 'wrongpassword');
    await page.click('[data-testid="submit-button"]');

    await expect(page.locator('[data-testid="error-message"]')).toContainText(
      'Invalid email or password'
    );
    await expect(page).toHaveURL('/login');
  });

  test('validates required fields', async ({ page }) => {
    await page.click('[data-testid="login-button"]');
    await page.click('[data-testid="submit-button"]');

    await expect(page.locator('[data-testid="email-error"]')).toContainText(
      'Email is required'
    );
    await expect(page.locator('[data-testid="password-error"]')).toContainText(
      'Password is required'
    );
  });
});
```

### Goal Management Flow

```typescript
// tests/e2e/goals/goal-management.test.ts
import { test, expect } from '@playwright/test';
import { loginAsTestUser } from '../utils/authHelpers';

test.describe('Goal Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/goals');
  });

  test('creates a new distance goal', async ({ page }) => {
    // Open create goal modal
    await page.click('[data-testid="create-goal-button"]');
    await expect(page.locator('[data-testid="create-goal-modal"]')).toBeVisible();

    // Fill form
    await page.selectOption('[data-testid="goal-type-select"]', 'distance');
    await page.selectOption('[data-testid="period-select"]', 'weekly');
    await page.fill('[data-testid="target-value-input"]', '25');
    await page.fill('[data-testid="start-date-input"]', '2024-01-01');
    await page.fill('[data-testid="end-date-input"]', '2024-12-31');

    // Submit form
    await page.click('[data-testid="save-goal-button"]');

    // Verify goal appears in list
    await expect(page.locator('[data-testid="goals-list"]')).toContainText('25 km');
    await expect(page.locator('[data-testid="goals-list"]')).toContainText('Weekly');
    
    // Verify progress bar shows 0%
    const progressBar = page.locator('[data-testid="goal-progress-bar"]').first();
    await expect(progressBar).toHaveAttribute('aria-valuenow', '0');
  });

  test('updates goal progress', async ({ page }) => {
    // Assume a goal exists from previous test or setup
    const goalCard = page.locator('[data-testid="goal-card"]').first();
    
    // Click update progress button
    await goalCard.locator('[data-testid="update-progress-button"]').click();
    
    // Update progress
    await page.fill('[data-testid="current-value-input"]', '15');
    await page.click('[data-testid="update-button"]');
    
    // Verify progress updated
    await expect(goalCard.locator('[data-testid="current-value"]')).toContainText('15');
    
    const progressBar = goalCard.locator('[data-testid="goal-progress-bar"]');
    await expect(progressBar).toHaveAttribute('aria-valuenow', '60'); // 15/25 = 60%
  });

  test('completes goal and shows celebration', async ({ page }) => {
    const goalCard = page.locator('[data-testid="goal-card"]').first();
    
    // Update to complete the goal
    await goalCard.locator('[data-testid="update-progress-button"]').click();
    await page.fill('[data-testid="current-value-input"]', '25');
    await page.click('[data-testid="update-button"]');
    
    // Verify completion state
    await expect(goalCard.locator('[data-testid="completion-badge"]')).toBeVisible();
    await expect(goalCard.locator('[data-testid="completion-badge"]')).toContainText('Completed');
    
    // Check for celebration animation or notification
    await expect(page.locator('[data-testid="celebration-notification"]')).toBeVisible();
  });

  test('validates goal form inputs', async ({ page }) => {
    await page.click('[data-testid="create-goal-button"]');
    
    // Try to submit empty form
    await page.click('[data-testid="save-goal-button"]');
    
    // Check validation errors
    await expect(page.locator('[data-testid="type-error"]')).toContainText('Goal type is required');
    await expect(page.locator('[data-testid="target-error"]')).toContainText('Target value is required');
    
    // Test invalid target value
    await page.fill('[data-testid="target-value-input"]', '-5');
    await page.click('[data-testid="save-goal-button"]');
    
    await expect(page.locator('[data-testid="target-error"]')).toContainText(
      'Target value must be positive'
    );
  });
});
```

### Run Tracking Flow

```typescript
// tests/e2e/runs/run-tracking.test.ts
import { test, expect } from '@playwright/test';
import { loginAsTestUser } from '../utils/authHelpers';

test.describe('Run Tracking', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/runs');
  });

  test('logs a new run', async ({ page }) => {
    await page.click('[data-testid="log-run-button"]');
    
    // Fill run details
    await page.fill('[data-testid="date-input"]', '2024-01-15');
    await page.fill('[data-testid="time-input"]', '08:00');
    await page.fill('[data-testid="distance-input"]', '5.5');
    await page.fill('[data-testid="duration-hours"]', '0');
    await page.fill('[data-testid="duration-minutes"]', '32');
    await page.fill('[data-testid="duration-seconds"]', '30');
    await page.selectOption('[data-testid="run-type-select"]', 'easy');
    await page.fill('[data-testid="notes-textarea"]', 'Morning run in the park');
    
    await page.click('[data-testid="save-run-button"]');
    
    // Verify run appears in list
    const runsList = page.locator('[data-testid="runs-list"]');
    await expect(runsList).toContainText('5.5 km');
    await expect(runsList).toContainText('32:30');
    await expect(runsList).toContainText('Easy');
    
    // Verify calculated pace
    await expect(runsList).toContainText('5:55'); // 32:30 / 5.5km ≈ 5:55 min/km
  });

  test('filters runs by date range', async ({ page }) => {
    // Assume multiple runs exist
    await page.fill('[data-testid="start-date-filter"]', '2024-01-01');
    await page.fill('[data-testid="end-date-filter"]', '2024-01-15');
    await page.click('[data-testid="apply-filter-button"]');
    
    // Verify only runs in date range are shown
    const runCards = page.locator('[data-testid="run-card"]');
    const count = await runCards.count();
    
    for (let i = 0; i < count; i++) {
      const dateText = await runCards.nth(i).locator('[data-testid="run-date"]').textContent();
      // Verify date is within range
      expect(new Date(dateText!)).toBeGreaterThanOrEqual(new Date('2024-01-01'));
      expect(new Date(dateText!)).toBeLessThanOrEqual(new Date('2024-01-15'));
    }
  });

  test('edits existing run', async ({ page }) => {
    const firstRun = page.locator('[data-testid="run-card"]').first();
    
    await firstRun.locator('[data-testid="edit-run-button"]').click();
    
    // Update distance
    await page.fill('[data-testid="distance-input"]', '6.0');
    await page.fill('[data-testid="notes-textarea"]', 'Updated: Extended route');
    
    await page.click('[data-testid="save-run-button"]');
    
    // Verify changes
    await expect(firstRun).toContainText('6.0 km');
    await expect(firstRun).toContainText('Updated: Extended route');
  });

  test('deletes run with confirmation', async ({ page }) => {
    const runCount = await page.locator('[data-testid="run-card"]').count();
    
    const firstRun = page.locator('[data-testid="run-card"]').first();
    await firstRun.locator('[data-testid="delete-run-button"]').click();
    
    // Confirm deletion
    await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
    await page.click('[data-testid="confirm-delete-button"]');
    
    // Verify run is removed
    await expect(page.locator('[data-testid="run-card"]')).toHaveCount(runCount - 1);
  });
});
```

### Accessibility Testing

```typescript
// tests/e2e/accessibility/a11y.test.ts
import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';
import { loginAsTestUser } from '../utils/authHelpers';

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await injectAxe(page);
  });

  test('login page is accessible', async ({ page }) => {
    await page.goto('/login');
    await checkA11y(page);
  });

  test('dashboard is accessible after login', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/dashboard');
    
    // Wait for dynamic content to load
    await page.waitForSelector('[data-testid="dashboard-content"]');
    
    await checkA11y(page, null, {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  });

  test('forms have proper labels and ARIA attributes', async ({ page }) => {
    await page.goto('/login');
    
    // Check form labels
    const emailInput = page.locator('[data-testid="email-input"]');
    const passwordInput = page.locator('[data-testid="password-input"]');
    
    await expect(emailInput).toHaveAttribute('aria-label', 'Email address');
    await expect(passwordInput).toHaveAttribute('aria-label', 'Password');
    
    // Check form validation accessibility
    await page.click('[data-testid="submit-button"]');
    
    const emailError = page.locator('[data-testid="email-error"]');
    await expect(emailError).toHaveAttribute('role', 'alert');
    await expect(emailInput).toHaveAttribute('aria-describedby', expect.stringContaining('email-error'));
  });

  test('keyboard navigation works correctly', async ({ page }) => {
    await page.goto('/dashboard');
    await loginAsTestUser(page);
    
    // Test tab navigation
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'main-nav-goals');
    
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'main-nav-runs');
    
    // Test Enter key activation
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/runs');
  });

  test('screen reader announcements work', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/goals');
    
    // Create a goal to trigger announcements
    await page.click('[data-testid="create-goal-button"]');
    await page.selectOption('[data-testid="goal-type-select"]', 'distance');
    await page.fill('[data-testid="target-value-input"]', '25');
    await page.click('[data-testid="save-goal-button"]');
    
    // Check for success announcement
    const announcement = page.locator('[data-testid="sr-announcement"]');
    await expect(announcement).toHaveAttribute('aria-live', 'polite');
    await expect(announcement).toContainText('Goal created successfully');
  });
});
```

## Common Testing Utilities

### Date Testing Utilities

```typescript
// tests/utils/dateTestUtils.ts
import { fireEvent } from '@testing-library/react';

export const dateTestUtils = {
  setDateInput: async (input: HTMLElement, dateString: string) => {
    // Handle different date input formats across browsers
    fireEvent.change(input, { target: { value: dateString } });
    fireEvent.blur(input);
  },

  mockCurrentDate: (date: string) => {
    const mockDate = new Date(date);
    vi.setSystemTime(mockDate);
  },

  createDateInTimezone: (dateString: string, timezone: string) => {
    return new Date(dateString + (timezone ? ` ${timezone}` : ''));
  },

  formatDateForInput: (date: Date) => {
    return date.toISOString().split('T')[0];
  },

  addDays: (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  },

  getWeekBounds: (date: Date) => {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay() + 1); // Monday
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(start);
    end.setDate(start.getDate() + 6); // Sunday
    end.setHours(23, 59, 59, 999);
    
    return { start, end };
  },
};
```

### Authentication Helpers

```typescript
// tests/utils/authHelpers.ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { testDb } from '../setup/testDatabase';

export const createTestUser = async (userData: {
  email: string;
  password: string;
  name?: string;
}) => {
  const hashedPassword = await bcrypt.hash(userData.password, 10);
  
  return await testDb.user.create({
    data: {
      email: userData.email,
      password: hashedPassword,
      name: userData.name || 'Test User',
    },
  });
};

export const generateAuthToken = (user: { id: string; email: string }) => {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
};

export const loginAsTestUser = async (page: any) => {
  const testUser = await createTestUser({
    email: 'test@example.com',
    password: 'TestPassword123!',
  });

  await page.goto('/login');
  await page.fill('[data-testid="email-input"]', testUser.email);
  await page.fill('[data-testid="password-input"]', 'TestPassword123!');
  await page.click('[data-testid="submit-button"]');
  
  await page.waitForURL('/dashboard');
  return testUser;
};
```

### Test Data Factories

```typescript
// tests/factories/runFactory.ts
import { testDb } from '../setup/testDatabase';

export const runFactory = {
  create: async (overrides: Partial<any> = {}) => {
    const defaultData = {
      date: new Date(),
      distance: 5.0,
      duration: 1800, // 30 minutes
      runType: 'easy',
      notes: 'Test run',
      ...overrides,
    };

    return await testDb.run.create({ data: defaultData });
  },

  createMany: async (count: number, overrides: Partial<any> = {}) => {
    const runs = [];
    for (let i = 0; i < count; i++) {
      runs.push(await runFactory.create({
        ...overrides,
        date: new Date(Date.now() - i * 24 * 60 * 60 * 1000), // Spread over days
      }));
    }
    return runs;
  },

  build: (overrides: Partial<any> = {}) => {
    return {
      date: new Date(),
      distance: 5.0,
      duration: 1800,
      runType: 'easy',
      notes: 'Test run',
      ...overrides,
    };
  },
};

export const goalFactory = {
  create: async (overrides: Partial<any> = {}) => {
    const defaultData = {
      type: 'distance',
      period: 'weekly',
      targetValue: 25,
      currentValue: 0,
      isCompleted: false,
      isActive: true,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      ...overrides,
    };

    return await testDb.goal.create({ data: defaultData });
  },
};
```

## Best Practices

### General Testing Principles

1. **AAA Pattern**: Arrange, Act, Assert
   ```typescript
   test('should calculate pace correctly', () => {
     // Arrange
     const distance = 5;
     const duration = 1800;
     
     // Act
     const pace = calculatePace(distance, duration);
     
     // Assert
     expect(pace).toBe(6.0);
   });
   ```

2. **Test Isolation**: Each test should be independent
   ```typescript
   beforeEach(() => {
     vi.clearAllMocks();
     // Reset any global state
   });
   ```

3. **Descriptive Test Names**: Use "should" statements
   ```typescript
   // Good
   test('should throw error when target value is negative');
   
   // Bad
   test('negative target value');
   ```

### Mock Strategies

1. **Mock at the Boundary**: Mock external dependencies, not internal logic
   ```typescript
   // Good - mock API calls
   vi.mock('@/services/api');
   
   // Bad - mock internal functions
   vi.mock('@/utils/calculations');
   ```

2. **Use Real Objects When Possible**: Prefer real implementations for simple objects
   ```typescript
   // Good
   const user = { id: '1', email: 'test@example.com' };
   
   // Overkill for simple objects
   const user = vi.mock({ id: '1', email: 'test@example.com' });
   ```

### Test Data Management

1. **Use Factories**: Create reusable test data builders
2. **Minimize Test Data**: Only include necessary fields
3. **Clean Up**: Always clean up test data between tests

### Assertion Best Practices

1. **Specific Assertions**: Be as specific as possible
   ```typescript
   // Good
   expect(response.body.email).toBe('test@example.com');
   
   // Too generic
   expect(response.body).toBeTruthy();
   ```

2. **Error Testing**: Test both success and error cases
   ```typescript
   test('should handle API errors gracefully', async () => {
     api.getGoals.mockRejectedValue(new Error('Network error'));
     
     const { result } = renderHook(() => useGoals());
     
     await waitFor(() => {
       expect(result.current.error).toBeInstanceOf(Error);
     });
   });
   ```

## Performance Guidelines

### Test Performance Optimization

1. **Parallel Execution**: Run tests in parallel when safe
   ```bash
   # Vitest runs in parallel by default
   npm run test
   
   # Jest with parallel workers
   npm run test:integration -- --maxWorkers=4
   ```

2. **Test Categorization**: Separate fast and slow tests
   ```typescript
   // Fast unit tests
   describe('calculations', () => { /* ... */ });
   
   // Slower integration tests
   describe.slow('database operations', () => { /* ... */ });
   ```

3. **Setup Optimization**: Minimize expensive setup operations
   ```typescript
   // Good - shared setup
   beforeAll(async () => {
     await setupTestDatabase();
   });
   
   // Bad - repeated expensive operations
   beforeEach(async () => {
     await recreateEntireDatabase();
   });
   ```

### Memory Management

1. **Clean Up Resources**: Always clean up after tests
   ```typescript
   afterEach(async () => {
     await testDb.$disconnect();
     vi.clearAllMocks();
   });
   ```

2. **Monitor Memory Usage**: Use memory profiling for large test suites
   ```bash
   npm run test:memory
   ```

## Debugging and Troubleshooting

### Common Issues and Solutions

1. **Async Test Issues**: Always await async operations
   ```typescript
   // Good
   await waitFor(() => {
     expect(screen.getByText('Loading...')).not.toBeInTheDocument();
   });
   
   // Bad - might pass before async operation completes
   expect(screen.getByText('Loading...')).not.toBeInTheDocument();
   ```

2. **Mock Issues**: Ensure mocks are properly configured
   ```typescript
   // Clear mocks between tests
   beforeEach(() => {
     vi.clearAllMocks();
   });
   
   // Restore mocks after all tests
   afterAll(() => {
     vi.restoreAllMocks();
   });
   ```

3. **Date/Time Issues**: Use consistent date mocking
   ```typescript
   beforeAll(() => {
     vi.useFakeTimers();
     vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
   });
   
   afterAll(() => {
     vi.useRealTimers();
   });
   ```

### Debugging Tools

1. **Test Debugging**: Use debugging tools appropriately
   ```typescript
   // Debug failing tests
   test('should work', () => {
     console.log(screen.debug()); // See DOM state
     expect(/* ... */);
   });
   ```

2. **Browser DevTools**: For E2E tests
   ```bash
   # Run with browser open
   npm run test:e2e -- --headed --debug
   ```

3. **Test Isolation**: Run single tests to isolate issues
   ```bash
   # Run specific test file
   npm run test -- calculations.test.ts
   
   # Run specific test case
   npm run test -- --grep "should calculate pace"
   ```

---

This comprehensive guide provides patterns and practices for effective testing across all layers of the Running App MVP. Follow these patterns to maintain high code quality, reliable tests, and efficient development workflows.
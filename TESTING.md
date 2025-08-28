# Comprehensive Testing Guide

## Overview

This is the complete testing guide for the Running App MVP project. All testing-related information has been consolidated into this single document to provide a clear, comprehensive resource for developers.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Testing Architecture](#testing-architecture)
3. [Test Types and Frameworks](#test-types-and-frameworks)
4. [Testing Commands](#testing-commands)
5. [Test Configuration](#test-configuration)
6. [Coverage and Metrics](#coverage-and-metrics)
7. [Testing Best Practices](#testing-best-practices)
8. [CI/CD Integration](#cicd-integration)
9. [Performance Monitoring](#performance-monitoring)
10. [Troubleshooting](#troubleshooting)
11. [Test Patterns and Examples](#test-patterns-and-examples)

## Quick Start

### Essential Commands

```bash
# Run all tests
npm run test:all

# Run tests with coverage
npm run test:coverage

# Run specific test types
npm run test              # Unit tests (Vitest)
npm run test:integration  # Integration tests (Jest)
npm run test:e2e          # End-to-end tests (Playwright)

# Development workflow
npm run test:ui           # Interactive test runner
npm run test:coverage     # Coverage report
```

### First Time Setup

```bash
# Install dependencies and setup database
npm run setup

# Install Playwright browsers
npx playwright install

# Verify test environment
npm run validate-test-env
```

## Testing Architecture

### Testing Pyramid Strategy

```
    ┌─────────────────┐
    │   E2E Tests     │  10% - Critical user journeys
    │   (Playwright)  │
    ├─────────────────┤
    │ Integration     │  20% - API and database tests
    │ Tests (Jest)    │
    ├─────────────────┤
    │   Unit Tests    │  70% - Components and utilities
    │   (Vitest)      │
    └─────────────────┘
```

### Test Distribution

| Test Type | Framework | Target % | Current Status |
|-----------|-----------|----------|----------------|
| Unit Tests | Vitest | 70% | ✅ Well covered |
| Integration Tests | Jest | 20% | 🔶 Needs work |
| E2E Tests | Playwright | 10% | ✅ Good coverage |

## Test Types and Frameworks

### 1. Unit Tests (Vitest)

**Purpose**: Test individual components, functions, and utilities in isolation.

**Location**: 
- `src/**/*.test.{ts,tsx,js}`
- `tests/unit/`

**Features**:
- Hot module replacement
- Native TypeScript support
- JSdom environment for React components
- Fast execution with Vite
- Built-in coverage reporting

**Configuration**: `vitest.config.ts`

**Example**:
```typescript
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button Component', () => {
  it('should render with correct text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });
});
```

### 2. Integration Tests (Jest)

**Purpose**: Test API endpoints, database operations, and service integration.

**Location**: `tests/integration/`

**Features**:
- Real database interactions
- HTTP request testing
- Authentication testing
- Error handling validation

**Configuration**: `jest.config.js`

**Example**:
```typescript
import request from 'supertest';
import { app } from '../src/server/app';

describe('POST /api/runs', () => {
  it('should create a new run', async () => {
    const response = await request(app)
      .post('/api/runs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        distance: 5.0,
        duration: 1800,
        startTime: new Date().toISOString()
      })
      .expect(201);
    
    expect(response.body).toHaveProperty('id');
  });
});
```

### 3. End-to-End Tests (Playwright)

**Purpose**: Test complete user workflows across browsers.

**Location**: `tests/e2e/`

**Features**:
- Multi-browser testing (Chromium, Firefox, WebKit)
- Parallel execution with sharding
- Visual regression testing
- Mobile device emulation
- Network interception

**Configuration**: `playwright.config.ts`

**Example**:
```typescript
import { test, expect } from '@playwright/test';

test('user can create a new run', async ({ page }) => {
  await page.goto('/runs');
  await page.click('[data-testid="new-run-button"]');
  await page.fill('[data-testid="distance-input"]', '5.0');
  await page.fill('[data-testid="time-input"]', '30:00');
  await page.click('[data-testid="save-run-button"]');
  
  await expect(page.getByText('Run saved successfully')).toBeVisible();
});
```

### 4. Accessibility Tests

**Unit Level** (`tests/accessibility/`):
```typescript
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { Button } from './Button';

test('Button should be accessible', async () => {
  const { container } = render(<Button>Submit</Button>);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

**E2E Level** (`tests/e2e/accessibility.test.ts`):
```typescript
import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';

test('homepage should be accessible', async ({ page }) => {
  await page.goto('/');
  await injectAxe(page);
  await checkA11y(page);
});
```

### 5. Visual Regression Tests

**Purpose**: Ensure UI consistency across changes.

**Location**: `tests/e2e/visual-regression.test.ts`

```typescript
test('homepage visual regression', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveScreenshot('homepage.png');
});
```

### 6. Performance Tests

**Purpose**: Monitor application performance and test execution times.

```bash
# Run performance benchmarks
npm run test:performance

# Monitor test execution performance
npm run test:performance:track
```

## Testing Commands

### Core Commands (Simplified from 100+ scripts)

```bash
# Basic Testing
npm run test                    # Unit tests
npm run test:ui                 # Interactive test runner
npm run test:coverage           # Unit tests with coverage
npm run test:integration        # Integration tests
npm run test:e2e                # End-to-end tests
npm run test:all                # Run all test types

# Specialized Testing
npm run test:a11y               # Accessibility tests
npm run test:visual             # Visual regression tests
npm run test:performance        # Performance benchmarks

# CI/CD Commands
npm run test:coverage:ci        # CI unit tests with coverage
npm run test:integration:ci     # CI integration tests
npm run test:e2e:ci             # CI E2E tests

# Development Commands
npm run test:watch              # Watch mode
npm run test:debug              # Debug mode
npm run validate-test-env       # Validate test environment
```

### Database Commands

```bash
# Database setup for testing
npm run ci-db-setup             # Setup test database
npm run verify-db-setup         # Verify database connectivity
npm run ci-db-teardown          # Clean up test database
```

## Test Configuration

### Environment Variables

```bash
# Core test environment
NODE_ENV=test
DATABASE_URL=file:./prisma/test.db
JWT_SECRET=test-secret-key-for-development-only-min-32-chars

# Specialized test databases
E2E_DATABASE_URL=file:./prisma/e2e-test.db
A11Y_DATABASE_URL=file:./prisma/a11y-test.db

# CI-specific settings
CI=true
VITEST_SHARD=1/3
```

### Configuration Files

| File | Purpose | Framework |
|------|---------|-----------|
| `vitest.config.ts` | Unit test configuration | Vitest |
| `jest.config.js` | Integration test configuration | Jest |
| `playwright.config.ts` | E2E test configuration | Playwright |

### Vitest Configuration Highlights

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup/vitest.setup.ts',
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
});
```

### Jest Configuration Highlights

```javascript
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./tests/setup/jest.setup.ts'],
  testTimeout: 30000,
  maxWorkers: 1, // Sequential for database tests
  coverage: {
    threshold: {
      global: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70
      }
    }
  }
};
```

### Playwright Configuration Highlights

```typescript
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
});
```

## Coverage and Metrics

### Current Coverage Status

| Area | Coverage | Target | Status |
|------|----------|--------|--------|
| Overall | 80.98% | 80% | ✅ Met |
| Frontend Components | 90%+ | 80% | ✅ Excellent |
| Backend Routes | 75% | 80% | 🔶 Needs improvement |
| Middleware | 85% | 80% | ✅ Good |
| Utilities | 95% | 80% | ✅ Excellent |

### Coverage Commands

```bash
# Generate coverage reports
npm run test:coverage           # Unit test coverage
npm run test:coverage:integration # Integration test coverage
npm run test:coverage:all       # Combined coverage

# View coverage reports
npm run test:coverage:open      # Open HTML report
npm run coverage:report         # Generate detailed report
```

### Coverage Thresholds

- **Minimum**: 70% (will fail CI below this)
- **Target**: 80% (project goal)
- **CI Requirement**: 75% (stricter than local)

## Testing Best Practices

### General Principles

1. **Test Behavior, Not Implementation**
   - Focus on what the code should do, not how it does it
   - Test user interactions and expected outcomes

2. **Arrange-Act-Assert Pattern**
   ```typescript
   test('should calculate total price', () => {
     // Arrange
     const items = [{ price: 10 }, { price: 20 }];
     
     // Act
     const total = calculateTotal(items);
     
     // Assert
     expect(total).toBe(30);
   });
   ```

3. **Use Descriptive Test Names**
   ```typescript
   // ❌ Bad
   test('user test', () => {});
   
   // ✅ Good
   test('should display validation error when email is invalid', () => {});
   ```

### Component Testing Patterns

```typescript
// Use data-testid for stable selectors
<button data-testid="submit-button">Submit</button>

// Test user interactions
fireEvent.click(screen.getByTestId('submit-button'));

// Test accessibility
expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
```

### API Testing Patterns

```typescript
// Test successful scenarios
test('should create user with valid data', async () => {
  const userData = { name: 'John', email: 'john@example.com' };
  const response = await request(app)
    .post('/api/users')
    .send(userData)
    .expect(201);
  
  expect(response.body).toMatchObject(userData);
});

// Test error scenarios
test('should return 400 for invalid email', async () => {
  await request(app)
    .post('/api/users')
    .send({ name: 'John', email: 'invalid' })
    .expect(400);
});
```

### E2E Testing Patterns

```typescript
// Use Page Object Model for complex workflows
class LoginPage {
  constructor(private page: Page) {}
  
  async login(email: string, password: string) {
    await this.page.fill('[data-testid="email"]', email);
    await this.page.fill('[data-testid="password"]', password);
    await this.page.click('[data-testid="login-button"]');
  }
}

// Wait for specific conditions, not timeouts
await page.waitForSelector('[data-testid="dashboard"]');
await page.waitForLoadState('networkidle');
```

## CI/CD Integration

### GitHub Actions Workflow

The testing pipeline runs on every push and pull request:

1. **Setup**: Install dependencies, setup database
2. **Unit Tests**: Fast feedback with Vitest
3. **Integration Tests**: API and database testing
4. **E2E Tests**: Cross-browser testing with Playwright
5. **Quality Checks**: Coverage validation and reporting

### Parallel Execution

- **Unit Tests**: Run in parallel with multiple workers
- **Integration Tests**: Run sequentially (database conflicts)
- **E2E Tests**: Sharded across multiple runners

### Test Sharding

```bash
# E2E tests are automatically sharded in CI
# Shard 1/3: Authentication and onboarding tests
# Shard 2/3: Core functionality tests  
# Shard 3/3: Advanced features and edge cases
```

## Performance Monitoring

### Test Execution Tracking

The project includes automated performance monitoring:

```bash
# Track test performance over time
npm run test:performance:track

# Identify slow tests
npm run analyze-test-performance

# Generate performance dashboard
npm run test:performance:dashboard
```

### Performance Metrics

- **Test Execution Time**: Tracked per test suite
- **Success Rate**: Historical pass/fail trends  
- **Flaky Test Detection**: Automatic identification of unreliable tests
- **Resource Usage**: Memory and CPU monitoring during tests

### Performance Alerts

- Automatic GitHub issues created for >5% performance regression
- Slow test identification (>5 seconds execution time)
- Success rate alerts for <95% pass rate

## Troubleshooting

### Common Issues

#### Unit Test Failures

```bash
# Check for missing dependencies
npm ci

# Verify test environment
npm run validate-test-env

# Run with verbose output
npm run test -- --reporter=verbose
```

#### Integration Test Failures

```bash
# Database connectivity issues
npm run verify-db-setup
npm run ci-db-setup

# Port conflicts
lsof -ti:3001 | xargs kill -9

# Jest worker issues
npm run verify-jest-workers
```

#### E2E Test Failures

```bash
# Browser installation issues
npx playwright install --with-deps

# Server startup issues
npm run wait-for-server

# Debugging with UI
npm run test:e2e -- --headed --debug
```

### Debug Commands

```bash
# Run tests with debugging
npm run test:debug
npm run test:integration -- --detectOpenHandles
npm run test:e2e -- --headed --slowMo=1000

# Analyze test performance
npm run analyze-test-performance
npm run test:memory

# Validate environment
npm run validate-test-env
```

### Common Error Solutions

1. **"Cannot find module"**: Run `npm ci` to reinstall dependencies
2. **"Port already in use"**: Kill existing processes on test ports
3. **"Database locked"**: Ensure proper test cleanup and isolation
4. **"Timeout"**: Increase timeout values in CI configurations
5. **"Browser not found"**: Run `npx playwright install`

## Test Patterns and Examples

### Testing Hooks

```typescript
import { renderHook, act } from '@testing-library/react';
import { useAuth } from './useAuth';

test('useAuth should login user', async () => {
  const { result } = renderHook(() => useAuth());
  
  await act(async () => {
    await result.current.login('test@example.com', 'password');
  });
  
  expect(result.current.user).toBeTruthy();
  expect(result.current.isAuthenticated).toBe(true);
});
```

### Testing Context Providers

```typescript
const TestWrapper = ({ children }) => (
  <AuthProvider>
    <ThemeProvider>
      {children}
    </ThemeProvider>
  </AuthProvider>
);

test('component uses auth context', () => {
  render(<MyComponent />, { wrapper: TestWrapper });
  // Test component behavior
});
```

### Testing Async Operations

```typescript
test('should handle async data loading', async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ data: 'test' })
  });
  global.fetch = mockFetch;
  
  render(<DataComponent />);
  
  await waitFor(() => {
    expect(screen.getByText('test')).toBeInTheDocument();
  });
});
```

### Testing Error Boundaries

```typescript
test('should display error message when child throws', () => {
  const ThrowError = () => {
    throw new Error('Test error');
  };
  
  render(
    <ErrorBoundary>
      <ThrowError />
    </ErrorBoundary>
  );
  
  expect(screen.getByText('Something went wrong')).toBeInTheDocument();
});
```

### Database Test Patterns

```typescript
describe('User API', () => {
  beforeEach(async () => {
    await db.user.deleteMany();
  });
  
  afterEach(async () => {
    await db.user.deleteMany();
  });
  
  test('should create user', async () => {
    const userData = { email: 'test@example.com', name: 'Test User' };
    const user = await createUser(userData);
    
    expect(user).toMatchObject(userData);
    expect(user.id).toBeDefined();
  });
});
```

## Migration from Legacy Testing

### Completed Improvements

✅ **Reduced test scripts from 100+ to essential commands**
✅ **Consolidated test configurations**
✅ **Implemented performance monitoring**
✅ **Added comprehensive coverage reporting**
✅ **Established clear testing patterns**

### Framework Decisions

- **Unit Tests**: Vitest (replacing some Jest usage)
- **Integration Tests**: Jest (for Node.js environment)
- **E2E Tests**: Playwright (established and working well)
- **Coverage**: V8 coverage provider for accuracy

---

**Last Updated**: December 28, 2024  
**Maintained By**: Development Team  
**Version**: 2.0 (Consolidated from multiple documents)

This document replaces the following legacy files:
- TESTING.md
- TESTING_STRATEGY.md
- TESTING_INFRASTRUCTURE_SUMMARY.md
- TEST_IMPROVEMENT_PLAN.md
- TEST_VALIDATION_REPORT.md
- TEST_VALIDATION_SUMMARY.md
- COMPREHENSIVE_TEST_COVERAGE_REPORT.md
- INTEGRATION_TEST_FIX_STRATEGY.md
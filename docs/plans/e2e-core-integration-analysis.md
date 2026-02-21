# E2E-Core Integration Analysis for Analytics Testing

**Date:** 2026-02-02
**Purpose:** Evaluate e2e-core library for analytics API integration tests
**Status:** Analysis Complete

---

## Executive Summary

**Recommendation:** **Keep Jest/Supertest for REST API integration tests**. Use e2e-core for E2E browser tests of the analytics frontend (Phase 1).

**Rationale:** e2e-core is designed for Playwright-based E2E browser testing, not REST API integration testing. The existing Jest/Supertest pattern is the right tool for API-level testing.

---

## Current Integration Test Pattern (Jest + Supertest)

### Architecture

```typescript
// tests/integration/api/runs.test.ts
import request from 'supertest';
import { testDb } from '../../fixtures/testDatabase.js';

const createTestApp = () => {
  const app = express();
  app.use('/api/runs', runsRoutes);
  return app;
};

describe('Runs API', () => {
  let testUser, authToken;

  beforeEach(async () => {
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({ email: 'test@example.com' });
    authToken = testDb.generateTestToken(testUser.id);
  });

  it('returns all runs for authenticated user', async () => {
    await testDb.createTestRuns(testUser.id, mockRuns);

    const response = await request(app)
      .get('/api/runs')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toHaveLength(3);
  });
});
```

### Key Components

1. **HTTP Request Layer:** `supertest` - in-process HTTP requests (no actual server)
2. **Test Runner:** Jest with `describe`/`it`/`expect`
3. **Database Utilities:** `testDatabase.ts` with helpers:
   - `cleanupDatabase()` - Clean between tests
   - `createTestUser()` - Create authenticated users
   - `generateTestToken()` - Generate JWT tokens
   - `createTestRuns()`, `createTestGoals()`, etc. - Seed test data
   - `prisma` - Direct database access
4. **Test App:** In-process Express app with specific routes mounted

### Advantages

- ✅ **Fast:** In-process, no network overhead
- ✅ **Isolated:** Each test suite mounts only needed routes
- ✅ **Simple:** No server lifecycle management
- ✅ **Focused:** Tests API logic directly without browser concerns
- ✅ **Established:** Existing pattern used across 7 test files

---

## E2E-Core Library Analysis

### Purpose and Design

**Primary Use Case:** Playwright-based end-to-end browser testing

```typescript
// e2e-core exports (from ~/src/e2e-core/)
export {
  test,                    // Playwright test fixture
  expect,                  // Playwright expect
  performLogin,            // Auth fixture for browser login
  saveAuthState,           // Save browser auth state
} from './fixtures/index.js';

export {
  apiRequest,              // REST API helper using Playwright APIRequestContext
  waitForAPI,              // Wait for API readiness
  waitForElement,          // Browser element waits
  waitForNetworkIdle,      // Browser network waits
} from './helpers/index.js';

export { BasePage } from './pages/BasePage.js';
```

### API Request Capability

E2E-core includes `apiRequest()` for making REST API calls:

```typescript
// From ~/src/e2e-core/src/helpers/api.ts
export async function apiRequest<T = any>(
  request: APIRequestContext,  // Playwright's request context
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  options: APIRequestOptions = {}
): Promise<APIResponse<T>> {
  const response: PlaywrightAPIResponse = await request.fetch(fullURL, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    data,
  });

  return {
    status: response.status(),
    data: await response.json(),
    headers: response.headers(),
  };
}
```

### Architectural Differences

| Aspect | Jest + Supertest | Playwright + e2e-core |
|--------|------------------|------------------------|
| **Purpose** | API integration tests | E2E browser tests |
| **Server** | In-process (no server) | Requires running server |
| **HTTP Layer** | Supertest (in-memory) | Playwright APIRequestContext (network) |
| **Test Runner** | Jest | Playwright Test |
| **Speed** | Very fast (~50ms/test) | Slower (~200-500ms/test) |
| **Focus** | API logic & data flow | User workflows & browser behavior |
| **Auth** | JWT tokens in headers | Browser cookies & storage |

---

## Gap Analysis: e2e-core for API Integration Tests

### What's Missing

1. **Database Utilities**
   - e2e-core has no database seeding/cleanup helpers
   - Would need to recreate `testDatabase.ts` functionality

2. **Test Server Lifecycle**
   - e2e-core expects a running server (typically via `npm run dev`)
   - Jest/Supertest tests in-process without server startup

3. **Test Runner Mismatch**
   - Playwright's test runner is heavier (designed for parallel browser instances)
   - Jest is lighter and faster for pure API tests

4. **Authentication Pattern**
   - e2e-core has `performLogin()` for browser-based login
   - API tests need JWT token generation directly

### What Would Be Required

To use e2e-core for API integration tests:

1. **Start actual server** in beforeAll hook
2. **Port e2e-core to use** full HTTP URLs (`http://localhost:3001/api/...`)
3. **Recreate database utilities** for Playwright test context
4. **Add API-focused auth helpers** (token generation, not browser login)
5. **Accept slower test execution** due to network overhead

### Effort Estimate

- **Time:** 2-3 days to adapt e2e-core for API testing
- **Risk:** High - mixing test paradigms (browser E2E + API integration)
- **Maintenance:** Increased complexity with two testing approaches in one tool

---

## Recommendation: Use Each Tool for Its Purpose

### Strategy

```
┌─────────────────────────────────────────────────────────┐
│                    Testing Strategy                      │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │   API Integration Tests (Jest + Supertest)      │   │
│  │                                                   │   │
│  │   • Analytics API endpoints (/api/analytics/*)  │   │
│  │   • Service layer logic (AnalyticsService)      │   │
│  │   • Geospatial calculations (GeospatialService) │   │
│  │   • Database operations                          │   │
│  │   • Request validation & error handling          │   │
│  │   • Rate limiting                                │   │
│  │                                                   │   │
│  │   Tests: tests/integration/api/analytics.test.ts│   │
│  └─────────────────────────────────────────────────┘   │
│                            ↓                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │   E2E Browser Tests (Playwright + e2e-core)     │   │
│  │                                                   │   │
│  │   • Analytics dashboard UI                       │   │
│  │   • User interactions (tab switching, filters)   │   │
│  │   • Chart rendering (Recharts components)        │   │
│  │   • Heatmap visualization (Mapbox integration)   │   │
│  │   • End-to-end workflows (login → view stats)    │   │
│  │                                                   │   │
│  │   Tests: tests/e2e/analytics.spec.ts            │   │
│  └─────────────────────────────────────────────────┘   │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### Division of Responsibilities

#### **Jest + Supertest** (Phase 2: API Integration Tests)

```typescript
// tests/integration/api/analytics.test.ts
describe('Analytics API', () => {
  it('returns weekly statistics for authenticated user', async () => {
    // Seed 90 days of run data
    await testDb.createTestRuns(userId, runsWithVariedPaces);

    // Make API request
    const response = await request(app)
      .get('/api/analytics/statistics?period=weekly')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    // Verify response structure and calculations
    expect(response.body).toMatchObject({
      period: 'weekly',
      totalRuns: 3,
      avgPace: expect.any(Number),
      totalDistance: 25.5,
    });
  });

  it('generates insights for consistent runner', async () => {
    // Seed consistent running pattern
    await testDb.createTestRuns(userId, consistentRuns);

    const response = await request(app)
      .get('/api/analytics/insights')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    // Verify insight generation logic
    expect(response.body.insights).toContainEqual({
      type: 'consistency',
      priority: 'high',
      message: expect.stringContaining('Great consistency'),
    });
  });
});
```

**Tests:**
- ✅ Statistics aggregation logic
- ✅ Trend detection accuracy
- ✅ Insight generation rules
- ✅ Heatmap GeoJSON generation
- ✅ Authentication & authorization
- ✅ Input validation
- ✅ Error handling
- ✅ Rate limiting
- ✅ Database operations

#### **Playwright + e2e-core** (Phase 1.6: Frontend E2E Tests)

```typescript
// tests/e2e/analytics.spec.ts
import { test, expect } from '@austinorphan/e2e-core';

test.describe('Analytics Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Use e2e-core's performLogin
    await performLogin(page, 'test@example.com', 'password');
    await page.goto('/analytics');
  });

  test('displays weekly statistics with correct values', async ({ page }) => {
    // Wait for stats to load
    await expect(page.locator('[data-testid="stats-card-total-runs"]'))
      .toContainText('3 runs');

    // Verify chart renders
    await expect(page.locator('[data-testid="pace-trend-chart"]'))
      .toBeVisible();
  });

  test('switches between time periods', async ({ page }) => {
    // Click period selector
    await page.click('[data-testid="period-selector-monthly"]');

    // Verify stats update
    await expect(page.locator('[data-testid="stats-period"]'))
      .toContainText('Monthly');
  });

  test('displays heatmap with user run locations', async ({ page }) => {
    // Wait for map to load
    await page.waitForSelector('[data-testid="heatmap-map"]');

    // Verify map markers
    const markers = page.locator('[data-testid="heatmap-marker"]');
    await expect(markers).toHaveCount(5);
  });
});
```

**Tests:**
- ✅ UI rendering and layout
- ✅ User interactions (clicks, filters, navigation)
- ✅ Chart visualization
- ✅ Map integration
- ✅ Loading states
- ✅ Error states
- ✅ Responsive design
- ✅ Accessibility

### Shared Test Data

Both test suites can share fixture data:

```typescript
// tests/fixtures/analyticsData.ts (shared)
export const consistentRunPattern = [
  { date: '2026-01-25', distance: 5.0, duration: 1800, pace: 6.0 },
  { date: '2026-01-27', distance: 5.0, duration: 1800, pace: 6.0 },
  { date: '2026-01-29', distance: 8.0, duration: 3000, pace: 6.25 },
  // ...
];

export const improvingPacePattern = [
  { date: '2026-01-01', distance: 5.0, duration: 2000, pace: 6.67 }, // Slower
  { date: '2026-01-15', distance: 5.0, duration: 1800, pace: 6.0 },  // Faster
  // ...
];
```

- **Jest tests:** Use fixtures to seed database via `testDb.createTestRuns()`
- **E2E tests:** Use fixtures to pre-seed test database via setup script

---

## Revised Phase 2 Approach

### Keep Jest/Supertest, Add Shared Fixtures

**Phase 2: API Integration Tests for Analytics** (3-4 days)

#### Epic 2.1: Setup Test Infrastructure

1. **Create Analytics Test Fixtures** (`tests/fixtures/analyticsData.ts`)
   - Consistent running patterns (for consistency insights)
   - Improving/declining pace patterns (for performance insights)
   - Varied volume patterns (for volume insights)
   - GPS coordinate sets (for heatmap tests)
   - Edge cases (no runs, single run, gaps in data)

2. **Extend testDatabase Helper** (`tests/fixtures/testDatabase.ts`)
   - `createRunsWithDetails()` - Create runs with RunDetail data
   - `createRunsWithGPS()` - Create runs with GPS routes
   - `seedAnalyticsScenario()` - Seed complete test scenario

#### Epic 2.2: Analytics Endpoint Tests (Jest + Supertest)

Use existing `createTestApp()` pattern:

```typescript
// tests/integration/api/analytics.test.ts
import request from 'supertest';
import { testDb } from '../../fixtures/testDatabase.js';
import { consistentRunPattern, improvingPacePattern } from '../../fixtures/analyticsData.js';
import analyticsRoutes from '../../../server/routes/analytics.js';

const createTestApp = () => {
  const app = express();
  app.use('/api/analytics', analyticsRoutes);
  return app;
};

describe('Analytics API Integration Tests', () => {
  let app, testUser, authToken;

  beforeEach(async () => {
    app = createTestApp();
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser();
    authToken = testDb.generateTestToken(testUser.id);
  });

  describe('GET /api/analytics/statistics', () => {
    // Tests from roadmap...
  });

  describe('GET /api/analytics/trends', () => {
    // Tests from roadmap...
  });

  describe('GET /api/analytics/insights', () => {
    // Tests from roadmap...
  });

  describe('GET /api/analytics/heatmap', () => {
    // Tests from roadmap...
  });
});
```

#### Epic 2.3: Frontend E2E Tests (Playwright + e2e-core)

**Note:** This will be done in **Phase 1.6** (after building frontend), not Phase 2.

```typescript
// tests/e2e/analytics.spec.ts
import { test, expect, performLogin } from '@austinorphan/e2e-core';

test.describe('Analytics Dashboard E2E', () => {
  // Browser-based tests of analytics UI...
});
```

---

## Potential e2e-core Extensions (Future)

If we wanted to add REST API testing utilities to e2e-core (for other repos):

### New Exports

```typescript
// ~/src/e2e-core/src/api/index.ts (new)
export { createAPITestContext } from './testContext.js';
export { seedDatabase, cleanupDatabase } from './database.js';
export { generateAuthToken } from './auth.js';
```

### Usage Pattern

```typescript
// In another repo using e2e-core for API tests
import { test, apiRequest, createAPITestContext } from '@austinorphan/e2e-core';

test.describe('User API', () => {
  let apiContext;

  test.beforeAll(async () => {
    apiContext = await createAPITestContext('http://localhost:3000');
  });

  test('creates user successfully', async () => {
    const response = await apiRequest(apiContext, 'POST', '/api/users', {
      data: { name: 'Test User' }
    });

    expect(response.status).toBe(201);
  });
});
```

**Decision:** Not needed for this project. Keep focus on Jest/Supertest for API tests.

---

## Conclusion

### Summary

- **e2e-core is excellent for browser E2E tests** ✅
- **e2e-core is NOT ideal for REST API integration tests** ❌
- **Jest + Supertest is the right tool for API testing** ✅

### Action Items

1. ✅ **Keep current Jest/Supertest pattern** for API integration tests
2. ✅ **Use e2e-core for analytics frontend E2E tests** (Phase 1.6)
3. ✅ **Create shared test fixtures** for both test suites
4. ✅ **Revise Phase 2 roadmap** to reflect this approach
5. ⏸️ **Consider e2e-core API extensions** as future enhancement (not now)

### Updated Timeline

- **Phase 2 (API Integration Tests):** 3-4 days using Jest/Supertest
- **Phase 1.6 (Frontend E2E Tests):** 1-2 days using Playwright/e2e-core

---

**Next Steps:** Update Phase 2 roadmap document to reflect Jest/Supertest approach and clarify e2e-core usage for Phase 1.6.

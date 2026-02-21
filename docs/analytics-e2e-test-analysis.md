# Analytics E2E Test Coverage Analysis

**Date:** 2026-02-08
**Status:** Analysis Complete
**Purpose:** Identify E2E test gaps for Analytics feature and plan comprehensive test coverage

---

## Executive Summary

**Current State:**
- ✅ **245 unit tests** created for 7 Analytics components (all passing)
- ✅ Existing `stats.test.ts` covers legacy StatsPage
- ❌ **No E2E tests** for new AnalyticsPage with tab-based interface

**Recommendation:** Create comprehensive E2E test suite for AnalyticsPage using existing e2e-core patterns.

---

## Existing E2E Test Infrastructure

### Test Files in `tests/e2e/`

| File | Status | Purpose | Lines | Analytics Relevant? |
|------|--------|---------|-------|---------------------|
| `stats.test.ts` | ✅ Active | Legacy StatsPage E2E tests | 496 | Partially (old implementation) |
| `smoke.spec.ts` | ✅ Active | Basic smoke tests using e2e-core | 32 | No |
| `auth.test.ts` | ✅ Active | Authentication workflows | ~600 | No |
| `runs.test.ts` | ✅ Active | Runs CRUD operations | ~600 | Indirectly (data source) |
| `accessibility.test.ts` | ✅ Active | Accessibility compliance | ~600 | Yes (should cover Analytics) |
| `mobile-responsiveness.test.ts` | ✅ Active | Mobile layout testing | ~600 | Yes (should cover Analytics) |
| `visual-regression.test.ts` | ✅ Active | Visual regression testing | ~500 | Yes (should cover Analytics) |

### Test Utilities Available

From `tests/fixtures/testDatabase.ts`:
```typescript
- cleanupDatabase() - Clean database between tests
- createTestUser() - Create authenticated test users
- generateTestToken() - Generate JWT tokens
- createTestRuns() - Seed run data
- prisma - Direct database access
```

From e2e-core integration (smoke.spec.ts):
```typescript
import { test, expect } from '@austinorphan/e2e-core';
// Provides Playwright test framework with e2e-core helpers
```

---

## Current Analytics Implementation

### AnalyticsPage Structure

**Location:** `src/pages/AnalyticsPage.tsx`

**Tab-Based Interface:**
```typescript
type TabType = 'overview' | 'trends' | 'insights' | 'map';

TABS = [
  { id: 'overview', label: 'Overview', icon: '📊' },    // StatsDashboard
  { id: 'trends', label: 'Trends', icon: '📈' },        // TrendInsight + TrendChart
  { id: 'insights', label: 'Insights', icon: '💡' },    // InsightsFeed
  { id: 'map', label: 'Map', icon: '🗺️' },              // HeatmapMap
]
```

**Components Used:**
1. **StatsDashboard** - Statistics cards with period selector
2. **TrendChart** - Recharts-based line/area charts
3. **TrendInsight** - Performance trends display
4. **InsightsFeed** - AI-generated insights with priority grouping
5. **HeatmapMap** - Canvas-based GPS heatmap

**Key Features:**
- ✅ Tab navigation with active state
- ✅ Loading states for each component
- ✅ Error handling
- ✅ Responsive design (mobile hides labels, shows icons only)
- ✅ Fade-in animations

---

## Legacy StatsPage vs New AnalyticsPage

### Differences

| Feature | Legacy StatsPage | New AnalyticsPage |
|---------|------------------|-------------------|
| **Layout** | Single page with all stats | Tab-based interface |
| **Components** | Weekly insights, run type breakdown, trends, PR table | StatsDashboard, TrendChart, TrendInsight, InsightsFeed, HeatmapMap |
| **Navigation** | Scroll-based | Tab-based |
| **Charts** | Pie chart, line chart | Line/area charts with toggles |
| **Insights** | Basic weekly summary | Priority-grouped AI insights with dismiss |
| **Map** | Not present | GPS heatmap with grid size control |
| **URL** | `/stats` | `/analytics` |

### Test Coverage Status

**Legacy StatsPage (`stats.test.ts`):**
- ✅ Empty state
- ✅ Weekly insights card
- ✅ Run type breakdown chart
- ✅ Trends chart with period selector
- ✅ Personal records table
- ✅ Responsive layout
- ✅ Data refresh
- ✅ Error handling
- ✅ Accessibility
- ✅ Performance

**New AnalyticsPage:**
- ❌ No E2E tests exist

---

## Test Coverage Gaps

### Critical Missing Tests (Priority 1)

#### 1. Tab Navigation
- [ ] Tab switching updates active state
- [ ] Tab content displays correctly for each tab
- [ ] URL updates when switching tabs (if implemented)
- [ ] Back/forward browser navigation works
- [ ] Deep linking to specific tabs
- [ ] Mobile tab navigation (icon-only)

#### 2. Overview Tab (StatsDashboard)
- [ ] Statistics cards display with correct data
- [ ] Period selector changes stats (weekly, monthly, yearly)
- [ ] Loading states display properly
- [ ] Empty state when no runs exist
- [ ] Stats update when new runs are added
- [ ] Responsive layout on mobile

#### 3. Trends Tab
- [ ] TrendInsight displays pace/volume/consistency
- [ ] TrendChart renders with data
- [ ] Metric selector (distance, pace, both)
- [ ] Chart type toggle (line, area)
- [ ] Period selector integration
- [ ] Chart interactions (hover, tooltips)

#### 4. Insights Tab (InsightsFeed)
- [ ] Insights display in priority groups
- [ ] Dismiss functionality works
- [ ] Dismissed insights persist to localStorage
- [ ] Refresh button re-shows dismissed insights
- [ ] Empty state when no insights
- [ ] "All dismissed" state

#### 5. Map Tab (HeatmapMap)
- [ ] Heatmap canvas renders
- [ ] Grid size selector updates map
- [ ] GPS data displays correctly
- [ ] Legend shows density gradient
- [ ] Empty state when no GPS data
- [ ] Statistics display (grid cells, max density)

### Important Tests (Priority 2)

#### 6. Cross-Tab Integration
- [ ] Data consistency across tabs
- [ ] Tab content pre-loads/caches
- [ ] Switching tabs doesn't re-fetch data unnecessarily

#### 7. Error Handling
- [ ] API errors display error states
- [ ] Retry buttons work
- [ ] Partial failures don't break entire page
- [ ] Network errors handled gracefully

#### 8. Performance
- [ ] Page loads within 3 seconds
- [ ] Tab switching is instant
- [ ] Large datasets (100+ runs) handled efficiently
- [ ] Charts render without lag

### Nice-to-Have Tests (Priority 3)

#### 9. Accessibility
- [ ] Keyboard navigation through tabs
- [ ] ARIA labels on interactive elements
- [ ] Screen reader compatibility
- [ ] Proper heading hierarchy
- [ ] Focus management when switching tabs

#### 10. Visual Regression
- [ ] Tab screenshots match baselines
- [ ] Charts render consistently
- [ ] Mobile vs desktop layouts
- [ ] Dark mode (if implemented)

---

## Recommended Test Structure

### New File: `tests/e2e/analytics.spec.ts`

```typescript
import { test, expect } from '@austinorphan/e2e-core';
import { testDb } from '../fixtures/testDatabase';
import { mockRuns } from '../fixtures/mockData';

test.describe('Analytics Page E2E Tests', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    // Setup
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'analytics@test.com',
      password: 'testpassword123',
    });

    // Login
    await page.goto('/login');
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test.describe('Tab Navigation', () => {
    // Tests for tab switching, active states, etc.
  });

  test.describe('Overview Tab', () => {
    // Tests for StatsDashboard
  });

  test.describe('Trends Tab', () => {
    // Tests for TrendChart and TrendInsight
  });

  test.describe('Insights Tab', () => {
    // Tests for InsightsFeed
  });

  test.describe('Map Tab', () => {
    // Tests for HeatmapMap
  });

  test.describe('Cross-Tab Integration', () => {
    // Tests for data consistency
  });

  test.describe('Error Handling', () => {
    // Tests for error states
  });

  test.describe('Performance', () => {
    // Tests for load times and responsiveness
  });
});
```

### Test Data Requirements

Need to extend `tests/fixtures/mockData.ts`:

```typescript
// GPS-enabled runs for heatmap testing
export const gpsRuns = [
  {
    date: '2026-01-01',
    distance: 5.0,
    duration: 1800,
    gpsRoute: [
      { lat: 37.7749, lng: -122.4194, timestamp: 0 },
      { lat: 37.7750, lng: -122.4195, timestamp: 60 },
      // ...
    ],
  },
  // ...
];

// Varied pace runs for trend testing
export const trendRuns = Array.from({ length: 12 }, (_, i) => ({
  date: new Date(2026, 0, i * 2 + 1).toISOString(),
  distance: 5 + (i % 3),
  duration: 1800 + i * 60,
}));

// Consistent runs for insights testing
export const consistentRuns = Array.from({ length: 5 }, (_, i) => ({
  date: new Date(2026, 1, i + 1).toISOString(),
  distance: 5.0,
  duration: 1800,
}));
```

---

## Integration with Existing Tests

### Relationship to Legacy `stats.test.ts`

**Options:**
1. **Keep both** - Legacy tests for StatsPage, new tests for AnalyticsPage
2. **Deprecate legacy** - Archive stats.test.ts, focus on AnalyticsPage
3. **Hybrid** - Reuse test patterns from stats.test.ts in analytics.spec.ts

**Recommendation:** **Option 1 (Keep both)** initially, then Option 2 after AnalyticsPage replaces StatsPage.

### Shared Test Utilities

Extract common patterns to `tests/e2e/utils/analytics-helpers.ts`:

```typescript
export async function navigateToAnalytics(page, tab?: TabType) {
  await page.goto('/analytics');
  if (tab) {
    await page.click(`button.analytics-tab:has-text("${tab}")`);
  }
}

export async function seedRunsWithGPS(userId, count = 10) {
  // Create runs with GPS data
}

export async function waitForChartRender(page, selector) {
  // Wait for Recharts to finish rendering
}
```

---

## Execution Plan

### Phase 1: Core Functionality (1-2 days)

**Epic 1.6.3a: Tab Navigation & Overview Tab**
- [ ] Create `tests/e2e/analytics.spec.ts`
- [ ] Implement tab navigation tests (10 tests)
- [ ] Implement Overview tab tests (8 tests)
- [ ] Run tests and fix issues

**Epic 1.6.3b: Trends & Insights Tabs**
- [ ] Implement Trends tab tests (10 tests)
- [ ] Implement Insights tab tests (8 tests)
- [ ] Run tests and fix issues

### Phase 2: Advanced Features (1 day)

**Epic 1.6.3c: Map Tab & Integration**
- [ ] Implement Map tab tests (8 tests)
- [ ] Implement cross-tab integration tests (5 tests)
- [ ] Implement error handling tests (6 tests)

### Phase 3: Polish & Performance (0.5 days)

**Epic 1.6.3d: Performance & Accessibility**
- [ ] Implement performance tests (4 tests)
- [ ] Update existing accessibility tests for Analytics
- [ ] Run full test suite and verify coverage

---

## Success Criteria

**Metrics:**
- [ ] Minimum 50 E2E tests for AnalyticsPage
- [ ] All critical user flows covered
- [ ] Tests pass consistently (no flakiness)
- [ ] Test execution time < 5 minutes
- [ ] Code coverage for Analytics routes > 80%

**Quality Gates:**
- [ ] All tab interactions tested
- [ ] All component states tested (loading, error, empty, data)
- [ ] Error recovery paths verified
- [ ] Mobile responsiveness verified
- [ ] Accessibility compliance verified

---

## Test Maintenance Strategy

### Keeping Tests Updated
1. Update tests when Analytics components change
2. Add tests for new features before implementation (TDD)
3. Review test coverage quarterly
4. Remove obsolete tests (e.g., legacy StatsPage after deprecation)

### Preventing Flakiness
1. Use explicit waits for API responses
2. Mock slow/unreliable endpoints
3. Ensure proper cleanup between tests
4. Use stable selectors (data-testid attributes)

---

## Next Steps

**Immediate Actions:**
1. ✅ Complete this analysis document
2. [ ] Create `tests/e2e/analytics.spec.ts` skeleton
3. [ ] Implement Phase 1 tests (Tab Navigation & Overview)
4. [ ] Run tests and iterate
5. [ ] Proceed with Phases 2 & 3

**Future Enhancements:**
- Visual regression tests for Analytics charts
- Performance benchmarking for large datasets
- Integration tests for Analytics API endpoints (Phase 2 from e2e-core-integration-analysis.md)

---

**Conclusion:** The Analytics feature has excellent unit test coverage (245 tests) but lacks E2E tests. Creating comprehensive E2E tests using the existing e2e-core pattern will ensure the full user experience is validated.

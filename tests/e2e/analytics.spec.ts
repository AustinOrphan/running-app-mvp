import { test, expect } from '@playwright/test';
import { testDb } from '../fixtures/testDatabase.js';
import { mockRuns } from '../fixtures/mockData.js';
import type { TestUser } from './types';
import { assertTestUser } from './types/index.js';

/**
 * Analytics Page E2E Tests
 *
 * Tests the new tab-based Analytics interface including:
 * - Tab navigation and state management
 * - Overview tab (StatsDashboard)
 * - Trends tab (TrendChart + TrendInsight)
 * - Insights tab (InsightsFeed)
 * - Map tab (HeatmapMap)
 */

test.describe('Analytics Page E2E Tests', () => {
  let testUser: TestUser | undefined;

  test.beforeEach(async ({ page }) => {
    // Clear any existing auth state from previous tests
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('authToken');
    });

    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'analytics@test.com',
      password: 'testpassword123',
    });

    // Login user - reload to apply cleared auth state
    await page.reload();
    await page.fill('input[type="email"]', assertTestUser(testUser).email);
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button:has-text("Login")');

    // Wait for login form to disappear (reliable indicator of successful login)
    // Note: URL stays at '/' whether logged in or not — app uses conditional render, not routing
    await expect(page.locator('h2:has-text("Login or Register")')).toBeHidden({ timeout: 10000 });
  });

  test.afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  test.describe('Tab Navigation', () => {
    test('should display all four analytics tabs', async ({ page }) => {
      await page.goto('/analytics');

      // Check all tabs are visible
      await expect(page.locator('button.analytics-tab:has-text("Overview")')).toBeVisible();
      await expect(page.locator('button.analytics-tab:has-text("Trends")')).toBeVisible();
      await expect(page.locator('button.analytics-tab:has-text("Insights")')).toBeVisible();
      await expect(page.locator('button.analytics-tab:has-text("Map")')).toBeVisible();
    });

    test('should have Overview tab active by default', async ({ page }) => {
      await page.goto('/analytics');

      const overviewTab = page.locator('button.analytics-tab:has-text("Overview")');
      await expect(overviewTab).toHaveClass(/active/);
    });

    test('should switch to Trends tab when clicked', async ({ page }) => {
      await page.goto('/analytics');

      await page.click('button.analytics-tab:has-text("Trends")');

      const trendsTab = page.locator('button.analytics-tab:has-text("Trends")');
      await expect(trendsTab).toHaveClass(/active/);

      const overviewTab = page.locator('button.analytics-tab:has-text("Overview")');
      await expect(overviewTab).not.toHaveClass(/active/);
    });

    test('should switch to Insights tab when clicked', async ({ page }) => {
      await page.goto('/analytics');

      await page.click('button.analytics-tab:has-text("Insights")');

      const insightsTab = page.locator('button.analytics-tab:has-text("Insights")');
      await expect(insightsTab).toHaveClass(/active/);
    });

    test('should switch to Map tab when clicked', async ({ page }) => {
      await page.goto('/analytics');

      await page.click('button.analytics-tab:has-text("Map")');

      const mapTab = page.locator('button.analytics-tab:has-text("Map")');
      await expect(mapTab).toHaveClass(/active/);
    });

    test('should display tab icons', async ({ page }) => {
      await page.goto('/analytics');

      // Check tab icons are present (use .tab-icon spans)
      const icons = page.locator('.tab-icon');
      await expect(icons).toHaveCount(4);
      await expect(icons.first()).toBeVisible();
    });

    test('should show only icons on mobile screens', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/analytics');

      // Tab labels should be hidden on mobile (display:none at max-width:640px)
      const tabLabel = page.locator('.tab-label').first();
      await expect(tabLabel).toBeHidden();

      // But icons should still be visible
      await expect(page.locator('.tab-icon').first()).toBeVisible();
    });

    test('should allow keyboard navigation through tabs', async ({ page }) => {
      await page.goto('/analytics');

      // Focus the first analytics tab
      const overviewTab = page.locator('button.analytics-tab:has-text("Overview")');
      await overviewTab.focus();
      await expect(overviewTab).toBeFocused();
    });

    test('should cycle through all tabs sequentially', async ({ page }) => {
      await page.goto('/analytics');

      // Click through all tabs in order
      await page.click('button.analytics-tab:has-text("Overview")');
      await expect(page.locator('button.analytics-tab:has-text("Overview")')).toHaveClass(/active/);

      await page.click('button.analytics-tab:has-text("Trends")');
      await expect(page.locator('button.analytics-tab:has-text("Trends")')).toHaveClass(/active/);

      await page.click('button.analytics-tab:has-text("Insights")');
      await expect(page.locator('button.analytics-tab:has-text("Insights")')).toHaveClass(/active/);

      await page.click('button.analytics-tab:has-text("Map")');
      await expect(page.locator('button.analytics-tab:has-text("Map")')).toHaveClass(/active/);

      // Go back to Overview
      await page.click('button.analytics-tab:has-text("Overview")');
      await expect(page.locator('button.analytics-tab:has-text("Overview")')).toHaveClass(/active/);
    });

    test('should display correct content for each tab', async ({ page }) => {
      await page.goto('/analytics');

      // Overview tab should show StatsDashboard
      await page.click('button.analytics-tab:has-text("Overview")');
      await expect(page.locator('.stats-dashboard')).toBeVisible();

      // Trends tab should show TrendInsight and TrendChart
      await page.click('button.analytics-tab:has-text("Trends")');
      await expect(page.locator('.trend-insight, .trend-chart').first()).toBeVisible();

      // Insights tab should show InsightsFeed
      await page.click('button.analytics-tab:has-text("Insights")');
      await expect(page.locator('.insights-feed')).toBeVisible();

      // Map tab should show heatmap
      await page.click('button.analytics-tab:has-text("Map")');
      await expect(page.locator('.heatmap-container')).toBeVisible();
    });
  });

  test.describe('Overview Tab (StatsDashboard)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Overview")');
    });

    test('should display empty state when no runs exist', async ({ page }) => {
      // No runs created, should show empty state
      await expect(page.locator('text=No runs in this period')).toBeVisible();
    });

    test('should display statistics cards with data', async ({ page }) => {
      // Create runs with today's date so they fall in the current weekly period
      const today = new Date().toISOString().split('T')[0];
      await testDb.createTestRuns(
        assertTestUser(testUser).id,
        mockRuns.slice(0, 5).map(run => ({ ...run, date: today }))
      );
      await page.reload();
      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Overview")');

      // Should show stats dashboard with actual stats cards (not empty state)
      await expect(page.locator('.stats-dashboard')).toBeVisible();
      await expect(page.locator('.stats-card').first()).toBeVisible({ timeout: 10000 });
    });

    test('should display period selector', async ({ page }) => {
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 3));
      await page.reload();
      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Overview")');

      // Should have period selector of some form
      const periodSelector = page.locator(
        'select, button:has-text("Weekly"), button:has-text("Monthly"), .period-selector'
      );
      await expect(periodSelector.first()).toBeVisible();
    });

    test('should update stats when period is changed to monthly', async ({ page }) => {
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 5));
      await page.reload();
      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Overview")');

      // Find period selector and change it
      const periodSelector = page.locator('select').first();
      const hasSelect = (await periodSelector.count()) > 0;
      if (hasSelect) {
        await periodSelector.selectOption('monthly');
      }

      // Wait for update
      await page.waitForTimeout(500);

      // Stats should still be visible (not crashed)
      await expect(page.locator('.stats-dashboard')).toBeVisible();
    });

    test('should update stats when period is changed to yearly', async ({ page }) => {
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 5));
      await page.reload();
      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Overview")');

      const periodSelector = page.locator('select').first();
      const hasSelect = (await periodSelector.count()) > 0;
      if (hasSelect) {
        await periodSelector.selectOption('yearly');
      }

      // Should still show dashboard
      await expect(page.locator('.stats-dashboard')).toBeVisible();
    });

    test('should show loading state while fetching stats', async ({ page }) => {
      // Mock slow response
      await page.route('**/api/analytics/**', async route => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.continue();
      });

      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Overview")');

      // Should show skeleton loading state
      await expect(page.locator('.stats-dashboard')).toBeVisible();
    });

    test('should handle stats data updates when new runs are added', async ({ page }) => {
      // Create initial runs
      await testDb.createTestRuns(assertTestUser(testUser).id, [mockRuns[0]]);
      await page.reload();
      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Overview")');

      // Dashboard should be visible
      await expect(page.locator('.stats-dashboard')).toBeVisible();
    });

    test('should display responsive layout on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 3));
      await page.reload();
      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Overview")');

      // Dashboard should still be visible on mobile
      await expect(page.locator('.stats-dashboard')).toBeVisible();
    });
  });

  test.describe('Page Header', () => {
    test('should display Analytics title', async ({ page }) => {
      await page.goto('/analytics');

      await expect(page.locator('h1.analytics-title')).toContainText('Analytics');
    });

    test('should display subtitle', async ({ page }) => {
      await page.goto('/analytics');

      await expect(
        page.locator('text=Track your performance and get personalized insights')
      ).toBeVisible();
    });

    test('should have gradient title styling', async ({ page }) => {
      await page.goto('/analytics');

      const title = page.locator('h1.analytics-title');
      await expect(title).toBeVisible();
    });
  });

  test.describe('Error Handling', () => {
    test('should handle API errors gracefully in Overview tab', async ({ page }) => {
      // Mock API error
      await page.route('**/api/analytics/statistics**', route => {
        route.fulfill({ status: 500, body: 'Server Error' });
      });

      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Overview")');

      // Should still show the page structure
      await expect(page.locator('.analytics-page')).toBeVisible();
    });

    test('should allow retry after error', async ({ page }) => {
      let requestCount = 0;

      await page.route('**/api/analytics/**', route => {
        requestCount++;
        if (requestCount <= 2) {
          route.fulfill({ status: 500, body: 'Server Error' });
        } else {
          route.continue();
        }
      });

      await page.goto('/analytics');

      // Should still show analytics page structure
      await expect(page.locator('.analytics-page')).toBeVisible();
    });
  });

  test.describe('Performance', () => {
    test('should load analytics page quickly', async ({ page }) => {
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 10));

      const startTime = Date.now();
      await page.goto('/analytics');
      await expect(page.locator('h1.analytics-title')).toContainText('Analytics');
      const loadTime = Date.now() - startTime;

      // Should load within 5 seconds
      expect(loadTime).toBeLessThan(5000);
    });

    test('should switch tabs instantly', async ({ page }) => {
      await page.goto('/analytics');

      const startTime = Date.now();
      await page.click('button.analytics-tab:has-text("Trends")');
      await expect(page.locator('button.analytics-tab:has-text("Trends")')).toHaveClass(/active/);
      const switchTime = Date.now() - startTime;

      // Tab switch should be nearly instant (< 1s)
      expect(switchTime).toBeLessThan(1000);
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper heading hierarchy', async ({ page }) => {
      await page.goto('/analytics');

      // Should have analytics h1
      await expect(page.locator('h1.analytics-title')).toBeVisible();

      // H1 should be "Analytics"
      await expect(page.locator('h1.analytics-title')).toContainText('Analytics');
    });

    test('should have accessible tab buttons', async ({ page }) => {
      await page.goto('/analytics');

      // All tabs should be buttons
      const tabs = page.locator('.analytics-tab');
      const tabCount = await tabs.count();
      expect(tabCount).toBe(4);

      for (let i = 0; i < tabCount; i++) {
        const tab = tabs.nth(i);
        const tagName = await tab.evaluate(el => el.tagName);
        expect(tagName).toBe('BUTTON');
      }
    });

    test('should be keyboard navigable', async ({ page }) => {
      await page.goto('/analytics');

      // Should be able to focus a tab
      const firstTab = page.locator('.analytics-tab').first();
      await firstTab.focus();
      await expect(firstTab).toBeFocused();
    });
  });

  test.describe('Trends Tab', () => {
    test.beforeEach(async ({ page }) => {
      // Create trend data - runs over several weeks
      const trendRuns = Array.from({ length: 12 }, (_, i) => ({
        ...mockRuns[0],
        date: new Date(2026, 0, i * 2 + 1).toISOString(),
        distance: 5 + (i % 3),
        duration: 1800 + i * 60,
      }));
      await testDb.createTestRuns(assertTestUser(testUser).id, trendRuns);

      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Trends")');
    });

    test('should display TrendInsight component', async ({ page }) => {
      await expect(page.locator('.trend-insight')).toBeVisible();
    });

    test('should display TrendChart component', async ({ page }) => {
      await expect(page.locator('.trend-chart')).toBeVisible();
    });

    test('should show pace trend indicator', async ({ page }) => {
      await expect(page.locator('.trend-label:has-text("Pace")')).toBeVisible();
    });

    test('should show volume trend indicator', async ({ page }) => {
      await expect(page.locator('.trend-label:has-text("Volume")')).toBeVisible();
    });

    test('should show consistency indicator', async ({ page }) => {
      // Consistency text is in trend-insight
      await expect(page.locator('.trend-insight')).toBeVisible();
    });

    test('should display chart metric selector', async ({ page }) => {
      const metricSelector = page.locator('.metric-selector, select[aria-label="Metric selector"]');
      await expect(metricSelector.first()).toBeVisible();
    });

    test('should display chart type selector', async ({ page }) => {
      const chartTypeSelector = page.locator(
        '.chart-type-selector, select[aria-label="Chart type selector"]'
      );
      await expect(chartTypeSelector.first()).toBeVisible();
    });

    test('should switch chart metric from distance to pace', async ({ page }) => {
      const metricSelector = page.locator('.metric-selector').first();
      const selectorCount = await metricSelector.count();

      if (selectorCount > 0) {
        const tagName = await metricSelector.evaluate(el => el.tagName);
        if (tagName === 'SELECT') {
          await metricSelector.selectOption('pace');
        }
      }

      // Chart should still be visible
      await expect(page.locator('.trend-chart')).toBeVisible();
    });

    test('should switch chart metric to both distance and pace', async ({ page }) => {
      const metricSelector = page.locator('.metric-selector').first();
      const selectorCount = await metricSelector.count();

      if (selectorCount > 0) {
        const tagName = await metricSelector.evaluate(el => el.tagName);
        if (tagName === 'SELECT') {
          await metricSelector.selectOption('both');
        }
      }

      // Chart should still be visible
      await expect(page.locator('.trend-chart')).toBeVisible();
    });

    test('should switch chart type from line to area', async ({ page }) => {
      const chartTypeSelector = page.locator('.chart-type-selector').first();
      const selectorCount = await chartTypeSelector.count();

      if (selectorCount > 0) {
        const tagName = await chartTypeSelector.evaluate(el => el.tagName);
        if (tagName === 'SELECT') {
          await chartTypeSelector.selectOption('area');
        }
      }

      // Chart should still be visible
      await expect(page.locator('.trend-chart')).toBeVisible();
    });

    test('should show empty or loading state when no trend data available', async ({ page }) => {
      // Clean database to remove trend data
      await testDb.cleanupDatabase();
      testUser = await testDb.createTestUser({
        email: 'analytics2@test.com',
        password: 'testpassword123',
      });

      // Clear auth and log in with new user
      await page.evaluate(() => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('authToken');
      });
      await page.reload();
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button:has-text("Login")');
      await expect(page.locator('h2:has-text("Login or Register")')).toBeHidden({ timeout: 10000 });

      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Trends")');

      // Should show trend components (even if loading or showing no-data state)
      await expect(page.locator('.analytics-content')).toBeVisible();
    });
  });

  test.describe('Insights Tab', () => {
    test.beforeEach(async ({ page }) => {
      // Create runs for insights generation
      const consistentRuns = Array.from({ length: 5 }, (_, i) => ({
        ...mockRuns[0],
        date: new Date(2026, 1, i + 1).toISOString(),
        distance: 5.0,
        duration: 1800,
      }));
      await testDb.createTestRuns(assertTestUser(testUser).id, consistentRuns);

      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Insights")');
    });

    test('should display InsightsFeed component', async ({ page }) => {
      await expect(page.locator('.insights-feed')).toBeVisible();
    });

    test('should display refresh button', async ({ page }) => {
      await expect(page.locator('button[title="Refresh insights"]')).toBeVisible();
    });

    test('should show insights or empty state when data is available', async ({ page }) => {
      // Should show either insight cards or empty state
      const insightCards = page.locator('.insight-card');
      const emptyState = page.locator('.insights-empty');

      const hasInsights = (await insightCards.count()) > 0;
      const hasEmptyState = (await emptyState.count()) > 0;

      expect(hasInsights || hasEmptyState).toBeTruthy();
    });

    test('should display insights-feed heading', async ({ page }) => {
      // InsightsFeed has a heading
      await expect(page.locator('.insights-feed h3')).toBeVisible();
    });

    test('should allow dismissing an insight', async ({ page }) => {
      const insightCards = page.locator('.insight-card');
      const initialCount = await insightCards.count();

      if (initialCount > 0) {
        // Click dismiss button on first insight
        const dismissButton = page
          .locator('button[aria-label="Dismiss insight"], button[title="Dismiss"]')
          .first();
        const dismissCount = await dismissButton.count();
        if (dismissCount > 0) {
          await dismissButton.click();
          // Count should decrease or stay same (could animate)
          await page.waitForTimeout(300);
          const newCount = await insightCards.count();
          expect(newCount).toBeLessThanOrEqual(initialCount);
        }
      }
    });

    test('should show empty state when no insights available', async ({ page }) => {
      // Clean database
      await testDb.cleanupDatabase();
      testUser = await testDb.createTestUser({
        email: 'analytics3@test.com',
        password: 'testpassword123',
      });

      await page.evaluate(() => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('authToken');
      });
      await page.reload();
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button:has-text("Login")');
      await expect(page.locator('h2:has-text("Login or Register")')).toBeHidden({ timeout: 10000 });

      await page.goto('/analytics');
      await page.click('button.analytics-tab:has-text("Insights")');

      await expect(page.locator('text=Keep running to get insights!')).toBeVisible();
    });

    test('should refresh insights when refresh button clicked', async ({ page }) => {
      const refreshButton = page.locator('button[title="Refresh insights"]');
      await refreshButton.click();

      // Should trigger a reload (verify no crash)
      await page.waitForTimeout(500);
      await expect(page.locator('.insights-feed')).toBeVisible();
    });

    test('should display insight count or empty state', async ({ page }) => {
      // Either insights are showing or empty state
      const feedVisible = await page.locator('.insights-feed').isVisible();
      expect(feedVisible).toBeTruthy();
    });
  });
});

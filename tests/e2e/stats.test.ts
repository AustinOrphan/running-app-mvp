import { test, expect } from '@playwright/test';
import type { TestUser } from './types';

import { mockRuns } from '../fixtures/mockData.js';
import { testDb } from '../fixtures/testDatabase.js';

test.describe('Statistics Dashboard E2E Tests', () => {
  let testUser: TestUser | undefined;

  test.beforeEach(async ({ page }) => {
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'stats@test.com',
      password: 'testpassword123',
    });

    if (!testUser) {
      throw new Error('Test user not created');
    }

    // Login user
    await page.goto('/login');
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test.afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  test.describe('Empty State', () => {
    test('should display empty state when no runs exist', async ({ page }) => {
      await page.goto('/stats');

      await expect(page.locator('h1')).toContainText('Statistics');
      await expect(page.locator('text=Track your running progress and insights')).toBeVisible();

      // Should show empty state in each stats component
      await expect(page.locator('text=No data available')).toBeVisible();
      await expect(page.locator('text=Add some runs to see your statistics')).toBeVisible();
    });

    test('should show call-to-action to add runs', async ({ page }) => {
      await page.goto('/stats');

      await expect(page.locator('button:has-text("Add Your First Run")')).toBeVisible();

      // Clicking should navigate to add run page
      await page.click('button:has-text("Add Your First Run")');
      await expect(page).toHaveURL('/runs');
    });
  });

  test.describe('Weekly Insights Card', () => {
    test.beforeEach(async ({ page }) => {
      // Create runs from the last week
      const lastWeekRuns = mockRuns.slice(0, 4);
      await testDb.createTestRuns(testUser.id, lastWeekRuns);
      await page.goto('/stats');
    });

    test('should display weekly insights with correct data', async ({ page }) => {
      await expect(page.locator('.insights-card')).toBeVisible();
      await expect(page.locator('h3')).toContainText('This Week');

      // Should show total distance, duration, runs, and pace
      await expect(page.locator('text=km')).toBeVisible(); // Total distance
      await expect(page.locator('text=runs')).toBeVisible(); // Total runs
      await expect(page.locator('text=/km')).toBeVisible(); // Average pace

      // Should show formatted duration
      await expect(page.locator('text=h')).toBeVisible(); // Hours
      await expect(page.locator('text=min')).toBeVisible(); // Minutes
    });

    test('should show loading state while fetching insights', async ({ page }) => {
      // Mock slow response
      await page.route('**/api/stats/insights-summary', async route => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        route.continue();
      });

      await page.reload();

      // Should show loading skeleton
      await expect(page.locator('.skeleton-line')).toBeVisible();
    });

    test('should handle insights data updates when new runs are added', async ({ page }) => {
      const initialDistance = await page.locator('[data-testid="total-distance"]').textContent();

      // Add a new run
      await page.goto('/runs');
      await page.click('button:has-text("Add Run")');
      await page.fill('input[name="distance"]', '5.0');
      await page.fill('input[name="duration"]', '25:00');
      await page.fill('input[name="date"]', new Date().toISOString().split('T')[0]);
      await page.click('button[type="submit"]:has-text("Save Run")');

      // Return to stats page
      await page.goto('/stats');

      // Distance should be updated
      const updatedDistance = await page.locator('[data-testid="total-distance"]').textContent();
      expect(updatedDistance).not.toBe(initialDistance);
    });
  });

  test.describe('Run Type Breakdown Chart', () => {
    test.beforeEach(async ({ page }) => {
      // Create runs with different tags
      const taggedRuns = [
        { ...mockRuns[0], tag: 'Easy Run' },
        { ...mockRuns[1], tag: 'Long Run' },
        { ...mockRuns[2], tag: 'Speed Work' },
        { ...mockRuns[3], tag: 'Easy Run' },
      ];
      await testDb.createTestRuns(testUser.id, taggedRuns);
      await page.goto('/stats');
    });

    test('should display run type breakdown pie chart', async ({ page }) => {
      await expect(page.locator('.chart-card')).toContainText('Run Type Breakdown');

      // Should show pie chart
      await expect(page.locator('[data-testid="pie-chart"]')).toBeVisible();

      // Should show legend with run types
      await expect(page.locator('text=Easy Run')).toBeVisible();
      await expect(page.locator('text=Long Run')).toBeVisible();
      await expect(page.locator('text=Speed Work')).toBeVisible();
    });

    test('should show run counts and percentages in legend', async ({ page }) => {
      // Should show run counts for each type
      await expect(page.locator('text=2 runs')).toBeVisible(); // Easy Run count
      await expect(page.locator('text=1 run')).toBeVisible(); // Long Run and Speed Work counts

      // Should show percentages
      await expect(page.locator('text=50.0%')).toBeVisible(); // Easy Run percentage
      await expect(page.locator('text=25.0%')).toBeVisible(); // Other percentages
    });

    test('should be interactive with hover effects', async ({ page }) => {
      const pieChart = page.locator('[data-testid="pie-chart"]');

      // Hover over pie slice should show tooltip
      await pieChart.hover();
      await expect(page.locator('.recharts-tooltip')).toBeVisible();
    });

    test('should update when run tags are modified', async ({ page }) => {
      // Go to runs and edit a run's tag
      await page.goto('/runs');
      await page.click('.run-item .edit-button');
      await page.fill('input[name="tag"]', 'Race');
      await page.click('button[type="submit"]:has-text("Update Run")');

      // Return to stats
      await page.goto('/stats');

      // Should show the new tag in breakdown
      await expect(page.locator('text=Race')).toBeVisible();
    });
  });

  test.describe('Trends Chart', () => {
    test.beforeEach(async ({ page }) => {
      // Create runs over several weeks for trend data
      const trendRuns = Array.from({ length: 12 }, (_, i) => ({
        ...mockRuns[0],
        date: new Date(2024, 5, i * 2 + 1).toISOString(), // Every other day
        distance: 5 + (i % 3), // Varying distances
        duration: 1800 + i * 60, // Varying durations
      }));
      await testDb.createTestRuns(testUser.id, trendRuns);
      await page.goto('/stats');
    });

    test('should display trends chart with time period selector', async ({ page }) => {
      await expect(page.locator('.chart-card')).toContainText('Trends');

      // Should show line chart
      await expect(page.locator('[data-testid="trends-chart"]')).toBeVisible();

      // Should show period selector
      await expect(page.locator('select[name="period"]')).toBeVisible();
      await expect(page.locator('option[value="3m"]')).toBeVisible();
      await expect(page.locator('option[value="6m"]')).toBeVisible();
      await expect(page.locator('option[value="1y"]')).toBeVisible();
    });

    test('should update chart when period is changed', async ({ page }) => {
      // Change period from 3m to 6m
      await page.selectOption('select[name="period"]', '6m');

      // Should trigger chart update
      await expect(page.locator('.loading-indicator')).toBeVisible();
      await expect(page.locator('.loading-indicator')).not.toBeVisible();

      // Chart should show updated data
      await expect(page.locator('[data-testid="trends-chart"]')).toBeVisible();
    });

    test('should show different metrics (distance, pace, weekly totals)', async ({ page }) => {
      // Should show distance line
      await expect(page.locator('[data-testid="distance-line"]')).toBeVisible();

      // Should show pace line
      await expect(page.locator('[data-testid="pace-line"]')).toBeVisible();

      // Should show weekly distance bars
      await expect(page.locator('[data-testid="weekly-bars"]')).toBeVisible();
    });

    test('should be interactive with tooltips and hover effects', async ({ page }) => {
      const chart = page.locator('[data-testid="trends-chart"]');

      // Hover over data point should show tooltip
      await chart.hover();
      await expect(page.locator('.recharts-tooltip')).toBeVisible();

      // Tooltip should show date, distance, and pace
      await expect(page.locator('.tooltip-content')).toContainText('km');
      await expect(page.locator('.tooltip-content')).toContainText('/km');
    });
  });

  test.describe('Personal Records Table', () => {
    test.beforeEach(async ({ page }) => {
      // Create runs at standard distances for personal records
      const recordRuns = [
        { ...mockRuns[0], distance: 5.0, duration: 1500 }, // 5K in 25:00
        { ...mockRuns[1], distance: 10.0, duration: 3200 }, // 10K in 53:20
        { ...mockRuns[2], distance: 21.1, duration: 6600 }, // Half marathon
        { ...mockRuns[3], distance: 5.0, duration: 1440 }, // Better 5K in 24:00
      ];
      await testDb.createTestRuns(testUser.id, recordRuns);
      await page.goto('/stats');
    });

    test('should display personal records table', async ({ page }) => {
      await expect(page.locator('.records-table')).toBeVisible();
      await expect(page.locator('h3')).toContainText('Personal Records');

      // Should show table headers
      await expect(page.locator('th')).toContainText('Distance');
      await expect(page.locator('th')).toContainText('Time');
      await expect(page.locator('th')).toContainText('Pace');
      await expect(page.locator('th')).toContainText('Date');
    });

    test('should show best times for standard distances', async ({ page }) => {
      // Should show 5K record (better time of 24:00)
      await expect(page.locator('td')).toContainText('5 km');
      await expect(page.locator('td')).toContainText('24:00');

      // Should show 10K record
      await expect(page.locator('td')).toContainText('10 km');
      await expect(page.locator('td')).toContainText('53:20');

      // Should show half marathon record
      await expect(page.locator('td')).toContainText('21.1 km');
    });

    test('should link to the actual run when clicked', async ({ page }) => {
      // Click on a personal record row
      await page.click('tr:has-text("5 km")');

      // Should navigate to run details or show run modal
      await expect(page.locator('h2')).toContainText('Run Details');
    });

    test('should update when new personal records are achieved', async ({ page }) => {
      const initialBestTime = await page
        .locator('tr:has-text("5 km") td:nth-child(2)')
        .textContent();

      // Add a new faster 5K run
      await page.goto('/runs');
      await page.click('button:has-text("Add Run")');
      await page.fill('input[name="distance"]', '5.0');
      await page.fill('input[name="duration"]', '23:30'); // Faster time
      await page.fill('input[name="date"]', new Date().toISOString().split('T')[0]);
      await page.click('button[type="submit"]:has-text("Save Run")');

      // Return to stats
      await page.goto('/stats');

      // Should show updated record
      const updatedBestTime = await page
        .locator('tr:has-text("5 km") td:nth-child(2)')
        .textContent();
      expect(updatedBestTime).not.toBe(initialBestTime);
      await expect(page.locator('tr:has-text("5 km") td:nth-child(2)')).toContainText('23:30');
    });
  });

  test.describe('Statistics Page Layout', () => {
    test.beforeEach(async ({ page }) => {
      await testDb.createTestRuns(testUser.id, mockRuns.slice(0, 3));
      await page.goto('/stats');
    });

    test('should have responsive grid layout', async ({ page }) => {
      // Should show stats grid
      await expect(page.locator('.stats-grid')).toBeVisible();

      // All main components should be visible
      await expect(page.locator('.insights-card')).toBeVisible();
      await expect(page.locator('.chart-card')).toHaveCount(2); // Breakdown and Trends
      await expect(page.locator('.records-table')).toBeVisible();
    });

    test('should adapt layout for mobile screens', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      // Should stack components vertically on mobile
      await expect(page.locator('.stats-grid')).toHaveCSS('flex-direction', 'column');

      // Components should still be visible and usable
      await expect(page.locator('.insights-card')).toBeVisible();
      await expect(page.locator('.chart-card')).toBeVisible();
    });

    test('should show page header with description', async ({ page }) => {
      await expect(page.locator('h1')).toContainText('Statistics');
      await expect(page.locator('.page-description')).toContainText(
        'Track your running progress and insights'
      );
    });
  });

  test.describe('Data Refresh and Real-time Updates', () => {
    test('should refresh data when navigating back to stats page', async ({ page }) => {
      await testDb.createTestRuns(testUser.id, [mockRuns[0]]);
      await page.goto('/stats');

      await page.locator('text=1 run').textContent();

      // Navigate away and add another run
      await page.goto('/runs');
      await page.click('button:has-text("Add Run")');
      await page.fill('input[name="distance"]', '3.0');
      await page.fill('input[name="duration"]', '18:00');
      await page.fill('input[name="date"]', new Date().toISOString().split('T')[0]);
      await page.click('button[type="submit"]:has-text("Save Run")');

      // Navigate back to stats
      await page.goto('/stats');

      // Should show updated count
      await expect(page.locator('text=2 runs')).toBeVisible();
    });

    test('should handle refresh button', async ({ page }) => {
      await testDb.createTestRuns(testUser.id, mockRuns.slice(0, 2));
      await page.goto('/stats');

      // Should have refresh button
      await expect(page.locator('button[aria-label="Refresh statistics"]')).toBeVisible();

      // Click refresh should reload data
      await page.click('button[aria-label="Refresh statistics"]');
      await expect(page.locator('.loading-indicator')).toBeVisible();
      await expect(page.locator('.loading-indicator')).not.toBeVisible();
    });
  });

  test.describe('Error Handling', () => {
    test('should handle API errors gracefully', async ({ page }) => {
      // Mock API errors
      await page.route('**/api/stats/**', route => {
        route.fulfill({ status: 500, body: 'Server Error' });
      });

      await page.goto('/stats');

      // Should show error state
      await expect(page.locator('text=Failed to load statistics')).toBeVisible();
      await expect(page.locator('button:has-text("Retry")')).toBeVisible();
    });

    test('should retry loading when retry button is clicked', async ({ page }) => {
      let shouldFail = true;

      await page.route('**/api/stats/**', route => {
        if (shouldFail) {
          route.fulfill({ status: 500, body: 'Server Error' });
          shouldFail = false;
        } else {
          route.continue();
        }
      });

      await page.goto('/stats');
      await expect(page.locator('text=Failed to load statistics')).toBeVisible();

      // Click retry
      await page.click('button:has-text("Retry")');

      // Should load successfully on retry
      await expect(page.locator('h1')).toContainText('Statistics');
    });

    test('should handle partial data loading errors', async ({ page }) => {
      // Mock error for just one endpoint
      await page.route('**/api/stats/trends', route => {
        route.fulfill({ status: 500, body: 'Server Error' });
      });

      await testDb.createTestRuns(testUser.id, [mockRuns[0]]);
      await page.goto('/stats');

      // Insights should load successfully
      await expect(page.locator('.insights-card')).toBeVisible();

      // Trends chart should show error
      await expect(page.locator('.chart-card:has-text("Trends")')).toContainText(
        'Failed to load trends'
      );
    });
  });

  test.describe('Accessibility', () => {
    test('should be keyboard navigable', async ({ page }) => {
      await testDb.createTestRuns(testUser.id, mockRuns.slice(0, 2));
      await page.goto('/stats');

      // Tab through interactive elements
      await page.keyboard.press('Tab'); // Period selector
      await expect(page.locator('select[name="period"]')).toBeFocused();

      await page.keyboard.press('Tab'); // Records table
      await expect(page.locator('.records-table')).toBeFocused();

      // Should be able to navigate table with arrow keys
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowUp');
    });

    test('should have proper heading hierarchy', async ({ page }) => {
      await page.goto('/stats');

      // Should have proper heading structure
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h2')).toHaveCount(0); // No h2 skipping h1
      await expect(page.locator('h3')).toHaveCount(3); // Section headings
    });

    test('should have proper ARIA labels for charts and tables', async ({ page }) => {
      await testDb.createTestRuns(testUser.id, [mockRuns[0]]);
      await page.goto('/stats');

      // Charts should have proper labels
      await expect(page.locator('[aria-label="Run type breakdown chart"]')).toBeVisible();
      await expect(page.locator('[aria-label="Running trends chart"]')).toBeVisible();

      // Table should have proper structure
      await expect(page.locator('table[aria-label="Personal records"]')).toBeVisible();
    });
  });

  test.describe('Performance', () => {
    test('should load statistics page quickly', async ({ page }) => {
      await testDb.createTestRuns(testUser.id, mockRuns.slice(0, 5));

      const startTime = Date.now();
      await page.goto('/stats');
      await expect(page.locator('h1')).toContainText('Statistics');
      const loadTime = Date.now() - startTime;

      // Should load within reasonable time (adjust threshold as needed)
      expect(loadTime).toBeLessThan(3000);
    });

    test('should handle large amounts of data efficiently', async ({ page }) => {
      // Create many runs
      const manyRuns = Array.from({ length: 100 }, (_, i) => ({
        ...mockRuns[0],
        date: new Date(2024, 0, i + 1).toISOString(),
        distance: 5 + (i % 10),
        duration: 1800 + i * 30,
      }));

      await testDb.createTestRuns(testUser.id, manyRuns);
      await page.goto('/stats');

      // Should still load and be responsive
      await expect(page.locator('h1')).toContainText('Statistics');
      await expect(page.locator('.insights-card')).toBeVisible();
    });
  });
});

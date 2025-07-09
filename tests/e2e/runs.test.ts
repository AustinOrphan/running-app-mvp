import { test, expect } from '@playwright/test';
import type { TestUser } from './types';
import { assertTestUser } from './types/index.js';

import { mockRuns } from '../fixtures/mockData.js';
import { testDb } from '../fixtures/testDatabase.js';

test.describe('Runs Management Flow E2E Tests', () => {
  let testUser: TestUser | undefined;

  test.beforeEach(async ({ page }) => {
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'runs@test.com',
      password: 'testpassword123',
    });

    if (!testUser) {
      throw new Error('Test user not created');
    }

    // Login user
    await page.goto('/login');
    await page.fill('input[type="email"]', assertTestUser(testUser).email);
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test.afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  test.describe('View Runs List', () => {
    test('should display empty state when no runs exist', async ({ page }) => {
      await page.goto('/runs');

      await expect(page.locator('h1')).toContainText('My Runs');
      await expect(page.locator('text=No runs recorded yet')).toBeVisible();
      await expect(page.locator('text=Start tracking your runs')).toBeVisible();
      await expect(page.locator('button:has-text("Add Your First Run")')).toBeVisible();
    });

    test('should display list of runs when they exist', async ({ page }) => {
      // Create test runs
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 3));

      await page.goto('/runs');

      // Should show runs list
      await expect(page.locator('.run-item')).toHaveCount(3);

      // Check run details are displayed
      await expect(page.locator('text=5.2 km')).toBeVisible();
      await expect(page.locator('text=Easy Run')).toBeVisible();
      await expect(page.locator('text=31:00')).toBeVisible(); // Duration formatted
    });

    test('should show runs sorted by date (newest first)', async ({ page }) => {
      const sortedRuns = [
        { ...mockRuns[0], date: '2024-06-10T06:00:00Z' },
        { ...mockRuns[1], date: '2024-06-08T06:00:00Z' },
        { ...mockRuns[2], date: '2024-06-05T06:00:00Z' },
      ];
      await testDb.createTestRuns(assertTestUser(testUser).id, sortedRuns);

      await page.goto('/runs');

      const runItems = page.locator('.run-item');
      await expect(runItems).toHaveCount(3);

      // First run should be the newest (June 10)
      await expect(runItems.first()).toContainText('Jun 10');
      // Last run should be the oldest (June 5)
      await expect(runItems.last()).toContainText('Jun 5');
    });

    test('should show loading state while fetching runs', async ({ page }) => {
      await page.goto('/runs');

      // Should show loading skeleton or spinner
      await expect(page.locator('.loading-skeleton, .spinner')).toBeVisible();
    });
  });

  test.describe('Add New Run', () => {
    test('should open add run form when clicking add button', async ({ page }) => {
      await page.goto('/runs');

      await page.click('button:has-text("Add Run")');

      // Should show add run modal or navigate to add run page
      await expect(page.locator('h2')).toContainText('Add New Run');
      await expect(page.locator('input[name="distance"]')).toBeVisible();
      await expect(page.locator('input[name="duration"]')).toBeVisible();
      await expect(page.locator('input[name="date"]')).toBeVisible();
    });

    test('should successfully add a new run with valid data', async ({ page }) => {
      await page.goto('/runs');
      await page.click('button:has-text("Add Run")');

      // Fill run form
      await page.fill('input[name="distance"]', '8.5');
      await page.fill('input[name="duration"]', '45:30'); // 45 minutes 30 seconds
      await page.fill('input[name="date"]', '2024-06-15');
      await page.fill('input[name="tag"]', 'Long Run');
      await page.fill('textarea[name="notes"]', 'Great morning run in the park');

      // Submit form
      await page.click('button[type="submit"]:has-text("Save Run")');

      // Should show success message and return to runs list
      await expect(page.locator('text=Run added successfully')).toBeVisible();
      await expect(page).toHaveURL('/runs');

      // New run should appear in the list
      await expect(page.locator('text=8.5 km')).toBeVisible();
      await expect(page.locator('text=Long Run')).toBeVisible();
      await expect(page.locator('text=45:30')).toBeVisible();
    });

    test('should show validation errors for invalid data', async ({ page }) => {
      await page.goto('/runs');
      await page.click('button:has-text("Add Run")');

      // Try to submit empty form
      await page.click('button[type="submit"]:has-text("Save Run")');

      // Should show validation errors
      await expect(page.locator('text=Distance is required')).toBeVisible();
      await expect(page.locator('text=Duration is required')).toBeVisible();
      await expect(page.locator('text=Date is required')).toBeVisible();

      // Try with invalid distance
      await page.fill('input[name="distance"]', '-5');
      await page.click('button[type="submit"]:has-text("Save Run")');
      await expect(page.locator('text=Distance must be positive')).toBeVisible();

      // Try with invalid duration format
      await page.fill('input[name="distance"]', '5.0');
      await page.fill('input[name="duration"]', 'invalid');
      await page.click('button[type="submit"]:has-text("Save Run")');
      await expect(page.locator('text=Invalid duration format')).toBeVisible();
    });

    test('should handle different duration input formats', async ({ page }) => {
      await page.goto('/runs');
      await page.click('button:has-text("Add Run")');

      const durationFormats = [
        { input: '30:45', expected: '30:45' }, // MM:SS
        { input: '1:30:45', expected: '1:30:45' }, // H:MM:SS
        { input: '45', expected: '0:45' }, // Just seconds
      ];

      for (const format of durationFormats) {
        await page.fill('input[name="distance"]', '5.0');
        await page.fill('input[name="duration"]', format.input);
        await page.fill('input[name="date"]', '2024-06-15');

        await page.click('button[type="submit"]:has-text("Save Run")');

        // Should accept the format and show formatted duration
        await expect(page.locator(`text=${format.expected}`)).toBeVisible();

        // Reset for next test
        await page.click('button:has-text("Add Run")');
      }
    });

    test("should pre-fill date with today's date", async ({ page }) => {
      await page.goto('/runs');
      await page.click('button:has-text("Add Run")');

      const today = new Date().toISOString().split('T')[0];
      await expect(page.locator('input[name="date"]')).toHaveValue(today);
    });

    test('should allow canceling add run operation', async ({ page }) => {
      await page.goto('/runs');
      await page.click('button:has-text("Add Run")');

      // Fill some data
      await page.fill('input[name="distance"]', '5.0');
      await page.fill('input[name="duration"]', '30:00');

      // Cancel
      await page.click('button:has-text("Cancel")');

      // Should return to runs list without saving
      await expect(page).toHaveURL('/runs');
      await expect(page.locator('text=5.0 km')).not.toBeVisible();
    });
  });

  test.describe('Edit Existing Run', () => {
    test.beforeEach(async ({ page }) => {
      await testDb.createTestRuns(assertTestUser(testUser).id, [mockRuns[0]]);
      await page.goto('/runs');
    });

    test('should open edit form when clicking edit button', async ({ page }) => {
      await page.click('.run-item .edit-button');

      await expect(page.locator('h2')).toContainText('Edit Run');

      // Form should be pre-filled with existing data
      await expect(page.locator('input[name="distance"]')).toHaveValue('5.2');
      await expect(page.locator('input[name="tag"]')).toHaveValue('Easy Run');
    });

    test('should successfully update run with new data', async ({ page }) => {
      await page.click('.run-item .edit-button');

      // Update run data
      await page.fill('input[name="distance"]', '7.5');
      await page.fill('input[name="tag"]', 'Tempo Run');
      await page.fill('textarea[name="notes"]', 'Updated notes');

      await page.click('button[type="submit"]:has-text("Update Run")');

      // Should show success message and updated data
      await expect(page.locator('text=Run updated successfully')).toBeVisible();
      await expect(page.locator('text=7.5 km')).toBeVisible();
      await expect(page.locator('text=Tempo Run')).toBeVisible();
    });

    test('should validate updated data', async ({ page }) => {
      await page.click('.run-item .edit-button');

      // Try to set invalid distance
      await page.fill('input[name="distance"]', '0');
      await page.click('button[type="submit"]:has-text("Update Run")');

      await expect(page.locator('text=Distance must be greater than 0')).toBeVisible();
    });

    test('should allow canceling edit operation', async ({ page }) => {
      await page.click('.run-item .edit-button');

      // Make changes
      await page.fill('input[name="distance"]', '10.0');

      // Cancel
      await page.click('button:has-text("Cancel")');

      // Should return to list with original data
      await expect(page).toHaveURL('/runs');
      await expect(page.locator('text=5.2 km')).toBeVisible(); // Original value
      await expect(page.locator('text=10.0 km')).not.toBeVisible(); // Changed value should not be saved
    });
  });

  test.describe('Delete Run', () => {
    test.beforeEach(async ({ page }) => {
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 2));
      await page.goto('/runs');
    });

    test('should show confirmation dialog when deleting run', async ({ page }) => {
      await page.click('.run-item .delete-button');

      // Should show confirmation modal
      await expect(page.locator('text=Delete Run')).toBeVisible();
      await expect(page.locator('text=Are you sure you want to delete this run?')).toBeVisible();
      await expect(page.locator('button:has-text("Delete")')).toBeVisible();
      await expect(page.locator('button:has-text("Cancel")')).toBeVisible();
    });

    test('should successfully delete run when confirmed', async ({ page }) => {
      const initialRunCount = await page.locator('.run-item').count();

      await page.click('.run-item .delete-button');
      await page.click('button:has-text("Delete")');

      // Should show success message
      await expect(page.locator('text=Run deleted successfully')).toBeVisible();

      // Run should be removed from list
      await expect(page.locator('.run-item')).toHaveCount(initialRunCount - 1);
    });

    test('should cancel deletion when user clicks cancel', async ({ page }) => {
      const initialRunCount = await page.locator('.run-item').count();

      await page.click('.run-item .delete-button');
      await page.click('button:has-text("Cancel")');

      // Run should still be in list
      await expect(page.locator('.run-item')).toHaveCount(initialRunCount);
    });

    test('should handle deletion errors gracefully', async ({ page }) => {
      // Mock network error by intercepting delete request
      await page.route('**/api/runs/*', route => {
        if (route.request().method() === 'DELETE') {
          route.fulfill({ status: 500, body: 'Server Error' });
        } else {
          route.continue();
        }
      });

      await page.click('.run-item .delete-button');
      await page.click('button:has-text("Delete")');

      // Should show error message
      await expect(page.locator('text=Failed to delete run')).toBeVisible();
    });
  });

  test.describe('Run Details View', () => {
    test.beforeEach(async ({ page }) => {
      await testDb.createTestRuns(assertTestUser(testUser).id, [mockRuns[0]]);
      await page.goto('/runs');
    });

    test('should show detailed run information when clicking on run', async ({ page }) => {
      await page.click('.run-item');

      // Should show detailed view or modal
      await expect(page.locator('h2')).toContainText('Run Details');
      await expect(page.locator('text=5.2 km')).toBeVisible();
      await expect(page.locator('text=Easy Run')).toBeVisible();
      await expect(page.locator('text=Morning run in the park')).toBeVisible();

      // Should show calculated pace
      await expect(page.locator('text=5:58 /km')).toBeVisible(); // Calculated pace
    });

    test('should show edit and delete options in details view', async ({ page }) => {
      await page.click('.run-item');

      await expect(page.locator('button:has-text("Edit")')).toBeVisible();
      await expect(page.locator('button:has-text("Delete")')).toBeVisible();
    });

    test('should allow closing details view', async ({ page }) => {
      await page.click('.run-item');

      // Close via X button or backdrop
      await page.click('.close-button, .backdrop');

      // Should return to runs list
      await expect(page.locator('h1')).toContainText('My Runs');
    });
  });

  test.describe('Filtering and Search', () => {
    test.beforeEach(async ({ page }) => {
      const mixedRuns = [
        { ...mockRuns[0], tag: 'Easy Run' },
        { ...mockRuns[1], tag: 'Long Run' },
        { ...mockRuns[2], tag: 'Speed Work' },
        { ...mockRuns[3], tag: 'Easy Run' },
      ];
      await testDb.createTestRuns(assertTestUser(testUser).id, mixedRuns);
      await page.goto('/runs');
    });

    test('should filter runs by tag', async ({ page }) => {
      // Should have filter dropdown or buttons
      await page.selectOption('select[name="tagFilter"]', 'Easy Run');

      // Should show only Easy Run tagged runs
      await expect(page.locator('.run-item')).toHaveCount(2);
      await expect(page.locator('text=Easy Run')).toHaveCount(2);
      await expect(page.locator('text=Long Run')).not.toBeVisible();
    });

    test('should search runs by notes or tag', async ({ page }) => {
      await page.fill('input[name="search"]', 'park');

      // Should filter to runs containing "park" in notes
      await expect(page.locator('.run-item')).toHaveCount(1);
      await expect(page.locator('text=Morning run in the park')).toBeVisible();
    });

    test('should clear filters', async ({ page }) => {
      // Apply filter
      await page.selectOption('select[name="tagFilter"]', 'Easy Run');
      await expect(page.locator('.run-item')).toHaveCount(2);

      // Clear filter
      await page.click('button:has-text("Clear Filters")');

      // Should show all runs again
      await expect(page.locator('.run-item')).toHaveCount(4);
    });
  });

  test.describe('Pagination', () => {
    test('should paginate runs when there are many', async ({ page }) => {
      // Create many runs (assuming 10 per page)
      const manyRuns = Array.from({ length: 25 }, (_, i) => ({
        ...mockRuns[0],
        date: new Date(2024, 5, i + 1).toISOString(),
        distance: 5 + i * 0.1,
      }));

      await testDb.createTestRuns(assertTestUser(testUser).id, manyRuns);
      await page.goto('/runs');

      // Should show pagination controls
      await expect(page.locator('.pagination')).toBeVisible();
      await expect(page.locator('button:has-text("Next")')).toBeVisible();

      // Should show first page of runs
      await expect(page.locator('.run-item')).toHaveCount(10);

      // Navigate to next page
      await page.click('button:has-text("Next")');
      await expect(page.locator('.run-item')).toHaveCount(10);

      // Should show page 2 indicator
      await expect(page.locator('text=Page 2')).toBeVisible();
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should work on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 2));
      await page.goto('/runs');

      // Should show mobile-optimized layout
      await expect(page.locator('.run-item')).toBeVisible();

      // Add button should be accessible (floating action button)
      await expect(page.locator('button:has-text("Add Run"), .fab')).toBeVisible();

      // Run items should be touch-friendly
      const runItem = page.locator('.run-item').first();
      const boundingBox = await runItem.boundingBox();
      expect(boundingBox?.height).toBeGreaterThan(44); // Minimum touch target
    });

    test('should support swipe gestures on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await testDb.createTestRuns(assertTestUser(testUser).id, [mockRuns[0]]);
      await page.goto('/runs');

      const runItem = page.locator('.run-item').first();

      // Swipe left to reveal actions
      await runItem.hover();
      await page.mouse.down();
      await page.mouse.move(100, 0); // Swipe left
      await page.mouse.up();

      // Should reveal edit/delete actions
      await expect(page.locator('.swipe-actions')).toBeVisible();
      await expect(page.locator('.edit-action')).toBeVisible();
      await expect(page.locator('.delete-action')).toBeVisible();
    });
  });

  test.describe('Error Handling', () => {
    test('should handle network errors gracefully', async ({ page }) => {
      // Mock network failure
      await page.route('**/api/runs', route => {
        route.fulfill({ status: 500, body: 'Server Error' });
      });

      await page.goto('/runs');

      // Should show error message
      await expect(page.locator('text=Failed to load runs')).toBeVisible();
      await expect(page.locator('button:has-text("Retry")')).toBeVisible();
    });

    test('should retry loading runs when retry button is clicked', async ({ page }) => {
      let shouldFail = true;

      await page.route('**/api/runs', route => {
        if (shouldFail) {
          route.fulfill({ status: 500, body: 'Server Error' });
          shouldFail = false;
        } else {
          route.continue();
        }
      });

      await page.goto('/runs');
      await expect(page.locator('text=Failed to load runs')).toBeVisible();

      // Click retry
      await page.click('button:has-text("Retry")');

      // Should load successfully on retry
      await expect(page.locator('h1')).toContainText('My Runs');
    });
  });

  test.describe('Accessibility', () => {
    test('should be keyboard navigable', async ({ page }) => {
      await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 2));
      await page.goto('/runs');

      // Tab through interactive elements
      await page.keyboard.press('Tab'); // Add button
      await expect(page.locator('button:has-text("Add Run")')).toBeFocused();

      await page.keyboard.press('Tab'); // First run item
      await expect(page.locator('.run-item').first()).toBeFocused();

      // Should be able to activate with Enter or Space
      await page.keyboard.press('Enter');
      await expect(page.locator('h2')).toContainText('Run Details');
    });

    test('should have proper ARIA labels and roles', async ({ page }) => {
      await testDb.createTestRuns(assertTestUser(testUser).id, [mockRuns[0]]);
      await page.goto('/runs');

      // Check list has proper role
      await expect(page.locator('[role="list"]')).toBeVisible();
      await expect(page.locator('[role="listitem"]')).toBeVisible();

      // Check buttons have proper labels
      await expect(page.locator('button[aria-label="Add new run"]')).toBeVisible();
      await expect(page.locator('button[aria-label="Edit run"]')).toBeVisible();
      await expect(page.locator('button[aria-label="Delete run"]')).toBeVisible();
    });
  });
});

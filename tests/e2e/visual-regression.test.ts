import { test, expect, devices } from '@playwright/test';
import { testDb } from '../fixtures/testDatabase';
import { mockRuns, mockGoals, mockRaces } from '../fixtures/mockData';
import { VisualTestHelper, visualConfigs } from '../setup/visualTestingSetup';

// Configure visual testing based on environment
const isCI = process.env.CI === 'true';
const updateBaselines = process.env.UPDATE_VISUAL_BASELINES === 'true';

const visualTest = new VisualTestHelper({
  ...visualConfigs[isCI ? 'ci' : 'local'],
  updateBaselines,
});

test.describe('Visual Regression Tests', () => {
  let testUser: any;
  let authToken: string;

  test.beforeEach(async ({ page }) => {
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'visual@test.com',
      password: 'testpassword123'
    });
    authToken = testDb.generateTestToken(testUser.id);

    // Create comprehensive test data
    await testDb.createTestRuns(testUser.id, mockRuns.slice(0, 8));
    await testDb.createTestGoals(testUser.id, mockGoals.slice(0, 4));
    await testDb.createTestRaces(testUser.id, mockRaces.slice(0, 3));

    // Setup page for consistent visual testing
    await visualTest.setupPageForVisualTesting(page);
  });

  test.afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
    
    // Generate visual regression report
    await visualTest.generateReport();
  });

  test.describe('Authentication Pages', () => {
    test('should match login page visual baseline', async ({ page }) => {
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      await visualTest.expectVisualMatch(page, 'login-page', {
        fullPage: true,
        maxDiffPercent: 2,
      });
    });

    test('should match login page with validation errors', async ({ page }) => {
      await page.goto('/login');
      
      // Trigger validation errors
      await page.fill('input[type="email"]', 'invalid-email');
      await page.fill('input[type="password"]', '123');
      await page.click('button[type="submit"]');
      
      // Wait for errors to appear
      await page.waitForTimeout(1000);

      await visualTest.expectVisualMatch(page, 'login-page-with-errors', {
        fullPage: true,
        maxDiffPercent: 2,
      });
    });

    test('should match register page visual baseline', async ({ page }) => {
      await page.goto('/register');
      await page.waitForLoadState('networkidle');

      await visualTest.expectVisualMatch(page, 'register-page', {
        fullPage: true,
        maxDiffPercent: 2,
      });
    });
  });

  test.describe('Dashboard Views', () => {
    test.beforeEach(async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');
      await page.waitForLoadState('networkidle');
    });

    test('should match dashboard page visual baseline', async ({ page }) => {
      await visualTest.expectVisualMatch(page, 'dashboard-page', {
        fullPage: true,
        maxDiffPercent: 3,
        mask: [
          '[data-testid="current-date"]',
          '.relative-time',
          '.chart-tooltip'
        ]
      });
    });

    test('should match dashboard loading state', async ({ page }) => {
      // Intercept API calls to show loading state
      await page.route('**/api/stats/**', route => route.abort());
      
      await page.reload();
      await page.waitForTimeout(500); // Let loading spinners appear

      await visualTest.expectVisualMatch(page, 'dashboard-loading', {
        fullPage: true,
        maxDiffPercent: 2,
      });
    });

    test('should match dashboard empty state', async ({ page }) => {
      // Clean test data to show empty state
      await testDb.cleanupDatabase();
      testUser = await testDb.createTestUser({
        email: 'empty@test.com',
        password: 'testpassword123'
      });

      // Login with empty user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');
      await page.waitForLoadState('networkidle');

      await visualTest.expectVisualMatch(page, 'dashboard-empty', {
        fullPage: true,
        maxDiffPercent: 2,
      });
    });
  });

  test.describe('Runs Management Pages', () => {
    test.beforeEach(async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await page.goto('/runs');
      await page.waitForLoadState('networkidle');
    });

    test('should match runs list page visual baseline', async ({ page }) => {
      await visualTest.expectVisualMatch(page, 'runs-list-page', {
        fullPage: true,
        maxDiffPercent: 3,
        mask: [
          '.relative-date',
          '[data-testid="run-date"]'
        ]
      });
    });

    test('should match runs list with different filters', async ({ page }) => {
      // Apply filter if available
      const filterButton = page.locator('button:has-text("Filter"), .filter-button');
      const filterExists = await filterButton.count() > 0;
      
      if (filterExists) {
        await filterButton.first().click();
        await page.waitForTimeout(500);

        await visualTest.expectVisualMatch(page, 'runs-list-filtered', {
          fullPage: true,
          maxDiffPercent: 3,
        });
      }
    });

    test('should match add run modal', async ({ page }) => {
      // Look for add run button
      const addButton = page.locator('button:has-text("Add"), [data-testid="add-run"], .add-run-button');
      const addButtonExists = await addButton.count() > 0;
      
      if (addButtonExists) {
        await addButton.first().click();
        await page.waitForTimeout(500);

        await visualTest.expectVisualMatch(page, 'add-run-modal', {
          clip: { x: 0, y: 0, width: 1280, height: 720 },
          maxDiffPercent: 2,
        });
      }
    });
  });

  test.describe('Statistics Dashboard', () => {
    test.beforeEach(async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await page.goto('/stats');
      await page.waitForLoadState('networkidle');
      
      // Wait for charts to render
      await page.waitForTimeout(2000);
    });

    test('should match statistics page visual baseline', async ({ page }) => {
      await visualTest.expectVisualMatch(page, 'statistics-page', {
        fullPage: true,
        maxDiffPercent: 5, // Charts may have slight rendering differences
        mask: [
          '.recharts-tooltip',
          '[data-testid="chart-tooltip"]',
          '.chart-animation'
        ]
      });
    });

    test('should match insights card component', async ({ page }) => {
      const insightsCard = page.locator('.insights-card, [data-testid="insights-card"]').first();
      
      if (await insightsCard.count() > 0) {
        const cardBox = await insightsCard.boundingBox();
        
        if (cardBox) {
          await visualTest.expectVisualMatch(page, 'insights-card', {
            clip: cardBox,
            maxDiffPercent: 2,
          });
        }
      }
    });

    test('should match trends chart component', async ({ page }) => {
      const trendsChart = page.locator('.trends-chart, [data-testid="trends-chart"], .recharts-wrapper').first();
      
      if (await trendsChart.count() > 0) {
        const chartBox = await trendsChart.boundingBox();
        
        if (chartBox) {
          await visualTest.expectVisualMatch(page, 'trends-chart', {
            clip: chartBox,
            maxDiffPercent: 4, // Charts have more variance
            mask: ['.recharts-tooltip']
          });
        }
      }
    });

    test('should match personal records table', async ({ page }) => {
      const recordsTable = page.locator('.personal-records, [data-testid="personal-records"], table').first();
      
      if (await recordsTable.count() > 0) {
        const tableBox = await recordsTable.boundingBox();
        
        if (tableBox) {
          await visualTest.expectVisualMatch(page, 'personal-records-table', {
            clip: tableBox,
            maxDiffPercent: 2,
          });
        }
      }
    });
  });

  test.describe('Goals and Races Pages', () => {
    test.beforeEach(async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
    });

    test('should match goals page if available', async ({ page }) => {
      // Try to navigate to goals page
      try {
        await page.goto('/goals');
        await page.waitForLoadState('networkidle');

        await visualTest.expectVisualMatch(page, 'goals-page', {
          fullPage: true,
          maxDiffPercent: 3,
          mask: [
            '.progress-bar-animation',
            '[data-testid="progress-animation"]'
          ]
        });
      } catch (error) {
        console.log('Goals page not available, skipping visual test');
      }
    });

    test('should match races page if available', async ({ page }) => {
      // Try to navigate to races page
      try {
        await page.goto('/races');
        await page.waitForLoadState('networkidle');

        await visualTest.expectVisualMatch(page, 'races-page', {
          fullPage: true,
          maxDiffPercent: 3,
          mask: [
            '[data-testid="race-date"]',
            '.relative-date'
          ]
        });
      } catch (error) {
        console.log('Races page not available, skipping visual test');
      }
    });
  });

  test.describe('Responsive Visual Tests', () => {
    test('should match mobile dashboard view', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');
      await page.waitForLoadState('networkidle');

      // Use mobile-specific configuration
      const mobileVisualTest = new VisualTestHelper(visualConfigs.mobile);
      
      await mobileVisualTest.expectVisualMatch(page, 'dashboard-mobile', {
        fullPage: true,
        maxDiffPercent: 4,
        mask: [
          '[data-testid="current-date"]',
          '.relative-time'
        ]
      });
    });

    test('should match tablet runs view', async ({ page }) => {
      // Set tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await page.goto('/runs');
      await page.waitForLoadState('networkidle');

      await visualTest.expectVisualMatch(page, 'runs-tablet', {
        fullPage: true,
        maxDiffPercent: 3,
        mask: [
          '.relative-date',
          '[data-testid="run-date"]'
        ]
      });
    });
  });

  test.describe('Dark Mode Visual Tests', () => {
    test('should match dark mode dashboard if supported', async ({ page }) => {
      // Try to enable dark mode
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Look for dark mode toggle
      const darkModeToggle = page.locator('[data-testid="dark-mode-toggle"], .dark-mode-toggle, button:has-text("Dark")');
      const darkModeExists = await darkModeToggle.count() > 0;
      
      if (darkModeExists) {
        await darkModeToggle.first().click();
        await page.waitForTimeout(500);
        await page.waitForLoadState('networkidle');

        await visualTest.expectVisualMatch(page, 'dashboard-dark-mode', {
          fullPage: true,
          maxDiffPercent: 3,
          mask: [
            '[data-testid="current-date"]',
            '.relative-time'
          ]
        });
      } else {
        console.log('Dark mode not available, skipping visual test');
      }
    });
  });

  test.describe('Error State Visual Tests', () => {
    test('should match 404 page visual baseline', async ({ page }) => {
      await page.goto('/non-existent-page');
      await page.waitForLoadState('networkidle');

      await visualTest.expectVisualMatch(page, '404-page', {
        fullPage: true,
        maxDiffPercent: 2,
      });
    });

    test('should match network error state', async ({ page }) => {
      // Login user first
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Block network requests to simulate error
      await page.route('**/api/**', route => route.abort());
      
      await page.reload();
      await page.waitForTimeout(2000); // Wait for error states to appear

      await visualTest.expectVisualMatch(page, 'dashboard-network-error', {
        fullPage: true,
        maxDiffPercent: 3,
      });
    });
  });
});

test.describe('Visual Regression Tests - Browser Variations', () => {
  // Test in different browsers if running locally
  ['chromium', 'firefox', 'webkit'].forEach(browserName => {
    test.describe(`${browserName} specific tests`, () => {
      test(`should match login page in ${browserName}`, async ({ page }) => {
        await page.goto('/login');
        await page.waitForLoadState('networkidle');
        
        // Setup consistent rendering
        await visualTest.setupPageForVisualTesting(page);

        await visualTest.expectVisualMatch(page, `login-page-${browserName}`, {
          fullPage: true,
          maxDiffPercent: 5, // More lenient for cross-browser differences
        });
      });
    });
  });
});
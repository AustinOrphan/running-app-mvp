/**
 * Improved Authentication E2E Tests
 * Demonstrates reliability improvements and best practices
 */

import { test, expect } from '@playwright/test';
import { createE2EHelpers } from './utils/testHelpers';
import { ReliabilityUtils } from './utils/reliability';
import { testDb } from '../fixtures/testDatabase';
import type { TestUser } from './types';
import { assertTestUser } from './types/index.js';

test.describe('Authentication Flow E2E Tests - Improved', () => {
  let helpers: ReturnType<typeof createE2EHelpers>;
  let reliability: ReliabilityUtils;

  test.beforeEach(async ({ page }) => {
    helpers = createE2EHelpers(page, testDb);
    reliability = new ReliabilityUtils(page);

    // Clean database with improved error handling
    await helpers.db?.cleanDatabase();

    // Navigate with proper wait conditions
    await page.goto('/');
    await helpers.helpers.waitForPageLoad();
  });

  test.afterAll(async () => {
    await helpers.db?.cleanDatabase();
    await testDb.prisma.$disconnect();
  });

  test.describe('Registration Flow - Improved', () => {
    test('should successfully register a new user with enhanced reliability', async ({ page }) => {
      // Navigate to registration with proper wait
      await reliability.clickSafely('text=Sign Up');

      // Wait for form to be fully loaded and interactive
      await helpers.helpers.waitForElement('h2:has-text("Create Account")');
      await reliability.ensurePageInteractive();

      // Fill form using enhanced form helper
      await helpers.helpers.fillForm({
        'input[type="email"]': 'newuser@test.com',
        'input[type="password"]': 'securepassword123',
        'input[name="confirmPassword"]': 'securepassword123',
      });

      // Submit with proper loading state handling
      await helpers.helpers.submitForm('button[type="submit"]', 'Creating account...');

      // Wait for navigation with network idle
      await helpers.helpers.waitForNavigation('/dashboard');

      // Verify dashboard is fully loaded
      await helpers.helpers.waitForElement('h1:has-text("Dashboard")');

      // Verify user email is displayed
      await helpers.helpers.waitForElement('text=newuser@test.com');
    });

    test('should handle validation errors reliably', async ({ page }) => {
      await reliability.clickSafely('text=Sign Up');
      await helpers.helpers.waitForElement('h2:has-text("Create Account")');

      // Test invalid email with enhanced error checking
      await helpers.helpers.fillForm({
        'input[type="email"]': 'invalid-email',
        'input[type="password"]': 'password123',
        'input[name="confirmPassword"]': 'password123',
      });

      await helpers.helpers.submitForm('button[type="submit"]');
      await helpers.helpers.waitForErrorMessage('Please enter a valid email');

      // Test weak password
      await helpers.helpers.fillForm({
        'input[type="email"]': 'valid@test.com',
        'input[type="password"]': '123',
        'input[name="confirmPassword"]': '123',
      });

      await helpers.helpers.submitForm('button[type="submit"]');
      await helpers.helpers.waitForErrorMessage('Password must be at least');

      // Test mismatched passwords
      await helpers.helpers.fillForm({
        'input[type="password"]': 'password123',
        'input[name="confirmPassword"]': 'different123',
      });

      await helpers.helpers.submitForm('button[type="submit"]');
      await helpers.helpers.waitForErrorMessage('Passwords do not match');
    });

    test('should prevent duplicate email registration with retry handling', async ({ page }) => {
      // Create existing user with database helper
      await helpers.db?.createTestUser({
        email: 'existing@test.com',
        password: 'password123',
      });

      // Wait for database state to settle
      await reliability.waitForDatabaseState(async () => {
        // Verify user exists in database
        const user = await testDb.findUserByEmail('existing@test.com');
        return user !== null;
      });

      await reliability.clickSafely('text=Sign Up');
      await helpers.helpers.waitForElement('h2:has-text("Create Account")');

      await helpers.helpers.fillForm({
        'input[type="email"]': 'existing@test.com',
        'input[type="password"]': 'newpassword123',
        'input[name="confirmPassword"]': 'newpassword123',
      });

      await helpers.helpers.submitForm('button[type="submit"]');
      await helpers.helpers.waitForErrorMessage('Email already exists');

      // Verify still on registration page
      await helpers.helpers.waitForElement('h2:has-text("Create Account")');
    });
  });

  test.describe('Login Flow - Improved', () => {
    let testUser: TestUser | undefined;

    test.beforeEach(async () => {
      // Create test user with enhanced error handling
      testUser = await helpers.db?.createTestUser({
        email: 'login@test.com',
        password: 'testpassword123',
      });

      // Verify user creation completed
      await reliability.waitForDatabaseState(async () => {
        const user = await testDb.findUserByEmail('login@test.com');
        return user !== null;
      });
    });

    test('should login successfully with enhanced reliability', async ({ page }) => {

      // Use enhanced auth helper
      await helpers.auth.login(assertTestUser(testUser).email, 'testpassword123');

      // Verify authenticated state
      await helpers.helpers.waitForElement('h1:has-text("Dashboard")');
      await helpers.helpers.waitForElement(`text=${assertTestUser(testUser).email}`);
    });

    test('should handle invalid credentials with retry logic', async ({ page }) => {

      await reliability.clickSafely('text=Sign In');
      await helpers.helpers.waitForElement('h2:has-text("Welcome Back")');

      // Test wrong password with network retry wrapper
      await reliability.withNetworkRetry(async () => {
        await helpers.helpers.fillForm({
          'input[type="email"]': assertTestUser(testUser).email,
          'input[type="password"]': 'wrongpassword',
        });

        await helpers.helpers.submitForm('button[type="submit"]');
        await helpers.helpers.waitForErrorMessage('Invalid credentials');
      });

      // Verify still on login page
      await helpers.helpers.waitForElement('h2:has-text("Welcome Back")');
    });

    test('should handle network timeouts gracefully', async ({ page }) => {

      await reliability.clickSafely('text=Sign In');
      await helpers.helpers.waitForElement('h2:has-text("Welcome Back")');

      // Simulate slow network by intercepting requests
      await page.route('**/api/auth/login', async route => {
        // Delay response to test timeout handling
        await new Promise(resolve => setTimeout(resolve, 2000));
        await route.continue();
      });

      await helpers.helpers.fillForm({
        'input[type="email"]': assertTestUser(testUser).email,
        'input[type="password"]': 'testpassword123',
      });

      // Use network retry wrapper for flaky network conditions
      await reliability.withNetworkRetry(async () => {
        await helpers.helpers.submitForm('button[type="submit"]', 'Signing in...');
        await helpers.helpers.waitForNavigation('/dashboard', 15000);
      });
    });
  });

  test.describe('Protected Routes - Enhanced', () => {
    test('should handle route protection with proper wait conditions', async ({ page }) => {
      const protectedRoutes = ['/dashboard', '/runs', '/stats', '/profile'];

      for (const route of protectedRoutes) {
        await page.goto(route);

        // Enhanced wait for redirect with timeout
        await helpers.helpers.waitForNavigation('/login', 10000);

        // Verify login page is fully loaded
        await helpers.helpers.waitForElement('h2:has-text("Welcome Back")');
      }
    });

    test('should maintain session across navigation', async ({ page }) => {
      const testUser = await helpers.db?.createTestUser({
        email: 'session@test.com',
        password: 'testpassword123',
      });

      // Login with enhanced helper
      await helpers.auth.login(assertTestUser(testUser).email, 'testpassword123');

      const protectedRoutes = ['/dashboard', '/runs', '/stats'];

      for (const route of protectedRoutes) {
        await page.goto(route);
        await helpers.helpers.waitForPageLoad();

        // Verify we're on the correct route
        await expect(page).toHaveURL(route);

        // Verify authenticated state is maintained
        await helpers.helpers.waitForElement(`text=${assertTestUser(testUser).email}`);
      }
    });
  });

  test.describe('Performance and Stability', () => {
    test('should handle concurrent user operations', async ({ page }) => {
      const testUser = await helpers.db?.createTestUser({
        email: 'concurrent@test.com',
        password: 'testpassword123',
      });

      await helpers.auth.login(assertTestUser(testUser).email, 'testpassword123');

      // Simulate rapid navigation
      const routes = ['/dashboard', '/runs', '/stats', '/dashboard'];

      for (const route of routes) {
        await page.goto(route);
        await reliability.ensurePageInteractive();

        // Verify page is stable before moving to next
        await expect(page.locator('body')).toBeStable();
      }
    });

    test('should recover from temporary network failures', async ({ page }) => {
      const testUser = await helpers.db?.createTestUser({
        email: 'network@test.com',
        password: 'testpassword123',
      });

      // Simulate intermittent network issues
      let requestCount = 0;
      await page.route('**/api/**', async route => {
        requestCount++;

        // Fail every 3rd request to simulate network issues
        if (requestCount % 3 === 0) {
          await route.abort('internetdisconnected');
        } else {
          await route.continue();
        }
      });

      // Login should succeed despite network issues due to retry logic
      await reliability.withNetworkRetry(async () => {
        await helpers.auth.login(assertTestUser(testUser).email, 'testpassword123');
      });

      // Verify successful login
      await helpers.helpers.waitForElement('h1:has-text("Dashboard")');
    });
  });
});

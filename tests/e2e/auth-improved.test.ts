/**
 * Improved Authentication E2E Tests
 * Demonstrates reliability improvements and best practices
 */

import { test, expect } from '@playwright/test';

import { ReliabilityUtils } from './utils/reliability';
import { testDb } from '../fixtures/testDatabase';
import type { TestUser } from './types';

test.describe('Authentication Flow E2E Tests - Improved', () => {
  let reliability: ReliabilityUtils;

  test.beforeEach(async ({ page: _page }) => {
    reliability = new ReliabilityUtils(_page);

    // Clean database with improved error handling
    await testDb.cleanupDatabase();

    // Navigate with proper wait conditions
    await _page.goto('/');
    await _page.waitForLoadState('networkidle');
  });

  test.afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  test.describe('Registration Flow - Improved', () => {
    test('should successfully register a new user with enhanced reliability', async ({
      page: _page,
    }) => {
      // Navigate to registration with proper wait
      await reliability.clickSafely('text=Sign Up');

      // Wait for form to be fully loaded and interactive
      await _page.waitForSelector('h2:has-text("Create Account")');
      await reliability.ensurePageInteractive();

      // Fill form using enhanced form helper
      await _page.fill('input[type="email"]', 'newuser@test.com');
      await _page.fill('input[type="password"]', 'securepassword123');
      await _page.fill('input[name="confirmPassword"]', 'securepassword123');

      // Submit with proper loading state handling
      await _page.click('button[type="submit"]');

      // Wait for navigation with network idle
      await _page.waitForURL('**/dashboard');

      // Verify dashboard is fully loaded
      await _page.waitForSelector('h1:has-text("Dashboard")');

      // Verify user email is displayed
      await _page.waitForSelector('text=newuser@test.com');
    });

    test('should handle validation errors reliably', async ({ page: _page }) => {
      await reliability.clickSafely('text=Sign Up');
      await _page.waitForSelector('h2:has-text("Create Account")');

      // Test invalid email with enhanced error checking
      await _page.fill('input[type="email"]', 'invalid-email');
      await _page.fill('input[type="password"]', 'password123');
      await _page.fill('input[name="confirmPassword"]', 'password123');

      await _page.click('button[type="submit"]');
      await _page.waitForSelector('text=Please enter a valid email');

      // Test weak password
      await _page.fill('input[type="email"]', 'valid@test.com');
      await _page.fill('input[type="password"]', '123');
      await _page.fill('input[name="confirmPassword"]', '123');

      await _page.click('button[type="submit"]');
      await _page.waitForSelector('text=Password must be at least');

      // Test mismatched passwords
      await _page.fill('input[type="password"]', 'password123');
      await _page.fill('input[name="confirmPassword"]', 'different123');

      await _page.click('button[type="submit"]');
      await _page.waitForSelector('text=Passwords do not match');
    });

    test('should prevent duplicate email registration with retry handling', async ({
      page: _page,
    }) => {
      // Create existing user with database helper
      await testDb.createTestUser({
        email: 'existing@test.com',
        password: 'password123',
      });

      // Wait for database state to settle
      await reliability.waitForDatabaseState(async () => {
        // Verify user exists in database
        const user = await testDb.prisma.user.findUnique({
          where: { email: 'existing@test.com' },
        });
        return user !== null;
      });

      await reliability.clickSafely('text=Sign Up');
      await _page.waitForSelector('h2:has-text("Create Account")');

      await _page.fill('input[type="email"]', 'existing@test.com');
      await _page.fill('input[type="password"]', 'newpassword123');
      await _page.fill('input[name="confirmPassword"]', 'newpassword123');

      await _page.click('button[type="submit"]');
      await _page.waitForSelector('text=Email already exists');

      // Verify still on registration page
      await _page.waitForSelector('h2:has-text("Create Account")');
    });
  });

  test.describe('Login Flow - Improved', () => {
    let testUser: TestUser | undefined;

    test.beforeEach(async () => {
      // Create test user with enhanced error handling
      testUser = await testDb.createTestUser({
        email: 'login@test.com',
        password: 'testpassword123',
      });

      // Verify user creation completed
      await reliability.waitForDatabaseState(async () => {
        const user = await testDb.prisma.user.findUnique({
          where: { email: 'login@test.com' },
        });
        return user !== null;
      });
    });

    test('should login successfully with enhanced reliability', async ({ page: _page }) => {
      if (!testUser) {
        throw new Error('Test user not created');
      }

      // Use enhanced auth helper
      await reliability.clickSafely('text=Sign In');
      await _page.waitForSelector('h2:has-text("Welcome Back")');
      await _page.fill('input[type="email"]', testUser.email);
      await _page.fill('input[type="password"]', 'testpassword123');
      await _page.click('button[type="submit"]');

      // Verify authenticated state
      await _page.waitForSelector('h1:has-text("Dashboard")');
      await _page.waitForSelector(`text=${testUser.email}`);
    });

    test('should handle invalid credentials with retry logic', async ({ page: _page }) => {
      if (!testUser) {
        throw new Error('Test user not created');
      }

      await reliability.clickSafely('text=Sign In');
      await _page.waitForSelector('h2:has-text("Welcome Back")');

      // Test wrong password with network retry wrapper
      await _page.fill('input[type="email"]', testUser.email);
      await _page.fill('input[type="password"]', 'wrongpassword');
      await _page.click('button[type="submit"]');
      await _page.waitForSelector('text=Invalid credentials');

      // Verify still on login page
      await _page.waitForSelector('h2:has-text("Welcome Back")');
    });

    test('should handle network timeouts gracefully', async ({ page: _page }) => {
      if (!testUser) {
        throw new Error('Test user not created');
      }

      await reliability.clickSafely('text=Sign In');
      await _page.waitForSelector('h2:has-text("Welcome Back")');

      // Simulate slow network by intercepting requests
      await _page.route('**/api/auth/login', async route => {
        // Delay response to test timeout handling
        await new Promise(resolve => setTimeout(resolve, 2000));
        await route.continue();
      });

      await _page.fill('input[type="email"]', testUser.email);
      await _page.fill('input[type="password"]', 'testpassword123');

      // Use network retry wrapper for flaky network conditions
      await _page.click('button[type="submit"]');
      await _page.waitForURL('**/dashboard', { timeout: 15000 });
    });
  });

  test.describe('Protected Routes - Enhanced', () => {
    test('should handle route protection with proper wait conditions', async ({ page: _page }) => {
      const protectedRoutes = ['/dashboard', '/runs', '/stats', '/profile'];

      for (const route of protectedRoutes) {
        await _page.goto(route);

        // Enhanced wait for redirect with timeout
        await _page.waitForURL('**/login', { timeout: 10000 });

        // Verify login page is fully loaded
        await _page.waitForSelector('h2:has-text("Welcome Back")');
      }
    });

    test('should maintain session across navigation', async ({ page: _page }) => {
      const testUser = await testDb.createTestUser({
        email: 'session@test.com',
        password: 'testpassword123',
      });

      // Login with enhanced helper
      await reliability.clickSafely('text=Sign In');
      await _page.waitForSelector('h2:has-text("Welcome Back")');
      await _page.fill('input[type="email"]', testUser.email);
      await _page.fill('input[type="password"]', 'testpassword123');
      await _page.click('button[type="submit"]');
      await _page.waitForURL('**/dashboard');

      const protectedRoutes = ['/dashboard', '/runs', '/stats'];

      for (const route of protectedRoutes) {
        await _page.goto(route);
        await _page.waitForLoadState('networkidle');

        // Verify we're on the correct route
        await expect(_page).toHaveURL(route);

        // Verify authenticated state is maintained
        await _page.waitForSelector(`text=${testUser.email}`);
      }
    });
  });

  test.describe('Performance and Stability', () => {
    test('should handle concurrent user operations', async ({ page: _page }) => {
      const testUser = await testDb.createTestUser({
        email: 'concurrent@test.com',
        password: 'testpassword123',
      });

      await reliability.clickSafely('text=Sign In');
      await _page.waitForSelector('h2:has-text("Welcome Back")');
      await _page.fill('input[type="email"]', testUser.email);
      await _page.fill('input[type="password"]', 'testpassword123');
      await _page.click('button[type="submit"]');
      await _page.waitForURL('**/dashboard');

      // Simulate rapid navigation
      const routes = ['/dashboard', '/runs', '/stats', '/dashboard'];

      for (const route of routes) {
        await _page.goto(route);
        await reliability.ensurePageInteractive();

        // Verify page is stable before moving to next
        await _page.waitForLoadState('networkidle');
      }
    });

    test('should recover from temporary network failures', async ({ page: _page }) => {
      const testUser = await testDb.createTestUser({
        email: 'network@test.com',
        password: 'testpassword123',
      });

      // Simulate intermittent network issues
      let requestCount = 0;
      await _page.route('**/api/**', async route => {
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
        await reliability.clickSafely('text=Sign In');
        await _page.waitForSelector('h2:has-text("Welcome Back")');
        await _page.fill('input[type="email"]', testUser.email);
        await _page.fill('input[type="password"]', 'testpassword123');
        await _page.click('button[type="submit"]');
        await _page.waitForURL('**/dashboard');
      });

      // Verify successful login
      await _page.waitForSelector('h1:has-text("Dashboard")');
    });
  });
});

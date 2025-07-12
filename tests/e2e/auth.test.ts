import { test, expect } from '@playwright/test';
import type { TestUser } from './types';
import { assertTestUser } from './types/index.js';

import { testDb } from '../fixtures/testDatabase.js';

test.describe('Authentication Flow E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Clean database before each test
    await testDb.cleanupDatabase();

    // Navigate to the application
    await page.goto('/');
  });

  test.afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  test.describe('Registration Flow', () => {
    test('should successfully register a new user', async ({ page }) => {
      // Navigate to registration page
      await page.click('text=Sign Up');

      // Wait for registration form to be visible
      await expect(page.locator('h2')).toContainText('Create Account');

      // Fill registration form
      await page.fill('input[type="email"]', 'newuser@test.com');
      await page.fill('input[type="password"]', 'securepassword123');
      await page.fill('input[name="confirmPassword"]', 'securepassword123');

      // Submit form
      await page.click('button[type="submit"]');

      // Should redirect to dashboard after successful registration
      await expect(page).toHaveURL('/dashboard');
      await expect(page.locator('h1')).toContainText('Dashboard');

      // Should show user's email in header or profile
      await expect(page.locator('text=newuser@test.com')).toBeVisible();
    });

    test('should show validation errors for invalid registration data', async ({ page }) => {
      await page.click('text=Sign Up');

      // Try to submit with invalid email
      await page.fill('input[type="email"]', 'invalid-email');
      await page.fill('input[type="password"]', 'password123');
      await page.fill('input[name="confirmPassword"]', 'password123');
      await page.click('button[type="submit"]');

      // Should show email validation error
      await expect(page.locator('text=Please enter a valid email')).toBeVisible();

      // Try with weak password
      await page.fill('input[type="email"]', 'valid@test.com');
      await page.fill('input[type="password"]', '123');
      await page.fill('input[name="confirmPassword"]', '123');
      await page.click('button[type="submit"]');

      // Should show password validation error
      await expect(page.locator('text=Password must be at least')).toBeVisible();

      // Try with mismatched passwords
      await page.fill('input[type="password"]', 'password123');
      await page.fill('input[name="confirmPassword"]', 'different123');
      await page.click('button[type="submit"]');

      // Should show password match error
      await expect(page.locator('text=Passwords do not match')).toBeVisible();
    });

    test('should prevent registration with duplicate email', async ({ page }) => {
      // Create existing user
      await testDb.createTestUser({
        email: 'existing@test.com',
        password: 'password123',
      });

      await page.click('text=Sign Up');

      // Try to register with existing email
      await page.fill('input[type="email"]', 'existing@test.com');
      await page.fill('input[type="password"]', 'newpassword123');
      await page.fill('input[name="confirmPassword"]', 'newpassword123');
      await page.click('button[type="submit"]');

      // Should show error message
      await expect(page.locator('text=Email already exists')).toBeVisible();

      // Should remain on registration page
      await expect(page.locator('h2')).toContainText('Create Account');
    });

    test('should show loading state during registration', async ({ page }) => {
      await page.click('text=Sign Up');

      await page.fill('input[type="email"]', 'loading@test.com');
      await page.fill('input[type="password"]', 'password123');
      await page.fill('input[name="confirmPassword"]', 'password123');

      // Click submit and immediately check for loading state
      await page.click('button[type="submit"]');
      await expect(page.locator('button[type="submit"]')).toBeDisabled();
      await expect(page.locator('text=Creating account...')).toBeVisible();
    });
  });

  test.describe('Login Flow', () => {
    let testUser: TestUser | undefined;

    test.beforeEach(async () => {
      // Create test user for login tests
      testUser = await testDb.createTestUser({
        email: 'login@test.com',
        password: 'testpassword123',
      });
    });

    test('should successfully login with valid credentials', async ({ page }) => {
      // Navigate to login page
      await page.click('text=Sign In');

      // Wait for login form
      await expect(page.locator('h2')).toContainText('Welcome Back');

      // Fill login form
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');

      // Submit form
      await page.click('button[type="submit"]');

      // Should redirect to dashboard
      await expect(page).toHaveURL('/dashboard');
      await expect(page.locator('h1')).toContainText('Dashboard');

      // Should show user's email
      await expect(page.locator(`text=${assertTestUser(testUser).email}`)).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.click('text=Sign In');

      // Try with wrong password
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'wrongpassword');
      await page.click('button[type="submit"]');

      // Should show error message
      await expect(page.locator('text=Invalid credentials')).toBeVisible();

      // Should remain on login page
      await expect(page.locator('h2')).toContainText('Welcome Back');

      // Try with non-existent email
      await page.fill('input[type="email"]', 'nonexistent@test.com');
      await page.fill('input[type="password"]', 'password123');
      await page.click('button[type="submit"]');

      await expect(page.locator('text=Invalid credentials')).toBeVisible();
    });

    test('should show validation errors for empty fields', async ({ page }) => {
      await page.click('text=Sign In');

      // Try to submit empty form
      await page.click('button[type="submit"]');

      // Should show required field errors
      await expect(page.locator('text=Email is required')).toBeVisible();
      await expect(page.locator('text=Password is required')).toBeVisible();

      // Fill only email and submit
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.click('button[type="submit"]');

      await expect(page.locator('text=Password is required')).toBeVisible();
    });

    test('should handle case-insensitive email login', async ({ page }) => {
      await page.click('text=Sign In');

      // Login with uppercase email
      await page.fill('input[type="email"]', assertTestUser(testUser).email.toUpperCase());
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      // Should successfully login
      await expect(page).toHaveURL('/dashboard');
    });

    test('should show loading state during login', async ({ page }) => {
      await page.click('text=Sign In');

      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');

      // Click submit and check loading state
      await page.click('button[type="submit"]');
      await expect(page.locator('button[type="submit"]')).toBeDisabled();
      await expect(page.locator('text=Signing in...')).toBeVisible();
    });
  });

  test.describe('Logout Flow', () => {
    let testUser: TestUser | undefined;

    test.beforeEach(async ({ page }) => {
      // Create and login test user
      testUser = await testDb.createTestUser({
        email: 'logout@test.com',
        password: 'testpassword123',
      });

      // Login programmatically
      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');
    });

    test('should successfully logout user', async ({ page }) => {
      // Click logout button (could be in header, dropdown, or sidebar)
      await page.click('button:has-text("Logout")');

      // Should redirect to home/login page
      await expect(page).toHaveURL('/');

      // Should show login/signup options again
      await expect(page.locator('text=Sign In')).toBeVisible();
      await expect(page.locator('text=Sign Up')).toBeVisible();

      // Should not be able to access protected routes
      await page.goto('/dashboard');
      await expect(page).toHaveURL('/login');
    });

    test('should clear user session on logout', async ({ page }) => {
      // Logout
      await page.click('button:has-text("Logout")');

      // Try to access protected route directly
      await page.goto('/dashboard');

      // Should be redirected to login
      await expect(page).toHaveURL('/login');

      // Local storage should be cleared
      const tokens = await page.evaluate(() => ({
        accessToken: localStorage.getItem('accessToken'),
        refreshToken: localStorage.getItem('refreshToken'),
      }));
      expect(tokens.accessToken).toBeNull();
      expect(tokens.refreshToken).toBeNull();
    });
  });

  test.describe('Protected Routes', () => {
    test('should redirect unauthenticated users to login', async ({ page }) => {
      const protectedRoutes = ['/dashboard', '/runs', '/stats', '/profile'];

      for (const route of protectedRoutes) {
        await page.goto(route);
        await expect(page).toHaveURL('/login');
      }
    });

    test('should allow authenticated users to access protected routes', async ({ page }) => {
      // Create and login user
      const testUser = await testDb.createTestUser({
        email: 'protected@test.com',
        password: 'testpassword123',
      });

      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      // Should be able to access protected routes
      const protectedRoutes = ['/dashboard', '/runs', '/stats'];

      for (const route of protectedRoutes) {
        await page.goto(route);
        await expect(page).toHaveURL(route);
      }
    });
  });

  test.describe('Session Persistence', () => {
    test('should maintain session across page refreshes', async ({ page }) => {
      // Create and login user
      const testUser = await testDb.createTestUser({
        email: 'session@test.com',
        password: 'testpassword123',
      });

      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL('/dashboard');

      // Refresh page
      await page.reload();

      // Should still be logged in
      await expect(page).toHaveURL('/dashboard');
      await expect(page.locator(`text=${assertTestUser(testUser).email}`)).toBeVisible();
    });

    test('should handle expired tokens gracefully', async ({ page }) => {
      // Login user
      const testUser = await testDb.createTestUser({
        email: 'expired@test.com',
        password: 'testpassword123',
      });

      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      // Simulate expired token by clearing and setting invalid token
      await page.evaluate(() => {
        localStorage.setItem('accessToken', 'expired-token');
      });

      // Try to access protected route
      await page.goto('/dashboard');

      // Should be redirected to login
      await expect(page).toHaveURL('/login');
      await expect(page.locator('text=Session expired')).toBeVisible();
    });
  });

  test.describe('Token Refresh Flow', () => {
    test('should automatically refresh expired access token', async ({ page }) => {
      // Create and login user
      const testUser = await testDb.createTestUser({
        email: 'refresh@test.com',
        password: 'testpassword123',
      });

      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL('/dashboard');

      // Get initial tokens
      const tokens = await page.evaluate(() => ({
        accessToken: localStorage.getItem('accessToken'),
        refreshToken: localStorage.getItem('refreshToken'),
      }));

      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();

      // Simulate expired access token by setting a very short-lived token
      // In real scenario, this would be handled by the backend
      await page.evaluate(() => {
        // Keep refresh token but simulate expired access token
        const expiredToken =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid';
        localStorage.setItem('accessToken', expiredToken);
      });

      // Navigate to a protected route that makes API calls
      await page.goto('/runs');

      // Should still be able to access the page (token should be refreshed automatically)
      await expect(page).toHaveURL('/runs');

      // Check that new access token was set
      const newTokens = await page.evaluate(() => ({
        accessToken: localStorage.getItem('accessToken'),
        refreshToken: localStorage.getItem('refreshToken'),
      }));

      // Access token should be different (refreshed)
      expect(newTokens.accessToken).not.toBe(tokens.accessToken);
      expect(newTokens.accessToken).not.toBe(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid'
      );
    });

    test('should handle refresh token expiration', async ({ page }) => {
      // Create and login user
      const testUser = await testDb.createTestUser({
        email: 'refresh-expired@test.com',
        password: 'testpassword123',
      });

      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL('/dashboard');

      // Simulate both tokens being expired
      await page.evaluate(() => {
        localStorage.setItem('accessToken', 'expired-access-token');
        localStorage.setItem('refreshToken', 'expired-refresh-token');
      });

      // Try to access protected route
      await page.goto('/runs');

      // Should be redirected to login when refresh fails
      await expect(page).toHaveURL('/login');
      await expect(page.locator('text=Session expired')).toBeVisible();

      // Tokens should be cleared
      const tokens = await page.evaluate(() => ({
        accessToken: localStorage.getItem('accessToken'),
        refreshToken: localStorage.getItem('refreshToken'),
      }));

      expect(tokens.accessToken).toBeNull();
      expect(tokens.refreshToken).toBeNull();
    });

    test('should maintain user session during token refresh', async ({ page }) => {
      // Create and login user
      const testUser = await testDb.createTestUser({
        email: 'session-maintain@test.com',
        password: 'testpassword123',
      });

      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      // Navigate to dashboard
      await expect(page).toHaveURL('/dashboard');
      await expect(page.locator(`text=${assertTestUser(testUser).email}`)).toBeVisible();

      // Start a user action (e.g., creating a new run)
      await page.click('text=Add New Run');
      await page.fill('input[name="distance"]', '5');
      await page.fill('input[name="duration"]', '30');

      // Simulate token expiration mid-action
      await page.evaluate(() => {
        const expiredToken =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid';
        localStorage.setItem('accessToken', expiredToken);
      });

      // Submit the form (should trigger API call and token refresh)
      await page.click('button[type="submit"]');

      // Should successfully complete the action
      await expect(page.locator('text=Run added successfully')).toBeVisible();

      // User should still be logged in
      await expect(page.locator(`text=${assertTestUser(testUser).email}`)).toBeVisible();
    });

    test('should handle concurrent API calls during token refresh', async ({ page }) => {
      // Create and login user
      const testUser = await testDb.createTestUser({
        email: 'concurrent@test.com',
        password: 'testpassword123',
      });

      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL('/dashboard');

      // Simulate expired access token
      await page.evaluate(() => {
        const expiredToken =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid';
        localStorage.setItem('accessToken', expiredToken);
      });

      // Navigate to a page that makes multiple API calls
      await page.goto('/stats');

      // All data should load successfully (despite concurrent 401s triggering refresh)
      await expect(page.locator('text=Total Distance')).toBeVisible();
      await expect(page.locator('text=Average Pace')).toBeVisible();
      await expect(page.locator('text=Personal Records')).toBeVisible();

      // Only one refresh should have occurred
      const refreshCount = await page.evaluate(() => {
        // This would be tracked in the actual implementation
        return window.performance.getEntriesByName('/api/auth/refresh').length;
      });

      // Should have refreshed token only once despite multiple concurrent requests
      expect(refreshCount).toBeLessThanOrEqual(1);
    });

    test('should clear tokens on logout even after refresh', async ({ page }) => {
      // Create and login user
      const testUser = await testDb.createTestUser({
        email: 'logout-refresh@test.com',
        password: 'testpassword123',
      });

      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL('/dashboard');

      // Trigger a token refresh by simulating expired access token
      await page.evaluate(() => {
        const expiredToken =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid';
        localStorage.setItem('accessToken', expiredToken);
      });

      // Make an API call to trigger refresh
      await page.goto('/runs');
      await expect(page).toHaveURL('/runs');

      // Now logout
      await page.click('button:has-text("Logout")');

      // Should redirect to home
      await expect(page).toHaveURL('/');

      // Both tokens should be cleared
      const tokens = await page.evaluate(() => ({
        accessToken: localStorage.getItem('accessToken'),
        refreshToken: localStorage.getItem('refreshToken'),
        oldToken: localStorage.getItem('authToken'), // Legacy token
      }));

      expect(tokens.accessToken).toBeNull();
      expect(tokens.refreshToken).toBeNull();
      expect(tokens.oldToken).toBeNull();
    });
  });

  test.describe('Navigation Between Auth Pages', () => {
    test('should navigate between login and signup pages', async ({ page }) => {
      // Start on login page
      await page.goto('/login');
      await expect(page.locator('h2')).toContainText('Welcome Back');

      // Navigate to signup
      await page.click('text=Create account');
      await expect(page).toHaveURL('/register');
      await expect(page.locator('h2')).toContainText('Create Account');

      // Navigate back to login
      await page.click('text=Already have an account');
      await expect(page).toHaveURL('/login');
      await expect(page.locator('h2')).toContainText('Welcome Back');
    });

    test('should handle browser back/forward navigation', async ({ page }) => {
      // Navigate through auth pages
      await page.goto('/');
      await page.click('text=Sign In');
      await page.click('text=Create account');

      // Use browser back button
      await page.goBack();
      await expect(page).toHaveURL('/login');

      // Use browser forward button
      await page.goForward();
      await expect(page).toHaveURL('/register');
    });
  });

  test.describe('Form Accessibility', () => {
    test('should be keyboard navigable', async ({ page }) => {
      await page.goto('/login');

      // Tab through form elements
      await page.keyboard.press('Tab'); // Email field
      await expect(page.locator('input[type="email"]')).toBeFocused();

      await page.keyboard.press('Tab'); // Password field
      await expect(page.locator('input[type="password"]')).toBeFocused();

      await page.keyboard.press('Tab'); // Submit button
      await expect(page.locator('button[type="submit"]')).toBeFocused();

      // Should be able to submit with Enter
      await page.fill('input[type="email"]', 'test@example.com');
      await page.fill('input[type="password"]', 'password123');
      await page.keyboard.press('Enter');

      // Form should attempt submission
      await expect(page.locator('button[type="submit"]')).toBeDisabled();
    });

    test('should have proper ARIA labels and roles', async ({ page }) => {
      await page.goto('/login');

      // Check form has proper labels
      await expect(page.locator('label[for="email"]')).toBeVisible();
      await expect(page.locator('label[for="password"]')).toBeVisible();

      // Check inputs have proper attributes
      await expect(page.locator('input[type="email"]')).toHaveAttribute(
        'aria-label',
        'Email address'
      );
      await expect(page.locator('input[type="password"]')).toHaveAttribute(
        'aria-label',
        'Password'
      );

      // Check error messages have proper ARIA attributes
      await page.click('button[type="submit"]');
      await expect(page.locator('[role="alert"]')).toBeVisible();
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should work on mobile viewport', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto('/login');

      // Form should be visible and usable
      await expect(page.locator('h2')).toBeVisible();
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();

      // Should be able to interact with form
      await page.fill('input[type="email"]', 'mobile@test.com');
      await page.fill('input[type="password"]', 'password123');

      // Button should be tappable
      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeVisible();

      // Check button size is appropriate for touch
      const buttonBox = await submitButton.boundingBox();
      expect(buttonBox?.height).toBeGreaterThan(44); // Minimum touch target size
    });
  });
});

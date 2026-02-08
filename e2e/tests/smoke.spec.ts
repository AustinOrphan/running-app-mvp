import {
  createSmokeTests,
  createPageLoadTest,
  createAccessibilityTests,
  createAuthTests,
  createFormTests,
  createDashboardTests,
  createNavigationTests,
  createResponsiveVisualTests,
} from '@austinorphan/e2e-core';

// Basic smoke tests
createSmokeTests({
  appName: 'Running Tracker MVP',
  expectedTitle: /running|tracker/i,
  hasNavigation: true,
  hasInteractiveElements: true,
});

// Page load tests for main routes
createPageLoadTest('/', {
  expectedTitle: /running|tracker/i,
});

createPageLoadTest('/dashboard', {
  expectedHeading: /dashboard|overview/i,
});

// Accessibility tests
createAccessibilityTests({
  routes: ['/', '/dashboard'],
  checkKeyboardNavigation: true,
  checkFormLabels: true,
  checkHeadingHierarchy: true,
  checkAltText: true,
});

// Authentication tests (if applicable)
createAuthTests({
  loginRoute: '/login',
  dashboardRoute: '/dashboard',
  credentials: {
    email: process.env.E2E_USERNAME || 'test@example.com',
    password: process.env.E2E_PASSWORD || 'password',
  },
  invalidCredentials: {
    email: 'wrong@example.com',
    password: 'wrongpass',
  },
  protectedRoutes: ['/dashboard', '/runs', '/stats'],
});

// Form tests for adding runs
createFormTests({
  fields: [
    {
      selector: '#distance',
      type: 'number',
      label: 'Distance',
      validValue: '5.5',
      required: true,
    },
    {
      selector: '#duration',
      type: 'text',
      label: 'Duration',
      validValue: '30:00',
      required: true,
    },
    {
      selector: '#date',
      type: 'date',
      label: 'Date',
      validValue: '2026-02-08',
      required: true,
    },
  ],
  validationMessages: {
    required: /required/i,
    invalid: /invalid/i,
    success: /success|saved|added/i,
  },
});

// Dashboard tests
createDashboardTests({
  dashboardRoute: '/dashboard',
  requiresAuth: true,
  metrics: [
    { name: 'Total Distance', selector: '[data-metric="total-distance"]', shouldHaveValue: true },
    { name: 'Total Runs', selector: '[data-metric="total-runs"]', shouldHaveValue: true },
    { name: 'Average Pace', selector: '[data-metric="average-pace"]' },
  ],
  hasCharts: true,
  hasTables: true,
});

// Navigation tests
createNavigationTests({
  routes: [
    { path: '/', title: /home|running/i },
    { path: '/dashboard', title: /dashboard/i },
    { path: '/runs', title: /runs/i },
  ],
  navigationSelector: 'nav',
  activeClass: 'active',
});

// Responsive design tests
createResponsiveVisualTests({
  route: '/',
  name: 'homepage',
  viewports: [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1920, height: 1080 },
  ],
  threshold: 0.2,
});

createResponsiveVisualTests({
  route: '/dashboard',
  name: 'dashboard',
  viewports: [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1920, height: 1080 },
  ],
  threshold: 0.2,
});

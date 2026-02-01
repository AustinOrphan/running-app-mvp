# E2E Testing Guide - Running App MVP

## Overview

Playwright Test integration using shared `@austinorphan/e2e-core` configuration.

This project has comprehensive E2E test coverage including authentication flows, running data management, goal tracking, statistics, accessibility, and visual regression tests.

## Prerequisites

- Node.js 20+
- Playwright browsers installed
- Running backend and frontend servers

## Installation

```bash
npm install
npx playwright install
```

## Running Tests

### All E2E Tests

```bash
# Start both servers
npm run dev:full

# In another terminal, run all E2E tests
npm run test:e2e
```

### UI Mode

```bash
npm run test:e2e:ui
```

### Headed Mode (see browser)

```bash
npm run test:e2e:headed
```

### Specific Test Suites

```bash
# Smoke tests only
npx playwright test tests/e2e/smoke.spec.ts

# Authentication tests
npx playwright test tests/e2e/auth.test.ts

# Accessibility tests
npm run test:a11y:e2e

# Visual regression tests
npm run test:visual
```

## Test Environment Setup

This app requires database and user setup for E2E testing:

```bash
# Validate test environment
npm run validate-test-env

# Create test user
npm run create-test-user
```

## Selector Strategy

Add `data-testid` attributes to key interactive elements:

```html
<button data-testid="login-button">Login</button> <input data-testid="email-input" type="email" />
```

## Browser Support

Tests run across:

- Chromium (Desktop Chrome)
- Firefox (Desktop Firefox)
- WebKit (Desktop Safari)
- Mobile Chrome (Pixel 5 emulation)
- Mobile Safari (iPhone 12 emulation)

## CI Integration

Tests are configured for CI with:

- Retry on failure (2 retries in CI)
- HTML reporter for results
- Screenshots on failure
- Video recording on failure
- Trace on first retry

## Environment Variables

- `BASE_URL`: Frontend URL (default: http://localhost:3000)

## Test Structure

```
tests/e2e/
├── smoke.spec.ts              # Basic smoke tests
├── auth.test.ts               # Authentication flows
├── auth-improved.test.ts      # Enhanced auth tests
├── runs.test.ts               # Running data CRUD
├── stats.test.ts              # Statistics and analytics
├── navigation-swipe.test.ts   # Mobile navigation
├── mobile-responsiveness.test.ts  # Mobile UI tests
├── accessibility.test.ts      # A11y compliance tests
├── visual-regression.test.ts  # Visual regression tests
├── types/                     # TypeScript type definitions
└── utils/                     # Test helpers and utilities
```

## Existing Tests

This repo already has extensive E2E coverage:

- **Authentication**: Login, logout, registration flows
- **Running Data**: Create, read, update, delete runs
- **Goal Tracking**: Goal management and progress
- **Statistics**: Analytics and data visualization
- **Accessibility**: WCAG 2.1 AA compliance
- **Visual Regression**: Screenshot comparison
- **Mobile**: Responsive design and touch interactions

## Shared E2E Core

This project uses `@austinorphan/e2e-core` for:

- Standardized Playwright configuration
- Cross-browser test matrix
- CI optimization (reduced browsers for PRs)
- Shared fixtures and helpers
- Base page classes for Page Object pattern

## Troubleshooting

### Tests failing with connection errors

Ensure both servers are running:

```bash
npm run dev:full
```

### Database-related failures

Clean and reset test database:

```bash
npm run prisma:migrate
npm run create-test-user
```

### Browser not installed

Install Playwright browsers:

```bash
npx playwright install
```

### Port conflicts

Check that ports 3000 (frontend) and 3001 (backend) are available.

## Visual Regression Testing

Update visual baselines when UI intentionally changes:

```bash
npm run test:visual:update
```

## Accessibility Testing

Run accessibility-specific tests:

```bash
npm run test:a11y:all
```

## Additional Resources

- [Playwright Documentation](https://playwright.dev)
- [E2E Core Package](../../e2e-core/README.md)
- [Test Coverage Guide](./tests/coverage/)

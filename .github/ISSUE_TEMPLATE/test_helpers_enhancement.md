---
name: Create E2E Test Helpers Module
about: Implement missing testHelpers module to improve test maintainability and reduce code duplication
title: 'Create E2E Test Helpers Module for Improved Testing Infrastructure'
labels: ['enhancement', 'testing', 'e2e', 'developer-experience', 'technical-debt']
assignees: ''
---

## Problem Description

The E2E test file `tests/e2e/auth-improved.test.ts` attempts to import a `testHelpers` module that doesn't exist:

```typescript
import { createE2EHelpers } from './utils/testHelpers';
```

This results in compilation errors and forced the test to be simplified with direct Playwright API calls, reducing code reusability and maintainability.

## Current State

- E2E tests use direct Playwright API calls
- Code duplication across test files for common operations
- No standardized testing utilities
- Inconsistent error handling patterns in tests
- Missing abstraction layer for complex test operations

## Proposed Solution

Create a comprehensive `tests/e2e/utils/testHelpers.ts` module that provides:

### 1. Form Interaction Helpers

```typescript
interface FormHelpers {
  fillForm(fieldSelectors: Record<string, string>): Promise<void>;
  submitForm(submitSelector: string, expectedText?: string): Promise<void>;
  waitForFormError(errorText: string): Promise<void>;
}
```

### 2. Navigation Helpers

```typescript
interface NavigationHelpers {
  waitForNavigation(path: string, timeout?: number): Promise<void>;
  waitForPageLoad(timeout?: number): Promise<void>;
  ensurePageReady(): Promise<void>;
}
```

### 3. Element Interaction Helpers

```typescript
interface ElementHelpers {
  waitForElement(selector: string, timeout?: number): Promise<void>;
  waitForErrorMessage(message: string): Promise<void>;
  clickSafely(selector: string): Promise<void>;
  ensureElementVisible(selector: string): Promise<void>;
}
```

### 4. Authentication Helpers

```typescript
interface AuthHelpers {
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  ensureAuthenticated(): Promise<void>;
  createAndLoginUser(userData?: Partial<TestUser>): Promise<TestUser>;
}
```

### 5. Database Helpers

```typescript
interface DatabaseHelpers {
  cleanDatabase(): Promise<void>;
  createTestUser(userData?: Partial<TestUser>): Promise<TestUser>;
  createTestRuns(userId: string, runs: TestRun[]): Promise<void>;
  seedTestData(): Promise<void>;
}
```

### 6. Network Helpers

```typescript
interface NetworkHelpers {
  withNetworkRetry<T>(operation: () => Promise<T>, maxRetries?: number): Promise<T>;
  simulateNetworkDelay(delay: number): Promise<void>;
  interceptApiCall(path: string, response: any): Promise<void>;
}
```

## Implementation Structure

```typescript
// tests/e2e/utils/testHelpers.ts
export function createE2EHelpers(page: Page, testDb: TestDatabase) {
  return {
    helpers: new ElementHelpers(page),
    auth: new AuthHelpers(page, testDb),
    db: new DatabaseHelpers(testDb),
    network: new NetworkHelpers(page),
    navigation: new NavigationHelpers(page),
    forms: new FormHelpers(page),
  };
}
```

## Benefits

1. **Reduced Code Duplication**: Common test operations centralized
2. **Improved Maintainability**: Changes to UI can be handled in one place
3. **Better Error Handling**: Consistent error handling across tests
4. **Enhanced Reliability**: Built-in retry logic and stability checks
5. **Developer Experience**: Easier to write and understand tests
6. **Consistent Patterns**: Standardized testing approach across the project

## Acceptance Criteria

- [ ] Create `tests/e2e/utils/testHelpers.ts` with all helper classes
- [ ] Implement all helper interfaces listed above
- [ ] Update `tests/e2e/auth-improved.test.ts` to use the new helpers
- [ ] Add comprehensive JSDoc documentation
- [ ] Include unit tests for the helper functions
- [ ] Add TypeScript type definitions for all helper interfaces
- [ ] Update other E2E tests to use the new helpers where applicable
- [ ] Add examples in documentation for common test patterns

## Related Issues

- References PR #131 discussion: https://github.com/AustinOrphan/running-app-mvp/pull/131#discussion_r2192780446
- Part of broader testing infrastructure improvements

## Priority

**Medium** - This enhancement will significantly improve developer experience and test maintainability, but doesn't block current functionality.

## Implementation Notes

1. Start with the most commonly used helpers (auth, forms, navigation)
2. Ensure all helpers include proper error handling and timeouts
3. Add logging capabilities for debugging test failures
4. Consider adding screenshot capture on test failures
5. Include retry logic for flaky operations
6. Make helpers configurable for different test environments

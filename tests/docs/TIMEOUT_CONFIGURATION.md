# Test Timeout Configuration

This document explains the comprehensive timeout configuration system implemented to handle slower CI environments and prevent test failures due to timing issues.

## Overview

The timeout configuration system provides:

1. **Environment-aware timeouts** - Different timeouts for local vs CI environments
2. **Platform-specific adjustments** - Windows gets 50% longer timeouts, CI gets 2x longer
3. **Test-type specific timeouts** - E2E, integration, unit, and performance tests have different base timeouts
4. **Individual test file timeouts** - Known slow test files get extended timeouts automatically
5. **Specific test case timeouts** - Individual test cases can have custom timeout overrides
6. **Auto-detection** - Timeouts are automatically applied based on test file patterns

## Configuration Files

### `tests/config/slowTestTimeouts.ts`

Main configuration file defining timeout multipliers and slow test lists:

```typescript
const TIMEOUT_MULTIPLIERS = {
  e2e: { base: 30000, ci: 90000 },           // E2E tests
  integration: { base: 15000, ci: 45000 },   // Integration tests  
  heavy_unit: { base: 10000, ci: 30000 },    // Heavy unit tests
  visual: { base: 20000, ci: 60000 },        // Visual regression
  performance: { base: 30000, ci: 120000 },  // Performance tests
};
```

### `tests/setup/timeoutSetup.ts`

Automatic timeout application system that:
- Configures Jest/Vitest global timeouts
- Provides helpers for timeout operations
- Auto-applies when imported by test setup files

## Current Timeout Settings

### Vitest (Unit Tests)
- **Global baseline**: 30s for all environments
- **Platform-adjusted**: Yes (Windows +50%, CI additional adjustments)
- **Slow tests**: Individual timeout based on test type

### Jest (Integration Tests)  
- **Global baseline**: 30s for all environments
- **Platform-adjusted**: Yes (Windows +50%, CI additional adjustments)
- **Slow tests**: Extended to 45s+ based on complexity

### Playwright (E2E Tests)
- **Test timeout**: 30s local, 90s CI
- **Action timeout**: 10s local, 20s CI  
- **Navigation timeout**: 30s local, 60s CI
- **Expect timeout**: 15s local, 45s CI
- **Web server startup**: 120s local, 180s CI

## Automatic Timeout Application

The system automatically identifies slow tests and applies appropriate timeouts:

### E2E Tests
All E2E tests are considered slow by default:
- `auth.test.ts`, `dashboard.test.ts`, `goals.test.ts`, etc.
- Get 90s timeout in CI, 30s locally

### Integration Tests
Database-heavy integration tests:
- `auth.test.ts`, `goals-transactions.test.ts`, `factory-system.test.ts`
- Get 45s timeout in CI, 15s locally

### Heavy Unit Tests
Tests with encryption, logging, or complex computations:
- `clientLogger.test.ts`, `dataEncryption.test.ts`, `securityUtils.test.ts`
- Get 30s timeout in CI, 10s locally

## Usage in Tests

### Automatic (Recommended)
Timeouts are applied automatically when test setup files are imported:

```typescript
// In test files - automatic timeout application
import { testDb } from '../integration/utils/testDbSetup.js';
// Timeout is automatically configured based on file name
```

### Manual Timeout Setting
For specific operations within tests:

```typescript
import { createTimeoutHelper } from '../setup/timeoutSetup.js';

const timeoutHelper = createTimeoutHelper(5000); // 5s base

await timeoutHelper.waitFor(
  () => database.connect(),
  'database connection'
);

// Or with retry logic
const result = await timeoutHelper.retry(
  () => api.fetchData(),
  3, // max attempts
  1000 // delay between attempts
);
```

### Recommended Timeouts by Operation
The system provides recommendations for common operations:

```typescript
import { getRecommendedTimeout } from '../setup/timeoutSetup.js';

// Database operations
const dbTimeout = getRecommendedTimeout('database', 'connect'); // 5s local, 15s CI

// Network operations  
const networkTimeout = getRecommendedTimeout('network', 'request'); // 5s local, 15s CI

// UI operations (E2E)
const uiTimeout = getRecommendedTimeout('ui', 'navigation'); // 15s local, 30s CI
```

## Platform Adjustments

The system applies platform-specific multipliers:

1. **Windows**: 1.5x multiplier (50% longer)
2. **CI Environment**: 2x-3x multiplier depending on test type
3. **Combined**: Windows CI gets both adjustments

Example:
- Base timeout: 10s
- Windows local: 15s (10s × 1.5)
- Linux CI: 30s (10s × 3)  
- Windows CI: 45s (10s × 1.5 × 3)

## Test Runner Configuration

### Vitest Config Updates
```typescript
// vitest.config.ts
testTimeout: process.env.CI ? 30000 : 10000, // Global timeout
hookTimeout: process.env.CI ? 20000 : 10000, // Setup/teardown timeout
```

### Jest Config Updates
```typescript
// jest.config.js  
testTimeout: process.env.CI ? 30000 : 10000, // Further adjusted by platform utils
```

### Playwright Config Updates
```typescript
// playwright.config.ts
timeout: process.env.CI ? 90000 : 30000,           // Test timeout
actionTimeout: process.env.CI ? 20000 : 10000,     // Action timeout  
navigationTimeout: process.env.CI ? 60000 : 30000, // Navigation timeout
expect: { timeout: process.env.CI ? 45000 : 15000 } // Assertion timeout
```

## Debugging Timeouts

Enable debug output to see timeout adjustments:

```bash
DEBUG_TESTS=true npm test
```

This will show:
- Platform detection
- Timeout adjustments applied
- File-specific timeout configuration
- Platform-specific setup completion

## Adding New Slow Tests

To add a new test file that needs extended timeouts:

### Option 1: Add to Category Lists
Add the filename to `SLOW_TESTS_CONFIG` in `slowTestTimeouts.ts`:

```typescript
export const SLOW_TESTS_CONFIG = {
  integration: [
    'auth.test.ts',
    'my-new-slow-test.test.ts', // Add here
  ],
};
```

### Option 2: Add Specific Timeout Override
For tests needing custom timeouts beyond category defaults:

```typescript
export const SPECIFIC_TEST_TIMEOUTS = {
  'my-custom-test.test.ts': {
    local: 25000,  // 25s locally
    ci: 75000,     // 75s in CI
  },
};
```

### Option 3: Individual Test Case Timeouts
For specific test cases within a file:

```typescript
// In your test file
import { setTimeoutForTest } from '../setup/timeoutSetup.js';

describe('My test suite', () => {
  it('should handle very slow operation', () => {
    setTimeoutForTest(__filename, 'should handle very slow operation');
    // This specific test gets extended timeout
  });
});
```

Timeouts are automatically applied based on priority:
1. **Specific test case timeouts** (highest priority)
2. **Individual file timeout overrides** 
3. **Test type category timeouts**
4. **Global baseline timeout** (30s, lowest priority)

## Performance Impact

The timeout system has minimal performance impact:
- Configuration is applied once during setup
- Platform detection is cached
- No runtime overhead during test execution
- Only extends timeouts when necessary (CI, Windows, slow tests)

## Troubleshooting

### Tests Still Timing Out
1. Check if the test file is in the slow test configuration
2. Verify CI environment variable is set correctly  
3. Enable debug logging to see applied timeouts: `DEBUG_TESTS=true npm test`
4. Consider if the test needs to be in a different category (e2e vs integration vs heavy_unit)
5. Check if specific test case timeouts are needed for particularly slow operations
6. Verify the test file is being detected correctly in timeout auto-detection

**Debug specific test timeouts:**
```bash
# See all timeout applications
DEBUG_TESTS=true npm test -- my-test.test.ts

# Check timeout for specific file
node -e "console.log(require('./tests/config/slowTestTimeouts.js').getTimeoutForTestFile('my-test.test.ts'))"
```

### Timeouts Too Long Locally
1. Timeouts are optimized for local development (shorter)  
2. CI gets the extended timeouts automatically
3. Platform adjustments only apply where needed

### New Platform Support
To add support for a new platform:
1. Update `platformUtils.ts` with platform detection
2. Add platform-specific multipliers in `getAdjustedTimeout()`
3. Test on the new platform and adjust as needed
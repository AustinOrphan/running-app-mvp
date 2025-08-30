# Test Debugging Guide

This guide provides comprehensive instructions for debugging tests across all test types (unit, integration, and E2E) in the Running App MVP project.

## Table of Contents

- [VS Code Debugging Setup](#vs-code-debugging-setup)
- [Chrome DevTools for E2E Tests](#chrome-devtools-for-e2e-tests)
- [Test Isolation Techniques](#test-isolation-techniques)
- [Common Debugging Scenarios](#common-debugging-scenarios)
- [Performance Debugging](#performance-debugging)
- [Debugging Tools and Commands](#debugging-tools-and-commands)
- [Troubleshooting Tips](#troubleshooting-tips)

## VS Code Debugging Setup

### Unit Tests (Vitest)

#### Configuration

Add to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Vitest Tests",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "${relativeFile}", "--no-coverage", "--reporter=verbose"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Single Vitest Test",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "${relativeFile}", "-t", "${selectedText}", "--no-coverage"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

#### How to Debug

1. **Debug entire test file**:
   - Open the test file
   - Set breakpoints by clicking left of line numbers
   - Press `F5` or select "Debug Vitest Tests" from debug dropdown
   - Tests will pause at breakpoints

2. **Debug single test**:
   - Select the test name in the editor
   - Choose "Debug Single Vitest Test" from debug dropdown
   - Only the selected test will run

3. **Debug with watch mode**:
   ```bash
   # Terminal command for interactive debugging
   npx vitest --inspect-brk --no-coverage
   ```
   Then attach VS Code debugger to the Node process.

### Integration Tests (Jest)

#### Configuration

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Jest Integration Tests",
  "skipFiles": ["<node_internals>/**"],
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": [
    "${relativeFile}",
    "--runInBand",
    "--no-coverage",
    "--verbose",
    "--detectOpenHandles"
  ],
  "cwd": "${workspaceFolder}",
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen",
  "env": {
    "NODE_OPTIONS": "--experimental-vm-modules",
    "NODE_ENV": "test"
  }
},
{
  "type": "node",
  "request": "launch",
  "name": "Debug Jest Current Test",
  "skipFiles": ["<node_internals>/**"],
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": [
    "${relativeFile}",
    "-t",
    "${selectedText}",
    "--runInBand",
    "--no-coverage"
  ],
  "cwd": "${workspaceFolder}",
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen",
  "env": {
    "NODE_OPTIONS": "--experimental-vm-modules",
    "NODE_ENV": "test"
  }
}
```

#### Advanced Jest Debugging

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Jest with Database",
  "skipFiles": ["<node_internals>/**"],
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": [
    "${relativeFile}",
    "--runInBand",
    "--no-coverage",
    "--setupFilesAfterEnv",
    "${workspaceFolder}/tests/setup/debugSetup.ts"
  ],
  "cwd": "${workspaceFolder}",
  "console": "integratedTerminal",
  "env": {
    "NODE_OPTIONS": "--experimental-vm-modules",
    "NODE_ENV": "test",
    "DATABASE_URL": "file:./prisma/test.db",
    "LOG_LEVEL": "debug"
  }
}
```

### E2E Tests (Playwright)

#### Configuration

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Playwright Tests",
  "skipFiles": ["<node_internals>/**"],
  "program": "${workspaceFolder}/node_modules/.bin/playwright",
  "args": [
    "test",
    "${relativeFile}",
    "--debug",
    "--headed",
    "--project=chromium"
  ],
  "cwd": "${workspaceFolder}",
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
},
{
  "type": "node",
  "request": "launch",
  "name": "Debug Playwright Test (Specific)",
  "skipFiles": ["<node_internals>/**"],
  "program": "${workspaceFolder}/node_modules/.bin/playwright",
  "args": [
    "test",
    "${relativeFile}",
    "-g",
    "${selectedText}",
    "--debug",
    "--headed"
  ],
  "cwd": "${workspaceFolder}",
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

#### Playwright Inspector

```bash
# Enable Playwright Inspector
PWDEBUG=1 npm run test:e2e -- --headed

# With VS Code debugging
npx playwright test --debug
```

### Full Stack Debugging

For debugging the entire application stack:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Full Stack",
  "skipFiles": ["<node_internals>/**"],
  "runtimeExecutable": "npm",
  "runtimeArgs": ["run", "dev:full"],
  "console": "integratedTerminal",
  "serverReadyAction": {
    "pattern": "ready in \\d+ms",
    "uriFormat": "http://localhost:3000",
    "action": "openExternally"
  }
}
```

## Chrome DevTools for E2E Tests

### Setting Up Chrome DevTools

1. **Enable DevTools in Playwright**:

   ```typescript
   // playwright.config.ts
   export default defineConfig({
     use: {
       // Launch with DevTools open
       launchOptions: {
         devtools: true,
       },
       // Slow down actions for debugging
       slowMo: 100,
     },
   });
   ```

2. **Debug specific test with DevTools**:
   ```bash
   # Run with headed mode and DevTools
   npx playwright test path/to/test.spec.ts --headed --debug
   ```

### Using Chrome DevTools Features

#### Network Tab Debugging

```typescript
// tests/e2e/debug-helpers.ts
export async function debugNetworkRequests(page: Page) {
  // Log all network requests
  page.on('request', request => {
    console.log('>>', request.method(), request.url());
  });

  // Log all network responses
  page.on('response', response => {
    console.log('<<', response.status(), response.url());
  });

  // Log failed requests
  page.on('requestfailed', request => {
    console.log('XX', request.failure()?.errorText, request.url());
  });
}

// Use in test
test('debug API calls', async ({ page }) => {
  await debugNetworkRequests(page);
  await page.goto('/dashboard');
  // Network activity will be logged
});
```

#### Console Debugging

```typescript
// Capture console logs from the browser
test('debug console output', async ({ page }) => {
  // Listen for console messages
  page.on('console', msg => {
    console.log(`Browser console: ${msg.type()}: ${msg.text()}`);
  });

  // Listen for page errors
  page.on('pageerror', error => {
    console.error(`Browser error: ${error.message}`);
  });

  await page.goto('/app');
});
```

#### Element Inspector

```typescript
// Pause and inspect elements
test('debug element selection', async ({ page }) => {
  await page.goto('/form');

  // Pause execution to inspect elements
  await page.pause();

  // Use DevTools Elements panel to:
  // - Inspect DOM structure
  // - Test selectors in Console
  // - Modify styles/attributes
  // - View event listeners
});
```

### Advanced Chrome DevTools Techniques

#### Performance Profiling

```typescript
test('profile page performance', async ({ page, browser }) => {
  const context = await browser.newContext();
  const cdp = await context.newCDPSession(page);

  // Start profiling
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');

  // Perform actions
  await page.goto('/dashboard');
  await page.click('[data-testid="load-data"]');

  // Stop profiling
  const { profile } = await cdp.send('Profiler.stop');

  // Analyze profile
  console.log('Profile data:', profile);
});
```

#### Memory Debugging

```typescript
test('debug memory leaks', async ({ page }) => {
  // Take heap snapshot
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  // Take initial snapshot
  await cdp.send('HeapProfiler.takeHeapSnapshot');

  // Perform actions that might leak memory
  for (let i = 0; i < 10; i++) {
    await page.click('[data-testid="create-item"]');
  }

  // Take final snapshot
  await cdp.send('HeapProfiler.takeHeapSnapshot');

  // Compare snapshots in DevTools Memory panel
});
```

## Test Isolation Techniques

### Database Isolation

#### Transaction Rollback Pattern

```typescript
// tests/setup/transactionIsolation.ts
import { PrismaClient } from '@prisma/client';

export class TransactionalTestContext {
  private prisma: PrismaClient;
  private transactionClient: any;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async start() {
    // Start a transaction
    await this.prisma.$executeRaw`BEGIN`;

    // Create a savepoint
    await this.prisma.$executeRaw`SAVEPOINT test_isolation`;

    return this.prisma;
  }

  async rollback() {
    // Rollback to savepoint
    await this.prisma.$executeRaw`ROLLBACK TO SAVEPOINT test_isolation`;

    // End transaction
    await this.prisma.$executeRaw`ROLLBACK`;
  }

  async cleanup() {
    await this.prisma.$disconnect();
  }
}

// Usage in tests
describe('Isolated Database Tests', () => {
  let context: TransactionalTestContext;
  let prisma: PrismaClient;

  beforeEach(async () => {
    context = new TransactionalTestContext();
    prisma = await context.start();
  });

  afterEach(async () => {
    await context.rollback();
    await context.cleanup();
  });

  test('creates data in isolation', async () => {
    const user = await prisma.user.create({
      data: { email: 'test@example.com', password: 'hash' },
    });

    expect(user).toBeDefined();
    // Data will be rolled back after test
  });
});
```

#### Parallel Test Isolation

```typescript
// tests/setup/parallelIsolation.ts
import { randomUUID } from 'crypto';

export function createIsolatedTestDb() {
  const testId = randomUUID();
  const dbUrl = `file:./test-${testId}.db`;

  return {
    url: dbUrl,
    cleanup: async () => {
      // Remove test database file
      await fs.unlink(dbUrl.replace('file:', ''));
    },
  };
}

// Use in parallel tests
test.concurrent('parallel test 1', async () => {
  const db = createIsolatedTestDb();
  process.env.DATABASE_URL = db.url;

  // Run test with isolated database

  await db.cleanup();
});
```

### Network Isolation

#### Mock Service Worker (MSW)

```typescript
// tests/mocks/server.ts
import { setupServer } from 'msw/node';
import { rest } from 'msw';

export const server = setupServer(
  rest.get('/api/user', (req, res, ctx) => {
    return res(ctx.json({ id: '1', name: 'Test User' }));
  })
);

// tests/setup/setup.ts
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Isolate specific test behavior
test('handles API error', async () => {
  server.use(
    rest.get('/api/user', (req, res, ctx) => {
      return res(ctx.status(500), ctx.json({ error: 'Server error' }));
    })
  );

  // Test error handling
});
```

### Browser Context Isolation (E2E)

```typescript
// tests/e2e/helpers/isolation.ts
import { Browser, BrowserContext } from '@playwright/test';

export async function createIsolatedContext(
  browser: Browser,
  options?: any
): Promise<BrowserContext> {
  // Create new context with isolated storage
  const context = await browser.newContext({
    ...options,
    storageState: undefined, // Don't share storage
    httpCredentials: undefined,
  });

  // Clear all cookies
  await context.clearCookies();

  // Clear all permissions
  await context.clearPermissions();

  return context;
}

// Use in tests
test('isolated browser test', async ({ browser }) => {
  const context = await createIsolatedContext(browser);
  const page = await context.newPage();

  // Test in complete isolation

  await context.close();
});
```

### Test Data Isolation

```typescript
// tests/factories/isolatedFactory.ts
import { faker } from '@faker-js/faker';

export class IsolatedDataFactory {
  private testId: string;

  constructor() {
    this.testId = faker.datatype.uuid();
  }

  createUser(overrides?: Partial<User>) {
    return {
      email: `test-${this.testId}@example.com`,
      name: `Test User ${this.testId}`,
      ...overrides,
    };
  }

  createGoal(userId: string, overrides?: Partial<Goal>) {
    return {
      id: `goal-${this.testId}`,
      userId,
      type: 'distance',
      targetValue: 25,
      ...overrides,
    };
  }
}

// Each test gets unique data
test('isolated data test', async () => {
  const factory = new IsolatedDataFactory();
  const user = factory.createUser();

  // Guaranteed unique email even in parallel tests
});
```

## Common Debugging Scenarios

### Async/Timing Issues

#### Debug Async Test Failures

```typescript
// Add custom timeout and logging
test('debug async timing', async () => {
  console.log('Test started at:', new Date().toISOString());

  // Add explicit waits with logging
  await waitFor(
    async () => {
      console.log('Waiting for condition...');
      const element = screen.queryByText('Loading...');

      if (element) {
        console.log('Still loading at:', new Date().toISOString());
      }

      expect(element).not.toBeInTheDocument();
    },
    {
      timeout: 5000,
      onTimeout: () => {
        console.error('Timeout reached!');
        console.log('Current DOM:', screen.debug());
      },
    }
  );
});
```

#### Debug Race Conditions

```typescript
// Use deterministic promises
test('debug race condition', async () => {
  const results: string[] = [];

  // Control promise resolution order
  const promise1 = new Promise(resolve => {
    setTimeout(() => {
      results.push('first');
      resolve('first');
    }, 100);
  });

  const promise2 = new Promise(resolve => {
    setTimeout(() => {
      results.push('second');
      resolve('second');
    }, 50);
  });

  // Force sequential execution
  await promise1;
  await promise2;

  console.log('Execution order:', results);
  expect(results).toEqual(['first', 'second']);
});
```

### Memory Leaks

```typescript
// tests/debug/memoryLeaks.test.ts
describe('Memory Leak Detection', () => {
  beforeEach(() => {
    if (global.gc) {
      global.gc();
    }
  });

  test('detect component memory leak', async () => {
    const initialMemory = process.memoryUsage().heapUsed;

    // Render and unmount component multiple times
    for (let i = 0; i < 100; i++) {
      const { unmount } = render(<HeavyComponent />);
      unmount();
    }

    // Force garbage collection
    if (global.gc) {
      global.gc();
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;

    console.log(`Memory increase: ${memoryIncrease / 1024 / 1024} MB`);

    // Should not increase significantly
    expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // 10MB
  });
});
```

### Flaky Test Debugging

```typescript
// tests/debug/flakyTestDebugger.ts
export class FlakyTestDebugger {
  private results: boolean[] = [];

  async runMultipleTimes(
    testFn: () => Promise<void>,
    times: number = 10
  ) {
    console.log(`Running test ${times} times to detect flakiness...`);

    for (let i = 0; i < times; i++) {
      try {
        await testFn();
        this.results.push(true);
        console.log(`Run ${i + 1}: ✅ PASSED`);
      } catch (error) {
        this.results.push(false);
        console.log(`Run ${i + 1}: ❌ FAILED - ${error.message}`);
      }
    }

    const failureRate = this.results.filter(r => !r).length / times;
    console.log(`\nFailure rate: ${failureRate * 100}%`);

    return {
      failureRate,
      results: this.results
    };
  }
}

// Use in test
test('debug flaky test', async () => {
  const debugger = new FlakyTestDebugger();

  const { failureRate } = await debugger.runMultipleTimes(async () => {
    // Your potentially flaky test code
    const result = await fetchDataWithTimeout();
    expect(result).toBeDefined();
  });

  expect(failureRate).toBe(0); // Should never fail
});
```

## Performance Debugging

### Test Execution Time Analysis

```typescript
// tests/debug/performanceProfiler.ts
export class TestPerformanceProfiler {
  private timings: Map<string, number[]> = new Map();

  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();

    try {
      const result = await fn();
      const duration = performance.now() - start;

      if (!this.timings.has(name)) {
        this.timings.set(name, []);
      }
      this.timings.get(name)!.push(duration);

      return result;
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`${name} failed after ${duration}ms`);
      throw error;
    }
  }

  report() {
    console.log('\n=== Performance Report ===');

    for (const [name, durations] of this.timings) {
      const avg = durations.reduce((a, b) => a + b) / durations.length;
      const max = Math.max(...durations);
      const min = Math.min(...durations);

      console.log(`${name}:`);
      console.log(`  Average: ${avg.toFixed(2)}ms`);
      console.log(`  Min: ${min.toFixed(2)}ms`);
      console.log(`  Max: ${max.toFixed(2)}ms`);
    }
  }
}

// Usage
const profiler = new TestPerformanceProfiler();

test('performance test', async () => {
  await profiler.measure('database-query', async () => {
    return await prisma.user.findMany();
  });

  await profiler.measure('api-call', async () => {
    return await fetch('/api/data');
  });

  profiler.report();
});
```

### Database Query Debugging

```typescript
// Enable Prisma query logging
const prisma = new PrismaClient({
  log: [
    {
      emit: 'event',
      level: 'query',
    },
  ],
});

prisma.$on('query', e => {
  console.log('Query:', e.query);
  console.log('Duration:', e.duration, 'ms');

  if (e.duration > 100) {
    console.warn('⚠️ Slow query detected!');
  }
});
```

## Debugging Tools and Commands

### CLI Debug Commands

```bash
# Debug with Node inspector
node --inspect-brk ./node_modules/.bin/vitest run

# Debug with verbose output
npm run test -- --reporter=verbose --no-coverage

# Debug specific test file
npm run test -- path/to/test.spec.ts --reporter=verbose

# Debug with specific test name
npm run test -- -t "should calculate pace"

# Run tests sequentially (easier to debug)
npm run test:integration -- --runInBand

# Debug E2E with slow motion
SLOWMO=1000 npm run test:e2e

# Debug with headed browser
npm run test:e2e -- --headed --debug

# Generate trace for debugging
npm run test:e2e -- --trace on
```

### Environment Variables for Debugging

```bash
# Enable debug logging
DEBUG=* npm run test

# Prisma debug
DEBUG=prisma:client npm run test:integration

# Playwright debug
DEBUG=pw:api npm run test:e2e

# Verbose test output
VERBOSE=true npm run test

# Disable test timeout
TEST_TIMEOUT=0 npm run test
```

### VS Code Extensions for Debugging

1. **Jest Runner**: Run and debug Jest tests from the editor
2. **Vitest Explorer**: Browse and run Vitest tests
3. **Playwright Test for VSCode**: Run and debug Playwright tests
4. **Error Lens**: Show errors inline
5. **Test Explorer UI**: Universal test explorer

## Troubleshooting Tips

### Common Issues and Solutions

#### "Cannot find module" in Tests

```typescript
// Check module resolution
console.log('Module paths:', require.resolve.paths('module-name'));

// Verify tsconfig paths
import { compilerOptions } from './tsconfig.json';
console.log('Path mappings:', compilerOptions.paths);
```

#### Test Hangs Indefinitely

```typescript
// Add timeout to identify hanging operation
test('potentially hanging test', async () => {
  // Set aggressive timeout
  jest.setTimeout(5000);

  // Add progress logging
  console.log('Starting async operation...');

  const result = await Promise.race([
    performOperation(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Operation timeout')), 4000)),
  ]);

  console.log('Operation completed');
});
```

#### Inconsistent Test Results

```typescript
// Force deterministic behavior
beforeEach(() => {
  // Mock timers
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-15'));

  // Mock random
  vi.spyOn(Math, 'random').mockReturnValue(0.5);

  // Clear all caches
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
```

### Debug Output Helpers

```typescript
// tests/debug/helpers.ts
export const debugHelpers = {
  // Log with timestamp
  log: (message: string, data?: any) => {
    console.log(`[${new Date().toISOString()}] ${message}`, data || '');
  },

  // Log current DOM state
  logDOM: () => {
    console.log('Current DOM:', document.body.innerHTML);
  },

  // Log all event listeners
  logEventListeners: (element: HTMLElement) => {
    const events = getEventListeners(element);
    console.log('Event listeners:', events);
  },

  // Take screenshot in E2E
  screenshot: async (page: Page, name: string) => {
    await page.screenshot({
      path: `debug-screenshots/${name}-${Date.now()}.png`,
      fullPage: true,
    });
  },
};
```

### Advanced Debugging Techniques

#### Binary Search for Failing Tests

```bash
# Find which test is causing others to fail
# 1. Run half the tests
npm run test -- --testNamePattern="test [1-5]"

# 2. If fails, problem is in first half
# 3. If passes, problem is in second half
# 4. Repeat until you find the problematic test
```

#### Git Bisect for Test Regression

```bash
# Find when a test started failing
git bisect start
git bisect bad # Current commit has failing test
git bisect good abc123 # Known good commit

# Run test at each commit
git bisect run npm run test -- specific.test.ts

# Git will find the commit that introduced the failure
```

---

This debugging guide provides comprehensive tools and techniques for troubleshooting all types of tests in the Running App MVP. Use these methods to quickly identify and resolve test issues during development.

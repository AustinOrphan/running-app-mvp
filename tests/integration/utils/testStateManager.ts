/**
 * Test State Manager
 *
 * Manages global state that needs to be reset between tests
 */

interface TestState {
  // Environment variables
  originalEnv: NodeJS.ProcessEnv;
  // Global mocks
  mocks: Map<string, any>;
  // Timers
  timers: {
    setTimeout: typeof setTimeout;
    setInterval: typeof setInterval;
    setImmediate: typeof setImmediate;
    Date: typeof Date;
  };
  // Event listeners
  listeners: Array<{ event: string; listener: (...args: any[]) => void }>;
}

class TestStateManager {
  private state: TestState = {
    originalEnv: {},
    mocks: new Map(),
    timers: {
      setTimeout: global.setTimeout,
      setInterval: global.setInterval,
      setImmediate: global.setImmediate,
      Date: global.Date,
    },
    listeners: [],
  };

  /**
   * Capture current state before tests
   */
  captureState(): void {
    // Capture environment variables
    this.state.originalEnv = { ...process.env };

    // Capture original timer functions
    this.state.timers = {
      setTimeout: global.setTimeout,
      setInterval: global.setInterval,
      setImmediate: global.setImmediate,
      Date: global.Date,
    };
  }

  /**
   * Reset state after tests
   */
  resetState(): void {
    // Reset environment variables
    process.env = { ...this.state.originalEnv };

    // Clear any added env vars
    Object.keys(process.env).forEach(key => {
      if (!(key in this.state.originalEnv)) {
        delete process.env[key];
      }
    });

    // Reset timers
    global.setTimeout = this.state.timers.setTimeout;
    global.setInterval = this.state.timers.setInterval;
    global.setImmediate = this.state.timers.setImmediate;
    global.Date = this.state.timers.Date;

    // Clear all mocks
    this.state.mocks.clear();

    // Remove all added event listeners
    this.state.listeners.forEach(({ event, listener }) => {
      process.removeListener(event, listener);
    });
    this.state.listeners = [];

    // Clear any module cache for fresh imports
    this.clearModuleCache();
  }

  /**
   * Set environment variable temporarily
   */
  setEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  /**
   * Mock a global variable
   */
  mockGlobal(name: string, value: any): void {
    this.state.mocks.set(name, (global as any)[name]);
    (global as any)[name] = value;
  }

  /**
   * Restore a mocked global
   */
  restoreGlobal(name: string): void {
    if (this.state.mocks.has(name)) {
      (global as any)[name] = this.state.mocks.get(name);
      this.state.mocks.delete(name);
    }
  }

  /**
   * Add event listener that will be automatically cleaned up
   */
  addListener(event: string, listener: (...args: any[]) => void): void {
    process.on(event as any, listener);
    this.state.listeners.push({ event, listener });
  }

  /**
   * Clear module cache for specific patterns
   */
  clearModuleCache(patterns: RegExp[] = []): void {
    const defaultPatterns = [/\/server\//, /\/routes\//, /\/middleware\//, /\/utils\//];

    const allPatterns = patterns.length > 0 ? patterns : defaultPatterns;

    Object.keys(require.cache).forEach(key => {
      if (allPatterns.some(pattern => pattern.test(key))) {
        delete require.cache[key];
      }
    });
  }

  /**
   * Create isolated test environment
   */
  createIsolatedEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret',
      DATABASE_URL: 'file:./prisma/test.db',
      DISABLE_RATE_LIMIT_IN_TESTS: 'true',
      ...overrides,
    };
  }

  /**
   * Mock console methods
   */
  mockConsole(): {
    log: jest.SpyInstance;
    error: jest.SpyInstance;
    warn: jest.SpyInstance;
    info: jest.SpyInstance;
  } {
    const mocks = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      info: jest.spyOn(console, 'info').mockImplementation(),
    };

    return mocks;
  }

  /**
   * Restore console methods
   */
  restoreConsole(): void {
    jest.restoreAllMocks();
  }
}

// Export singleton instance
export const testStateManager = new TestStateManager();

/**
 * Setup helper for test suites
 */
export function setupTestState(hooks: {
  beforeAll?: () => void;
  afterAll?: () => void;
  beforeEach?: () => void;
  afterEach?: () => void;
}): void {
  if (hooks.beforeAll) {
    hooks.beforeAll();
  }

  if (hooks.beforeEach) {
    const originalBeforeEach = hooks.beforeEach;
    hooks.beforeEach = () => {
      testStateManager.captureState();
      originalBeforeEach();
    };
  } else {
    hooks.beforeEach = () => {
      testStateManager.captureState();
    };
  }

  if (hooks.afterEach) {
    const originalAfterEach = hooks.afterEach;
    hooks.afterEach = () => {
      originalAfterEach();
      testStateManager.resetState();
    };
  } else {
    hooks.afterEach = () => {
      testStateManager.resetState();
    };
  }

  if (hooks.afterAll) {
    const originalAfterAll = hooks.afterAll;
    hooks.afterAll = () => {
      originalAfterAll();
      testStateManager.resetState();
    };
  } else {
    hooks.afterAll = () => {
      testStateManager.resetState();
    };
  }
}

/**
 * Test Order Dependency Helper
 *
 * Ensures tests are independent and can run in any order
 */

interface TestMetadata {
  name: string;
  file: string;
  order: number;
  dependencies: string[];
  sideEffects: string[];
}

class TestOrderManager {
  private tests: Map<string, TestMetadata> = new Map();
  private executionOrder: string[] = [];
  private violations: Array<{
    test: string;
    issue: string;
    severity: 'error' | 'warning';
  }> = [];

  /**
   * Register a test with its metadata
   */
  registerTest(metadata: TestMetadata): void {
    this.tests.set(metadata.name, metadata);
  }

  /**
   * Track test execution
   */
  trackExecution(testName: string): void {
    this.executionOrder.push(testName);
    this.checkDependencies(testName);
  }

  /**
   * Check if test dependencies are met
   */
  private checkDependencies(testName: string): void {
    const test = this.tests.get(testName);
    if (!test) return;

    test.dependencies.forEach(dep => {
      if (!this.executionOrder.includes(dep)) {
        this.violations.push({
          test: testName,
          issue: `Depends on "${dep}" which hasn't run yet`,
          severity: 'error',
        });
      }
    });
  }

  /**
   * Get test execution report
   */
  getReport(): {
    totalTests: number;
    executedTests: number;
    violations: typeof this.violations;
    recommendations: string[];
  } {
    const recommendations: string[] = [];

    // Check for circular dependencies
    const circularDeps = this.findCircularDependencies();
    if (circularDeps.length > 0) {
      recommendations.push(`Circular dependencies detected: ${circularDeps.join(' -> ')}`);
    }

    // Check for shared state
    const sharedState = this.findSharedState();
    if (sharedState.length > 0) {
      recommendations.push(`Tests sharing state: ${sharedState.join(', ')}`);
    }

    return {
      totalTests: this.tests.size,
      executedTests: this.executionOrder.length,
      violations: this.violations,
      recommendations,
    };
  }

  /**
   * Find circular dependencies
   */
  private findCircularDependencies(): string[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[] = [];

    const dfs = (testName: string): boolean => {
      visited.add(testName);
      recursionStack.add(testName);

      const test = this.tests.get(testName);
      if (test) {
        for (const dep of test.dependencies) {
          if (!visited.has(dep)) {
            if (dfs(dep)) {
              cycles.push(testName);
              return true;
            }
          } else if (recursionStack.has(dep)) {
            cycles.push(testName);
            return true;
          }
        }
      }

      recursionStack.delete(testName);
      return false;
    };

    this.tests.forEach((_, testName) => {
      if (!visited.has(testName)) {
        dfs(testName);
      }
    });

    return cycles;
  }

  /**
   * Find tests that share state
   */
  private findSharedState(): string[] {
    const stateMap = new Map<string, string[]>();

    this.tests.forEach((test, name) => {
      test.sideEffects.forEach(effect => {
        const tests = stateMap.get(effect) || [];
        tests.push(name);
        stateMap.set(effect, tests);
      });
    });

    const shared: string[] = [];
    stateMap.forEach((tests, effect) => {
      if (tests.length > 1) {
        shared.push(`${effect} (${tests.join(', ')})`);
      }
    });

    return shared;
  }

  /**
   * Reset for new test run
   */
  reset(): void {
    this.executionOrder = [];
    this.violations = [];
  }
}

// Export singleton
export const testOrderManager = new TestOrderManager();

/**
 * Decorator to ensure test independence
 */
export function independent(
  target: any,
  propertyName: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    // Check for global state pollution
    const globalKeys = Object.keys(global);

    try {
      return await originalMethod.apply(this, args);
    } finally {
      // Check if global state was modified
      const newGlobalKeys = Object.keys(global);
      const addedKeys = newGlobalKeys.filter(key => !globalKeys.includes(key));

      if (addedKeys.length > 0) {
        console.warn(`Test "${propertyName}" added global variables: ${addedKeys.join(', ')}`);
      }
    }
  };

  return descriptor;
}

/**
 * Create isolated test context
 */
export function createIsolatedContext<T>(
  setup: () => T,
  teardown?: (context: T) => void
): {
  beforeEach: (fn: (context: T) => void) => void;
  afterEach: (fn: (context: T) => void) => void;
  getContext: () => T;
} {
  let context: T;

  return {
    beforeEach: fn => {
      beforeEach(() => {
        context = setup();
        fn(context);
      });
    },
    afterEach: fn => {
      afterEach(() => {
        fn(context);
        if (teardown) {
          teardown(context);
        }
      });
    },
    getContext: () => context,
  };
}

/**
 * Ensure tests run in random order
 */
export function randomizeTestOrder(tests: string[]): string[] {
  const shuffled = [...tests];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Check for test interdependencies
 */
export async function checkTestIndependence(
  testFn: () => Promise<void>,
  options: {
    runTwice?: boolean;
    checkGlobalState?: boolean;
    checkDatabaseState?: boolean;
  } = {}
): Promise<{
  independent: boolean;
  issues: string[];
}> {
  const issues: string[] = [];
  const { runTwice = true, checkGlobalState = true, checkDatabaseState = true } = options;

  // Capture initial state
  const initialGlobalKeys = checkGlobalState ? Object.keys(global) : [];
  const initialEnv = { ...process.env };

  try {
    // Run test first time
    await testFn();

    if (runTwice) {
      // Run test second time to check idempotency
      await testFn();
    }

    // Check for state leaks
    if (checkGlobalState) {
      const finalGlobalKeys = Object.keys(global);
      const leaked = finalGlobalKeys.filter(key => !initialGlobalKeys.includes(key));
      if (leaked.length > 0) {
        issues.push(`Global state leaked: ${leaked.join(', ')}`);
      }
    }

    // Check environment variables
    const envDiff = Object.keys(process.env).filter(
      key => !(key in initialEnv) || process.env[key] !== initialEnv[key]
    );
    if (envDiff.length > 0) {
      issues.push(`Environment variables modified: ${envDiff.join(', ')}`);
    }
  } catch (error) {
    issues.push(`Test failed: ${error}`);
  }

  return {
    independent: issues.length === 0,
    issues,
  };
}

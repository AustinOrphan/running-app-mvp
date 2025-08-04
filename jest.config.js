export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  preset: 'ts-jest/presets/default-esm',
  globalSetup: '<rootDir>/tests/setup/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/setup/jestTeardown.ts',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/mockSetup.ts', '<rootDir>/tests/setup/jestSetup.ts'],
  testMatch: ['**/tests/integration/**/*.test.ts', '**/tests/integration/**/*.test.js'],
  transformIgnorePatterns: ['node_modules/(?!(.*\\.mjs$))'],
  testPathIgnorePatterns: [
    'tests/integration/middleware/', // Middleware tests are covered by unit tests
  ],

  // Jest Caching Configuration - optimized for CI/CD performance
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',
  clearCache: false, // Keep cache between runs for performance
  resetMocks: false, // Don't reset mocks to improve performance
  restoreMocks: false, // Don't restore mocks automatically
  clearMocks: true, // Clear mocks between tests for isolation

  testEnvironmentOptions: {
    env: {
      DATABASE_URL: 'file:./prisma/test.db', // Will be overridden by setup
      JWT_SECRET: 'test-secret-key',
      NODE_ENV: 'test',
      SKIP_VACUUM: 'true', // Prevent database locking issues in tests
      TEST_DB_MAX_CONNECTIONS: '3', // Limit connections for SQLite
      TEST_DB_CONNECTION_TIMEOUT: '10000',
      TEST_DB_QUERY_TIMEOUT: '30000',
    },
  },
  collectCoverageFrom: [
    'server/routes/**/*.ts',
    'server/middleware/**/*.ts',
    'server/utils/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/*.test.{js,ts}',
    '!**/*.spec.{js,ts}',
    '!**/*.config.{js,ts}',
  ],
  coverageDirectory: 'coverage-integration',
  coverageReporters: ['text', 'json', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
        isolatedModules: true,
        tsconfig: {
          types: ['jest', '@types/jest', '@testing-library/jest-dom'],
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          module: 'ESNext',
          target: 'ESNext',
          moduleResolution: 'node',
          resolveJsonModule: true,
        },
      },
    ],
    '^.+\\.(js|jsx)$': ['babel-jest', { presets: ['@babel/preset-env'] }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  resolver: '<rootDir>/jest-resolver.cjs',
  testTimeout: 30000, // 30s global baseline timeout (further adjusted by platform utils in setup)
  verbose: true,
  // Smart parallelization: Use multiple workers when safe, single worker for database tests
  // Jest workers configuration - optimized for parallel execution
  maxWorkers: (() => {
    // Allow environment override
    if (process.env.JEST_WORKERS) {
      return parseInt(process.env.JEST_WORKERS, 10);
    }

    // Database tests need sequential execution for safety
    // But other integration tests can run in parallel
    const os = require('os');
    const cpuCount = os.cpus().length;

    // In CI: use 50% of available cores (but at least 1, max 4)
    if (process.env.CI) {
      return Math.max(1, Math.min(4, Math.floor(cpuCount / 2)));
    }

    // Locally: use 75% of available cores (but at least 1, max 6)
    return Math.max(1, Math.min(6, Math.floor(cpuCount * 0.75)));
  })(),
  // Connection handling is managed by the original globalTeardown above
};

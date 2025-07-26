// CI-specific Jest configuration for integration tests
// This configuration is optimized for CI environments with:
// - Increased timeouts for slower CI environments
// - Stricter bail and retry settings
// - CI-specific reporters and coverage settings
// - Database connection optimizations

export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  globalSetup: '<rootDir>/tests/setup/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.ts',
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup/mockSetup.ts',
    '<rootDir>/tests/setup/jestSetup.ts',
    '<rootDir>/tests/setup/jestRetrySetup.ts', // Add retry logic for flaky tests
  ],
  testMatch: ['**/tests/integration/**/*.test.ts', '**/tests/integration/**/*.test.js'],
  testPathIgnorePatterns: [
    'tests/integration/middleware/', // Middleware tests are covered by unit tests
  ],
  testEnvironmentOptions: {
    env: {
      DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/integration-test.db',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ||
        process.env.DATABASE_URL ||
        'file:./prisma/integration-test.db',
      JWT_SECRET:
        process.env.JWT_SECRET ||
        'test-secret-key-for-ci-environment-must-be-longer-than-32-characters',
      NODE_ENV: 'test',
      CI: process.env.CI || 'false',
    },
  },
  collectCoverageFrom: [
    'server/routes/**/*.ts',
    'server/middleware/**/*.ts',
    'server/utils/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageReporters: ['text', 'json', 'html', 'lcov'],
  coverageDirectory: './coverage-integration',
  coverageThreshold: {
    global: {
      branches: 75, // Stricter in CI
      functions: 75,
      lines: 75,
      statements: 75,
    },
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          types: ['jest', '@types/jest', '@testing-library/jest-dom'],
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  resolver: '<rootDir>/jest-resolver.cjs',

  // CI-specific timeout settings (increased for slower CI environments)
  testTimeout: process.env.CI ? 30000 : 20000, // 30s in CI, 20s locally

  // CI performance and reliability settings
  verbose: process.env.CI ? false : true, // Reduce verbose output in CI logs
  maxWorkers: 1, // Run integration tests sequentially to prevent database race conditions

  // CI-specific reporters
  reporters: process.env.CI
    ? [
        'default',
        ['jest-junit', { outputDirectory: './test-results', outputName: 'integration-junit.xml' }],
      ]
    : ['default'],

  // Bail on first failure in CI for faster feedback
  bail: process.env.CI ? 1 : false,

  // Jest retry configuration - handled by jestRetrySetup.ts
  // Provides up to 3 retries for flaky tests in CI environment

  // Memory management for CI
  maxConcurrency: 1, // Prevent memory issues in CI
  detectOpenHandles: process.env.CI ? false : true, // Reduce noise in CI
  forceExit: process.env.CI ? true : false, // Force exit in CI to prevent hanging

  // CI-specific logging
  silent: false,
  noStackTrace: process.env.CI ? true : false, // Cleaner CI output
};

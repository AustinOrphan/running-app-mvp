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
    'src/server/routes/**/*.ts',
    'src/server/middleware/**/*.ts',
    'src/server/utils/**/*.ts',
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
          allowImportingTsExtensions: true,
          module: 'ESNext',
          target: 'ESNext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
        },
      },
    ],
    '^.+\\.(js|jsx)$': ['babel-jest', { presets: ['@babel/preset-env'] }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@server/(.*)$': '<rootDir>/src/server/$1',
    '^@client/(.*)$': '<rootDir>/src/client/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
  },
  // resolver: '<rootDir>/jest-resolver.js', // Removed - not needed with fixed imports
  testTimeout: 30000, // 30s global baseline timeout (further adjusted by platform utils in setup)
  verbose: true,
  // Jest workers configuration - use environment variable or reasonable default
  maxWorkers: process.env.JEST_WORKERS ? parseInt(process.env.JEST_WORKERS, 10) : (process.env.CI ? 2 : 4),
  // Connection handling is managed by the original globalTeardown above
};
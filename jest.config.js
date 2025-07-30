export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  globalSetup: '<rootDir>/tests/setup/globalSetup.ts',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/mockSetup.ts', '<rootDir>/tests/setup/jestSetup.ts'],
  testMatch: ['**/tests/integration/**/*.test.ts', '**/tests/integration/**/*.test.js'],
  testPathIgnorePatterns: [
    'tests/integration/middleware/', // Middleware tests are covered by unit tests
  ],
  testEnvironmentOptions: {
    env: {
      DATABASE_URL: 'file:./prisma/test.db',
      JWT_SECRET: 'test-secret-key',
      NODE_ENV: 'test',
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
        tsconfig: {
          types: ['jest', '@types/jest', '@testing-library/jest-dom'],
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  resolver: '<rootDir>/jest-resolver.cjs',
  testTimeout: process.env.CI ? 30000 : 10000, // 30s in CI, 10s locally
  verbose: true,
  maxWorkers: 1, // Run integration tests sequentially to prevent database race conditions
};

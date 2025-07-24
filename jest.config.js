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
  ],
  coverageReporters: ['text', 'json', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
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
  testTimeout: 10000,
  verbose: true,
};

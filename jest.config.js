export default {
  preset: 'ts-jest/presets/default-esm', // Enables experimental support for ES modules in Jest
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jestSetup.ts'],
  testMatch: ['**/tests/integration/**/*.test.ts'],
  maxWorkers: 1, // Force serial execution to prevent database race conditions
  collectCoverageFrom: [
    'server/routes/**/*.ts',
    'server/middleware/**/*.ts',
    'server/utils/**/*.ts',
    'server/services/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    // Exclude utility files not covered by integration tests
    '!server/utils/dataEncryption.ts',
    '!server/utils/httpsServer.ts',
    '!server/utils/securityUtils.ts',
    '!server/utils/sslUtils.ts',
    '!server/utils/winston-stub.ts',
    '!server/utils/winstonLogger.ts',
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
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testTimeout: 10000,
  verbose: true,
};

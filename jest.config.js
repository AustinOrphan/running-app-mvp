export default {
  preset: 'ts-jest/presets/default-esm', // Enables experimental support for ES modules in Jest
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jestSetup.ts'],
  testMatch: ['**/tests/integration/**/*.test.ts'],
  collectCoverageFrom: [
    'routes/**/*.ts',
    'middleware/**/*.ts',
    'utils/**/*.ts',
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
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testTimeout: 10000,
  verbose: true,
};

/* eslint-disable no-undef */
const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  // CI-specific configuration
  maxWorkers: 2,
  bail: 1,
  ci: true,
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'reports',
        outputName: 'jest-integration-results.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
      },
    ],
  ],
  testTimeout: 30000,
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coverageDirectory: 'coverage-integration',
  // Fail if coverage drops below thresholds
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};

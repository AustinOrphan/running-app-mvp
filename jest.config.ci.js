import baseConfig from './jest.config.js';

export default {
  ...baseConfig,

  // CI-optimized caching configuration
  cache: true,
  cacheDirectory: process.env.CI_CACHE_DIR || '<rootDir>/.jest-cache',
  clearCache: false, // Preserve cache across CI runs for faster builds

  // Enhanced cache settings for CI
  haste: {
    enableSymlinks: false,
    forceNodeFilesystemAPI: true,
  },

  // CI-specific performance optimizations with smart parallelization
  maxWorkers: process.env.JEST_PARALLEL_DB === 'true' ? '50%' : 1, // Use 50% for parallel-safe tests, 1 for database tests

  // Enable more aggressive caching in CI
  transformIgnorePatterns: [
    ...(baseConfig.transformIgnorePatterns || []),
    // Cache node_modules transforms aggressively
    'node_modules/(?!(@testing-library|@babel|vitest)/)',
  ],

  // CI-specific timeout configurations (longer for slower CI runners)
  testTimeout: 45000, // 45s for CI (vs 30s in base config)

  // Result caching configuration
  collectCoverage: false, // Disable coverage in cached CI runs unless explicitly needed

  // CI reporter optimizations
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        outputName: 'integration-junit.xml',
        usePathForSuiteName: true,
      },
    ],
  ],

  // Memory optimization for CI
  logHeapUsage: true,
  detectLeaks: false, // Disable leak detection for faster CI runs

  // Memory and performance tuning for CI
};

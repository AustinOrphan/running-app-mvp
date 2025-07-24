// Enhanced ESLint configuration for code quality
import baseConfig from './eslint.config.js';
import security from 'eslint-plugin-security';
import unicorn from 'eslint-plugin-unicorn';

// Merge base configuration with quality enhancements
export default [
  ...baseConfig,

  // Enhanced quality rules for TypeScript files
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      security,
      unicorn,
    },
    rules: {
      // Security rules (essential)
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-regexp': 'error',
      'security/detect-object-injection': 'error',
      'security/detect-unsafe-regex': 'error',

      // Unicorn rules (modern practices)
      'unicorn/better-regex': 'error',
      'unicorn/catch-error-name': 'error',
      'unicorn/consistent-function-scoping': 'error',
      'unicorn/error-message': 'error',
      'unicorn/escape-case': 'error',
      'unicorn/explicit-length-check': 'error',
      'unicorn/new-for-builtins': 'error',
      'unicorn/no-console-spaces': 'error',
      'unicorn/no-for-loop': 'error',
      'unicorn/no-instanceof-array': 'error',
      'unicorn/no-lonely-if': 'error',
      'unicorn/no-new-buffer': 'error',
      'unicorn/no-zero-fractions': 'error',
      'unicorn/number-literal-case': 'error',
      'unicorn/prefer-array-find': 'error',
      'unicorn/prefer-array-some': 'error',
      'unicorn/prefer-date-now': 'error',
      'unicorn/prefer-default-parameters': 'error',
      'unicorn/prefer-includes': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/prefer-optional-catch-binding': 'error',
      'unicorn/prefer-spread': 'error',
      'unicorn/prefer-string-starts-ends-with': 'error',
      'unicorn/prefer-ternary': 'error',
      'unicorn/throw-new-error': 'error',

      // Enhanced TypeScript rules
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-as-const': 'error',
      '@typescript-eslint/prefer-for-of': 'error',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // Code quality rules
      complexity: ['error', 15],
      'max-depth': ['error', 4],
      'max-lines': ['error', 500],
      'max-lines-per-function': ['error', 100],
      'max-nested-callbacks': ['error', 3],
      'max-params': ['error', 5],
    },
  },

  // Test files - relax some rules
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'tests/**/*'],
    rules: {
      // Relax some rules for test files
      complexity: 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-nested-callbacks': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      'unicorn/no-null': 'off',

      // Relax security rules for test files
      'security/detect-eval-with-expression': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-unsafe-regex': 'off',
    },
  },
];

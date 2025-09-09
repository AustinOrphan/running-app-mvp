/**
 * PERFORMANCE ESLINT CONFIG
 *
 * Purpose: Fast linting for CI performance jobs and large codebase development
 * Usage: npm run lint:perf
 * Key difference: TypeScript project parsing DISABLED for speed (line 61)
 *
 * DO NOT merge with main eslint.config.js - breaks performance strategy
 * This config prioritizes speed over comprehensive linting
 */

import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  // Ignore patterns - more aggressive for performance
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.next/**',
      '*.d.ts',
      'prisma/generated/**',
      '*.generated.ts',
      '*.generated.js',
      'scripts/**',
      '.env*',
      '.vscode/**',
      '.idea/**',
      '.DS_Store',
      'Thumbs.db',
      '*.tmp',
      '*.temp',
      '*.log',
      'debug-eslint.*',
      'test-results/**',
      'playwright-report/**',
      'cleanup-candidates/**',
      'temp/**',
      'tmp/**',
      '.cache/**',
      '.eslintcache',
      // Ignore duplicate/backup files
      'src/**/App [0-9].tsx',
      'src/**/App [0-9].css',
      'src/**/main [0-9].tsx',
      'src/**/index [0-9].css',
      'src/**/* [0-9].*',
      'lib/**/node_modules/**',
      'lib/**/dist/**',
    ],
  },

  // Base TypeScript configuration - performance focused
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        // Disable project parsing for better performance
        // project: './tsconfig.json',
        tsconfigRootDir: process.cwd(),
        createDefaultProgram: false,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      react: react,
      'react-hooks': reactHooks,
      prettier: prettier,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // Essential rules only for fast linting
      ...js.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',

      // React essentials
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // Prettier integration
      ...prettierConfig.rules,
      'prettier/prettier': 'error',

      // Core quality rules
      'no-console': 'warn',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-unused-vars': 'off', // Use TS version instead
    },
  },

  // Test files - minimal rules
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'tests/**/*'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        test: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

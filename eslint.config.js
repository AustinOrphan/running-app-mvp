import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'data',
      'coverage',
      'playwright-report',
      'test-results',
      'node_modules',
      'generated',
      // A script for the Workflow tool: top-level return and runner-provided globals.
      'research/tools/build-corpus.workflow.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['server/**', 'scripts/**', 'tests/**', 'shared/**', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['web/**'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    // The service worker is a classic script in a worker scope: its globals are the worker's, and a
    // reference to the page's (`window`, `document`, storage) is a bug, so those are switched off.
    files: ['web/sw/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.serviceworker,
        window: 'off',
        document: 'off',
        localStorage: 'off',
        sessionStorage: 'off',
      },
    },
  },
  {
    files: ['tests/web/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
)
